# Backend de gastos compartidos: gastos personales y de grupo con reparto
# igualitario y saldo neto por persona. Mismo patron que todo-api.
FROM node:20-alpine
# apk upgrade: parchea libssl3/libcrypto3 y demas paquetes del SO con CVEs
# conocidas que la imagen base de Docker Hub aun no ha reconstruido.
RUN apk upgrade --no-cache
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev \
  # El CLI de npm (y corepack) viene preinstalado en la imagen base para
  # poder correr "npm install" aqui, pero el contenedor en produccion solo
  # ejecuta "node server.js": no hace falta en runtime y su propio
  # arbol de dependencias (tar, glob, minimatch, sigstore...) es la fuente
  # de la mayoria de CVEs de esta imagen.
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
            /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY server.js db.js auth.js ws.js asyncHandler.js groupsClient.js monthly-summary.js ./
COPY routes ./routes

EXPOSE 3000
CMD ["node", "server.js"]
