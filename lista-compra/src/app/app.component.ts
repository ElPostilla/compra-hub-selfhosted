import { Component, ElementRef, ViewChild, computed, inject } from '@angular/core';
import { AsistenteComponent } from './asistente.component';
import { FormsModule } from '@angular/forms';
import { ProfileMenuComponent } from './profile-menu.component';
import { NavDrawerComponent } from './nav-drawer.component';
import { IconComponent, IconName } from './icon.component';
import { ItemRowComponent } from './item-row.component';
import { ListsDialogComponent } from './lists-dialog.component';
import { PricesDialogComponent } from './prices-dialog.component';
import { SectionsDialogComponent } from './sections-dialog.component';
import { ListStateService } from './list-state.service';
import { ToastService } from './toast.service';
import { CATS } from './categories';
import { Item } from './models';

const aisleIndex = (i: Item) => {
  const idx = CATS.findIndex((c) => c.key === (i.category || 'otros'));
  return idx < 0 ? CATS.length : idx;
};

interface Section {
  key: string;
  label: string;
  icon: IconName | null;
  items: Item[];
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule, ProfileMenuComponent, NavDrawerComponent, IconComponent, ItemRowComponent, ListsDialogComponent, PricesDialogComponent, SectionsDialogComponent, AsistenteComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  // Asistente (chat comun a todas las apps, ver asistente.component.ts):
  // que se esta viendo, para que «añade…» vaya ahi, y que recargar cuando
  // el asistente cambia datos.
  assistantView(): string | null {
    const l = this.state.currentList();
    return l.remote ? `la lista del grupo «${l.name}»` : `tu lista personal «${l.name}»`;
  }
  onAssistantChanged() {
    // Las listas (personales y de grupo) ya se actualizan solas por WebSocket.
  }

  readonly state = inject(ListStateService);
  readonly toast = inject(ToastService);

  @ViewChild(ListsDialogComponent) private listsDialog!: ListsDialogComponent;
  @ViewChild(PricesDialogComponent) private pricesDialog!: PricesDialogComponent;
  @ViewChild(SectionsDialogComponent) private sectionsDialog!: SectionsDialogComponent;
  @ViewChild('productInput') private productInputRef!: ElementRef<HTMLInputElement>;

  readonly qtyOptions = ['1', '2', '3', '4', '5', '6', '12'];

  productName = '';
  qty = '1';

  readonly historyOptions = computed(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const name of this.state.history()) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  });

  // Lo que se ve: toda la lista o solo la seccion elegida en los chips
  // (en la tienda, solo lo de esa tienda). Contadores, progreso, precios y
  // compartir van sobre esto.
  readonly visibleItems = computed(() => {
    const items = this.state.currentList().items;
    const active = this.state.activeSection();
    return active ? items.filter((i) => i.section === active) : items;
  });
  // Chips de seccion: pendientes de cada una.
  readonly sectionChips = computed(() => {
    const items = this.state.currentList().items.filter((i) => !i.done);
    return this.state.currentList().sections.map((name) => ({
      name,
      pending: items.filter((i) => i.section === name).length,
    }));
  });

  readonly pendingCount = computed(() => this.visibleItems().filter((i) => !i.done).length);
  readonly doneCount = computed(() => this.visibleItems().length - this.pendingCount());
  readonly totalCount = computed(() => this.visibleItems().length);
  readonly progressPct = computed(() =>
    this.totalCount() ? Math.round((this.doneCount() / this.totalCount()) * 100) : 0,
  );
  readonly countLabel = computed(() => {
    if (this.totalCount() === 0) return '0 productos';
    const p = this.pendingCount();
    const d = this.doneCount();
    return `${p} pendiente${p === 1 ? '' : 's'} · ${d} comprado${d === 1 ? '' : 's'}`;
  });

  // «Todo» con secciones definidas: un bloque por seccion (ver .by-section
  // en styles.css, que en escritorio reparte el ancho entre ellas).
  readonly bySection = computed(() => !!this.state.currentList().sections.length && !this.state.activeSection());

  // Por pasillos, salvo en «Todo» con secciones definidas: entonces un
  // bloque por seccion (en su orden) y, dentro, en orden de pasillo.
  readonly sections = computed<Section[]>(() => {
    const items = this.visibleItems();
    const pending = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);
    const out: Section[] = [];
    const defined = this.state.currentList().sections;
    if (this.bySection()) {
      const byAisle = (list: Item[]) => [...list].sort((a, b) => aisleIndex(a) - aisleIndex(b));
      for (const name of defined) {
        const inSection = pending.filter((i) => i.section === name);
        if (inSection.length) out.push({ key: `s:${name}`, label: name, icon: 'box', items: byAisle(inSection) });
      }
      const loose = pending.filter((i) => !i.section || !defined.includes(i.section));
      if (loose.length) out.push({ key: 'sin-seccion', label: 'Sin sección', icon: null, items: byAisle(loose) });
    } else {
      for (const cat of CATS) {
        const inCat = pending.filter((i) => (i.category || 'otros') === cat.key);
        if (inCat.length) out.push({ key: `c:${cat.key}`, label: cat.label, icon: cat.icon, items: inCat });
      }
    }
    if (done.length) out.push({ key: 'comprados', label: 'Comprados', icon: null, items: done });
    return out;
  });

  async ngOnInit() {
    await this.state.loadGroups();
  }

  async submitAdd() {
    const name = this.productName.trim();
    if (!name) return;
    try {
      await this.state.addItem(name, this.qty);
    } catch {
      return;
    }
    this.productName = '';
    this.qty = '1';
    this.productInputRef?.nativeElement.focus();
  }

  // Con secciones, el texto va por bloques (lo de Aldi, lo de Mercadona...).
  formatListAsText(): string {
    const list = this.state.currentList();
    const active = this.state.activeSection();
    const title = active ? `${list.name} · ${active}` : list.name;
    const blocks = this.sections().filter((s) => s.key !== 'comprados');
    if (!blocks.length) return `${title}: no quedan productos pendientes.`;
    const line = (i: Item) => `- ${i.name} (x${i.qty})`;
    if (!list.sections.length || active) {
      return `${title}:\n${blocks.flatMap((b) => b.items).map(line).join('\n')}`;
    }
    return `${title}:\n${blocks.map((b) => `\n${b.label}:\n${b.items.map(line).join('\n')}`).join('\n')}`;
  }

  openSectionsDialog() {
    this.sectionsDialog.open();
  }

  async share() {
    const list = this.state.currentList();
    const text = this.formatListAsText();
    const nav = navigator as Navigator & { share?: (data: { title: string; text: string }) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: list.name, text });
      } catch {
        /* el usuario cancelo el share sheet, no hay nada que hacer */
      }
    } else if (navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(text);
        this.toast.show('Lista copiada al portapapeles');
      } catch {
        /* portapapeles no disponible (permiso denegado, contexto no seguro, ...) */
      }
    }
  }

  openListsDialog() {
    this.listsDialog.open();
  }

  openPricesForItem(item: Item) {
    this.pricesDialog.open([{ name: item.name, qty: item.qty }]);
  }

  openPricesForPending() {
    const items = this.visibleItems().filter((i) => !i.done);
    if (!items.length) {
      this.toast.show('No hay productos pendientes que comparar.');
      return;
    }
    this.pricesDialog.open(items);
  }
}
