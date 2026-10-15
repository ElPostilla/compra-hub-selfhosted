const test = require("node:test");
const assert = require("node:assert/strict");
const { dueReminders, madridToUtc, occursOn, describe } = require("../notes-reminders");
const { validateNoteBody, noteValues } = require("../notes-common");

const note = (extra) => ({ id: "n1", date: "2026-10-02", note: "Dentista", time: "17:30", remind_minutes: 30, recurrence: "none", ...extra });

test("madridToUtc respeta el horario de verano e invierno", () => {
  // Verano (UTC+2) e invierno (UTC+1).
  assert.equal(new Date(madridToUtc("2026-07-01", "17:30")).toISOString(), "2026-07-01T15:30:00.000Z");
  assert.equal(new Date(madridToUtc("2026-12-01", "17:30")).toISOString(), "2026-12-01T16:30:00.000Z");
  // Dia del cambio de hora (25/10/2026, a las 3:00 vuelven a ser las 2:00).
  assert.equal(new Date(madridToUtc("2026-10-25", "12:00")).toISOString(), "2026-10-25T11:00:00.000Z");
  assert.equal(new Date(madridToUtc("2026-03-29", "12:00")).toISOString(), "2026-03-29T10:00:00.000Z");
});

test("occursOn: notas sueltas y que se repiten", () => {
  assert.equal(occursOn(note(), "2026-10-02"), true);
  assert.equal(occursOn(note(), "2026-10-03"), false);
  assert.equal(occursOn(note({ recurrence: "weekly" }), "2026-10-16"), true);
  assert.equal(occursOn(note({ recurrence: "weekly" }), "2026-10-17"), false);
  assert.equal(occursOn(note({ recurrence: "monthly" }), "2026-12-02"), true);
  assert.equal(occursOn(note({ recurrence: "daily" }), "2026-10-01"), false, "no antes de la primera vez");
});

test("dueReminders: 30 min antes, dentro de la ventana, y no antes ni mucho despues", () => {
  const fire = madridToUtc("2026-10-02", "17:00"); // 17:30 - 30 min
  assert.equal(dueReminders([note()], fire - 60000).length, 0, "un minuto antes: aun no");
  assert.equal(dueReminders([note()], fire).length, 1, "a su hora");
  assert.equal(dueReminders([note()], fire + 10 * 60000).length, 1, "10 min tarde (reinicio): se envia");
  assert.equal(dueReminders([note()], fire + 20 * 60000).length, 0, "20 min tarde: se da por perdido");
  assert.equal(dueReminders([note({ remind_minutes: null })], fire).length, 0, "sin aviso");
});

test("dueReminders: el dia anterior, y sin hora a las 09:00", () => {
  const diaAntes = note({ remind_minutes: 1440 });
  const r = dueReminders([diaAntes], madridToUtc("2026-10-01", "17:31"));
  assert.deepEqual(r.map((x) => x.occurrence), ["2026-10-02"]);
  const sinHora = note({ time: null, remind_minutes: 0 });
  assert.equal(dueReminders([sinHora], madridToUtc("2026-10-02", "09:02")).length, 1);
  assert.equal(dueReminders([sinHora], madridToUtc("2026-10-02", "08:59")).length, 0);
});

test("dueReminders: una nota semanal avisa en cada repeticion", () => {
  const semanal = note({ recurrence: "weekly", remind_minutes: 0 });
  const r = dueReminders([semanal], madridToUtc("2026-10-16", "17:30"));
  assert.deepEqual(r.map((x) => x.occurrence), ["2026-10-16"]);
});

test("describe: textos del aviso", () => {
  const now = madridToUtc("2026-10-02", "17:00");
  assert.equal(describe(note(), "2026-10-02", now), "Dentro de 30 minutos (17:30)");
  assert.equal(describe(note({ remind_minutes: 60 }), "2026-10-02", now), "Dentro de 1 hora (17:30)");
  assert.equal(describe(note({ remind_minutes: 0, time: "09:05" }), "2026-10-02", now), "Hoy a las 9:05");
  assert.equal(describe(note({ remind_minutes: 1440 }), "2026-10-03", now), "Mañana a las 17:30");
  assert.equal(describe(note({ time: null, remind_minutes: 0 }), "2026-10-02", now), "Hoy");
});

test("validacion de hora y aviso", () => {
  assert.equal(validateNoteBody({ note: "x", time: "17:30", remindMinutes: 30 }), null);
  assert.equal(validateNoteBody({ note: "x", time: "", remindMinutes: null }), null);
  assert.match(validateNoteBody({ note: "x", time: "25:00" }), /Hora/);
  assert.match(validateNoteBody({ note: "x", time: "5:30" }), /Hora/);
  assert.match(validateNoteBody({ note: "x", remindMinutes: 45 }), /Aviso/);
  assert.deepEqual(noteValues({ note: " Dentista ", time: "" }), { note: "Dentista", importance: "media", recurrence: "none", time: null, remindMinutes: null });
});
