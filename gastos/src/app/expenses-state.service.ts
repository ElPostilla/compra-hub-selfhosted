import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { Balance, Budget, CategoryTotal, Debt, Expense, GroupAccount, MonthTotal, OwnerMode, Recurrence, categoryOf } from './models';

const API = '/api-gastos';
const OWNER_KEY = 'gastos-owner';

function monthKey(date: string): string {
  return date.slice(0, 7);
}
function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

// Estado central de gastos: "Mis gastos" (personales) y gastos de grupo
// (compartidos, reparto igualitario, saldo neto por persona). Mismos
// grupos que en el resto del hub, via la llamada cruzada a
// lista-compra-api (ver groupsClient.js del backend).
@Injectable({ providedIn: 'root' })
export class ExpensesStateService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly expenses = signal<Expense[]>([]);
  readonly groups = signal<GroupAccount[]>([]);
  readonly balances = signal<Balance[]>([]);
  readonly debts = signal<Debt[]>([]);
  readonly budgets = signal<Budget[]>([]);
  readonly ownerMode = signal<OwnerMode>('personal');
  readonly currentGroupId = signal<string | null>(null);

  readonly currentGroup = computed(
    () => this.groups().find((g) => g.id === this.currentGroupId()) ?? null,
  );
  // Miembros del grupo actual: el saldo trae uno por miembro, asi que no
  // hace falta otra llamada para elegir quien paga y entre quien se reparte.
  readonly members = computed(() => this.balances().map((b) => ({ userId: b.userId, username: b.username })));

  readonly accountName = computed(() =>
    this.ownerMode() === 'group' ? (this.currentGroup()?.name ?? 'Grupo') : 'Mis gastos',
  );

  readonly monthTotalCents = computed(() => {
    const mk = currentMonthKey();
    return this.expenses()
      .filter((e) => monthKey(e.date) === mk)
      .reduce((sum, e) => sum + e.amountCents, 0);
  });

  // Desglose del mes actual por categoria, para el resumen visual de la
  // cabecera. Solo incluye categorias con al menos un gasto, ordenadas de
  // mayor a menor importe. budgetCents viene del presupuesto fijo por
  // categoria (null si no se ha puesto ninguno para esa categoria).
  readonly categoryTotals = computed<CategoryTotal[]>(() => {
    const mk = currentMonthKey();
    const totals = new Map<string, number>();
    for (const e of this.expenses()) {
      if (monthKey(e.date) !== mk) continue;
      const key = e.category || 'otros';
      totals.set(key, (totals.get(key) || 0) + e.amountCents);
    }
    const budgetMap = new Map(this.budgets().map((b) => [b.category, b.amountCents]));
    return [...totals.entries()]
      .map(([key, totalCents]) => ({
        category: categoryOf(key),
        totalCents,
        budgetCents: budgetMap.get(key) ?? null,
      }))
      .sort((a, b) => b.totalCents - a.totalCents);
  });

  // Historico de los ultimos 6 meses (incluido el actual), mas reciente
  // primero. No hace falta pedir nada al backend: expenses() ya trae el
  // historial completo de la cuenta actual (ver loadExpenses), esto es
  // solo agruparlo por mes en el cliente.
  readonly monthlyHistory = computed<MonthTotal[]>(() => {
    const months: string[] = [];
    const now = new Date();
    for (let i = 0; i < 6; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }
    const totals = new Map(months.map((m) => [m, 0]));
    for (const e of this.expenses()) {
      const mk = monthKey(e.date);
      if (totals.has(mk)) totals.set(mk, totals.get(mk)! + e.amountCents);
    }
    return months.map((m) => ({ month: m, totalCents: totals.get(m)! }));
  });

  private ws: WebSocket | null = null;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(OWNER_KEY) || 'null');
      if (saved?.mode === 'group' && saved.groupId) {
        this.ownerMode.set('group');
        this.currentGroupId.set(saved.groupId);
      }
    } catch {
      /* localStorage vacio o corrupto: se queda en "personal" */
    }
  }

  private saveOwnerState() {
    localStorage.setItem(
      OWNER_KEY,
      JSON.stringify({ mode: this.ownerMode(), groupId: this.currentGroupId() }),
    );
  }

  async init(): Promise<void> {
    await this.loadExpenses();
    await this.loadBudgets();
    await this.loadGroups();
  }

  async switchToPersonal(): Promise<void> {
    this.ownerMode.set('personal');
    this.currentGroupId.set(null);
    this.saveOwnerState();
    await this.loadExpenses();
    await this.loadBudgets();
  }

  async switchToGroup(groupId: string): Promise<void> {
    this.ownerMode.set('group');
    this.currentGroupId.set(groupId);
    this.saveOwnerState();
    await this.loadExpenses();
    await this.loadBudgets();
  }

  private expensesBase(): string {
    return this.ownerMode() === 'group' ? `${API}/groups/${this.currentGroupId()}/expenses` : `${API}/expenses`;
  }

  private budgetsBase(): string {
    return this.ownerMode() === 'group' ? `${API}/groups/${this.currentGroupId()}/budgets` : `${API}/budgets`;
  }

  async loadBudgets(): Promise<void> {
    if (this.ownerMode() === 'group' && !this.currentGroupId()) {
      this.budgets.set([]);
      return;
    }
    try {
      const data = await this.api.get<{ budgets: Budget[] }>(this.budgetsBase());
      this.budgets.set(data.budgets || []);
    } catch {
      this.budgets.set([]);
    }
  }

  async setBudget(category: string, amountCents: number): Promise<void> {
    await this.api.put<Budget>(`${this.budgetsBase()}/${category}`, { amountCents });
    this.budgets.update((b) => [...b.filter((x) => x.category !== category), { category, amountCents }]);
  }

  async clearBudget(category: string): Promise<void> {
    await this.api.delete(`${this.budgetsBase()}/${category}`);
    this.budgets.update((b) => b.filter((x) => x.category !== category));
  }

  async loadExpenses(): Promise<void> {
    try {
      const data = await this.api.get<{ expenses: Expense[] }>(this.expensesBase());
      this.expenses.set(data.expenses || []);
    } catch {
      this.expenses.set([]);
    }
    if (this.ownerMode() === 'group' && this.currentGroupId()) {
      await this.loadBalance();
    } else {
      this.balances.set([]);
      this.debts.set([]);
    }
  }

  private async loadBalance(): Promise<void> {
    try {
      const data = await this.api.get<{ balances: Balance[]; debts?: Debt[] }>(
        `${API}/groups/${this.currentGroupId()}/balance`,
      );
      this.balances.set(data.balances || []);
      this.debts.set(data.debts || []);
    } catch {
      this.balances.set([]);
      this.debts.set([]);
    }
  }

  async loadGroups(): Promise<void> {
    try {
      const data = await this.api.get<{ groups: GroupAccount[] }>(`${API}/groups`);
      this.groups.set(data.groups);
    } catch {
      this.groups.set([]);
    }
    if (this.ownerMode() === 'group' && !this.groups().some((g) => g.id === this.currentGroupId())) {
      await this.switchToPersonal();
    }
    this.connectWs();
  }

  async addExpense(
    description: string,
    amountCents: number,
    date: string,
    category: string | null,
    recurrence: Recurrence,
    split?: { paidBy: string; participants: string[] },
  ): Promise<void> {
    const created = await this.api.post<Expense>(this.expensesBase(), {
      description,
      amountCents,
      date,
      category,
      recurrence,
      ...(this.ownerMode() === 'group' && split ? split : {}),
    });
    // El servidor emite el broadcast de WS antes de devolver la respuesta
    // HTTP (ver POST .../expenses en gastos-api): en un grupo, el eco puede
    // llegar por el socket ya abierto y aplicarse via handleWsMessage antes
    // de que esta misma promesa se resuelva. Sin este chequeo, el gasto
    // quedaba duplicado -- ya lo habia puesto handleWsMessage, y este
    // update lo volvia a añadir sin comprobar.
    if (!this.expenses().some((e) => e.id === created.id)) {
      this.expenses.update((e) => [created, ...e]);
    }
    if (this.ownerMode() === 'group') await this.loadBalance();
  }

  async deleteExpense(id: string): Promise<void> {
    await this.api.delete(`${this.expensesBase()}/${id}`);
    this.expenses.update((e) => e.filter((x) => x.id !== id));
    this.toast.show('Gasto eliminado.');
    if (this.ownerMode() === 'group') await this.loadBalance();
  }

  // Marca que userId ya ha devuelto (o aun no) su parte de un gasto de grupo.
  async setShareSettled(expenseId: string, userId: string, settled: boolean): Promise<void> {
    const updated = await this.api.patch<Expense>(
      `${API}/groups/${this.currentGroupId()}/expenses/${expenseId}/shares/${userId}`,
      { settled },
    );
    this.replaceExpense(updated);
    await this.loadBalance();
  }

  private replaceExpense(expense: Expense) {
    this.expenses.update((list) => list.map((e) => (e.id === expense.id ? expense : e)));
  }

  private connectWs() {
    if (this.ws || !this.groups().length) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${API}/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      for (const g of this.groups()) ws.send(JSON.stringify({ type: 'subscribe', groupId: g.id }));
    });
    ws.addEventListener('message', (ev) => {
      let msg: WsMessage;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      this.handleWsMessage(msg);
    });
    ws.addEventListener('close', () => {
      this.ws = null;
      setTimeout(() => this.connectWs(), 3000);
    });
  }

  private handleWsMessage(msg: WsMessage) {
    if (this.ownerMode() !== 'group' || msg.groupId !== this.currentGroupId()) return;
    if (msg.type === 'expense_added' && msg.expense) {
      if (!this.expenses().some((e) => e.id === msg.expense!.id)) {
        this.expenses.update((e) => [msg.expense!, ...e]);
        this.loadBalance();
      }
    } else if (msg.type === 'expense_updated' && msg.expense) {
      this.replaceExpense(msg.expense);
      this.loadBalance();
    } else if (msg.type === 'expense_deleted' && msg.id) {
      this.expenses.update((e) => e.filter((x) => x.id !== msg.id));
      this.loadBalance();
    }
  }
}

interface WsMessage {
  type: string;
  groupId: string;
  expense?: Expense;
  id?: string;
}
