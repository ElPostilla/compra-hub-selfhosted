const express = require("express");
const { pool, expandRecurring } = require("../db");
const { broadcast } = require("../ws");
const { asyncHandler } = require("../asyncHandler");
const { validateNoteBody, noteValues, toEntry } = require("../notes-common");
const { tokenFromRequest, fetchMyGroups, isGroupMember, postActivity } = require("../groupsClient");

const router = express.Router();


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

router.get("/:id/notes", requireMembership, asyncHandler(async (req, res) => {
  const r = await pool.query(
    "SELECT id, date, note, importance, recurrence, time, remind_minutes FROM group_notes WHERE group_id = $1",
    [req.params.id]
  );
  res.json({ notes: expandRecurring(r.rows) });
}));


// Crea un recordatorio nuevo en el calendario de grupo -- varios pueden
// convivir en la misma fecha (ver db.js/migrateNoteId).
router.post("/:id/notes", requireMembership, asyncHandler(async (req, res) => {
  const { date } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return res.status(400).json({ error: "Fecha invalida (usa YYYY-MM-DD)." });
  const err = validateNoteBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const v = noteValues(req.body);
  const r = await pool.query(
    `INSERT INTO group_notes (group_id, date, note, importance, recurrence, time, remind_minutes, created_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
    [req.params.id, date, v.note, v.importance, v.recurrence, v.time, v.remindMinutes, req.user.id]
  );
  const entry = toEntry(r.rows[0].id, v);
  broadcast(req.params.id, { type: "note_upserted", groupId: req.params.id, date, entry });
  postActivity(tokenFromRequest(req), req.params.id, `escribió una nota en el calendario (${date})`).catch(() => {});
  res.json({ ok: true, date, entry });
}));

// Edita un recordatorio existente por id (la fecha no cambia).
router.put("/:id/notes/:noteId", requireMembership, asyncHandler(async (req, res) => {
  const err = validateNoteBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const v = noteValues(req.body);
  const r = await pool.query(
    `UPDATE group_notes SET note = $1, importance = $2, recurrence = $3, time = $4, remind_minutes = $5, updated_at = now()
     WHERE id = $6 AND group_id = $7 RETURNING date`,
    [v.note, v.importance, v.recurrence, v.time, v.remindMinutes, req.params.noteId, req.params.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Recordatorio no encontrado." });
  const date = r.rows[0].date;
  const entry = toEntry(req.params.noteId, v);
  broadcast(req.params.id, { type: "note_upserted", groupId: req.params.id, date, entry });
  res.json({ ok: true, date, entry });
}));

// Solo borra una fila real -- ver el mismo comentario en routes/personal.js.
router.delete("/:id/notes/:noteId", requireMembership, asyncHandler(async (req, res) => {
  const deleted = await pool.query("DELETE FROM group_notes WHERE id = $1 AND group_id = $2 RETURNING date", [
    req.params.noteId,
    req.params.id,
  ]);
  if (deleted.rowCount > 0) {
    broadcast(req.params.id, { type: "note_deleted", groupId: req.params.id, date: deleted.rows[0].date, id: req.params.noteId });
  }
  res.json({ ok: true, deleted: deleted.rowCount > 0 });
}));

module.exports = router;
