import { Component, ViewChild, inject } from '@angular/core';
import { AsistenteComponent } from './asistente.component';
import { FormsModule } from '@angular/forms';
import { ProfileMenuComponent } from './profile-menu.component';
import { NavDrawerComponent } from './nav-drawer.component';
import { IconComponent } from './icon.component';
import { AvatarComponent } from './avatar.component';
import { GroupsDialogComponent } from './groups-dialog.component';
import { BudgetsDialogComponent } from './budgets-dialog.component';
import { HistoryDialogComponent } from './history-dialog.component';
import { ExpensesStateService } from './expenses-state.service';
import { ToastService } from './toast.service';
import { ProfileService } from './profile.service';
import { CATEGORIES, Expense, ExpenseShare, Recurrence, categoryOf, formatCents } from './models';

function todayKey(): string {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, ProfileMenuComponent, NavDrawerComponent, IconComponent, AvatarComponent, GroupsDialogComponent, BudgetsDialogComponent, HistoryDialogComponent, AsistenteComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  // Asistente (chat comun a todas las apps, ver asistente.component.ts):
  // que se esta viendo, para que «añade…» vaya ahi, y que recargar cuando
  // el asistente cambia datos.
  assistantView(): string | null {
    return this.state.ownerMode() === 'group' ? `los gastos del grupo «${this.state.accountName()}»` : 'tus gastos personales';
  }
  onAssistantChanged() {
    this.state.loadExpenses();
    this.state.loadBudgets();
  }

  readonly state = inject(ExpensesStateService);
  readonly toast = inject(ToastService);
  private readonly profile = inject(ProfileService);
  readonly formatCents = formatCents;
  readonly categories = CATEGORIES;
  readonly categoryOf = categoryOf;

  @ViewChild(GroupsDialogComponent) private groupsDialog!: GroupsDialogComponent;
  @ViewChild(BudgetsDialogComponent) private budgetsDialog!: BudgetsDialogComponent;
  @ViewChild(HistoryDialogComponent) private historyDialog!: HistoryDialogComponent;

  newDescription = '';
  newAmount = '';
  newDate = todayKey();
  newCategory = 'otros';
  newRecurrence: Recurrence = 'none';
  // Solo en grupo: quien ha pagado ('' = yo) y quien NO entra en el reparto
  // (se guardan los excluidos, no los incluidos, para que por defecto
  // entren todos los miembros, tambien los que se unan despues).
  newPaidBy = '';
  newExcluded = new Set<string>();
  splitOpen = false;

  async ngOnInit() {
    await this.state.init();
  }

  openGroupsDialog() {
    this.groupsDialog.open();
  }

  openBudgetsDialog() {
    this.budgetsDialog.open();
  }

  openHistoryDialog() {
    this.historyDialog.open();
  }

  async addExpense(event: Event) {
    event.preventDefault();
    const description = this.newDescription.trim();
    const amount = Number(this.newAmount.replace(',', '.'));
    if (!description || !amount || amount <= 0) return;
    const amountCents = Math.round(amount * 100);
    const date = this.newDate || todayKey();
    const category = this.newCategory || 'otros';
    const recurrence = this.newRecurrence;
    let split: { paidBy: string; participants: string[] } | undefined;
    if (this.state.ownerMode() === 'group') {
      const participants = this.participantIds();
      if (!participants.length) {
        this.toast.show('Elige al menos una persona entre la que repartir.');
        return;
      }
      const paidBy = this.payerId();
      if (paidBy) split = { paidBy, participants };
    }
    this.newDescription = '';
    this.newAmount = '';
    this.newRecurrence = 'none';
    try {
      await this.state.addExpense(description, amountCents, date, category, recurrence, split);
    } catch {
      this.toast.show('No se pudo añadir el gasto.');
    }
  }

  async remove(id: string) {
    try {
      await this.state.deleteExpense(id);
    } catch {
      this.toast.show('No se pudo eliminar el gasto.');
    }
  }

  paidByLabel(expense: Expense): string {
    return expense.paidBy ? this.usernameOf(expense.paidBy) : '';
  }

  usernameOf(userId: string): string {
    return this.state.members().find((m) => m.userId === userId)?.username ?? 'antiguo miembro';
  }

  // ---- reparto de un gasto de grupo nuevo

  payerId(): string {
    const me = this.profile.profile()?.id ?? '';
    const chosen = this.newPaidBy || me;
    return this.state.members().some((m) => m.userId === chosen) ? chosen : '';
  }

  participantIds(): string[] {
    return this.state.members().map((m) => m.userId).filter((id) => !this.newExcluded.has(id));
  }

  isParticipant(userId: string): boolean {
    return !this.newExcluded.has(userId);
  }

  toggleParticipant(userId: string) {
    const next = new Set(this.newExcluded);
    if (next.has(userId)) next.delete(userId);
    else next.add(userId);
    this.newExcluded = next;
  }

  // Lo que le tocaria a cada uno con el importe que hay escrito (orientativo:
  // si no es exacto, el servidor reparte los centimos sobrantes).
  splitPreview(): string {
    const amount = Number(this.newAmount.replace(',', '.'));
    const n = this.participantIds().length;
    if (!amount || amount <= 0 || !n) return '';
    return formatCents(Math.floor(Math.round(amount * 100) / n));
  }

  splitSummary(): string {
    const n = this.participantIds().length;
    const total = this.state.members().length;
    const payer = this.payerId();
    const who = payer && payer === this.profile.profile()?.id ? 'yo' : '@' + this.usernameOf(payer);
    return `Pagó ${who} · ${n === total ? 'entre todos' : `entre ${n} de ${total}`}`;
  }

  // ---- quien debe en cada gasto

  // Partes de los demas (la de quien pago no es deuda).
  debtorShares(expense: Expense): ExpenseShare[] {
    return (expense.shares ?? []).filter((s) => s.userId !== expense.paidBy);
  }

  pendingCount(expense: Expense): number {
    return this.debtorShares(expense).filter((s) => !s.settled).length;
  }

  async toggleSettled(expense: Expense, share: ExpenseShare) {
    try {
      await this.state.setShareSettled(expense.id, share.userId, !share.settled);
    } catch {
      this.toast.show('No se pudo actualizar el pago.');
    }
  }

  formatDate(date: string): string {
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  }

  absCents(n: number): number {
    return Math.abs(n);
  }

  categoryPct(totalCents: number): number {
    const max = Math.max(...this.state.categoryTotals().map((c) => c.totalCents), 1);
    return Math.round((totalCents / max) * 100);
  }

  isOverBudget(totalCents: number, budgetCents: number | null): boolean {
    return budgetCents !== null && totalCents > budgetCents;
  }
}
