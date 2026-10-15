// Comparativa de precios con datos reales de Mercadona y Dia.
//
// 1. Cada producto de la lista se busca en los buscadores publicos de las
//    dos tiendas online (los mismos que usa su web; no son APIs oficiales,
//    si cambian hay que ajustar searchMercadona/searchDia).
// 2. El modelo local (OLLAMA_MODEL, gemma4:e4b por defecto) elige entre los resultados
//    reales el que corresponde a lo apuntado («leche» -> el brik de 1 L, no
//    el pack de 6; «tomates» -> tomates, no tomate frito). No calcula ni se
//    inventa precios: solo elige un indice.
// 3. Si el PC esta apagado o el modelo falla, se elige con una regla simple
//    (el primer resultado que contiene todas las palabras).
//
// Sin dependencias de red en la logica: fetch y el modelo se inyectan, asi
// se prueba con tiendas y modelo simulados (test/prices.test.js).

const MERCADONA_WH = process.env.MERCADONA_WAREHOUSE || "4045"; // almacen de Mercadona = zona de precios (ver README)
// Clave publica de solo busqueda que la web de Mercadona manda al navegador.
const MERCADONA_ALGOLIA = {
  app: "7UZJKL1DJ0",
  key: "9d8f2e39e90df472b4f2e559a116fe17",  // gitleaks:allow (clave publica de solo busqueda de la web de Mercadona)
};
const OLLAMA_URL = process.env.OLLAMA_URL || "http://ollama:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:e4b";
const CANDIDATES = 8;
const CACHE_MS = 6 * 60 * 60 * 1000;
const UNIT = { KILO: "kg", LITRO: "L", UNIDAD: "ud", kg: "kg", L: "L", l: "L", ud: "ud" };

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function num(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// --------------------------------------------------------------- tiendas

// «0.25 kg» -> «250 g»; packs -> «3 x 400 g»; peso variable -> «aprox.».
function amount(n, rawFmt) {
  const fmt = rawFmt === "l" ? "L" : rawFmt;
  if (n == null || !fmt) return null;
  if (fmt === "kg" && n < 1) return `${Math.round(n * 1000)} g`;
  if (fmt === "L" && n < 1) return `${Math.round(n * 1000)} ml`;
  return `${Number(n.toFixed(3))} ${fmt}`;
}
function mercadonaSize(p) {
  const fmt = p.size_format;
  const size =
    p.is_pack && p.total_units > 1 ? `${p.total_units} x ${amount(num(p.pack_size), fmt)}` : amount(num(p.unit_size), fmt);
  return size ? (p.approx_size ? `${size} aprox.` : size) : null;
}

async function searchMercadona(query, fetchImpl = fetch) {
  const url =
    `https://${MERCADONA_ALGOLIA.app.toLowerCase()}-dsn.algolia.net/1/indexes/products_prod_${MERCADONA_WH}_es/query` +
    `?x-algolia-application-id=${MERCADONA_ALGOLIA.app}&x-algolia-api-key=${MERCADONA_ALGOLIA.key}`;
  const res = await fetchImpl(url, {
    method: "POST",
    body: JSON.stringify({ params: `query=${encodeURIComponent(query)}&hitsPerPage=${CANDIDATES}` }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Mercadona respondió ${res.status}`);
  const { hits = [] } = await res.json();
  return hits
    .map((h) => {
      const p = h.price_instructions || {};
      return {
        name: [h.display_name, [h.packaging, mercadonaSize(p)].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
        price: num(p.unit_price),
        unitPrice: num(p.reference_price),
        unit: UNIT[p.reference_format] || p.reference_format || null,
        url: h.share_url || `https://tienda.mercadona.es/product/${h.id}`,
      };
    })
    .filter((c) => c.price != null);
}

async function searchDia(query, fetchImpl = fetch) {
  const res = await fetchImpl(
    `https://www.dia.es/api/v1/search-back/search/reduced?q=${encodeURIComponent(query)}&page=1`,
    { signal: AbortSignal.timeout(8000) }
  );
  if (!res.ok) throw new Error(`Dia respondió ${res.status}`);
  const { search_items = [] } = await res.json();
  return search_items
    .slice(0, CANDIDATES)
    .map((i) => ({
      name: i.display_name,
      price: num(i.prices?.price),
      unitPrice: num(i.prices?.price_per_unit),
      unit: UNIT[i.prices?.measure_unit] || null,
      url: i.url ? `https://www.dia.es${i.url}` : null,
      promo: !!i.prices?.is_promo_price,
    }))
    .filter((c) => c.price != null);
}

const STORES = [
  { name: "Mercadona", search: searchMercadona },
  { name: "Dia", search: searchDia },
];

// ----------------------------------------------------------- eleccion

// Sin modelo: entre los resultados que contienen todas las palabras de lo
// apuntado (sin plural), el que mas palabras tiene tal cual («tomates» ->
// «Tomates pera» antes que «Tomate frito»); a igualdad, el primero (los
// buscadores ya ordenan por relevancia). Si ninguno, el primero.
function pickByRule(query, candidates) {
  if (!candidates.length) return null;
  const words = normalize(query)
    .split(" ")
    .filter((w) => w.length > 2);
  const stem = (w) => w.replace(/(es|s)$/, "");
  let best = 0;
  let bestScore = -1;
  candidates.forEach((c, i) => {
    const name = normalize(c.name);
    const tokens = new Set(name.split(" "));
    if (!words.every((w) => name.includes(stem(w)))) return;
    const score = words.filter((w) => tokens.has(w)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

function matchPrompt(item, offers) {
  const lines = offers
    .map(({ store, candidates }) =>
      `${store}:\n` + (candidates.length ? candidates.map((c, i) => `  ${i}. ${c.name} — ${c.price.toFixed(2)} €`).join("\n") : "  (sin resultados)")
    )
    .join("\n");
  return `En la lista de la compra pone: «${item.name}»${item.qty && item.qty !== "1" ? ` (cantidad: ${item.qty})` : ""}.
Para cada supermercado, elige el número del producto que una persona compraría normalmente para eso: el mismo tipo de producto, en el formato más habitual (p.ej. «leche» -> un brik de 1 L de leche, no un pack de 6 ni leche en polvo; «tomates» -> tomates frescos, no tomate frito).
Elige en las dos tiendas formatos parecidos (más o menos la misma cantidad) para que se puedan comparar.
Si ninguno es ese producto, pon null.

${lines}`;
}

async function pickWithModel(item, offers, chat) {
  const schema = {
    type: "object",
    properties: Object.fromEntries(offers.map((o) => [o.store, { type: ["integer", "null"] }])),
    required: offers.map((o) => o.store),
  };
  const out = await chat(matchPrompt(item, offers), schema);
  const picks = {};
  for (const { store, candidates } of offers) {
    const v = out?.[store];
    picks[store] = Number.isInteger(v) && v >= 0 && v < candidates.length ? v : v === null ? null : undefined;
  }
  return picks;
}

async function ollamaChat(prompt, schema) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      think: false,
      format: schema,
      options: { temperature: 0 },
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Ollama respondió ${res.status}`);
  const data = await res.json();
  return JSON.parse(data.message?.content || "{}");
}

async function ollamaAvailable() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------- comparativa

// Cantidad apuntada -> unidades a comprar, solo si es un numero entero
// («3»); «2 L» o «1 docena» cuentan como 1 (el producto elegido ya tiene
// su formato).
function units(qty) {
  const s = String(qty ?? "").trim();
  return /^\d{1,2}$/.test(s) && Number(s) > 0 ? Number(s) : 1;
}

function createPriceComparer({ stores = STORES, chat = ollamaChat, available = ollamaAvailable, now = () => Date.now() } = {}) {
  const cache = new Map();

  async function search(store, query) {
    const key = `${store.name}|${normalize(query)}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.candidates;
    const candidates = await store.search(query);
    cache.set(key, { candidates, at: now() });
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    return candidates;
  }

  async function compare(items) {
    const useModel = await available();
    const results = [];
    const totals = Object.fromEntries(stores.map((s) => [s.name, { total: 0, found: 0 }]));
    for (const item of items) {
      const offers = await Promise.all(
        stores.map(async (store) => {
          try {
            return { store: store.name, candidates: await search(store, item.name) };
          } catch (err) {
            return { store: store.name, candidates: [], error: err.message };
          }
        })
      );
      let picks = {};
      if (useModel && offers.some((o) => o.candidates.length)) {
        try {
          picks = await pickWithModel(item, offers, chat);
        } catch (err) {
          console.error("precios: el modelo ha fallado, se usa la regla:", err.message);
        }
      }
      for (const o of offers) {
        let i = picks[o.store];
        if (i === undefined) i = pickByRule(item.name, o.candidates);
        const c = i === null || i === undefined ? null : o.candidates[i];
        const n = units(item.qty);
        if (c) {
          totals[o.store].total += c.price * n;
          totals[o.store].found += 1;
        }
        results.push({
          product: item.name,
          supermarket: o.store,
          price_eur: c ? c.price : null,
          match_name: c ? c.name : null,
          unit_price: c && c.unitPrice != null && c.unit ? `${c.unitPrice.toFixed(2)} €/${c.unit}` : null,
          unit_price_eur: c && c.unitPrice != null && c.unit ? c.unitPrice : null,
          unit: c && c.unitPrice != null ? c.unit : null,
          promo: c ? !!c.promo : false,
          units: n,
          note: c ? "" : o.error ? `No se ha podido consultar ${o.store}.` : `No se ha encontrado en ${o.store}.`,
          source_url: c ? c.url : null,
        });
      }
    }
    return {
      generated_at: new Date(now()).toISOString(),
      chosen_by: useModel ? "modelo" : "regla",
      disclaimer:
        "Precios de las tiendas online de Mercadona y Dia, consultados ahora. " +
        (useModel ? "El producto de cada tienda lo elige el asistente: " : "El producto de cada tienda se elige automáticamente: ") +
        "comprueba que es el que quieres. En tienda física pueden variar.",
      totals: Object.entries(totals).map(([supermarket, t]) => ({
        supermarket,
        total_eur: Math.round(t.total * 100) / 100,
        found: t.found,
        of: items.length,
      })),
      results,
    };
  }

  return { compare };
}

module.exports = { createPriceComparer, searchMercadona, searchDia, pickByRule, units, matchPrompt, normalize };
