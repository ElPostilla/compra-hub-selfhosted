// Ultima receta de cada usuario (plato + ingredientes), en memoria.
//
// receta_anadir mete los ingredientes en la compra y pregunta en que
// comida va el plato; la respuesta llega en el SIGUIENTE mensaje, y el chat
// solo guarda texto: el modelo ya no ve la lista de ingredientes para
// pasarsela a menu_planificar. Por eso se recuerdan aqui un rato y
// menu_planificar los recupera si el plato coincide.
//
// hub-mcp corre con una sola replica; si el pod se reinicia se pierde y el
// plato se guarda sin ingredientes (se pueden poner a mano en el menu).
const { normalize } = require("./util");

const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_USERS = 500;

function createRecipeMemory({ ttlMs = TTL_MS, now = () => Date.now() } = {}) {
  const byUser = new Map();
  return {
    remember(userId, plato, ingredientes) {
      if (!userId) return;
      byUser.delete(userId);
      byUser.set(userId, { plato, ingredientes, at: now() });
      if (byUser.size > MAX_USERS) byUser.delete(byUser.keys().next().value);
    },
    // Ingredientes de la ultima receta si el plato coincide («lasaña» vale
    // para «Lasaña de carne» y al reves).
    recall(userId, plato) {
      const r = userId && byUser.get(userId);
      if (!r || now() - r.at > ttlMs) return null;
      const a = normalize(r.plato);
      const b = normalize(plato);
      if (!a || !b) return null;
      return a.includes(b) || b.includes(a) ? r.ingredientes : null;
    },
  };
}

module.exports = { createRecipeMemory, shared: createRecipeMemory() };
