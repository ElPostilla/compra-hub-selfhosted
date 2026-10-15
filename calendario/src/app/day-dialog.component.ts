import { IconComponent } from './icon.component';
import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TitleCasePipe } from '@angular/common';
import { CalendarStateService } from './calendar-state.service';
import { ToastService } from './toast.service';
import { CalendarEvent, Importance, NoteEntry, RECURRENCES, RECURRENCE_LABELS, Recurrence, NoteFields, RemindMinutes, REMIND_OPTIONS, remindLabel } from './models';

@Component({
  selector: 'app-day-dialog',
  standalone: true,
  imports: [FormsModule, TitleCasePipe, IconComponent],
  template: `
    <dialog #dialog (click)="onBackdropClick($event)">
      <div class="dialog-inner">
        <h2>{{ title() }}</h2>

        @if (events().length) {
          <ul class="day-events">
            @for (ev of events(); track ev.id) {
              <li>
                <span class="ev-time">{{ ev.allDay ? 'Todo el día' : formatTime(ev.start) }}</span>
                {{ ev.title }}
              </li>
            }
          </ul>
        } @else {
          <p class="no-events">{{ noEventsMessage() }}</p>
        }

        <label class="field-label">Recordatorios</label>
        @if (notes().length) {
          <ul class="day-notes">
            @for (n of notes(); track n.id) {
              <li class="note-row">
                <span class="note-imp-dot" [attr.data-imp]="n.importance"></span>
                <div class="note-row-body">
                  <span class="note-text">
                    @if (n.time) { <strong class="note-time">{{ n.time }}</strong> }
                    {{ n.note }}
                  </span>
                  @if (n.remindMinutes !== null) {
                    <span class="note-remind"><app-icon name="bell"></app-icon> {{ remindLabel(n.remindMinutes, !!n.time) }}</span>
                  }
                  @if (n.recurrence !== 'none') {
                    <span class="note-recurrence-badge">{{ recurrenceLabels[n.recurrence] }}</span>
                  }
                </div>
                @if (n.origin) {
                  <div class="note-row-actions">
                    <button type="button" class="btn-sm" (click)="editNote(n)">Editar</button>
                    <button type="button" class="btn-sm btn-danger" (click)="deleteNote(n)">Borrar</button>
                  </div>
                } @else {
                  <span class="virtual-hint">automática</span>
                }
              </li>
            }
          </ul>
        } @else {
          <p class="no-events">Sin recordatorios este día.</p>
        }

        <form class="note-form" (ngSubmit)="saveNote()">
          <label class="field-label" for="note-input">{{ editingId() ? 'Editar recordatorio' : 'Añadir recordatorio' }}</label>
          <textarea id="note-input" [(ngModel)]="noteText" name="noteText" placeholder="Añade un recordatorio para este día…"></textarea>

          <div class="time-remind">
            <div>
              <label class="field-label" for="time-input">Hora</label>
              <div class="time-wrap">
                <input id="time-input" type="time" [class.empty]="!noteTime" [(ngModel)]="noteTime" name="noteTime" />
                @if (!noteTime) { <span class="time-empty" aria-hidden="true">Sin hora</span> }
              </div>
            </div>
            <div>
              <label class="field-label" for="remind-input">Aviso en el móvil</label>
              <select id="remind-input" [(ngModel)]="remindValue" name="remind">
                <option value="">Sin aviso</option>
                @for (m of remindOptions; track m) {
                  <option [value]="m">{{ remindLabel(m, !!noteTime) }}</option>
                }
              </select>
            </div>
          </div>

          <label class="field-label">Importancia</label>
          <div class="importance-picker">
            @for (imp of importancias; track imp) {
              <button
                type="button"
                class="imp-btn"
                [attr.data-imp]="imp"
                [class.active]="selectedImportance() === imp"
                (click)="selectedImportance.set(imp)"
              >
                {{ imp | titlecase }}
              </button>
            }
          </div>

          <label class="field-label" for="recurrence-input">Repetición</label>
          <select id="recurrence-input" class="recurrence-select" [(ngModel)]="selectedRecurrenceValue" name="recurrence">
            @for (r of recurrences; track r) {
              <option [value]="r">{{ recurrenceLabels[r] }}</option>
            }
          </select>

          <div class="dialog-actions">
            @if (editingId()) {
              <button type="button" class="close-dialog-btn" (click)="cancelEdit()">Cancelar edición</button>
            } @else {
              <span></span>
            }
            <div>
              <button type="button" class="close-dialog-btn" (click)="close()">Cerrar</button>
              <button type="submit" class="save-btn">{{ editingId() ? 'Guardar cambios' : 'Añadir' }}</button>
            </div>
          </div>
        </form>
      </div>
    </dialog>
  `,
})
export class DayDialogComponent {
  readonly state = inject(CalendarStateService);
  private readonly toast = inject(ToastService);

  readonly importancias: Importance[] = ['baja', 'media', 'alta'];
  readonly recurrences = RECURRENCES;
  readonly recurrenceLabels = RECURRENCE_LABELS;

  @ViewChild('dialog') private dialogRef!: ElementRef<HTMLDialogElement>;

  readonly selectedDate = signal<string | null>(null);
  readonly title = signal('');
  readonly events = signal<CalendarEvent[]>([]);
  readonly notes = signal<NoteEntry[]>([]);

  noteText = '';
  noteTime = '';
  // '' = sin aviso; si no, minutos antes como texto (valor del <select>).
  remindValue = '';
  readonly remindOptions = REMIND_OPTIONS;
  readonly remindLabel = remindLabel;
  readonly selectedImportance = signal<Importance>('media');
  selectedRecurrenceValue: Recurrence = 'none';
  readonly editingId = signal<string | null>(null);

  noEventsMessage(): string {
    if (this.state.viewMode() === 'group') {
      return 'Los calendarios de grupo no muestran eventos de Google, solo notas compartidas.';
    }
    return this.state.connected()
      ? 'Sin eventos de Google Calendar este día.'
      : 'Conecta Google Calendar para ver eventos aquí.';
  }

  formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  }

  open(dateKey: string) {
    this.selectedDate.set(dateKey);
    const d = new Date(dateKey + 'T00:00:00');
    this.title.set(d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }));
    this.events.set(this.state.eventsByDate()[dateKey] || []);
    this.notes.set(this.sorted(this.state.notes()[dateKey] || []));
    this.resetForm();
    this.dialogRef.nativeElement.showModal();
  }

  close() {
    this.dialogRef.nativeElement.close();
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === this.dialogRef.nativeElement) this.close();
  }

  private resetForm() {
    this.editingId.set(null);
    this.noteText = '';
    this.noteTime = '';
    this.remindValue = '';
    this.selectedImportance.set('media');
    this.selectedRecurrenceValue = 'none';
  }

  // Primero las que tienen hora (por hora), luego el resto.
  private sorted(list: NoteEntry[]): NoteEntry[] {
    return [...list].sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
  }

  editNote(n: NoteEntry) {
    this.editingId.set(n.id);
    this.noteText = n.note;
    this.selectedImportance.set(n.importance);
    this.selectedRecurrenceValue = n.recurrence;
    this.noteTime = n.time ?? '';
    this.remindValue = n.remindMinutes === null ? '' : String(n.remindMinutes);
  }

  cancelEdit() {
    this.resetForm();
  }

  async saveNote() {
    const date = this.selectedDate();
    if (!date) return;
    const text = this.noteText.trim();
    if (!text) {
      this.toast.show('Escribe algo antes de guardar.');
      return;
    }
    try {
      const fields: NoteFields = {
        note: text,
        importance: this.selectedImportance(),
        recurrence: this.selectedRecurrenceValue,
        time: this.noteTime || null,
        remindMinutes: this.remindValue === '' ? null : (Number(this.remindValue) as RemindMinutes),
      };
      const id = this.editingId();
      if (id) await this.state.updateNote(id, date, fields);
      else await this.state.createNote(date, fields);
      this.notes.set(this.sorted(this.state.notes()[date] || []));
      this.resetForm();
    } catch {
      this.toast.show('No se pudo guardar el recordatorio.');
    }
  }

  async deleteNote(n: NoteEntry) {
    const date = this.selectedDate();
    if (!date || !n.origin) return;
    try {
      await this.state.deleteNote(n.id, date);
      this.notes.set(this.sorted(this.state.notes()[date] || []));
      if (this.editingId() === n.id) this.resetForm();
    } catch {
      this.toast.show('No se pudo eliminar el recordatorio.');
    }
  }
}
