const http = require("http");
const express = require("express");

const { migrate } = require("./db");
const { requireAuth } = require("./auth");
const ws = require("./ws");
const personalRoutes = require("./routes/personal");
const groupRoutes = require("./routes/groups");
const accountRoutes = require("./routes/account");

const app = express();
app.use(express.json({ limit: "64kb" }));

// El mount mas especifico va primero: Express matchea app.use() por
// prefijo, y "/api-menu" tambien haria de prefijo de "/api-menu/groups"
// si fuera registrado antes (mismo motivo que en calendario-api/todo-api).
app.use("/api-menu/account", requireAuth, accountRoutes);
app.use("/api-menu/groups", requireAuth, groupRoutes);
app.use("/api-menu", requireAuth, personalRoutes);

app.get("/healthz", (_req, res) => res.send("ok"));

app.use((err, req, res, next) => {
  console.error("error no manejado:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Error interno." });
});

const port = process.env.PORT || 3000;
const server = http.createServer(app);
ws.attach(server);

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
  server.listen(port, () => console.log(`menu-api escuchando en :${port}`));
}

start().catch((err) => {
  console.error("no se pudo arrancar:", err);
  process.exit(1);
});
