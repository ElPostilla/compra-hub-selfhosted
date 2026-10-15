const express = require("express");
const { pool, resetDueRecurringGroupTasks } = require("../db");
const { broadcast } = require("../ws");
const { asyncHandler } = require("../asyncHandler");
const { tokenFromRequest, fetchMyGroups, isGroupMember, postActivity } = require("../groupsClient");

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

router.get("/:id/tasks", requireMembership, asyncHandler(async (req, res) => {
  await resetDueRecurringGroupTasks(req.params.id);
  const r = await pool.query(
    "SELECT id, title, status, position, due_date, recurrence, importance FROM group_tasks WHERE group_id = $1",
    [req.params.id]
  );
  const tasks = r.rows
    .map(serialize)
    .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.position - b.position);
  res.json({ tasks });
}));

router.post("/:id/tasks", requireMembership, asyncHandler(async (req, res) => {
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
    "SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM group_tasks WHERE group_id = $1 AND status = 'todo'",
    [req.params.id]
  );
  const inserted = await pool.query(
    `INSERT INTO group_tasks (group_id, title, status, position, due_date, recurrence, created_by, importance)
     VALUES ($1, $2, 'todo', $3, $4, $5, $6, $7)
     RETURNING id, title, status, position, due_date, recurrence, importance`,
    [req.params.id, title, next.rows[0].pos, dueDate || null, recurrence || "none", req.user.id, importance || "media"]
  );
  const task = serialize(inserted.rows[0]);
  broadcast(req.params.id, { type: "task_added", groupId: req.params.id, task });
  postActivity(tokenFromRequest(req), req.params.id, `añadió «${task.title}» al tablero`).catch(() => {});
  res.status(201).json(task);
}));

router.patch("/:id/tasks/:taskId", requireMembership, asyncHandler(async (req, res) => {
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
        "SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM group_tasks WHERE group_id = $1 AND status = $2",
        [req.params.id, status]
      );
      position = next.rows[0].pos;
    }
    const updated = await client.query(
      `UPDATE group_tasks SET
         title = COALESCE($3, title),
         status = COALESCE($4, status),
         position = COALESCE($5, position),
         due_date = CASE WHEN $6 THEN $7 ELSE due_date END,
         recurrence = COALESCE($8, recurrence),
         importance = COALESCE($9, importance),
         updated_at = now()
       WHERE id = $1 AND group_id = $2
       RETURNING id, title, status, position, due_date, recurrence, importance`,
      [
        req.params.taskId,
        req.params.id,
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
    const task = serialize(updated.rows[0]);
    broadcast(req.params.id, { type: "task_updated", groupId: req.params.id, task });
    if (status === "done") {
      postActivity(tokenFromRequest(req), req.params.id, `marcó «${task.title}» como hecha`).catch(() => {});
    }
    res.json(task);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}));

router.delete("/:id/tasks/:taskId", requireMembership, asyncHandler(async (req, res) => {
  const deleted = await pool.query("DELETE FROM group_tasks WHERE id = $1 AND group_id = $2 RETURNING id", [
    req.params.taskId,
    req.params.id,
  ]);
  if (deleted.rowCount === 0) return res.status(404).json({ error: "Tarea no encontrada." });
  broadcast(req.params.id, { type: "task_deleted", groupId: req.params.id, id: req.params.taskId });
  res.json({ ok: true });
}));

router.put("/:id/tasks/board", requireMembership, asyncHandler(async (req, res) => {
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
          "UPDATE group_tasks SET status = $1, position = $2, updated_at = now() WHERE id = $3 AND group_id = $4",
          [status, i, ids[i], req.params.id]
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
  broadcast(req.params.id, { type: "board_updated", groupId: req.params.id, columns });
  res.json({ ok: true });
}));

module.exports = router;
