// Avisos push de las notas del calendario (personales y de grupo) que
// tienen aviso (remind_minutes). Cada minuto mira que avisos «tocan» y los
// envia por el servicio de push del hub (lista-compra-api, rutas internas).
// Las notas que se repiten avisan en cada repeticion.
//
// Todo en hora de Madrid: la nota guarda fecha + hora locales. Sin hora,
// el aviso se calcula sobre las 09:00 (p.ej. «el dia anterior» = 09:00 del
// dia anterior).
//
// Cada aviso se reserva con INSERT en note_reminders_sent ANTES de
// enviarlo (ON CONFLICT DO NOTHING): nunca se envia dos veces, aunque haya
// reinicios. Si el pod estuvo caido mas de LOOKBACK_MINUTES, esos avisos
// se dan por perdidos (mejor que llegar horas tarde).
const { pool, addRecurrence } = require("./db");

const TZ = "Europe/Madrid";
const DEFAULT_TIME = "09:00";
const CHECK_INTERVAL_MS = 60 * 1000;
const LOOKBACK_MINUTES = 15;
const PUSH_URL = process.env.PUSH_INTERNAL_URL || "http://lista-compra-api:3000/internal/push/notify";
const GROUP_PUSH_URL =
  process.env.PUSH_GROUP_INTERNAL_URL || PUSH_URL.replace(/\/notify$/, "/notify-group");

// ---------------------------------------------------------------- fechas

function dateKey(ms) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(ms));
}

function addDays(key, n) {
  const d = new Date(key + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Diferencia (ms) entre la hora de Madrid y UTC en un instante dado.
function tzOffsetMs(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// "2026-10-02" + "17:30" (hora de Madrid) -> instante (ms). Dos pasadas
// para acertar tambien los dias de cambio de hora.
function madridToUtc(key, hhmm) {
  const [y, m, d] = key.split("-").map(Number);
  const [H, M] = hhmm.split(":").map(Number);
  const naive = Date.UTC(y, m - 1, d, H, M);
  let ms = naive - tzOffsetMs(naive);
  ms = naive - tzOffsetMs(ms);
  return ms;
}

// ¿La nota (con su repeticion) cae en esta fecha?
function occursOn(row, key) {
  if (key < row.date) return false;
  if (row.recurrence === "none") return key === row.date;
  for (let i = 0; i < 5000; i++) {
    const d = addRecurrence(row.date, row.recurrence, i);
    if (d === key) return true;
    if (d > key) return false;
  }
  return false;
}

function formatTime(hhmm) {
  return hhmm.replace(/^0/, "");
}

// Texto del aviso: cuando es, visto desde el momento del aviso.
function describe(row, occurrence, now) {
  const today = dateKey(now);
  const day =
    occurrence === today ? "Hoy" : occurrence === addDays(today, 1) ? "Mañana" : occurrence.split("-").reverse().join("/");
  if (!row.time) return day;
  if (row.remind_minutes > 0 && row.remind_minutes <= 60) {
    return `Dentro de ${row.remind_minutes === 60 ? "1 hora" : `${row.remind_minutes} minutos`} (${formatTime(row.time)})`;
  }
  return `${day} a las ${formatTime(row.time)}`;
}

// Avisos que tocan ahora: [{ row, occurrence }]. Solo mira ayer/hoy/mañana
// (el aviso mas adelantado es de 1 dia; ayer cubre el cambio de dia).
function dueReminders(rows, now) {
  const today = dateKey(now);
  const candidates = [addDays(today, -1), today, addDays(today, 1)];
  const due = [];
  for (const row of rows) {
    if (row.remind_minutes === null || row.remind_minutes === undefined) continue;
    for (const occurrence of candidates) {
      if (!occursOn(row, occurrence)) continue;
      const fireAt = madridToUtc(occurrence, row.time || DEFAULT_TIME) - row.remind_minutes * 60000;
      if (fireAt <= now && fireAt > now - LOOKBACK_MINUTES * 60000) due.push({ row, occurrence });
    }
  }
  return due;
}

// ---------------------------------------------------------------- envio

async function post(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`push respondio ${res.status}`);
}

async function claim(kind, noteId, occurrence) {
  const r = await pool.query(
    `INSERT INTO note_reminders_sent (kind, note_id, occurrence) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING note_id`,
    [kind, noteId, occurrence]
  );
  return r.rowCount > 0;
}

async function tick(now = Date.now(), send = post) {
  const cols = "id, date, note, time, remind_minutes, recurrence";
  const [personal, group] = await Promise.all([
    pool.query(`SELECT ${cols}, user_id FROM notes WHERE remind_minutes IS NOT NULL`),
    pool.query(`SELECT ${cols}, group_id FROM group_notes WHERE remind_minutes IS NOT NULL`),
  ]);
  let sent = 0;
  for (const [kind, rows] of [["personal", personal.rows], ["group", group.rows]]) {
    for (const { row, occurrence } of dueReminders(rows, now)) {
      if (!(await claim(kind, row.id, occurrence))) continue;
      const payload = { title: row.note, body: describe(row, occurrence, now), url: "/calendario/" };
      try {
        if (kind === "personal") await send(PUSH_URL, { userId: row.user_id, ...payload });
        else await send(GROUP_PUSH_URL, { groupId: row.group_id, ...payload });
        sent++;
      } catch (err) {
        console.error(`aviso de nota ${row.id} (${occurrence}) no enviado:`, err.message);
      }
    }
  }
  return sent;
}

function start() {
  const run = () => tick().catch((err) => console.error("avisos de notas:", err.message));
  setTimeout(run, 10000);
  setInterval(run, CHECK_INTERVAL_MS);
}

module.exports = { start, tick, dueReminders, madridToUtc, occursOn, describe, dateKey };
