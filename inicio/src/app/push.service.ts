import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';

const API = '/api';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

// Activar/desactivar notificaciones push del navegador. El service worker
// (push-sw.js) vive en la raiz del dominio (registrado desde inicio, la
// portada del hub) para poder recibir push aunque el usuario este en
// cualquier otra app -- el permiso y la suscripcion son por origen, no
// por ruta.
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly api = inject(ApiService);

  readonly supported = 'serviceWorker' in navigator && 'PushManager' in window;
  readonly subscribed = signal(false);
  readonly loaded = signal(false);

  private registration: ServiceWorkerRegistration | null = null;

  async init(): Promise<void> {
    if (!this.supported) {
      this.loaded.set(true);
      return;
    }
    try {
      this.registration = await navigator.serviceWorker.register('/push-sw.js');
      const existing = await this.registration.pushManager.getSubscription();
      this.subscribed.set(!!existing);
    } catch {
      /* SW no disponible (p.ej. contexto no seguro) -- se queda sin activar */
    }
    this.loaded.set(true);
  }

  async enable(): Promise<boolean> {
    if (!this.supported || !this.registration) return false;
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;

    const { publicKey } = await this.api.get<{ publicKey: string | null }>(`${API}/push/vapid-public-key`);
    if (!publicKey) return false;

    const subscription = await this.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await this.api.post(`${API}/push/subscribe`, { subscription: subscription.toJSON() });
    this.subscribed.set(true);
    return true;
  }

  async disable(): Promise<void> {
    if (!this.registration) return;
    const subscription = await this.registration.pushManager.getSubscription();
    if (subscription) {
      await this.api.delete(`${API}/push/subscribe`, { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    this.subscribed.set(false);
  }
}
