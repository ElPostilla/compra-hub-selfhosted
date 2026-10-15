import { Component, inject, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FriendsService } from './friends.service';
import { StatusService } from './status.service';
import { AvatarComponent } from './avatar.component';

@Component({
  selector: 'app-friends-card',
  standalone: true,
  imports: [FormsModule, AvatarComponent],
  template: `
    <section class="card">
      <h2>Amigos</h2>
      <form class="inline-form" (ngSubmit)="addFriend()">
        <input
          type="text"
          name="friendUsername"
          [(ngModel)]="usernameInput"
          placeholder="Nombre de usuario"
          autocomplete="off"
          required
        />
        <button type="submit" class="btn btn-primary">Agregar</button>
      </form>

      @if (friends.incoming().length) {
        <div class="section-label">Solicitudes recibidas</div>
        @for (r of friends.incoming(); track r.requestId) {
          <div class="person-row">
            <div class="person-identity">
              <app-avatar size="sm" [username]="r.username" [firstName]="r.firstName" [lastName]="r.lastName"></app-avatar>
              <div>
                <div class="person-name">&#64;{{ r.username }}</div>
                <div class="person-sub">{{ r.firstName }} {{ r.lastName }}</div>
              </div>
            </div>
            <div class="person-actions">
              <button class="btn btn-sm btn-primary" (click)="accept(r.requestId)">Aceptar</button>
              <button class="btn btn-sm btn-danger" (click)="decline(r.requestId)">Rechazar</button>
            </div>
          </div>
        }
      }

      @if (friends.outgoing().length) {
        <div class="section-label">Solicitudes enviadas</div>
        @for (r of friends.outgoing(); track r.requestId) {
          <div class="person-row">
            <div class="person-identity">
              <app-avatar size="sm" [username]="r.username" [firstName]="r.firstName" [lastName]="r.lastName"></app-avatar>
              <div>
                <div class="person-name">&#64;{{ r.username }}</div>
                <div class="person-sub">pendiente</div>
              </div>
            </div>
            <div class="person-actions">
              <button class="btn btn-sm" (click)="cancel(r.requestId)">Cancelar</button>
            </div>
          </div>
        }
      }

      <div class="section-label">Tus amigos</div>
      @if (friends.friends().length) {
        @for (f of friends.friends(); track f.friendshipId) {
          <div class="person-row">
            <div class="person-identity">
              <app-avatar size="sm" [username]="f.username" [firstName]="f.firstName" [lastName]="f.lastName"></app-avatar>
              <div>
                <div class="person-name">&#64;{{ f.username }}</div>
                <div class="person-sub">{{ f.firstName }} {{ f.lastName }}</div>
              </div>
            </div>
            <div class="person-actions">
              <button class="btn btn-sm btn-danger" (click)="unfriend(f.friendshipId)">Eliminar</button>
            </div>
          </div>
        }
      } @else {
        <div class="empty-hint">Todavía no tienes amigos agregados.</div>
      }
    </section>
  `,
})
export class FriendsCardComponent {
  readonly friends = inject(FriendsService);
  private readonly status = inject(StatusService);

  readonly changed = output<void>();

  usernameInput = '';

  async ngOnInit() {
    try {
      await this.friends.load();
    } catch (err) {
      this.status.showError(err);
    }
  }

  async addFriend() {
    const username = this.usernameInput.trim();
    if (!username) return;
    try {
      await this.friends.sendRequest(username);
      this.usernameInput = '';
      this.status.show(`Solicitud enviada a @${username}.`);
      await this.friends.load();
    } catch (err) {
      this.status.showError(err);
    }
  }

  async accept(requestId: string) {
    try {
      await this.friends.accept(requestId);
      this.status.show('Solicitud aceptada.');
      await this.friends.load();
      this.changed.emit();
    } catch (err) {
      this.status.showError(err);
    }
  }

  async decline(requestId: string) {
    try {
      await this.friends.remove(requestId);
      this.status.show('Solicitud rechazada.');
      await this.friends.load();
      this.changed.emit();
    } catch (err) {
      this.status.showError(err);
    }
  }

  async cancel(requestId: string) {
    try {
      await this.friends.remove(requestId);
      this.status.show('Solicitud cancelada.');
      await this.friends.load();
    } catch (err) {
      this.status.showError(err);
    }
  }

  async unfriend(friendshipId: string) {
    if (!confirm('¿Eliminar esta amistad?')) return;
    try {
      await this.friends.remove(friendshipId);
      this.status.show('Amistad eliminada.');
      await this.friends.load();
      this.changed.emit();
    } catch (err) {
      this.status.showError(err);
    }
  }
}
