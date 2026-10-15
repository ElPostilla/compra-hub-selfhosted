import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Profile } from './models';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly api = inject(ApiService);
  readonly profile = signal<Profile | null>(null);

  async load(): Promise<Profile> {
    const me = await this.api.get<Profile>('/api/profile');
    this.profile.set(me);
    return me;
  }
}
