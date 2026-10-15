const test = require("node:test");
const assert = require("node:assert/strict");
const { todayKey, addDays, weekday, detectShoppingCategory, findByName, euroCents, euros } = require("../util");

test("todayKey usa la hora de Madrid, no UTC", () => {
  // 23:30 UTC del 24/09 = 01:30 del 25/09 en Madrid (horario de verano).
  assert.equal(todayKey(new Date("2026-09-24T23:30:00Z")), "2026-09-25");
  assert.equal(todayKey(new Date("2026-09-24T10:00:00Z")), "2026-09-24");
});

test("addDays cruza meses y años", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

test("weekday en español", () => {
  assert.equal(weekday("2026-09-24"), "jueves");
});

test("detectShoppingCategory coincide con el frontend", () => {
  assert.equal(detectShoppingCategory("Leche"), "lacteos");
  assert.equal(detectShoppingCategory("plátanos"), "fruver");
  assert.equal(detectShoppingCategory("Pan de molde"), "pan");
  assert.equal(detectShoppingCategory("lejía"), "limpieza");
  assert.equal(detectShoppingCategory("pilas AA"), "otros");
});

test("euroCents acepta los formatos habituales", () => {
  assert.equal(euroCents("23,50"), 2350);
  assert.equal(euroCents("23.5"), 2350);
  assert.equal(euroCents("12 €"), 1200);
  assert.equal(euroCents(9.99), 999);
  assert.equal(euroCents("0"), null);
  assert.equal(euroCents("-5"), null);
  assert.equal(euroCents("mucho"), null);
  assert.equal(euros(2350), "23,50 €");
});

test("findByName: exacto, parcial, ambiguo y ausente", () => {
  const items = [{ n: "Leche" }, { n: "Leche de avena" }, { n: "Pan" }];
  const get = (i) => i.n;
  assert.equal(findByName(items, "leche", get, "x").match.n, "Leche");
  assert.equal(findByName(items, "avena", get, "x").match.n, "Leche de avena");
  assert.equal(findByName(items, "PAN", get, "x").match.n, "Pan");
  assert.match(findByName(items, "lech", get, "x").error, /ambiguo/);
  assert.match(findByName(items, "huevos", get, "x").error, /No encuentro/);
});

test("resolveDay: hoy, mañana y días de la semana (el próximo, hoy incluido)", () => {
  const { resolveDay } = require("../util");
  // 2026-10-01 es jueves
  assert.equal(resolveDay("hoy", "2026-10-01"), "2026-10-01");
  assert.equal(resolveDay("Mañana", "2026-10-01"), "2026-10-02");
  assert.equal(resolveDay("pasado manana", "2026-10-01"), "2026-10-03");
  assert.equal(resolveDay("el jueves", "2026-10-01"), "2026-10-01");
  assert.equal(resolveDay("Viernes", "2026-10-01"), "2026-10-02");
  assert.equal(resolveDay("miercoles", "2026-10-01"), "2026-10-07");
  assert.equal(resolveDay("domingo", "2026-10-01"), "2026-10-04");
  assert.equal(resolveDay("la semana que viene", "2026-10-01"), null);
});
