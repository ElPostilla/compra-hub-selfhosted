import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { CalendarEvent, GroupCalendar, Importance, NoteEntry, Recurrence, ViewMode, NoteFields } from './models';

const API = '/api-calendario';
const VIEW_KEY = 'calendario-view';

function fmtDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Estado central del calendario: "Mi calendario" (notas propias + eventos
// de Google del usuario) y calendarios de grupo (solo notas por dia,
// compartidas y en tiempo real, sin eventos de Google -- solo hay una
// cuenta de Google por persona, no por grupo). Mismos grupos que en
// /perfil y en la lista de la compra (ver GroupsService de esa app / la
// llamada cruzada de calendario-api a lista-compra-api).
@Injectable({ providedIn: 'root' })
export class CalendarStateService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly current = signal(startOfMonth(new Date()));
  readonly notes = signal<Record<string, NoteEntry[]>>({});
  readonly eventsByDate = signal<Record<string, CalendarEvent[]>>({});
  readonly connected = signal(false);
  readonly groupLists = signal<GroupCalendar[]>([]);
  readonly viewMode = signal<ViewMode>('personal');
  readonly currentGroupId = signal<string | null>(null);

  readonly currentGroup = computed(
    () => this.groupLists().find((g) => g.id === this.currentGroupId()) ?? null,
  );
  readonly calendarName = computed(() =>
    this.viewMode() === 'group' ? (this.currentGroup()?.name ?? 'Grupo') : 'Mi calendario',
  );

  private ws: WebSocket | null = null;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
      if (saved?.mode === 'group' && saved.groupId) {
        this.viewMode.set('group');
        this.currentGroupId.set(saved.groupId);
      }
    } catch {
      /* localStorage vacio o corrupto: se queda en "personal" */
    }
  }

  private saveViewState() {
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({ mode: this.viewMode(), groupId: this.currentGroupId() }),
    );
  }

  async init(): Promise<void> {
    if (this.viewMode() === 'group') {
      await this.loadNotes();
      await this.refreshMonth();
    } else {
      await this.loadStatus();
      await this.loadNotes();
      await this.refreshMonth();
    }
    // puede corregir la vista si el grupo guardado ya no existe
    await this.loadGroups();
  }

  async switchToPersonal(): Promise<void> {
    this.viewMode.set('personal');
    this.currentGroupId.set(null);
    this.saveViewState();
    await this.loadStatus();
    await this.loadNotes();
    await this.refreshMonth();
  }

  async switchToGroup(groupId: string): Promise<void> {
    this.viewMode.set('group');
    this.currentGroupId.set(groupId);
    this.saveViewState();
    await this.loadNotes();
    await this.refreshMonth();
  }

  async loadStatus(): Promise<void> {
    try {
      const data = await this.api.get<{ connected: boolean }>(API + '/auth/status');
      this.connected.set(!!data.connected);
    } catch {
      this.connected.set(false);
    }
  }

  async loadNotes(): Promise<void> {
    try {
      const data = this.viewMode() === 'group'
        ? await this.api.get<{ notes: Record<string, NoteEntry[]> }>(`${API}/groups/${this.currentGroupId()}/notes`)
        : await this.api.get<{ notes: Record<string, NoteEntry[]> }>(`${API}/notes`);
      this.notes.set(data.notes || {});
    } catch {
      this.notes.set({});
    }
  }

  async loadEvents(rangeStart: Date, rangeEnd: Date): Promise<void> {
    if (this.viewMode() === 'group' || !this.connected()) {
      this.eventsByDate.set({});
      return;
    }
    try {
      const params = new URLSearchParams({ start: fmtDate(rangeStart), end: fmtDate(rangeEnd) });
      const data = await this.api.get<{ events: CalendarEvent[] }>(`${API}/events?${params}`);
      const byDate: Record<string, CalendarEvent[]> = {};
      for (const ev of data.events || []) {
        const key = (ev.start || '').slice(0, 10);
        if (!key) continue;
        (byDate[key] ??= []).push(ev);
      }
      this.eventsByDate.set(byDate);
    } catch {
      this.eventsByDate.set({});
    }
  }

  async refreshMonth(): Promise<void> {
    const c = this.current();
    const rangeStart = new Date(c.getFullYear(), c.getMonth() - 1, 25);
    const rangeEnd = new Date(c.getFullYear(), c.getMonth() + 2, 5);
    await this.loadEvents(rangeStart, rangeEnd);
  }

  setMonth(delta: number) {
    const c = this.current();
    this.current.set(startOfMonth(new Date(c.getFullYear(), c.getMonth() + delta, 1)));
    this.refreshMonth();
  }

  goToday() {
    this.current.set(startOfMonth(new Date()));
    this.refreshMonth();
  }

  private notesBaseEndpoint(): string {
    return this.viewMode() === 'group'
      ? `${API}/groups/${this.currentGroupId()}/notes`
      : `${API}/notes`;
  }

  // Varios recordatorios pueden convivir en la misma fecha -- crear
  // siempre añade una fila nueva, nunca sobrescribe las que ya hay.
  async createNote(date: string, fields: NoteFields): Promise<void> {
    const res = await this.api.post<{ entry: NoteEntry }>(this.notesBaseEndpoint(), { date, ...fields });
    this.notes.update((n) => ({ ...n, [date]: [...(n[date] ?? []), res.entry] }));
    this.toast.show('Recordatorio guardado.');
  }

  async updateNote(id: string, date: string, fields: NoteFields): Promise<void> {
    const res = await this.api.put<{ entry: NoteEntry }>(`${this.notesBaseEndpoint()}/${id}`, fields);
    this.notes.update((n) => ({ ...n, [date]: (n[date] ?? []).map((e) => (e.id === id ? res.entry : e)) }));
    this.toast.show('Recordatorio actualizado.');
  }

  // Solo se llama con recordatorios reales (origin: true) -- el dialogo no
  // ofrece borrar una proyeccion virtual, ver day-dialog.component.ts.
  async deleteNote(id: string, date: string): Promise<void> {
    await this.api.delete(`${this.notesBaseEndpoint()}/${id}`);
    this.notes.update((n) => {
      const list = (n[date] ?? []).filter((e) => e.id !== id);
      const next = { ...n };
      if (list.length) next[date] = list;
      else delete next[date];
      return next;
    });
    this.toast.show('Recordatorio eliminado.');
  }

  async loadGroups(): Promise<void> {
    try {
      const data = await this.api.get<{ groups: GroupCalendar[] }>(`${API}/groups`);
      this.groupLists.set(data.groups);
    } catch {
      this.groupLists.set([]);
    }
    if (this.viewMode() === 'group' && !this.groupLists().some((g) => g.id === this.currentGroupId())) {
      await this.switchToPersonal();
    }
    this.connectWs();
  }

  private connectWs() {
    if (this.ws || !this.groupLists().length) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${API}/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      for (const g of this.groupLists()) ws.send(JSON.stringify({ type: 'subscribe', groupId: g.id }));
    });
    ws.addEventListener('message', (ev) => {
      let msg: { type: string; groupId: string; date: string; id?: string; entry?: NoteEntry };
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

  private handleWsMessage(msg: { type: string; groupId: string; date: string; id?: string; entry?: NoteEntry }) {
    if (this.viewMode() !== 'group' || msg.groupId !== this.currentGroupId()) return;
    if (msg.type === 'note_upserted' && msg.entry) {
      const entry = msg.entry;
      this.notes.update((n) => {
        const list = n[msg.date] ?? [];
        const idx = list.findIndex((e) => e.id === entry.id);
        const nextList = idx >= 0 ? list.map((e, i) => (i === idx ? entry : e)) : [...list, entry];
        return { ...n, [msg.date]: nextList };
      });
    } else if (msg.type === 'note_deleted' && msg.id) {
      const id = msg.id;
      this.notes.update((n) => {
        const list = (n[msg.date] ?? []).filter((e) => e.id !== id);
        const next = { ...n };
        if (list.length) next[msg.date] = list;
        else delete next[msg.date];
        return next;
      });
    }
  }

  getGoogleAuthUrl(): Promise<{ url: string }> {
    return this.api.get(API + '/auth/url');
  }
}

function startOfMonth(d: Date): Date {
  const copy = new Date(d);
  copy.setDate(1);
  return copy;
}
