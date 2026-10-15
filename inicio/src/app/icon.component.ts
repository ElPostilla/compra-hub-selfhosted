import { Component, input } from '@angular/core';

export type IconName =
  | 'home'
  | 'person'
  | 'people'
  | 'cart'
  | 'coin'
  | 'bell'
  | 'bell-off'
  | 'repeat'
  | 'pin'
  | 'leaf'
  | 'bread'
  | 'milk'
  | 'meat'
  | 'jar'
  | 'snowflake'
  | 'cup'
  | 'bottle'
  | 'soap'
  | 'plate'
  | 'party'
  | 'car'
  | 'pill'
  | 'box'
  | 'menu'
  | 'calendar'
  | 'checklist'
  | 'utensils'
  | 'share'
  | 'trash'
  | 'close'
  | 'plus'
  | 'check'
  | 'chat'
  | 'send'
  | 'mic';

// Sustituto SVG de los emojis del hub: mismo estilo de linea que ya
// usaban inicio/nav-drawer. width/height:1em + stroke:currentColor hacen
// que cada icono herede el tamano de fuente y el color del sitio donde se
// use, sin fijar un tamano distinto en cada uno de los ~25 puntos de uso.
@Component({
  selector: 'app-icon',
  standalone: true,
  template: `
    @switch (name()) {
      @case ('home') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 11.5 12 4l8 7.5" />
          <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" />
          <path d="M10 20v-5h4v5" />
        </svg>
      }
      @case ('person') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="3.4" />
          <path d="M5 20c0-3.8 3.1-6.5 7-6.5s7 2.7 7 6.5" />
        </svg>
      }
      @case ('people') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="9" cy="8.5" r="3" />
          <path d="M3.5 19c0-3 2.5-5.2 5.5-5.2s5.5 2.2 5.5 5.2" />
          <path d="M15.5 6.2c1.5.3 2.5 1.6 2.5 3.1s-1 2.8-2.5 3.1" />
          <path d="M16.5 13.9c2.3.6 3.8 2.5 3.8 5.1" />
        </svg>
      }
      @case ('cart') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 8h12l-1.2 10.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8L6 8Z" />
          <path d="M9 8V6a3 3 0 0 1 6 0v2" />
        </svg>
      }
      @case ('coin') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <text x="12" y="16" text-anchor="middle" font-size="11" font-weight="600" fill="currentColor" stroke="none">€</text>
        </svg>
      }
      @case ('bell') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </svg>
      }
      @case ('bell-off') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
          <path d="M3.5 3.5l17 17" />
        </svg>
      }
      @case ('repeat') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 7h11a3 3 0 0 1 3 3v2" />
          <path d="M16 9l2-3 2 3" />
          <path d="M20 17H9a3 3 0 0 1-3-3v-2" />
          <path d="M8 15l-2 3-2-3" />
        </svg>
      }
      @case ('pin') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
          <circle cx="12" cy="9.5" r="2.3" />
        </svg>
      }
      @case ('leaf') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 19c-2-6 1-13 12-14 1 8-4 13-12 14Z" />
          <path d="M7 18c3-4 6-7 10-11" />
        </svg>
      }
      @case ('bread') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 12c0-4.5 3.5-7.5 8-7.5s8 3 8 7.5v4a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16v-4Z" />
          <path d="M9 12v4M12 12v4M15 12v4" />
        </svg>
      }
      @case ('milk') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9 3h6l1 4-2 2v11a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V9l-2-2 1-4Z" />
          <path d="M9 9h6" />
        </svg>
      }
      @case ('meat') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 4c3 0 5.5 2.5 5.5 5.5 0 2-1 3.7-2.6 4.7l-4.4 4.4a2.6 2.6 0 0 1-3.7-3.7l4.4-4.4A5.5 5.5 0 0 1 14 4Z" />
          <path d="M6.5 17.5 4 20" />
        </svg>
      }
      @case ('jar') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="6" y="7" width="12" height="13" rx="1.5" />
          <path d="M6 11h12" />
          <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
        </svg>
      }
      @case ('snowflake') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3v18" />
          <path d="M4.5 7.5l15 9" />
          <path d="M19.5 7.5l-15 9" />
        </svg>
      }
      @case ('cup') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M7 8h10l-1 12a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1L7 8Z" />
          <path d="M6 8h12" />
          <path d="M14 4l1 4" />
        </svg>
      }
      @case ('bottle') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M10 3h4v3l1.5 1.5v12A1.5 1.5 0 0 1 14 21h-4a1.5 1.5 0 0 1-1.5-1.5v-12L10 6V3Z" />
          <path d="M8.5 12h7" />
        </svg>
      }
      @case ('soap') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="4" y="10" width="16" height="8" rx="4" />
          <circle cx="17" cy="6" r="1.3" />
          <circle cx="19.5" cy="9" r="0.9" />
        </svg>
      }
      @case ('plate') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      }
      @case ('party') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 20 8 9l7 7Z" />
          <path d="M15 4l.8 1.8M19 6.5l-1.8.8M18.5 3l-1 2" />
        </svg>
      }
      @case ('car') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 16v-3.5l2-4.5a2 2 0 0 1 1.9-1.3h8.2A2 2 0 0 1 18 7.9l2 4.5V16" />
          <path d="M4 16h16" />
          <circle cx="7.5" cy="16.5" r="1.6" />
          <circle cx="16.5" cy="16.5" r="1.6" />
        </svg>
      }
      @case ('pill') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="5" y="9" width="14" height="6" rx="3" transform="rotate(45 12 12)" />
          <path d="M12 9v6" transform="rotate(45 12 12)" />
        </svg>
      }
      @case ('box') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 8l8-4 8 4-8 4-8-4Z" />
          <path d="M4 8v9l8 4 8-4V8" />
          <path d="M12 12v9" />
        </svg>
      }
      @case ('menu') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M4 7h16M4 12h11M4 17h14" />
        </svg>
      }
      @case ('calendar') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="4" y="5.5" width="16" height="15" rx="2.5" />
          <path d="M4 10h16" />
          <path d="M8 3.5v3M16 3.5v3" />
        </svg>
      }
      @case ('checklist') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4.5 6.5l1.5 1.5 2.5-2.5" />
          <path d="M11 6.5h8.5" />
          <path d="M4.5 12.5l1.5 1.5 2.5-2.5" />
          <path d="M11 12.5h8.5" />
          <path d="M4.5 18.5l1.5 1.5 2.5-2.5" />
          <path d="M11 18.5h8.5" />
        </svg>
      }
      @case ('utensils') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M6 3v6M9 3v6M12 3v6" />
          <path d="M9 9v12" />
          <path d="M16 3c1.7 0 3 1.8 3 4s-1.3 4-3 4M16 3v16" />
        </svg>
      }
      @case ('share') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 15V4M8 8l4-4 4 4" />
          <path d="M6 12v6.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V12" />
        </svg>
      }
      @case ('trash') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 7h14M10 7V5h4v2" />
          <path d="M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7" />
        </svg>
      }
      @case ('close') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </svg>
      }
      @case ('plus') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      }
      @case ('check') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      }
      @case ('chat') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8.5A1.5 1.5 0 0 1 19 17h-7l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 5 5.5Z" />
          <path d="M8 10h8M8 13h5" />
        </svg>
      }
      @case ('send') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 11.5 20 4l-6.5 16-2.8-6.7L4 11.5Z" />
          <path d="M10.7 13.3 20 4" />
        </svg>
      }
      @case ('mic') {
        <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect x="9" y="3.5" width="6" height="11" rx="3" />
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5" />
        </svg>
      }
    }
  `,
  styles: [':host { display: inline-flex; align-items: center; justify-content: center; line-height: 0; }'],
})
export class IconComponent {
  readonly name = input.required<IconName>();
}
