const express = require("express");
const { pool } = require("../db");
const { broadcast } = require("../ws");
const { asyncHandler } = require("../asyncHandler");
const { tokenFromRequest, fetchMyGroups, isGroupMember, postActivity } = require("../groupsClient");

const router = express.Router();

const SLOTS = ["comida", "cena"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function serialize(row) {
  return { id: row.id, date: row.date, slot: row.slot, title: row.title, ingredients: row.ingredients || [] };
}

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

router.get("/:id/meals", requireMembership, asyncHandler(async (req, res) => {
  const { start, end } = req.query;
  let query = "SELECT id, date, slot, title FROM group_meals WHERE group_id = $1";
  const params = [req.params.id];
  if (start && DATE_RE.test(start)) {
    params.push(start);
    query += ` AND date >= $${params.length}`;
  }
  if (end && DATE_RE.test(end)) {
    params.push(end);
    query += ` AND date <= $${params.length}`;
  }
  const r = await pool.query(query + " ORDER BY date, slot", params);
  res.json({ meals: r.rows.map(serialize) });
}));

router.put("/:id/meals/:date/:slot", requireMembership, asyncHandler(async (req, res) => {
  const { date, slot } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: "Fecha invalida (usa YYYY-MM-DD)." });
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: "Franja invalida." });
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "Falta el nombre del plato." });
  const ingredients = Array.isArray(req.body?.ingredients)
    ? req.body.ingredients.map((i) => String(i).trim()).filter(Boolean)
    : null;

  const upserted = await pool.query(
    `INSERT INTO group_meals (group_id, date, slot, title, ingredients, created_by, updated_at)
     VALUES ($1, $2, $3, $4, COALESCE($5::text[], '{}'), $6, now())
     ON CONFLICT (group_id, date, slot) DO UPDATE SET
       title = EXCLUDED.title,
       ingredients = CASE WHEN $5::text[] IS NULL THEN group_meals.ingredients ELSE EXCLUDED.ingredients END,
       updated_at = now()
     RETURNING id, date, slot, title, ingredients`,
    [req.params.id, date, slot, title, ingredients, req.user.id]
  );
  const meal = serialize(upserted.rows[0]);
  broadcast(req.params.id, { type: "meal_upserted", groupId: req.params.id, meal });
  postActivity(tokenFromRequest(req), req.params.id, `planificó «${title}» para la ${slot} del ${date}`).catch(() => {});
  res.json(meal);
}));

router.delete("/:id/meals/:date/:slot", requireMembership, asyncHandler(async (req, res) => {
  const { date, slot } = req.params;
  await pool.query("DELETE FROM group_meals WHERE group_id = $1 AND date = $2 AND slot = $3", [
    req.params.id,
    date,
    slot,
  ]);
  broadcast(req.params.id, { type: "meal_deleted", groupId: req.params.id, date, slot });
  res.json({ ok: true });
}));

module.exports = router;
