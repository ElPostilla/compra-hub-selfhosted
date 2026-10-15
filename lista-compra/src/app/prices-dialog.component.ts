import { Component, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { PricesService } from './prices.service';
import { Item, PriceResult, PriceTotal } from './models';

interface ProductGroup {
  product: string;
  rows: PriceResult[];
  bestIndex: number;
}

@Component({
  selector: 'app-prices-dialog',
  standalone: true,
  imports: [DecimalPipe],
  template: `
    <dialog #dialog (click)="onBackdropClick($event)">
      <div class="dialog-inner">
        <h2>Comparativa de precios</h2>

        @switch (status()) {
          @case ('loading') {
            <p class="prices-status">Buscando precios…</p>
          }
          @case ('error') {
            <p class="prices-status error">No se ha podido consultar precios ahora mismo.</p>
          }
          @case ('empty') {
            <p class="prices-disclaimer">{{ disclaimer() }}</p>
            <p class="prices-status">No se han encontrado precios.</p>
          }
          @case ('ok') {
            <p class="prices-disclaimer">{{ disclaimer() }}</p>
            @if (totals().length) {
              <div class="price-totals">
                <h3>Total de la lista</h3>
                <ul class="price-list">
                  @for (t of totals(); track t.supermarket; let i = $index) {
                    <li [class.best]="i === 0 && totalsComparable()">
                      <span>{{ t.supermarket }}</span>
                      @if (t.found < t.of) {
                        <span class="price-meta">{{ t.found }} de {{ t.of }} productos</span>
                      }
                      <span class="price-value">{{ t.total_eur | number: '1.2-2' }} €</span>
                    </li>
                  }
                </ul>
                <p class="price-meta">Aproximado: los formatos de cada tienda pueden no ser iguales.</p>
              </div>
            }
            @for (group of groups(); track group.product) {
              <div class="price-product">
                <h3>{{ group.product }}</h3>
                <ul class="price-list">
                  @for (r of group.rows; track r.supermarket; let i = $index) {
                    <li [class.best]="i === group.bestIndex">
                      <span class="price-store">
                        <span>{{ r.supermarket }}@if (r.promo) { <em class="price-promo">oferta</em>}</span>
                        <small>{{ r.match_name ?? r.note }}</small>
                      </span>
                      <span class="price-value">
                        {{ r.price_eur != null ? (r.price_eur | number: '1.2-2') + ' €' : 'sin datos' }}
                        @if (r.unit_price) {
                          <small>{{ r.unit_price }}</small>
                        }
                      </span>
                      @if (r.source_url) {
                        <a [href]="r.source_url" target="_blank" rel="noopener noreferrer" class="price-source">ver</a>
                      }
                    </li>
                  }
                </ul>
              </div>
            }
          }
        }

        <button type="button" (click)="close()">Cerrar</button>
      </div>
    </dialog>
  `,
})
export class PricesDialogComponent {
  private readonly prices = inject(PricesService);

  @ViewChild('dialog') private dialogRef!: ElementRef<HTMLDialogElement>;

  readonly status = signal<'loading' | 'error' | 'empty' | 'ok'>('loading');
  readonly disclaimer = signal('');
  readonly groups = signal<ProductGroup[]>([]);
  readonly totals = signal<PriceTotal[]>([]);
  /** Solo se marca el total más barato si las tiendas han encontrado los mismos productos. */
  readonly totalsComparable = computed(() => this.totals().every((t) => t.found === this.totals()[0].found));

  async open(items: Pick<Item, 'name' | 'qty'>[]) {
    this.status.set('loading');
    this.dialogRef.nativeElement.showModal();

    try {
      const data = await this.prices.fetchPrices(items);
      this.disclaimer.set(data.disclaimer || 'Precios de las tiendas online: comprueba que el producto es el que quieres.');
      // El total solo tiene sentido con varios productos; el más barato primero.
      const products = new Set((data.results || []).map((r) => r.product));
      this.totals.set(products.size > 1 ? [...(data.totals || [])].sort((a, b) => b.found - a.found || a.total_eur - b.total_eur) : []);

      const byProduct = new Map<string, PriceResult[]>();
      for (const r of data.results || []) {
        const list = byProduct.get(r.product) ?? [];
        list.push(r);
        byProduct.set(r.product, list);
      }

      if (byProduct.size === 0) {
        this.status.set('empty');
        return;
      }

      const groups: ProductGroup[] = [];
      for (const [product, rows] of byProduct) {
        // Con la misma unidad (€/kg, €/L) se compara por precio de referencia:
        // una bandeja de 500 g y otra de 1 kg no se comparan por lo que cuestan.
        const withPrice = rows.filter((r) => r.price_eur != null);
        const sameUnit = withPrice.length > 1 && withPrice.every((r) => r.unit_price_eur != null && r.unit === withPrice[0].unit);
        const cost = (r: PriceResult) => (r.price_eur == null ? Infinity : sameUnit ? r.unit_price_eur! : r.price_eur);
        const sorted = [...rows].sort((a, b) => cost(a) - cost(b));
        const bestIndex = sorted.findIndex((r) => r.price_eur != null);
        groups.push({ product, rows: sorted, bestIndex });
      }
      this.groups.set(groups);
      this.status.set('ok');
    } catch {
      this.status.set('error');
    }
  }

  close() {
    this.dialogRef.nativeElement.close();
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === this.dialogRef.nativeElement) this.close();
  }
}
