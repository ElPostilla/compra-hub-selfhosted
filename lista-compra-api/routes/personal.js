const express = require("express");
const { pool, upsertUser } = require("../db");
const { broadcastToUser } = require("../ws");
const { asyncHandler } = require("../asyncHandler");
const { cleanSections, resolveSection, saveSections } = require("../sections");

// Listas de la compra personales, guardadas en el servidor (antes solo en
// el localStorage del navegador). La semantica replica la que tenia el
// cliente en list-state.service.ts (addItemLocal, clearDoneLocal...), para
// que la app se comporte igual; la diferencia es que ahora las ve cualquier
// dispositivo del usuario y el asistente (hub-mcp).
//
// Tras cada cambio se avisa por WebSocket a los demas dispositivos del
// mismo usuario ("personal_changed", canal por usuario en ws.js) y estos
// vuelven a pedir sus listas: mas simple que replicar cada operacion y el
// volumen (una persona, un punado de listas) no lo justifica.
const router = express.Router();

const ITEM_COLS = "id, name, qty, category, section, done, recurring, position";

function changed(req) {
  broadcastToUser(req.user.id, { type: "personal_changed" });
}

async function listsWithItems(userId, client = pool) {
  const lists = await client.query(
    "SELECT id, name, sections FROM personal_lists WHERE user_id = $1 ORDER BY position, created_at",
    [userId]
  );
  if (!lists.rowCount) return [];
  const items = await client.query(
    `SELECT list_id, ${ITEM_COLS} FROM personal_list_items
     WHERE list_id = ANY($1::uuid[]) ORDER BY position, updated_at`,
    [lists.rows.map((l) => l.id)]
  );
  return lists.rows.map((l) => ({
    id: l.id,
    name: l.name,
    sections: l.sections,
    items: items.rows.filter((i) => i.list_id === l.id).map(({ list_id, ...i }) => i),
  }));
}

// Solo listas del propio usuario: un id ajeno responde 404, igual que uno
// inexistente (no se revela si existe).
const requireOwnList = asyncHandler(async (req, res, next) => {
  const r = await pool.query("SELECT id FROM personal_lists WHERE id = $1 AND user_id = $2", [
    req.params.listId,
    req.user.id,
  ]);
  if (!r.rowCount) return res.status(404).json({ error: "Lista no encontrada." });
  next();
});

function cleanName(value) {
  return String(value || "").trim().slice(0, 200);
}

// "2" + "1" -> "3" (como hacia el cliente); si alguna no es un numero
// ("2 L"), se queda la nueva si la hay.
function mergeQty(existing, added) {
  const a = Number(existing);
  const b = Number(added);
  if (existing != null && added != null && Number.isFinite(a) && Number.isFinite(b) && String(existing).trim() !== "" && String(added).trim() !== "") {
    return String(a + b);
  }
  return added ?? existing ?? null;
}

router.get("/lists", asyncHandler(async (req, res) => {
  await upsertUser(req.user);
  res.json({ lists: await listsWithItems(req.user.id) });
}));

router.post("/lists", asyncHandler(async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: "Falta el nombre de la lista." });
  await upsertUser(req.user);
  const r = await pool.query(
    `INSERT INTO personal_lists (user_id, name, position)
     VALUES ($1, $2, (SELECT COALESCE(MAX(position) + 1, 0) FROM personal_lists WHERE user_id = $1))
     RETURNING id, name, sections`,
    [req.user.id, name]
  );
  changed(req);
  res.status(201).json({ ...r.rows[0], items: [] });
}));

router.patch("/lists/:listId", requireOwnList, asyncHandler(async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: "Falta el nombre de la lista." });
  const r = await pool.query("UPDATE personal_lists SET name = $2 WHERE id = $1 RETURNING id, name", [
    req.params.listId,
    name,
  ]);
  changed(req);
  res.json(r.rows[0]);
}));

// Sustituye las secciones de la lista (añadir, quitar, reordenar o
// renombrar con {rename: {from, to}}); ver saveSections en sections.js.
router.put("/lists/:listId/sections", requireOwnList, asyncHandler(async (req, res) => {
  const sections = cleanSections(req.body?.sections);
  if (!sections) return res.status(400).json({ error: "Falta «sections»." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await saveSections(client, {
      table: "personal_lists",
      itemTable: "personal_list_items",
      listId: req.params.listId,
      sections,
      rename: req.body?.rename,
    });
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  changed(req);
  const list = (await listsWithItems(req.user.id)).find((l) => l.id === req.params.listId);
  res.json(list);
}));

// Siempre queda al menos una lista, igual que en el cliente (deleteList).
router.delete("/lists/:listId", requireOwnList, asyncHandler(async (req, res) => {
  const count = await pool.query("SELECT count(*)::int AS n FROM personal_lists WHERE user_id = $1", [req.user.id]);
  if (count.rows[0].n <= 1) return res.status(400).json({ error: "No se puede borrar la única lista." });
  await pool.query("DELETE FROM personal_lists WHERE id = $1", [req.params.listId]);
  changed(req);
  res.json({ ok: true });
}));

// Si ya hay un producto con el mismo nombre (sin distinguir mayusculas) se
// suma la cantidad y vuelve a pendiente, en vez de duplicarlo.
router.post("/lists/:listId/items", requireOwnList, asyncHandler(async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: "Falta el nombre del producto." });
  const { qty, category, recurring } = req.body || {};
  const section = await resolveSection(pool, "personal_lists", req.params.listId, req.body?.section);

  const existing = await pool.query(
    `SELECT ${ITEM_COLS} FROM personal_list_items WHERE list_id = $1 AND lower(name) = lower($2) LIMIT 1`,
    [req.params.listId, name]
  );
  let item;
  if (existing.rowCount) {
    const prev = existing.rows[0];
    const r = await pool.query(
      `UPDATE personal_list_items SET qty = $2, done = false, section = COALESCE($3, section), updated_at = now()
       WHERE id = $1 RETURNING ${ITEM_COLS}`,
      [prev.id, mergeQty(prev.qty, qty ?? null), section || null]
    );
    item = r.rows[0];
  } else {
    const r = await pool.query(
      `INSERT INTO personal_list_items (list_id, name, qty, category, recurring, section, position)
       VALUES ($1, $2, $3, $4, $5, $6,
               (SELECT COALESCE(MAX(position) + 1, 0) FROM personal_list_items WHERE list_id = $1))
       RETURNING ${ITEM_COLS}`,
      [req.params.listId, name, qty ?? null, category || "otros", !!recurring, section || ""]
    );
    item = r.rows[0];
  }
  changed(req);
  res.status(existing.rowCount ? 200 : 201).json(item);
}));

// Antes que "/:itemId" para que "done" no se interprete como id.
router.delete("/lists/:listId/items/done", requireOwnList, asyncHandler(async (req, res) => {
  const deleted = await pool.query(
    "DELETE FROM personal_list_items WHERE list_id = $1 AND done = true AND recurring = false RETURNING id",
    [req.params.listId]
  );
  const reset = await pool.query(
    `UPDATE personal_list_items SET done = false, updated_at = now()
     WHERE list_id = $1 AND done = true AND recurring = true RETURNING id`,
    [req.params.listId]
  );
  changed(req);
  res.json({ ok: true, deleted: deleted.rowCount, reset: reset.rowCount });
}));

router.delete("/lists/:listId/items", requireOwnList, asyncHandler(async (req, res) => {
  const deleted = await pool.query("DELETE FROM personal_list_items WHERE list_id = $1", [req.params.listId]);
  changed(req);
  res.json({ ok: true, deleted: deleted.rowCount });
}));

router.patch("/lists/:listId/items/:itemId", requireOwnList, asyncHandler(async (req, res) => {
  const { name, qty, done, category, recurring } = req.body || {};
  const section = await resolveSection(pool, "personal_lists", req.params.listId, req.body?.section);
  const r = await pool.query(
    `UPDATE personal_list_items SET
       name = COALESCE($3, name),
       qty = COALESCE($4, qty),
       category = COALESCE($5, category),
       done = COALESCE($6, done),
       recurring = COALESCE($7, recurring),
       section = COALESCE($8, section),
       updated_at = now()
     WHERE id = $1 AND list_id = $2
     RETURNING ${ITEM_COLS}`,
    [req.params.itemId, req.params.listId, name != null ? cleanName(name) : null, qty ?? null, category ?? null, done ?? null, recurring ?? null, section]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Producto no encontrado." });
  changed(req);
  res.json(r.rows[0]);
}));

router.delete("/lists/:listId/items/:itemId", requireOwnList, asyncHandler(async (req, res) => {
  const r = await pool.query("DELETE FROM personal_list_items WHERE id = $1 AND list_id = $2 RETURNING id", [
    req.params.itemId,
    req.params.listId,
  ]);
  if (!r.rowCount) return res.status(404).json({ error: "Producto no encontrado." });
  changed(req);
  res.json({ ok: true });
}));

// Migracion desde el localStorage de cada navegador. La llama el cliente
// una vez por dispositivo (marca "serverSynced" en su estado local):
//  - Si el usuario aun no tiene listas en el servidor, se importan todas.
//  - Si ya tiene (otro dispositivo migro antes), solo se importan las que
//    tengan productos y cuyo contenido no este ya en el servidor, con el
//    sufijo " (importada)" si el nombre ya existe -- asi nunca se pierde
//    nada de un segundo dispositivo ni se duplica lo del primero.
// El advisory lock por usuario serializa dos dispositivos migrando a la vez.
router.post("/import", asyncHandler(async (req, res) => {
  const incoming = Array.isArray(req.body?.lists) ? req.body.lists.slice(0, 50) : null;
  if (!incoming) return res.status(400).json({ error: "Falta «lists»." });
  await upsertUser(req.user);

  const client = await pool.connect();
  let imported = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`personal-import:${req.user.id}`]);
    const current = await listsWithItems(req.user.id, client);
    const signature = (items) =>
      items.map((i) => cleanName(i.name).toLowerCase()).filter(Boolean).sort().join("|");
    const known = new Set(current.map((l) => signature(l.items)));
    const names = new Set(current.map((l) => l.name.toLowerCase()));
    let position = current.length;

    for (const list of incoming) {
      const items = (Array.isArray(list?.items) ? list.items : []).slice(0, 500).filter((i) => cleanName(i?.name));
      let name = cleanName(list?.name) || "Mi lista";
      if (current.length) {
        if (!items.length || known.has(signature(items))) continue;
        if (names.has(name.toLowerCase())) name = `${name} (importada)`;
      }
      const inserted = await client.query(
        "INSERT INTO personal_lists (user_id, name, position) VALUES ($1, $2, $3) RETURNING id",
        [req.user.id, name, position++]
      );
      let itemPos = 0;
      for (const i of items) {
        await client.query(
          `INSERT INTO personal_list_items (list_id, name, qty, category, done, recurring, position)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [inserted.rows[0].id, cleanName(i.name), i.qty ?? null, i.category || "otros", !!i.done, !!i.recurring, itemPos++]
        );
      }
      known.add(signature(items));
      names.add(name.toLowerCase());
      imported++;
    }

    // Nadie se queda sin lista: si no habia nada que importar ni en el
    // servidor, se crea la "Mi lista" vacia de siempre.
    if (!current.length && !imported) {
      await client.query("INSERT INTO personal_lists (user_id, name) VALUES ($1, 'Mi lista')", [req.user.id]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  if (imported) changed(req);
  res.json({ imported, lists: await listsWithItems(req.user.id) });
}));

module.exports = router;
module.exports.mergeQty = mergeQty;
