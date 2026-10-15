const http = require("http");
const express = require("express");

const { migrate } = require("./db");
const { requireAuth } = require("./auth");
const ws = require("./ws");
const profileRoutes = require("./routes/profile");
const accountRoutes = require("./routes/account");
const friendsRoutes = require("./routes/friends");
const groupsRoutes = require("./routes/groups");
const invitesRoutes = require("./routes/invites");
const personalRoutes = require("./routes/personal");
const pushRoutes = require("./routes/push");
const { createPriceComparer } = require("./prices");
const { asyncHandler } = require("./asyncHandler");

const app = express();
app.use(express.json({ limit: "256kb" }));

// Comparativa de precios: datos reales de Mercadona y Dia; el modelo local
// solo elige que producto de cada tienda corresponde a lo apuntado (ver
// prices.js). Antes era Claude Haiku con busqueda web (de pago y estimado).
const prices = createPriceComparer();

app.post(
  "/api/prices",
  requireAuth,
  asyncHandler(async (req, res) => {
    const raw = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = raw
      .map((i) => ({ name: String(i?.name || "").trim().slice(0, 80), qty: String(i?.qty ?? "1").trim().slice(0, 20) }))
      .filter((i) => i.name)
      .slice(0, 40);
    if (!items.length) return res.status(400).json({ error: "Falta la lista de productos." });
    res.json(await prices.compare(items));
  })
);

app.use("/api/profile", requireAuth, profileRoutes);
app.use("/api/account", requireAuth, accountRoutes);
app.use("/api/friends", requireAuth, friendsRoutes);
app.use("/api/groups", requireAuth, groupsRoutes);
app.use("/api/invites", requireAuth, invitesRoutes);
app.use("/api/personal", requireAuth, personalRoutes);
app.use("/api/push", requireAuth, pushRoutes);
app.use("/internal/push", pushRoutes.internalRouter);

app.get("/healthz", (_req, res) => res.send("ok"));

// Red de seguridad final: sin esto, un error no capturado en cualquier ruta
// (los handlers async ya van envueltos con asyncHandler, pero mejor no
// depender solo de eso) tumbaba el proceso entero -- probado en produccion,
// un solo usuario con un conflicto de datos dejaba sin servicio a todo el
// mundo. A partir de aqui, como mucho se responde 500 a esa peticion.
app.use((err, req, res, next) => {
  console.error("error no manejado:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Error interno." });
});

const port = process.env.PORT || 3000;
const server = http.createServer(app);
ws.attach(server);

// Postgres puede tardar unos segundos mas que este proceso en arrancar
// (ambos se despliegan a la vez la primera vez): reintenta la migracion en
// vez de morir al primer fallo de conexion.
async function start() {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await migrate();
      break;
    } catch (err) {
      if (attempt >= 10) throw err;
      console.error(`migracion fallida (intento ${attempt}/10), reintentando en 3s:`, err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  server.listen(port, () => console.log(`lista-compra-api escuchando en :${port}`));
}

start().catch((err) => {
  console.error("no se pudo arrancar:", err);
  process.exit(1);
});
