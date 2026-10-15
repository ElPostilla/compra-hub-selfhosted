const { pool } = require("./db");
const { getAuthedClient } = require("./routes/personal");

// Cada REMINDER_MINUTES antes del inicio de un evento se envia un push.
// La comprobacion corre cada CHECK_INTERVAL_MS: la ventana
// [REMINDER_MINUTES, REMINDER_MINUTES + margen] tiene que ser mas ancha
// que el intervalo entre pasadas para no dejar eventos sin avisar entre
// una pasada y la siguiente.
const REMINDER_MINUTES = 30;
const WINDOW_MINUTES = 10;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

const PUSH_URL = process.env.PUSH_INTERNAL_URL || "http://lista-compra-api:3000/internal/push/notify";

async function notify(userId, title, body, url) {
  try {
    await fetch(PUSH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, title, body, url }),
    });
  } catch (err) {
    console.error("no se pudo enviar el push de recordatorio:", err.message);
  }
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}

async function checkUser(userId) {
  const client = await getAuthedClient(userId);
  if (!client) return;

  const now = Date.now();
  const windowStart = new Date(now + REMINDER_MINUTES * 60000);
  const windowEnd = new Date(now + (REMINDER_MINUTES + WINDOW_MINUTES) * 60000);

  let accessToken;
  try {
    accessToken = await client.getAccessToken();
  } catch (err) {
    console.error(`no se pudo refrescar el token de Google para ${userId}:`, err.message);
    return;
  }

  const params = new URLSearchParams({
    timeMin: windowStart.toISOString(),
    timeMax: windowEnd.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "20",
  });
  let resp;
  try {
    resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${accessToken.token}` },
    });
  } catch (err) {
    console.error(`error consultando Google Calendar para ${userId}:`, err.message);
    return;
  }
  if (!resp.ok) return;

  const data = await resp.json();
  for (const e of data.items || []) {
    if (!e.start?.dateTime) continue; // eventos "todo el dia" no llevan hora -> sin recordatorio
    const already = await pool.query(
      "SELECT 1 FROM event_reminders_sent WHERE user_id = $1 AND event_id = $2",
      [userId, e.id]
    );
    if (already.rowCount > 0) continue;

    const title = e.summary || "(sin título)";
    await notify(userId, "Evento en 30 min", `${title} a las ${formatTime(e.start.dateTime)}`, "/calendario/");
    await pool.query(
      "INSERT INTO event_reminders_sent (user_id, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [userId, e.id]
    );
  }
}

async function checkAllUsers() {
  const users = await pool.query("SELECT user_id FROM google_tokens");
  for (const row of users.rows) {
    await checkUser(row.user_id).catch((err) =>
      console.error(`fallo comprobando recordatorios de ${row.user_id}:`, err.message)
    );
  }
}

function start() {
  checkAllUsers().catch((err) => console.error("fallo en la primera comprobacion de recordatorios:", err.message));
  setInterval(() => {
    checkAllUsers().catch((err) => console.error("fallo comprobando recordatorios:", err.message));
  }, CHECK_INTERVAL_MS);
}

module.exports = { start };
