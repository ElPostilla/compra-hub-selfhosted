const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || "gastos",
  user: process.env.PGUSER || "gastos",
  password: process.env.PGPASSWORD,
});

// Importes en centimos (INTEGER), nunca en coma flotante -- evita errores
// de redondeo al sumar/repartir. "date" como texto YYYY-MM-DD, mismo
// motivo que en calendario-api/db.js (evita el desfase de un dia de
// node-postgres al convertir DATE <-> Date de JS segun timezone).
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      category TEXT,
      date TEXT NOT NULL CHECK (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS expenses_user_idx ON expenses (user_id, date);

    CREATE TABLE IF NOT EXISTS group_expenses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL,
      description TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      category TEXT,
      date TEXT NOT NULL CHECK (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
      paid_by UUID NOT NULL,
      created_by UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS group_expenses_group_idx ON group_expenses (group_id, date);

    -- Reparto igualitario entre los miembros del grupo en el momento de
    -- crear el gasto (calculado una vez, no se recalcula si el grupo
    -- cambia de miembros despues -- ver routes/groups.js). La suma de
    -- share_cents de un gasto es siempre exactamente su amount_cents (el
    -- resto de centimos por division no exacta se reparte entre los
    -- primeros miembros, ver splitEqually en routes/groups.js).
    CREATE TABLE IF NOT EXISTS group_expense_shares (
      group_expense_id UUID NOT NULL REFERENCES group_expenses(id) ON DELETE CASCADE,
      user_id UUID NOT NULL,
      share_cents INTEGER NOT NULL,
      PRIMARY KEY (group_expense_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS group_expense_shares_user_idx ON group_expense_shares (user_id);
  `);

  // Gasto recurrente = la propia fila actua de plantilla: "recurrence" y
  // "next_occurrence" solo importan cuando recurrence <> 'none'. Igual que
  // las tareas recurrentes de todo-api pero clonando una fila nueva en vez
  // de reabrir la misma (ver generateDueRecurringExpenses mas abajo): un
  // gasto ya generado es un hecho historico, no algo que "se completa".
  await pool.query(`
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'monthly'));
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS next_occurrence TEXT;
    ALTER TABLE group_expenses ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'monthly'));
    ALTER TABLE group_expenses ADD COLUMN IF NOT EXISTS next_occurrence TEXT;
  `);

  // Presupuesto mensual por categoria: un limite fijo que se repite cada
  // mes (no una fila por mes concreto) hasta que se cambie o se borre. Se
  // compara en el cliente contra categoryTotals del mes actual -- no hay
  // "mes" aqui porque el limite no cambia de un mes a otro salvo que el
  // usuario lo edite.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS budgets (
      user_id UUID NOT NULL,
      category TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      PRIMARY KEY (user_id, category)
    );
    CREATE TABLE IF NOT EXISTS group_budgets (
      group_id UUID NOT NULL,
      category TEXT NOT NULL,
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      PRIMARY KEY (group_id, category)
    );
  `);

  // Liquidar deudas: cada parte (share) de alguien que no es quien pago es
  // una deuda concreta con quien pago. settled_at marca que ya la ha
  // devuelto -- deja de contar en saldos y en "quien debe a quien", pero
  // la fila se conserva para ver en el gasto quien ha pagado ya y quien no.
  // La parte de quien pago nunca es deuda (se ignora en los calculos).
  await pool.query(`
    ALTER TABLE group_expense_shares ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ;
    ALTER TABLE group_expense_shares ADD COLUMN IF NOT EXISTS settled_by UUID;
  `);

  // Dedup del resumen mensual por push (ver monthly-summary.js): un mes ya
  // resumido para un usuario no se vuelve a enviar aunque el cron corra
  // varias veces ese mismo dia.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_summary_sent (
      user_id UUID NOT NULL,
      month TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, month)
    );
  `);
}

// Reparto igualitario en centimos: floor(amount/n) para todos, y el resto
// de centimos (siempre < n) se reparte uno a uno a los primeros miembros
// en orden de id, para que la suma de partes sea exactamente amountCents
// sin depender de redondeos de coma flotante. Vive aqui (no en
// routes/groups.js) porque tambien la usa generateDueRecurringGroupExpenses.
function splitEqually(amountCents, memberIds) {
  const sorted = [...memberIds].sort();
  const n = sorted.length;
  const base = Math.floor(amountCents / n);
  const remainder = amountCents - base * n;
  const shares = new Map();
  sorted.forEach((id, i) => shares.set(id, base + (i < remainder ? 1 : 0)));
  return shares;
}

// Suma un mes a una fecha TEXT YYYY-MM-DD, ajustando al ultimo dia del mes
// destino si este es mas corto (31 ene + 1 mes -> 28/29 feb, no 3 marzo).
function nextMonthDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  let ny = y;
  let nm = m + 1;
  if (nm > 12) {
    nm = 1;
    ny += 1;
  }
  const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, lastDay);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

async function today() {
  const r = await pool.query("SELECT CURRENT_DATE::text AS today");
  return r.rows[0].today;
}

// Al listar los gastos personales, genera como gastos reales (recurrence
// 'none') todas las ocurrencias de plantillas mensuales que ya tocaban, y
// avanza next_occurrence de la plantilla. Tope de 24 clones por plantilla
// y llamada: evita un bucle largo si el proceso ha estado parado meses.
async function generateDueRecurringExpenses(userId) {
  const todayStr = await today();
  const due = await pool.query(
    `SELECT id, description, amount_cents, category, next_occurrence
     FROM expenses WHERE user_id = $1 AND recurrence = 'monthly' AND next_occurrence <= $2`,
    [userId, todayStr]
  );
  for (const row of due.rows) {
    let occurrence = row.next_occurrence;
    let guard = 0;
    while (occurrence <= todayStr && guard < 24) {
      await pool.query(
        `INSERT INTO expenses (user_id, description, amount_cents, category, date, recurrence)
         VALUES ($1, $2, $3, $4, $5, 'none')`,
        [userId, row.description, row.amount_cents, row.category, occurrence]
      );
      occurrence = nextMonthDate(occurrence);
      guard++;
    }
    await pool.query("UPDATE expenses SET next_occurrence = $2 WHERE id = $1", [row.id, occurrence]);
  }
}

// Igual que generateDueRecurringExpenses pero para gastos de grupo: cada
// ocurrencia generada se reparte entre los mismos participantes que la
// plantilla (sus filas de group_expense_shares) que sigan siendo miembros
// ACTUALES del grupo (memberIds, ya resueltos por el caller via
// groupsClient). Si ya no queda ninguno, entre todos los miembros.
async function generateDueRecurringGroupExpenses(groupId, memberIds) {
  if (!memberIds.length) return;
  const todayStr = await today();
  const due = await pool.query(
    `SELECT id, description, amount_cents, category, paid_by, created_by, next_occurrence
     FROM group_expenses WHERE group_id = $1 AND recurrence = 'monthly' AND next_occurrence <= $2`,
    [groupId, todayStr]
  );
  for (const row of due.rows) {
    const tpl = await pool.query("SELECT user_id FROM group_expense_shares WHERE group_expense_id = $1", [row.id]);
    const current = new Set(memberIds);
    const tplParticipants = tpl.rows.map((r) => r.user_id).filter((id) => current.has(id));
    const participants = tplParticipants.length ? tplParticipants : memberIds;
    let occurrence = row.next_occurrence;
    let guard = 0;
    while (occurrence <= todayStr && guard < 24) {
      const shares = splitEqually(row.amount_cents, participants);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const inserted = await client.query(
          `INSERT INTO group_expenses (group_id, description, amount_cents, category, date, paid_by, created_by, recurrence)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 'none')
           RETURNING id`,
          [groupId, row.description, row.amount_cents, row.category, occurrence, row.paid_by, row.created_by]
        );
        const newId = inserted.rows[0].id;
        for (const [userId, shareCents] of shares) {
          await client.query(
            "INSERT INTO group_expense_shares (group_expense_id, user_id, share_cents) VALUES ($1, $2, $3)",
            [newId, userId, shareCents]
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
      occurrence = nextMonthDate(occurrence);
      guard++;
    }
    await pool.query("UPDATE group_expenses SET next_occurrence = $2 WHERE id = $1", [row.id, occurrence]);
  }
}

module.exports = {
  pool,
  migrate,
  splitEqually,
  nextMonthDate,
  generateDueRecurringExpenses,
  generateDueRecurringGroupExpenses,
};
