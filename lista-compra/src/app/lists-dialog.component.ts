import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ListStateService } from './list-state.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-lists-dialog',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <dialog #dialog (click)="onBackdropClick($event)">
      <div class="dialog-inner">
        <h2>Tus listas</h2>
        <div class="list-section-label">Personales</div>
        <ul>
          @for (l of state.lists(); track l.id) {
            <li [class.active]="state.viewMode() === 'personal' && state.currentListId() === l.id">
              <button type="button" class="list-row-name" (click)="selectPersonal(l.id)">{{ l.name }}</button>
              <span class="list-row-meta">{{ pendingCount(l.items) }} pend.</span>
              <button type="button" class="icon-btn small" [attr.aria-label]="'Renombrar ' + l.name" (click)="rename(l.id, l.name)">
                <span aria-hidden="true">✎</span>
              </button>
              <button type="button" class="icon-btn small danger" [attr.aria-label]="'Eliminar ' + l.name" (click)="remove(l.id, l.name)">
                <app-icon name="trash"></app-icon>
              </button>
            </li>
          }
        </ul>
        <form (ngSubmit)="createList()">
          <input type="text" name="newListName" [(ngModel)]="newListName" placeholder="Nueva lista…" autocomplete="off" />
          <button type="submit">Crear</button>
        </form>

        @if (state.groupLists().length) {
          <div class="list-section-label">Grupos compartidos</div>
          <ul>
            @for (g of state.groupLists(); track g.id) {
              <li [class.active]="state.viewMode() === 'group' && state.currentGroupId() === g.id">
                <button type="button" class="list-row-name" (click)="selectGroup(g.id)">{{ g.name }}</button>
                <span class="list-row-meta"><app-icon name="people"></app-icon> {{ g.memberCount }}</span>
              </li>
            }
          </ul>
        }

        <button type="button" id="close-lists-dialog" (click)="close()">Cerrar</button>
      </div>
    </dialog>
  `,
})
export class ListsDialogComponent {
  readonly state = inject(ListStateService);

  @ViewChild('dialog') private dialogRef!: ElementRef<HTMLDialogElement>;
  newListName = '';

  pendingCount(items: { done: boolean }[]): number {
    return items.filter((i) => !i.done).length;
  }

  open() {
    this.dialogRef.nativeElement.showModal();
  }
  close() {
    this.dialogRef.nativeElement.close();
  }
  onBackdropClick(event: MouseEvent) {
    if (event.target === this.dialogRef.nativeElement) this.close();
  }

  selectPersonal(listId: string) {
    this.state.switchToPersonal(listId);
    this.close();
  }
  selectGroup(groupId: string) {
    this.state.switchToGroup(groupId);
    this.close();
  }

  rename(listId: string, current: string) {
    const next = prompt('Nuevo nombre de la lista:', current);
    if (next && next.trim()) this.state.renameList(listId, next.trim());
  }

  remove(listId: string, name: string) {
    if (this.state.lists().length <= 1) {
      alert('Tiene que quedar al menos una lista.');
      return;
    }
    if (!confirm(`¿Eliminar la lista "${name}" y todo su contenido?`)) return;
    this.state.deleteList(listId);
  }

  createList() {
    const name = this.newListName.trim();
    if (!name) return;
    this.state.createList(name);
    this.newListName = '';
    this.close();
  }
}
