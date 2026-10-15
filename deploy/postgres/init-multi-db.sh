#!/bin/sh
# Crea una base de datos y un usuario propio para cada API del hub (y para
# Keycloak) dentro de la misma instancia de Postgres. La imagen oficial de
# postgres solo ejecuta los scripts de /docker-entrypoint-initdb.d/ cuando
# el volumen de datos esta VACIO: si cambias contraseñas despues, cambialas
# tambien a mano con ALTER USER.
#
# Postgres concede CONNECT a PUBLIC en toda base nueva: se revoca para que
# cada usuario solo pueda entrar en la suya.
set -e

create_db() {
  name="$1"
  password="$2"
  if [ -z "$password" ]; then
    echo "init-multi-db: falta la contraseña de $name" >&2
    exit 1
  fi
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    CREATE USER "$name" WITH PASSWORD '$password';
    CREATE DATABASE "$name" OWNER "$name";
    REVOKE CONNECT ON DATABASE "$name" FROM PUBLIC;
EOSQL
}

create_db lista_compra "$LISTA_COMPRA_DB_PASSWORD"
create_db calendario "$CALENDARIO_DB_PASSWORD"
create_db todo "$TODO_DB_PASSWORD"
create_db gastos "$GASTOS_DB_PASSWORD"
create_db menu "$MENU_DB_PASSWORD"
if [ -n "${KEYCLOAK_DB_PASSWORD:-}" ]; then
  create_db keycloak "$KEYCLOAK_DB_PASSWORD"
fi
