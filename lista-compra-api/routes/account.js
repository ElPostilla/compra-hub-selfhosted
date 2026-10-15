// Derechos RGPD sobre los datos que guarda lista-compra-api (usuario,
// amigos, grupos, listas, actividad y avisos push): GET /export = acceso y
// portabilidad (arts. 15 y 20), DELETE / = supresion (art. 17).
//
// La app Perfil llama primero al DELETE de las demas APIs (necesitan saber
// aun en que grupos esta la persona) y por ultimo a este, que borra el
// usuario. Despues la cuenta de Keycloak se borra con kc_action=delete_account.
const express = require("express");
const { pool } = require("../db");
const { asyncHandler } = require("../asyncHandler");

const router = express.Router();

router.get("/export", asyncHandler(async (req, res) => {
  const id = req.user.id;
  const q = (sql) => pool.query(sql, [id]).then((r) => r.rows);
  const [user, friends, groups, personalLists, groupItems, activity, push, invites] = await Promise.all([
    q("SELECT id, username, email, first_name, last_name, updated_at FROM users WHERE id = $1"),
    q(`SELECT u.username AS amigo, f.status AS estado, f.created_at, f.responded_at
       FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
       WHERE f.requester_id = $1 OR f.addressee_id = $1`),
    q(`SELECT g.name AS grupo, gm.role AS rol, gm.joined_at
       FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = $1`),
    q(`SELECT pl.name AS lista, pl.created_at,
              COALESCE(json_agg(json_build_object('producto', i.name, 'cantidad', i.qty, 'categoria', i.category,
                        'comprado', i.done, 'fijo', i.recurring) ORDER BY i.position) FILTER (WHERE i.id IS NOT NULL), '[]') AS productos
       FROM personal_lists pl LEFT JOIN personal_list_items i ON i.list_id = pl.id
       WHERE pl.user_id = $1 GROUP BY pl.id ORDER BY pl.position`),
    q(`SELECT g.name AS grupo, i.name AS producto, i.qty AS cantidad, i.done AS comprado, i.updated_at
       FROM list_items i JOIN lists l ON l.id = i.list_id JOIN groups g ON g.id = l.group_id
       WHERE i.created_by = $1`),
    q("SELECT message AS mensaje, created_at FROM group_activity WHERE actor_id = $1 ORDER BY created_at"),
    q("SELECT created_at FROM push_subscriptions WHERE user_id = $1"),
    q(`SELECT g.name AS grupo, gi.created_at, gi.expires_at AS caduca
       FROM group_invites gi JOIN groups g ON g.id = gi.group_id WHERE gi.created_by = $1`),
  ]);
  res.json({
    cuenta: user[0] || null,
    amigos: friends,
    grupos: groups,
    listasPersonales: personalLists,
    productosAnadidosEnGrupos: groupItems,
    actividadEnGrupos: activity,
    dispositivosConAvisos: push.length,
    enlacesDeInvitacion: invites,
  });
}));

router.delete("/", asyncHandler(async (req, res) => {
  const id = req.user.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Grupos de los que es dueño: la propiedad pasa al miembro mas antiguo;
    // si no queda nadie, el grupo se borra (y con el su lista y actividad).
    const owned = await client.query("SELECT id FROM groups WHERE owner_id = $1", [id]);
    for (const { id: groupId } of owned.rows) {
      const next = await client.query(
        "SELECT user_id FROM group_members WHERE group_id = $1 AND user_id <> $2 ORDER BY joined_at LIMIT 1",
        [groupId, id]
      );
      if (next.rows.length) {
        const heir = next.rows[0].user_id;
        await client.query("UPDATE groups SET owner_id = $1 WHERE id = $2", [heir, groupId]);
        await client.query("UPDATE group_members SET role = 'owner' WHERE group_id = $1 AND user_id = $2", [groupId, heir]);
      } else {
        await client.query("DELETE FROM groups WHERE id = $1", [groupId]);
      }
    }
    // En el historial de los grupos que siguen, sin nombre.
    await client.query(
      "UPDATE group_activity SET actor_id = NULL, actor_username = 'Usuario eliminado' WHERE actor_id = $1",
      [id]
    );
    await client.query("DELETE FROM push_subscriptions WHERE user_id = $1", [id]);
    // En cascada: amistades, membresias y listas personales; los productos
    // que añadio a listas de grupo se quedan sin autor (ON DELETE SET NULL).
    await client.query("DELETE FROM users WHERE id = $1", [id]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  res.json({ ok: true });
}));

module.exports = router;
