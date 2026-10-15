const webpush = require("web-push");
const { pool } = require("./db");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

async function saveSubscription(userId, subscription) {
  await pool.query(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
    [subscription.endpoint, userId, subscription.keys.p256dh, subscription.keys.auth]
  );
}

async function removeSubscription(endpoint) {
  await pool.query("DELETE FROM push_subscriptions WHERE endpoint = $1", [endpoint]);
}

// Envia a todas las suscripciones (dispositivos) de un usuario. Si el
// navegador devuelve 404/410 la suscripcion ya no es valida (desinstalada,
// permiso revocado...) -- se borra en vez de reintentar.
async function sendPushToUser(userId, payload) {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;
  const subs = await pool.query("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1", [userId]);
  await Promise.all(
    subs.rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await removeSubscription(sub.endpoint);
        }
      }
    })
  );
}

async function sendPushToUsers(userIds, payload) {
  await Promise.all(userIds.map((id) => sendPushToUser(id, payload)));
}

module.exports = { VAPID_PUBLIC_KEY, saveSubscription, removeSubscription, sendPushToUser, sendPushToUsers };
