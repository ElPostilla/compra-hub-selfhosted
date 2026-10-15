const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || "todo",
  user: process.env.PGUSER || "todo",
  password: process.env.PGPASSWORD,
});

// "position" ordena dentro de su propia columna (status): no es un indice
// global. La vista de lista no tiene su propio orden -- se deriva
// ordenando por status (todo, doing, done) y dentro de cada uno por
// position, asi los items marcados como hechos se hunden al final segun
// se van tachando, sin necesitar un segundo campo de orden.
//
// "due_date" como texto YYYY-MM-DD (no tipo DATE nativo), mismo motivo que
// en calendario-api/db.js: evita los desfases de un dia que da node-postgres
// al convertir DATE <-> Date de JS segun timezone.
//
// "recurrence": una tarea recurrente que se marca "done" no se queda
// marcada para siempre -- ver resetDueRecurring() mas abajo, que la
// reabre (status='todo') y avanza due_date al siguiente ciclo en cuanto
// due_date queda en el pasado. Sin cron: se comprueba de forma perezosa
// cada vez que se listan las tareas (barato, nada que coordinar entre pods).
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id);
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date TEXT CHECK (due_date ~ '^\\d{4}-\\d{2}-\\d{2}$');
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none'
      CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));
    -- Importancia (baja/media/alta), mismos valores que las notas del
    -- calendario. Las tareas ya existentes quedan en "media".
    ALTER TABLE tasks ADD COLUMN IF NOT EXISTS importance TEXT NOT NULL DEFAULT 'media'
      CHECK (importance IN ('baja', 'media', 'alta'));

    -- Mismo shape que "tasks" mas group_id y quien la creo, igual que
    -- notes/group_notes en calendario-api.
    CREATE TABLE IF NOT EXISTS group_tasks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
      position INTEGER NOT NULL DEFAULT 0,
      created_by UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS group_tasks_group_idx ON group_tasks (group_id);
    ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS due_date TEXT CHECK (due_date ~ '^\\d{4}-\\d{2}-\\d{2}$');
    ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none'
      CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));
    ALTER TABLE group_tasks ADD COLUMN IF NOT EXISTS importance TEXT NOT NULL DEFAULT 'media'
      CHECK (importance IN ('baja', 'media', 'alta'));
  `);
}

function nextDueDate(dueDate, recurrence) {
  const d = new Date(dueDate + "T00:00:00Z");
  if (recurrence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + 7);
  else if (recurrence === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}

// Reabre las tareas recurrentes cuyo ciclo ya paso: si sigue "done" y su
// due_date ya quedo en el pasado, vuelve a "todo" (al final de esa columna)
// con due_date avanzada al siguiente ciclo. Se llama antes de cada listado
// (GET /tasks), nunca en la escritura -- asi no hace falta ningun proceso
// en segundo plano.
async function resetDueRecurringTasks(userId) {
  const due = await pool.query(
    `SELECT id, due_date, recurrence FROM tasks
     WHERE user_id = $1 AND status = 'done' AND recurrence <> 'none' AND due_date < CURRENT_DATE::text`,
    [userId]
  );
  for (const row of due.rows) {
    const next = nextDueDate(row.due_date, row.recurrence);
    const posRow = await pool.query(
      "SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM tasks WHERE user_id = $1 AND status = 'todo'",
      [userId]
    );
    await pool.query(
      "UPDATE tasks SET status = 'todo', due_date = $1, position = $2, updated_at = now() WHERE id = $3",
      [next, posRow.rows[0].pos, row.id]
    );
  }
}

async function resetDueRecurringGroupTasks(groupId) {
  const due = await pool.query(
    `SELECT id, due_date, recurrence FROM group_tasks
     WHERE group_id = $1 AND status = 'done' AND recurrence <> 'none' AND due_date < CURRENT_DATE::text`,
    [groupId]
  );
  for (const row of due.rows) {
    const next = nextDueDate(row.due_date, row.recurrence);
    const posRow = await pool.query(
      "SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM group_tasks WHERE group_id = $1 AND status = 'todo'",
      [groupId]
    );
    await pool.query(
      "UPDATE group_tasks SET status = 'todo', due_date = $1, position = $2, updated_at = now() WHERE id = $3",
      [next, posRow.rows[0].pos, row.id]
    );
  }
}

module.exports = { pool, migrate, resetDueRecurringTasks, resetDueRecurringGroupTasks };
