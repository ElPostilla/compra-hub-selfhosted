// Utilidades puras (sin red) -- cubiertas por test/util.test.js.

const TZ = process.env.TZ || "Europe/Madrid";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Fecha local (Europe/Madrid) en YYYY-MM-DD. "sv-SE" formatea justo asi.
function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(now);
}

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
function weekday(dateKey) {
  return WEEKDAYS[new Date(`${dateKey}T12:00:00Z`).getUTCDay()];
}

// «viernes», «mañana»... -> YYYY-MM-DD. El modelo pequeño (gemma4:e4b)
// falla a menudo al pasar un dia de la semana a fecha; con la palabra la
// cuenta la hace el servidor. Un dia de la semana es el proximo (hoy
// incluido: «el jueves» dicho un jueves es hoy).
const DAY_WORDS = ["hoy", "mañana", "pasado mañana", ...WEEKDAYS.slice(1), WEEKDAYS[0]];
function resolveDay(word, hoy = todayKey()) {
  const w = normalize(word).replace(/^(el|este|esta)\s+/, "").replace(/\s+/g, " ");
  if (w === "hoy") return hoy;
  if (w === "manana") return addDays(hoy, 1);
  if (w === "pasado manana") return addDays(hoy, 2);
  const target = WEEKDAYS.findIndex((d) => normalize(d) === w);
  if (target < 0) return null;
  return addDays(hoy, (target - new Date(`${hoy}T12:00:00Z`).getUTCDay() + 7) % 7);
}

// Rango Unicode de marcas diacriticas combinantes, desde un string de
// escape (mismo motivo que en lista-compra/src/app/categories.ts).
const DIACRITICS_RE = new RegExp("[\\u0300-\\u036f]", "g");
function normalize(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "").trim();
}

// Copia de CATS de lista-compra/src/app/categories.ts (mismas claves
// y palabras, mismo orden): la API guarda "otros" si no se le manda
// categoria, y lo que se anade desde el asistente tiene que caer en el
// mismo pasillo que si se hubiera escrito en la app. Si se cambia alli,
// cambiarlo aqui.
const SHOPPING_CATS = [
  ["fruver", ["manzana","platano","plátano","naranja","pera","uva","fresa","tomate","lechuga","cebolla","ajo","patata","papa","zanahoria","pepino","pimiento","aguacate","limon","limón","kiwi","melon","melón","sandia","sandía","brocoli","brócoli","espinaca","calabacin","calabacín","champiñon","champiñón","seta","fruta","verdura","ensalada"]],
  ["pan", ["pan","baguette","barra de pan","bolleria","bollería","croissant","magdalena","tostada"]],
  ["lacteos", ["leche","yogur","yogurt","queso","mantequilla","nata","huevo","huevos","margarina","requeson","requesón","cuajada"]],
  ["carne", ["pollo","carne","ternera","cerdo","jamon","jamón","chorizo","salchicha","pescado","salmon","salmón","atun","atún","merluza","gamba","langostino","bacon","panceta","filete","lomo","marisco"]],
  ["despensa", ["arroz","pasta","macarrones","espagueti","harina","azucar","azúcar","sal","aceite","vinagre","legumbre","lenteja","garbanzo","alubia","conserva","salsa","especia","cafe","café"," te ","té","cereales","galleta","miel","chocolate"]],
  ["congelados", ["congelado","helado","pizza"]],
  ["bebidas", ["agua","vino","cerveza","zumo","refresco","cola","bebida","licor"]],
  ["limpieza", ["detergente","lejia","lejía","suavizante","friegasuelos","papel higienico","papel higiénico","servilleta","bolsa de basura","estropajo","fregona","limpiador"]],
  ["higiene", ["champu","champú","gel de ducha","jabon","jabón","pasta de dientes","dentifrico","dentífrico","desodorante","compresa","tampon","tampón","cuchilla","maquinilla"]],
];

// Igual que detectCategory() del frontend (incluido su includes() sin
// limites de palabra), para que el resultado sea identico.
function detectShoppingCategory(name) {
  const n = String(name || "").toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "");
  for (const [key, kw] of SHOPPING_CATS) {
    if (kw.some((k) => n.includes(k.toLowerCase().normalize("NFD").replace(DIACRITICS_RE, "")))) return key;
  }
  return "otros";
}

// Claves de gastos/src/app/models.ts.
const EXPENSE_CATS = ["comida", "casa", "ocio", "transporte", "salud", "otros"];

// Busca por nombre con tolerancia (sin tildes/mayusculas): primero
// coincidencia exacta, luego "contiene" en cualquier sentido. Devuelve
// { match } o { error } con los candidatos, para que el modelo pueda
// preguntar en vez de adivinar.
function findByName(items, query, getName, what) {
  const q = normalize(query);
  if (!q) return { error: `Falta el nombre de ${what}.` };
  const exact = items.filter((i) => normalize(getName(i)) === q);
  if (exact.length === 1) return { match: exact[0] };
  const partial = exact.length
    ? exact
    : items.filter((i) => {
        const n = normalize(getName(i));
        return n.includes(q) || q.includes(n);
      });
  if (partial.length === 1) return { match: partial[0] };
  if (partial.length === 0) {
    const all = items.map(getName);
    return {
      error: `No encuentro ${what} «${query}».` + (all.length ? ` Opciones: ${all.join(", ")}.` : ` No hay ninguno.`),
    };
  }
  return { error: `«${query}» es ambiguo, puede ser: ${partial.map(getName).join(", ")}.` };
}

// "12,50", "12.5", "12 €" -> 1250. Devuelve null si no es un importe valido.
function euroCents(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  const s = String(value || "").replace(/€|eur(os)?/gi, "").replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}

function euros(cents) {
  return `${(cents / 100).toFixed(2).replace(".", ",")} €`;
}

module.exports = {
  DATE_RE,
  todayKey,
  addDays,
  DAY_WORDS,
  resolveDay,
  weekday,
  normalize,
  detectShoppingCategory,
  EXPENSE_CATS,
  findByName,
  euroCents,
  euros,
};
