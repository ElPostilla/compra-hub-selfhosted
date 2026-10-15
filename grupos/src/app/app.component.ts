import { Component, inject, signal } from '@angular/core';
import { AsistenteComponent } from './asistente.component';
import { ProfileMenuComponent } from './profile-menu.component';
import { NavDrawerComponent } from './nav-drawer.component';
import { IconComponent } from './icon.component';
import { GroupsCardComponent } from './groups-card.component';
import { FriendsCardComponent } from './friends-card.component';
import { InviteCardComponent } from './invite-card.component';
import { StatusService } from './status.service';
import { ProfileService } from './profile.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ProfileMenuComponent, NavDrawerComponent, IconComponent, InviteCardComponent, FriendsCardComponent, GroupsCardComponent, AsistenteComponent],
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
    // Nada que recargar: amigos y grupos no los cambia el asistente.
  }

  readonly status = inject(StatusService);
  private readonly profile = inject(ProfileService);

  readonly meId = signal<string | null>(null);

  async ngOnInit() {
    try {
      const me = await this.profile.load();
      this.meId.set(me.id);
    } catch (err) {
      this.status.showError(err);
    }
  }
}
