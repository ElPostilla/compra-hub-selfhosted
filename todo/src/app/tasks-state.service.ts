import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { GroupTodo, OwnerMode, BoardMode, NewTaskInput, STATUSES, Task, TaskStatus, Importance } from './models';

const API = '/api-todo';
const OWNER_KEY = 'todo-owner';
const BOARD_KEY = 'todo-board-mode';

// Estado central del to-do: "Mis tareas" (personales) y tableros de grupo
// (compartidos, en tiempo real). Mismos grupos que en /perfil, la lista de
// la compra y el calendario (misma llamada cruzada a lista-compra-api que
// ya usa calendario-api, ver groupsClient.js del backend).
@Injectable({ providedIn: 'root' })
export class TasksStateService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  readonly tasks = signal<Task[]>([]);
  readonly groups = signal<GroupTodo[]>([]);
  readonly ownerMode = signal<OwnerMode>('personal');
  readonly currentGroupId = signal<string | null>(null);
  readonly boardMode = signal<BoardMode>('list');

  readonly currentGroup = computed(
    () => this.groups().find((g) => g.id === this.currentGroupId()) ?? null,
  );
  readonly boardName = computed(() =>
    this.ownerMode() === 'group' ? (this.currentGroup()?.name ?? 'Grupo') : 'Mis tareas',
  );

  readonly columns = computed<Record<TaskStatus, Task[]>>(() => {
    const byStatus: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of this.tasks()) byStatus[t.status].push(t);
    for (const s of STATUSES) byStatus[s].sort((a, b) => a.position - b.position);
    return byStatus;
  });

  // Orden estable para la vista de lista -- ver comentario en db.js del
  // backend: por columna (todo, doing, done) y dentro de cada una por
  // position, sin necesitar un segundo campo de orden.
  readonly orderedTasks = computed<Task[]>(() => {
    const cols = this.columns();
    return [...cols.todo, ...cols.doing, ...cols.done];
  });

  private ws: WebSocket | null = null;

  constructor() {
    try {
      const savedBoard = localStorage.getItem(BOARD_KEY);
      if (savedBoard === 'kanban' || savedBoard === 'list') this.boardMode.set(savedBoard);
    } catch {
      /* localStorage no disponible */
    }
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

  setBoardMode(mode: BoardMode) {
    this.boardMode.set(mode);
    localStorage.setItem(BOARD_KEY, mode);
  }

  private saveOwnerState() {
    localStorage.setItem(
      OWNER_KEY,
      JSON.stringify({ mode: this.ownerMode(), groupId: this.currentGroupId() }),
    );
  }

  async init(): Promise<void> {
    await this.loadTasks();
    await this.loadGroups();
  }

  async switchToPersonal(): Promise<void> {
    this.ownerMode.set('personal');
    this.currentGroupId.set(null);
    this.saveOwnerState();
    await this.loadTasks();
  }

  async switchToGroup(groupId: string): Promise<void> {
    this.ownerMode.set('group');
    this.currentGroupId.set(groupId);
    this.saveOwnerState();
    await this.loadTasks();
  }

  private tasksBase(): string {
    return this.ownerMode() === 'group' ? `${API}/groups/${this.currentGroupId()}/tasks` : `${API}/tasks`;
  }

  async loadTasks(): Promise<void> {
    try {
      const data = await this.api.get<{ tasks: Task[] }>(this.tasksBase());
      this.tasks.set(data.tasks || []);
    } catch {
      this.tasks.set([]);
    }
  }

  async loadGroups(): Promise<void> {
    try {
      const data = await this.api.get<{ groups: GroupTodo[] }>(`${API}/groups`);
      this.groups.set(data.groups);
    } catch {
      this.groups.set([]);
    }
    if (this.ownerMode() === 'group' && !this.groups().some((g) => g.id === this.currentGroupId())) {
      await this.switchToPersonal();
    }
    this.connectWs();
  }

  async addTask(input: NewTaskInput): Promise<void> {
    const created = await this.api.post<Task>(this.tasksBase(), input);
    // El servidor emite el broadcast de WS antes de devolver la respuesta
    // HTTP: en un grupo, el eco puede llegar por el socket ya abierto y
    // aplicarse via handleWsMessage antes de que esta misma promesa se
    // resuelva. Sin este chequeo (ya presente del lado de handleWsMessage),
    // la tarea quedaba duplicada en el tablero.
    this.tasks.update((t) => (t.some((x) => x.id === created.id) ? t : [...t, created]));
  }

  async renameTask(id: string, title: string): Promise<void> {
    const updated = await this.api.patch<Task>(`${this.tasksBase()}/${id}`, { title });
    this.applyTaskUpdate(updated);
  }

  async setImportance(id: string, importance: Importance): Promise<void> {
    const updated = await this.api.patch<Task>(`${this.tasksBase()}/${id}`, { importance });
    this.applyTaskUpdate(updated);
  }

  async setStatus(id: string, status: TaskStatus): Promise<void> {
    const updated = await this.api.patch<Task>(`${this.tasksBase()}/${id}`, { status });
    this.applyTaskUpdate(updated);
  }

  async deleteTask(id: string): Promise<void> {
    await this.api.delete(`${this.tasksBase()}/${id}`);
    this.tasks.update((t) => t.filter((x) => x.id !== id));
    this.toast.show('Tarea eliminada.');
  }

  // Persiste el tablero completo tras un arrastre (reordenar dentro de una
  // columna o mover entre columnas) -- ver PUT .../tasks/board en el
  // backend. Actualiza el signal local antes de confirmar con el servidor
  // (UI optimista, igual que el resto de apps del hub).
  async saveBoard(columns: Record<TaskStatus, Task[]>): Promise<void> {
    const flat: Task[] = [];
    for (const status of STATUSES) {
      columns[status].forEach((t, i) => flat.push({ ...t, status, position: i }));
    }
    this.tasks.set(flat);
    await this.api.put(`${this.tasksBase()}/board`, {
      columns: {
        todo: columns.todo.map((t) => t.id),
        doing: columns.doing.map((t) => t.id),
        done: columns.done.map((t) => t.id),
      },
    });
  }

  private applyTaskUpdate(updated: Task) {
    this.tasks.update((t) => {
      const idx = t.findIndex((x) => x.id === updated.id);
      if (idx === -1) return [...t, updated];
      const next = [...t];
      next[idx] = updated;
      return next;
    });
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
    if (msg.type === 'task_added' && msg.task) {
      // addTask ya aplica localmente la respuesta del POST -- si el eco por
      // WS de esa misma accion llega despues, sin este chequeo la tarea
      // propia queda duplicada en el tablero (ver mismo patron de dedup en
      // expenses-state.service.ts).
      this.tasks.update((t) => (t.some((x) => x.id === msg.task!.id) ? t : [...t, msg.task!]));
    } else if (msg.type === 'task_updated' && msg.task) {
      this.applyTaskUpdate(msg.task);
    } else if (msg.type === 'task_deleted' && msg.id) {
      this.tasks.update((t) => t.filter((x) => x.id !== msg.id));
    } else if (msg.type === 'board_updated') {
      // el mensaje solo trae ids por columna, no los datos completos de
      // cada tarea -- mas simple releer el tablero entero que reconstruirlo.
      this.loadTasks();
    }
  }
}

interface WsMessage {
  type: string;
  groupId: string;
  task?: Task;
  id?: string;
}
