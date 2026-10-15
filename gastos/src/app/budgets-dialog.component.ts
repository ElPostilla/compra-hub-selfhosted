import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ExpensesStateService } from './expenses-state.service';
import { ToastService } from './toast.service';
import { CATEGORIES } from './models';
import { IconComponent } from './icon.component';

// Presupuesto fijo por categoria (se repite cada mes hasta que se cambie).
// Un input por categoria; vacio = sin presupuesto para esa categoria.
@Component({
  selector: 'app-budgets-dialog',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    <dialog #dialog (click)="onBackdropClick($event)">
      <div class="dialog-inner">
        <h2>Presupuesto mensual</h2>
        <p class="budgets-hint">{{ state.accountName() }} — deja vacío para no poner límite.</p>
        <ul class="budgets-list">
          @for (c of categories; track c.key) {
            <li class="budget-row">
              <span class="budget-cat-label"><app-icon [name]="c.icon"></app-icon> {{ c.label }}</span>
              <input
                type="text"
                inputmode="decimal"
                class="budget-input"
                [ngModel]="valueFor(c.key)"
                (ngModelChange)="onInput(c.key, $event)"
                placeholder="sin límite"
              />
              <span class="budget-currency">€</span>
            </li>
          }
        </ul>
        <button type="button" id="close-groups-dialog" (click)="close()">Cerrar</button>
      </div>
    </dialog>
  `,
})
export class BudgetsDialogComponent {
  readonly state = inject(ExpensesStateService);
  private readonly toast = inject(ToastService);
  readonly categories = CATEGORIES;

  @ViewChild('dialog') private dialogRef!: ElementRef<HTMLDialogElement>;

  private readonly edits = new Map<string, string>();

  open() {
    this.edits.clear();
    this.dialogRef.nativeElement.showModal();
  }

  close() {
    this.dialogRef.nativeElement.close();
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === this.dialogRef.nativeElement) this.close();
  }

  valueFor(category: string): string {
    if (this.edits.has(category)) return this.edits.get(category)!;
    const budget = this.state.budgets().find((b) => b.category === category);
    return budget ? String(budget.amountCents / 100) : '';
  }

  async onInput(category: string, raw: string) {
    this.edits.set(category, raw);
    const trimmed = raw.trim();
    try {
      if (!trimmed) {
        if (this.state.budgets().some((b) => b.category === category)) {
          await this.state.clearBudget(category);
        }
        return;
      }
      const amount = Number(trimmed.replace(',', '.'));
      if (!amount || amount <= 0) return;
      await this.state.setBudget(category, Math.round(amount * 100));
    } catch {
      this.toast.show('No se pudo guardar el presupuesto.');
    }
  }
}
