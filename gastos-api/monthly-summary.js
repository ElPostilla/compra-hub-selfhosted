const { pool } = require("./db");

// Se comprueba una vez al dia (ver start() mas abajo); solo se intenta
// enviar el resumen dentro de los primeros dias del mes (para que llegue
// poco despues de cerrarse el mes anterior, no en cualquier momento) --
// el margen de "<= 3" cubre reinicios del pod justo despues del dia 1. La
// tabla monthly_summary_sent evita reenvios aunque el cron corra varias
// veces esos dias.
const SEND_WITHIN_FIRST_DAYS = 3;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const PUSH_URL = process.env.PUSH_INTERNAL_URL || "http://lista-compra-api:3000/internal/push/notify";

function previousMonthRange() {
  const now = new Date();
  const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastOfPrevMonth = new Date(firstOfThisMonth.getTime() - 1);
  const y = lastOfPrevMonth.getFullYear();
  const m = lastOfPrevMonth.getMonth(); // 0-indexed, ya es el mes anterior
  const pad = (n) => String(n).padStart(2, "0");
  const monthKey = `${y}-${pad(m + 1)}`;
  const start = `${y}-${pad(m + 1)}-01`;
  const end = `${y}-${pad(m + 1)}-${pad(new Date(y, m + 1, 0).getDate())}`;
  return { monthKey, start, end };
}

async function notify(userId, title, body) {
  try {
    await fetch(PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, title, body, url: "/gastos/" }),
    });
  } catch (err) {
    console.error("no se pudo enviar el push de resumen mensual:", err.message);
  }
}

function formatCents(cents) {
  return (cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

async function summarizeUser(userId, start, end) {
  const expenses = await pool.query(
    "SELECT category, amount_cents FROM expenses WHERE user_id = $1 AND date BETWEEN $2 AND $3",
    [userId, start, end]
  );
  const totalCents = expenses.rows.reduce((sum, r) => sum + r.amount_cents, 0);

  const budgets = await pool.query("SELECT category, amount_cents FROM budgets WHERE user_id = $1", [userId]);
  const budgetMap = new Map(budgets.rows.map((b) => [b.category, b.amount_cents]));
  const byCategory = new Map();
  for (const r of expenses.rows) {
    const key = r.category || "otros";
    byCategory.set(key, (byCategory.get(key) || 0) + r.amount_cents);
  }
  let overBudget = 0;
  for (const [cat, spent] of byCategory) {
    const budget = budgetMap.get(cat);
    if (budget && spent > budget) overBudget++;
  }
  return { totalCents, overBudget, hasActivity: expenses.rows.length > 0 || budgetMap.size > 0 };
}

async function checkAndSend() {
  if (new Date().getDate() > SEND_WITHIN_FIRST_DAYS) return;
  const { monthKey, start, end } = previousMonthRange();

  const users = await pool.query(
    `SELECT DISTINCT user_id FROM (
       SELECT user_id FROM expenses WHERE date BETWEEN $1 AND $2
       UNION
       SELECT user_id FROM budgets
     ) u`,
    [start, end]
  );

  for (const { user_id: userId } of users.rows) {
    const already = await pool.query(
      "SELECT 1 FROM monthly_summary_sent WHERE user_id = $1 AND month = $2",
      [userId, monthKey]
    );
    if (already.rowCount > 0) continue;

    const { totalCents, overBudget, hasActivity } = await summarizeUser(userId, start, end);
    if (hasActivity) {
      const monthLabel = new Date(start + "T00:00:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" });
      const body =
        `Gastaste ${formatCents(totalCents)} en ${monthLabel}` +
        (overBudget > 0 ? ` · ${overBudget} categoría${overBudget === 1 ? "" : "s"} por encima de presupuesto` : "");
      await notify(userId, "Resumen mensual de gastos", body);
    }
    await pool.query(
      "INSERT INTO monthly_summary_sent (user_id, month) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, monthKey]
    );
  }
}

function start() {
  checkAndSend().catch((err) => console.error("fallo en la primera comprobacion del resumen mensual:", err.message));
  setInterval(() => {
    checkAndSend().catch((err) => console.error("fallo comprobando el resumen mensual:", err.message));
  }, CHECK_INTERVAL_MS);
}

module.exports = { start };
