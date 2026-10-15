import { Component, inject } from '@angular/core';
import { AsistenteComponent } from './asistente.component';
import { ProfileMenuComponent } from './profile-menu.component';
import { IconComponent } from './icon.component';
import { HomeSummaryService } from './home-summary.service';
import { PushService } from './push.service';

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ProfileMenuComponent, IconComponent, AsistenteComponent],
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
    this.summary.load();
  }

  readonly summary = inject(HomeSummaryService);
  readonly push = inject(PushService);

  // Cabecera de la portada: la pagina del dia del cuaderno.
  private readonly now = new Date();
  readonly weekdayLabel = DIAS[this.now.getDay()];
  readonly dateLabel = `${this.now.getDate()} de ${MESES[this.now.getMonth()]}`;

  pushError = false;

  // iPhone/iPad en Safari sin «Añadir a pantalla de inicio»: ahi iOS no da
  // notificaciones web, hay que explicarlo (ver app.component.html).
  readonly iosNeedsInstall = (() => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
    return ios && !standalone;
  })();

  async ngOnInit() {
    await Promise.all([this.summary.load(), this.push.init()]);
  }

  async togglePush() {
    this.pushError = false;
    try {
      if (this.push.subscribed()) {
        await this.push.disable();
      } else {
        const ok = await this.push.enable();
        if (!ok) this.pushError = true;
      }
    } catch {
      this.pushError = true;
    }
  }

  async completeTask(id: string) {
    await this.summary.completeTask(id);
  }

  formatDue(dueDate: string): string {
    const today = new Date();
    const key = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    return dueDate < key ? 'Atrasada' : 'Hoy';
  }

  formatCents(cents: number): string {
    return (Math.abs(cents) / 100).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  hasTodayMeals(): boolean {
    const m = this.summary.todayMeals();
    return !!(m.comida || m.cena);
  }

  // Los separadores del cuaderno: cada app con su color (--tab-* en
  // hub-theme.css), en el mismo orden que el menu de apps.
  readonly apps = [
    { href: '/lista/', icon: 'cart', tab: 'compra', name: 'Lista de la compra', desc: 'Lo que falta en casa, por pasillos.' },
    { href: '/todo/', icon: 'checklist', tab: 'tareas', name: 'Tareas', desc: 'Lo que hay que hacer, solo o en grupo.' },
    { href: '/calendario/', icon: 'calendar', tab: 'calendario', name: 'Calendario', desc: 'Citas y recordatorios de cada día.' },
    { href: '/gastos/', icon: 'coin', tab: 'gastos', name: 'Gastos', desc: 'Lo gastado este mes y quién debe a quién.' },
    { href: '/menu/', icon: 'utensils', tab: 'menu', name: 'Menú', desc: 'Comidas y cenas de la semana.' },
    { href: '/grupos/', icon: 'people', tab: 'social', name: 'Social', desc: 'Amigos y grupos con los que compartes.' },
  ] as const;
}
