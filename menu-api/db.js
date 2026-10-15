const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: process.env.PGPORT || 5432,
  database: process.env.PGDATABASE || "menu",
  user: process.env.PGUSER || "menu",
  password: process.env.PGPASSWORD,
});

// "date" como texto YYYY-MM-DD, mismo motivo que en calendario-api/db.js.
// Solo 2 franjas por dia (comida/cena): lo simple cubre el uso real de
// planificar la semana, sin necesitar un desayuno/merienda/etc.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS meals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL,
      date TEXT NOT NULL CHECK (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
      slot TEXT NOT NULL CHECK (slot IN ('comida', 'cena')),
      title TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (user_id, date, slot)
    );
    CREATE INDEX IF NOT EXISTS meals_user_date_idx ON meals (user_id, date);

    CREATE TABLE IF NOT EXISTS group_meals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID NOT NULL,
      date TEXT NOT NULL CHECK (date ~ '^\\d{4}-\\d{2}-\\d{2}$'),
      slot TEXT NOT NULL CHECK (slot IN ('comida', 'cena')),
      title TEXT NOT NULL,
      created_by UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (group_id, date, slot)
    );
    CREATE INDEX IF NOT EXISTS group_meals_group_date_idx ON group_meals (group_id, date);
  `);

  // Ingredientes por plato, para poder mandarlos de una a la lista de la
  // compra (ver /lista/?add=... en lista-compra) sin tener que escribirlos
  // otra vez a mano. Opcional: un plato puede no tener ingredientes.
  await pool.query(`
    ALTER TABLE meals ADD COLUMN IF NOT EXISTS ingredients TEXT[] NOT NULL DEFAULT '{}';
    ALTER TABLE group_meals ADD COLUMN IF NOT EXISTS ingredients TEXT[] NOT NULL DEFAULT '{}';
  `);
}

module.exports = { pool, migrate };
