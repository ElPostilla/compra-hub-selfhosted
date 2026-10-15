import { Component, inject, signal } from '@angular/core';
import { TasksStateService } from './tasks-state.service';
import { IMPORTANCE_LABELS, Importance, Task, TaskStatus } from './models';
import { IconComponent } from './icon.component';
import { DropTarget, applyMove, startDrag } from './drag-sort';

function todayKey(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const NEXT_IMPORTANCE: Record<Importance, Importance> = { baja: 'media', media: 'alta', alta: 'baja' };

// Checklist: marca/desmarca solo alterna entre "todo" y "done" -- una
// tarea "doing" se muestra sin tachar pero con una etiqueta, y se marca
// como hecha en cuanto se pulsa su checkbox (igual de simple que un
// to-do de toda la vida, sin forzar a pasar por "en curso" a mano). Las
// tareas recurrentes se reabren solas (ver resetDueRecurringTasks en el
// backend) en cuanto pasa su fecha límite -- aqui solo se muestran.
//
// Orden a mano: se arrastra desde el asa (⠿), con el dedo o el raton, o
// con las flechas del teclado sobre el asa; solo dentro del mismo estado
// (por hacer / en curso / hecho). En los tableros de grupo el orden es
// compartido (todos ven el mismo). La marca de color es la importancia:
// al tocarla pasa a la siguiente.
@Component({
  selector: 'app-task-list',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (state.orderedTasks().length) {
      <ul class="task-list">
        @for (task of state.orderedTasks(); track task.id) {
          <li
            class="task-row"
            [attr.data-task-id]="task.id"
            [attr.data-status]="task.status"
            [class.drop-before]="dropBefore() === task.id"
            [class.drop-after]="dropAfterStatus() === task.status && isLastOf(task)"
          >
            <button
              type="button"
              class="drag-handle"
              [attr.aria-label]="'Mover ' + task.title + ' (flechas arriba y abajo)'"
              (pointerdown)="onGrab($event, task)"
              (keydown)="onHandleKey($event, task)"
            >
              <span aria-hidden="true">⠿</span>
            </button>
            <button
              type="button"
              class="imp-mark"
              [attr.data-imp]="task.importance"
              [attr.aria-label]="'Importancia ' + labels[task.importance].toLowerCase() + '. Cambiar'"
              [title]="'Importancia: ' + labels[task.importance]"
              (click)="cycleImportance(task)"
            ></button>
            <button
              type="button"
              class="task-checkbox"
              [class.checked]="task.status === 'done'"
              [attr.aria-label]="task.status === 'done' ? 'Marcar como pendiente' : 'Marcar como hecha'"
              (click)="toggle(task)"
            >
              @if (task.status === 'done') {
                <app-icon name="check"></app-icon>
              }
            </button>
            <span class="task-title" [class.done]="task.status === 'done'" [class.struck]="task.status === 'done'">{{ task.title }}</span>
            @if (task.status === 'doing') {
              <span class="doing-badge">En curso</span>
            }
            @if (task.dueDate) {
              <span class="due-badge" [class.overdue]="isOverdue(task)">
                @if (task.recurrence !== 'none') {
                  <app-icon name="repeat"></app-icon>
                }
                {{ formatDue(task.dueDate) }}
              </span>
            }
            <button type="button" class="task-del" [attr.aria-label]="'Eliminar ' + task.title" (click)="remove(task.id)"><app-icon name="close"></app-icon></button>
          </li>
        }
      </ul>
    } @else {
      <p class="empty">No hay tareas. Escribe arriba la primera.</p>
    }
  `,
})
export class TaskListComponent {
  readonly state = inject(TasksStateService);
  readonly labels = IMPORTANCE_LABELS;

  // Indicador de donde caera lo que se arrastra.
  readonly dropBefore = signal<string | null>(null);
  readonly dropAfterStatus = signal<TaskStatus | null>(null);

  async toggle(task: Task) {
    await this.state.setStatus(task.id, task.status === 'done' ? 'todo' : 'done');
  }

  async cycleImportance(task: Task) {
    await this.state.setImportance(task.id, NEXT_IMPORTANCE[task.importance]);
  }

  async remove(id: string) {
    await this.state.deleteTask(id);
  }

  isLastOf(task: Task): boolean {
    const col = this.state.columns()[task.status];
    return col[col.length - 1]?.id === task.id;
  }

  onGrab(ev: PointerEvent, task: Task) {
    const item = (ev.currentTarget as HTMLElement).closest<HTMLElement>('.task-row')!;
    startDrag(ev, {
      id: task.id,
      status: task.status,
      item,
      sameStatusOnly: true,
      onMove: (t) => this.showTarget(t),
      onDrop: (t) => t && this.drop(task, t),
    });
  }

  // Accesibilidad: con el foco en el asa, flechas arriba/abajo mueven la
  // tarea una posicion dentro de su estado.
  onHandleKey(ev: KeyboardEvent, task: Task) {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
    ev.preventDefault();
    const col = this.state.columns()[task.status];
    const idx = col.findIndex((t) => t.id === task.id);
    const to = ev.key === 'ArrowUp' ? idx - 1 : idx + 2;
    if (to < 0 || to > col.length) return;
    this.drop(task, { status: task.status, beforeId: col[to]?.id ?? null }, true);
  }

  private showTarget(t: DropTarget | null) {
    this.dropBefore.set(t?.beforeId ?? null);
    this.dropAfterStatus.set(t && !t.beforeId ? t.status : null);
  }

  private async drop(task: Task, target: DropTarget, keepFocus = false) {
    const next = applyMove(this.state.columns(), task.id, task.status, target);
    if (!next) return;
    await this.state.saveBoard(next);
    if (keepFocus) {
      setTimeout(() => document.querySelector<HTMLElement>(`[data-task-id="${task.id}"] .drag-handle`)?.focus());
    }
  }

  isOverdue(task: Task): boolean {
    return !!task.dueDate && task.status !== 'done' && task.dueDate < todayKey();
  }

  formatDue(dueDate: string): string {
    const d = new Date(dueDate + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }
}
