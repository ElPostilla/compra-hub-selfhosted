import { Component, HostListener, signal } from '@angular/core';
import { IconComponent, IconName } from './icon.component';

interface NavApp {
  href: string;
  icon: IconName;
  name: string;
  // Color de separador del cuaderno (--tab-<tab> en hub-theme.css).
  tab: string;
}

// Menu de apps (boton ☰). Mismo fichero, identico, en todas las apps del
// hub: la app actual se detecta por la URL en vez de estar fijada en cada
// copia (antes habia 7 variantes que solo cambiaban en eso).
@Component({
  selector: 'app-nav-drawer',
  standalone: true,
  imports: [IconComponent],
  template: `
    @if (isOpen()) {
      <div class="nav-drawer-backdrop" (click)="close()">
        <aside class="nav-drawer" aria-label="Apps" (click)="$event.stopPropagation()">
          <h2 class="nav-drawer-title">Apps</h2>
          <ul class="nav-drawer-list">
            @for (a of apps; track a.href) {
              <li>
                @if (a.href === current) {
                  <span class="nav-drawer-item current" aria-current="page" [style.--item-tab]="'var(--tab-' + a.tab + ')'">
                    <app-icon [name]="a.icon"></app-icon>{{ a.name }}
                  </span>
                } @else {
                  <a class="nav-drawer-item" [href]="a.href" [style.--item-tab]="'var(--tab-' + a.tab + ')'" (click)="close()">
                    <app-icon [name]="a.icon"></app-icon>{{ a.name }}
                  </a>
                }
              </li>
            }
          </ul>
        </aside>
      </div>
    }
  `,
})
export class NavDrawerComponent {
  readonly apps: NavApp[] = [
    { href: '/', icon: 'home', name: 'Inicio', tab: 'inicio' },
    { href: '/lista/', icon: 'cart', name: 'Lista de la compra', tab: 'compra' },
    { href: '/todo/', icon: 'checklist', name: 'Tareas', tab: 'tareas' },
    { href: '/calendario/', icon: 'calendar', name: 'Calendario', tab: 'calendario' },
    { href: '/gastos/', icon: 'coin', name: 'Gastos', tab: 'gastos' },
    { href: '/menu/', icon: 'utensils', name: 'Menú', tab: 'menu' },
    { href: '/grupos/', icon: 'people', name: 'Social', tab: 'social' },
    { href: '/perfil/', icon: 'person', name: 'Perfil', tab: 'perfil' },
  ];

  // Primer segmento de la ruta: "/lista/..." -> "/lista/"; raiz -> "/".
  readonly current = (() => {
    const first = location.pathname.split('/').filter(Boolean)[0];
    return first ? `/${first}/` : '/';
  })();

  private readonly openState = signal(false);
  readonly isOpen = this.openState.asReadonly();

  open() {
    this.openState.set(true);
    document.body.style.overflow = 'hidden';
  }
  close() {
    this.openState.set(false);
    document.body.style.overflow = '';
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.openState()) this.close();
  }
}
