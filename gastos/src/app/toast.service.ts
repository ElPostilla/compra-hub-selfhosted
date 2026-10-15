import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal('');
  readonly visible = signal(false);
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  show(message: string) {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.message.set(message);
    this.visible.set(true);
    this.hideTimer = setTimeout(() => {
      this.visible.set(false);
      this.clearTimer = setTimeout(() => this.message.set(''), 200);
    }, 3000);
  }
}
