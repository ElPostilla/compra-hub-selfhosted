// Conversacion con Ollama (el PC con la GPU) en streaming: una linea JSON
// por fragmento (razonamiento, texto o llamadas a herramientas).
const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";
const MODEL = process.env.OLLAMA_MODEL || "gemma4:e4b";

async function* chatStream({ messages, tools, signal }) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: true,
      // Con thinking el modelo no «confirma» acciones sin llamar a la
      // herramienta (ver hub-mcp/eval): mas lento pero fiable.
      think: true,
      messages,
      tools,
      options: { temperature: 0.3 },
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama respondio ${res.status}`);

  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of res.body) {
    buffer += decoder.decode(bytes, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

// ¿Esta el PC encendido y con Ollama respondiendo? (se cachea unos
// segundos: el chat lo pregunta cada vez que se abre).
let cache = { at: 0, available: false };
async function isAvailable() {
  if (Date.now() - cache.at < 15000) return cache.available;
  let available = false;
  try {
    const res = await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(2500) });
    available = res.ok;
  } catch {
    available = false;
  }
  cache = { at: Date.now(), available };
  return available;
}

module.exports = { chatStream, isAvailable, OLLAMA_URL, MODEL };
