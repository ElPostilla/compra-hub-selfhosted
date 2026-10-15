import { Component, inject, output, signal } from '@angular/core';
import { GroupsService } from './groups.service';
import { StatusService } from './status.service';
import { AvatarComponent } from './avatar.component';
import { InvitePreview } from './models';

// Lo que ve quien abre un enlace de invitacion (/grupos/?invitacion=<token>,
// generado en groups-card). Si no ha iniciado sesion, oauth2-proxy le lleva
// antes a Keycloak (entrar o crear cuenta) y le devuelve aqui con el token.
@Component({
  selector: 'app-invite-card',
  standalone: true,
  imports: [AvatarComponent],
  template: `
    @if (preview(); as p) {
      <section class="card invite-card">
        <div class="invite-who">
          <app-avatar [username]="p.inviterUsername" [firstName]="p.inviterFirstName"></app-avatar>
          <div>
            <h2>Te han invitado a «{{ p.groupName }}»</h2>
            <p class="person-sub">
              &#64;{{ p.inviterUsername }} comparte con este grupo la lista de la compra, tareas,
              calendario, gastos y menú · {{ p.memberCount }} miembro{{ p.memberCount === 1 ? '' : 's' }}
            </p>
          </div>
        </div>
        @if (p.alreadyMember) {
          <p>Ya formas parte de este grupo.</p>
          <a class="btn btn-primary btn-block" [href]="'/lista/?grupo=' + p.groupId">Abrir la lista del grupo</a>
        } @else {
          <div class="invite-actions">
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="accept()">Unirme al grupo</button>
            <button type="button" class="btn" (click)="dismiss()">Ahora no</button>
          </div>
        }
      </section>
    }
  `,
})
export class InviteCardComponent {
  private readonly groups = inject(GroupsService);
  private readonly status = inject(StatusService);

  readonly joined = output<string>();

  readonly preview = signal<InvitePreview | null>(null);
  readonly busy = signal(false);
  private token: string | null = null;

  async ngOnInit() {
    this.token = new URLSearchParams(location.search).get('invitacion');
    if (!this.token) return;
    try {
      this.preview.set(await this.groups.previewInvite(this.token));
    } catch (err) {
      this.status.showError(err);
      this.clearUrl();
    }
  }

  async accept() {
    if (!this.token) return;
    this.busy.set(true);
    try {
      const r = await this.groups.acceptInvite(this.token);
      const name = this.preview()?.groupName ?? 'el grupo';
      this.status.show(r.alreadyMember ? `Ya estabas en «${name}».` : `¡Bienvenido a «${name}»!`);
      this.dismiss();
      this.joined.emit(r.groupId);
    } catch (err) {
      this.status.showError(err);
    } finally {
      this.busy.set(false);
    }
  }

  dismiss() {
    this.preview.set(null);
    this.clearUrl();
  }

  // Quita ?invitacion= de la barra: recargar la pagina no debe volver a
  // ofrecer la invitacion, y asi el enlace no se queda en el historial.
  private clearUrl() {
    const url = new URL(location.href);
    url.searchParams.delete('invitacion');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
}
