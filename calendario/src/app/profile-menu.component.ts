import { Component, ElementRef, HostListener, inject } from '@angular/core';
import { IconComponent } from './icon.component';
import { AvatarComponent } from './avatar.component';
import { ProfileService } from './profile.service';

// Desplegable de cuenta (avatar -> Perfil / Cerrar sesión), igual en
// las 8 apps del hub. Cada app lo copia tal cual (son proyectos Angular
// independientes, sin build compartido entre ellos).
@Component({
  selector: 'app-profile-menu',
  standalone: true,
  imports: [IconComponent, AvatarComponent],
  template: `
    <details class="profile-menu">
      <summary aria-label="Cuenta">
        @if (profile.profile(); as me) {
          <app-avatar size="sm" [username]="me.username" [firstName]="me.firstName" [lastName]="me.lastName"></app-avatar>
        } @else {
          <app-icon name="person"></app-icon>
        }
      </summary>
      <div class="profile-menu-panel">
        <a href="/perfil/">Perfil</a>
        <a [href]="logoutUrl()">Cerrar sesión ⏻</a>
      </div>
    </details>
  `,
  styles: [
    `
      .profile-menu {
        position: relative;
      }
      .profile-menu summary {
        list-style: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        font-size: 1.2rem;
        border-radius: 999px;
        background: transparent;
        border: 2px solid transparent;
      }
      .profile-menu summary::-webkit-details-marker {
        display: none;
      }
      .profile-menu summary::marker {
        content: '';
      }
      .profile-menu[open] summary {
        border-color: var(--accent);
      }
      .profile-menu-panel {
        position: absolute;
        right: 0;
        top: calc(100% + 0.4rem);
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 12px;
        box-shadow: var(--pop-shadow, var(--shadow));
        min-width: 180px;
        padding: 0.4rem;
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        z-index: 30;
      }
      .profile-menu-panel a {
        display: flex;
        align-items: center;
        min-height: 44px;
        padding: 0 0.7rem;
        border-radius: 8px;
        color: var(--ink);
        text-decoration: none;
        font-size: 0.95rem;
      }
      .profile-menu-panel a:hover,
      .profile-menu-panel a:focus-visible {
        background: var(--surface-2);
        color: var(--ink);
      }
    `,
  ],
})
export class ProfileMenuComponent {
  readonly profile = inject(ProfileService);

  constructor(private readonly host: ElementRef<HTMLElement>) {
    this.profile.load().catch(() => {});
  }

  // Cierra la sesion del hub (cookie de oauth2-proxy) y despues la de
  // Keycloak; si no, Keycloak volveria a iniciar sesion sin preguntar. La
  // URL del realm sale de accountConsoleUrl (<issuer>/account/), que la API
  // construye con OIDC_ISSUER: asi ninguna app lleva el dominio escrito.
  logoutUrl(): string {
    const account = this.profile.profile()?.accountConsoleUrl || '';
    if (!/^https?:\/\/.+\/account\/?$/.test(account)) return '/oauth2/sign_out?rd=%2F';
    const issuer = account.replace(/\/account\/?$/, '');
    const kc = `${issuer}/protocol/openid-connect/logout?id_token_hint={id_token}` +
      `&post_logout_redirect_uri=${encodeURIComponent(location.origin + '/')}`;
    return `/oauth2/sign_out?rd=${encodeURIComponent(kc)}`;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const details = this.host.nativeElement.querySelector('details[open]');
    if (details && !this.host.nativeElement.contains(event.target as Node)) {
      details.removeAttribute('open');
    }
  }
}
