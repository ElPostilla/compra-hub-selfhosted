export type TaskStatus = 'todo' | 'doing' | 'done';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';
export type Importance = 'baja' | 'media' | 'alta';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  position: number;
  dueDate: string | null;
  recurrence: Recurrence;
  importance: Importance;
}

export interface NewTaskInput {
  title: string;
  dueDate?: string | null;
  recurrence?: Recurrence;
  importance?: Importance;
}

export const RECURRENCES: Recurrence[] = ['none', 'daily', 'weekly', 'monthly'];

// Mismos valores y colores (--imp-*) que las notas del calendario.
export const IMPORTANCES: Importance[] = ['baja', 'media', 'alta'];
export const IMPORTANCE_LABELS: Record<Importance, string> = { baja: 'Baja', media: 'Media', alta: 'Alta' };

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  none: 'No se repite',
  daily: 'Cada día',
  weekly: 'Cada semana',
  monthly: 'Cada mes',
};

export interface GroupTodo {
  id: string;
  name: string;
  ownerId: string;
  listId: string;
  memberCount: number;
  isOwner: boolean;
}

export type OwnerMode = 'personal' | 'group';
export type BoardMode = 'list' | 'kanban';

export const STATUSES: TaskStatus[] = ['todo', 'doing', 'done'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'Por hacer',
  doing: 'En curso',
  done: 'Hecho',
};

export interface Profile {
  id: string;
  username: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  accountConsoleUrl: string;
}
