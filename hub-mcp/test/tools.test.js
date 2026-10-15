// Prueba las herramientas a traves de un cliente MCP real (transporte en
// memoria del SDK) contra un hub simulado que registra cada llamada: valida
// esquemas, rutas y cuerpos que llegarian a las APIs.
const test = require("node:test");
const assert = require("node:assert/strict");
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { Client } = require("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = require("@modelcontextprotocol/sdk/inMemory.js");
const { HubError } = require("../hub");
const { registerTools } = require("../tools");
const { createRecipeMemory } = require("../recipes");
const { todayKey, addDays } = require("../util");

const CASA = { id: "g1", name: "Casa", memberCount: 3 };

function fakeHub(routes) {
  const calls = [];
  const handle = (method) => async (api, path, body) => {
    calls.push({ method, api, path, body });
    const key = `${method} ${api} ${path}`;
    const r = routes[key];
    if (r === undefined) throw new HubError(`ruta no simulada: ${key}`, 404);
    return typeof r === "function" ? r(body) : r;
  };
  return {
    calls,
    hub: { get: handle("GET"), post: handle("POST"), put: handle("PUT"), patch: handle("PATCH"), del: handle("DELETE") },
  };
}

async function connect(routes, opts = {}) {
  const { hub, calls } = fakeHub(routes);
  const server = new McpServer({ name: "hub", version: "test" });
  registerTools(server, { hub, ...opts });
  const client = new Client({ name: "test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    const text = r.content[0].text;
    return { isError: !!r.isError, text, data: r.isError ? null : JSON.parse(text) };
  };
  return { client, call, calls };
}

test("expone todas las herramientas", async () => {
  const { client } = await connect({});
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "calendario_anadir_nota", "calendario_ver", "compra_anadir", "compra_marcar_comprado", "compra_quitar",
      "compra_ver_lista", "compra_ver_precios", "gastos_anadir", "gastos_resumen_mes", "listar_grupos", "menu_planificar",
      "menu_ver", "receta_anadir", "resumen_hoy", "tareas_completar", "tareas_crear", "tareas_listar",
    ]
  );
});

test("compra_anadir en un grupo nombrado: categoriza, no duplica y reactiva comprados", async () => {
  const { call, calls } = await connect({
    "GET lista /groups": { groups: [CASA] },
    "GET lista /groups/g1/list": {
      items: [
        { id: "i1", name: "Leche", done: false },
        { id: "i2", name: "Pan", done: true },
      ],
    },
    "PATCH lista /groups/g1/list/items/i2": { id: "i2", name: "Pan", done: false },
    "POST lista /groups/g1/list/items": (body) => ({ id: "i3", name: body.name, done: false }),
  });
  const r = await call("compra_anadir", {
    productos: [{ nombre: "leche" }, { nombre: "pan" }, { nombre: "Plátanos", cantidad: "1 kg" }],
    grupo: "casa",
  });
  assert.deepEqual(r.data, { lista: "grupo «Casa»", anadidos: ["Pan", "Plátanos"], ya_estaban: ["Leche"] });
  const post = calls.find((c) => c.method === "POST");
  assert.deepEqual(post.body, { name: "Plátanos", qty: "1 kg", category: "fruver" });
  assert.deepEqual(calls.find((c) => c.method === "PATCH").body, { done: false });
});

// Funciones (no objetos compartidos): las herramientas modifican la lista
// que reciben, y la API real devuelve siempre un JSON nuevo.
const MI_LISTA = () => ({ id: "p1", name: "Mi lista", items: [{ id: "x1", name: "Pan", done: false }] });
const MERCADONA = () => ({ id: "p2", name: "Mercadona", items: [] });

test("compra: «mi lista» escribe en la lista personal, nunca en el grupo", async () => {
  const { call, calls } = await connect({
    "GET lista /groups": { groups: [CASA] },
    "GET lista /personal/lists": () => ({ lists: [MI_LISTA()] }),
    "POST lista /personal/lists/p1/items": (b) => ({ id: "x2", name: b.name, done: false }),
  });
  const r = await call("compra_anadir", { productos: [{ nombre: "leche" }], personal: true });
  assert.deepEqual(r.data, { lista: "tu lista personal «Mi lista»", anadidos: ["leche"], ya_estaban: [] });
  assert.equal(calls.some((c) => c.path.startsWith("/groups/g1/list/items")), false);
});

test("compra: con varias listas personales usa la primera, o la nombrada", async () => {
  const routes = {
    "GET lista /personal/lists": () => ({ lists: [MI_LISTA(), MERCADONA()] }),
    "POST lista /personal/lists/p2/items": (b) => ({ id: "y1", name: b.name, done: false }),
  };
  const { call } = await connect(routes);
  routes["POST lista /personal/lists/p1/items"] = (b) => ({ id: "y0", name: b.name, done: false });
  const porDefecto = await call("compra_anadir", { productos: [{ nombre: "agua" }], personal: true });
  assert.equal(porDefecto.data.lista, "tu lista personal «Mi lista»");
  const r = await call("compra_anadir", { productos: [{ nombre: "agua" }], lista: "mercadona" });
  assert.equal(r.data.lista, "tu lista personal «Mercadona»");
});

test("compra: sin grupos ni «mi lista», usa la lista personal", async () => {
  const { call } = await connect({
    "GET lista /groups": { groups: [] },
    "GET lista /personal/lists": () => ({ lists: [MI_LISTA()] }),
  });
  const r = await call("compra_ver_lista", {});
  assert.deepEqual(r.data, { lista: "tu lista personal «Mi lista»", pendientes: ["Pan"], comprados: [] });
});

test("compra: sin grupo va SIEMPRE a la lista personal, aunque haya grupos", async () => {
  const { call, calls } = await connect({
    "GET lista /groups": { groups: [CASA] },
    "GET lista /personal/lists": () => ({ lists: [MI_LISTA(), MERCADONA()] }),
    "POST lista /personal/lists/p1/items": (b) => ({ id: "z", name: b.name, done: false }),
  });
  const r = await call("compra_anadir", { productos: [{ nombre: "galletas" }] });
  assert.equal(r.data.lista, "tu lista personal «Mi lista»");
  assert.equal(calls.some((c) => c.path.startsWith("/groups/")), false);
  // Sin cantidad: 1, como al añadir desde la app.
  assert.deepEqual(calls.find((c) => c.method === "POST").body, { name: "galletas", qty: "1", category: "despensa" });
});

test("compra_marcar_comprado: marca lo que encuentra e informa de lo que no", async () => {
  const { call, calls } = await connect({
    "GET lista /groups": { groups: [CASA] },
    "GET lista /groups/g1/list": { items: [{ id: "i1", name: "Huevos", done: false }] },
    "PATCH lista /groups/g1/list/items/i1": { id: "i1", done: true },
  });
  const r = await call("compra_marcar_comprado", { productos: ["huevos", "yogur"], grupo: "Casa" });
  assert.deepEqual(r.data.marcados, ["Huevos"]);
  assert.match(r.data.errores[0], /yogur/);
  assert.deepEqual(calls.find((c) => c.method === "PATCH").body, { done: true });
});

test("tareas_crear en un grupo por nombre, sin tildes ni mayúsculas", async () => {
  const { call, calls } = await connect({
    "GET lista /groups": { groups: [{ id: "g9", name: "Familia Pérez", memberCount: 4 }] },
    "POST todo /groups/g9/tasks": (b) => ({ title: b.title, dueDate: b.dueDate, recurrence: b.recurrence }),
  });
  const r = await call("tareas_crear", { titulo: "Sacar la basura", fecha: "2026-09-29", repeticion: "weekly", grupo: "familia perez" });
  assert.equal(r.data.ambito, "Familia Pérez");
  assert.deepEqual(calls.at(-1).body, { title: "Sacar la basura", dueDate: "2026-09-29", recurrence: "weekly" });
});

test("tareas_crear pasa la importancia si se indica", async () => {
  const { call, calls } = await connect({
    "POST todo /tasks": (b) => ({ title: b.title, dueDate: null, recurrence: "none", importance: b.importance || "media" }),
  });
  const r = await call("tareas_crear", { titulo: "Pagar la luz", importancia: "alta" });
  assert.equal(r.data.creada.importancia, "alta");
  assert.equal(calls.at(-1).body.importance, "alta");
  await call("tareas_crear", { titulo: "Regar" });
  assert.equal("importance" in calls.at(-1).body, false);
});

test("tareas_crear rechaza repetición sin fecha y fechas mal formadas", async () => {
  const { call } = await connect({});
  assert.equal((await call("tareas_crear", { titulo: "x", repeticion: "daily" })).isError, true);
  const bad = await call("tareas_crear", { titulo: "x", fecha: "29/09/2026" });
  assert.equal(bad.isError, true);
});

test("tareas_completar busca solo entre pendientes", async () => {
  const { call, calls } = await connect({
    "GET todo /tasks": {
      tasks: [
        { id: 1, title: "Llamar al dentista", status: "done", recurrence: "none" },
        { id: 2, title: "Llamar al fontanero", status: "todo", recurrence: "none" },
      ],
    },
    "PATCH todo /tasks/2": {},
  });
  const r = await call("tareas_completar", { titulo: "llamar" });
  assert.equal(r.data.completada, "Llamar al fontanero");
  assert.deepEqual(calls.at(-1).body, { status: "done" });
});

test("gastos_anadir convierte euros a céntimos y usa hoy por defecto", async () => {
  const { call, calls } = await connect({
    "POST gastos /expenses": (b) => ({ description: b.description, amountCents: b.amountCents, category: b.category, date: b.date }),
  });
  const r = await call("gastos_anadir", { descripcion: "Súper", importe: "23,50", categoria: "comida" });
  assert.equal(r.data.registrado.importe, "23,50 €");
  assert.deepEqual(calls[0].body, { description: "Súper", amountCents: 2350, category: "comida", date: todayKey(), recurrence: "none" });
  assert.equal((await call("gastos_anadir", { descripcion: "x", importe: "gratis" })).isError, true);
});

test("gastos_resumen_mes suma por categoría y compara con presupuesto", async () => {
  const { call } = await connect({
    "GET gastos /expenses": {
      expenses: [
        { description: "Súper", amountCents: 6000, category: "comida", date: "2026-09-10" },
        { description: "Bar", amountCents: 2500, category: "comida", date: "2026-09-12" },
        { description: "Agosto", amountCents: 9999, category: "comida", date: "2026-08-30" },
      ],
    },
    "GET gastos /budgets": { budgets: [{ category: "comida", amountCents: 8000 }] },
  });
  const r = await call("gastos_resumen_mes", { mes: "2026-09" });
  assert.equal(r.data.total, "85,00 €");
  assert.deepEqual(r.data.por_categoria, [{ categoria: "comida", gastado: "85,00 €", presupuesto: "80,00 €", superado: true }]);
});

test("calendario_ver filtra el rango y omite Google si no está conectado", async () => {
  const { call } = await connect({
    "GET calendario /notes": {
      notes: {
        "2026-09-24": [{ note: "Dentista 17:00", importance: "alta", recurrence: "none" }],
        "2026-10-30": [{ note: "Fuera de rango", importance: "baja", recurrence: "none" }],
      },
    },
    "GET calendario /events?start=2026-09-24T00:00:00&end=2026-09-26T00:00:00": () => {
      throw new HubError("No conectado con Google Calendar.", 401);
    },
  });
  const r = await call("calendario_ver", { desde: "2026-09-24", hasta: "2026-09-25" });
  assert.deepEqual(r.data.dias, [{ fecha: "2026-09-24", dia: "jueves", notas: [{ nota: "Dentista 17:00", importancia: "alta" }] }]);
  assert.equal(r.data.eventos_google, undefined);
});

test("calendario_anadir_nota con hora y aviso", async () => {
  const { call, calls } = await connect({ "POST calendario /notes": { ok: true } });
  const r = await call("calendario_anadir_nota", { fecha: "2026-10-02", nota: "Dentista", hora: "17:30", aviso: "30 minutos antes" });
  assert.deepEqual(calls.at(-1).body, { date: "2026-10-02", note: "Dentista", importance: "media", recurrence: "none", time: "17:30", remindMinutes: 30 });
  assert.deepEqual([r.data.apuntada.hora, r.data.apuntada.aviso], ["17:30", "30 minutos antes"]);
  await call("calendario_anadir_nota", { fecha: "2026-10-03", nota: "Cumple" });
  assert.deepEqual([calls.at(-1).body.time, calls.at(-1).body.remindMinutes], [null, null]);
  assert.equal((await call("calendario_anadir_nota", { fecha: "2026-10-03", nota: "x", hora: "5pm" })).isError, true);
});

test("menu_planificar hace PUT a la franja correcta del grupo", async () => {
  const { call, calls } = await connect({
    "GET lista /groups": { groups: [CASA] },
    "GET menu /groups/g1/meals?start=2026-09-25&end=2026-09-25": { meals: [{ date: "2026-09-25", slot: "cena", title: "Pizza" }] },
    "PUT menu /groups/g1/meals/2026-09-25/cena": (b) => ({ date: "2026-09-25", slot: "cena", title: b.title }),
  });
  const r = await call("menu_planificar", { fecha: "2026-09-25", franja: "cena", plato: "Tortilla", grupo: "casa" });
  assert.equal(r.data.planificado.dia, "viernes");
  assert.equal(r.data.planificado.sustituye_a, "Pizza");
  assert.equal(r.data.planificado.di_al_usuario, "Tortilla: viernes 25, en la cena (en lugar de Pizza).");
  assert.deepEqual(calls.at(-1).body, { title: "Tortilla" });
});

test("receta_anadir sin día: añade ingredientes a la lista personal y devuelve huecos libres del menú", async () => {
  const hoy = todayKey();
  const end = addDays(hoy, 6);
  const { call, calls } = await connect({
    "GET lista /personal/lists": { lists: [{ id: "p1", name: "Mi lista", items: [{ id: "i1", name: "Huevos", done: false }] }] },
    "POST lista /personal/lists/p1/items": (b) => ({ id: "n" + b.name, name: b.name, done: false }),
    [`GET menu /meals?start=${hoy}&end=${end}`]: { meals: [{ date: hoy, slot: "comida", title: "Lentejas" }] },
    // Busqueda del plato en el menu (14 dias): personal y grupos, no esta.
    "GET lista /groups": { groups: [CASA] },
    [`GET menu /meals?start=${hoy}&end=${addDays(hoy, 13)}`]: { meals: [{ date: hoy, slot: "comida", title: "Lentejas" }] },
    [`GET menu /groups/g1/meals?start=${hoy}&end=${addDays(hoy, 13)}`]: { meals: [] },
  });
  const r = await call("receta_anadir", {
    plato: "Tortilla de patatas",
    ingredientes: [{ nombre: "huevos", cantidad: "6" }, { nombre: "Patatas", cantidad: "1 kg" }, { nombre: "Cebolla" }],
  });
  assert.equal(r.isError, false);
  assert.equal(r.data.lista, "tu lista personal «Mi lista»");
  assert.deepEqual(r.data.anadidos, ["Patatas", "Cebolla"]);
  assert.deepEqual(r.data.ya_estaban, ["Huevos"]);
  assert.equal(r.data.menu.sin_planificar, true);
  assert.deepEqual(r.data.menu.huecos_libres_esta_semana[0], { fecha: hoy, dia: r.data.menu.huecos_libres_esta_semana[0].dia, franja: "cena" });
  assert.match(r.data.menu.siguiente_paso, /pregunta/i);
  assert.equal(calls.filter((c) => c.method === "PUT").length, 0);
});

test("receta_anadir con día y franja: lista del grupo + plato con ingredientes en el menú del grupo", async () => {
  const { call, calls } = await connect({
    "GET lista /groups": { groups: [CASA] },
    "GET lista /groups/g1/list": { items: [] },
    "POST lista /groups/g1/list/items": (b) => ({ id: "n" + b.name, name: b.name, done: false }),
    "GET menu /groups/g1/meals?start=2026-10-03&end=2026-10-03": { meals: [] },
    "PUT menu /groups/g1/meals/2026-10-03/comida": (b) => ({ date: "2026-10-03", slot: "comida", title: b.title }),
  });
  const r = await call("receta_anadir", {
    plato: "Paella",
    ingredientes: [{ nombre: "Arroz bomba", cantidad: "400 g" }, { nombre: "Gambas" }],
    fecha: "2026-10-03",
    franja: "comida",
    grupo: "casa",
  });
  assert.deepEqual(r.data.anadidos, ["Arroz bomba", "Gambas"]);
  assert.deepEqual(r.data.menu.planificado, { fecha: "2026-10-03", dia: "sábado", franja: "comida", plato: "Paella", di_al_usuario: "Paella: sábado 3, en la comida." });
  assert.deepEqual(calls.at(-1).body, { title: "Paella", ingredients: ["Arroz bomba", "Gambas"] });
});

test("receta_anadir con día pero sin franja no toca nada", async () => {
  const { call, calls } = await connect({});
  const r = await call("receta_anadir", { plato: "Paella", ingredientes: [{ nombre: "Arroz" }], fecha: "2026-10-03" });
  assert.equal(r.isError, true);
  assert.equal(calls.length, 0);
});

test("resumen_hoy sigue funcionando aunque una API falle", async () => {
  const hoy = todayKey();
  const { call } = await connect({
    "GET todo /tasks": { tasks: [{ title: "Pagar luz", status: "todo", dueDate: "2020-01-01", recurrence: "none" }] },
    "GET calendario /notes": () => {
      throw new HubError("calendario-api respondio 503", 503);
    },
    [`GET menu /meals?start=${hoy}&end=${hoy}`]: { meals: [{ slot: "cena", title: "Pizza" }] },
    "GET lista /groups": { groups: [CASA] },
    "GET lista /groups/g1/list": { items: [{ name: "Leche", done: false }] },
    "GET lista /personal/lists": { lists: [{ id: "p1", name: "Mi lista", items: [{ name: "Pan", done: false }, { name: "Sal", done: true }] }] },
    "GET gastos /groups/balances": { balances: [{ groupName: "Casa", balanceCents: -1500 }] },
  });
  const r = await call("resumen_hoy", {});
  assert.equal(r.data.hoy, hoy);
  assert.deepEqual(r.data.tareas, [{ titulo: "Pagar luz", fecha: "2020-01-01", atrasada: true }]);
  assert.match(r.data.notas_calendario, /no disponible/);
  assert.deepEqual(r.data.menu, { cena: "Pizza" });
  assert.deepEqual(r.data.compra_pendiente, [
    { lista: "tu lista personal «Mi lista»", productos: ["Pan"] },
    { lista: "grupo «Casa»", productos: ["Leche"] },
  ]);
  assert.deepEqual(r.data.saldos_gastos, [{ grupo: "Casa", saldo: "-15,00 €", significado: "debes" }]);
});

test("menu_planificar recupera los ingredientes de la receta del mensaje anterior", async () => {
  // Cada mensaje del chat es una conexion MCP nueva; la memoria es la del
  // proceso (compartida), por usuario.
  const recipes = createRecipeMemory();
  const hoy = todayKey();
  const first = await connect(
    {
      "GET lista /personal/lists": { lists: [{ id: "p1", name: "Mi lista", items: [] }] },
      "POST lista /personal/lists/p1/items": (b) => ({ id: "n" + b.name, name: b.name, done: false }),
      [`GET menu /meals?start=${hoy}&end=${addDays(hoy, 6)}`]: { meals: [] },
      [`GET menu /meals?start=${hoy}&end=${addDays(hoy, 13)}`]: { meals: [] },
      "GET lista /groups": { groups: [] },
    },
    { userId: "u1", recipes }
  );
  await first.call("receta_anadir", { plato: "Lasaña de carne", ingredientes: [{ nombre: "Carne picada" }, { nombre: "Bechamel" }] });

  const routes = {
    "GET menu /meals?start=2026-10-02&end=2026-10-02": { meals: [] },
    "PUT menu /meals/2026-10-02/cena": (b) => ({ date: "2026-10-02", slot: "cena", title: b.title }),
  };
  const second = await connect(routes, { userId: "u1", recipes });
  await second.call("menu_planificar", { fecha: "2026-10-02", franja: "cena", plato: "lasaña" });
  assert.deepEqual(second.calls.at(-1).body, { title: "lasaña", ingredients: ["Carne picada", "Bechamel"] });

  // Otro usuario u otro plato: sin ingredientes.
  const other = await connect(routes, { userId: "u2", recipes });
  await other.call("menu_planificar", { fecha: "2026-10-02", franja: "cena", plato: "lasaña" });
  assert.deepEqual(other.calls.at(-1).body, { title: "lasaña" });
  const pizza = await connect(routes, { userId: "u1", recipes });
  await pizza.call("menu_planificar", { fecha: "2026-10-02", franja: "cena", plato: "Pizza" });
  assert.deepEqual(pizza.calls.at(-1).body, { title: "Pizza" });
});

test("la memoria de recetas caduca", () => {
  let t = 0;
  const m = createRecipeMemory({ ttlMs: 1000, now: () => t });
  m.remember("u1", "Paella", ["Arroz"]);
  assert.deepEqual(m.recall("u1", "paella"), ["Arroz"]);
  t = 1001;
  assert.equal(m.recall("u1", "paella"), null);
});

test("menu_planificar con «dia»: corrige la fecha del modelo", async () => {
  const viernes = (() => {
    for (let d = todayKey(); ; d = addDays(d, 1)) if (new Date(`${d}T12:00:00Z`).getUTCDay() === 5) return d;
  })();
  const { call, calls } = await connect({
    [`GET menu /meals?start=${viernes}&end=${viernes}`]: { meals: [] },
    [`PUT menu /meals/${viernes}/cena`]: (b) => ({ date: viernes, slot: "cena", title: b.title }),
  });
  // «fecha» equivocada del modelo (dentro de esta semana): manda la palabra.
  const mal = viernes === todayKey() ? addDays(viernes, 1) : todayKey();
  const r = await call("menu_planificar", { dia: "viernes", fecha: mal, franja: "cena", plato: "Pizza" });
  assert.equal(r.data.planificado.fecha, viernes);
  assert.equal(calls.at(-1).path, `/meals/${viernes}/cena`);
  // Palabra que no se entiende: se usa la fecha.
  await call("menu_planificar", { dia: "el finde", fecha: viernes, franja: "cena", plato: "Pizza" });
  assert.equal(calls.at(-1).path, `/meals/${viernes}/cena`);
  // Fecha concreta mas alla de una semana: se respeta aunque el dia no cuadre.
  const lejos = addDays(todayKey(), 20);
  await connect({ [`GET menu /meals?start=${lejos}&end=${lejos}`]: { meals: [] }, [`PUT menu /meals/${lejos}/cena`]: (b) => ({ date: lejos, slot: "cena", title: b.title }) })
    .then(async (c) => {
      await c.call("menu_planificar", { dia: "viernes", fecha: lejos, franja: "cena", plato: "Pizza" });
      assert.equal(c.calls.at(-1).path, `/meals/${lejos}/cena`);
    });
});

test("compra_ver_precios compara lo pendiente de la lista personal", async () => {
  const { call, calls } = await connect({
    "GET lista /personal/lists": {
      lists: [{ id: "p1", name: "Mi lista", items: [{ id: "a", name: "Leche", qty: "2", done: false }, { id: "b", name: "Pan", done: true }, { id: "c", name: "Tomates", done: false }] }],
    },
    "POST lista /prices": {
      totals: [
        { supermarket: "Mercadona", total_eur: 3.03, found: 2, of: 2 },
        { supermarket: "Dia", total_eur: 3.2, found: 2, of: 2 },
      ],
      results: [
        { product: "Leche", supermarket: "Mercadona", price_eur: 0.84, match_name: "Leche · Brik 1 L", unit_price: "0.84 €/L", unit_price_eur: 0.84, unit: "L" },
        { product: "Leche", supermarket: "Dia", price_eur: 0.86, match_name: "Leche Dia 1 L", unit_price: "0.86 €/L", unit_price_eur: 0.86, unit: "L" },
        { product: "Tomates", supermarket: "Mercadona", price_eur: 2.35, match_name: "Tomates pera · 1.12 kg aprox.", unit_price: "2.10 €/kg", unit_price_eur: 2.1, unit: "kg" },
        { product: "Tomates", supermarket: "Dia", price_eur: 1.48, match_name: "Tomate pera 500 g", unit_price: "2.96 €/kg", unit_price_eur: 2.96, unit: "kg" },
      ],
    },
  });
  const r = await call("compra_ver_precios", {});
  assert.deepEqual(calls.find((c) => c.path === "/prices").body, { items: [{ name: "Leche", qty: "2" }, { name: "Tomates", qty: "1" }] });
  assert.equal(r.data.lista, "tu lista personal «Mi lista»");
  assert.equal(r.data.mas_barata, "Mercadona");
  assert.equal(r.data.total[1].total, "3,20 €");
  // Por €/kg, no por lo que cuesta cada formato.
  assert.equal(r.data.por_producto[1].mas_barato, "Mercadona");
  assert.equal(r.data.por_producto[0].Mercadona, "0,84 € (Leche · Brik 1 L, 0.84 €/L)");
});

test("compra_ver_precios con productos concretos no mira la lista", async () => {
  const { call, calls } = await connect({
    "POST lista /prices": {
      totals: [{ supermarket: "Mercadona", total_eur: 4.1, found: 1, of: 1 }, { supermarket: "Dia", total_eur: 0, found: 0, of: 1 }],
      results: [
        { product: "aceite", supermarket: "Mercadona", price_eur: 4.1, match_name: "Aceite de oliva 1 L", unit_price: null, unit_price_eur: null, unit: null },
        { product: "aceite", supermarket: "Dia", price_eur: null, match_name: null },
      ],
    },
  });
  const r = await call("compra_ver_precios", { productos: ["aceite"] });
  assert.equal(calls.length, 1);
  assert.equal(r.data.total, undefined);
  assert.equal(r.data.por_producto[0].Dia, "no encontrado");
  assert.equal(r.data.por_producto[0].mas_barato, undefined);
});

test("receta_anadir: si el plato ya está en el menú (de un grupo), le pone ahí los ingredientes y no pregunta", async () => {
  const hoy = todayKey();
  const sabado = addDays(hoy, 2);
  const { call, calls } = await connect({
    "GET lista /personal/lists": { lists: [{ id: "p1", name: "Mi lista", items: [] }] },
    "POST lista /personal/lists/p1/items": (b) => ({ id: "n" + b.name, name: b.name, done: false }),
    "GET lista /groups": { groups: [CASA] },
    [`GET menu /meals?start=${hoy}&end=${addDays(hoy, 13)}`]: { meals: [{ date: hoy, slot: "cena", title: "Pizza" }] },
    [`GET menu /groups/g1/meals?start=${hoy}&end=${addDays(hoy, 13)}`]: {
      meals: [{ date: sabado, slot: "comida", title: "Paella de marisco", ingredients: ["Gambas", "limón"] }],
    },
    [`PUT menu /groups/g1/meals/${sabado}/comida`]: (b) => ({ date: sabado, slot: "comida", title: b.title }),
  });
  const r = await call("receta_anadir", { plato: "paella", ingredientes: [{ nombre: "Arroz bomba" }, { nombre: "gambas" }] });
  const put = calls.find((c) => c.method === "PUT");
  // Se respeta el nombre del plato y lo que ya habia apuntado, sin repetir.
  assert.deepEqual(put.body, { title: "Paella de marisco", ingredients: ["Gambas", "limón", "Arroz bomba"] });
  assert.equal(r.data.menu.ambito, "Casa");
  assert.equal(r.data.menu.huecos_libres_esta_semana, undefined);
  assert.match(r.data.menu.di_al_usuario, /menú del grupo «Casa»/);
  assert.deepEqual(r.data.anadidos, ["Arroz bomba", "gambas"]);
});

test("menu_planificar sobre el mismo plato suma ingredientes en vez de borrarlos", async () => {
  const { call, calls } = await connect({
    "GET menu /meals?start=2026-10-03&end=2026-10-03": { meals: [{ date: "2026-10-03", slot: "cena", title: "Tortilla", ingredients: ["Huevos"] }] },
    "PUT menu /meals/2026-10-03/cena": (b) => ({ date: "2026-10-03", slot: "cena", title: b.title }),
  });
  await call("menu_planificar", { fecha: "2026-10-03", franja: "cena", plato: "Tortilla de patatas", ingredientes: ["huevos", "Patatas"] });
  assert.deepEqual(calls.at(-1).body, { title: "Tortilla de patatas", ingredients: ["Huevos", "Patatas"] });
});

test("receta_anadir sin ingredientes: pide al modelo que los ponga él, sin tocar nada", async () => {
  const { call, calls } = await connect({});
  const r = await call("receta_anadir", { plato: "Paella" });
  assert.equal(r.isError, true);
  assert.match(r.text, /pon tú los ingredientes habituales del plato/);
  assert.equal(calls.length, 0);
});

test("menu_planificar acepta «mañana» o «viernes» en fecha y la convierte", async () => {
  const manana = addDays(todayKey(), 1);
  const { call, calls } = await connect({
    [`GET menu /meals?start=${manana}&end=${manana}`]: { meals: [] },
    [`PUT menu /meals/${manana}/cena`]: (b) => ({ date: manana, slot: "cena", title: b.title }),
  });
  const r = await call("menu_planificar", { fecha: "mañana", franja: "cena", plato: "Pizza" });
  assert.equal(r.data.planificado.fecha, manana);
  assert.equal(calls.at(-1).path, `/meals/${manana}/cena`);
  assert.equal((await call("menu_planificar", { fecha: "algún día", franja: "cena", plato: "Pizza" })).isError, true);
});
