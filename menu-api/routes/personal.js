const express = require("express");
const { pool } = require("../db");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

const SLOTS = ["comida", "cena"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function serialize(row) {
  return { id: row.id, date: row.date, slot: row.slot, title: row.title, ingredients: row.ingredients || [] };
}

// ?start=YYYY-MM-DD&end=YYYY-MM-DD (ambos incluidos) -- primer endpoint
// del hub con rango de fechas real, pensado para la vista semanal del
// cliente. Sin rango, devuelve todo (poco frecuente, pero evita un 400
// si algun cliente futuro no lo manda).
router.get("/meals", asyncHandler(async (req, res) => {
  const { start, end } = req.query;
  let query = "SELECT id, date, slot, title FROM meals WHERE user_id = $1";
  const params = [req.user.id];
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

router.put("/meals/:date/:slot", asyncHandler(async (req, res) => {
  const { date, slot } = req.params;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: "Fecha invalida (usa YYYY-MM-DD)." });
  if (!SLOTS.includes(slot)) return res.status(400).json({ error: "Franja invalida." });
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "Falta el nombre del plato." });
  // null = "no se han tocado los ingredientes" (permite guardar solo el
  // titulo sin borrar los que ya hubiera); array = reemplazo explicito.
  const ingredients = Array.isArray(req.body?.ingredients)
    ? req.body.ingredients.map((i) => String(i).trim()).filter(Boolean)
    : null;

  const upserted = await pool.query(
    `INSERT INTO meals (user_id, date, slot, title, ingredients, updated_at)
     VALUES ($1, $2, $3, $4, COALESCE($5::text[], '{}'), now())
     ON CONFLICT (user_id, date, slot) DO UPDATE SET
       title = EXCLUDED.title,
       ingredients = CASE WHEN $5::text[] IS NULL THEN meals.ingredients ELSE EXCLUDED.ingredients END,
       updated_at = now()
     RETURNING id, date, slot, title, ingredients`,
    [req.user.id, date, slot, title, ingredients]
  );
  res.json(serialize(upserted.rows[0]));
}));

router.delete("/meals/:date/:slot", asyncHandler(async (req, res) => {
  const { date, slot } = req.params;
  await pool.query("DELETE FROM meals WHERE user_id = $1 AND date = $2 AND slot = $3", [
    req.user.id,
    date,
    slot,
  ]);
  res.json({ ok: true });
}));

module.exports = router;
