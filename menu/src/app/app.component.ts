import { Component, ViewChild, inject } from '@angular/core';
import { AsistenteComponent } from './asistente.component';
import { ProfileMenuComponent } from './profile-menu.component';
import { NavDrawerComponent } from './nav-drawer.component';
import { IconComponent } from './icon.component';
import { GroupsDialogComponent } from './groups-dialog.component';
import { MenuStateService } from './menu-state.service';
import { ToastService } from './toast.service';
import { SLOTS, SLOT_LABELS, Slot, mealKey } from './models';

const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function dateKey(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ProfileMenuComponent, NavDrawerComponent, IconComponent, GroupsDialogComponent, AsistenteComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  // Asistente (chat comun a todas las apps, ver asistente.component.ts):
  // que se esta viendo, para que «añade…» vaya ahi, y que recargar cuando
  // el asistente cambia datos.
  assistantView(): string | null {
    return this.state.ownerMode() === 'group' ? `el menú del grupo «${this.state.menuName()}»` : 'tu menú personal';
  }
  onAssistantChanged() {
    this.state.loadWeek();
  }

  readonly state = inject(MenuStateService);
  readonly toast = inject(ToastService);
  readonly slots = SLOTS;
  readonly slotLabels = SLOT_LABELS;
  readonly diasLabels = DIAS;

  @ViewChild(GroupsDialogComponent) private groupsDialog!: GroupsDialogComponent;

  private readonly edits = new Map<string, string>();
  private readonly ingredientEdits = new Map<string, string>();
  private readonly todayKey = dateKey(new Date());

  async ngOnInit() {
    await this.state.init();
  }

  openGroupsDialog() {
    this.groupsDialog.open();
  }

  dayKey(d: Date): string {
    return dateKey(d);
  }

  isToday(d: Date): boolean {
    return dateKey(d) === this.todayKey;
  }

  dayLabel(d: Date): string {
    return `${DIAS[d.getDay() === 0 ? 6 : d.getDay() - 1]} ${d.getDate()}`;
  }

  weekRangeLabel(): string {
    const days = this.state.weekDays();
    const first = days[0];
    const last = days[6];
    if (first.getMonth() === last.getMonth()) {
      return `${first.getDate()}–${last.getDate()} de ${MESES[first.getMonth()]}`;
    }
    return `${first.getDate()} de ${MESES[first.getMonth()]} – ${last.getDate()} de ${MESES[last.getMonth()]}`;
  }

  cellValue(date: string, slot: Slot): string {
    const key = mealKey(date, slot);
    if (this.edits.has(key)) return this.edits.get(key)!;
    return this.state.meals().get(key)?.title ?? '';
  }

  onCellInput(date: string, slot: Slot, event: Event) {
    this.edits.set(mealKey(date, slot), (event.target as HTMLInputElement).value);
  }

  async commitCell(date: string, slot: Slot) {
    const key = mealKey(date, slot);
    if (!this.edits.has(key)) return;
    const value = this.edits.get(key)!;
    this.edits.delete(key);
    const original = this.state.meals().get(key)?.title ?? '';
    if (value.trim() === original.trim()) return;
    await this.state.setMeal(date, slot, value);
  }

  blurCell(event: Event) {
    (event.target as HTMLInputElement).blur();
  }

  ingredientsValue(date: string, slot: Slot): string {
    const key = mealKey(date, slot);
    if (this.ingredientEdits.has(key)) return this.ingredientEdits.get(key)!;
    return (this.state.meals().get(key)?.ingredients ?? []).join(', ');
  }

  onIngredientsInput(date: string, slot: Slot, event: Event) {
    this.ingredientEdits.set(mealKey(date, slot), (event.target as HTMLInputElement).value);
  }

  async commitIngredients(date: string, slot: Slot) {
    const key = mealKey(date, slot);
    if (!this.ingredientEdits.has(key)) return;
    const value = this.ingredientEdits.get(key)!;
    this.ingredientEdits.delete(key);
    const meal = this.state.meals().get(key);
    const original = (meal?.ingredients ?? []).join(', ');
    if (!meal || value.trim() === original.trim()) return;
    await this.state.setIngredients(date, slot, value);
  }

  hasIngredients(date: string, slot: Slot): boolean {
    return (this.state.meals().get(mealKey(date, slot))?.ingredients ?? []).length > 0;
  }

  hasMeal(date: string, slot: Slot): boolean {
    return !!this.state.meals().get(mealKey(date, slot));
  }

  sendToShoppingList(date: string, slot: Slot) {
    const ingredients = this.state.meals().get(mealKey(date, slot))?.ingredients ?? [];
    if (!ingredients.length) return;
    window.open('/lista/?add=' + encodeURIComponent(ingredients.join(',')), '_blank');
  }

  hasAnyIngredientsThisWeek(): boolean {
    return this.state.weekDays().some((d) => this.slots.some((s) => this.hasIngredients(this.dayKey(d), s)));
  }

  sendWeekToShoppingList() {
    const seen = new Set<string>();
    const ingredients: string[] = [];
    for (const day of this.state.weekDays()) {
      for (const slot of this.slots) {
        for (const ing of this.state.meals().get(mealKey(this.dayKey(day), slot))?.ingredients ?? []) {
          const key = ing.trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          ingredients.push(ing.trim());
        }
      }
    }
    if (!ingredients.length) return;
    window.open('/lista/?add=' + encodeURIComponent(ingredients.join(',')), '_blank');
  }
}
