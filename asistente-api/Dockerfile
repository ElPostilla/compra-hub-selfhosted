# Asistente del hub (chat de todas las apps): un modelo de Ollama
# + herramientas de hub-mcp con el token de quien escribe. Mismo
# endurecimiento que las demas APIs (ver todo-api/Dockerfile).
FROM node:20-alpine
RUN apk upgrade --no-cache
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
            /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY server.js agent.js ollama.js hub-tools.js rate-limit.js auth.js ./
# Prompt de sistema: en el cluster lo tapa el ConfigMap «asistente-prompt»
# montado en /app/config; config-default es la copia de reserva si falta.
COPY config ./config
COPY config ./config-default

ENV TZ=Europe/Madrid
EXPOSE 3000
CMD ["node", "server.js"]
