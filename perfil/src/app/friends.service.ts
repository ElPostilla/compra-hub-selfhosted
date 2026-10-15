import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Friend, FriendRequest, FriendsData } from './models';

@Injectable({ providedIn: 'root' })
export class FriendsService {
  private readonly api = inject(ApiService);

  readonly friends = signal<Friend[]>([]);
  readonly incoming = signal<FriendRequest[]>([]);
  readonly outgoing = signal<FriendRequest[]>([]);

  async load(): Promise<void> {
    const data = await this.api.get<FriendsData>('/api/friends');
    this.friends.set(data.friends);
    this.incoming.set(data.incoming);
    this.outgoing.set(data.outgoing);
  }

  sendRequest(username: string) {
    return this.api.post('/api/friends/requests', { username });
  }

  accept(requestId: string) {
    return this.api.post(`/api/friends/${requestId}/accept`);
  }

  // Cubre rechazar entrante, cancelar saliente y eliminar amistad aceptada
  // (mismo endpoint en la API, ver friends.js).
  remove(id: string) {
    return this.api.delete(`/api/friends/${id}`);
  }
}
