const express = require("express");
const { pool, nextMonthDate, generateDueRecurringExpenses } = require("../db");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECURRENCES = ["none", "monthly"];

function serialize(row) {
  return {
    id: row.id,
    description: row.description,
    amountCents: row.amount_cents,
    category: row.category,
    date: row.date,
    recurrence: row.recurrence,
  };
}

router.get("/expenses", asyncHandler(async (req, res) => {
  await generateDueRecurringExpenses(req.user.id);
  const r = await pool.query(
    "SELECT id, description, amount_cents, category, date, recurrence FROM expenses WHERE user_id = $1 ORDER BY date DESC, created_at DESC",
    [req.user.id]
  );
  res.json({ expenses: r.rows.map(serialize) });
}));

router.post("/expenses", asyncHandler(async (req, res) => {
  const description = String(req.body?.description || "").trim();
  const amountCents = Number(req.body?.amountCents);
  const { category, date } = req.body || {};
  const recurrence = RECURRENCES.includes(req.body?.recurrence) ? req.body.recurrence : "none";
  if (!description) return res.status(400).json({ error: "Falta la descripción." });
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: "Importe invalido." });
  }
  if (!date || !DATE_RE.test(date)) return res.status(400).json({ error: "Fecha invalida (usa YYYY-MM-DD)." });
  const nextOccurrence = recurrence === "monthly" ? nextMonthDate(date) : null;

  const inserted = await pool.query(
    `INSERT INTO expenses (user_id, description, amount_cents, category, date, recurrence, next_occurrence)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, description, amount_cents, category, date, recurrence`,
    [req.user.id, description, amountCents, category || null, date, recurrence, nextOccurrence]
  );
  res.status(201).json(serialize(inserted.rows[0]));
}));

router.delete("/expenses/:id", asyncHandler(async (req, res) => {
  const deleted = await pool.query("DELETE FROM expenses WHERE id = $1 AND user_id = $2 RETURNING id", [
    req.params.id,
    req.user.id,
  ]);
  if (deleted.rowCount === 0) return res.status(404).json({ error: "Gasto no encontrado." });
  res.json({ ok: true });
}));

router.get("/budgets", asyncHandler(async (req, res) => {
  const r = await pool.query("SELECT category, amount_cents FROM budgets WHERE user_id = $1", [req.user.id]);
  res.json({ budgets: r.rows.map((row) => ({ category: row.category, amountCents: row.amount_cents })) });
}));

router.put("/budgets/:category", asyncHandler(async (req, res) => {
  const amountCents = Number(req.body?.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return res.status(400).json({ error: "Importe invalido." });
  }
  await pool.query(
    `INSERT INTO budgets (user_id, category, amount_cents) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, category) DO UPDATE SET amount_cents = EXCLUDED.amount_cents`,
    [req.user.id, req.params.category, amountCents]
  );
  res.json({ category: req.params.category, amountCents });
}));

router.delete("/budgets/:category", asyncHandler(async (req, res) => {
  await pool.query("DELETE FROM budgets WHERE user_id = $1 AND category = $2", [req.user.id, req.params.category]);
  res.json({ ok: true });
}));

module.exports = router;
