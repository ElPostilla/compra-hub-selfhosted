import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

export type Importance = 'baja' | 'media' | 'alta';

export interface DueTask {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done';
  dueDate: string | null;
}

export interface TodayNote {
  note: string;
  importance: Importance;
  time?: string | null;
}

export interface TodayMeals {
  comida?: string;
  cena?: string;
}

export interface PendingBalance {
  groupId: string;
  groupName: string;
  balanceCents: number;
}

export function todayKey(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Resumen "Hoy" en la portada del hub: tareas personales vencidas/para hoy
// y comida de hoy (todo-api, menu-api, ambos personales) + la nota
// personal de hoy (calendario-api) + gastos de grupo pendientes de saldar
// (gastos-api, esos SI son de grupo -- ver loadBalances), leidos via las
// mismas rutas /api-* que usan sus propias apps -- inicio no tiene base de
// datos propia, solo agrega.
@Injectable({ providedIn: 'root' })
export class HomeSummaryService {
  private readonly api = inject(ApiService);

  readonly dueTasks = signal<DueTask[]>([]);
  readonly todayNotes = signal<TodayNote[]>([]);
  readonly todayMeals = signal<TodayMeals>({});
  readonly pendingBalances = signal<PendingBalance[]>([]);
  readonly loaded = signal(false);

  async load(): Promise<void> {
    const today = todayKey();
    await Promise.all([
      this.loadTasks(today),
      this.loadNote(today),
      this.loadMeals(today),
      this.loadBalances(),
    ]);
    this.loaded.set(true);
  }

  private async loadMeals(today: string): Promise<void> {
    try {
      const data = await this.api.get<{ meals: { slot: string; title: string }[] }>(
        `/api-menu/meals?start=${today}&end=${today}`,
      );
      const meals: TodayMeals = {};
      for (const m of data.meals || []) {
        if (m.slot === 'comida') meals.comida = m.title;
        if (m.slot === 'cena') meals.cena = m.title;
      }
      this.todayMeals.set(meals);
    } catch {
      this.todayMeals.set({});
    }
  }

  private async loadBalances(): Promise<void> {
    try {
      const data = await this.api.get<{ balances: PendingBalance[] }>('/api-gastos/groups/balances');
      this.pendingBalances.set((data.balances || []).filter((b) => b.balanceCents < 0));
    } catch {
      this.pendingBalances.set([]);
    }
  }

  private async loadTasks(today: string): Promise<void> {
    try {
      const data = await this.api.get<{ tasks: DueTask[] }>('/api-todo/tasks');
      const due = (data.tasks || [])
        .filter((t) => t.status !== 'done' && !!t.dueDate && t.dueDate <= today)
        .sort((a, b) => (a.dueDate as string).localeCompare(b.dueDate as string));
      this.dueTasks.set(due);
    } catch {
      this.dueTasks.set([]);
    }
  }

  private async loadNote(today: string): Promise<void> {
    try {
      const data = await this.api.get<{ notes: Record<string, TodayNote[]> }>('/api-calendario/notes');
      // Las que tienen hora primero, en orden.
      this.todayNotes.set([...(data.notes?.[today] ?? [])].sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99')));
    } catch {
      this.todayNotes.set([]);
    }
  }

  async completeTask(id: string): Promise<void> {
    this.dueTasks.update((t) => t.filter((x) => x.id !== id));
    await this.api.patch(`/api-todo/tasks/${id}`, { status: 'done' });
  }
}
