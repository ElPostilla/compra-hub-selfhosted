import { Component, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AccountService } from './account.service';
import { StatusService } from './status.service';
import { Profile } from './models';

const CONFIRM_WORD = 'ELIMINAR';

@Component({
  selector: 'app-privacy-card',
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="card">
      <h2>Tus datos y privacidad</h2>
      <p class="privacy-text">
        Puedes descargar una copia de todo lo que el hub guarda sobre ti o eliminar tu cuenta.
        Más detalles en la <a href="/legal/privacidad.html" target="_blank" rel="noopener">política de privacidad</a>.
      </p>
      <button type="button" class="btn btn-block" (click)="download()" [disabled]="busy()">
        {{ busy() === 'export' ? 'Preparando tus datos…' : 'Descargar mis datos' }}
      </button>

      @if (!confirming()) {
        <button type="button" class="btn btn-block btn-danger" (click)="confirming.set(true)" [disabled]="!!busy()">
          Eliminar mi cuenta
        </button>
      } @else {
        <div class="delete-box" role="group" aria-labelledby="delete-title">
          <p id="delete-title"><strong>Se borrará tu cuenta y todo lo tuyo.</strong></p>
          <ul>
            <li>Tus listas, tareas, notas, gastos, presupuestos y menús personales.</li>
            <li>Tus amistades y tu pertenencia a grupos. Los grupos en los que estabas solo se borran.</li>
            <li>En los grupos compartidos, lo que añadiste se queda para los demás pero sin tu nombre; si eras el dueño, pasa a otro miembro.</li>
            <li>Los gastos compartidos se conservan para que las cuentas de los demás cuadren.</li>
          </ul>
          <p>Después, en la pantalla de inicio de sesión, repetirás tu contraseña y confirmarás el borrado de tu cuenta de acceso. No se puede deshacer.</p>
          <label for="confirm-delete">Escribe {{ confirmWord }} para confirmar</label>
          <input id="confirm-delete" type="text" autocomplete="off" [(ngModel)]="typed" name="typed" />
          <div class="delete-actions">
            <button type="button" class="btn" (click)="cancel()" [disabled]="!!busy()">Cancelar</button>
            <button type="button" class="btn btn-danger" (click)="remove()" [disabled]="typed.trim().toUpperCase() !== confirmWord || !!busy()">
              {{ busy() === 'delete' ? 'Eliminando…' : 'Eliminar definitivamente' }}
            </button>
          </div>
        </div>
      }

      <p class="legal-links">
        <a href="/legal/privacidad.html" target="_blank" rel="noopener">Privacidad</a> ·
        <a href="/legal/cookies.html" target="_blank" rel="noopener">Cookies</a> ·
        <a href="/legal/condiciones.html" target="_blank" rel="noopener">Condiciones de uso</a> ·
        <a href="/legal/aviso-legal.html" target="_blank" rel="noopener">Aviso legal</a>
      </p>
    </section>
  `,
  styles: [`
    .privacy-text { margin: 0; color: var(--ink-soft); }
    .delete-box { margin-top: 1rem; padding: 0.9rem 1rem; border: 1.5px solid var(--red); border-radius: 10px; background: var(--red-soft); }
    .delete-box p { margin: 0 0 0.6rem; }
    .delete-box ul { margin: 0 0 0.6rem; padding-left: 1.2rem; }
    .delete-box li { margin-bottom: 0.25rem; }
    .delete-box label { display: block; margin-bottom: 0.3rem; font-weight: 600; }
    .delete-box input { width: 100%; }
    .delete-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; margin-top: 0.8rem; }
    .legal-links { margin: 1.1rem 0 0; padding-bottom: 4.5rem; font-size: 0.9rem; color: var(--ink-soft); }
  `],
})
export class PrivacyCardComponent {
  private readonly account = inject(AccountService);
  private readonly status = inject(StatusService);

  readonly profile = input<Profile | null>(null);
  readonly busy = signal<'export' | 'delete' | null>(null);
  readonly confirming = signal(false);
  readonly confirmWord = CONFIRM_WORD;
  typed = '';

  async download() {
    this.busy.set('export');
    try {
      const data = await this.account.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mis-datos-hub-de-casa-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      this.status.showError(err);
    } finally {
      this.busy.set(null);
    }
  }

  cancel() {
    this.confirming.set(false);
    this.typed = '';
  }

  async remove() {
    this.busy.set('delete');
    try {
      await this.account.deleteAll();
    } catch (err) {
      this.busy.set(null);
      this.status.showError(err);
      return;
    }
    // Datos del hub borrados. Falta la cuenta de acceso: se cierra la sesion
    // del hub y Keycloak pide confirmar el borrado (accion delete_account);
    // al terminar vuelve a una pagina publica que no necesita sesion.
    const accountUrl = this.profile()?.accountConsoleUrl || '';
    const done = `${location.origin}/legal/cuenta-eliminada.html`;
    if (!/^https?:\/\/.+\/account\/?$/.test(accountUrl)) {
      location.href = `/oauth2/sign_out?rd=${encodeURIComponent(done)}`;
      return;
    }
    const issuer = accountUrl.replace(/\/account\/?$/, '');
    const kc = `${issuer}/protocol/openid-connect/auth?client_id=compras&response_type=code&scope=openid` +
      `&redirect_uri=${encodeURIComponent(done)}&kc_action=delete_account`;
    location.href = `/oauth2/sign_out?rd=${encodeURIComponent(kc)}`;
  }
}
