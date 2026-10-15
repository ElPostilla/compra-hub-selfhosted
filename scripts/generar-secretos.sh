#!/bin/sh
# Rellena con valores aleatorios los secretos que esten VACIOS en un fichero
# de configuracion. No toca los que ya tengan valor, asi que se puede
# ejecutar varias veces sin romper una instalacion en marcha.
#
#   sh scripts/generar-secretos.sh            # .env (Docker Compose), lo crea desde .env.example
#   sh scripts/generar-secretos.sh k8s        # deploy/k8s/secrets.env, lo crea desde secrets.env.example
#
# Necesita openssl. Para las claves VAPID (avisos push) usa Docker con la
# imagen node:20-alpine; si no hay Docker, deja esas dos vacias.
set -eu
cd "$(dirname "$0")/.."

case "${1:-env}" in
  env) file=.env; example=.env.example ;;
  k8s) file=deploy/k8s/secrets.env; example=deploy/k8s/secrets.env.example ;;
  *) echo "uso: $0 [env|k8s]" >&2; exit 1 ;;
esac

[ -f "$file" ] || cp "$example" "$file"
chmod 600 "$file"

# set_if_empty CLAVE VALOR: escribe CLAVE=VALOR solo si la clave esta vacia.
set_if_empty() {
  if grep -q "^$1=$" "$file"; then
    # "|" como separador: los valores en base64 pueden llevar "/".
    sed -i.bak "s|^$1=$|$1=$2|" "$file" && rm -f "$file.bak"
    echo "  $1 generado"
  fi
}

rand() { openssl rand -hex 24; }

echo "Secretos en $file:"
for key in POSTGRES_PASSWORD LISTA_COMPRA_DB_PASSWORD CALENDARIO_DB_PASSWORD TODO_DB_PASSWORD \
  GASTOS_DB_PASSWORD MENU_DB_PASSWORD KEYCLOAK_DB_PASSWORD KEYCLOAK_ADMIN_PASSWORD \
  OAUTH2_PROXY_CLIENT_SECRET; do
  set_if_empty "$key" "$(rand)"
done
# oauth2-proxy exige 16, 24 o 32 bytes: 32 bytes en base64 "url-safe".
set_if_empty OAUTH2_PROXY_COOKIE_SECRET "$(openssl rand -base64 32 | tr -- '+/' '-_')"

if grep -q "^VAPID_PUBLIC_KEY=$" "$file"; then
  if command -v docker >/dev/null 2>&1; then
    keys=$(docker run --rm node:20-alpine sh -c \
      'cd /tmp && npm install --silent --no-audit --no-fund web-push >/dev/null 2>&1 && node -e "const k=require(\"web-push\").generateVAPIDKeys();console.log(k.publicKey+\" \"+k.privateKey)"')
    set_if_empty VAPID_PUBLIC_KEY "${keys% *}"
    set_if_empty VAPID_PRIVATE_KEY "${keys#* }"
  else
    echo "  (sin Docker: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY quedan vacias, el hub funciona sin avisos push)"
  fi
fi

echo "Listo. Revisa $file (dominio, email...) antes de arrancar."
