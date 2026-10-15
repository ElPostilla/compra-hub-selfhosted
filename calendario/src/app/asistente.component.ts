import { Component, ElementRef, HostListener, ViewChild, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { IconComponent } from './icon.component';

// Asistente del hub (chat con qwen3.8 + herramientas del hub, ver
// asistente-api/). IDENTICO en todas las apps: se edita en lista-compra y
// se copia. Cada app le pasa en que app esta y que esta viendo (para que
// «añade leche» vaya a la lista abierta) y escucha (changed) para recargar
// sus datos cuando el asistente cambia algo.
//
// La conversacion vive en sessionStorage (mismo origen para todas las
// apps): sigue al cambiar de app y se olvida al cerrar la pestaña.

type Role = 'user' | 'assistant';
interface Msg {
  role: Role;
  content: string;
  // Solo en la respuesta en curso / ya dada:
  thinking?: boolean;
  steps?: string[];
  error?: boolean;
}

const STORAGE_KEY = 'hub-asistente-v1';
const API = '/api-asistente';

// Lo que se ve mientras el asistente usa una herramienta.
const TOOL_LABELS: Record<string, string> = {
  resumen_hoy: 'Mirando lo de hoy',
  listar_grupos: 'Mirando tus grupos',
  compra_ver_lista: 'Mirando la lista de la compra',
  compra_anadir: 'Añadiendo a la compra',
  compra_marcar_comprado: 'Marcando como comprado',
  compra_quitar: 'Quitando de la lista',
  compra_ver_precios: 'Mirando precios en Mercadona y Dia',
  tareas_listar: 'Mirando las tareas',
  tareas_crear: 'Apuntando la tarea',
  tareas_completar: 'Marcando la tarea como hecha',
  calendario_ver: 'Mirando el calendario',
  calendario_anadir_nota: 'Apuntando en el calendario',
  gastos_anadir: 'Apuntando el gasto',
  gastos_resumen_mes: 'Sumando los gastos del mes',
  menu_ver: 'Mirando el menú',
  menu_planificar: 'Apuntando en el menú',
  receta_anadir: 'Añadiendo los ingredientes',
};

const SUGGESTIONS: Record<string, string[]> = {
  inicio: ['¿Qué tengo hoy?', 'Recuérdame sacar la basura el martes'],
  lista: ['Añade los ingredientes para una lasaña', '¿Dónde me sale más barata la compra?'],
  tareas: ['¿Qué tareas tengo pendientes?', 'Recuérdame llamar al médico mañana'],
  calendario: ['¿Qué tengo esta semana?', 'Apunta el dentista el viernes a las 17:00'],
  gastos: ['He gastado 23,50 en el súper', '¿Cuánto llevo gastado este mes?'],
  menu: ['¿Qué cenamos mañana?', 'Quiero hacer lasaña, añade los ingredientes'],
  social: ['¿Qué tengo hoy?'],
  perfil: ['¿Qué tengo hoy?'],
};

@Component({
  selector: 'app-asistente',
  standalone: true,
  imports: [FormsModule, IconComponent],
  template: `
    @if (!open()) {
      <button type="button" class="fab" aria-label="Abrir el asistente" (click)="openPanel()">
        <app-icon name="chat"></app-icon><span class="fab-label">Asistente</span>
      </button>
    } @else {
      <div class="backdrop" (click)="closePanel()"></div>
      <section class="panel" role="dialog" aria-label="Asistente" aria-modal="true">
        <header>
          <h2>Asistente</h2>
          @if (messages().length) {
            <button type="button" class="text" (click)="clear()" [disabled]="busy()">Nueva conversación</button>
          }
          <button type="button" class="icon" aria-label="Cerrar el asistente" (click)="closePanel()"><app-icon name="close"></app-icon></button>
        </header>
        <!-- Transparencia (Reglamento europeo de IA, art. 50): quien escribe
             tiene que saber que habla con un sistema de IA. -->
        <p class="ai-note">Asistente automático con inteligencia artificial. Puede equivocarse: revisa lo que hace. <a href="/legal/privacidad.html#ia" target="_blank" rel="noopener">Más info</a></p>

        <div class="log" #log aria-live="polite">
          @if (available() === false) {
            <p class="notice">El asistente no está disponible ahora mismo: el ordenador con el modelo está apagado. El resto del hub funciona igual.</p>
          }
          @if (!messages().length && available() !== false) {
            <p class="hello">Pídeme lo que harías en el hub: añadir a la compra, apuntar una tarea o una cita, un gasto, el menú…</p>
            <div class="suggestions">
              @for (s of suggestions(); track s) {
                <button type="button" (click)="send(s)">{{ s }}</button>
              }
            </div>
          }
          @for (m of messages(); track $index) {
            @if (m.role === 'user') {
              <p class="msg user">{{ m.content }}</p>
            } @else {
              <div class="msg assistant" [class.error]="m.error">
                @for (s of m.steps ?? []; track $index) {
                  <p class="step"><app-icon name="check"></app-icon>{{ s }}</p>
                }
                @if (m.content) {
                  <p class="text-body">{{ m.content }}</p>
                } @else if (m.thinking || busy()) {
                  <p class="thinking">pensando…</p>
                }
              </div>
            }
          }
        </div>

        @if (voiceError()) {
          <p class="voice-error" role="status">{{ voiceError() }}</p>
        }
        <form (ngSubmit)="send(draft)">
          <textarea
            #input
            name="draft"
            rows="1"
            [(ngModel)]="draft"
            [placeholder]="listening() ? 'Te escucho…' : 'Escribe o pulsa el micrófono…'"
            [disabled]="available() === false"
            (keydown.enter)="onEnter($event)"
            aria-label="Mensaje para el asistente"
          ></textarea>
          @if (voiceSupported) {
            <button
              type="button"
              class="mic"
              [class.listening]="listening()"
              [attr.aria-pressed]="listening()"
              [attr.aria-label]="listening() ? 'Dejar de escuchar' : 'Hablar'"
              [disabled]="busy() || available() === false"
              (click)="toggleVoice()"
            >
              <app-icon name="mic"></app-icon>
            </button>
          }
          <button type="submit" class="send" aria-label="Enviar" [disabled]="busy() || !draft.trim() || available() === false">
            <app-icon name="send"></app-icon>
          </button>
        </form>
      </section>
    }
  `,
  styles: [
    `
      :host { font-family: var(--font); }
      /* Boton flotante: a mano en movil; con etiqueta en escritorio. Cada
         app puede subirlo con --asistente-bottom (p.ej. sobre un pie fijo). */
      .fab {
        position: fixed;
        right: calc(1rem + env(safe-area-inset-right, 0px));
        bottom: calc(var(--asistente-bottom, 1rem) + env(safe-area-inset-bottom, 0px));
        z-index: 90;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        height: 56px;
        min-width: 56px;
        padding: 0 1rem;
        border: none;
        border-radius: 28px;
        background: var(--pen);
        color: var(--on-pen);
        font-size: 1.5rem;
        box-shadow: var(--pop-shadow);
        cursor: pointer;
      }
      .fab:hover { background: var(--pen-strong); }
      .fab-label { display: none; font-size: 1rem; font-weight: 700; font-variation-settings: 'CASL' 1; }
      .backdrop { position: fixed; inset: 0; z-index: 95; background: rgba(14, 20, 44, 0.45); }

      /* Movil: pantalla completa. */
      .panel {
        position: fixed;
        inset: 0;
        z-index: 100;
        display: flex;
        flex-direction: column;
        background-color: var(--paper);
        background-image:
          linear-gradient(var(--grid) 1px, transparent 1px),
          linear-gradient(90deg, var(--grid) 1px, transparent 1px);
        background-size: var(--grid-size) var(--grid-size);
        border-top: 6px solid var(--pen);
        color: var(--ink);
        padding: env(safe-area-inset-top, 0) 0 env(safe-area-inset-bottom, 0);
        animation: in 0.18s ease-out;
      }
      @keyframes in { from { transform: translateY(12px); opacity: 0; } }
      header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.6rem 0.6rem 0.6rem 1.1rem;
        border-bottom: 1.5px solid var(--rule);
        background: var(--paper);
      }
      h2 { margin: 0 auto 0 0; font-size: 1.5rem; font-weight: 750; font-variation-settings: 'CASL' 1; }
      button { font: inherit; cursor: pointer; }
      button:disabled { cursor: default; }
      .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 44px;
        height: 44px;
        border: none;
        border-radius: var(--r-m);
        background: none;
        color: var(--ink);
        font-size: 1.25rem;
      }
      .icon:hover { background: var(--paper-2); }
      .text {
        min-height: 40px;
        border: none;
        background: none;
        color: var(--ink-soft);
        font-size: 0.9rem;
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      .log {
        flex: 1 1 auto;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 0.9rem;
        padding: 1.1rem;
      }
      .hello, .notice { margin: 0; color: var(--ink-soft); font-size: 1.02rem; }
      .ai-note { margin: 0; padding: 0.4rem 1rem 0.5rem; color: var(--ink-soft); font-size: 0.8rem; border-bottom: 1px solid var(--rule); }
      .ai-note a { color: inherit; }
      .notice { padding: 0.7rem 0.9rem; border-left: 4px solid var(--marker); background: var(--paper-2); border-radius: 0 var(--r-s) var(--r-s) 0; }
      .suggestions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
      .suggestions button {
        min-height: 40px;
        padding: 0 0.85rem;
        border: 1.5px solid var(--rule);
        border-radius: 20px;
        background: var(--paper);
        color: var(--ink);
        font-size: 0.95rem;
      }
      .suggestions button:hover { border-color: var(--ink-soft); }

      .msg { margin: 0; max-width: 88%; overflow-wrap: anywhere; }
      /* Lo que escribes: una nota pegada, a la derecha. */
      .msg.user {
        align-self: flex-end;
        padding: 0.55rem 0.85rem;
        border-radius: var(--r-m) var(--r-m) 4px var(--r-m);
        background: var(--pen-soft);
        color: var(--ink);
        font-size: 1rem;
        white-space: pre-wrap;
      }
      /* La respuesta: escrita en la hoja. */
      .msg.assistant { align-self: flex-start; }
      .msg.assistant p { margin: 0; }
      .text-body { font-size: 1.05rem; line-height: 1.5; white-space: pre-wrap; }
      .step { display: flex; align-items: center; gap: 0.4rem; color: var(--ink-soft); font-size: 0.9rem; }
      .step app-icon { color: var(--green); }
      .thinking { color: var(--ink-faint); font-variation-settings: 'CASL' 1; font-size: 1.05rem; animation: blink 1.4s ease-in-out infinite; }
      @keyframes blink { 50% { opacity: 0.45; } }
      .msg.error .text-body { color: var(--red); }

      form {
        display: flex;
        align-items: flex-end;
        gap: 0.5rem;
        padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
        border-top: 1.5px solid var(--rule);
        background: var(--paper);
      }
      textarea {
        flex: 1 1 auto;
        min-width: 0;
        min-height: 44px;
        max-height: 8rem;
        padding: 0.6rem 0.75rem;
        border: 1.5px solid var(--rule);
        border-radius: var(--r-m);
        background: var(--paper);
        color: var(--ink);
        font: inherit;
        font-size: 1rem;
        resize: none;
        field-sizing: content;
      }
      textarea:focus-visible { outline: none; border-color: var(--pen); box-shadow: 0 0 0 3px var(--pen-soft); }
      .send {
        flex: 0 0 44px;
        height: 44px;
        border: none;
        border-radius: var(--r-m);
        background: var(--pen);
        color: var(--on-pen);
        font-size: 1.2rem;
      }
      .send:disabled { background: var(--paper-2); color: var(--ink-faint); }
      /* Microfono: trazo de boli; escuchando, en rojo con un pulso. */
      .mic {
        flex: 0 0 44px;
        height: 44px;
        border: 1.5px solid var(--rule);
        border-radius: var(--r-m);
        background: var(--paper);
        color: var(--ink);
        font-size: 1.25rem;
      }
      .mic:hover:not(:disabled) { border-color: var(--ink-soft); }
      .mic:disabled { color: var(--ink-faint); }
      .mic.listening {
        border-color: var(--red);
        background: var(--red);
        color: #fff;
        animation: pulse 1.2s ease-in-out infinite;
      }
      @keyframes pulse { 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--red) 25%, transparent); } }
      .voice-error { margin: 0; padding: 0.5rem 1rem 0; color: var(--red); font-size: 0.9rem; background: var(--paper); }

      /* Escritorio: hoja lateral a la derecha, sin tapar toda la app. */
      @media (min-width: 900px) {
        .fab { right: 2rem; bottom: 2rem; }
        .fab-label { display: inline; }
        .backdrop { background: rgba(14, 20, 44, 0.2); }
        .panel {
          inset: 1.5rem 1.5rem 1.5rem auto;
          width: min(430px, calc(100vw - 3rem));
          border-radius: 4px 4px var(--r-l) var(--r-l);
          box-shadow: var(--pop-shadow);
          padding: 0;
        }
        .panel form { border-radius: 0 0 var(--r-l) var(--r-l); }
      }
      @media (prefers-reduced-motion: reduce) {
        .panel, .thinking, .mic.listening { animation: none; }
      }
    `,
  ],
})
export class AsistenteComponent {
  // Que app es ('lista', 'tareas'...) y que se esta viendo en ella
  // (p.ej. "tu lista personal «Mercadona»"), para el contexto del modelo.
  readonly app = input.required<string>();
  readonly view = input<string | null>(null);
  // El asistente ha cambiado datos: la app deberia recargar los suyos.
  readonly changed = output<void>();

  @ViewChild('log') private logRef?: ElementRef<HTMLElement>;
  @ViewChild('input') private inputRef?: ElementRef<HTMLTextAreaElement>;

  readonly open = signal(false);
  readonly busy = signal(false);
  readonly available = signal<boolean | null>(null);
  readonly messages = signal<Msg[]>(this.restore());
  draft = '';
  private abort: AbortController | null = null;

  // Voz: reconocimiento del propio navegador (Web Speech API). Safari en
  // iPhone y Chrome/Edge lo tienen; si no (Firefox), no se muestra el
  // boton. Al dejar de hablar se envia solo (control por voz); el
  // asistente dice siempre que ha hecho, asi que un error se ve al momento.
  private readonly Recognition: any =
    (globalThis as any).SpeechRecognition ?? (globalThis as any).webkitSpeechRecognition ?? null;
  readonly voiceSupported = !!this.Recognition;
  readonly listening = signal(false);
  readonly voiceError = signal<string | null>(null);
  private recognition: any = null;

  suggestions() {
    return SUGGESTIONS[this.app()] ?? SUGGESTIONS['inicio'];
  }

  async openPanel() {
    this.open.set(true);
    setTimeout(() => {
      this.inputRef?.nativeElement.focus();
      this.scrollDown();
    });
    try {
      const res = await fetch(`${API}/status`);
      this.available.set(res.ok ? (await res.json()).available : false);
    } catch {
      this.available.set(false);
    }
  }

  closePanel() {
    this.stopVoice();
    this.open.set(false);
  }

  toggleVoice() {
    if (this.listening()) {
      this.stopVoice();
      return;
    }
    this.voiceError.set(null);
    const rec = new this.Recognition();
    rec.lang = 'es-ES';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = (ev: any) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      // Se ve lo que se va entendiendo mientras se habla.
      this.draft = (finalText + interim).trim();
    };
    rec.onerror = (ev: any) => {
      const messages: Record<string, string> = {
        'not-allowed': 'Permite el micrófono en el navegador para hablar con el asistente.',
        'service-not-allowed': 'Permite el micrófono en el navegador para hablar con el asistente.',
        'no-speech': 'No te he oído. Pulsa el micrófono y vuelve a intentarlo.',
        'audio-capture': 'No encuentro ningún micrófono.',
        network: 'El reconocimiento de voz necesita conexión a Internet.',
      };
      if (ev.error !== 'aborted') this.voiceError.set(messages[ev.error] ?? 'No he podido usar el micrófono.');
    };
    rec.onend = () => {
      this.listening.set(false);
      this.recognition = null;
      const text = finalText.trim();
      if (text) this.send(text);
    };
    this.recognition = rec;
    this.listening.set(true);
    try {
      rec.start();
    } catch {
      this.listening.set(false);
      this.recognition = null;
      this.voiceError.set('No he podido usar el micrófono.');
    }
  }

  private stopVoice() {
    // stop() termina y entrega lo ya dicho (onend lo envia); abort() no.
    this.recognition?.stop();
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open()) this.closePanel();
  }

  onEnter(ev: Event) {
    const e = ev as KeyboardEvent;
    if (e.shiftKey) return; // Mayus+Intro: salto de linea
    e.preventDefault();
    this.send(this.draft);
  }

  clear() {
    this.abort?.abort();
    this.messages.set([]);
    this.persist();
  }

  async send(text: string) {
    const content = text.trim();
    if (!content || this.busy()) return;
    this.draft = '';
    const history = [...this.messages().filter((m) => !m.error && m.content), { role: 'user' as Role, content }];
    this.messages.set([...this.messages(), { role: 'user', content }, { role: 'assistant', content: '', thinking: true, steps: [] }]);
    this.busy.set(true);
    this.scrollDown();
    this.abort = new AbortController();

    let changed = false;
    try {
      const res = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          context: { app: this.app(), view: this.view() },
        }),
        signal: this.abort.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        if (res.status === 503) this.available.set(false);
        throw new Error(data?.error || 'No he podido contestar. Prueba otra vez.');
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const line = block.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue; // latido
          const ev = JSON.parse(line.slice(6));
          if (ev.type === 'delta') this.updateLast((m) => ({ ...m, thinking: false, content: m.content + ev.text }));
          else if (ev.type === 'step') this.updateLast((m) => (m.content ? { ...m, content: m.content + '\n\n' } : m));
          else if (ev.type === 'tool') this.updateLast((m) => ({ ...m, steps: [...(m.steps ?? []), TOOL_LABELS[ev.name] ?? 'Consultando el hub'] }));
          else if (ev.type === 'done') changed = ev.changed;
          else if (ev.type === 'error') throw new Error(ev.message);
          this.scrollDown();
        }
      }
    } catch (err) {
      if (!this.abort?.signal.aborted) {
        const message = err instanceof Error ? err.message : 'No he podido contestar.';
        this.updateLast((m) => ({ ...m, thinking: false, error: true, content: message }));
      }
    } finally {
      this.updateLast((m) => ({ ...m, thinking: false }));
      this.busy.set(false);
      this.abort = null;
      this.persist();
      if (changed) this.changed.emit();
    }
  }

  private updateLast(fn: (m: Msg) => Msg) {
    const list = this.messages();
    if (!list.length) return;
    this.messages.set([...list.slice(0, -1), fn(list[list.length - 1])]);
  }

  private scrollDown() {
    setTimeout(() => {
      const el = this.logRef?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private restore(): Msg[] {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Msg[]).slice(-30) : [];
    } catch {
      return [];
    }
  }

  private persist() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(this.messages().slice(-30)));
    } catch {
      /* sin almacenamiento: la conversacion solo vive mientras la pagina */
    }
  }
}
