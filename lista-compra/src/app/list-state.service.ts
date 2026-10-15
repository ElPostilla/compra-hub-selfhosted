import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import { ToastService } from './toast.service';
import { detectCategory } from './categories';
import { CurrentList, GroupList, Item, PersonalList } from './models';

const STORAGE_KEY = 'lista-compra-v2';
const LEGACY_KEY = 'lista-compra-items';
// Copia intacta de lo que habia en localStorage antes de migrar las listas
// personales al servidor (una sola vez por navegador): red de seguridad
// por si la importacion hubiera perdido algo.
const BACKUP_KEY = 'lista-compra-v2-backup-pre-servidor';
const uid = () => crypto.randomUUID();

interface PersistedState {
  lists: PersonalList[];
  currentListId: string | null;
  history: string[];
  viewMode?: 'personal' | 'group';
  currentGroupId?: string | null;
  // true cuando este navegador ya subio sus listas locales al servidor.
  serverSynced?: boolean;
  // Seccion elegida en cada lista (id de lista o de grupo -> nombre), para
  // volver a ella al reabrir la app: en la tienda se trabaja con una sola.
  activeSections?: Record<string, string>;
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.lists) && parsed.lists.length) return parsed;
    }
  } catch {
    /* ignorado: se cae al siguiente intento */
  }

  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const items: Item[] = JSON.parse(legacy).map(
        (i: { id?: string; name: string; qty: string; done?: boolean }) => ({
          id: i.id || uid(),
          name: i.name,
          qty: i.qty,
          done: !!i.done,
          category: detectCategory(i.name),
          recurring: false,
        }),
      );
      return {
        lists: [{ id: uid(), name: 'Mi lista', items }],
        currentListId: null,
        history: [...new Set(items.map((i) => i.name))],
      };
    }
  } catch {
    /* ignorado: se cae al estado por defecto */
  }

  const id = uid();
  return { lists: [{ id, name: 'Mi lista', items: [] }], currentListId: id, history: [] };
}

// Listas personales: la fuente de verdad es el servidor (/api/personal, ver
// lista-compra-api/routes/personal.js) -- antes vivian solo en
// localStorage, sin sincronizar entre dispositivos ni poder usarlas el
// asistente. localStorage sigue guardando una copia como cache (para no
// pintar la pantalla vacia mientras llega la respuesta) y el historial de
// autocompletado, que es por dispositivo. Cada mutacion aplica la
// respuesta del servidor, y los cambios hechos en otro dispositivo (o por
// el asistente) llegan por WebSocket como "personal_changed" -> recarga.
//
// Las listas de grupo NO se guardan en localStorage: son la fuente de
// verdad del servidor, se piden por REST al entrar y se mantienen al dia
// por WebSocket (tambien para los cambios que hace uno mismo -- el
// servidor hace eco de nuestras propias acciones, asi que no se aplica
// nada "optimista" aparte: un unico camino de actualizacion evita aplicar
// el mismo cambio dos veces).
@Injectable({ providedIn: 'root' })
export class ListStateService {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);

  private state: PersistedState;

  readonly lists = signal<PersonalList[]>([]);
  readonly currentListId = signal<string | null>(null);
  readonly history = signal<string[]>([]);
  readonly viewMode = signal<'personal' | 'group'>('personal');
  readonly currentGroupId = signal<string | null>(null);
  readonly groupLists = signal<GroupList[]>([]);

  private readonly groupItemsCache: Record<string, Item[]> = {};
  // Secciones de cada lista de grupo; mismo contador de version que los
  // productos (groupItemsVersion) para que currentList se recalcule.
  private readonly groupSectionsCache: Record<string, string[]> = {};
  // Seccion por la que se filtra la lista actual ('' = todas). Se guarda
  // por lista en PersistedState.activeSections.
  private readonly activeSectionByList = signal<Record<string, string>>({});
  // groupItemsCache es un objeto plano, no una signal: mutarlo (push/filter
  // in place) no dispara por si solo un recomputo de currentList(). Antes se
  // forzaba ese recomputo con groupLists.set([...groupLists()]) -- pero
  // currentList depende de groupLists solo indirectamente via currentGroup(),
  // que hace un find() y devuelve el MISMO objeto de grupo de siempre; al no
  // cambiar ese valor, Angular corta la propagacion ahi (igualdad por
  // referencia) y currentList jamas se marca sucio. Efecto en pantalla:
  // productos que SI estaban ya en groupItemsCache (añadidos por uno mismo o
  // por eco de WS) no aparecian hasta cambiar de lista y volver -- eso si
  // fuerza un cambio real en currentGroupId/viewMode. Este contador si
  // cambia de valor siempre, y currentList lo lee explicitamente para
  // depender de el.
  private readonly groupItemsVersion = signal(0);
  private ws: WebSocket | null = null;
  private wsConnectedOnce = false;
  private personalReload: Promise<void> | null = null;

  readonly currentGroup = computed(() => this.groupLists().find((g) => g.id === this.currentGroupId()) ?? null);

  readonly currentList = computed<CurrentList>(() => {
    if (this.viewMode() === 'group' && this.currentGroupId()) {
      this.groupItemsVersion(); // dependencia explicita, ver comentario en el campo
      const g = this.currentGroup();
      return {
        id: this.currentGroupId()!,
        name: g ? g.name : 'Grupo',
        items: this.groupItemsCache[this.currentGroupId()!] || [],
        sections: this.groupSectionsCache[this.currentGroupId()!] || [],
        remote: true,
      };
    }
    const list = this.lists().find((l) => l.id === this.currentListId());
    return {
      id: list?.id ?? '',
      name: list?.name ?? '',
      items: list?.items ?? [],
      sections: list?.sections ?? [],
      remote: false,
    };
  });

  // Seccion activa de la lista actual; si ya no existe (la borro otro
  // miembro, por ejemplo), se vuelve a «Todo».
  readonly activeSection = computed(() => {
    const list = this.currentList();
    const s = this.activeSectionByList()[list.id] ?? '';
    return list.sections.includes(s) ? s : '';
  });

  constructor() {
    const state = loadState();
    if (!state.history) state.history = [];
    if (!state.currentListId || !state.lists.some((l) => l.id === state.currentListId)) {
      state.currentListId = state.lists[0].id;
    }
    this.state = state;
    this.lists.set(state.lists);
    this.currentListId.set(state.currentListId);
    this.history.set(state.history);
    this.activeSectionByList.set(state.activeSections ?? {});
    if (state.viewMode === 'group' && state.currentGroupId) {
      this.viewMode.set('group');
      this.currentGroupId.set(state.currentGroupId);
    }
  }

  private persist() {
    this.state.lists = this.lists();
    this.state.currentListId = this.currentListId();
    this.state.history = this.history();
    this.state.viewMode = this.viewMode();
    this.state.currentGroupId = this.currentGroupId();
    this.state.activeSections = this.activeSectionByList();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
  }

  // ---------- listas personales ----------

  // Reemplaza las listas con las del servidor, manteniendo la lista activa
  // si sigue existiendo.
  private applyServerLists(lists: PersonalList[]) {
    if (!lists.length) return;
    this.lists.set(lists);
    if (!lists.some((l) => l.id === this.currentListId())) this.currentListId.set(lists[0].id);
    this.persist();
  }

  // Primera vez en este navegador: sube las listas de localStorage (el
  // servidor decide que importar sin duplicar, ver POST /api/personal/import).
  // Despues, simplemente las pide.
  async loadPersonal() {
    try {
      if (!this.state.serverSynced) {
        if (localStorage.getItem(BACKUP_KEY) === null) {
          localStorage.setItem(BACKUP_KEY, localStorage.getItem(STORAGE_KEY) ?? JSON.stringify(this.state));
        }
        const res = await this.api.post<{ lists: PersonalList[] }>('/api/personal/import', {
          lists: this.lists().map((l) => ({ name: l.name, items: l.items })),
        });
        this.state.serverSynced = true;
        this.applyServerLists(res.lists);
        return;
      }
      await this.reloadPersonal();
    } catch {
      this.toast.show('No se han podido cargar tus listas. Se muestra la última copia guardada.');
    }
  }

  // Coalesce: varios avisos seguidos por WS -> una sola peticion en vuelo.
  private reloadPersonal(): Promise<void> {
    this.personalReload ??= this.api
      .get<{ lists: PersonalList[] }>('/api/personal/lists')
      .then(async (res) => {
        if (res.lists.length) this.applyServerLists(res.lists);
        else {
          // El servidor no tiene nada (p.ej. base de datos nueva): se vuelve
          // a importar lo que haya en cache.
          const imported = await this.api.post<{ lists: PersonalList[] }>('/api/personal/import', {
            lists: this.lists().map((l) => ({ name: l.name, items: l.items })),
          });
          this.applyServerLists(imported.lists);
        }
      })
      .finally(() => (this.personalReload = null));
    return this.personalReload;
  }

  private personalPath(listId: string, suffix = '') {
    return `/api/personal/lists/${listId}${suffix}`;
  }

  // Sustituye (o añade) un producto en una lista con objetos nuevos, para
  // que las signals detecten el cambio.
  private upsertItem(listId: string, item: Item) {
    this.lists.set(
      this.lists().map((l) => {
        if (l.id !== listId) return l;
        const exists = l.items.some((i) => i.id === item.id);
        return { ...l, items: exists ? l.items.map((i) => (i.id === item.id ? item : i)) : [...l.items, item] };
      }),
    );
    this.persist();
  }

  private setItems(listId: string, update: (items: Item[]) => Item[]) {
    this.lists.set(this.lists().map((l) => (l.id === listId ? { ...l, items: update(l.items) } : l)));
    this.persist();
  }

  private async readdItems(listId: string, items: Item[]) {
    for (const i of items) {
      const item = await this.api.post<Item>(this.personalPath(listId, '/items'), {
        name: i.name,
        qty: i.qty,
        category: i.category,
        recurring: i.recurring,
        section: i.section ?? '',
      });
      this.upsertItem(listId, item);
    }
  }

  addToHistory(name: string) {
    if (this.history().some((h) => h.toLowerCase() === name.toLowerCase())) return;
    this.history.set([name, ...this.history()].slice(0, 300));
    this.persist();
  }

  private async addItemPersonal(listId: string, name: string, qty: string, section: string) {
    const item = await this.api.post<Item>(this.personalPath(listId, '/items'), {
      name,
      qty,
      category: detectCategory(name),
      section,
    });
    this.upsertItem(listId, item);
  }

  private async patchItemPersonal(listId: string, itemId: string, body: Partial<Item>) {
    try {
      const item = await this.api.patch<Item>(this.personalPath(listId, `/items/${itemId}`), body);
      this.upsertItem(listId, item);
    } catch {
      this.toast.show('No se ha podido actualizar el producto.');
    }
  }

  private async removeItemPersonal(listId: string, item: Item) {
    try {
      await this.api.delete(this.personalPath(listId, `/items/${item.id}`));
    } catch {
      this.toast.show('No se ha podido eliminar el producto.');
      return;
    }
    this.setItems(listId, (items) => items.filter((i) => i.id !== item.id));
    this.toast.show(`«${item.name}» eliminado`, () => {
      this.readdItems(listId, [item]).catch(() => this.toast.show('No se ha podido deshacer.'));
    });
  }

  // Los productos "recurrentes" no se borran al vaciar los comprados: se
  // desmarcan y se quedan para la proxima compra (igual que en la lista de
  // grupo, ver DELETE .../items/done en lista-compra-api).
  private async clearDonePersonal(listId: string, items: Item[]) {
    const done = items.filter((i) => i.done);
    if (!done.length) return;
    try {
      await this.api.delete(this.personalPath(listId, '/items/done'));
    } catch {
      this.toast.show('No se ha podido vaciar los comprados.');
      return;
    }
    const removed = done.filter((i) => !i.recurring);
    this.setItems(listId, (current) =>
      current.filter((i) => !i.done || i.recurring).map((i) => (i.done ? { ...i, done: false } : i)),
    );
    if (removed.length) {
      this.toast.show(`${removed.length} producto(s) comprados eliminados`, () => {
        this.readdItems(listId, removed)
          .then(() => Promise.all(removed.map((r) => this.markDoneByName(listId, r.name))))
          .catch(() => this.toast.show('No se ha podido deshacer.'));
      });
    }
  }

  // Al deshacer "vaciar comprados" los productos vuelven marcados, como
  // estaban (readdItems los crea pendientes).
  private async markDoneByName(listId: string, name: string) {
    const item = this.lists()
      .find((l) => l.id === listId)
      ?.items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (item) await this.patchItemPersonal(listId, item.id, { done: true });
  }

  private async clearAllPersonal(listId: string, items: Item[]) {
    if (!items.length) return;
    try {
      await this.api.delete(this.personalPath(listId, '/items'));
    } catch {
      this.toast.show('No se ha podido vaciar la lista.');
      return;
    }
    this.setItems(listId, () => []);
    this.toast.show('Lista vaciada', () => {
      this.readdItems(listId, items).catch(() => this.toast.show('No se ha podido deshacer.'));
    });
  }

  async createList(name: string) {
    try {
      const list = await this.api.post<PersonalList>('/api/personal/lists', { name });
      this.lists.set([...this.lists(), list]);
      this.viewMode.set('personal');
      this.currentListId.set(list.id);
      this.persist();
    } catch {
      this.toast.show('No se ha podido crear la lista.');
    }
  }

  async renameList(listId: string, name: string) {
    try {
      await this.api.patch(this.personalPath(listId), { name });
      this.lists.set(this.lists().map((l) => (l.id === listId ? { ...l, name } : l)));
      this.persist();
    } catch {
      this.toast.show('No se ha podido renombrar la lista.');
    }
  }

  async deleteList(listId: string): Promise<boolean> {
    if (this.lists().length <= 1) return false;
    try {
      await this.api.delete(this.personalPath(listId));
    } catch {
      this.toast.show('No se ha podido borrar la lista.');
      return false;
    }
    const next = this.lists().filter((l) => l.id !== listId);
    this.lists.set(next);
    if (this.currentListId() === listId) this.currentListId.set(next[0].id);
    this.persist();
    return true;
  }

  switchToPersonal(listId: string) {
    this.viewMode.set('personal');
    this.currentListId.set(listId);
    this.persist();
  }

  // ---------- listas de grupo ----------

  private async groupApi<T>(path: string, options?: { method: string; body?: unknown }): Promise<T> {
    if (!options || options.method === 'GET') return this.api.get<T>(path);
    if (options.method === 'POST') return this.api.post<T>(path, options.body);
    if (options.method === 'PATCH') return this.api.patch<T>(path, options.body);
    return this.api.delete<T>(path);
  }

  switchToGroup(groupId: string) {
    this.viewMode.set('group');
    this.currentGroupId.set(groupId);
    this.persist();
    if (!this.groupItemsCache[groupId]) this.loadGroupList(groupId);
  }

  private async loadGroupList(groupId: string) {
    try {
      const data = await this.api.get<{ items: Item[]; sections?: string[] }>(`/api/groups/${groupId}/list`);
      this.groupItemsCache[groupId] = data.items;
      this.groupSectionsCache[groupId] = data.sections ?? [];
      this.groupItemsVersion.update((v) => v + 1);
    } catch {
      this.toast.show('No se ha podido cargar la lista del grupo.');
    }
  }

  async loadGroups() {
    // Las personales primero: lo de abajo (?add=, volver a personal si el
    // grupo ya no existe) necesita las listas reales del servidor.
    await this.loadPersonal();

    try {
      const data = await this.api.get<{ groups: GroupList[] }>('/api/groups');
      this.groupLists.set(data.groups);
    } catch {
      this.groupLists.set([]);
    }

    const params = new URLSearchParams(location.search);
    const requestedGroup = params.get('grupo');
    const requestedAdd = params.get('add');

    if (requestedGroup && this.groupLists().some((g) => g.id === requestedGroup)) {
      this.switchToGroup(requestedGroup);
    } else if (
      this.viewMode() === 'group' &&
      this.currentGroupId() &&
      this.groupLists().some((g) => g.id === this.currentGroupId())
    ) {
      this.loadGroupList(this.currentGroupId()!);
    } else if (this.viewMode() === 'group') {
      // el grupo guardado ya no existe o ya no somos miembros
      this.switchToPersonal(this.lists()[0].id);
    }

    if (requestedGroup || requestedAdd) {
      history.replaceState(null, '', location.pathname);
    }

    // Llegada desde "Añadir a la lista de la compra" en menu (?add=a,b,c):
    // se añaden a la lista actualmente activa (personal o de grupo, la que
    // ya estuviera elegida arriba), reusando addItem tal cual -- mismo
    // camino que si se hubieran escrito a mano.
    if (requestedAdd) {
      const names = requestedAdd
        .split(',')
        .map((n) => n.trim())
        .filter(Boolean);
      let added = 0;
      for (const name of names) {
        try {
          await this.addItem(name, '1');
          added++;
        } catch {
          /* addItem ya muestra su propio toast de error */
        }
      }
      if (added) this.toast.show(`${added} producto(s) añadido(s) desde el menú.`);
    }

    this.connectWs();
  }

  // Siempre se conecta (aunque no haya grupos): el canal personal avisa de
  // cambios en las listas propias hechos desde otro dispositivo o por el
  // asistente.
  private connectWs() {
    if (this.ws) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/ws`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'subscribe_personal' }));
      for (const g of this.groupLists()) ws.send(JSON.stringify({ type: 'subscribe', groupId: g.id }));
      // Una reconexion (el navegador cierra el socket en segundo plano y no
      // siempre dispara el timeout de reintento al momento, ver mas abajo)
      // puede haber dejado cambios de otros miembros sin recibir mientras
      // estuvo caido -- no basta con volver a suscribirse, hay que pedir
      // cada grupo ya cargado de nuevo para ponerse al dia.
      if (this.wsConnectedOnce) {
        for (const groupId of Object.keys(this.groupItemsCache)) this.loadGroupList(groupId);
        this.reloadPersonal().catch(() => {});
      }
      this.wsConnectedOnce = true;
    });
    ws.addEventListener('message', (ev) => {
      let msg: { type: string; groupId: string; item?: Item; id?: string; ids?: string[]; items?: Item[]; sections?: string[] };
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'personal_changed') {
        this.reloadPersonal().catch(() => {});
        return;
      }
      this.handleWsMessage(msg);
    });
    ws.addEventListener('close', () => {
      this.ws = null;
      setTimeout(() => this.connectWs(), 3000);
    });
  }

  private handleWsMessage(msg: {
    type: string;
    groupId: string;
    item?: Item;
    id?: string;
    ids?: string[];
    items?: Item[];
    sections?: string[];
  }) {
    if (msg.type === 'list_reload') {
      if (this.groupItemsCache[msg.groupId]) this.loadGroupList(msg.groupId);
      return;
    }
    if (msg.type === 'sections_updated' && msg.sections) {
      this.groupSectionsCache[msg.groupId] = msg.sections;
      this.groupItemsVersion.update((v) => v + 1);
      return;
    }
    if (msg.type === 'group_deleted') {
      this.groupLists.set(this.groupLists().filter((g) => g.id !== msg.groupId));
      delete this.groupItemsCache[msg.groupId];
      if (this.viewMode() === 'group' && this.currentGroupId() === msg.groupId) {
        this.toast.show('El grupo ha sido eliminado.');
        this.switchToPersonal(this.lists()[0].id);
      }
      return;
    }

    const cache = (this.groupItemsCache[msg.groupId] ??= []);
    if (msg.type === 'item_added' && msg.item) {
      if (!cache.some((i) => i.id === msg.item!.id)) cache.push(msg.item);
    } else if (msg.type === 'item_updated' && msg.item) {
      const idx = cache.findIndex((i) => i.id === msg.item!.id);
      if (idx >= 0) cache[idx] = msg.item;
      else cache.push(msg.item);
    } else if (msg.type === 'item_deleted' && msg.id) {
      this.groupItemsCache[msg.groupId] = cache.filter((i) => i.id !== msg.id);
    } else if (msg.type === 'items_deleted' && msg.ids) {
      this.groupItemsCache[msg.groupId] = cache.filter((i) => !msg.ids!.includes(i.id));
    } else if (msg.type === 'items_reset' && msg.items) {
      for (const updated of msg.items) {
        const idx = cache.findIndex((i) => i.id === updated.id);
        if (idx >= 0) cache[idx] = updated;
        else cache.push(updated);
      }
    }

    this.groupItemsVersion.update((v) => v + 1);
  }

  // ---------- mutaciones que funcionan igual en personal y grupo ----------

  // Las mutaciones de grupo aplican aqui mismo la respuesta del servidor
  // (que ya devuelve el item resultante) reutilizando handleWsMessage --
  // antes se esperaba exclusivamente al eco por WebSocket para reflejar la
  // propia accion en pantalla, lo que dejaba productos "añadidos" invisibles
  // en cuanto ese socket no estaba abierto/suscrito en ese instante preciso
  // (tipicamente justo al volver del segundo plano en movil, ver connectWs).
  // El dedup por id que ya tenia handleWsMessage evita aplicar dos veces
  // cuando el eco real llega despues.
  // Lo añadido va a la seccion que se esta viendo (si hay una elegida).
  async addItem(name: string, qty: string) {
    const list = this.currentList();
    const section = this.activeSection();
    try {
      if (list.remote) {
        const item = await this.groupApi<Item>(`/api/groups/${list.id}/list/items`, {
          method: 'POST',
          body: { name, qty, category: detectCategory(name), section },
        });
        this.handleWsMessage({ type: 'item_added', groupId: list.id, item });
      } else {
        await this.addItemPersonal(list.id, name, qty, section);
      }
    } catch {
      this.toast.show('No se ha podido añadir el producto.');
      throw new Error('add-failed');
    }
    this.addToHistory(name);
  }

  toggleItem(item: Item) {
    const list = this.currentList();
    if (list.remote) {
      this.groupApi<Item>(`/api/groups/${list.id}/list/items/${item.id}`, {
        method: 'PATCH',
        body: { done: !item.done },
      })
        .then((updated) => this.handleWsMessage({ type: 'item_updated', groupId: list.id, item: updated }))
        .catch(() => this.toast.show('No se ha podido actualizar el producto.'));
      return;
    }
    this.patchItemPersonal(list.id, item.id, { done: !item.done });
  }

  toggleRecurring(item: Item) {
    const list = this.currentList();
    if (list.remote) {
      this.groupApi<Item>(`/api/groups/${list.id}/list/items/${item.id}`, {
        method: 'PATCH',
        body: { recurring: !item.recurring },
      })
        .then((updated) => this.handleWsMessage({ type: 'item_updated', groupId: list.id, item: updated }))
        .catch(() => this.toast.show('No se ha podido actualizar el producto.'));
      return;
    }
    this.patchItemPersonal(list.id, item.id, { recurring: !item.recurring });
  }

  setItemSection(item: Item, section: string) {
    const list = this.currentList();
    if ((item.section ?? '') === section) return;
    if (list.remote) {
      this.groupApi<Item>(`/api/groups/${list.id}/list/items/${item.id}`, {
        method: 'PATCH',
        body: { section },
      })
        .then((updated) => this.handleWsMessage({ type: 'item_updated', groupId: list.id, item: updated }))
        .catch(() => this.toast.show('No se ha podido mover el producto.'));
      return;
    }
    this.patchItemPersonal(list.id, item.id, { section });
  }

  // ---------- secciones ----------

  setActiveSection(section: string) {
    this.activeSectionByList.set({ ...this.activeSectionByList(), [this.currentList().id]: section });
    this.persist();
  }

  // Guarda la lista completa de secciones (añadir, quitar, reordenar) y,
  // con rename, mueve los productos de la seccion renombrada. El servidor
  // deja sin seccion los productos de las que se quitan.
  async saveSections(sections: string[], rename?: { from: string; to: string }) {
    const list = this.currentList();
    try {
      if (list.remote) {
        await this.api.put(`/api/groups/${list.id}/list/sections`, { sections, rename });
        // Productos movidos/sin seccion: se recarga la lista entera (los
        // demas miembros reciben "list_reload" y hacen lo mismo).
        await this.loadGroupList(list.id);
      } else {
        const updated = await this.api.put<PersonalList>(this.personalPath(list.id, '/sections'), { sections, rename });
        this.lists.set(this.lists().map((l) => (l.id === list.id ? updated : l)));
      }
      if (rename && this.activeSection() === rename.from) this.setActiveSection(rename.to);
      this.persist();
      return true;
    } catch {
      this.toast.show('No se han podido guardar las secciones.');
      return false;
    }
  }

  removeItem(item: Item) {
    const list = this.currentList();
    if (list.remote) {
      this.groupApi(`/api/groups/${list.id}/list/items/${item.id}`, { method: 'DELETE' })
        .then(() => {
          this.handleWsMessage({ type: 'item_deleted', groupId: list.id, id: item.id });
          this.toast.show(`«${item.name}» eliminado`);
        })
        .catch(() => this.toast.show('No se ha podido eliminar el producto.'));
      return;
    }
    this.removeItemPersonal(list.id, item);
  }

  async clearDone() {
    const list = this.currentList();
    if (list.remote) {
      const doneItems = list.items.filter((i) => i.done);
      if (!doneItems.length) return;
      try {
        const res = await this.groupApi<{ deleted: number; reset: number }>(
          `/api/groups/${list.id}/list/items/done`,
          { method: 'DELETE' },
        );
        // Este endpoint solo devuelve contadores, no los ids/items afectados
        // (ver DELETE .../list/items/done en lista-compra-api) -- pero quien
        // hizo la accion ya sabe localmente que productos estaban marcados,
        // asi que se recalcula aqui igual que haria el servidor en vez de
        // esperar al eco por WS.
        const deletedIds = doneItems.filter((i) => !i.recurring).map((i) => i.id);
        const resetItems = doneItems.filter((i) => i.recurring).map((i) => ({ ...i, done: false }));
        if (deletedIds.length) this.handleWsMessage({ type: 'items_deleted', groupId: list.id, ids: deletedIds });
        if (resetItems.length) this.handleWsMessage({ type: 'items_reset', groupId: list.id, items: resetItems });
        this.toast.show(`${res.deleted} producto(s) comprados eliminados`);
      } catch {
        this.toast.show('No se ha podido vaciar los comprados.');
      }
      return;
    }
    await this.clearDonePersonal(list.id, list.items);
  }

  clearAll() {
    const list = this.currentList();
    if (list.remote) return; // las listas de grupo solo se vacian producto a producto o "comprados"
    this.clearAllPersonal(list.id, list.items);
  }
}
