import { Component, inject, signal } from '@angular/core';
import { AsistenteComponent } from './asistente.component';
import { ProfileMenuComponent } from './profile-menu.component';
import { NavDrawerComponent } from './nav-drawer.component';
import { IconComponent } from './icon.component';
import { ProfileCardComponent } from './profile-card.component';
import { PrivacyCardComponent } from './privacy-card.component';
import { ProfileService } from './profile.service';
import { StatusService } from './status.service';
import { Profile } from './models';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ProfileMenuComponent, NavDrawerComponent, IconComponent, ProfileCardComponent, PrivacyCardComponent, AsistenteComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  // Asistente (chat comun a todas las apps, ver asistente.component.ts):
  // que se esta viendo, para que «añade…» vaya ahi, y que recargar cuando
  // el asistente cambia datos.
  assistantView(): string | null {
    return null;
  }
  onAssistantChanged() {
    // Nada que recargar: el perfil no depende de lo que cambia el asistente.
  }

  readonly status = inject(StatusService);
  readonly profile = inject(ProfileService).profile;

  readonly meId = signal<string | null>(null);

  onProfileLoaded(me: Profile) {
    this.meId.set(me.id);
  }
}
