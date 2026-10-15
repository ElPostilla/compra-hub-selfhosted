const { z } = require("zod");
const { HubError } = require("./hub");
const {
  DATE_RE,
  todayKey,
  addDays,
  weekday,
  DAY_WORDS,
  resolveDay,
  normalize,
  detectShoppingCategory,
  EXPENSE_CATS,
  findByName,
  euroCents,
  euros,
} = require("./util");
const { createRecipeMemory } = require("./recipes");

// Descripciones y parametros en espanol: es lo que lee el modelo (qwen3.8)
// para decidir que herramienta usar, y la gente le habla en espanol.

const fecha = z.string().regex(DATE_RE, "Usa YYYY-MM-DD");
const grupoParam = z
  .string()
  .optional()
  .describe("Nombre del grupo (p.ej. «Casa»). Omitir para lo personal del usuario.");
const repeticion = z.enum(["none", "daily", "weekly", "monthly"]);
// Avisos de las notas del calendario -> minutos antes (calendario-api).
const AVISOS = { "a la hora": 0, "30 minutos antes": 30, "1 hora antes": 60, "el día anterior": 1440 };
const avisoName = (min) => Object.keys(AVISOS).find((k) => AVISOS[k] === min) ?? null;
// Para las herramientas de la compra: ver shoppingTarget().
const compraScope = {
  grupo: z
    .string()
    .optional()
    .describe("Nombre del grupo (p.ej. «familia») SOLO si el usuario lo nombra o está viendo la lista de ese grupo. Sin grupo se usa su lista personal."),
  personal: z
    .boolean()
    .optional()
    .describe(
      "true para su lista personal. Es lo que se usa por defecto cuando no se nombra un grupo, así que no hace falta ponerlo."
    ),
  lista: z
    .string()
    .optional()
    .describe("Nombre de una lista personal concreta (p.ej. «Mercadona») si el usuario la nombra. Implica personal=true."),
};

const producto = z.object({
  nombre: z.string().describe("Producto, p.ej. «leche»"),
  cantidad: z.string().optional().describe("Cantidad libre, p.ej. «2», «2 L» o «1 docena». Omitir si no la dicen (se pone 1)."),
  seccion: z
    .string()
    .optional()
    .describe("Sección de la lista (tienda o para quién, p.ej. «Aldi», «Para mamá») SOLO si el usuario la dice. Si no existe se crea."),
});
const FRANJAS = ["comida", "cena"];
const FALTAN_INGREDIENTES =
  "Faltan los ingredientes: pon tú los ingredientes habituales del plato con sus cantidades y vuelve a llamar a receta_anadir. No se los preguntes al usuario.";
const diaParam = z
  .string()
  .optional()
  .describe(`Si el usuario ha dicho el día con una palabra (${DAY_WORDS.join(", ")}), ponla SIEMPRE aquí tal cual, además de la fecha.`);

// Fecha del menu: AAAA-MM-DD o, si el modelo pone ahi la palabra («mañana»,
// «viernes», pasaba en la evaluacion), se acepta y se convierte. Rechazarla
// le hacia reintentar hasta agotar los pasos.
const fechaMenu = z
  .string()
  .refine((v) => DATE_RE.test(v) || !!resolveDay(v), `Usa YYYY-MM-DD o una de estas palabras: ${DAY_WORDS.join(", ")}`);

// Dia del menu: si el modelo pasa tambien la palabra («viernes»), manda
// sobre la fecha que ha calculado (gemma4:e4b se equivoca a menudo al
// pasar un dia de la semana a fecha, sobre todo en el mensaje siguiente a
// receta_anadir). Una palabra siempre cae en los proximos 7 dias: si la
// fecha es posterior, el usuario ha dado una fecha concreta y se respeta.
function mealDate({ fecha: raw, dia }, hoy = todayKey()) {
  const fecha = raw && !DATE_RE.test(raw) ? resolveDay(raw, hoy) : raw;
  if (!dia) return fecha || null;
  const d = resolveDay(dia, hoy);
  if (!d) return fecha || null;
  if (fecha && fecha > addDays(hoy, 6)) return fecha;
  return d;
}

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

function fail(message) {
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

// Todas las herramientas pasan por aqui: un error de una API (403 por no
// ser miembro, 400 de validacion...) vuelve al modelo como texto legible
// en vez de romper la llamada MCP entera.
function handler(fn) {
  return async (args) => {
    try {
      return await fn(args || {});
    } catch (err) {
      if (err instanceof HubError) return fail(err.message);
      if (err instanceof UserError) return fail(err.message);
      console.error("hub-mcp:", err);
      return fail("fallo interno del asistente, prueba otra vez.");
    }
  };
}

class UserError extends Error {}

function registerTools(server, { hub, userId, recipes = createRecipeMemory() }) {
  let groupsCache = null;
  async function myGroups() {
    groupsCache ??= (await hub.get("lista", "/groups")).groups;
    return groupsCache;
  }

  async function resolveGroup(name) {
    const groups = await myGroups();
    const r = findByName(groups, name, (g) => g.name, "el grupo");
    if (r.error) throw new UserError(r.error);
    return r.match;
  }

  function groupTarget(g) {
    return {
      label: `grupo «${g.name}»`,
      itemsPath: `/groups/${g.id}/list/items`,
      items: async () => (await hub.get("lista", `/groups/${g.id}/list`)).items,
    };
  }

  // Listas personales (guardadas en el servidor, /api/personal). Sin nombre
  // se usa la primera (la de siempre, «Mi lista»); si el usuario esta
  // viendo otra en la app, el modelo la nombra por el contexto.
  async function personalTarget(name) {
    const { lists } = await hub.get("lista", "/personal/lists");
    if (!lists.length) {
      throw new UserError("Todavía no tienes listas personales: abre la app de la compra una vez para crearla.");
    }
    let list = lists[0];
    if (name) {
      const r = findByName(lists, name, (l) => l.name, "la lista personal");
      if (r.error) throw new UserError(r.error);
      list = r.match;
    }
    return {
      label: `tu lista personal «${list.name}»`,
      itemsPath: `/personal/lists/${list.id}/items`,
      items: async () => list.items,
    };
  }

  // A que lista de la compra va cada accion:
  //  - una lista personal nombrada -> esa.
  //  - un grupo nombrado (o el que esta viendo, via contexto) -> ese grupo.
  //  - nada -> SIEMPRE la personal del usuario. (Antes, sin grupo se usaba
  //    el unico grupo del usuario: «añade galletas a la lista de la compra»
  //    acababa en «familia». El usuario quiere lo personal por defecto.)
  // La respuesta de cada herramienta dice siempre en que lista ha actuado.
  async function shoppingTarget({ grupo, lista }) {
    if (lista) return personalTarget(lista);
    if (grupo) return groupTarget(await resolveGroup(grupo));
    return personalTarget();
  }

  // Añade productos a una lista sin duplicar: lo que ya esta pendiente se
  // deja, lo ya comprado (p.ej. un fijo) se vuelve a poner pendiente.
  async function addProducts(t, productos) {
    const items = await t.items();
    const anadidos = [];
    const ya_estaban = [];
    for (const p of productos) {
      const nombre = p.nombre.trim();
      if (!nombre) continue;
      const existing = items.find((it) => normalize(it.name) === normalize(nombre));
      if (existing && !existing.done) {
        ya_estaban.push(existing.name);
        continue;
      }
      if (existing && existing.done) {
        await hub.patch("lista", `${t.itemsPath}/${existing.id}`, {
          done: false,
          ...(p.cantidad ? { qty: p.cantidad } : {}),
          ...(p.seccion ? { section: p.seccion } : {}),
        });
        existing.done = false;
        anadidos.push(existing.name);
        continue;
      }
      const item = await hub.post("lista", t.itemsPath, {
        name: nombre,
        // Sin cantidad, 1 (como al añadir desde la app).
        qty: p.cantidad || "1",
        category: detectShoppingCategory(nombre),
        ...(p.seccion ? { section: p.seccion } : {}),
      });
      items.push(item);
      anadidos.push(item.name);
    }
    return { anadidos, ya_estaban };
  }

  // Prefijo de ruta de las APIs con parte personal + de grupo.
  async function scope(grupo) {
    if (!grupo) return { prefix: "", grupo: null };
    const g = await resolveGroup(grupo);
    return { prefix: `/groups/${g.id}`, grupo: g.name, groupId: g.id };
  }

  // ------------------------------------------------------------ general

  server.registerTool(
    "listar_grupos",
    {
      description:
        "Lista los grupos del usuario (familia, piso...). No hace falta antes de usar la lista de la compra: sus herramientas eligen solas el grupo si el usuario solo tiene uno.",
      annotations: { readOnlyHint: true },
    },
    handler(async () => {
      const groups = await myGroups();
      return ok({ grupos: groups.map((g) => ({ nombre: g.name, miembros: g.memberCount })) });
    })
  );

  server.registerTool(
    "resumen_hoy",
    {
      description:
        "Resumen del día: fecha de hoy, tareas que vencen hoy o atrasadas, notas y eventos del calendario, comida y cena planificadas, lista de la compra pendiente y saldos de gastos de grupo. Úsalo para «¿qué tengo hoy?» o para saber la fecha actual.",
      annotations: { readOnlyHint: true },
    },
    handler(async () => {
      const hoy = todayKey();
      const out = { hoy, dia: weekday(hoy) };
      // Cada bloque por separado: si una API falla, el resto del resumen
      // sigue siendo util.
      const parts = [
        ["tareas", async () => {
          const { tasks } = await hub.get("todo", "/tasks");
          return tasks
            .filter((t) => t.status !== "done" && t.dueDate && t.dueDate <= hoy)
            .map((t) => ({ titulo: t.title, fecha: t.dueDate, atrasada: t.dueDate < hoy }));
        }],
        ["notas_calendario", async () => {
          const { notes } = await hub.get("calendario", "/notes");
          return (notes[hoy] || []).map((n) => ({ nota: n.note, importancia: n.importance }));
        }],
        ["eventos_google", async () => {
          const start = `${hoy}T00:00:00`;
          const end = `${addDays(hoy, 1)}T00:00:00`;
          try {
            const { events } = await hub.get("calendario", `/events?start=${start}&end=${end}`);
            return events.map((e) => ({ titulo: e.title, inicio: e.start, todo_el_dia: e.allDay }));
          } catch (err) {
            if (err instanceof HubError && err.status === 401) return undefined; // Google no conectado
            throw err;
          }
        }],
        ["menu", async () => {
          const { meals } = await hub.get("menu", `/meals?start=${hoy}&end=${hoy}`);
          return Object.fromEntries(meals.map((m) => [m.slot, m.title]));
        }],
        ["compra_pendiente", async () => {
          const groups = await myGroups();
          const [groupLists, personal] = await Promise.all([
            Promise.all(groups.map((g) => hub.get("lista", `/groups/${g.id}/list`))),
            hub.get("lista", "/personal/lists"),
          ]);
          const pending = (items) => items.filter((it) => !it.done).map((it) => it.name);
          return [
            ...personal.lists.map((l) => ({ lista: `tu lista personal «${l.name}»`, productos: pending(l.items) })),
            ...groups.map((g, i) => ({ lista: `grupo «${g.name}»`, productos: pending(groupLists[i].items) })),
          ].filter((l) => l.productos.length);
        }],
        ["saldos_gastos", async () => {
          const { balances } = await hub.get("gastos", "/groups/balances");
          return balances
            .filter((b) => b.balanceCents !== 0)
            .map((b) => ({
              grupo: b.groupName,
              saldo: euros(b.balanceCents),
              significado: b.balanceCents > 0 ? "te deben" : "debes",
            }));
        }],
      ];
      await Promise.all(
        parts.map(async ([key, fn]) => {
          try {
            const value = await fn();
            if (value !== undefined) out[key] = value;
          } catch (err) {
            out[key] = `no disponible (${err.message})`;
          }
        })
      );
      return ok(out);
    })
  );

  // ------------------------------------------------------------ compra

  server.registerTool(
    "compra_ver_lista",
    {
      description:
        "Muestra la lista de la compra (pendientes y ya comprados). Para «¿qué tengo que comprar?», «¿qué falta en la lista?». Si no se nombra grupo, omite «grupo».",
      inputSchema: { ...compraScope },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ grupo, personal, lista }) => {
      const t = await shoppingTarget({ grupo, personal, lista });
      const items = await t.items();
      const fmt = (it) => (it.qty ? `${it.name} (${it.qty})` : it.name) + (it.section ? ` [${it.section}]` : "");
      return ok({
        lista: t.label,
        pendientes: items.filter((it) => !it.done).map(fmt),
        comprados: items.filter((it) => it.done).map(fmt),
      });
    })
  );

  server.registerTool(
    "compra_anadir",
    {
      description:
        "Añade uno o varios productos a la lista de la compra de un grupo. La categoría (pasillo) se calcula sola. Úsalo también cuando el usuario diga que algo se ha acabado o que falta en casa.",
      inputSchema: {
        productos: z.array(producto).min(1),
        ...compraScope,
      },
    },
    handler(async ({ productos, grupo, personal, lista }) => {
      const t = await shoppingTarget({ grupo, personal, lista });
      return ok({ lista: t.label, ...(await addProducts(t, productos)) });
    })
  );

  server.registerTool(
    "compra_marcar_comprado",
    {
      description: "Marca productos de la lista de la compra de un grupo como comprados.",
      inputSchema: { productos: z.array(z.string()).min(1).describe("Nombres de los productos"), ...compraScope },
    },
    handler(async ({ productos, grupo, personal, lista }) => {
      const t = await shoppingTarget({ grupo, personal, lista });
      const items = await t.items();
      const pending = items.filter((it) => !it.done);
      const marcados = [];
      const errores = [];
      for (const name of productos) {
        const r = findByName(pending, name, (it) => it.name, "el producto pendiente");
        if (r.error) {
          errores.push(r.error);
          continue;
        }
        await hub.patch("lista", `${t.itemsPath}/${r.match.id}`, { done: true });
        pending.splice(pending.indexOf(r.match), 1);
        marcados.push(r.match.name);
      }
      return ok({ lista: t.label, marcados, ...(errores.length ? { errores } : {}) });
    })
  );

  server.registerTool(
    "compra_quitar",
    {
      description: "Quita (borra) productos de la lista de la compra de un grupo, sin marcarlos como comprados.",
      inputSchema: { productos: z.array(z.string()).min(1), ...compraScope },
      annotations: { destructiveHint: true },
    },
    handler(async ({ productos, grupo, personal, lista }) => {
      const t = await shoppingTarget({ grupo, personal, lista });
      const items = await t.items();
      const quitados = [];
      const errores = [];
      for (const name of productos) {
        const r = findByName(items, name, (it) => it.name, "el producto");
        if (r.error) {
          errores.push(r.error);
          continue;
        }
        await hub.del("lista", `${t.itemsPath}/${r.match.id}`);
        items.splice(items.indexOf(r.match), 1);
        quitados.push(r.match.name);
      }
      return ok({ lista: t.label, quitados, ...(errores.length ? { errores } : {}) });
    })
  );

  server.registerTool(
    "compra_ver_precios",
    {
      description:
        "Compara precios reales de Mercadona y Dia para la lista de la compra (lo pendiente) o para productos concretos: total de la lista en cada súper y el más barato de cada producto. Para «¿dónde me sale más barata la compra?», «¿cuánto cuesta el aceite en Mercadona?». Tarda unos segundos.",
      inputSchema: {
        productos: z.array(z.string()).optional().describe("Solo si pregunta por productos concretos; si no, se usa lo pendiente de la lista"),
        ...compraScope,
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ productos, grupo, personal, lista }) => {
      let label = null;
      let items;
      if (productos?.length) {
        items = productos.map((name) => ({ name, qty: "1" }));
      } else {
        const t = await shoppingTarget({ grupo, personal, lista });
        label = t.label;
        items = (await t.items()).filter((it) => !it.done).map((it) => ({ name: it.name, qty: it.qty || "1" }));
        if (!items.length) return ok({ lista: label, aviso: "No hay nada pendiente en la lista." });
      }
      // Cada producto son dos busquedas y una eleccion del modelo: con
      // listas largas se corta para responder en menos de un minuto.
      const MAX = 25;
      const r = await hub.post("lista", "/prices", { items: items.slice(0, MAX) }, { timeoutMs: 55000 });
      const fmt = (x) => (x.price_eur == null ? "no encontrado" : `${euros(Math.round(x.price_eur * 100))} (${x.match_name}${x.unit_price ? `, ${x.unit_price}` : ""})`);
      const byProduct = {};
      for (const x of r.results) (byProduct[x.product] ??= []).push(x);
      const por_producto = Object.entries(byProduct).map(([producto, rows]) => {
        const found = rows.filter((x) => x.price_eur != null);
        const sameUnit = found.length > 1 && found.every((x) => x.unit_price_eur != null && x.unit === found[0].unit);
        const cost = (x) => (sameUnit ? x.unit_price_eur : x.price_eur);
        const best = found.sort((a, b) => cost(a) - cost(b))[0];
        return { producto, ...Object.fromEntries(rows.map((x) => [x.supermarket, fmt(x)])), ...(best && found.length > 1 ? { mas_barato: best.supermarket } : {}) };
      });
      const totals = r.totals || [];
      const comparable = totals.length > 1 && totals.every((t) => t.found === totals[0].found);
      return ok({
        ...(label ? { lista: label } : {}),
        ...(items.length > 1
          ? {
              total: totals.map((t) => ({ super: t.supermarket, total: euros(Math.round(t.total_eur * 100)), encontrados: `${t.found} de ${t.of}` })),
              ...(comparable ? { mas_barata: [...totals].sort((a, b) => a.total_eur - b.total_eur)[0].supermarket } : {}),
            }
          : {}),
        por_producto,
        ...(items.length > MAX ? { aviso: `Solo se han comparado los primeros ${MAX} productos.` } : {}),
        nota: "Precios de las tiendas online ahora mismo; el producto de cada tienda lo elige el asistente.",
      });
    })
  );

  // ------------------------------------------------------------ tareas

  server.registerTool(
    "tareas_listar",
    {
      description: "Lista las tareas pendientes (personales o de un grupo), en el orden que el usuario les ha dado.",
      inputSchema: {
        grupo: grupoParam,
        incluir_hechas: z.boolean().optional().describe("true para incluir también las ya hechas"),
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ grupo, incluir_hechas }) => {
      const s = await scope(grupo);
      const { tasks } = await hub.get("todo", `${s.prefix}/tasks`);
      const hoy = todayKey();
      const list = tasks
        .filter((t) => incluir_hechas || t.status !== "done")
        // Sin reordenar: la API ya las da en el orden que el usuario ha
        // puesto a mano (por estado y posicion).
        .map((t) => ({
          titulo: t.title,
          estado: { todo: "por hacer", doing: "en curso", done: "hecha" }[t.status],
          ...(t.importance && t.importance !== "media" ? { importancia: t.importance } : {}),
          ...(t.dueDate ? { fecha: t.dueDate, ...(t.dueDate < hoy && t.status !== "done" ? { atrasada: true } : {}) } : {}),
          ...(t.recurrence !== "none" ? { repeticion: t.recurrence } : {}),
        }));
      return ok({ ambito: s.grupo || "personal", hoy, tareas: list });
    })
  );

  server.registerTool(
    "tareas_crear",
    {
      description:
        "Crea una tarea o recordatorio (personal o de grupo), opcionalmente con fecha límite y repetición. Para «recuérdame…», «tengo que…». Si se repite, «fecha» es la primera vez (p.ej. «todos los martes» → el próximo martes + weekly).",
      inputSchema: {
        titulo: z.string().min(1),
        fecha: fecha.optional().describe("Fecha límite YYYY-MM-DD"),
        repeticion: repeticion.optional().describe("none, daily, weekly o monthly (necesita fecha)"),
        importancia: z
          .enum(["baja", "media", "alta"])
          .optional()
          .describe("alta si el usuario dice que es importante o urgente; baja si dice que no corre prisa. Si no dice nada, omitir (media)."),
        grupo: grupoParam,
      },
    },
    handler(async ({ titulo, fecha: dueDate, repeticion: recurrence, importancia, grupo }) => {
      if (recurrence && recurrence !== "none" && !dueDate) {
        throw new UserError("Una tarea que se repite necesita fecha de inicio.");
      }
      const s = await scope(grupo);
      const t = await hub.post("todo", `${s.prefix}/tasks`, {
        title: titulo.trim(),
        dueDate: dueDate || null,
        recurrence: recurrence || "none",
        ...(importancia ? { importance: importancia } : {}),
      });
      return ok({
        ambito: s.grupo || "personal",
        creada: { titulo: t.title, fecha: t.dueDate, repeticion: t.recurrence, importancia: t.importance },
      });
    })
  );

  server.registerTool(
    "tareas_completar",
    {
      description:
        "Marca como hecha una tarea pendiente, buscándola por su título (vale una parte, p.ej. «fontanero»). Úsalo cuando el usuario diga que ya ha hecho o terminado algo: «ya he llamado al fontanero», «he sacado la basura». Si no hay ninguna tarea con ese nombre, la herramienta devuelve las pendientes y no marca nada.",
      inputSchema: { titulo: z.string().min(1), grupo: grupoParam },
    },
    handler(async ({ titulo, grupo }) => {
      const s = await scope(grupo);
      const { tasks } = await hub.get("todo", `${s.prefix}/tasks`);
      const r = findByName(tasks.filter((t) => t.status !== "done"), titulo, (t) => t.title, "la tarea pendiente");
      if (r.error) throw new UserError(r.error);
      await hub.patch("todo", `${s.prefix}/tasks/${r.match.id}`, { status: "done" });
      return ok({ ambito: s.grupo || "personal", completada: r.match.title });
    })
  );

  // ------------------------------------------------------------ calendario

  server.registerTool(
    "calendario_ver",
    {
      description:
        "Notas del calendario (personal o de grupo) entre dos fechas, incluidas las que se repiten. En el personal incluye también los eventos de Google Calendar si están conectados.",
      inputSchema: {
        desde: fecha.optional().describe("YYYY-MM-DD, por defecto hoy"),
        hasta: fecha.optional().describe("YYYY-MM-DD, por defecto 6 días después de «desde»"),
        grupo: grupoParam,
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ desde, hasta, grupo }) => {
      const start = desde || todayKey();
      const end = hasta || addDays(start, 6);
      if (end < start) throw new UserError("«hasta» es anterior a «desde».");
      const s = await scope(grupo);
      const { notes } = await hub.get("calendario", `${s.prefix}/notes`);
      const dias = Object.keys(notes)
        .filter((d) => d >= start && d <= end)
        .sort()
        .map((d) => ({
          fecha: d,
          dia: weekday(d),
          notas: notes[d].map((n) => ({
            nota: n.note,
            importancia: n.importance,
            ...(n.time ? { hora: n.time } : {}),
            ...(n.remindMinutes !== null && n.remindMinutes !== undefined ? { aviso: avisoName(n.remindMinutes) } : {}),
            ...(n.recurrence !== "none" ? { repeticion: n.recurrence } : {}),
          })),
        }));
      const out = { ambito: s.grupo || "personal", desde: start, hasta: end, dias };
      if (!s.prefix) {
        try {
          const { events } = await hub.get(
            "calendario",
            `/events?start=${start}T00:00:00&end=${addDays(end, 1)}T00:00:00`
          );
          out.eventos_google = events.map((e) => ({ titulo: e.title, inicio: e.start, fin: e.end, todo_el_dia: e.allDay }));
        } catch (err) {
          if (!(err instanceof HubError && err.status === 401)) out.eventos_google = `no disponible (${err.message})`;
        }
      }
      return ok(out);
    })
  );

  server.registerTool(
    "calendario_anadir_nota",
    {
      description:
        "Apunta una nota o recordatorio en un día del calendario (personal o de grupo), con hora opcional y aviso opcional en el móvil. Pon «aviso» SOLO si el usuario pide que le avisen («avísame…», «recuérdamelo el día antes…»); «que no se me olvide» o una simple fecha NO llevan aviso.",
      inputSchema: {
        fecha,
        nota: z.string().min(1),
        importancia: z.enum(["baja", "media", "alta"]).optional(),
        repeticion: repeticion.optional(),
        hora: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Usa HH:MM").optional().describe("Hora HH:MM (24 h) si la dice, p.ej. «17:30»"),
        aviso: z
          .enum(Object.keys(AVISOS))
          .optional()
          .describe("Solo si pide explícitamente un aviso («avísame media hora antes»...); si no lo pide, omitir. Sin hora, se avisa a las 9:00."),
        grupo: grupoParam,
      },
    },
    handler(async ({ fecha: date, nota, importancia, repeticion: recurrence, hora, aviso, grupo }) => {
      const s = await scope(grupo);
      await hub.post("calendario", `${s.prefix}/notes`, {
        date,
        note: nota.trim(),
        importance: importancia || "media",
        recurrence: recurrence || "none",
        time: hora || null,
        remindMinutes: aviso ? AVISOS[aviso] : null,
      });
      return ok({
        ambito: s.grupo || "personal",
        apuntada: { fecha: date, dia: weekday(date), nota: nota.trim(), ...(hora ? { hora } : {}), ...(aviso ? { aviso } : {}) },
      });
    })
  );

  // ------------------------------------------------------------ gastos

  server.registerTool(
    "gastos_anadir",
    {
      description:
        "Registra un gasto (personal o de grupo; en grupo se reparte a partes iguales y lo paga el usuario).",
      inputSchema: {
        descripcion: z.string().min(1),
        importe: z.union([z.number(), z.string()]).describe("En euros, p.ej. 23.5 o «23,50»"),
        categoria: z.enum(EXPENSE_CATS).optional(),
        fecha: fecha.optional().describe("YYYY-MM-DD, por defecto hoy"),
        mensual: z.boolean().optional().describe("true si se repite cada mes (alquiler, suscripciones...)"),
        grupo: grupoParam,
      },
    },
    handler(async ({ descripcion, importe, categoria, fecha: date, mensual, grupo }) => {
      const amountCents = euroCents(importe);
      if (!amountCents) throw new UserError(`Importe no válido: «${importe}».`);
      const s = await scope(grupo);
      const e = await hub.post("gastos", `${s.prefix}/expenses`, {
        description: descripcion.trim(),
        amountCents,
        category: categoria || "otros",
        date: date || todayKey(),
        recurrence: mensual ? "monthly" : "none",
      });
      return ok({
        ambito: s.grupo || "personal",
        registrado: { descripcion: e.description, importe: euros(e.amountCents), categoria: e.category, fecha: e.date },
      });
    })
  );

  server.registerTool(
    "gastos_resumen_mes",
    {
      description:
        "Resumen de gastos de un mes (personal o de grupo): total, total por categoría frente al presupuesto y últimos gastos. En grupo, incluye el saldo de cada miembro y quién debe a quién (deudas pendientes).",
      inputSchema: {
        mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe("YYYY-MM, por defecto el mes actual"),
        grupo: grupoParam,
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ mes, grupo }) => {
      const month = mes || todayKey().slice(0, 7);
      const s = await scope(grupo);
      const [{ expenses }, { budgets }] = await Promise.all([
        hub.get("gastos", `${s.prefix}/expenses`),
        hub.get("gastos", `${s.prefix}/budgets`),
      ]);
      const inMonth = expenses.filter((e) => String(e.date).startsWith(month));
      const byCat = {};
      for (const e of inMonth) byCat[e.category || "otros"] = (byCat[e.category || "otros"] || 0) + e.amountCents;
      const budgetMap = Object.fromEntries(budgets.map((b) => [b.category, b.amountCents]));
      const out = {
        ambito: s.grupo || "personal",
        mes: month,
        total: euros(inMonth.reduce((sum, e) => sum + e.amountCents, 0)),
        por_categoria: Object.entries(byCat).map(([cat, cents]) => ({
          categoria: cat,
          gastado: euros(cents),
          ...(budgetMap[cat] ? { presupuesto: euros(budgetMap[cat]), superado: cents > budgetMap[cat] } : {}),
        })),
        ultimos: inMonth.slice(0, 5).map((e) => ({ descripcion: e.description, importe: euros(e.amountCents), fecha: e.date })),
      };
      if (s.groupId) {
        const { balances, debts = [] } = await hub.get("gastos", `/groups/${s.groupId}/balance`);
        out.saldos = balances.map((b) => ({ usuario: b.username, saldo: euros(b.balanceCents) }));
        out.deudas_pendientes = debts.map((d) => ({ debe: d.fromUsername, a: d.toUsername, importe: euros(d.amountCents) }));
      }
      return ok(out);
    })
  );

  // ------------------------------------------------------------ menu

  server.registerTool(
    "menu_ver",
    {
      description: "Comidas y cenas planificadas (personal o de grupo) entre dos fechas.",
      inputSchema: {
        desde: fecha.optional().describe("YYYY-MM-DD, por defecto hoy"),
        hasta: fecha.optional().describe("YYYY-MM-DD, por defecto 6 días después de «desde»"),
        grupo: grupoParam,
      },
      annotations: { readOnlyHint: true },
    },
    handler(async ({ desde, hasta, grupo }) => {
      const start = desde || todayKey();
      const end = hasta || addDays(start, 6);
      const s = await scope(grupo);
      const { meals } = await hub.get("menu", `${s.prefix}/meals?start=${start}&end=${end}`);
      const byDay = {};
      for (const m of meals) (byDay[m.date] ??= { fecha: m.date, dia: weekday(m.date) })[m.slot] = m.title;
      return ok({ ambito: s.grupo || "personal", desde: start, hasta: end, dias: Object.values(byDay) });
    })
  );

  // Lo que hay ya planificado en un dia/franja (para avisar al sustituirlo).
  async function mealAt(s, date, franja) {
    const { meals } = await hub.get("menu", `${s.prefix}/meals?start=${date}&end=${date}`);
    return meals.find((m) => m.slot === franja) || null;
  }

  // Mismo plato con otro nombre corto o largo («paella» / «Paella de marisco»).
  const samePlate = (a, b) => {
    const x = normalize(a);
    const y = normalize(b);
    return !!x && !!y && (x.includes(y) || y.includes(x));
  };

  // Ingredientes que ya tenia el plato + los nuevos, sin repetir: si alguien
  // los apunto a mano en el menu, no se pierden.
  function mergeIngredients(existing, added) {
    const out = [...(existing || [])];
    for (const i of added || []) if (!out.some((e) => normalize(e) === normalize(i))) out.push(i);
    return out;
  }

  async function planMeal(s, date, franja, plato, ingredientes) {
    const before = await mealAt(s, date, franja);
    const keep = before && samePlate(before.title, plato) ? before.ingredients : [];
    const m = await hub.put("menu", `${s.prefix}/meals/${date}/${franja}`, {
      title: plato.trim(),
      ...(ingredientes ? { ingredients: mergeIngredients(keep, ingredientes) } : {}),
    });
    const replaced = before && normalize(before.title) !== normalize(m.title) ? before.title : null;
    return {
      fecha: m.date,
      dia: weekday(m.date),
      franja: m.slot,
      plato: m.title,
      ...(replaced ? { sustituye_a: replaced } : {}),
      // Frase con el dia REAL guardado: si el modelo calculo mal la fecha,
      // el usuario lo ve en la respuesta en vez de leer el dia que pidio.
      di_al_usuario: `${m.title}: ${weekday(m.date)} ${Number(m.date.slice(8))}, en la ${m.slot}${replaced ? ` (en lugar de ${replaced})` : ""}.`,
    };
  }

  // El plato en el menu de los proximos 14 dias: el del grupo nombrado o,
  // sin grupo, el personal y luego los de sus grupos. El mas cercano.
  async function findPlanned(plato, grupo) {
    const hoy = todayKey();
    const end = addDays(hoy, 13);
    const scopes = grupo
      ? [await scope(grupo)]
      : [{ prefix: "", grupo: null }, ...(await myGroups()).map((g) => ({ prefix: `/groups/${g.id}`, grupo: g.name }))];
    for (const sc of scopes) {
      const { meals } = await hub.get("menu", `${sc.prefix}/meals?start=${hoy}&end=${end}`);
      const meal = meals
        .filter((m) => samePlate(m.title, plato))
        .sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot))[0];
      if (meal) return { meal, prefix: sc.prefix, ambito: sc.grupo || "personal" };
    }
    return null;
  }

  server.registerTool(
    "menu_planificar",
    {
      description:
        "Pone (o cambia) el plato de la comida o la cena de un día en el menú (personal o de grupo). Úsalo cuando el usuario diga qué se va a comer o cenar: «el sábado comemos paella», «mañana cenamos pizza» (si además quiere los ingredientes en la compra, usa receta_anadir), o cuando diga en qué comida va una receta cuyos ingredientes ya se han añadido (pasa entonces también sus ingredientes).",
      inputSchema: {
        fecha: fechaMenu.describe("YYYY-MM-DD"),
        dia: diaParam,
        franja: z.enum(FRANJAS),
        plato: z.string().min(1),
        ingredientes: z.array(z.string()).optional().describe("Nombres de los ingredientes del plato, si se conocen"),
        grupo: grupoParam,
      },
    },
    handler(async ({ dia, fecha: f, franja, plato, ingredientes, grupo }) => {
      const date = mealDate({ fecha: f, dia });
      const s = await scope(grupo);
      // Sin ingredientes: los de la receta que se acaba de añadir a la
      // compra, si es este plato (ver recipes.js).
      const ings = ingredientes?.length ? ingredientes : recipes.recall(userId, plato) || undefined;
      return ok({ ambito: s.grupo || "personal", planificado: await planMeal(s, date, franja, plato, ings) });
    })
  );

  server.registerTool(
    "receta_anadir",
    {
      description:
        "Añade a la lista de la compra los ingredientes de un plato o receta («quiero hacer lasaña, apunta los ingredientes»). Pon tú los ingredientes habituales con cantidades (unas 4 raciones; sin agua, sal ni pimienta): no se los preguntes al usuario. Pon fecha y franja solo si el usuario las ha dicho; si no, y el plato ya está en el menú, se le ponen allí los ingredientes; si no está, la respuesta trae los huecos libres y debes preguntar en qué comida lo pone.",
      inputSchema: {
        plato: z.string().min(1).describe("Nombre del plato, p.ej. «Lasaña de carne»"),
        // Obligatorio (si es opcional el modelo lo omite mas), pero con un
        // mensaje de error que le dice que los ponga el: con el generico de
        // validacion acababa preguntandoselos al usuario.
        ingredientes: z
          .array(producto, { required_error: FALTAN_INGREDIENTES })
          .min(1, FALTAN_INGREDIENTES)
          .describe("Los ingredientes habituales del plato, puestos por ti"),
        fecha: fechaMenu.optional().describe("Día del menú YYYY-MM-DD, SOLO si el usuario lo ha dicho"),
        dia: diaParam,
        franja: z.enum(FRANJAS).optional().describe("comida o cena, SOLO si el usuario lo ha dicho"),
        ...compraScope,
      },
    },
    handler(async ({ plato, ingredientes, dia, fecha: f, franja, grupo, personal, lista }) => {
      const date = mealDate({ fecha: f, dia });
      if (!!date !== !!franja) {
        throw new UserError("Para ponerlo en el menú hacen falta el día y si es comida o cena; si falta uno, omite los dos y pregúntalo.");
      }
      const t = await shoppingTarget({ grupo, personal, lista });
      const added = await addProducts(t, ingredientes);
      const out = { plato: plato.trim(), lista: t.label, ...added };
      // El menu va al mismo ambito que la lista: el del grupo si se ha
      // nombrado, si no el personal.
      const s = await scope(grupo);
      const nombres = ingredientes.map((i) => i.nombre.trim()).filter(Boolean);
      if (date) {
        out.menu = { ambito: s.grupo || "personal", planificado: await planMeal(s, date, franja, plato, nombres) };
        return ok(out);
      }
      recipes.remember(userId, plato.trim(), nombres);
      // ¿El plato ya esta en el menu («el sabado comemos paella» y despues
      // «añade los ingredientes»)? Entonces se le ponen los ingredientes alli
      // y no se pregunta nada.
      const planned = await findPlanned(plato, grupo);
      if (planned) {
        const m = await hub.put("menu", `${planned.prefix}/meals/${planned.meal.date}/${planned.meal.slot}`, {
          title: planned.meal.title,
          ingredients: mergeIngredients(planned.meal.ingredients, nombres),
        });
        out.menu = {
          ambito: planned.ambito,
          ingredientes_guardados_en: { fecha: m.date, dia: weekday(m.date), franja: m.slot, plato: m.title },
          di_al_usuario: `Ya estaba en el menú (${planned.ambito === "personal" ? "tu menú" : `menú del grupo «${planned.ambito}»`}): ${m.title}, ${weekday(m.date)} ${Number(m.date.slice(8))} en la ${m.slot}. Le he puesto los ingredientes.`,
        };
        return ok(out);
      }
      const hoy = todayKey();
      const end = addDays(hoy, 6);
      const { meals } = await hub.get("menu", `${s.prefix}/meals?start=${hoy}&end=${end}`);
      const taken = new Set(meals.filter((m) => m.title?.trim()).map((m) => `${m.date}/${m.slot}`));
      const huecos = [];
      for (let d = hoy; d <= end; d = addDays(d, 1)) {
        for (const f of FRANJAS) if (!taken.has(`${d}/${f}`)) huecos.push({ fecha: d, dia: weekday(d), franja: f });
      }
      out.menu = {
        ambito: s.grupo || "personal",
        sin_planificar: true,
        huecos_libres_esta_semana: huecos.slice(0, 8),
        // Los ingredientes no hace falta repetirlos: menu_planificar los
        // recupera (recipes.js).
        siguiente_paso: `Responde nombrando los ingredientes añadidos y pregunta en qué día y si en la comida o en la cena del menú quiere poner «${plato.trim()}», proponiendo dos huecos libres con su día y su fecha (p.ej. «¿el ${huecos[0] ? `${huecos[0].dia} ${Number(huecos[0].fecha.slice(8))}` : "viernes 2"} en la ${huecos[0]?.franja || "cena"}?»). Cuando conteste, usa menu_planificar con ese plato.`,
      };
      return ok(out);
    })
  );
}

module.exports = { registerTools };
