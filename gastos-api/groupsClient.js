// "Grupos" y "amigos" son un concepto de todo el hub, no solo de la lista
// de la compra: viven en la base de datos de lista-compra-api. gastos-api
// no tiene copia propia de grupos/amigos: reenvia el mismo access token
// que ya trae cada peticion (ver auth.js) a la llamada interna.
const GROUPS_API = process.env.GROUPS_API_URL || "http://lista-compra-api:3000";

function tokenFromRequest(req) {
  return req.get("x-auth-request-access-token") || null;
}

async function fetchMyGroups(token) {
  const res = await fetch(`${GROUPS_API}/api/groups`, {
    headers: { "x-auth-request-access-token": token },
  });
  if (!res.ok) throw new Error(`lista-compra-api respondio ${res.status} al pedir grupos`);
  const data = await res.json();
  return data.groups;
}

async function isGroupMember(token, groupId) {
  const groups = await fetchMyGroups(token);
  return groups.some((g) => g.id === groupId);
}

// Hace falta la lista de miembros (no solo saber si eres uno) para
// repartir un gasto nuevo a partes iguales -- ver splitEqually en
// routes/groups.js.
async function fetchGroupMembers(token, groupId) {
  const res = await fetch(`${GROUPS_API}/api/groups/${groupId}/members`, {
    headers: { "x-auth-request-access-token": token },
  });
  if (!res.ok) throw new Error(`lista-compra-api respondio ${res.status} al pedir miembros`);
  const data = await res.json();
  return data.members;
}

// Deja constancia en el feed de actividad del grupo (tabla comun en
// lista-compra-api, ver db.js alli). Nunca debe tumbar la peticion
// original si falla -- quien llama debe envolverla en try/catch o
// .catch() y seguir adelante.
async function postActivity(token, groupId, message) {
  const res = await fetch(`${GROUPS_API}/api/groups/${groupId}/activity`, {
    method: "POST",
    headers: { "x-auth-request-access-token": token, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`lista-compra-api respondio ${res.status} al registrar actividad`);
}

module.exports = { tokenFromRequest, fetchMyGroups, isGroupMember, fetchGroupMembers, postActivity };
