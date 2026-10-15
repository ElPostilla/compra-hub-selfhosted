import { Component, inject, output } from '@angular/core';
import { ProfileService } from './profile.service';
import { StatusService } from './status.service';
import { AvatarComponent } from './avatar.component';
import { Profile } from './models';

@Component({
  selector: 'app-profile-card',
  standalone: true,
  imports: [AvatarComponent],
  template: `
    <section class="card">
      <h2>Tu cuenta</h2>
      @if (profile(); as me) {
        <div class="profile-avatar-row">
          <app-avatar size="lg" [username]="me.username" [firstName]="me.firstName" [lastName]="me.lastName"></app-avatar>
        </div>
        <div class="profile-row">
          <span class="profile-label">Nombre</span>
          <span class="profile-value">{{ me.firstName }} {{ me.lastName }}</span>
        </div>
        <div class="profile-row">
          <span class="profile-label">Usuario</span>
          <span class="profile-value">&#64;{{ me.username }}</span>
        </div>
        <div class="profile-row">
          <span class="profile-label">Email</span>
          <span class="profile-value">{{ me.email || '—' }}</span>
        </div>
        <a class="btn btn-block" [href]="me.accountConsoleUrl" target="_blank" rel="noopener">
          Editar nombre, email o contraseña en Keycloak ↗
        </a>
      } @else {
        Cargando…
      }
    </section>
  `,
  styles: [`.profile-avatar-row { margin-bottom: 0.9rem; }`],
})
export class ProfileCardComponent {
  private readonly profileService = inject(ProfileService);
  private readonly status = inject(StatusService);

  readonly profile = this.profileService.profile;
  readonly loaded = output<Profile>();

  async ngOnInit() {
    try {
      const me = await this.profileService.load();
      this.loaded.emit(me);
    } catch (err) {
      this.status.showError(err);
    }
  }
}
