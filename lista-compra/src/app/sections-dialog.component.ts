import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ListStateService } from './list-state.service';
import { IconComponent } from './icon.component';

// Secciones de la lista actual: donde se compra cada cosa («Aldi»,
// «Mercadona») o para quien es («Para mamá», «Mi casa»). Las define cada
// cual. Lo que se añade con una seccion elegida arriba va a esa seccion;
// lo que ya estaba se reparte aqui, en la pestaña «Repartir» (un selector
// por fila de la lista apretaba el nombre en el movil). Dos pestañas y no
// todo seguido para que el dialogo quepa centrado en la pantalla.
@Component({
  selector: 'app-sections-dialog',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <dialog #dialog (click)="onBackdropClick($event)">
      <div class="dialog-inner">
        <h2>Secciones</h2>
        @if (sections().length) {
          <div class="sections-tabs" role="tablist">
            <button type="button" role="tab" [class.active]="tab() === 'editar'" [attr.aria-selected]="tab() === 'editar'" (click)="tab.set('editar')">
              Secciones
            </button>
            <button type="button" role="tab" [class.active]="tab() === 'repartir'" [attr.aria-selected]="tab() === 'repartir'" (click)="tab.set('repartir')">
              Repartir @if (unassigned()) {<span class="chip-count">{{ unassigned() }}</span>}
            </button>
          </div>
        }
        @if (tab() === 'editar' || !sections().length) {
        @if (!sections().length) {
          <p class="sections-help">Separa la lista por tienda o por persona. Lo que añadas con una sección elegida va directo a ella.</p>
        }
        @if (sections().length) {
          <ul class="sections-edit">
            @for (s of sections(); track s; let i = $index; let first = $first; let last = $last) {
              <li>
                <span class="list-row-name">{{ s }}</span>
                <span class="list-row-meta">{{ countFor(s) }}</span>
                <button type="button" class="icon-btn small" [disabled]="first" [attr.aria-label]="'Subir ' + s" (click)="move(i, -1)">
                  <span aria-hidden="true">↑</span>
                </button>
                <button type="button" class="icon-btn small" [disabled]="last" [attr.aria-label]="'Bajar ' + s" (click)="move(i, 1)">
                  <span aria-hidden="true">↓</span>
                </button>
                <button type="button" class="icon-btn small" [attr.aria-label]="'Renombrar ' + s" (click)="rename(s)">
                  <span aria-hidden="true">✎</span>
                </button>
                <button type="button" class="icon-btn small danger" [attr.aria-label]="'Eliminar ' + s" (click)="remove(s)">
                  <app-icon name="trash"></app-icon>
                </button>
              </li>
            }
          </ul>
        }
        <form (ngSubmit)="add()">
          <input
            type="text"
            name="newSection"
            [(ngModel)]="newSection"
            placeholder="Nueva sección…"
            autocomplete="off"
            maxlength="40"
          />
          <button type="submit">Añadir</button>
        </form>
        @if (suggestions().length) {
          <div class="section-suggestions">
            @for (s of suggestions(); track s) {
              <button type="button" class="section-chip" (click)="addName(s)">+ {{ s }}</button>
            }
          </div>
        }
        } @else {
          @if (!pending().length) {
            <p class="sections-help">No hay productos pendientes que repartir.</p>
          }
          <ul class="sections-assign">
            @for (item of pending(); track item.id) {
              <li>
                <span class="list-row-name">{{ item.name }}</span>
                <select
                  [attr.aria-label]="'Sección de ' + item.name"
                  (change)="state.setItemSection(item, $any($event.target).value)"
                >
                  <option value="" [selected]="!item.section">Sin sección</option>
                  @for (s of sections(); track s) {
                    <option [value]="s" [selected]="s === item.section">{{ s }}</option>
                  }
                </select>
              </li>
            }
          </ul>
        }
        <button type="button" id="close-sections-dialog" (click)="close()">Cerrar</button>
      </div>
    </dialog>
  `,
})
export class SectionsDialogComponent {
  readonly state = inject(ListStateService);

  @ViewChild('dialog') private dialogRef!: ElementRef<HTMLDialogElement>;
  newSection = '';

  readonly tab = signal<'editar' | 'repartir'>('editar');
  readonly sections = computed(() => this.state.currentList().sections);
  readonly unassigned = computed(() => this.pending().filter((i) => !i.section).length);
  // Primero lo que aun no tiene seccion: es lo que hay que repartir.
  readonly pending = computed(() =>
    this.state
      .currentList()
      .items.filter((i) => !i.done)
      .sort((a, b) => Number(!!a.section) - Number(!!b.section)),
  );
  // Ideas para empezar: las tiendas de siempre y el caso «para otra casa».
  readonly suggestions = computed(() => {
    const have = new Set(this.sections().map((s) => s.toLowerCase()));
    return ['Mercadona', 'Aldi', 'Lidl', 'Dia', 'Para mamá'].filter((s) => !have.has(s.toLowerCase()));
  });

  countFor(section: string): string {
    const n = this.state.currentList().items.filter((i) => !i.done && i.section === section).length;
    return n ? `${n} pend.` : '';
  }

  // Con secciones ya creadas y productos sin repartir, se abre en
  // «Repartir», que es lo que normalmente se viene a hacer.
  open() {
    this.tab.set(this.sections().length && this.unassigned() ? 'repartir' : 'editar');
    this.dialogRef.nativeElement.showModal();
  }
  close() {
    this.dialogRef.nativeElement.close();
  }
  onBackdropClick(event: MouseEvent) {
    if (event.target === this.dialogRef.nativeElement) this.close();
  }

  private exists(name: string, except?: string): boolean {
    return this.sections().some((s) => s !== except && s.toLowerCase() === name.toLowerCase());
  }

  add() {
    this.addName(this.newSection);
  }

  async addName(raw: string) {
    const name = raw.trim().slice(0, 40);
    if (!name) return;
    if (this.exists(name)) {
      alert(`Ya hay una sección «${name}».`);
      return;
    }
    if (await this.state.saveSections([...this.sections(), name])) this.newSection = '';
  }

  move(index: number, delta: number) {
    const next = [...this.sections()];
    const [s] = next.splice(index, 1);
    next.splice(index + delta, 0, s);
    this.state.saveSections(next);
  }

  rename(current: string) {
    const name = prompt('Nuevo nombre de la sección:', current)?.trim().slice(0, 40);
    if (!name || name === current) return;
    if (this.exists(name, current)) {
      alert(`Ya hay una sección «${name}».`);
      return;
    }
    this.state.saveSections(
      this.sections().map((s) => (s === current ? name : s)),
      { from: current, to: name },
    );
  }

  remove(section: string) {
    const n = this.state.currentList().items.filter((i) => i.section === section).length;
    const msg = n
      ? `¿Eliminar la sección «${section}»? Sus ${n} producto(s) se quedan en la lista, sin sección.`
      : `¿Eliminar la sección «${section}»?`;
    if (!confirm(msg)) return;
    this.state.saveSections(this.sections().filter((s) => s !== section));
  }
}
