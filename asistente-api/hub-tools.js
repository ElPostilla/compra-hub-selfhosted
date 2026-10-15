// Herramientas del hub via hub-mcp, siempre con el token de quien habla:
// cada accion la hacen las APIs con los permisos de esa persona.
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");

const HUB_MCP_URL = process.env.HUB_MCP_URL || "http://hub-mcp:3000/mcp";

async function connectHubTools(token) {
  const client = new Client({ name: "asistente-api", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(HUB_MCP_URL), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return {
    // Formato de herramientas de Ollama.
    tools: tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.inputSchema },
    })),
    async call(name, args) {
      const r = await client.callTool({ name, arguments: args });
      return {
        isError: !!r.isError,
        text: (r.content || []).map((c) => c.text || "").join("\n"),
      };
    },
    close: () => client.close().catch(() => {}),
  };
}

module.exports = { connectHubTools, HUB_MCP_URL };
