# Pagina de inicio del hub, ahora en Angular (standalone components).
# Build multi-stage: se compila con Node y solo el resultado estatico
# (dist/inicio/browser) llega a la imagen final servida con nginx.
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install

COPY angular.json tsconfig.json tsconfig.app.json ./
COPY src ./src
COPY public ./public
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist/inicio/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
