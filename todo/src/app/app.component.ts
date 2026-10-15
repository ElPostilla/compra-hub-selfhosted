import { Component, ViewChild, inject } from '@angular/core';
import { AsistenteComponent } from './asistente.component';
import { FormsModule } from '@angular/forms';
import { ProfileMenuComponent } from './profile-menu.component';
import { NavDrawerComponent } from './nav-drawer.component';
import { IconComponent } from './icon.component';
import { GroupsDialogComponent } from './groups-dialog.component';
import { TaskListComponent } from './task-list.component';
import { KanbanBoardComponent } from './kanban-board.component';
import { TasksStateService } from './tasks-state.service';
import { ToastService } from './toast.service';
import { Recurrence, RECURRENCES, RECURRENCE_LABELS, IMPORTANCES, IMPORTANCE_LABELS, Importance } from './models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, ProfileMenuComponent, NavDrawerComponent, IconComponent, GroupsDialogComponent, TaskListComponent, KanbanBoardComponent, AsistenteComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  // Asistente (chat comun a todas las apps, ver asistente.component.ts):
  // que se esta viendo, para que «añade…» vaya ahi, y que recargar cuando
  // el asistente cambia datos.
  assistantView(): string | null {
    return this.state.ownerMode() === 'group' ? `el tablero del grupo «${this.state.boardName()}»` : 'tus tareas personales';
  }
  onAssistantChanged() {
    this.state.loadTasks();
  }

  readonly state = inject(TasksStateService);
  readonly toast = inject(ToastService);

  @ViewChild(GroupsDialogComponent) private groupsDialog!: GroupsDialogComponent;

  readonly recurrences = RECURRENCES;
  readonly recurrenceLabels = RECURRENCE_LABELS;
  readonly importances = IMPORTANCES;
  readonly importanceLabels = IMPORTANCE_LABELS;

  newTitle = '';
  newDueDate = '';
  newRecurrence: Recurrence = 'none';
  newImportance: Importance = 'media';

  async ngOnInit() {
    await this.state.init();
  }

  openGroupsDialog() {
    this.groupsDialog.open();
  }

  async addTask(event: Event) {
    event.preventDefault();
    const title = this.newTitle.trim();
    if (!title) return;
    const dueDate = this.newDueDate || null;
    const recurrence = this.newRecurrence;
    this.newTitle = '';
    this.newDueDate = '';
    const importance = this.newImportance;
    this.newRecurrence = 'none';
    this.newImportance = 'media';
    try {
      await this.state.addTask({ title, dueDate, recurrence, importance });
    } catch {
      this.toast.show('No se pudo añadir la tarea.');
    }
  }
}
