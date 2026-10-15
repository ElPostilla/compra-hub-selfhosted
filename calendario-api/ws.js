const { WebSocketServer } = require("ws");
const { verifyToken } = require("./auth");
const { isGroupMember } = require("./groupsClient");

// Un socket por conexion, suscrito a un unico grupo (el cliente reabre otra
// conexion si cambia de calendario de grupo). Mantener esto en memoria de
// proceso esta bien: un solo replica de calendario-api (ver deployment.yaml),
// no hay que coordinar entre pods.
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

function attach(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    if (!req.url.startsWith("/api-calendario/ws")) return; // deja pasar otros upgrades (no debería haber ninguno)

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
      ws.token = token; // hace falta para poder verificar membresia via lista-compra-api en cada subscribe
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
        try {
          if (await isGroupMember(ws.token, msg.groupId)) subscribe(msg.groupId, ws);
        } catch (err) {
          console.error("ws: no se pudo verificar membresia:", err.message);
        }
      }
    });
  });

  return wss;
}

module.exports = { attach, broadcast };
