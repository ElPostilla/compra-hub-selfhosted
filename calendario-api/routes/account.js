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
const { revokeGoogle } = require("./personal");

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
  const [notes, groupNotes, google] = await Promise.all([
    pool.query("SELECT * FROM notes WHERE user_id = $1 ORDER BY date", [id]),
    pool.query("SELECT * FROM group_notes WHERE created_by = $1 ORDER BY group_id, date", [id]),
    pool.query("SELECT updated_at FROM google_tokens WHERE user_id = $1", [id]),
  ]);
  res.json({
    notas: notes.rows,
    notasCreadasEnGrupos: groupNotes.rows,
    // Los tokens de Google no se exportan (son credenciales), solo el hecho.
    googleCalendarConectado: google.rows.length > 0,
  });
}));

router.delete("/", asyncHandler(async (req, res) => {
  const id = req.user.id;
  const solo = await soleGroupIds(req);
  await revokeGoogle(id);
  await inTransaction(async (c) => {
    await c.query(
      "DELETE FROM note_reminders_sent WHERE kind = 'personal' AND note_id IN (SELECT id FROM notes WHERE user_id = $1)",
      [id]
    );
    await c.query("DELETE FROM notes WHERE user_id = $1", [id]);
    await c.query("DELETE FROM event_reminders_sent WHERE user_id = $1", [id]);
    await c.query("DELETE FROM google_tokens WHERE user_id = $1", [id]);
    await c.query(
      "DELETE FROM note_reminders_sent WHERE kind = 'group' AND note_id IN (SELECT id FROM group_notes WHERE group_id = ANY($1::uuid[]))",
      [solo]
    );
    await c.query("DELETE FROM group_notes WHERE group_id = ANY($1::uuid[])", [solo]);
    await c.query("UPDATE group_notes SET created_by = NULL WHERE created_by = $1", [id]);
  });
  res.json({ ok: true });
}));

module.exports = router;
