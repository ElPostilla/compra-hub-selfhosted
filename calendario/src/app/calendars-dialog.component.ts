import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { CalendarStateService } from './calendar-state.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-calendars-dialog',
  standalone: true,
  imports: [IconComponent],
  template: `
    <dialog #dialog (click)="onBackdropClick($event)">
      <div class="dialog-inner">
        <h2>Tus calendarios</h2>
        <div class="list-section-label">Personal</div>
        <ul>
          <li [class.active]="state.viewMode() === 'personal'">
            <button type="button" class="calendar-row-name" (click)="selectPersonal()">Mi calendario</button>
          </li>
        </ul>

        @if (state.groupLists().length) {
          <div class="list-section-label">Grupos compartidos</div>
          <ul>
            @for (g of state.groupLists(); track g.id) {
              <li [class.active]="state.viewMode() === 'group' && state.currentGroupId() === g.id">
                <button type="button" class="calendar-row-name" (click)="selectGroup(g.id)">{{ g.name }}</button>
                <span class="calendar-row-meta"><app-icon name="people"></app-icon> {{ g.memberCount }}</span>
              </li>
            }
          </ul>
        }

        <button type="button" id="close-calendars-dialog" (click)="close()">Cerrar</button>
      </div>
    </dialog>
  `,
})
export class CalendarsDialogComponent {
  readonly state = inject(CalendarStateService);

  @ViewChild('dialog') private dialogRef!: ElementRef<HTMLDialogElement>;

  open() {
    this.dialogRef.nativeElement.showModal();
  }

  close() {
    this.dialogRef.nativeElement.close();
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === this.dialogRef.nativeElement) this.close();
  }

  async selectPersonal() {
    await this.state.switchToPersonal();
    this.close();
  }

  async selectGroup(groupId: string) {
    await this.state.switchToGroup(groupId);
    this.close();
  }
}
