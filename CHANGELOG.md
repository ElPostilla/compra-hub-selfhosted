# Cambios / Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/);
las versiones siguen [SemVer](https://semver.org/lang/es/).
Format based on Keep a Changelog; versions follow SemVer.

## [1.0.0] - 2026-10-15

Primera versión pública. / First public release.

### Apps
- **Inicio**: resumen «Hoy» (tareas, calendario, menú, saldos de gastos) y activación de avisos push.
- **Lista de la compra**: listas personales y de grupo, categorías automáticas por pasillo, secciones propias (tiendas, «para quién»), productos fijos y comparador de precios Mercadona / Dia.
- **Tareas**: lista y kanban, fecha límite, importancia, repetición y orden manual.
- **Calendario**: notas con hora, aviso push y repetición; Google Calendar opcional (solo lectura).
- **Gastos**: personales y de grupo, presupuesto por categoría, quién pagó y entre quién se reparte, deudas entre miembros, histórico y resumen mensual.
- **Menú**: comidas y cenas de la semana con ingredientes que se mandan a la lista de la compra.
- **Perfil y grupos**: amistades, grupos, invitaciones por enlace, actividad reciente, descarga y borrado de datos y de cuenta.
- PWA instalable con modo sin conexión y diseño común «cuaderno de casa».

### Asistente
- Chat en todas las apps con un modelo de Ollama (probado con `gemma4:e4b`).
- **hub-mcp**: servidor MCP con 17 herramientas (compra, tareas, calendario, gastos, menú, recetas) que actúa con el token del usuario; usable también desde otros clientes MCP (p.ej. Open WebUI).

### Despliegue
- Imágenes compilables desde el repositorio (`scripts/build-images.sh`, multi-arquitectura opcional).
- Docker Compose: Traefik con HTTPS, Keycloak con el realm `compras` importado, oauth2-proxy y Postgres.
- Kubernetes con kustomize (`kubectl apply -k deploy/`), Ingress de Traefik y cert-manager opcional.
- Secretos generados con `scripts/generar-secretos.sh`, fuera de git.
- Documentación en español e inglés.

[1.0.0]: https://github.com/ElPostilla/compra-hub-selfhosted/releases/tag/1.0.0
