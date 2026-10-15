import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { ActivityEntry, Group, GroupInvite, GroupMember, InvitePreview } from './models';

@Injectable({ providedIn: 'root' })
export class GroupsService {
  private readonly api = inject(ApiService);

  readonly groups = signal<Group[]>([]);

  async load(): Promise<void> {
    const data = await this.api.get<{ groups: Group[] }>('/api/groups');
    this.groups.set(data.groups);
  }

  create(name: string) {
    return this.api.post<{ id: string; name: string; listId: string }>('/api/groups', { name });
  }

  members(groupId: string) {
    return this.api.get<{ members: GroupMember[] }>(`/api/groups/${groupId}/members`);
  }

  addMember(groupId: string, username: string) {
    return this.api.post(`/api/groups/${groupId}/members`, { username });
  }

  removeMember(groupId: string, userId: string) {
    return this.api.delete(`/api/groups/${groupId}/members/${userId}`);
  }

  async invite(groupId: string): Promise<GroupInvite | null> {
    const data = await this.api.get<{ invite: GroupInvite | null }>(`/api/groups/${groupId}/invite`);
    return data.invite;
  }

  // Crea el enlace o lo cambia por uno nuevo (el anterior deja de valer).
  async newInvite(groupId: string): Promise<GroupInvite> {
    const data = await this.api.post<{ invite: GroupInvite }>(`/api/groups/${groupId}/invite`);
    return data.invite;
  }

  revokeInvite(groupId: string) {
    return this.api.delete(`/api/groups/${groupId}/invite`);
  }

  previewInvite(token: string) {
    return this.api.get<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`);
  }

  acceptInvite(token: string) {
    return this.api.post<{ groupId: string; alreadyMember: boolean }>(`/api/invites/${encodeURIComponent(token)}/accept`);
  }

  async activity(groupId: string): Promise<ActivityEntry[]> {
    const data = await this.api.get<{ activity: ActivityEntry[] }>(`/api/groups/${groupId}/activity`);
    return data.activity;
  }
}
