import { Component, computed, input } from '@angular/core';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';

// Tintas del "cuaderno de casa" (los separadores de hub-theme.css, mas
// oscuros para que las iniciales en blanco tengan contraste AA). El color y
// las iniciales son deterministas por username -- la misma persona siempre
// sale igual, sin backend ni BD.
const PALETTE = [
  '#2B45C4', '#A8324F', '#2E7A55', '#A5541D', '#5E4DB2',
  '#1F6F9C', '#7A5E0E', '#8A3B8F', '#3D5A4A', '#1E2A5E',
];

function colorFor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

function initialsFor(username: string, firstName?: string | null, lastName?: string | null): string {
  if (firstName && lastName) return (firstName[0] + lastName[0]).toUpperCase();
  if (firstName) return firstName.slice(0, 2).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

@Component({
  selector: 'app-avatar',
  standalone: true,
  template: `<span class="avatar" [class]="size()" [style.background]="color()">{{ initials() }}</span>`,
  styles: [`
    .avatar {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      border-radius: 999px;
      color: #fff;
      font-weight: 700;
      font-variation-settings: 'CASL' 1;
      line-height: 1;
      letter-spacing: 0.02em;
      user-select: none;
    }
    .avatar.xs { width: 1.15rem; height: 1.15rem; font-size: 0.46rem; }
    .avatar.sm { width: 1.6rem; height: 1.6rem; font-size: 0.62rem; }
    .avatar.md { width: 2.2rem; height: 2.2rem; font-size: 0.8rem; }
    .avatar.lg { width: 3.2rem; height: 3.2rem; font-size: 1.15rem; }
  `],
})
export class AvatarComponent {
  readonly username = input.required<string>();
  readonly firstName = input<string | null>(null);
  readonly lastName = input<string | null>(null);
  readonly size = input<AvatarSize>('md');

  readonly initials = computed(() => initialsFor(this.username(), this.firstName(), this.lastName()));
  readonly color = computed(() => colorFor(this.username()));
}
