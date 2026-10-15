import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { GroupAccount, Meal, OwnerMode, Slot, mealKey } from './models';

const API = '/api-menu';
const OWNER_KEY = 'menu-owner';

function fmtDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function mondayOf(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay(); // 0=domingo
  const offset = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + offset);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

// Estado central del menu semanal: "Mi menu" (personal) y menus de grupo
// (compartidos, en tiempo real). Mismos grupos que en el resto del hub.
@Injectable({ providedIn: 'root' })
export class MenuStateService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly weekStart = signal(mondayOf(new Date()));
  readonly meals = signal<Map<string, Meal>>(new Map());
  readonly groups = signal<GroupAccount[]>([]);
  readonly ownerMode = signal<OwnerMode>('personal');
  readonly currentGroupId = signal<string | null>(null);

  readonly currentGroup = computed(
    () => this.groups().find((g) => g.id === this.currentGroupId()) ?? null,
  );
  readonly menuName = computed(() =>
    this.ownerMode() === 'group' ? (this.currentGroup()?.name ?? 'Grupo') : 'Mi menú',
  );

  readonly weekDays = computed(() => {
    const start = this.weekStart();
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
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
    await this.loadWeek();
    await this.loadGroups();
  }

  async switchToPersonal(): Promise<void> {
    this.ownerMode.set('personal');
    this.currentGroupId.set(null);
    this.saveOwnerState();
    await this.loadWeek();
  }

  async switchToGroup(groupId: string): Promise<void> {
    this.ownerMode.set('group');
    this.currentGroupId.set(groupId);
    this.saveOwnerState();
    await this.loadWeek();
  }

  private mealsBase(): string {
    return this.ownerMode() === 'group' ? `${API}/groups/${this.currentGroupId()}/meals` : `${API}/meals`;
  }

  changeWeek(deltaWeeks: number) {
    const d = new Date(this.weekStart());
    d.setDate(d.getDate() + deltaWeeks * 7);
    this.weekStart.set(mondayOf(d));
    this.loadWeek();
  }

  goThisWeek() {
    this.weekStart.set(mondayOf(new Date()));
    this.loadWeek();
  }

  async loadWeek(): Promise<void> {
    const start = fmtDate(this.weekStart());
    const end = fmtDate(this.weekDays()[6]);
    try {
      const data = await this.api.get<{ meals: Meal[] }>(`${this.mealsBase()}?start=${start}&end=${end}`);
      const map = new Map<string, Meal>();
      for (const m of data.meals || []) map.set(mealKey(m.date, m.slot), m);
      this.meals.set(map);
    } catch {
      this.meals.set(new Map());
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

  async setMeal(date: string, slot: Slot, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) {
      await this.clearMeal(date, slot);
      return;
    }
    try {
      const meal = await this.api.put<Meal>(`${this.mealsBase()}/${date}/${slot}`, { title: trimmed });
      this.meals.update((m) => {
        const next = new Map(m);
        next.set(mealKey(date, slot), meal);
        return next;
      });
    } catch {
      this.toast.show('No se pudo guardar el plato.');
    }
  }

  // Los ingredientes solo tienen sentido si ya hay un plato guardado en esa
  // franja (si no, no hay a que "engancharlos"). Se mandan siempre junto
  // con el titulo actual: el backend reemplaza la lista entera, no la
  // fusiona.
  async setIngredients(date: string, slot: Slot, raw: string): Promise<void> {
    const meal = this.meals().get(mealKey(date, slot));
    if (!meal) return;
    const ingredients = raw.split(',').map((s) => s.trim()).filter(Boolean);
    try {
      const updated = await this.api.put<Meal>(`${this.mealsBase()}/${date}/${slot}`, {
        title: meal.title,
        ingredients,
      });
      this.meals.update((m) => {
        const next = new Map(m);
        next.set(mealKey(date, slot), updated);
        return next;
      });
    } catch {
      this.toast.show('No se pudieron guardar los ingredientes.');
    }
  }

  async clearMeal(date: string, slot: Slot): Promise<void> {
    try {
      await this.api.delete(`${this.mealsBase()}/${date}/${slot}`);
      this.meals.update((m) => {
        const next = new Map(m);
        next.delete(mealKey(date, slot));
        return next;
      });
    } catch {
      this.toast.show('No se pudo borrar el plato.');
    }
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
    if (msg.type === 'meal_upserted' && msg.meal) {
      this.meals.update((m) => {
        const next = new Map(m);
        next.set(mealKey(msg.meal!.date, msg.meal!.slot), msg.meal!);
        return next;
      });
    } else if (msg.type === 'meal_deleted' && msg.date && msg.slot) {
      this.meals.update((m) => {
        const next = new Map(m);
        next.delete(mealKey(msg.date!, msg.slot!));
        return next;
      });
    }
  }
}

interface WsMessage {
  type: string;
  groupId: string;
  meal?: Meal;
  date?: string;
  slot?: Slot;
}
