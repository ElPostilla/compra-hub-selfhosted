import { Component, input, output } from '@angular/core';
import { Item } from './models';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-item-row',
  standalone: true,
  imports: [IconComponent],
  template: `
    <li [class.done]="item().done">
      <button
        type="button"
        class="row-btn"
        [attr.aria-pressed]="item().done"
        [attr.aria-label]="(item().done ? 'Marcar como pendiente: ' : 'Marcar como comprado: ') + item().name"
        (click)="toggle.emit()"
      >
        <span class="check" aria-hidden="true">@if (item().done) { <app-icon name="check"></app-icon> }</span>
        <span class="item-name" [class.struck]="item().done">{{ item().name }}</span>
      </button>
      <span class="item-qty">×{{ item().qty }}</span>
      <button
        type="button"
        class="recurring-btn"
        [class.active]="item().recurring"
        [attr.aria-pressed]="item().recurring"
        [attr.aria-label]="item().recurring ? 'Quitar de fijos' : 'Marcar como fijo (no se borra al vaciar comprados)'"
        (click)="toggleRecurring.emit()"
      >
        <app-icon name="pin"></app-icon>
      </button>
      <button
        type="button"
        class="item-price-btn"
        [attr.aria-label]="'Comparar precio de ' + item().name"
        (click)="comparePrice.emit()"
      >
        <app-icon name="coin"></app-icon>
      </button>
      <button type="button" class="remove-btn" [attr.aria-label]="'Quitar ' + item().name" (click)="remove.emit()">
        <app-icon name="close"></app-icon>
      </button>
    </li>
  `,
})
export class ItemRowComponent {
  readonly item = input.required<Item>();
  readonly toggle = output<void>();
  readonly remove = output<void>();
  readonly comparePrice = output<void>();
  readonly toggleRecurring = output<void>();
}
