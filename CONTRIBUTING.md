# Cómo contribuir / Contributing

**Español** · [English](#english)

¡Gracias por querer mejorar el Hub de casa! Las contribuciones son
bienvenidas: errores, mejoras, documentación, traducciones...

## Cómo se decide

El proyecto lo mantiene y lo decide **Christian Romar
([@ElPostilla](https://github.com/ElPostilla))**. Todo cambio entra por pull
request y necesita su aprobación; el mantenedor puede aceptar, pedir
cambios o rechazar cualquier contribución, y decide el rumbo del proyecto,
las versiones y la licencia.

## Antes de empezar

- **Errores pequeños y documentación**: abre directamente un pull request.
- **Funciones nuevas o cambios grandes**: abre antes un issue («Idea o
  mejora») y espera el visto bueno. Así no pierdes tiempo en algo que no
  vaya a entrar.
- **Vulnerabilidades**: nunca en un issue público. Mira [SECURITY.md](SECURITY.md).

## Flujo de trabajo

1. Haz un *fork* y crea una rama desde `main` (`fix/...`, `feat/...`, `docs/...`).
2. Monta el hub en local (README, «Probar en local»: `HUB_DOMAIN=hub.localhost`).
3. Haz el cambio siguiendo el estilo del código que tocas:
   - Las 8 apps Angular comparten componentes copiados (`profile-menu`,
     `icon`, `hub-theme.css`...). Si cambias uno, cámbialo igual en todas.
   - El clasificador de categorías está en
     `lista-compra/src/app/categories.ts` y copiado en `hub-mcp/util.js`.
   - Configuración siempre por variables de entorno; nada de dominios,
     IPs ni secretos en el código.
   - Textos de la interfaz en español.
4. Pasa los tests que haya en lo que tocas (`npm test` en `hub-mcp`,
   `asistente-api`, `lista-compra-api`, `calendario-api`) y comprueba que la
   imagen compila (`sh scripts/build-images.sh <carpeta>`).
5. Abre el pull request contra `main` rellenando la plantilla. La CI
   compila las imágenes y pasa los tests.

Mensajes de commit: en español o inglés, una primera línea corta que diga
qué cambia («Gastos: el resumen mensual cuenta los recurrentes»).

## Licencia de las contribuciones

El proyecto se distribuye bajo la [PolyForm Noncommercial 1.0.0](LICENSE).
Para que el mantenedor conserve el control del proyecto (por ejemplo, para
poder cambiar la licencia en el futuro u ofrecer otras licencias), **al
enviar una contribución** (pull request, parche o cualquier otro código,
texto o recurso):

1. Declaras que es obra tuya o que tienes derecho a aportarla en estos
   términos, y que no incluye código de terceros con licencias
   incompatibles.
2. Concedes a Christian Romar (@ElPostilla) una licencia **perpetua,
   mundial, gratuita, no exclusiva e irrevocable** para usar, copiar,
   modificar, distribuir, sublicenciar y **relicenciar** tu contribución,
   como parte del proyecto o por separado, **bajo cualquier licencia,
   incluidas licencias comerciales**.
3. Conservas los derechos de autor sobre tu contribución.

Si no estás de acuerdo, no envíes la contribución. Marcar la casilla
correspondiente de la plantilla del pull request confirma que lo aceptas.

## Normas de convivencia

Se aplica el [código de conducta](CODE_OF_CONDUCT.md).

---

## English

Thanks for wanting to improve the Home Hub! Contributions are welcome:
bugs, improvements, docs, translations...

### How decisions are made

The project is maintained and decided by **Christian Romar
([@ElPostilla](https://github.com/ElPostilla))**. Every change goes through
a pull request and needs his approval; the maintainer may accept, request
changes to or reject any contribution, and decides the project's direction,
releases and license.

### Before you start

- **Small bugs and docs**: open a pull request directly.
- **New features or large changes**: open an issue first («Idea o mejora»
  / feature request) and wait for the go-ahead.
- **Vulnerabilities**: never in a public issue. See [SECURITY.md](SECURITY.md).

### Workflow

1. Fork and branch off `main` (`fix/...`, `feat/...`, `docs/...`).
2. Run the hub locally (README, "Trying it locally": `HUB_DOMAIN=hub.localhost`).
3. Follow the style of the code you touch. The 8 Angular apps share copied
   components (`profile-menu`, `icon`, `hub-theme.css`...): change them the
   same way in all apps. Configuration only via environment variables; no
   domains, IPs or secrets in code. UI text is in Spanish.
4. Run the tests where you made changes (`npm test` in `hub-mcp`,
   `asistente-api`, `lista-compra-api`, `calendario-api`) and check the
   image builds (`sh scripts/build-images.sh <folder>`).
5. Open the pull request against `main` using the template. CI builds the
   images and runs the tests.

### Contribution license

The project is distributed under the [PolyForm Noncommercial 1.0.0](LICENSE).
So that the maintainer keeps control of the project (for instance, to
change the license in the future or offer other licenses), **by submitting
a contribution** (pull request, patch or any other code, text or asset):

1. You state that it is your own work or that you have the right to submit
   it under these terms, and that it contains no third-party code under
   incompatible licenses.
2. You grant Christian Romar (@ElPostilla) a **perpetual, worldwide,
   royalty-free, non-exclusive and irrevocable** license to use, copy,
   modify, distribute, sublicense and **relicense** your contribution, as
   part of the project or separately, **under any license, including
   commercial licenses**.
3. You keep the copyright on your contribution.

If you don't agree, don't submit the contribution. Ticking the matching box
in the pull request template confirms that you accept.

### Code of conduct

The [code of conduct](CODE_OF_CONDUCT.md) applies.
