// Bucle del asistente: el modelo contesta o pide herramientas; se ejecutan
// (con el token de quien habla, via hub-mcp) y se le devuelven los
// resultados, hasta que da la respuesta final. Todo lo que pasa se va
// emitiendo al navegador (emit) para que el chat lo muestre en vivo.
//
// Sin dependencias de red: chatStream y callTool se inyectan (ver
// server.js), asi el bucle se prueba con un modelo y un hub simulados.

const fs = require("fs");
const path = require("path");

const MAX_STEPS = 6;
const TZ = process.env.TZ || "Europe/Madrid";

// El prompt de sistema vive en un fichero de texto (config/system-prompt.txt)
// que en el cluster llega por el ConfigMap «asistente-prompt», montado en
// /app/config: se ajusta sin reconstruir la imagen ni reiniciar (se lee en
// cada mensaje). Si el ConfigMap falta, esta vacio o no se puede leer, se usa
// la copia que va dentro de la imagen (config-default), para que un fallo de
// configuracion nunca deje al modelo sin reglas.
const PROMPT_FILE = process.env.PROMPT_FILE || path.join(__dirname, "config", "system-prompt.txt");
const PROMPT_FALLBACKS = [path.join(__dirname, "config-default", "system-prompt.txt"), path.join(__dirname, "config", "system-prompt.txt")];
const CONTEXT_MARK = "---contexto---";
let warnedFallback = false;

function readTemplate(file) {
  const text = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n")
    .trim();
  if (!text) throw new Error("prompt vacio");
  return text;
}

function loadTemplate(file = PROMPT_FILE) {
  try {
    return readTemplate(file);
  } catch (err) {
    if (!warnedFallback) {
      console.error(`asistente: no se pudo leer el prompt de ${file} (${err.message}); se usa el de la imagen`);
      warnedFallback = true;
    }
    for (const f of PROMPT_FALLBACKS) {
      try {
        return readTemplate(f);
      } catch {
        // siguiente
      }
    }
    throw new Error("no hay prompt de sistema disponible");
  }
}

function systemPrompt(context, now = new Date(), file = PROMPT_FILE) {
  const dia = new Intl.DateTimeFormat("es-ES", { weekday: "long", timeZone: TZ }).format(now);
  const fecha = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(now);
  const [base, contextTpl = ""] = loadTemplate(file).split(CONTEXT_MARK).map((t) => t.trim());
  let text = base;
  if (context?.app && contextTpl) {
    const donde = `«${context.app}»` + (context.view ? `, viendo ${context.view}` : "");
    text += "\n" + contextTpl.replaceAll("{{donde}}", donde);
  }
  return text.replaceAll("{{dia}}", dia).replaceAll("{{fecha}}", fecha);
}

// Confirmacion de algo hecho («He añadido…», «Listo, planificado»). Si el
// modelo la escribe sin haber llamado a ninguna herramienta, es mentira: no
// se ha guardado nada. gemma4:e4b lo hace a veces, sobre todo cuando el
// usuario contesta a una pregunta suya («¿en qué comida la pongo?» -> «el
// viernes en la cena») y su mensaje anterior ya decia «He añadido…».
const CLAIMS_DONE_RE =
  /^\W*(hecho|listo)\b|\bhe (añadido|registrado|apuntado|creado|marcado|guardado|anotado|puesto|planificado|programado|quitado|borrado|cambiado|completado)\b/i;
const NUDGE =
  "Aviso del sistema: en tu respuesta anterior dices que has hecho un cambio, pero NO has llamado a ninguna herramienta que haya funcionado, así que no se ha guardado nada. Si el usuario ha pedido un cambio, llama ahora a la herramienta adecuada (si dio error, corrige lo que indica); si falta algún dato, pregúntalo.";
const GAVE_UP =
  "Perdona, no he llegado a guardarlo. ¿Me lo pides otra vez, con el día y lo que quieres?";

async function runAgent({ history, context, tools, callTool, chatStream, emit, signal, now }) {
  const messages = [{ role: "system", content: systemPrompt(context, now) }, ...history];
  const actions = [];
  let nudged = false;

  for (let step = 0; step < MAX_STEPS; step++) {
    if (step > 0 && actions.length) emit({ type: "step" });
    const done = actions.some((a) => a.ok);
    let content = "";
    let thinking = false;
    const toolCalls = [];
    // Mientras ninguna herramienta haya funcionado (ni llamada, o solo con
    // error), el texto se retiene hasta el final del paso para poder
    // descartarlo si es una confirmacion inventada (respuestas cortas:
    // apenas se nota). Paso de error real: receta_anadir sin ingredientes
    // -> error -> «He añadido los ingredientes…».
    const hold = !done;

    for await (const chunk of chatStream({ messages, tools, signal })) {
      const m = chunk.message || {};
      if (m.thinking && !thinking) {
        thinking = true;
        emit({ type: "thinking" });
      }
      if (m.content) {
        content += m.content;
        if (!hold) emit({ type: "delta", text: m.content });
      }
      if (m.tool_calls?.length) toolCalls.push(...m.tool_calls);
    }

    if (!toolCalls.length && hold && CLAIMS_DONE_RE.test(content)) {
      if (!nudged) {
        nudged = true;
        messages.push({ role: "assistant", content }, { role: "user", content: NUDGE });
        continue;
      }
      content = GAVE_UP;
    }
    if (hold && content) emit({ type: "delta", text: content });

    messages.push({ role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    if (!toolCalls.length) return { content, actions };

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const args = tc.function?.arguments || {};
      emit({ type: "tool", name });
      let result;
      try {
        result = await callTool(name, args);
      } catch (err) {
        result = { isError: true, text: `Error: ${err.message}` };
      }
      actions.push({ name, ok: !result.isError });
      emit({ type: "tool_done", name, ok: !result.isError });
      messages.push({ role: "tool", tool_name: name, content: result.text });
    }
  }

  // Demasiados pasos seguidos sin respuesta final: se corta en vez de
  // dejar al modelo dando vueltas.
  const text = "He tenido que parar: la petición necesitaba demasiados pasos. Prueba a dividirla.";
  emit({ type: "delta", text });
  return { content: text, actions };
}

// Herramientas que solo leen (no cambian datos): no hace falta avisar a la
// app para que recargue.
function changedData(actions) {
  return actions.some((a) => a.ok && !/^(listar_|resumen_|.*_ver(_|$)|tareas_listar|gastos_resumen)/.test(a.name));
}

module.exports = { runAgent, systemPrompt, changedData, MAX_STEPS, PROMPT_FILE, CLAIMS_DONE_RE, GAVE_UP };
