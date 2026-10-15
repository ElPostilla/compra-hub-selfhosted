import { Injectable, inject } from '@angular/core';
import { ApiService } from './api.service';

// Derechos RGPD desde Perfil: descargar todos tus datos (arts. 15 y 20) y
// eliminar tu cuenta (art. 17). Cada API del hub guarda una parte, asi que
// se pregunta a todas (rutas /account de cada una).
const SATELLITES = [
  { key: 'tareas', path: '/api-todo/account' },
  { key: 'calendario', path: '/api-calendario/account' },
  { key: 'gastos', path: '/api-gastos/account' },
  { key: 'menu', path: '/api-menu/account' },
];
const MAIN = { key: 'cuentaListasYGrupos', path: '/api/account' };

@Injectable({ providedIn: 'root' })
export class AccountService {
  private readonly api = inject(ApiService);

  async exportAll(): Promise<Record<string, unknown>> {
    const parts = await Promise.all(
      [MAIN, ...SATELLITES].map(async (s) => [s.key, await this.api.get(`${s.path}/export`)] as const)
    );
    return {
      generado: new Date().toISOString(),
      descripcion: 'Todos los datos que el hub de casa guarda sobre ti (compra, tareas, calendario, gastos, menú, amigos y grupos).',
      ...Object.fromEntries(parts),
    };
  }

  // Orden: primero las APIs que necesitan saber aun en que grupos estas
  // (para borrar los grupos en los que eras el unico miembro), y al final
  // lista-compra-api, que borra el usuario, amigos y membresias.
  async deleteAll(): Promise<void> {
    await Promise.all(SATELLITES.map((s) => this.api.delete(s.path)));
    await this.api.delete(MAIN.path);
  }
}
