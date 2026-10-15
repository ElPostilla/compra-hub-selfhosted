# Lista de la compra del hub, ahora en Angular (standalone components).
# manifest.json/sw.js/iconos viven en public/ y se copian tal cual al
# build (Angular los trata como assets estaticos, sin procesarlos).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY angular.json tsconfig.json tsconfig.app.json ./
COPY src ./src
COPY public ./public
# Limita la memoria de Node durante el build de Angular: en maquinas
# pequeñas (p.ej. una Raspberry Pi) evita que el build se quede sin RAM.
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist/lista-compra/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
