# Seguridad / Security

**Español** · [English](#english)

Si encuentras una vulnerabilidad, **no abras un issue público**. Repórtala
en privado desde la pestaña *Security* del repositorio → **Report a
vulnerability** (o en
<https://github.com/ElPostilla/compra-hub-selfhosted/security/advisories/new>).

Incluye qué componente es (app, API, despliegue...), cómo reproducirlo y
qué impacto tiene. Se responderá lo antes posible; cuando haya arreglo, se
publicará un aviso y se te dará crédito si quieres.

Solo se da soporte a la última versión de `main`.

Cada instalación la gestiona quien la monta: este proyecto no opera ningún
servicio en nombre de terceros. Si el fallo es de tu instalación (secretos
filtrados, configuración), cambia las claves con
`scripts/generar-secretos.sh` y en Keycloak.

## English

If you find a vulnerability, **do not open a public issue**. Report it
privately from the repository's *Security* tab → **Report a vulnerability**
(or at <https://github.com/ElPostilla/compra-hub-selfhosted/security/advisories/new>).

Include the affected component (app, API, deployment...), how to reproduce
it and its impact. You'll get a reply as soon as possible; once fixed, an
advisory will be published, with credit to you if you wish.

Only the latest `main` is supported. Each installation is run by whoever
deploys it; this project does not operate any service on anyone's behalf.
