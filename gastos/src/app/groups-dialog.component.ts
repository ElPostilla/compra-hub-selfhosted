import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { ExpensesStateService } from './expenses-state.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-groups-dialog',
  standalone: true,
  imports: [IconComponent],
  template: `
    <dialog #dialog (click)="onBackdropClick($event)">
      <div class="dialog-inner">
        <h2>Tus cuentas</h2>
        <div class="list-section-label">Personal</div>
        <ul>
          <li [class.active]="state.ownerMode() === 'personal'">
            <button type="button" class="account-row-name" (click)="selectPersonal()">Mis gastos</button>
          </li>
        </ul>

        @if (state.groups().length) {
          <div class="list-section-label">Grupos compartidos</div>
          <ul>
            @for (g of state.groups(); track g.id) {
              <li [class.active]="state.ownerMode() === 'group' && state.currentGroupId() === g.id">
                <button type="button" class="account-row-name" (click)="selectGroup(g.id)">{{ g.name }}</button>
                <span class="account-row-meta"><app-icon name="people"></app-icon> {{ g.memberCount }}</span>
              </li>
            }
          </ul>
        }

        <button type="button" id="close-groups-dialog" (click)="close()">Cerrar</button>
      </div>
    </dialog>
  `,
})
export class GroupsDialogComponent {
  readonly state = inject(ExpensesStateService);

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
