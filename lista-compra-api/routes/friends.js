const express = require("express");
const { pool, upsertUser } = require("../db");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

function publicUser(row) {
  return { id: row.id, username: row.username, firstName: row.first_name, lastName: row.last_name };
}

router.get("/", asyncHandler(async (req, res) => {
  await upsertUser(req.user);
  const me = req.user.id;

  const accepted = await pool.query(
    `SELECT u.id, u.username, u.first_name, u.last_name, f.id AS friendship_id
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted' AND $1 IN (f.requester_id, f.addressee_id)
     ORDER BY u.username`,
    [me]
  );

  const incoming = await pool.query(
    `SELECT f.id, u.id AS user_id, u.username, u.first_name, u.last_name, f.created_at
     FROM friendships f JOIN users u ON u.id = f.requester_id
     WHERE f.status = 'pending' AND f.addressee_id = $1
     ORDER BY f.created_at DESC`,
    [me]
  );

  const outgoing = await pool.query(
    `SELECT f.id, u.id AS user_id, u.username, u.first_name, u.last_name, f.created_at
     FROM friendships f JOIN users u ON u.id = f.addressee_id
     WHERE f.status = 'pending' AND f.requester_id = $1
     ORDER BY f.created_at DESC`,
    [me]
  );

  res.json({
    friends: accepted.rows.map((r) => ({
      friendshipId: r.friendship_id,
      id: r.id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
    })),
    incoming: incoming.rows.map((r) => ({
      requestId: r.id,
      id: r.user_id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
    })),
    outgoing: outgoing.rows.map((r) => ({
      requestId: r.id,
      id: r.user_id,
      username: r.username,
      firstName: r.first_name,
      lastName: r.last_name,
    })),
  });
}));

router.post("/requests", asyncHandler(async (req, res) => {
  await upsertUser(req.user);
  const username = String(req.body?.username || "").trim();
  if (!username) return res.status(400).json({ error: "Falta el nombre de usuario." });
  if (username.toLowerCase() === req.user.username.toLowerCase()) {
    return res.status(400).json({ error: "No puedes agregarte a ti mismo." });
  }

  const target = await pool.query("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
  if (target.rowCount === 0) {
    return res
      .status(404)
      .json({ error: "Ese usuario no existe o todavía no ha entrado nunca en la app." });
  }
  const targetUser = target.rows[0];

  const existing = await pool.query(
    `SELECT * FROM friendships
     WHERE LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid)
       AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)`,
    [req.user.id, targetUser.id]
  );
  if (existing.rowCount > 0) {
    const status = existing.rows[0].status;
    return res.status(409).json({ error: status === "accepted" ? "Ya sois amigos." : "Ya hay una solicitud pendiente." });
  }

  const inserted = await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
    [req.user.id, targetUser.id]
  );
  res.status(201).json({ requestId: inserted.rows[0].id, user: publicUser(targetUser) });
}));

router.post("/:id/accept", asyncHandler(async (req, res) => {
  const result = await pool.query(
    `UPDATE friendships SET status = 'accepted', responded_at = now()
     WHERE id = $1 AND addressee_id = $2 AND status = 'pending'
     RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "Solicitud no encontrada." });
  res.json({ ok: true });
}));

// Cubre tres casos con el mismo endpoint: rechazar una solicitud entrante,
// cancelar una que enviaste tu, o eliminar una amistad ya aceptada.
router.delete("/:id", asyncHandler(async (req, res) => {
  const result = await pool.query(
    `DELETE FROM friendships WHERE id = $1 AND $2 IN (requester_id, addressee_id) RETURNING id`,
    [req.params.id, req.user.id]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: "No encontrado." });
  res.json({ ok: true });
}));

module.exports = router;
