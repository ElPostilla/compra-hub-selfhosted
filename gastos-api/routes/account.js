// Derechos RGPD sobre los datos que guarda ESTA API (la app Perfil llama a
// todas las APIs del hub): GET /export = acceso y portabilidad (arts. 15 y
// 20), DELETE / = supresion (art. 17).
//
// Al borrar: lo personal se elimina; en los grupos que siguen teniendo mas
// miembros lo que creo la persona se queda para el resto, pero sin autor
// (created_by = NULL). Los grupos en los que era el unico miembro se borran
// enteros. La membresia la da lista-compra-api, por eso Perfil llama a esta
// API ANTES de borrar la cuenta alli.
const express = require("express");
const { pool } = require("../db");
const { asyncHandler } = require("../asyncHandler");
const { tokenFromRequest, fetchMyGroups } = require("../groupsClient");

const router = express.Router();

async function soleGroupIds(req) {
  const groups = await fetchMyGroups(tokenFromRequest(req));
  return groups.filter((g) => g.memberCount <= 1).map((g) => g.id);
}

async function inTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await fn(client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

router.get("/export", asyncHandler(async (req, res) => {
  const id = req.user.id;
  const [expenses, budgets, groupExpenses, shares] = await Promise.all([
    pool.query("SELECT * FROM expenses WHERE user_id = $1 ORDER BY date", [id]),
    pool.query("SELECT * FROM budgets WHERE user_id = $1 ORDER BY category", [id]),
    pool.query("SELECT * FROM group_expenses WHERE paid_by = $1 OR created_by = $1 ORDER BY group_id, date", [id]),
    pool.query("SELECT * FROM group_expense_shares WHERE user_id = $1", [id]),
  ]);
  res.json({
    gastos: expenses.rows,
    presupuestos: budgets.rows,
    gastosDeGrupoPagadosOCreados: groupExpenses.rows,
    tuParteEnGastosDeGrupo: shares.rows,
  });
}));

// Los gastos de grupos que siguen activos NO se borran: son las cuentas de
// los demas miembros (quien pago que y cuanto le toca a cada uno). Se quedan
// con el identificador de la persona, que tras borrar su cuenta en
// lista-compra-api y Keycloak ya no corresponde a nadie (sin nombre ni email).
router.delete("/", asyncHandler(async (req, res) => {
  const id = req.user.id;
  const solo = await soleGroupIds(req);
  await inTransaction(async (c) => {
    await c.query("DELETE FROM expenses WHERE user_id = $1", [id]);
    await c.query("DELETE FROM budgets WHERE user_id = $1", [id]);
    await c.query("DELETE FROM monthly_summary_sent WHERE user_id = $1", [id]);
    await c.query("DELETE FROM group_expenses WHERE group_id = ANY($1::uuid[])", [solo]);
    await c.query("DELETE FROM group_budgets WHERE group_id = ANY($1::uuid[])", [solo]);
  });
  res.json({ ok: true });
}));

module.exports = router;
