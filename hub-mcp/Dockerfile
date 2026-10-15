# Servidor MCP del hub: expone compra/tareas/calendario/gastos/menu como
# herramientas para el asistente (Open WebUI hoy, jarvis-api despues).
# Mismo endurecimiento que las APIs del hub (ver todo-api/Dockerfile).
FROM node:20-alpine
RUN apk upgrade --no-cache
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
            /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY server.js auth.js hub.js tools.js util.js recipes.js ./

ENV TZ=Europe/Madrid
EXPOSE 3000
CMD ["node", "server.js"]
