// Cliente de las APIs del hub. Todas las llamadas van con el access token
// de la persona que habla con el asistente (nunca uno propio del servicio):
// cada API aplica sus propios permisos (solo tus tareas, solo grupos de
// los que eres miembro...) y, en las acciones de grupo, hace el broadcast
// por WebSocket, deja la linea en el feed de actividad y manda el push a
// los demas miembros -- exactamente igual que si la accion se hubiera
// hecho desde la app. Por eso aqui NO se toca ninguna base de datos.
//
// Se llama a los Services internos (sin pasar por Traefik/oauth2-proxy),
// con el token en la misma cabecera que pone oauth2-proxy en produccion.
// Nombres cortos: valen igual como Services de Kubernetes (mismo namespace)
// que como servicios de Docker Compose (misma red).
const svc = (name) => `http://${name}:3000`;

const BASES = {
  lista: process.env.LISTA_API_URL || `${svc("lista-compra-api")}/api`,
  todo: process.env.TODO_API_URL || `${svc("todo-api")}/api-todo`,
  calendario: process.env.CALENDARIO_API_URL || `${svc("calendario-api")}/api-calendario`,
  gastos: process.env.GASTOS_API_URL || `${svc("gastos-api")}/api-gastos`,
  menu: process.env.MENU_API_URL || `${svc("menu-api")}/api-menu`,
};

class HubError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function hubClient(token) {
  async function call(api, method, path, body, { timeoutMs = 15000 } = {}) {
    const res = await fetch(`${BASES[api]}${path}`, {
      method,
      headers: {
        "x-auth-request-access-token": token,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text };
    }
    if (!res.ok) {
      throw new HubError(data?.error || `${api} respondio ${res.status}`, res.status);
    }
    return data;
  }

  return {
    get: (api, path) => call(api, "GET", path),
    post: (api, path, body, opts) => call(api, "POST", path, body ?? {}, opts),
    put: (api, path, body) => call(api, "PUT", path, body ?? {}),
    patch: (api, path, body) => call(api, "PATCH", path, body ?? {}),
    del: (api, path) => call(api, "DELETE", path),
  };
}

module.exports = { hubClient, HubError, BASES };
