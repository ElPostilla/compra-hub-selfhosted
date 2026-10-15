import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TasksStateService } from './tasks-state.service';
import { IMPORTANCE_LABELS, STATUSES, STATUS_LABELS, Task, TaskStatus } from './models';
import { IconComponent } from './icon.component';
import { DropTarget, applyMove, startDrag } from './drag-sort';

function todayKey(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Arrastrar para ordenar con Pointer Events (ver drag-sort.ts; el HTML5
// DnD de antes no funcionaba con el dedo en iPhone): desde el asa (⠿) de
// cada tarjeta, dentro de su columna o a otra. Soltar sobre una tarjeta la
// coloca delante o detras segun la mitad; sobre el hueco de una columna,
// al final. Cada suelta se persiste de una vez con saveBoard() (orden
// compartido en los grupos).
@Component({
  selector: 'app-kanban-board',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <div class="kanban">
      @for (status of statuses; track status) {
        <div class="kanban-col" [attr.data-drop-status]="status" [class.drop-end]="dropEnd() === status">
          <div class="kanban-col-head">
            <span>{{ labels[status] }}</span>
            <span class="kanban-count">{{ state.columns()[status].length }}</span>
          </div>
          <div class="kanban-cards">
            @for (task of state.columns()[status]; track task.id) {
              <div
                class="kanban-card"
                [attr.data-task-id]="task.id"
                [attr.data-status]="status"
                [attr.data-imp]="task.importance"
                [class.drop-before]="dropBefore() === task.id"
              >
                <div class="kanban-card-top">
                  <button
                    type="button"
                    class="drag-handle"
                    [attr.aria-label]="'Mover ' + task.title"
                    (pointerdown)="onGrab($event, task)"
                  >
                    <span aria-hidden="true">⠿</span>
                  </button>
                  <span class="kanban-card-title" [class.struck]="status === 'done'">{{ task.title }}</span>
                  <button type="button" class="kanban-card-del" [attr.aria-label]="'Eliminar ' + task.title" (click)="remove(task.id)"><app-icon name="close"></app-icon></button>
                </div>
                <div class="kanban-card-meta">
                  <span class="imp-label" [attr.data-imp]="task.importance">{{ impLabels[task.importance] }}</span>
                  @if (task.dueDate) {
                    <span class="due-badge" [class.overdue]="isOverdue(task)">
                      @if (task.recurrence !== 'none') {
                        <app-icon name="repeat"></app-icon>
                      }
                      {{ formatDue(task.dueDate) }}
                    </span>
                  }
                </div>
              </div>
            }
            @if (!state.columns()[status].length) {
              <div class="kanban-empty">Sin tarjetas</div>
            }
          </div>
          @if (status === 'todo') {
            <form class="kanban-add" (submit)="add($event)">
              <input type="text" [(ngModel)]="newTitle" name="newTitle" placeholder="Nueva tarjeta" />
              <button type="submit" aria-label="Añadir tarjeta"><app-icon name="plus"></app-icon></button>
            </form>
          }
        </div>
      }
    </div>
  `,
})
export class KanbanBoardComponent {
  readonly state = inject(TasksStateService);
  readonly statuses = STATUSES;
  readonly labels = STATUS_LABELS;
  readonly impLabels = IMPORTANCE_LABELS;

  newTitle = '';
  readonly dropBefore = signal<string | null>(null);
  readonly dropEnd = signal<TaskStatus | null>(null);

  onGrab(ev: PointerEvent, task: Task) {
    const item = (ev.currentTarget as HTMLElement).closest<HTMLElement>('.kanban-card')!;
    startDrag(ev, {
      id: task.id,
      status: task.status,
      item,
      sameStatusOnly: false,
      onMove: (t) => this.showTarget(t),
      onDrop: (t) => t && this.drop(task, t),
    });
  }

  private showTarget(t: DropTarget | null) {
    this.dropBefore.set(t?.beforeId ?? null);
    this.dropEnd.set(t && !t.beforeId ? t.status : null);
  }

  private async drop(task: Task, target: DropTarget) {
    const next = applyMove(this.state.columns(), task.id, task.status, target);
    if (next) await this.state.saveBoard(next);
  }

  async remove(id: string) {
    await this.state.deleteTask(id);
  }

  async add(event: Event) {
    event.preventDefault();
    const title = this.newTitle.trim();
    if (!title) return;
    this.newTitle = '';
    await this.state.addTask({ title });
  }

  isOverdue(task: Task): boolean {
    return !!task.dueDate && task.status !== 'done' && task.dueDate < todayKey();
  }

  formatDue(dueDate: string): string {
    const d = new Date(dueDate + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }
}
