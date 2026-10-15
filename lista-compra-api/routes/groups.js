const crypto = require("crypto");
const express = require("express");
const { pool, upsertUser } = require("../db");
const { broadcast } = require("../ws");
const { asyncHandler } = require("../asyncHandler");
const { sendPushToUser, sendPushToUsers } = require("../push");
const { cleanSections, resolveSection, saveSections } = require("../sections");

const router = express.Router();

const requireMembership = asyncHandler(async (req, res, next) => {
  const r = await pool.query("SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2", [
    req.params.id,
    req.user.id,
  ]);
  if (r.rowCount === 0) return res.status(404).json({ error: "Grupo no encontrado." });
  req.membership = r.rows[0];
  next();
});

router.get("/", asyncHandler(async (req, res) => {
  await upsertUser(req.user);
  const groups = await pool.query(
    `SELECT g.id, g.name, g.owner_id, l.id AS list_id,
            (SELECT count(*) FROM group_members gm2 WHERE gm2.group_id = g.id) AS member_count
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
     JOIN lists l ON l.group_id = g.id
     ORDER BY g.created_at`,
    [req.user.id]
  );
  res.json({
    groups: groups.rows.map((g) => ({
      id: g.id,
      name: g.name,
      ownerId: g.owner_id,
      listId: g.list_id,
      memberCount: Number(g.member_count),
      isOwner: g.owner_id === req.user.id,
    })),
  });
}));

router.post("/", asyncHandler(async (req, res) => {
  await upsertUser(req.user);
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "Falta el nombre del grupo." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const group = await client.query(
      "INSERT INTO groups (name, owner_id) VALUES ($1, $2) RETURNING id",
      [name, req.user.id]
    );
    const groupId = group.rows[0].id;
    await client.query(
      "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'owner')",
      [groupId, req.user.id]
    );
    const list = await client.query(
      "INSERT INTO lists (group_id, name) VALUES ($1, 'Lista compartida') RETURNING id",
      [groupId]
    );
    await client.query("COMMIT");
    res.status(201).json({ id: groupId, name, listId: list.rows[0].id, isOwner: true, memberCount: 1 });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

router.get("/:id/members", requireMembership, asyncHandler(async (req, res) => {
  const members = await pool.query(
    `SELECT u.id, u.username, u.first_name, u.last_name, gm.role
     FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1 ORDER BY gm.role, u.username`,
    [req.params.id]
  );
  res.json({
    members: members.rows.map((m) => ({
      id: m.id,
      username: m.username,
      firstName: m.first_name,
      lastName: m.last_name,
      role: m.role,
    })),
  });
}));

// Solo se puede anadir gente que ya es amiga tuya: evita que cualquiera
// meta a desconocidos en un grupo con una lista compartida.
router.post("/:id/members", requireMembership, asyncHandler(async (req, res) => {
  if (req.membership.role !== "owner") return res.status(403).json({ error: "Solo el creador del grupo puede añadir miembros." });

  const username = String(req.body?.username || "").trim();
  if (!username) return res.status(400).json({ error: "Falta el nombre de usuario." });

  const target = await pool.query("SELECT * FROM users WHERE lower(username) = lower($1)", [username]);
  if (target.rowCount === 0) return res.status(404).json({ error: "Ese usuario no existe." });
  const targetUser = target.rows[0];

  const friendship = await pool.query(
    `SELECT 1 FROM friendships
     WHERE status = 'accepted'
       AND LEAST(requester_id, addressee_id) = LEAST($1::uuid, $2::uuid)
       AND GREATEST(requester_id, addressee_id) = GREATEST($1::uuid, $2::uuid)`,
    [req.user.id, targetUser.id]
  );
  if (friendship.rowCount === 0) {
    return res.status(400).json({ error: "Solo puedes añadir a amigos aceptados." });
  }

  await pool.query(
    "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
    [req.params.id, targetUser.id]
  );
  const group = await pool.query("SELECT name FROM groups WHERE id = $1", [req.params.id]);
  sendPushToUser(targetUser.id, {
    title: group.rows[0]?.name || "Nuevo grupo",
    body: `@${req.user.username} te ha añadido al grupo.`,
    url: "/perfil/",
  }).catch(() => {});
  res.status(201).json({ ok: true });
}));

// Enlace de invitacion (ver routes/invites.js para el lado de quien lo
// recibe). Solo el creador del grupo lo ve, lo genera o lo desactiva: es
// el mismo permiso que "añadir miembro", pero sin exigir amistad previa.
const INVITE_DAYS = 7;

function inviteJson(row) {
  return row ? { token: row.token, expiresAt: row.expires_at } : null;
}

router.get("/:id/invite", requireMembership, asyncHandler(async (req, res) => {
  if (req.membership.role !== "owner") return res.status(403).json({ error: "Solo el creador del grupo puede invitar." });
  const r = await pool.query("SELECT token, expires_at FROM group_invites WHERE group_id = $1 AND expires_at > now()", [
    req.params.id,
  ]);
  res.json({ invite: inviteJson(r.rows[0]) });
}));

// Crea el enlace o lo sustituye por uno nuevo (el anterior deja de valer):
// asi "regenerar" es la forma de cortar un enlace que ha circulado de mas.
router.post("/:id/invite", requireMembership, asyncHandler(async (req, res) => {
  if (req.membership.role !== "owner") return res.status(403).json({ error: "Solo el creador del grupo puede invitar." });
  const token = crypto.randomBytes(18).toString("base64url");
  const r = await pool.query(
    `INSERT INTO group_invites (group_id, token, created_by, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))
     ON CONFLICT (group_id) DO UPDATE
       SET token = EXCLUDED.token, created_by = EXCLUDED.created_by,
           created_at = now(), expires_at = EXCLUDED.expires_at
     RETURNING token, expires_at`,
    [req.params.id, token, req.user.id, INVITE_DAYS]
  );
  res.status(201).json({ invite: inviteJson(r.rows[0]) });
}));

router.delete("/:id/invite", requireMembership, asyncHandler(async (req, res) => {
  if (req.membership.role !== "owner") return res.status(403).json({ error: "Solo el creador del grupo puede invitar." });
  await pool.query("DELETE FROM group_invites WHERE group_id = $1", [req.params.id]);
  res.json({ ok: true });
}));

// El propietario elimina el grupo entero al salir (no hay transferencia de
// propiedad); un miembro normal simplemente se va.
router.delete("/:id/members/:userId", requireMembership, asyncHandler(async (req, res) => {
  const targetId = req.params.userId;
  const isSelf = targetId === req.user.id;
  if (!isSelf && req.membership.role !== "owner") {
    return res.status(403).json({ error: "Solo el creador del grupo puede eliminar miembros." });
  }

  const groupRow = await pool.query("SELECT owner_id FROM groups WHERE id = $1", [req.params.id]);
  if (groupRow.rows[0]?.owner_id === targetId) {
    await pool.query("DELETE FROM groups WHERE id = $1", [req.params.id]);
    broadcast(req.params.id, { type: "group_deleted", groupId: req.params.id });
    return res.json({ ok: true, groupDeleted: true });
  }

  await pool.query("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", [
    req.params.id,
    targetId,
  ]);
  res.json({ ok: true });
}));

router.get("/:id/list", requireMembership, asyncHandler(async (req, res) => {
  const list = await pool.query("SELECT id, name, sections FROM lists WHERE group_id = $1", [req.params.id]);
  const items = await pool.query(
    "SELECT id, name, qty, category, section, done, recurring, position FROM list_items WHERE list_id = $1 ORDER BY position, name",
    [list.rows[0].id]
  );
  res.json({ listId: list.rows[0].id, name: list.rows[0].name, sections: list.rows[0].sections, items: items.rows });
}));

// Secciones de la lista del grupo (ver saveSections en sections.js). Las
// puede tocar cualquier miembro, igual que los productos.
router.put("/:id/list/sections", requireMembership, asyncHandler(async (req, res) => {
  const sections = cleanSections(req.body?.sections);
  if (!sections) return res.status(400).json({ error: "Falta «sections»." });
  const list = await pool.query("SELECT id FROM lists WHERE group_id = $1", [req.params.id]);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await saveSections(client, { table: "lists", itemTable: "list_items", listId: list.rows[0].id, sections, rename: req.body?.rename });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  // Renombrar/borrar mueve productos: los demas miembros recargan la lista.
  broadcast(req.params.id, { type: "list_reload", groupId: req.params.id });
  res.json({ sections });
}));

// Si al añadir/cambiar un producto se ha creado una seccion nueva (ver
// resolveSection), los demas miembros tienen que enterarse.
async function broadcastSections(groupId, listId) {
  const r = await pool.query("SELECT sections FROM lists WHERE id = $1", [listId]);
  broadcast(groupId, { type: "sections_updated", groupId, sections: r.rows[0]?.sections || [] });
}

router.post("/:id/list/items", requireMembership, asyncHandler(async (req, res) => {
  const { name, qty, category, recurring } = req.body || {};
  if (!String(name || "").trim()) return res.status(400).json({ error: "Falta el nombre del producto." });

  const list = await pool.query("SELECT id, sections FROM lists WHERE group_id = $1", [req.params.id]);
  const section = await resolveSection(pool, "lists", list.rows[0].id, req.body?.section);
  const inserted = await pool.query(
    `INSERT INTO list_items (list_id, name, qty, category, recurring, section, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, qty, category, section, done, recurring, position`,
    [list.rows[0].id, String(name).trim(), qty || null, category || "otros", !!recurring, section || "", req.user.id]
  );
  const item = inserted.rows[0];
  if (section && !list.rows[0].sections.includes(section)) await broadcastSections(req.params.id, list.rows[0].id);
  broadcast(req.params.id, { type: "item_added", groupId: req.params.id, item });
  logActivity(req.params.id, req.user, `añadió «${item.name}» a la lista`).catch(() => {});
  res.status(201).json(item);
}));

router.patch("/:id/list/items/:itemId", requireMembership, asyncHandler(async (req, res) => {
  const { name, qty, done, category, recurring } = req.body || {};
  const list = await pool.query("SELECT id, sections FROM lists WHERE group_id = $1", [req.params.id]);
  const section = await resolveSection(pool, "lists", list.rows[0].id, req.body?.section);
  const updated = await pool.query(
    `UPDATE list_items SET
       name = COALESCE($3, name),
       qty = COALESCE($4, qty),
       category = COALESCE($5, category),
       done = COALESCE($6, done),
       recurring = COALESCE($7, recurring),
       section = COALESCE($8, section),
       updated_at = now()
     WHERE id = $1 AND list_id = $2
     RETURNING id, name, qty, category, section, done, recurring, position`,
    [req.params.itemId, list.rows[0].id, name ?? null, qty ?? null, category ?? null, done ?? null, recurring ?? null, section]
  );
  if (updated.rowCount === 0) return res.status(404).json({ error: "Producto no encontrado." });
  if (section && !list.rows[0].sections.includes(section)) await broadcastSections(req.params.id, list.rows[0].id);
  const item = updated.rows[0];
  broadcast(req.params.id, { type: "item_updated", groupId: req.params.id, item });
  if (done === true) logActivity(req.params.id, req.user, `marcó «${item.name}» como comprado`).catch(() => {});
  res.json(item);
}));

// Los productos "recurrentes" (fijos de la lista, p.ej. leche) no se
// borran al vaciar los comprados: se desmarcan y se quedan para la
// proxima compra. Los demas comprados se borran como siempre.
router.delete("/:id/list/items/done", requireMembership, asyncHandler(async (req, res) => {
  const list = await pool.query("SELECT id FROM lists WHERE group_id = $1", [req.params.id]);
  const deleted = await pool.query(
    "DELETE FROM list_items WHERE list_id = $1 AND done = true AND recurring = false RETURNING id",
    [list.rows[0].id]
  );
  const reset = await pool.query(
    `UPDATE list_items SET done = false, updated_at = now()
     WHERE list_id = $1 AND done = true AND recurring = true
     RETURNING id, name, qty, category, section, done, recurring, position`,
    [list.rows[0].id]
  );
  broadcast(req.params.id, { type: "items_deleted", groupId: req.params.id, ids: deleted.rows.map((r) => r.id) });
  if (reset.rowCount) {
    broadcast(req.params.id, { type: "items_reset", groupId: req.params.id, items: reset.rows });
  }
  res.json({ ok: true, deleted: deleted.rowCount, reset: reset.rowCount });
}));

router.delete("/:id/list/items/:itemId", requireMembership, asyncHandler(async (req, res) => {
  const list = await pool.query("SELECT id FROM lists WHERE group_id = $1", [req.params.id]);
  const deleted = await pool.query("DELETE FROM list_items WHERE id = $1 AND list_id = $2 RETURNING id", [
    req.params.itemId,
    list.rows[0].id,
  ]);
  if (deleted.rowCount === 0) return res.status(404).json({ error: "Producto no encontrado." });
  broadcast(req.params.id, { type: "item_deleted", groupId: req.params.id, id: req.params.itemId });
  res.json({ ok: true });
}));

// Registro de actividad del grupo, comun a todo el hub -- ver comentario
// de la tabla group_activity en db.js. Cualquier servicio del hub llama
// aqui (con el token de la persona que hizo la accion, no uno propio del
// servicio) para dejar constancia; lista-compra-api usa este mismo
// helper para sus propias acciones (item añadido/comprado, mas arriba).
// Cada linea de actividad tambien dispara un push a los DEMAS miembros del
// grupo (nunca al propio actor) -- una sola integracion aqui cubre todos
// los eventos de todas las apps, sin tener que enganchar push en cada una.
async function logActivity(groupId, user, message) {
  await upsertUser(user);
  await pool.query(
    "INSERT INTO group_activity (group_id, actor_id, actor_username, message) VALUES ($1, $2, $3, $4)",
    [groupId, user.id, user.username, message]
  );

  const group = await pool.query("SELECT name FROM groups WHERE id = $1", [groupId]);
  const members = await pool.query("SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2", [
    groupId,
    user.id,
  ]);
  if (members.rowCount) {
    sendPushToUsers(members.rows.map((m) => m.user_id), {
      title: group.rows[0]?.name || "Actividad de grupo",
      body: `@${user.username} ${message}`,
      url: "/perfil/",
    }).catch(() => {});
  }
}

router.post("/:id/activity", requireMembership, asyncHandler(async (req, res) => {
  const message = String(req.body?.message || "").trim();
  if (!message) return res.status(400).json({ error: "Falta el mensaje de actividad." });
  await logActivity(req.params.id, req.user, message);
  res.status(201).json({ ok: true });
}));

router.get("/:id/activity", requireMembership, asyncHandler(async (req, res) => {
  const rows = await pool.query(
    `SELECT actor_id, actor_username, message, created_at FROM group_activity
     WHERE group_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json({
    activity: rows.rows.map((r) => ({
      actorId: r.actor_id,
      actorUsername: r.actor_username,
      message: r.message,
      createdAt: r.created_at,
    })),
  });
}));

module.exports = router;
module.exports.logActivity = logActivity;
