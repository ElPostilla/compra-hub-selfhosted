# hub-mcp — las apps del hub como herramientas para un modelo

Servidor [MCP](https://modelcontextprotocol.io) (Streamable HTTP, modo
*stateless*, endpoint `POST /mcp`) que expone compra, tareas, calendario,
gastos y menú como herramientas para un modelo de lenguaje. Lo usa el
asistente del propio hub (`asistente-api`) y puede usarlo cualquier
cliente MCP que sepa mandar el token de Keycloak del usuario (Open WebUI,
por ejemplo). Cómo conectarlo: README principal, sección «Asistente y MCP».

## Cómo actúa en nombre de cada persona

```
cliente MCP ──Authorization: Bearer <token Keycloak de quien habla>──► hub-mcp
hub-mcp ──X-Auth-Request-Access-Token: <el mismo token>──► lista-compra-api, todo-api, ...
```

- hub-mcp verifica la firma del token contra el JWKS del realm
  (`OIDC_ISSUER`, `OIDC_JWKS_URI`) y llama a las APIs por la red interna
  con ese mismo token, en la cabecera que pone oauth2-proxy.
- **No toca ninguna base de datos**: los permisos, el aviso en tiempo real
  a los demás miembros del grupo, el historial de actividad y los avisos
  push los hacen las propias APIs, igual que desde la app.
- No tiene secretos propios.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `resumen_hoy` | Fecha de hoy + tareas que vencen/atrasadas, notas y eventos de hoy, menú, compra pendiente, saldos |
| `listar_grupos` | Grupos del usuario |
| `compra_ver_lista` / `compra_anadir` / `compra_marcar_comprado` / `compra_quitar` | Lista de la compra personal o de grupo |
| `compra_ver_precios` | Comparativa de precios (Mercadona / Dia) de la lista |
| `tareas_listar` / `tareas_crear` / `tareas_completar` | Tareas personales o de grupo |
| `calendario_ver` / `calendario_anadir_nota` | Notas del calendario (+ eventos de Google en el personal) |
| `gastos_anadir` / `gastos_resumen_mes` | Gastos personales o de grupo |
| `menu_ver` / `menu_planificar` | Menú semanal |
| `receta_anadir` | Ingredientes de un plato (los pone el modelo) a la lista de la compra y, si se sabe el día, al menú |

Todas aceptan `grupo` por **nombre** (sin tildes/mayúsculas); sin él, lo
personal. Productos y tareas también se buscan por nombre; si hay
ambigüedad la herramienta devuelve las opciones para que el modelo
pregunte.

**Qué lista de la compra usa** (`shoppingTarget()` en `tools.js`):
`personal=true` («mi lista») o `lista=<nombre>` → lista personal;
`grupo=<nombre>` → ese grupo; nada → el único grupo del usuario, o su
lista personal si no tiene grupos. Con varias opciones posibles nunca elige
en silencio: pregunta. Un usuario nuevo no tiene lista personal hasta que
abre la app de la compra por primera vez.

**Recetas** (`receta_anadir`): el modelo decide los ingredientes (~4
raciones) y la herramienta los añade sin duplicar. Si no se ha dicho día y
comida, la respuesta trae los huecos libres de la semana para que el modelo
pregunte. La receta se recuerda en memoria por usuario 2 h (`recipes.js`),
así que con una sola réplica basta.

**Categorías de la compra:** `util.js` lleva una copia del clasificador de
`lista-compra/src/app/categories.ts`. Si se cambia allí, cambiarlo aquí.

## Variables de entorno

| Variable | Por defecto | Para qué |
|---|---|---|
| `OIDC_ISSUER` | — (obligatoria) | URL del realm, igual que el `iss` de los tokens |
| `OIDC_JWKS_URI` | `<issuer>/protocol/openid-connect/certs` | Claves públicas del realm (mejor la URL interna de Keycloak) |
| `OIDC_AUDIENCES` | `compras,account` | Audiencias aceptadas |
| `LISTA_API_URL`, `TODO_API_URL`, ... | `http://<servicio>:3000/<prefijo>` | URLs internas de las APIs |
| `TZ` | `Europe/Madrid` | Zona horaria de «hoy» |

## Tests

```bash
cd hub-mcp && npm install && npm test
```

Unitarios de `util.js` + las herramientas probadas con un cliente MCP real
(transporte en memoria del SDK) contra un hub simulado.
`eval/tool-choice.js` mide, contra un Ollama real, si el modelo elige bien
las herramientas (útil antes de cambiar el prompt del asistente).
