import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GroupsService } from './groups.service';
import { FriendsService } from './friends.service';
import { StatusService } from './status.service';
import { AvatarComponent } from './avatar.component';
import { IconComponent } from './icon.component';
import { ActivityEntry, Group, GroupInvite, GroupMember } from './models';

@Component({
  selector: 'app-groups-card',
  standalone: true,
  imports: [FormsModule, AvatarComponent, IconComponent],
  template: `
    <section class="card">
      <h2>Grupos</h2>
      <form class="inline-form" (ngSubmit)="createGroup()">
        <input
          type="text"
          name="groupName"
          [(ngModel)]="nameInput"
          placeholder="Nombre del grupo (p. ej. Familia)"
          autocomplete="off"
          required
        />
        <button type="submit" class="btn btn-primary">Crear</button>
      </form>

      @if (!groups.groups().length) {
        <div class="empty-hint">Todavía no perteneces a ningún grupo.</div>
      }
      @for (g of groups.groups(); track g.id) {
        <div class="group-item">
          <div class="group-head">
            <div>
              <div class="group-name">{{ g.name }}{{ g.isOwner ? ' · tuyo' : '' }}</div>
              <div class="group-meta">{{ g.memberCount }} miembro{{ g.memberCount === 1 ? '' : 's' }}</div>
            </div>
            <button class="btn btn-sm" [attr.aria-expanded]="isOpen(g.id)" (click)="toggle(g.id)">{{ isOpen(g.id) ? 'Cerrar' : 'Gestionar' }}</button>
          </div>
          @if (isOpen(g.id)) {
            <div class="group-body open">
              <a class="btn btn-block btn-primary" [href]="'/lista/?grupo=' + g.id">Abrir la lista del grupo</a>
              <div class="group-members">
                @for (m of membersOf(g.id); track m.id) {
                  <div class="person-row">
                    <div class="person-identity">
                      <app-avatar size="sm" [username]="m.username" [firstName]="m.firstName" [lastName]="m.lastName"></app-avatar>
                      <div class="person-name">&#64;{{ m.username }}{{ m.role === 'owner' ? ' · admin' : '' }}</div>
                    </div>
                    @if (m.id !== meId() && m.role !== 'owner') {
                      <button class="btn btn-sm btn-danger" (click)="removeMember(g.id, m.id)">Quitar</button>
                    }
                  </div>
                } @empty {
                  <div class="empty-hint">Cargando…</div>
                }
              </div>
              @if (g.isOwner) {
                <form class="inline-form" (ngSubmit)="addMember(g.id)">
                  <select [(ngModel)]="selectedFriendByGroup[g.id]" name="friend-{{ g.id }}">
                    @for (f of availableFriends(g.id); track f.id) {
                      <option [value]="f.username">&#64;{{ f.username }}</option>
                    } @empty {
                      <option value="">No hay amigos disponibles</option>
                    }
                  </select>
                  <button type="submit" class="btn btn-sm btn-primary">Añadir</button>
                </form>

                <div class="invite-box">
                  <div class="section-label">Invitar con un enlace</div>
                  @if (inviteOf(g.id); as inv) {
                    <input
                      class="invite-link"
                      type="text"
                      readonly
                      aria-label="Enlace de invitación"
                      [value]="inviteUrl(inv)"
                      (focus)="selectAll($event)"
                    />
                    <div class="invite-actions">
                      @if (canShare) {
                        <button type="button" class="btn btn-sm btn-primary" (click)="shareInvite(g, inv)">
                          <app-icon name="share"></app-icon> Compartir
                        </button>
                      }
                      <a class="btn btn-sm" [class.btn-primary]="!canShare" [href]="whatsappUrl(g, inv)" target="_blank" rel="noopener">WhatsApp</a>
                      <button type="button" class="btn btn-sm" (click)="copyInvite(inv)">Copiar</button>
                    </div>
                    <div class="invite-meta">
                      Vale hasta el {{ formatDay(inv.expiresAt) }} para cualquiera que lo tenga.
                      <button type="button" class="link-btn" (click)="newInvite(g.id)">Cambiar enlace</button>
                      ·
                      <button type="button" class="link-btn" (click)="revokeInvite(g.id)">Desactivar</button>
                    </div>
                  } @else {
                    <p class="invite-help">
                      Mándalo por WhatsApp a tu familia o a tus compañeros de piso: al abrirlo
                      entran en el grupo, aunque todavía no tengan cuenta.
                    </p>
                    <button type="button" class="btn btn-sm btn-primary" (click)="newInvite(g.id)">Crear enlace de invitación</button>
                  }
                </div>
                <button type="button" class="btn btn-sm btn-danger btn-block" (click)="deleteGroup(g.id, g.name)">
                  Eliminar grupo
                </button>
              } @else {
                <button class="btn btn-sm btn-danger" (click)="leave(g.id)">Salir del grupo</button>
              }

              <div class="activity-label">Actividad reciente</div>
              <div class="activity-feed">
                @for (a of activityOf(g.id); track $index) {
                  <div class="activity-row">
                    @if (a.actorUsername) {
                      <app-avatar size="sm" [username]="a.actorUsername"></app-avatar>
                    }
                    <span class="activity-actor">&#64;{{ a.actorUsername ?? '?' }}</span>
                    <span class="activity-message">{{ a.message }}</span>
                    <span class="activity-time">{{ formatWhen(a.createdAt) }}</span>
                  </div>
                } @empty {
                  <div class="empty-hint">Sin actividad todavía.</div>
                }
              </div>
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class GroupsCardComponent {
  readonly groups = inject(GroupsService);
  private readonly friends = inject(FriendsService);
  private readonly status = inject(StatusService);

  readonly meId = input.required<string | null>();

  nameInput = '';
  private readonly openGroups = signal<Set<string>>(new Set());
  private readonly membersByGroup = signal<Map<string, GroupMember[]>>(new Map());
  private readonly activityByGroup = signal<Map<string, ActivityEntry[]>>(new Map());
  selectedFriendByGroup: Record<string, string> = {};
  private readonly inviteByGroup = signal<Map<string, GroupInvite | null>>(new Map());
  readonly canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  async ngOnInit() {
    try {
      // En perfil, FriendsCardComponent ya cargaba this.friends antes de que
      // se abriera esta tarjeta; aquí no existe esa tarjeta, así que hay que
      // cargarlos nosotros mismos o el desplegable de "añadir miembro" sale
      // siempre vacío.
      await Promise.all([this.groups.load(), this.friends.load()]);
    } catch (err) {
      this.status.showError(err);
    }
  }

  isOpen(groupId: string) {
    return this.openGroups().has(groupId);
  }

  membersOf(groupId: string) {
    return this.membersByGroup().get(groupId) ?? [];
  }

  inviteOf(groupId: string) {
    return this.inviteByGroup().get(groupId) ?? null;
  }

  inviteUrl(inv: GroupInvite) {
    return `${location.origin}/grupos/?invitacion=${inv.token}`;
  }

  private inviteText(g: Group, inv: GroupInvite) {
    return `Te invito a «${g.name}» en el cuaderno de casa: lista de la compra, tareas, calendario y menú compartidos. Entra con este enlace: ${this.inviteUrl(inv)}`;
  }

  whatsappUrl(g: Group, inv: GroupInvite) {
    return `https://wa.me/?text=${encodeURIComponent(this.inviteText(g, inv))}`;
  }

  selectAll(event: Event) {
    (event.target as HTMLInputElement).select();
  }

  formatDay(iso: string) {
    return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  }

  async shareInvite(g: Group, inv: GroupInvite) {
    try {
      await navigator.share({ title: g.name, text: this.inviteText(g, inv) });
    } catch {
      // cancelado por el usuario: no es un error
    }
  }

  async copyInvite(inv: GroupInvite) {
    try {
      await navigator.clipboard.writeText(this.inviteUrl(inv));
      this.status.show('Enlace copiado.');
    } catch {
      this.status.show('No se pudo copiar: mantén pulsado el enlace para copiarlo.');
    }
  }

  private setInvite(groupId: string, inv: GroupInvite | null) {
    const map = new Map(this.inviteByGroup());
    map.set(groupId, inv);
    this.inviteByGroup.set(map);
  }

  private async loadInvite(groupId: string) {
    try {
      this.setInvite(groupId, await this.groups.invite(groupId));
    } catch {
      // sin enlace visible; crear uno mostrara el error si lo hay
    }
  }

  async newInvite(groupId: string) {
    const had = !!this.inviteOf(groupId);
    if (had && !confirm('El enlace actual dejará de funcionar. ¿Crear uno nuevo?')) return;
    try {
      this.setInvite(groupId, await this.groups.newInvite(groupId));
      this.status.show(had ? 'Enlace cambiado: el anterior ya no vale.' : 'Enlace creado. Compártelo con quien quieras en el grupo.');
    } catch (err) {
      this.status.showError(err);
    }
  }

  async revokeInvite(groupId: string) {
    if (!confirm('¿Desactivar el enlace? Nadie más podrá unirse con él.')) return;
    try {
      await this.groups.revokeInvite(groupId);
      this.setInvite(groupId, null);
      this.status.show('Enlace desactivado.');
    } catch (err) {
      this.status.showError(err);
    }
  }

  activityOf(groupId: string) {
    return this.activityByGroup().get(groupId) ?? [];
  }

  formatWhen(iso: string): string {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return 'ahora mismo';
    if (mins < 60) return `hace ${mins} min`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `hace ${hours} h`;
    const days = Math.round(hours / 24);
    return `hace ${days} d`;
  }

  availableFriends(groupId: string) {
    const memberIds = new Set(this.membersOf(groupId).map((m) => m.id));
    return this.friends.friends().filter((f) => !memberIds.has(f.id));
  }

  async toggle(groupId: string) {
    const open = new Set(this.openGroups());
    if (open.has(groupId)) {
      open.delete(groupId);
      this.openGroups.set(open);
      return;
    }
    await this.open(groupId);
  }

  // Recien unido con un enlace (invite-card): se ve el grupo ya abierto.
  async onJoined(groupId: string) {
    try {
      await this.groups.load();
      await this.open(groupId);
    } catch (err) {
      this.status.showError(err);
    }
  }

  async open(groupId: string) {
    const open = new Set(this.openGroups());
    open.add(groupId);
    this.openGroups.set(open);
    const isOwner = this.groups.groups().find((g) => g.id === groupId)?.isOwner;
    await Promise.all([
      this.loadMembers(groupId),
      this.loadActivity(groupId),
      isOwner ? this.loadInvite(groupId) : Promise.resolve(),
    ]);
  }

  private async loadMembers(groupId: string) {
    try {
      const data = await this.groups.members(groupId);
      const map = new Map(this.membersByGroup());
      map.set(groupId, data.members);
      this.membersByGroup.set(map);
    } catch (err) {
      this.status.showError(err);
    }
  }

  private async loadActivity(groupId: string) {
    try {
      const activity = await this.groups.activity(groupId);
      const map = new Map(this.activityByGroup());
      map.set(groupId, activity);
      this.activityByGroup.set(map);
    } catch {
      // el feed de actividad es un extra informativo -- si falla, no
      // merece la pena interrumpir con un error, se deja vacio.
    }
  }

  async createGroup() {
    const name = this.nameInput.trim();
    if (!name) return;
    try {
      const created = await this.groups.create(name);
      this.nameInput = '';
      this.status.show(`Grupo "${name}" creado. Ahora invita a los demás con un enlace.`);
      await this.groups.load();
      // Se abre ya: lo siguiente que hay que hacer es invitar a alguien.
      await this.open(created.id);
    } catch (err) {
      this.status.showError(err);
    }
  }

  async addMember(groupId: string) {
    const username = this.selectedFriendByGroup[groupId];
    if (!username) return;
    try {
      await this.groups.addMember(groupId, username);
      this.status.show(`@${username} añadido al grupo.`);
      await this.loadMembers(groupId);
      await this.groups.load();
    } catch (err) {
      this.status.showError(err);
    }
  }

  async removeMember(groupId: string, userId: string) {
    try {
      await this.groups.removeMember(groupId, userId);
      this.status.show('Miembro eliminado.');
      await this.loadMembers(groupId);
      await this.groups.load();
    } catch (err) {
      this.status.showError(err);
    }
  }

  async leave(groupId: string) {
    const me = this.meId();
    if (!me || !confirm('¿Salir de este grupo?')) return;
    try {
      await this.groups.removeMember(groupId, me);
      this.status.show('Has salido del grupo.');
      await this.groups.load();
    } catch (err) {
      this.status.showError(err);
    }
  }

  // El backend borra el grupo entero cuando el propio propietario se
  // elimina a sí mismo de los miembros (ver DELETE /groups/:id/members/:userId
  // en lista-compra-api) -- mismo endpoint que "leave", solo cambia el
  // aviso porque aquí sí que se destruye la lista compartida y su
  // actividad para todos, no solo para quien lo pulsa.
  async deleteGroup(groupId: string, name: string) {
    const me = this.meId();
    if (!me) return;
    if (!confirm(`¿Eliminar el grupo "${name}"? Se borrará la lista compartida y toda su actividad para todos los miembros. Esta acción no se puede deshacer.`)) return;
    try {
      await this.groups.removeMember(groupId, me);
      this.status.show(`Grupo "${name}" eliminado.`);
      await this.groups.load();
    } catch (err) {
      this.status.showError(err);
    }
  }
}
