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
  const [meals, groupMeals] = await Promise.all([
    pool.query("SELECT * FROM meals WHERE user_id = $1 ORDER BY date, slot", [id]),
    pool.query("SELECT * FROM group_meals WHERE created_by = $1 ORDER BY group_id, date, slot", [id]),
  ]);
  res.json({ menu: meals.rows, menuCreadoEnGrupos: groupMeals.rows });
}));

router.delete("/", asyncHandler(async (req, res) => {
  const id = req.user.id;
  const solo = await soleGroupIds(req);
  await inTransaction(async (c) => {
    await c.query("DELETE FROM meals WHERE user_id = $1", [id]);
    await c.query("DELETE FROM group_meals WHERE group_id = ANY($1::uuid[])", [solo]);
    await c.query("UPDATE group_meals SET created_by = NULL WHERE created_by = $1", [id]);
  });
  res.json({ ok: true });
}));

module.exports = router;
