const express = require("express");
const { pool, resetDueRecurringTasks } = require("../db");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

const STATUSES = ["todo", "doing", "done"];
const STATUS_RANK = { todo: 0, doing: 1, done: 2 };
const RECURRENCES = ["none", "daily", "weekly", "monthly"];
const IMPORTANCES = ["baja", "media", "alta"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function serialize(row) {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    position: row.position,
    dueDate: row.due_date,
    recurrence: row.recurrence,
    importance: row.importance,
  };
}

// Orden estable para la vista de lista: por columna (todo, doing, done) y
// dentro de cada una por position -- ver comentario en db.js.
router.get("/tasks", asyncHandler(async (req, res) => {
  await resetDueRecurringTasks(req.user.id);
  const r = await pool.query(
    "SELECT id, title, status, position, due_date, recurrence, importance FROM tasks WHERE user_id = $1",
    [req.user.id]
  );
  const tasks = r.rows
    .map(serialize)
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.position - b.position);
  res.json({ tasks });
}));

router.post("/tasks", asyncHandler(async (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "Falta el titulo de la tarea." });
  const { dueDate, recurrence, importance } = req.body || {};
  if (importance !== undefined && !IMPORTANCES.includes(importance)) {
    return res.status(400).json({ error: "Importancia invalida." });
  }
  if (dueDate !== undefined && dueDate !== null && !DATE_RE.test(dueDate)) {
    return res.status(400).json({ error: "Fecha invalida (usa YYYY-MM-DD)." });
  }
  if (recurrence !== undefined && !RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: "Repeticion invalida." });
  }

  const next = await pool.query(
    "SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM tasks WHERE user_id = $1 AND status = 'todo'",
    [req.user.id]
  );
  const inserted = await pool.query(
    `INSERT INTO tasks (user_id, title, status, position, due_date, recurrence, importance)
     VALUES ($1, $2, 'todo', $3, $4, $5, $6)
     RETURNING id, title, status, position, due_date, recurrence, importance`,
    [req.user.id, title, next.rows[0].pos, dueDate || null, recurrence || "none", importance || "media"]
  );
  res.status(201).json(serialize(inserted.rows[0]));
}));

// Cambiar titulo/fecha/repeticion, o marcar/desmarcar como hecha desde la
// vista de lista (status sin position explicita -> se anade al final de su
// nueva columna, igual que una tarjeta soltada al final del tablero).
router.patch("/tasks/:id", asyncHandler(async (req, res) => {
  const { title, status, dueDate, recurrence, importance } = req.body || {};
  if (importance !== undefined && !IMPORTANCES.includes(importance)) {
    return res.status(400).json({ error: "Importancia invalida." });
  }
  if (status !== undefined && !STATUSES.includes(status)) {
    return res.status(400).json({ error: "Estado invalido." });
  }
  if (dueDate !== undefined && dueDate !== null && !DATE_RE.test(dueDate)) {
    return res.status(400).json({ error: "Fecha invalida (usa YYYY-MM-DD)." });
  }
  if (recurrence !== undefined && !RECURRENCES.includes(recurrence)) {
    return res.status(400).json({ error: "Repeticion invalida." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let position;
    if (status !== undefined) {
      const next = await client.query(
        "SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM tasks WHERE user_id = $1 AND status = $2",
        [req.user.id, status]
      );
      position = next.rows[0].pos;
    }
    const updated = await client.query(
      `UPDATE tasks SET
         title = COALESCE($3, title),
         status = COALESCE($4, status),
         position = COALESCE($5, position),
         due_date = CASE WHEN $6 THEN $7 ELSE due_date END,
         recurrence = COALESCE($8, recurrence),
         importance = COALESCE($9, importance),
         updated_at = now()
       WHERE id = $1 AND user_id = $2
       RETURNING id, title, status, position, due_date, recurrence, importance`,
      [
        req.params.id,
        req.user.id,
        title ?? null,
        status ?? null,
        position ?? null,
        dueDate !== undefined,
        dueDate ?? null,
        recurrence ?? null,
        importance ?? null,
      ]
    );
    if (updated.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Tarea no encontrada." });
    }
    await client.query("COMMIT");
    res.json(serialize(updated.rows[0]));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

router.delete("/tasks/:id", asyncHandler(async (req, res) => {
  const deleted = await pool.query("DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING id", [
    req.params.id,
    req.user.id,
  ]);
  if (deleted.rowCount === 0) return res.status(404).json({ error: "Tarea no encontrada." });
  res.json({ ok: true });
}));

// Reemplaza de una vez el orden/columna de todas las tarjetas: lo que
// manda el tablero kanban tras cualquier arrastre (dentro de una columna o
// entre columnas). Mas simple y sin condiciones de carrera que ir
// aplicando parches incrementales por tarjeta.
router.put("/tasks/board", asyncHandler(async (req, res) => {
  const columns = req.body?.columns || {};
  for (const status of Object.keys(columns)) {
    if (!STATUSES.includes(status) || !Array.isArray(columns[status])) {
      return res.status(400).json({ error: "Formato de tablero invalido." });
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const status of STATUSES) {
      const ids = columns[status];
      if (!ids) continue;
      for (let i = 0; i < ids.length; i++) {
        await client.query(
          "UPDATE tasks SET status = $1, position = $2, updated_at = now() WHERE id = $3 AND user_id = $4",
          [status, i, ids[i], req.user.id]
        );
      }
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

module.exports = router;
