// Evalua si el modelo elige la herramienta correcta (y los argumentos
// clave) para frases reales en espanol. No toca el hub: saca los esquemas
// de las herramientas de un McpServer en memoria (exactamente lo que ve un
// cliente MCP) y solo pregunta al modelo que llamada haria.
//
//   OLLAMA_URL=http://localhost:11434 MODEL=qwen3.8 node eval/tool-choice.js
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { registerTools } = require("../tools");
const { resolveDay } = require("../util");

const OLLAMA = process.env.OLLAMA_URL || "http://ollama:11434";
const MODEL = process.env.MODEL || "qwen3.8";
// Fecha fija para que las fechas esperadas sean deterministas.
const HOY = "2026-09-24"; // jueves
// El muestreo hace que el resultado varie entre ejecuciones: se repite
// cada frase REPS veces con la temperatura indicada.
const TEMP = process.env.TEMP !== undefined ? Number(process.env.TEMP) : process.env.PROMPT === "asistente" ? 0.3 : undefined;
const REPS = Number(process.env.REPS || 1);
const QUIET = !!process.env.QUIET;
// Razonamiento previo ("thinking") del modelo: desactivado por defecto.
const THINK = process.env.THINK === "1";

// Mismo prompt de sistema que el modelo «Jarvis» de Open WebUI (con las
// variables {{CURRENT_WEEKDAY}} {{CURRENT_DATE}} ya sustituidas).
// PROMPT=a: reglas en tono normal. PROMPT=b: con una «REGLA PRINCIPAL»
// enfatica contra confirmar sin herramienta (medido: no ayuda, ver README).
const SYSTEM_A = `Eres Jarvis, el asistente de casa de la familia. Hoy es jueves ${HOY} (hora de Madrid).
Para la lista de la compra, tareas, calendario, gastos y menú usa SIEMPRE las herramientas del hub; nunca guardes esas cosas en notas ni en memoria.
Si el usuario dice «mi lista» sin nombrar un grupo, se refiere a su lista personal: usa personal=true.
Al añadir o cambiar algo, di siempre en qué lista o grupo lo has hecho.
No digas que algo está hecho si la herramienta no ha respondido bien; si devuelve un error u opciones, explícalo o pregunta.
Responde en español, breve y natural, sin tablas.`;
const SYSTEM_B = `Eres Jarvis, el asistente de casa de la familia. Hoy es jueves ${HOY} (hora de Madrid).
REGLA PRINCIPAL: tú no puedes guardar ni cambiar nada por ti mismo. Solo las herramientas del hub lo hacen. Si no has llamado a una herramienta, NO has hecho nada: nunca digas «hecho», «añadido», «registrado» o «apuntado» sin una llamada a herramienta que haya respondido bien.
Para la lista de la compra, tareas, calendario, gastos y menú usa SIEMPRE las herramientas del hub; nunca guardes esas cosas en notas ni en memoria.
Si el usuario dice «mi lista» sin nombrar un grupo, se refiere a su lista personal: usa personal=true.
Al añadir o cambiar algo, di siempre en qué lista o grupo lo has hecho. Si una herramienta devuelve un error u opciones, explícalo o pregunta.
Responde en español, breve y natural, sin tablas.`;
// PROMPT=asistente: el prompt real del chat de las apps (asistente-api),
// con «hoy» fijado al mismo jueves.
function systemAsistente() {
  const { systemPrompt } = require("../../asistente-api/agent");
  return systemPrompt(null, new Date(`${HOY}T10:00:00Z`));
}
const SYSTEM = process.env.PROMPT === "b" ? SYSTEM_B : process.env.PROMPT === "asistente" ? systemAsistente() : SYSTEM_A;
// Respuesta sin llamada a herramienta que aun asi dice haber hecho algo.
const FAKE_DONE_RE = /\b(hecho|he (añadido|registrado|apuntado|creado|marcado|guardado|anotado))\b/i;

// [frase, herramienta esperada, comprobacion opcional de argumentos]
const CASES = [
  ["Añade leche y huevos a la compra", "compra_anadir", (a) => names(a.productos).includes("leche") && names(a.productos).includes("huevo") && !a.personal],
  // Lista personal: el modelo debe marcarla como tal (la herramienta la
  // rechaza en vez de escribir en el grupo).
  ["Añade tomates a mi lista", "compra_anadir", (a) => a.personal === true || !a.grupo],
  ["Apunta champú en mi lista personal de la compra", "compra_anadir", (a) => a.personal === true || !a.grupo],
  ["¿Qué tengo que comprar?", "compra_ver_lista"],
  ["Ya he comprado el pan", "compra_marcar_comprado", (a) => has(a.productos, "pan")],
  ["Quita los yogures de la lista", "compra_quitar", (a) => has(a.productos, "yogur")],
  ["Añade detergente a la lista del grupo Piso", "compra_anadir", (a) => /piso/i.test(a.grupo || "")],
  ["Recuérdame sacar la basura todos los martes", "tareas_crear", (a) => a.repeticion === "weekly" && a.fecha === "2026-09-29"],
  ["¿Qué tareas tengo pendientes?", "tareas_listar"],
  ["Ya he llamado al fontanero", "tareas_completar", (a) => /fontanero/i.test(a.titulo || "")],
  ["Apunta que el viernes tengo dentista a las 17:00", "calendario_anadir_nota", (a) => a.fecha === "2026-09-25" && (a.hora === "17:00" || /17/.test(a.nota || ""))],
  ["¿Qué tengo esta semana en el calendario?", "calendario_ver"],
  ["He gastado 23,50 en el súper", "gastos_anadir", (a) => Number(String(a.importe).replace(",", ".")) === 23.5],
  ["Pon Netflix, 12,99 al mes, como gasto", "gastos_anadir", (a) => a.mensual === true],
  ["¿Cuánto llevo gastado este mes?", "gastos_resumen_mes"],
  ["¿Qué cenamos mañana?", "menu_ver", (a) => (a.desde || HOY) <= "2026-09-25" && (a.hasta || "9999") >= "2026-09-25"],
  ["El sábado comemos paella", "menu_planificar", (a) => day(a) === "2026-09-26" && a.franja === "comida"],
  ["¿Qué tengo hoy?", "resumen_hoy"],
  // Frases con otra redaccion que NO aparecen en las descripciones de las
  // herramientas, para detectar si solo acierta las que se le han dado
  // como ejemplo.
  ["Nos hemos quedado sin papel higiénico", "compra_anadir", (a) => has(a.productos, "papel")],
  ["¿Falta algo por pillar en el súper?", "compra_ver_lista"],
  ["Tengo que renovar el DNI antes del 15 de octubre", "tareas_crear", (a) => a.fecha === "2026-10-15"],
  ["Listo, la lavadora ya está puesta", "tareas_completar", (a) => /lavadora/i.test(a.titulo || "")],
  ["El 3 de octubre es el cumple de mamá, que no se me olvide", "calendario_anadir_nota", (a) => a.fecha === "2026-10-03" && !a.aviso],
  ["Acabo de echar gasolina, 60 pavos", "gastos_anadir", (a) => Number(String(a.importe).replace(",", ".")) === 60 && a.categoria === "transporte"],
  ["Mañana por la noche toca tortilla de patatas", "menu_planificar", (a) => day(a) === "2026-09-25" && a.franja === "cena"],
  ["¿Voy bien de presupuesto en ocio?", "gastos_resumen_mes"],
  // Añadidos con el asistente de las apps (sep 2026): cantidad por
  // defecto, importancia de tareas, hora y aviso del calendario.
  ["Añade galletas a la lista de la compra", "compra_anadir", (a) => has(a.productos, "galleta") && !a.grupo && !(a.productos || []).some((p) => p.cantidad && p.cantidad !== "1")],
  ["Añade 2 litros de leche", "compra_anadir", (a) => has(a.productos, "leche") && /2/.test(a.productos?.[0]?.cantidad || "")],
  ["Recuérdame pagar la luz, es importante", "tareas_crear", (a) => /luz/i.test(a.titulo || "") && a.importancia === "alta"],
  ["Tengo que ordenar el trastero, no corre prisa", "tareas_crear", (a) => /trastero/i.test(a.titulo || "") && a.importancia === "baja"],
  ["Apunta el dentista el viernes a las 17:00 y avísame media hora antes", "calendario_anadir_nota", (a) => a.fecha === "2026-09-25" && a.hora === "17:00" && a.aviso === "30 minutos antes"],
  ["El lunes a las 9:30 reunión del cole, avísame una hora antes", "calendario_anadir_nota", (a) => a.fecha === "2026-09-28" && a.hora === "09:30" && a.aviso === "1 hora antes"],
  ["El martes 6 de octubre revisión del coche, recuérdamelo el día antes", "calendario_anadir_nota", (a) => a.fecha === "2026-10-06" && a.aviso === "el día anterior"],
  // Recetas (oct 2026): ingredientes que pone el modelo; sin día/franja
  // dichos no debe inventarlos (luego pregunta).
  ["Quiero hacer una lasaña, añade los ingredientes a la compra", "receta_anadir", (a) => /lasa/i.test(a.plato || "") && (a.ingredientes || []).length >= 4 && !day(a) && !a.franja],
  ["Apunta lo que necesito para una tortilla de patatas", "receta_anadir", (a) => has(a.ingredientes, "huevo") && has(a.ingredientes, "patata") && !day(a)],
  ["Añade los ingredientes del gazpacho a la lista del grupo Piso", "receta_anadir", (a) => has(a.ingredientes, "tomate") && /piso/i.test(a.grupo || "")],
  // Precios (oct 2026): datos reales de Mercadona y Dia.
  ["¿Dónde me sale más barata la compra?", "compra_ver_precios", (a) => !(a.productos || []).length],
  ["¿Cuánto cuesta el aceite de oliva en Mercadona?", "compra_ver_precios", (a) => has(a.productos, "aceite")],
  ["Compara los precios de mi lista", "compra_ver_precios"],
  ["El sábado para comer quiero hacer paella, mete lo que hace falta en la lista", "receta_anadir", (a) => has(a.ingredientes, "arroz") && day(a) === "2026-09-26" && a.franja === "comida"],
];

// Dia del menu: la palabra («sabado») la resuelve el servidor (resolveDay).
function day(a) {
  if (a.dia) return resolveDay(a.dia, HOY);
  return a.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(a.fecha) ? resolveDay(a.fecha, HOY) : a.fecha;
}
function names(list) {
  return (list || []).map((p) => String(typeof p === "string" ? p : p?.nombre || "").toLowerCase()).join("|");
}
function has(list, word) {
  return names(list).includes(word);
}

async function toolsForOllama() {
  const server = new McpServer({ name: "hub", version: "eval" });
  registerTools(server, { hub: {} });
  const client = new Client({ name: "eval", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const { tools } = await client.listTools();
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}

async function main() {
  const tools = await toolsForOllama();
  // Calentamiento: la primera peticion carga el modelo en la GPU (10-20 s)
  // y no debe contar en la latencia media al comparar modelos.
  await fetch(`${OLLAMA}/api/generate`, {
    method: "POST",
    body: JSON.stringify({ model: MODEL, prompt: "hola", stream: false, options: { num_predict: 1 } }),
  });
  // Modelos sin razonamiento: Ollama rechaza think=true, asi que se evaluan
  // sin el (y se indica en el resumen).
  const show = await (await fetch(`${OLLAMA}/api/show`, { method: "POST", body: JSON.stringify({ model: MODEL }) })).json();
  const canThink = (show.capabilities || []).includes("thinking");
  if (THINK && !canThink) console.log(`(${MODEL} no soporta thinking: se evalúa sin él)`);
  let okTool = 0;
  let okArgs = 0;
  let totalMs = 0;
  let fakeDone = 0;
  const runs = CASES.flatMap((c) => Array(REPS).fill(c));
  for (const [prompt, expected, check] of runs) {
    const t0 = Date.now();
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        ...(canThink ? { think: THINK } : {}),
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt },
        ],
        tools,
        ...(TEMP !== undefined ? { options: { temperature: TEMP } } : {}),
      }),
    });
    const data = await res.json();
    const call = data.message?.tool_calls?.[0]?.function;
    const got = call?.name || "(ninguna)";
    const args = call?.arguments || {};
    const toolOk = got === expected;
    const argsOk = toolOk && (!check || !!check(args));
    okTool += toolOk;
    okArgs += argsOk;
    const invented = !call && FAKE_DONE_RE.test(data.message?.content || "");
    fakeDone += invented;
    const mark = argsOk ? "OK " : toolOk ? "ARG" : invented ? "INV" : "MAL";
    const reply = !call && data.message?.content ? `  (respondió: ${data.message.content.slice(0, 100).replace(/\n/g, " ")})` : "";
    totalMs += Date.now() - t0;
    if (!QUIET || !argsOk) {
      console.log(`${mark} ${((Date.now() - t0) / 1000).toFixed(1)}s  «${prompt}» -> ${got} ${JSON.stringify(args)}${reply}`);
    }
  }
  const n = runs.length;
  console.log(`\nHerramienta correcta: ${okTool}/${n} · con argumentos correctos: ${okArgs}/${n}` +
    ` (temperatura ${TEMP ?? "por defecto"}, ${REPS} repeticiones, thinking ${THINK && canThink ? "sí" : "no"}, modelo ${MODEL})` +
    ` · media ${(totalMs / n / 1000).toFixed(1)} s por frase` +
    ` · confirmaciones inventadas (dice «hecho» sin llamar a nada): ${fakeDone}/${n}`);
  const { models } = await (await fetch(`${OLLAMA}/api/ps`)).json();
  const loaded = models.find((m) => m.name.startsWith(MODEL.split(":")[0]));
  if (loaded) {
    console.log(
      `Memoria: ${(loaded.size / 2 ** 30).toFixed(1)} GiB, ${((100 * loaded.size_vram) / loaded.size).toFixed(0)}% en GPU` +
        ` (${(loaded.size_vram / 2 ** 30).toFixed(1)} GiB de VRAM), contexto ${loaded.context_length}`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
