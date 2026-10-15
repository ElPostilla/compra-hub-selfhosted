const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || "lista_compra",
  user: process.env.PGUSER || "lista_compra",
  password: process.env.PGPASSWORD,
});

// Se ejecuta al arrancar el proceso. Todo con IF NOT EXISTS: no hay
// herramienta de migraciones, este es un esquema pequeño que solo crece
// por columnas/tablas nuevas, nunca se reescribe en sitio.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      email TEXT,
      first_name TEXT,
      last_name TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS friendships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      responded_at TIMESTAMPTZ,
      CHECK (requester_id <> addressee_id)
    );

    -- Una sola relacion por par de usuarios, sin importar quien la inicio.
    CREATE UNIQUE INDEX IF NOT EXISTS friendships_pair_idx
      ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

    CREATE TABLE IF NOT EXISTS groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT NOT NULL,
      owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS group_members (
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (group_id, user_id)
    );

    -- Una lista compartida por grupo (no listas multiples por grupo).
    CREATE TABLE IF NOT EXISTS lists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
      name TEXT NOT NULL DEFAULT 'Lista compartida'
    );

    CREATE TABLE IF NOT EXISTS list_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qty TEXT,
      category TEXT NOT NULL DEFAULT 'otros',
      done BOOLEAN NOT NULL DEFAULT false,
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS list_items_list_idx ON list_items (list_id);

    -- Listas personales: antes vivian solo en el localStorage del navegador
    -- (ni se veian desde otro dispositivo ni podia usarlas el asistente,
    -- hub-mcp). Mismas columnas que lists/list_items pero colgando del
    -- usuario en vez de un grupo. Ver routes/personal.js.
    CREATE TABLE IF NOT EXISTS personal_lists (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS personal_lists_user_idx ON personal_lists (user_id);

    CREATE TABLE IF NOT EXISTS personal_list_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      list_id UUID NOT NULL REFERENCES personal_lists(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      qty TEXT,
      category TEXT NOT NULL DEFAULT 'otros',
      done BOOLEAN NOT NULL DEFAULT false,
      recurring BOOLEAN NOT NULL DEFAULT false,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS personal_list_items_list_idx ON personal_list_items (list_id);

    -- Registro de actividad por grupo, comun a todo el hub: cualquier
    -- servicio (lista-compra-api, calendario-api, todo-api) puede añadir
    -- una linea via POST /api/groups/:id/activity (ver routes/groups.js),
    -- reenviando el mismo access token que ya trae la peticion original.
    -- "actor_username" va desnormalizado a proposito: evita un JOIN/lookup
    -- extra solo para pintar el feed, y sigue siendo legible aunque el
    -- usuario cambie de nombre mas adelante (foto fija del momento).
    CREATE TABLE IF NOT EXISTS group_activity (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
      actor_id UUID,
      actor_username TEXT,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS group_activity_group_idx ON group_activity (group_id, created_at DESC);

    -- Suscripciones Web Push por usuario. Un usuario puede tener varias
    -- (un movil, un portatil...) -- endpoint es unico por dispositivo/
    -- navegador, de ahi la PK sobre endpoint en vez de sobre user_id.
    -- Vive aqui (no en cada *-api) porque es el unico sitio que ya guarda
    -- identidad de usuario y sirve de "servidor" comun para toda push
    -- notification del hub (ver push.js: cualquier *-api puede pedir un
    -- envio via POST /api/groups/:id/push, reenviando el token de quien
    -- hizo la accion).
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      user_id UUID NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);
  `);

  await pool.query(`
    ALTER TABLE list_items ADD COLUMN IF NOT EXISTS recurring BOOLEAN NOT NULL DEFAULT false;
  `);

  // Primera vez que se ve a cada usuario (updated_at ya hace de "ultima
  // vez": upsertUser lo toca en cada visita). Para las metricas de
  // lanzamiento (docs/lanzamiento/kpis.md); las filas que ya existian se
  // quedan con la fecha de esta migracion.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
  `);

  // Secciones de una lista («Aldi», «Mercadona», «Para mamá»...): las
  // define cada cual, en el orden que quiera, y cada producto apunta a una
  // por nombre ('' = sin seccion). Se guardan en la lista y no se deducen
  // de los productos para que una seccion vacia no desaparezca al comprar
  // lo ultimo que tenia. Ver PUT .../sections en routes/personal.js y
  // routes/groups.js.
  await pool.query(`
    ALTER TABLE lists ADD COLUMN IF NOT EXISTS sections TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE personal_lists ADD COLUMN IF NOT EXISTS sections TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE list_items ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT '';
    ALTER TABLE personal_list_items ADD COLUMN IF NOT EXISTS section TEXT NOT NULL DEFAULT '';
  `);

  // Invitacion a un grupo por enlace (routes/invites.js): un solo enlace
  // activo por grupo (PK sobre group_id), regenerable y con caducidad.
  // Sirve para traer a la familia sin que antes tenga que ser "amiga" --
  // quien tiene el enlace lo ha recibido del creador del grupo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_invites (
      group_id UUID PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);
}

// Mantiene al dia la copia local minima de identidad (username/email/nombre)
// de cada usuario que llama a la API, a partir de los claims ya verificados
// del token de Keycloak. Es lo que permite buscar amigos por username sin
// darle a este servicio credenciales de administrador de Keycloak: solo
// conocemos a quien ya ha iniciado sesion aqui alguna vez.
async function upsertUser({ id, username, email, firstName, lastName }) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Si el username ya estaba asociado a OTRO id, esa fila es de una
    // cuenta de Keycloak que ya no existe con ese nombre (username es
    // unico en el realm) -- se libera antes de insertar/actualizar la
    // fila de la cuenta actual, si no el UNIQUE(username) revienta el
    // INSERT con "duplicate key" (visto en produccion tras borrar y
    // recrear un usuario de prueba con el mismo username).
    await client.query("DELETE FROM users WHERE username = $1 AND id <> $2", [username, id]);
    await client.query(
      `INSERT INTO users (id, username, email, first_name, last_name, updated_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE
         SET username = EXCLUDED.username,
             email = EXCLUDED.email,
             first_name = EXCLUDED.first_name,
             last_name = EXCLUDED.last_name,
             updated_at = now()`,
      [id, username, email, firstName, lastName]
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, migrate, upsertUser };
