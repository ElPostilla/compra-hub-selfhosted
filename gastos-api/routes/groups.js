const express = require("express");
const { pool, splitEqually, nextMonthDate, generateDueRecurringGroupExpenses } = require("../db");
const { broadcast } = require("../ws");
const { asyncHandler } = require("../asyncHandler");
const { tokenFromRequest, fetchMyGroups, isGroupMember, fetchGroupMembers, postActivity } = require("../groupsClient");

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECURRENCES = ["none", "monthly"];

// shares: una entrada por participante (quien "debe" su parte). La de
// quien pago va con settled: true siempre -- no se debe nada a si mismo.
function serialize(row, shares = []) {
  return {
    id: row.id,
    description: row.description,
    amountCents: row.amount_cents,
    category: row.category,
    date: row.date,
    paidBy: row.paid_by,
    recurrence: row.recurrence,
    shares: shares.map((s) => ({
      userId: s.user_id,
      shareCents: s.share_cents,
      settled: s.user_id === row.paid_by || s.settled_at !== null,
    })),
  };
}

const EXPENSE_COLS = "id, description, amount_cents, category, date, paid_by, recurrence";

async function sharesByExpense(expenseIds) {
  const map = new Map(expenseIds.map((id) => [id, []]));
  if (!expenseIds.length) return map;
  const r = await pool.query(
    `SELECT group_expense_id, user_id, share_cents, settled_at FROM group_expense_shares
     WHERE group_expense_id = ANY($1::uuid[]) ORDER BY user_id`,
    [expenseIds]
  );
  for (const row of r.rows) map.get(row.group_expense_id).push(row);
  return map;
}

async function loadExpense(groupId, expenseId) {
  const r = await pool.query(`SELECT ${EXPENSE_COLS} FROM group_expenses WHERE id = $1 AND group_id = $2`, [expenseId, groupId]);
  if (!r.rows.length) return null;
  const shares = await sharesByExpense([expenseId]);
  return serialize(r.rows[0], shares.get(expenseId));
}

// Deuda pendiente = parte sin liquidar de alguien que no es quien pago el
// gasto. Saldo neto de una persona = lo que le deben los demas menos lo
// que debe ella. Con todo sin liquidar coincide con el antiguo "pagado -
// su parte"; las partes ya devueltas dejan de contar en ambos lados.
const PENDING_SHARES = `
  FROM group_expense_shares ges JOIN group_expenses ge ON ge.id = ges.group_expense_id
  WHERE ge.group_id = $1 AND ges.settled_at IS NULL AND ges.user_id <> ge.paid_by`;

const requireMembership = asyncHandler(async (req, res, next) => {
  if (!(await isGroupMember(tokenFromRequest(req), req.params.id))) {
    return res.status(404).json({ error: "Grupo no encontrado." });
  }
  next();
});

router.get("/", asyncHandler(async (req, res) => {
  const groups = await fetchMyGroups(tokenFromRequest(req));
  res.json({ groups });
}));

// Saldo neto del usuario actual en cada uno de sus grupos, en una sola
// llamada (evita que el cliente tenga que pedir /:id/balance grupo a
// grupo). Pensado para el resumen "Hoy" de inicio: solo le interesa saber
// que debe dinero, no el detalle de quien mas hay en el grupo.
router.get("/balances", asyncHandler(async (req, res) => {
  const groups = await fetchMyGroups(tokenFromRequest(req));
  const balances = [];
  for (const g of groups) {
    const r = await pool.query(
      `SELECT
         COALESCE(SUM(ges.share_cents) FILTER (WHERE ge.paid_by = $2), 0)::int AS credit,
         COALESCE(SUM(ges.share_cents) FILTER (WHERE ges.user_id = $2), 0)::int AS debt
       ${PENDING_SHARES}`,
      [g.id, req.user.id]
    );
    balances.push({
      groupId: g.id,
      groupName: g.name,
      balanceCents: r.rows[0].credit - r.rows[0].debt,
    });
  }
  res.json({ balances });
}));

router.get("/:id/expenses", requireMembership, asyncHandler(async (req, res) => {
  const members = await fetchGroupMembers(tokenFromRequest(req), req.params.id);
  await generateDueRecurringGroupExpenses(req.params.id, members.map((m) => m.id));
  const r = await pool.query(
    `SELECT ${EXPENSE_COLS} FROM group_expenses WHERE group_id = $1 ORDER BY date DESC, created_at DESC`,
    [req.params.id]
  );
  const shares = await sharesByExpense(r.rows.map((row) => row.id));
  res.json({ expenses: r.rows.map((row) => serialize(row, shares.get(row.id))) });
}));

router.post("/:id/expenses", requireMembership, asyncHandler(async (req, res) => {
  const description = String(req.body?.description || "").trim();
  const amountCents = Number(req.body?.amountCents);
  const { category, date } = req.body || {};
  const paidBy = req.body?.paidBy || req.user.id;
  const recurrence = RECURRENCES.includes(req.body?.recurrence) ? req.body.recurrence : "none";
  if (!description) return res.status(400).json({ error: "Falta la descripción." });
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: "Importe invalido." });
  }
  if (!date || !DATE_RE.test(date)) return res.status(400).json({ error: "Fecha invalida (usa YYYY-MM-DD)." });

  const members = await fetchGroupMembers(tokenFromRequest(req), req.params.id);
  if (!members.some((m) => m.id === paidBy)) {
    return res.status(400).json({ error: "Quien pagó tiene que ser miembro del grupo." });
  }
  // participants: entre quien se reparte el gasto (por defecto, todos los
  // miembros). Puede no incluir a quien pago -- p. ej. paga una cena a
  // otros dos y solo ellos le deben.
  let participants = members.map((m) => m.id);
  if (Array.isArray(req.body?.participants)) {
    participants = [...new Set(req.body.participants.map(String))];
    if (!participants.length) return res.status(400).json({ error: "Elige al menos una persona entre la que repartir." });
    if (!participants.every((id) => members.some((m) => m.id === id))) {
      return res.status(400).json({ error: "Todos los que deben tienen que ser miembros del grupo." });
    }
  }
  const shares = splitEqually(amountCents, participants);
  const nextOccurrence = recurrence === "monthly" ? nextMonthDate(date) : null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO group_expenses (group_id, description, amount_cents, category, date, paid_by, created_by, recurrence, next_occurrence)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${EXPENSE_COLS}`,
      [req.params.id, description, amountCents, category || null, date, paidBy, req.user.id, recurrence, nextOccurrence]
    );
    const expenseId = inserted.rows[0].id;
    for (const [userId, shareCents] of shares) {
      await client.query(
        "INSERT INTO group_expense_shares (group_expense_id, user_id, share_cents) VALUES ($1, $2, $3)",
        [expenseId, userId, shareCents]
      );
    }
    await client.query("COMMIT");
    const expense = serialize(
      inserted.rows[0],
      [...shares].sort(([a], [b]) => (a < b ? -1 : 1)).map(([user_id, share_cents]) => ({ user_id, share_cents, settled_at: null }))
    );
    broadcast(req.params.id, { type: "expense_added", groupId: req.params.id, expense });
    postActivity(
      tokenFromRequest(req),
      req.params.id,
      `añadió un gasto de ${(amountCents / 100).toFixed(2)} € («${description}»)`
    ).catch(() => {});
    res.status(201).json(expense);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

router.delete("/:id/expenses/:expenseId", requireMembership, asyncHandler(async (req, res) => {
  const deleted = await pool.query(
    "DELETE FROM group_expenses WHERE id = $1 AND group_id = $2 RETURNING id",
    [req.params.expenseId, req.params.id]
  );
  if (deleted.rowCount === 0) return res.status(404).json({ error: "Gasto no encontrado." });
  broadcast(req.params.id, { type: "expense_deleted", groupId: req.params.id, id: req.params.expenseId });
  res.json({ ok: true });
}));

// Marcar (o desmarcar) que alguien ya ha devuelto su parte de un gasto a
// quien lo pago. Cualquier miembro puede hacerlo: en un grupo familiar lo
// normal es que lo apunte quien recibe el dinero, o quien lo devuelve.
router.patch("/:id/expenses/:expenseId/shares/:userId", requireMembership, asyncHandler(async (req, res) => {
  if (typeof req.body?.settled !== "boolean") return res.status(400).json({ error: "Falta settled (true/false)." });
  const settled = req.body.settled;
  const updated = await pool.query(
    `UPDATE group_expense_shares ges
     SET settled_at = CASE WHEN $4 THEN now() ELSE NULL END,
         settled_by = CASE WHEN $4 THEN $5::uuid ELSE NULL END
     FROM group_expenses ge
     WHERE ge.id = ges.group_expense_id AND ge.id = $1 AND ge.group_id = $2 AND ges.user_id = $3
     RETURNING ge.description, ge.paid_by`,
    [req.params.expenseId, req.params.id, req.params.userId, settled, req.user.id]
  );
  if (updated.rowCount === 0) return res.status(404).json({ error: "Esa persona no participa en este gasto." });
  const expense = await loadExpense(req.params.id, req.params.expenseId);
  broadcast(req.params.id, { type: "expense_updated", groupId: req.params.id, expense });
  const { description, paid_by: paidBy } = updated.rows[0];
  if (paidBy !== req.params.userId) {
    fetchGroupMembers(tokenFromRequest(req), req.params.id)
      .then((members) => {
        const who = members.find((m) => m.id === req.params.userId)?.username || "alguien";
        const msg = settled
          ? `marcó que @${who} ya ha pagado su parte de «${description}»`
          : `marcó que @${who} aún debe su parte de «${description}»`;
        return postActivity(tokenFromRequest(req), req.params.id, msg);
      })
      .catch(() => {});
  }
  res.json(expense);
}));

// Saldo neto por persona dentro del grupo (positivo: le deben; negativo:
// debe) y "quien debe a quien": deudas pendientes persona a persona, cada
// una contra quien pago el gasto, compensando entre cada pareja (si A debe
// 10 a B y B debe 4 a A, queda A debe 6 a B). No se simplifica entre
// terceros: cada deuda sigue siendo con quien realmente adelanto el dinero.
router.get("/:id/balance", requireMembership, asyncHandler(async (req, res) => {
  const members = await fetchGroupMembers(tokenFromRequest(req), req.params.id);
  const nameOf = new Map(members.map((m) => [m.id, m.username]));

  const pending = await pool.query(
    `SELECT ges.user_id AS debtor, ge.paid_by AS creditor, SUM(ges.share_cents)::int AS total
     ${PENDING_SHARES} GROUP BY ges.user_id, ge.paid_by`,
    [req.params.id]
  );

  const net = new Map();
  const pair = new Map();
  for (const { debtor, creditor, total } of pending.rows) {
    net.set(creditor, (net.get(creditor) || 0) + total);
    net.set(debtor, (net.get(debtor) || 0) - total);
    const [a, b] = debtor < creditor ? [debtor, creditor] : [creditor, debtor];
    const key = `${a}|${b}`;
    pair.set(key, (pair.get(key) || 0) + (debtor === a ? total : -total));
  }

  const balances = members.map((m) => ({
    userId: m.id,
    username: m.username,
    balanceCents: net.get(m.id) || 0,
  }));
  const debts = [];
  for (const [key, amount] of pair) {
    if (amount === 0) continue;
    const [a, b] = key.split("|");
    const [from, to] = amount > 0 ? [a, b] : [b, a];
    debts.push({
      fromUserId: from,
      fromUsername: nameOf.get(from) || null,
      toUserId: to,
      toUsername: nameOf.get(to) || null,
      amountCents: Math.abs(amount),
    });
  }
  debts.sort((x, y) => y.amountCents - x.amountCents);
  res.json({ balances, debts });
}));

router.get("/:id/budgets", requireMembership, asyncHandler(async (req, res) => {
  const r = await pool.query("SELECT category, amount_cents FROM group_budgets WHERE group_id = $1", [req.params.id]);
  res.json({ budgets: r.rows.map((row) => ({ category: row.category, amountCents: row.amount_cents })) });
}));

router.put("/:id/budgets/:category", requireMembership, asyncHandler(async (req, res) => {
  const amountCents = Number(req.body?.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: "Importe invalido." });
  }
  await pool.query(
    `INSERT INTO group_budgets (group_id, category, amount_cents) VALUES ($1, $2, $3)
     ON CONFLICT (group_id, category) DO UPDATE SET amount_cents = EXCLUDED.amount_cents`,
    [req.params.id, req.params.category, amountCents]
  );
  res.json({ category: req.params.category, amountCents });
}));

router.delete("/:id/budgets/:category", requireMembership, asyncHandler(async (req, res) => {
  await pool.query("DELETE FROM group_budgets WHERE group_id = $1 AND category = $2", [req.params.id, req.params.category]);
  res.json({ ok: true });
}));

module.exports = router;
