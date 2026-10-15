#!/bin/sh
# Compila las 15 imagenes del hub (8 apps Angular + 7 APIs Node).
#
#   sh scripts/build-images.sh                      # imagenes locales compra-hub/<app>:latest
#   REGISTRY=registry.example.com/hub TAG=1.0 sh scripts/build-images.sh
#   REGISTRY=registry.example.com/hub PUSH=1 sh scripts/build-images.sh
#   PLATFORMS=linux/amd64,linux/arm64 REGISTRY=... PUSH=1 sh scripts/build-images.sh
#   sh scripts/build-images.sh lista-compra todo-api  # solo las que indiques
#
# Variables:
#   REGISTRY   prefijo de la imagen (por defecto "compra-hub")
#   TAG        etiqueta (por defecto "latest")
#   PUSH=1     sube cada imagen al registro tras compilarla
#   PLATFORMS  compila multi-arquitectura con docker buildx (implica PUSH,
#              porque buildx no puede cargar imagenes multi-arch en local)
set -eu

cd "$(dirname "$0")/.."

REGISTRY="${REGISTRY:-compra-hub}"
TAG="${TAG:-latest}"
PUSH="${PUSH:-0}"
PLATFORMS="${PLATFORMS:-}"

ALL="inicio lista-compra todo calendario gastos menu perfil grupos \
lista-compra-api todo-api calendario-api gastos-api menu-api asistente-api hub-mcp"
APPS="${*:-$ALL}"

for app in $APPS; do
  if [ ! -f "$app/Dockerfile" ]; then
    echo "No existe $app/Dockerfile" >&2
    exit 1
  fi
  image="$REGISTRY/$app:$TAG"
  echo "==> $image"
  if [ -n "$PLATFORMS" ]; then
    docker buildx build --platform "$PLATFORMS" -t "$image" --push "$app"
  else
    docker build -t "$image" "$app"
    if [ "$PUSH" = "1" ]; then
      docker push "$image"
    fi
  fi
done

echo "Listo: $(echo "$APPS" | wc -w) imagen(es) con prefijo $REGISTRY y etiqueta $TAG."
