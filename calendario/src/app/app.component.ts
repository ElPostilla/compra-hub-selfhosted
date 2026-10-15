import { Component, ViewChild, computed, inject } from '@angular/core';
import { AsistenteComponent } from './asistente.component';
import { ProfileMenuComponent } from './profile-menu.component';
import { NavDrawerComponent } from './nav-drawer.component';
import { IconComponent } from './icon.component';
import { CalendarsDialogComponent } from './calendars-dialog.component';
import { DayDialogComponent } from './day-dialog.component';
import { CalendarStateService } from './calendar-state.service';
import { ToastService } from './toast.service';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS_SEMANA_LUNES_PRIMERO = (jsDay: number) => (jsDay === 0 ? 6 : jsDay - 1); // JS: 0=domingo
const IMPORTANCE_ORDER: Record<string, number> = { alta: 2, media: 1, baja: 0 };

function fmtDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

interface DayCell {
  key: string;
  dayNum: number;
  otherMonth: boolean;
  today: boolean;
  dots: number[];
  // hasta 3 importancias distintas presentes ese dia, mas urgente primero
  // (puede haber varios recordatorios el mismo dia, ver day-dialog).
  noteImportances: string[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ProfileMenuComponent, NavDrawerComponent, IconComponent, CalendarsDialogComponent, DayDialogComponent, AsistenteComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  // Asistente (chat comun a todas las apps, ver asistente.component.ts):
  // que se esta viendo, para que «añade…» vaya ahi, y que recargar cuando
  // el asistente cambia datos.
  assistantView(): string | null {
    return this.state.viewMode() === 'group' ? `el calendario del grupo «${this.state.calendarName()}»` : 'tu calendario personal';
  }
  onAssistantChanged() {
    this.state.refreshMonth();
  }

  readonly state = inject(CalendarStateService);
  readonly toast = inject(ToastService);

  @ViewChild(CalendarsDialogComponent) private calendarsDialog!: CalendarsDialogComponent;
  @ViewChild(DayDialogComponent) private dayDialog!: DayDialogComponent;

  readonly monthLabel = computed(() => {
    const c = this.state.current();
    return MESES[c.getMonth()] + ' ' + c.getFullYear();
  });

  readonly weekdayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  readonly days = computed<DayCell[]>(() => {
    const current = this.state.current();
    const notes = this.state.notes();
    const eventsByDate = this.state.eventsByDate();

    const firstOfMonth = new Date(current.getFullYear(), current.getMonth(), 1);
    const startOffset = DIAS_SEMANA_LUNES_PRIMERO(firstOfMonth.getDay());
    const gridStart = new Date(firstOfMonth);
    gridStart.setDate(gridStart.getDate() - startOffset);

    const todayKey = fmtDate(new Date());
    const cells: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      const key = fmtDate(d);
      const dayNotes = notes[key] || [];
      const dotCount = Math.min((eventsByDate[key] || []).length, 3);
      const noteImportances = Array.from(new Set(dayNotes.map((n) => n.importance)))
        .sort((a, b) => IMPORTANCE_ORDER[b] - IMPORTANCE_ORDER[a])
        .slice(0, 3);
      cells.push({
        key,
        dayNum: d.getDate(),
        otherMonth: d.getMonth() !== current.getMonth(),
        today: key === todayKey,
        dots: Array.from({ length: dotCount }, (_, i) => i),
        noteImportances,
      });
    }
    return cells;
  });

  async ngOnInit() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected')) {
      this.toast.show('Google Calendar conectado.');
      history.replaceState({}, '', '/calendario/');
    } else if (params.get('auth_error')) {
      this.toast.show('No se pudo conectar con Google.');
      history.replaceState({}, '', '/calendario/');
    }
    await this.state.init();
  }

  openCalendarsDialog() {
    this.calendarsDialog.open();
  }

  openDay(key: string) {
    this.dayDialog.open(key);
  }

  prevMonth() {
    this.state.setMonth(-1);
  }
  nextMonth() {
    this.state.setMonth(1);
  }
  today() {
    this.state.goToday();
  }

  async connectGoogle() {
    try {
      const data = await this.state.getGoogleAuthUrl();
      if (data.url) window.location.href = data.url;
    } catch {
      this.toast.show('No se pudo iniciar la conexión con Google.');
    }
  }
}
