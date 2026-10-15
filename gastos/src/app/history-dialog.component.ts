import { Component, ElementRef, ViewChild, inject } from '@angular/core';
import { ExpensesStateService } from './expenses-state.service';
import { formatCents } from './models';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

// Historico de los ultimos 6 meses (incluido el actual): una barra por
// mes, escalada contra el mayor gasto del rango, para ver la tendencia de
// un vistazo. Los datos ya estan en memoria (ver monthlyHistory en
// ExpensesStateService), esto es solo visualizarlos.
@Component({
  selector: 'app-history-dialog',
  standalone: true,
  template: `
    <dialog #dialog (click)="onBackdropClick($event)">
      <div class="dialog-inner">
        <h2>Histórico mensual</h2>
        <p class="budgets-hint">{{ state.accountName() }} — últimos 6 meses.</p>
        <ul class="history-list">
          @for (m of state.monthlyHistory(); track m.month) {
            <li class="history-row">
              <span class="history-month">{{ monthLabel(m.month) }}</span>
              <div class="history-bar-track">
                <div class="history-bar-fill" [style.width.%]="pct(m.totalCents)"></div>
              </div>
              <span class="history-amount">{{ formatCents(m.totalCents) }}</span>
            </li>
          }
        </ul>
        <button type="button" id="close-groups-dialog" (click)="close()">Cerrar</button>
      </div>
    </dialog>
  `,
})
export class HistoryDialogComponent {
  readonly state = inject(ExpensesStateService);
  readonly formatCents = formatCents;

  @ViewChild('dialog') private dialogRef!: ElementRef<HTMLDialogElement>;

  open() {
    this.dialogRef.nativeElement.showModal();
  }

  close() {
    this.dialogRef.nativeElement.close();
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === this.dialogRef.nativeElement) this.close();
  }

  monthLabel(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return `${MESES[m - 1]} ${y}`;
  }

  pct(cents: number): number {
    const max = Math.max(...this.state.monthlyHistory().map((h) => h.totalCents), 1);
    return Math.round((cents / max) * 100);
  }
}
