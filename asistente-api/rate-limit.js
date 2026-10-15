// Limite de mensajes por persona (ventana deslizante en memoria: una sola
// replica, igual que el resto de APIs del hub).
function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map(); // userId -> [timestamps]
  return {
    allow(userId) {
      const t = now();
      const recent = (hits.get(userId) || []).filter((x) => t - x < windowMs);
      if (recent.length >= max) {
        hits.set(userId, recent);
        return false;
      }
      recent.push(t);
      hits.set(userId, recent);
      return true;
    },
  };
}

module.exports = { createRateLimiter };
