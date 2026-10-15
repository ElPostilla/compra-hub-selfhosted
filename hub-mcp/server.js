// Servidor MCP del hub: expone las apps (compra, tareas, calendario,
// gastos, menu) como herramientas para un modelo de lenguaje -- hoy
// el asistente del propio hub (asistente-api) y cualquier cliente MCP
// externo (p.ej. Open WebUI) que reenvie el token de Keycloak del usuario.
//
// Modo "stateless" de Streamable HTTP: un McpServer + transporte nuevos
// por cada peticion POST, construidos con el token de quien llama. Asi no
// hay sesiones en memoria que mezclar entre usuarios, y cada herramienta
// actua con los permisos exactos de esa persona en las APIs.
const express = require("express");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { requireAuth } = require("./auth");
const { hubClient } = require("./hub");
const { registerTools } = require("./tools");
const { shared: recipes } = require("./recipes");

const INSTRUCTIONS = `Herramientas del hub de casa: lista de la compra, tareas, calendario, gastos y menú.
- Fechas siempre en formato YYYY-MM-DD, zona horaria Europe/Madrid. Si no sabes la fecha de hoy, llama a resumen_hoy.
- Sin «grupo» se usa lo personal del usuario; con «grupo» (por nombre) lo compartido de ese grupo.
- La lista de la compra, si no se nombra un grupo, es la lista personal del usuario.
- Si una herramienta devuelve opciones por ambigüedad, pregunta al usuario en vez de adivinar.`;

const app = express();
app.use(express.json({ limit: "256kb" }));

app.post("/mcp", requireAuth, async (req, res) => {
  const server = new McpServer({ name: "hub", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  registerTools(server, { hub: hubClient(req.token), userId: req.user.id, recipes });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("mcp:", err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Error interno" }, id: null });
    }
  }
});

// Sin sesiones no hay stream de servidor (GET) ni cierre de sesion (DELETE).
app.all("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Método no permitido." }, id: null });
});

app.get("/healthz", (_req, res) => res.send("ok"));

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => console.log(`hub-mcp escuchando en :${PORT}`));
