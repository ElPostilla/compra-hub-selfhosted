import { TaskStatus } from './models';

// Arrastrar para ordenar, con Pointer Events: funciona igual con el dedo
// (iPhone), el raton o un lapiz. El «drag & drop» nativo de HTML5 que usaba
// el kanban no funciona con el dedo en iOS.
//
// Se arrastra desde el asa (⠿) de cada fila/tarjeta: asi el resto de la
// fila sigue sirviendo para hacer scroll en el movil. La fila sigue al
// dedo; al soltar se calcula donde cae mirando que hay debajo del puntero
// (elementos con data-task-id / data-status), y quien llama guarda el
// nuevo orden (PUT .../tasks/board, que en los grupos es compartido).

export interface DropTarget {
  status: TaskStatus;
  // Id de la tarea delante de la que cae; null = al final de la columna.
  beforeId: string | null;
}

export interface DragOptions {
  id: string;
  status: TaskStatus;
  // Elemento que se mueve con el dedo (la fila o la tarjeta).
  item: HTMLElement;
  // En la lista solo se reordena dentro del mismo estado (para cambiarlo
  // esta la casilla); en el kanban se puede cambiar de columna.
  sameStatusOnly: boolean;
  onMove: (target: DropTarget | null) => void;
  onDrop: (target: DropTarget | null) => void;
}

export function startDrag(ev: PointerEvent, opts: DragOptions) {
  if (ev.button !== undefined && ev.button > 0) return; // solo boton principal
  ev.preventDefault();
  const handle = ev.currentTarget as HTMLElement;
  handle.setPointerCapture(ev.pointerId);
  const startX = ev.clientX;
  const startY = ev.clientY;
  const startScroll = window.scrollY;
  let lastX = startX;
  let lastY = startY;
  let target: DropTarget | null = null;
  let scrollTimer: number | undefined;

  opts.item.classList.add('dragging');

  const place = () => {
    const dy = lastY - startY + (window.scrollY - startScroll);
    opts.item.style.transform = `translate(${opts.sameStatusOnly ? 0 : lastX - startX}px, ${dy}px)`;
    // El elemento arrastrado no debe «tapar» lo que hay debajo del dedo.
    opts.item.style.pointerEvents = 'none';
    const under = document.elementFromPoint(lastX, lastY) as HTMLElement | null;
    target = resolveTarget(under, lastY, opts);
    opts.onMove(target);
  };

  // Scroll automatico cerca de los bordes de la pantalla.
  const autoScroll = () => {
    const edge = 70;
    const speed = lastY < edge ? -(edge - lastY) / 4 : lastY > innerHeight - edge ? (lastY - (innerHeight - edge)) / 4 : 0;
    if (speed) {
      window.scrollBy(0, speed);
      place();
    }
    scrollTimer = requestAnimationFrame(autoScroll);
  };
  scrollTimer = requestAnimationFrame(autoScroll);

  const move = (e: PointerEvent) => {
    lastX = e.clientX;
    lastY = e.clientY;
    place();
  };
  const finish = (drop: boolean) => {
    cancelAnimationFrame(scrollTimer!);
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', up);
    handle.removeEventListener('pointercancel', cancel);
    opts.item.classList.remove('dragging');
    opts.item.style.transform = '';
    opts.item.style.pointerEvents = '';
    opts.onMove(null);
    opts.onDrop(drop ? target : null);
  };
  const up = () => finish(true);
  const cancel = () => finish(false);
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', cancel);
}

function resolveTarget(under: HTMLElement | null, y: number, opts: DragOptions): DropTarget | null {
  if (!under) return null;
  const item = under.closest<HTMLElement>('[data-task-id]');
  if (item && item.dataset['taskId'] !== opts.id) {
    const status = item.dataset['status'] as TaskStatus;
    if (opts.sameStatusOnly && status !== opts.status) return null;
    const rect = item.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return { status, beforeId: item.dataset['taskId']! };
    // Mitad de abajo: delante de la siguiente de la misma columna (o al final).
    const same = Array.from(document.querySelectorAll<HTMLElement>(`[data-task-id][data-status="${status}"]`)).filter(
      (el) => el.dataset['taskId'] !== opts.id,
    );
    const next = same[same.indexOf(item) + 1];
    return { status, beforeId: next?.dataset['taskId'] ?? null };
  }
  const column = under.closest<HTMLElement>('[data-drop-status]');
  if (column) {
    const status = column.dataset['dropStatus'] as TaskStatus;
    if (opts.sameStatusOnly && status !== opts.status) return null;
    return { status, beforeId: null };
  }
  return null;
}

// Aplica un movimiento a las columnas (copia nueva, sin mutar).
export function applyMove<T extends { id: string; status: TaskStatus }>(
  cols: Record<TaskStatus, T[]>,
  id: string,
  from: TaskStatus,
  target: DropTarget,
): Record<TaskStatus, T[]> | null {
  const next = { todo: [...cols.todo], doing: [...cols.doing], done: [...cols.done] } as Record<TaskStatus, T[]>;
  const fromIdx = next[from].findIndex((t) => t.id === id);
  if (fromIdx === -1) return null;
  const [task] = next[from].splice(fromIdx, 1);
  const moved = { ...task, status: target.status };
  const at = target.beforeId ? next[target.status].findIndex((t) => t.id === target.beforeId) : -1;
  next[target.status].splice(at === -1 ? next[target.status].length : at, 0, moved);
  // Sin cambios reales (soltada en su mismo sitio): no se guarda nada.
  const same = (['todo', 'doing', 'done'] as TaskStatus[]).every(
    (s) => next[s].length === cols[s].length && next[s].every((t, i) => t.id === cols[s][i].id),
  );
  return same ? null : next;
}
