const fs = require("fs");
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || "calendario",
  user: process.env.PGUSER || "calendario",
  password: process.env.PGPASSWORD,
});

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_tokens (
      user_id UUID PRIMARY KEY,
      tokens JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- "date" como texto YYYY-MM-DD (no tipo DATE nativo): evita por completo
    -- los desfases de un dia que da node-postgres al convertir DATE <-> Date
    -- de JS segun timezone, y es el mismo formato que ya usaba notes.json y
    -- que ya genera el cliente (fmtDate()).
    --
    -- Sin PRIMARY KEY (user_id, date): antes lo tenia (forzaba una nota por
    -- dia). Ahora la PK real es "id" (ver migrateNoteId() mas abajo, migra
    -- instalaciones existentes) para permitir varios recordatorios el mismo
    -- dia, cada uno con su propia importancia.
    CREATE TABLE IF NOT EXISTS notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      date TEXT NOT NULL CHECK (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
      note TEXT NOT NULL,
      importance TEXT NOT NULL DEFAULT 'media' CHECK (importance IN ('baja', 'media', 'alta')),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS notes_user_date_idx ON notes (user_id, date);

    -- Notas de calendario de grupo: mismo shape que "notes" mas group_id y
    -- quien la escribio. Sin integracion con Google Calendar por ahora
    -- (solo hay una cuenta de Google por usuario, no por grupo) -- el shape
    -- generico (fecha/nota/importancia) se deja listo para poder exportar
    -- a Google Calendar mas adelante si se quiere.
    CREATE TABLE IF NOT EXISTS group_notes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL,
      date TEXT NOT NULL CHECK (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
      note TEXT NOT NULL,
      importance TEXT NOT NULL DEFAULT 'media' CHECK (importance IN ('baja', 'media', 'alta')),
      created_by UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS group_notes_group_date_idx ON group_notes (group_id, date);
  `);

  await pool.query(`
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none'
      CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));
    ALTER TABLE group_notes ADD COLUMN IF NOT EXISTS recurrence TEXT NOT NULL DEFAULT 'none'
      CHECK (recurrence IN ('none', 'daily', 'weekly', 'monthly'));

    -- Hora opcional (HH:MM, hora de Madrid) y aviso push opcional: minutos
    -- antes de la hora (0 = a la hora, 30, 60, 1440 = el dia anterior).
    -- Sin hora, el aviso se calcula sobre las 09:00 (ver notes-reminders.js).
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS time TEXT CHECK (time ~ '^([01]\\d|2[0-3]):[0-5]\\d$');
    ALTER TABLE notes ADD COLUMN IF NOT EXISTS remind_minutes INTEGER CHECK (remind_minutes IN (0, 30, 60, 1440));
    ALTER TABLE group_notes ADD COLUMN IF NOT EXISTS time TEXT CHECK (time ~ '^([01]\\d|2[0-3]):[0-5]\\d$');
    ALTER TABLE group_notes ADD COLUMN IF NOT EXISTS remind_minutes INTEGER CHECK (remind_minutes IN (0, 30, 60, 1440));

    -- Avisos ya enviados, uno por nota y fecha (las notas que se repiten
    -- avisan en cada repeticion). Se «reserva» con INSERT antes de enviar:
    -- nunca sale dos veces, aunque se reinicie el pod.
    CREATE TABLE IF NOT EXISTS note_reminders_sent (
      kind TEXT NOT NULL CHECK (kind IN ('personal', 'group')),
      note_id UUID NOT NULL,
      occurrence TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (kind, note_id, occurrence)
    );
  `);

  // Instalaciones ya existentes: "notes"/"group_notes" tenian PRIMARY KEY
  // (user_id, date) / (group_id, date), sin columna "id". Se añade una PK
  // nueva basada en "id" para permitir varias notas el mismo dia (una vez
  // migrado, CREATE TABLE IF NOT EXISTS de arriba ya no vuelve a tocarla).
  await migrateNoteId("notes");
  await migrateNoteId("group_notes");

  // Recordatorios push ya enviados (dedup): un evento de Google Calendar
  // puede seguir estando "dentro de la ventana" de recordatorio en varias
  // pasadas del cron (ver reminders.js) antes de que empiece -- sin esto
  // se reenviaria el mismo aviso cada vez que corre.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_reminders_sent (
      user_id UUID NOT NULL,
      event_id TEXT NOT NULL,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, event_id)
    );
  `);

  await migrateLegacyNotes();
}

// Añade "id" (PK) a una tabla que todavia tiene la PK compuesta antigua
// (user_id, date) / (group_id, date). No-op si ya esta migrada (columna
// "id" ya existe) -- seguro de re-ejecutar en cada arranque del pod.
async function migrateNoteId(table) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = 'id'`,
    [table]
  );
  if (rows.length) return;
  await pool.query(`ALTER TABLE ${table} ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid()`);
  await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT ${table}_pkey`);
  await pool.query(`ALTER TABLE ${table} ADD CONSTRAINT ${table}_pkey PRIMARY KEY (id)`);
  console.log(`${table}: migrada PK antigua a columna "id"`);
}

// Antes de esta version, calendario-api no distinguia usuarios: un unico
// notes.json en el PVC, compartido por cualquiera que entrase en /calendario.
// Si hay datos ahi y la tabla "notes" esta vacia, se importan asignandolos
// al usuario indicado en LEGACY_NOTES_OWNER_ID (el dueño real de la cuenta),
// para no perder lo que hubiera antes de pasar a almacenamiento por
// usuario. Se ejecuta una sola vez: en cuanto "notes" tiene alguna fila, se
// omite (idempotente entre reinicios del pod).
async function migrateLegacyNotes() {
  const ownerId = process.env.LEGACY_NOTES_OWNER_ID;
  if (!ownerId) return;

  const legacyPath = (process.env.DATA_DIR || "/data") + "/notes.json";
  let legacy;
  try {
    legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  } catch {
    return;
  }
  if (!legacy || typeof legacy !== "object" || Object.keys(legacy).length === 0) return;

  const { rows } = await pool.query("SELECT count(*)::int AS n FROM notes");
  if (rows[0].n > 0) return;

  for (const [date, entry] of Object.entries(legacy)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !entry?.note) continue;
    // La tabla esta vacia en este punto (comprobado arriba), asi que no
    // hace falta ON CONFLICT: no puede haber choques.
    await pool.query(
      `INSERT INTO notes (user_id, date, note, importance) VALUES ($1, $2, $3, $4)`,
      [ownerId, date, entry.note, entry.importance || "media"]
    );
  }
  console.log(`migradas notas antiguas de notes.json a user_id=${ownerId}`);
}

const PROJECTION_DAYS_BACK = 365;
const PROJECTION_DAYS_FORWARD = 365;

function addRecurrence(dateStr, recurrence, times) {
  const d = new Date(dateStr + "T00:00:00Z");
  if (recurrence === "daily") d.setUTCDate(d.getUTCDate() + times);
  else if (recurrence === "weekly") d.setUTCDate(d.getUTCDate() + times * 7);
  else if (recurrence === "monthly") d.setUTCMonth(d.getUTCMonth() + times);
  return d.toISOString().slice(0, 10);
}

// Expande las filas guardadas (algunas recurrentes) en un dict
// {fecha: [{id, note, importance, recurrence, origin}, ...]} -- varias
// notas reales o proyectadas pueden caer en la misma fecha. "origin: true"
// es una fila real de la tabla; "origin: false" es una repeticion
// calculada al vuelo, nunca se guarda -- si el usuario edita o borra esa
// proyeccion desde el cliente, hay que crear una nota real propia en esa
// fecha (ver routes/personal.js), que a partir de ahi convive con la
// proyeccion de la nota recurrente original en vez de sustituirla.
//
// Ventana fija de +-365 dias desde hoy: no hay parametro de rango en la
// API (GET /notes siempre devuelve todo), asi que se elige un limite
// razonable en vez de proyectar indefinidamente hacia el futuro. Simple
// de mas para navegaciones de calendario muy lejanas, pero de sobra para
// el uso real de esta app.
// Lo que el cliente ve de cada nota (real o repeticion proyectada).
function entryFields(row) {
  return {
    id: row.id,
    note: row.note,
    importance: row.importance,
    recurrence: row.recurrence,
    time: row.time ?? null,
    remindMinutes: row.remind_minutes ?? null,
  };
}

function expandRecurring(rows) {
  const byDate = {};
  for (const row of rows) {
    (byDate[row.date] ??= []).push({ ...entryFields(row), origin: true });
  }

  const today = new Date();
  const windowStart = new Date(today);
  windowStart.setUTCDate(windowStart.getUTCDate() - PROJECTION_DAYS_BACK);
  const windowEnd = new Date(today);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + PROJECTION_DAYS_FORWARD);
  const startKey = windowStart.toISOString().slice(0, 10);
  const endKey = windowEnd.toISOString().slice(0, 10);

  for (const row of rows) {
    if (row.recurrence === "none") continue;
    for (let i = 1; i <= 800; i++) {
      const projected = addRecurrence(row.date, row.recurrence, i);
      if (projected > endKey) break;
      if (projected < startKey) continue;
      const bucket = (byDate[projected] ??= []);
      if (!bucket.some((e) => e.id === row.id)) {
        bucket.push({ ...entryFields(row), origin: false });
      }
    }
  }
  return byDate;
}

module.exports = { pool, migrate, expandRecurring, addRecurrence, entryFields };
