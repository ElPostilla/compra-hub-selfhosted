// Secciones de una lista (ver la migracion en db.js). Comun a las listas
// personales y a las de grupo: mismo formato, mismas reglas.

const MAX_SECTIONS = 20;

function cleanSection(value) {
  return String(value ?? "").trim().slice(0, 40);
}

// Lista nueva de secciones: sin vacias ni repetidas (sin distinguir
// mayusculas), como mucho MAX_SECTIONS. null si no es un array.
function cleanSections(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of value) {
    const name = cleanSection(raw);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= MAX_SECTIONS) break;
  }
  return out;
}

// Guarda las secciones de una lista y deja los productos coherentes:
//  - rename {from, to}: los productos de «from» pasan a «to» (renombrar no
//    los saca de su seccion);
//  - los productos de una seccion que ya no existe quedan sin seccion.
// table/itemTable: "lists"/"list_items" o "personal_lists"/"personal_list_items".
// Se llama dentro de una transaccion (client).
async function saveSections(client, { table, itemTable, listId, sections, rename }) {
  await client.query(`UPDATE ${table} SET sections = $2 WHERE id = $1`, [listId, sections]);
  const from = cleanSection(rename?.from);
  const to = cleanSection(rename?.to);
  if (from && to && from !== to) {
    await client.query(
      `UPDATE ${itemTable} SET section = $3, updated_at = now() WHERE list_id = $1 AND section = $2`,
      [listId, from, to]
    );
  }
  await client.query(
    `UPDATE ${itemTable} SET section = '', updated_at = now()
     WHERE list_id = $1 AND section <> '' AND NOT (section = ANY($2::text[]))`,
    [listId, sections]
  );
}

// Seccion de un producto que se añade o se cambia: se busca entre las de
// la lista sin distinguir mayusculas (devuelve el nombre tal como esta
// guardado) y, si no existe, se crea al final -- asi «añade leche a Aldi»
// (asistente, Home Assistant) funciona sin haber creado antes la seccion.
// '' = sin seccion; undefined/null = no se toca (devuelve null).
async function resolveSection(client, table, listId, value) {
  if (value == null) return null;
  const name = cleanSection(value);
  if (!name) return "";
  const r = await client.query(`SELECT sections FROM ${table} WHERE id = $1`, [listId]);
  const sections = r.rows[0]?.sections || [];
  const found = sections.find((s) => s.toLowerCase() === name.toLowerCase());
  if (found) return found;
  if (sections.length >= MAX_SECTIONS) return "";
  await client.query(`UPDATE ${table} SET sections = array_append(sections, $2) WHERE id = $1`, [listId, name]);
  return name;
}

module.exports = { resolveSection, cleanSection, cleanSections, saveSections, MAX_SECTIONS };
