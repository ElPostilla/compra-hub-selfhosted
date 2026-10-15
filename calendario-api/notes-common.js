// Validacion y forma de las notas, comun a routes/personal.js y
// routes/groups.js (antes cada una tenia su copia de validateNoteBody).
const RECURRENCES = ["none", "daily", "weekly", "monthly"];
const IMPORTANCES = ["baja", "media", "alta"];
// Minutos antes de la hora de la nota: a la hora, 30 min, 1 h, el dia antes.
const REMIND_MINUTES = [0, 30, 60, 1440];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validateNoteBody(body) {
  const { note, importance, recurrence, time, remindMinutes } = body || {};
  if (!note || !String(note).trim()) return "La nota no puede estar vacía.";
  if (importance && !IMPORTANCES.includes(importance)) return "Importancia invalida.";
  if (recurrence !== undefined && !RECURRENCES.includes(recurrence)) return "Repeticion invalida.";
  if (time !== undefined && time !== null && time !== "" && !TIME_RE.test(time)) return "Hora invalida (usa HH:MM).";
  if (remindMinutes !== undefined && remindMinutes !== null && !REMIND_MINUTES.includes(remindMinutes)) {
    return "Aviso invalido.";
  }
  return null;
}

// Valores normalizados para guardar (hora vacia -> null).
function noteValues(body) {
  return {
    note: String(body.note).trim(),
    importance: body.importance || "media",
    recurrence: body.recurrence || "none",
    time: body.time || null,
    remindMinutes: body.remindMinutes ?? null,
  };
}

function toEntry(id, v) {
  return {
    id,
    note: v.note,
    importance: v.importance,
    recurrence: v.recurrence,
    time: v.time,
    remindMinutes: v.remindMinutes,
    origin: true,
  };
}

module.exports = { validateNoteBody, noteValues, toEntry, RECURRENCES, REMIND_MINUTES, TIME_RE };
