import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';
import { Item, PricesResponse } from './models';

@Injectable({ providedIn: 'root' })
export class PricesService {
  private readonly api = inject(ApiService);

  fetchPrices(items: Pick<Item, 'name' | 'qty'>[]): Promise<PricesResponse> {
    return this.api.post<PricesResponse>('/api/prices', {
      items: items.map((i) => ({ name: i.name, qty: i.qty })),
    });
  }
}
