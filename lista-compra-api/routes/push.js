const express = require("express");
const { asyncHandler } = require("../asyncHandler");
const { VAPID_PUBLIC_KEY, saveSubscription, removeSubscription, sendPushToUser, sendPushToUsers } = require("../push");
const { pool } = require("../db");

const router = express.Router();
// Ruta interna (sin requireAuth, ver server.js -- montada fuera de /api,
// asi que ningun Ingress/IngressRoute la expone al exterior; solo es
// alcanzable pod-a-pod via DNS del cluster) para que calendario-api y
// gastos-api puedan disparar un push sin duplicar VAPID/suscripciones,
// que solo viven aqui.
const internalRouter = express.Router();
internalRouter.post("/notify", asyncHandler(async (req, res) => {
  const { userId, title, body, url } = req.body || {};
  if (!userId || !title) return res.status(400).json({ error: "Falta userId o title." });
  await sendPushToUser(userId, { title, body: body || "", url: url || "/" });
  res.json({ ok: true });
}));

// Aviso a todos los miembros de un grupo (p.ej. el recordatorio de una
// nota del calendario de grupo, ver calendario-api/notes-reminders.js).
// Ruta interna: solo accesible dentro del cluster, igual que /notify.
internalRouter.post("/notify-group", asyncHandler(async (req, res) => {
  const { groupId, title, body, url } = req.body || {};
  if (!groupId || !title) return res.status(400).json({ error: "Falta groupId o title." });
  const members = await pool.query("SELECT user_id FROM group_members WHERE group_id = $1", [groupId]);
  await sendPushToUsers(members.rows.map((m) => m.user_id), { title, body: body || "", url: url || "/" });
  res.json({ ok: true, members: members.rowCount });
}));

router.get("/vapid-public-key", (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY || null });
});

router.post("/subscribe", asyncHandler(async (req, res) => {
  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: "Suscripción inválida." });
  }
  await saveSubscription(req.user.id, subscription);
  res.status(201).json({ ok: true });
}));

router.delete("/subscribe", asyncHandler(async (req, res) => {
  const endpoint = req.body?.endpoint;
  if (!endpoint) return res.status(400).json({ error: "Falta el endpoint." });
  await removeSubscription(endpoint);
  res.json({ ok: true });
}));

module.exports = router;
module.exports.internalRouter = internalRouter;
