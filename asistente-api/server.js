// Asistente del hub: el chat que aparece en todas las apps. Recibe los
// mensajes con la sesion del hub (oauth2-proxy -> X-Auth-Request-Access-Token),
// habla con un modelo de Ollama (OLLAMA_URL/OLLAMA_MODEL) y usa las herramientas de hub-mcp
// en nombre de quien escribe. La respuesta se emite en vivo (SSE).
//
// El PC nunca queda expuesto: solo este servicio (dentro del cluster) le
// habla; el navegador solo ve /api-asistente, protegido por keycloak-auth.
const express = require("express");
const { requireAuth } = require("./auth");
const { runAgent, changedData } = require("./agent");
const { chatStream, isAvailable } = require("./ollama");
const { connectHubTools } = require("./hub-tools");
const { createRateLimiter } = require("./rate-limit");

const app = express();
app.use(express.json({ limit: "64kb" }));

const BASE = "/api-asistente";
// El hub es publico: limite por persona para que nadie deje el PC
// generando sin parar.
const limiter = createRateLimiter({ max: Number(process.env.RATE_MAX || 20), windowMs: 5 * 60 * 1000 });

const APPS = new Set(["inicio", "lista", "tareas", "calendario", "gastos", "menu", "social", "perfil"]);

// Solo lo que el navegador tiene derecho a mandar: turnos user/assistant
// (los ultimos 20) y un contexto corto (app + que esta viendo).
function parseBody(body) {
  const raw = Array.isArray(body?.messages) ? body.messages.slice(-20) : null;
  if (!raw || !raw.length) return { error: "Falta el mensaje." };
  const history = [];
  for (const m of raw) {
    if (!m || !["user", "assistant"].includes(m.role) || typeof m.content !== "string") {
      return { error: "Mensaje no valido." };
    }
    const content = m.content.trim().slice(0, 2000);
    if (content) history.push({ role: m.role, content });
  }
  if (!history.length || history.at(-1).role !== "user") return { error: "El ultimo mensaje debe ser del usuario." };
  const app = APPS.has(body?.context?.app) ? body.context.app : null;
  const view = typeof body?.context?.view === "string" ? body.context.view.replace(/[\r\n]+/g, " ").slice(0, 160) : null;
  return { history, context: app ? { app, view } : null };
}

app.get(`${BASE}/status`, requireAuth, async (_req, res) => {
  res.json({ available: await isAvailable() });
});

app.post(`${BASE}/chat`, requireAuth, async (req, res) => {
  const parsed = parseBody(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  if (!limiter.allow(req.user.id)) {
    return res.status(429).json({ error: "Demasiados mensajes seguidos. Espera un par de minutos." });
  }
  if (!(await isAvailable())) {
    return res.status(503).json({ error: "El asistente no está disponible: el ordenador con el modelo está apagado." });
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  const emit = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  // Latido: Cloudflare/Traefik cortan conexiones mudas mientras el modelo
  // piensa.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 10000);
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  let hub;
  try {
    hub = await connectHubTools(req.get("x-auth-request-access-token"));
    const { actions } = await runAgent({
      history: parsed.history,
      context: parsed.context,
      tools: hub.tools,
      callTool: (name, args) => hub.call(name, args),
      chatStream,
      emit,
      signal: abort.signal,
    });
    emit({ type: "done", changed: changedData(actions), actions });
  } catch (err) {
    if (!abort.signal.aborted) {
      console.error("asistente:", err.message);
      emit({ type: "error", message: "No he podido terminar la respuesta. Prueba otra vez." });
    }
  } finally {
    clearInterval(heartbeat);
    hub?.close();
    res.end();
  }
});

app.get("/healthz", (_req, res) => res.send("ok"));

if (require.main === module) {
  const PORT = Number(process.env.PORT || 3000);
  app.listen(PORT, () => console.log(`asistente-api escuchando en :${PORT}`));
}

module.exports = { app, parseBody };
