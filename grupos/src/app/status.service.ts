import { Injectable, signal } from '@angular/core';

export type StatusKind = 'ok' | 'error';

@Injectable({ providedIn: 'root' })
export class StatusService {
  readonly message = signal('');
  readonly kind = signal<StatusKind>('ok');
  readonly visible = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;

  show(message: string, kind: StatusKind = 'ok') {
    if (this.timer) clearTimeout(this.timer);
    this.message.set(message);
    this.kind.set(kind);
    this.visible.set(true);
    this.timer = setTimeout(() => this.visible.set(false), 4000);
  }

  showError(err: unknown) {
    this.show(err instanceof Error ? err.message : String(err), 'error');
  }
}
