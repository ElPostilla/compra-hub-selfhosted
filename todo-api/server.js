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
// prefijo, y "/api-todo" tambien haria de prefijo de "/api-todo/groups" si
// fuera registrado antes (mismo motivo que en calendario-api).
app.use("/api-todo/account", requireAuth, accountRoutes);
app.use("/api-todo/groups", requireAuth, groupRoutes);
app.use("/api-todo", requireAuth, personalRoutes);

app.get("/healthz", (_req, res) => res.send("ok"));

app.use((err, req, res, next) => {
  console.error("error no manejado:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Error interno." });
});

const port = process.env.PORT || 3000;
const server = http.createServer(app);
ws.attach(server);

// Postgres puede tardar unos segundos mas que este proceso en arrancar:
// reintenta la migracion en vez de morir al primer fallo de conexion.
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
  server.listen(port, () => console.log(`todo-api escuchando en :${port}`));
}

start().catch((err) => {
  console.error("no se pudo arrancar:", err);
  process.exit(1);
});
