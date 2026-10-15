import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal('');
  readonly visible = signal(false);
  readonly undo = signal<(() => void) | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(message: string, undoFn?: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.message.set(message);
    this.undo.set(undoFn ?? null);
    this.visible.set(true);
    this.timer = setTimeout(() => this.hide(), 5000);
  }

  runUndo() {
    this.undo()?.();
    this.hide();
  }

  private hide() {
    this.visible.set(false);
  }
}
