const { WebSocketServer } = require("ws");
const { verifyToken } = require("./auth");
const { pool } = require("./db");

// Un socket por conexion, suscrito a un unico grupo (el cliente reabre otra
// conexion si cambia de lista de grupo). Mantener esto en memoria de proceso
// esta bien: un solo replica de lista-compra-api (ver deployment.yaml), no
// hay que coordinar entre pods.
const subscribers = new Map(); // groupId -> Set<ws>

function broadcast(groupId, message) {
  const sockets = subscribers.get(groupId);
  if (!sockets) return;
  const payload = JSON.stringify(message);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function subscribe(groupId, ws) {
  if (!subscribers.has(groupId)) subscribers.set(groupId, new Set());
  subscribers.get(groupId).add(ws);
  ws.once("close", () => {
    subscribers.get(groupId)?.delete(ws);
  });
}

async function isMember(groupId, userId) {
  const r = await pool.query("SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2", [
    groupId,
    userId,
  ]);
  return r.rowCount > 0;
}

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    if (!req.url.startsWith("/api/ws")) return; // deja pasar otros upgrades (no debería haber ninguno)

    const token = req.headers["x-auth-request-access-token"] || null;
    if (!token) return socket.destroy();

    let claims;
    try {
      claims = await verifyToken(token);
    } catch (err) {
      console.error("ws: token invalido:", err.message);
      return socket.destroy();
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userId = claims.sub;
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === "subscribe" && typeof msg.groupId === "string") {
        if (await isMember(msg.groupId, ws.userId)) {
          subscribe(msg.groupId, ws);
        }
      }
      // Canal propio del usuario (sus listas personales, ver
      // routes/personal.js): la clave nunca coincide con un id de grupo.
      if (msg.type === "subscribe_personal") {
        subscribe(userChannel(ws.userId), ws);
      }
    });
  });

  return wss;
}

function userChannel(userId) {
  return `user:${userId}`;
}

function broadcastToUser(userId, message) {
  broadcast(userChannel(userId), message);
}

module.exports = { attach, broadcast, broadcastToUser };
