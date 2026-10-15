// Comparativa de precios con tiendas y modelo simulados: que se use la
// eleccion del modelo, que sin modelo se aplique la regla, y que los
// totales y los fallos de una tienda salgan bien.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createPriceComparer, searchMercadona, searchDia, pickByRule, units } = require("../prices");

const LECHE = [
  { name: "Leche semidesnatada pack 6 x 1 L", price: 5.04, unitPrice: 0.84, unit: "L", url: "m/1" },
  { name: "Leche semidesnatada · Brik 1 L", price: 0.84, unitPrice: 0.84, unit: "L", url: "m/2" },
];
const LECHE_DIA = [{ name: "Leche semidesnatada Dia 1 L", price: 0.86, unitPrice: 0.86, unit: "L", url: "d/1", promo: true }];

function stores(map) {
  return Object.entries(map).map(([name, byQuery]) => ({
    name,
    search: async (q) => {
      const r = byQuery[q];
      if (r instanceof Error) throw r;
      return r || [];
    },
  }));
}

test("usa el producto que elige el modelo y suma los totales con la cantidad", async () => {
  const prompts = [];
  const c = createPriceComparer({
    stores: stores({ Mercadona: { leche: LECHE }, Dia: { leche: LECHE_DIA } }),
    available: async () => true,
    chat: async (prompt, schema) => {
      prompts.push({ prompt, schema });
      return { Mercadona: 1, Dia: 0 };
    },
  });
  const r = await c.compare([{ name: "leche", qty: "3" }]);
  assert.equal(r.chosen_by, "modelo");
  const m = r.results.find((x) => x.supermarket === "Mercadona");
  assert.equal(m.match_name, "Leche semidesnatada · Brik 1 L");
  assert.equal(m.unit_price, "0.84 €/L");
  assert.equal(r.results.find((x) => x.supermarket === "Dia").promo, true);
  assert.deepEqual(r.totals, [
    { supermarket: "Mercadona", total_eur: 2.52, found: 1, of: 1 },
    { supermarket: "Dia", total_eur: 2.58, found: 1, of: 1 },
  ]);
  assert.match(prompts[0].prompt, /«leche» \(cantidad: 3\)/);
  assert.match(prompts[0].prompt, /1\. Leche semidesnatada · Brik 1 L — 0\.84 €/);
  assert.deepEqual(prompts[0].schema.required, ["Mercadona", "Dia"]);
});

test("null del modelo = no está; un índice fuera de rango cae en la regla", async () => {
  const c = createPriceComparer({
    stores: stores({ Mercadona: { leche: LECHE }, Dia: { leche: LECHE_DIA } }),
    available: async () => true,
    chat: async () => ({ Mercadona: 7, Dia: null }),
  });
  const r = await c.compare([{ name: "leche", qty: "1" }]);
  assert.equal(r.results[0].match_name, LECHE[0].name); // regla: el primero con «leche»
  assert.equal(r.results[1].price_eur, null);
  assert.match(r.results[1].note, /No se ha encontrado en Dia/);
});

test("sin el PC encendido se elige con la regla y no se llama al modelo", async () => {
  let called = false;
  const c = createPriceComparer({
    stores: stores({ Mercadona: { tomates: [{ name: "Tomate frito", price: 1 }, { name: "Tomates pera", price: 2 }] } }),
    available: async () => false,
    chat: async () => ((called = true), {}),
  });
  const r = await c.compare([{ name: "tomates", qty: "1" }]);
  assert.equal(called, false);
  assert.equal(r.chosen_by, "regla");
  assert.equal(r.results[0].match_name, "Tomates pera");
});

test("si una tienda falla, la otra sigue y se explica", async () => {
  const c = createPriceComparer({
    stores: stores({ Mercadona: { leche: new Error("Mercadona respondió 500") }, Dia: { leche: LECHE_DIA } }),
    available: async () => true,
    chat: async () => {
      throw new Error("Ollama caído");
    },
  });
  const r = await c.compare([{ name: "leche", qty: "1" }]);
  assert.match(r.results[0].note, /No se ha podido consultar Mercadona/);
  assert.equal(r.results[1].price_eur, 0.86);
  assert.deepEqual(r.totals.map((t) => t.found), [0, 1]);
});

test("las búsquedas se guardan en caché unas horas", async () => {
  let t = 0;
  let n = 0;
  const c = createPriceComparer({
    stores: [{ name: "Dia", search: async () => (n++, LECHE_DIA) }],
    available: async () => false,
    now: () => t,
  });
  await c.compare([{ name: "Leche", qty: "1" }]);
  await c.compare([{ name: "leche ", qty: "2" }]);
  assert.equal(n, 1);
  t = 7 * 60 * 60 * 1000;
  await c.compare([{ name: "leche", qty: "1" }]);
  assert.equal(n, 2);
});

test("pickByRule y units", () => {
  assert.equal(pickByRule("pan de molde", [{ name: "Pan rallado" }, { name: "Pan de molde blanco" }]), 1);
  assert.equal(pickByRule("xyz", [{ name: "a" }]), 0);
  assert.equal(pickByRule("x", []), null);
  assert.equal(units("3"), 3);
  assert.equal(units("2 L"), 1);
  assert.equal(units(""), 1);
});

test("searchMercadona y searchDia leen el formato de cada tienda", async () => {
  const fake = (body) => async () => ({ ok: true, json: async () => body });
  const m = await searchMercadona(
    "leche",
    fake({
      hits: [
        {
          id: "10381",
          display_name: "Leche semidesnatada Hacendado",
          packaging: "Brik",
          share_url: "https://tienda.mercadona.es/product/10381/x",
          price_instructions: { unit_price: "0.84", reference_price: "0.840", reference_format: "L", unit_size: 1, size_format: "l" },
        },
        {
          id: "3",
          display_name: "Tomate frito",
          packaging: "Pack-3",
          price_instructions: { unit_price: "1.35", reference_price: "1.125", reference_format: "kg", is_pack: true, total_units: 3, pack_size: 0.4, size_format: "kg" },
        },
      ],
    })
  );
  assert.deepEqual(m[0], { name: "Leche semidesnatada Hacendado · Brik 1 L", price: 0.84, unitPrice: 0.84, unit: "L", url: "https://tienda.mercadona.es/product/10381/x" });
  assert.equal(m[1].name, "Tomate frito · Pack-3 3 x 400 g");
  const d = await searchDia(
    "leche",
    fake({ search_items: [{ display_name: "Leche Dia 1 L", url: "/p/1", prices: { price: 0.96, price_per_unit: 0.96, measure_unit: "LITRO", is_promo_price: true } }] })
  );
  assert.deepEqual(d[0], { name: "Leche Dia 1 L", price: 0.96, unitPrice: 0.96, unit: "L", url: "https://www.dia.es/p/1", promo: true });
});
