const express = require("express");
const { pool, upsertUser } = require("../db");
const { asyncHandler } = require("../asyncHandler");
const { logActivity } = require("./groups");

// Lado de quien recibe un enlace de invitacion (/grupos/?invitacion=<token>,
// ver groups-card.component.ts en grupos). El creador del grupo lo genera en
// POST /api/groups/:id/invite. Con sesion iniciada, igual que el resto: la
// persona invitada se registra (o entra) primero y oauth2-proxy la devuelve
// al enlace con el token intacto.
const router = express.Router();

// El token es aleatorio (18 bytes, base64url); cualquier otra cosa ni se
// consulta.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

async function findInvite(token) {
  if (!TOKEN_RE.test(token)) return null;
  const r = await pool.query(
    `SELECT gi.group_id, gi.created_by, g.name AS group_name,
            u.username AS inviter_username, u.first_name AS inviter_first_name,
            (SELECT count(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
     FROM group_invites gi
     JOIN groups g ON g.id = gi.group_id
     JOIN users u ON u.id = gi.created_by
     WHERE gi.token = $1 AND gi.expires_at > now()`,
    [token]
  );
  return r.rows[0] || null;
}

const GONE = { error: "Este enlace de invitación no existe o ha caducado. Pide uno nuevo a quien te lo envió." };

router.get("/:token", asyncHandler(async (req, res) => {
  await upsertUser(req.user);
  const invite = await findInvite(req.params.token);
  if (!invite) return res.status(404).json(GONE);
  const member = await pool.query("SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2", [
    invite.group_id,
    req.user.id,
  ]);
  res.json({
    groupId: invite.group_id,
    groupName: invite.group_name,
    inviterUsername: invite.inviter_username,
    inviterFirstName: invite.inviter_first_name,
    memberCount: Number(invite.member_count),
    alreadyMember: member.rowCount > 0,
  });
}));

router.post("/:token/accept", asyncHandler(async (req, res) => {
  await upsertUser(req.user);
  const invite = await findInvite(req.params.token);
  if (!invite) return res.status(404).json(GONE);

  const inserted = await pool.query(
    "INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
    [invite.group_id, req.user.id]
  );
  if (inserted.rowCount === 0) return res.json({ groupId: invite.group_id, alreadyMember: true });

  // logActivity avisa por push al resto de miembros, creador incluido
  // (siempre es miembro: si se va, el grupo se borra con su enlace).
  await logActivity(invite.group_id, req.user, "se ha unido al grupo con el enlace de invitación");
  res.status(201).json({ groupId: invite.group_id, alreadyMember: false });
}));

module.exports = router;
