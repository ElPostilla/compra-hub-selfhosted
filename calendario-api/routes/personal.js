const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const { pool, expandRecurring } = require("../db");
const { asyncHandler } = require("../asyncHandler");
const { validateNoteBody, noteValues, toEntry } = require("../notes-common");

const router = express.Router();

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

// Un OAuth2Client por usuario (no uno compartido a nivel de modulo): cada
// family member conecta su propia cuenta de Google, asi que las
// credenciales no se pueden guardar en un unico objeto en memoria como
// antes de esta version.
function newClient() {
  return new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

async function loadTokens(userId) {
  const r = await pool.query("SELECT tokens FROM google_tokens WHERE user_id = $1", [userId]);
  return r.rows[0]?.tokens || null;
}

// google-auth-library, al refrescar el access_token via refresh_token, solo
// emite los campos que cambian (normalmente sin refresh_token, que solo se
// entrega en el primer consentimiento) -- el "||" de jsonb hace merge
// conservando lo que ya hubiera y sobrescribiendo solo lo nuevo, igual que
// hacia el spread de objetos de la version anterior (archivo unico).
async function saveTokens(userId, tokens) {
  await pool.query(
    `INSERT INTO google_tokens (user_id, tokens, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (user_id) DO UPDATE
       SET tokens = google_tokens.tokens || EXCLUDED.tokens, updated_at = now()`,
    [userId, tokens]
  );
}

async function getAuthedClient(userId) {
  const tokens = await loadTokens(userId);
  if (!tokens) return null;
  const client = newClient();
  client.setCredentials(tokens);
  client.on("tokens", (newTokens) => {
    saveTokens(userId, newTokens).catch((err) => console.error("no se pudo guardar el token refrescado:", err));
  });
  return client;
}

router.get("/auth/status", asyncHandler(async (req, res) => {
  const tokens = await loadTokens(req.user.id);
  res.json({ connected: !!tokens?.refresh_token });
}));

router.get("/auth/url", (req, res) => {
  const url = newClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [SCOPE],
  });
  res.json({ url });
});

router.get("/auth/callback", asyncHandler(async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect("/calendario/?auth_error=" + encodeURIComponent(error));
  if (!code) return res.status(400).send("Falta el parametro code.");
  try {
    const client = newClient();
    const { tokens } = await client.getToken(code);
    await saveTokens(req.user.id, tokens);
    res.redirect("/calendario/?connected=1");
  } catch (err) {
    console.error(err);
    res.redirect("/calendario/?auth_error=1");
  }
}));

// Revoca en Google el acceso que dio la persona (si lo hay), para que
// desconectar o borrar la cuenta no deje un permiso vivo en su cuenta de
// Google. Nunca lanza: si Google no responde, se borra igualmente aqui.
async function revokeGoogle(userId) {
  const tokens = await loadTokens(userId);
  const token = tokens?.refresh_token || tokens?.access_token;
  if (!token) return;
  try {
    await newClient().revokeToken(token);
  } catch (err) {
    console.error("no se pudo revocar el token de Google:", err.message);
  }
}

router.post("/auth/disconnect", asyncHandler(async (req, res) => {
  await revokeGoogle(req.user.id);
  await pool.query("DELETE FROM google_tokens WHERE user_id = $1", [req.user.id]);
  res.json({ ok: true });
}));

router.get("/events", asyncHandler(async (req, res) => {
  const client = await getAuthedClient(req.user.id);
  if (!client) return res.status(401).json({ error: "No conectado con Google Calendar." });

  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: "Faltan start/end." });

  try {
    const accessToken = await client.getAccessToken();
    const params = new URLSearchParams({
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    const resp = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken.token}` } }
    );
    if (!resp.ok) {
      const detail = await resp.text();
      return res.status(502).json({ error: "Error consultando Google Calendar.", detail });
    }
    const data = await resp.json();
    const events = (data.items || []).map((e) => ({
      id: e.id,
      title: e.summary || "(sin título)",
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      allDay: !!e.start?.date,
    }));
    res.json({ events });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error consultando Google Calendar." });
  }
}));


router.get("/notes", asyncHandler(async (req, res) => {
  const r = await pool.query("SELECT id, date, note, importance, recurrence, time, remind_minutes FROM notes WHERE user_id = $1", [
    req.user.id,
  ]);
  res.json({ notes: expandRecurring(r.rows) });
}));


// Crea un recordatorio nuevo -- varios pueden convivir en la misma fecha
// (ya no hay PRIMARY KEY (user_id, date), ver db.js/migrateNoteId).
router.post("/notes", asyncHandler(async (req, res) => {
  const { date } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return res.status(400).json({ error: "Fecha invalida (usa YYYY-MM-DD)." });
  const err = validateNoteBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const v = noteValues(req.body);
  const r = await pool.query(
    `INSERT INTO notes (user_id, date, note, importance, recurrence, time, remind_minutes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
    [req.user.id, date, v.note, v.importance, v.recurrence, v.time, v.remindMinutes]
  );
  res.json({ ok: true, date, entry: toEntry(r.rows[0].id, v) });
}));

// Edita un recordatorio existente por id (la fecha no cambia).
router.put("/notes/:id", asyncHandler(async (req, res) => {
  const err = validateNoteBody(req.body);
  if (err) return res.status(400).json({ error: err });
  const v = noteValues(req.body);
  const r = await pool.query(
    `UPDATE notes SET note = $1, importance = $2, recurrence = $3, time = $4, remind_minutes = $5, updated_at = now()
     WHERE id = $6 AND user_id = $7 RETURNING date`,
    [v.note, v.importance, v.recurrence, v.time, v.remindMinutes, req.params.id, req.user.id]
  );
  if (!r.rowCount) return res.status(404).json({ error: "Recordatorio no encontrado." });
  res.json({ ok: true, date: r.rows[0].date, entry: toEntry(req.params.id, v) });
}));

router.delete("/notes/:id", asyncHandler(async (req, res) => {
  const deleted = await pool.query("DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING date", [
    req.params.id,
    req.user.id,
  ]);
  res.json({ ok: true, deleted: deleted.rowCount > 0, date: deleted.rows[0]?.date ?? null });
}));

module.exports = router;
// Reutilizado por ../reminders.js: mismo cliente OAuth autenticado, sin
// duplicar la logica de carga/refresco de tokens.
module.exports.getAuthedClient = getAuthedClient;
// Tambien para ./account.js (borrar la cuenta revoca el acceso a Google).
module.exports.revokeGoogle = revokeGoogle;
