export type Importance = 'baja' | 'media' | 'alta';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type RemindMinutes = 0 | 30 | 60 | 1440;

// Lo que se guarda de una nota (crear / editar).
export interface NoteFields {
  note: string;
  importance: Importance;
  recurrence: Recurrence;
  time: string | null;
  remindMinutes: RemindMinutes | null;
}

// Opciones de aviso. Sin hora, el aviso es a las 09:00 (ver
// calendario-api/notes-reminders.js), de ahi los textos distintos.
export const REMIND_OPTIONS: RemindMinutes[] = [0, 30, 60, 1440];
export function remindLabel(minutes: RemindMinutes, hasTime: boolean): string {
  if (!hasTime) return minutes === 1440 ? 'El día anterior a las 9:00' : 'Ese día a las 9:00';
  return { 0: 'A la hora', 30: '30 minutos antes', 60: '1 hora antes', 1440: 'El día anterior' }[minutes];
}

export interface NoteEntry {
  id: string;
  note: string;
  importance: Importance;
  recurrence: Recurrence;
  // Hora opcional (HH:MM) y aviso push: minutos antes (0, 30, 60, 1440).
  time: string | null;
  remindMinutes: RemindMinutes | null;
  // true si esta es una fila real guardada; false si es una repeticion
  // calculada al vuelo por el backend (ver expandRecurring en
  // calendario-api/db.js) -- una proyeccion no se puede editar/borrar
  // directamente, solo la nota de origen (en su fecha real).
  origin: boolean;
}

export const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: 'No se repite',
  daily: 'Cada día',
  weekly: 'Cada semana',
  monthly: 'Cada mes',
};

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
}

export interface GroupCalendar {
  id: string;
  name: string;
  ownerId: string;
  listId: string;
  memberCount: number;
  isOwner: boolean;
}

export type ViewMode = 'personal' | 'group';

export interface Profile {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  accountConsoleUrl: string;
}
