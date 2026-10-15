const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

// Mismo criterio que auth.js de las demas APIs del hub: se verifica la
// firma contra el JWKS del realm aunque luego cada API vuelva a verificar
// el token por su cuenta. Aqui hace falta por dos motivos: rechazar pronto
// (401) a quien no traiga sesion, y sacar el "sub"/username para las
// respuestas, sin credenciales de administrador de Keycloak.
//
// A diferencia de las APIs, el token NO llega en X-Auth-Request-Access-Token
// (eso lo pone oauth2-proxy via Traefik): llega como "Authorization: Bearer"
// desde Open WebUI (conexion MCP con auth "system_oauth", que reenvia el
// access token de Keycloak de la persona que chatea, refrescado por Open
// WebUI) o desde jarvis-api en la fase 2.
// OIDC_ISSUER: URL publica del realm, tal cual aparece en el campo "iss"
// de los tokens (p.ej. https://hub.example.com/auth/realms/compras).
// OIDC_JWKS_URI (opcional): de donde descargar las claves publicas del
// realm. Por defecto <issuer>/protocol/openid-connect/certs; en Docker o
// Kubernetes conviene apuntarlo al Keycloak interno (http://keycloak:8080/...)
// para no salir a internet ni depender del certificado TLS publico.
const ISSUER = process.env.OIDC_ISSUER;
if (!ISSUER) console.error("auth: falta OIDC_ISSUER (URL del realm de Keycloak): se rechazaran todas las peticiones.");
const JWKS_URI = process.env.OIDC_JWKS_URI || `${ISSUER}/protocol/openid-connect/certs`;
// Debe coincidir con OIDC_AUDIENCES de las APIs: un token que este servicio
// acepte pero las APIs rechacen solo produciria errores 401 mas confusos.
const ACCEPTED_AUDIENCES = (process.env.OIDC_AUDIENCES || "compras,account").split(",");

const client = jwksClient({ jwksUri: JWKS_URI, cache: true, cacheMaxAge: 10 * 60 * 1000 });

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

function verifyToken(token) {
  return new Promise((resolve, reject) => {
    if (!ISSUER) return reject(new Error("OIDC_ISSUER sin configurar"));
    jwt.verify(token, getKey, { issuer: ISSUER, algorithms: ["RS256"] }, (err, decoded) => {
      if (err) return reject(err);
      const aud = Array.isArray(decoded.aud) ? decoded.aud : [decoded.aud];
      if (!aud.some((a) => ACCEPTED_AUDIENCES.includes(a))) {
        return reject(new Error(`audiencia no reconocida: ${aud.join(",")}`));
      }
      resolve(decoded);
    });
  });
}

function bearerToken(req) {
  const header = req.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function requireAuth(req, res, next) {
  const token = bearerToken(req);
  if (!token) return res.status(401).json({ error: "No autenticado." });

  try {
    const claims = await verifyToken(token);
    if (!claims.sub || !claims.preferred_username) {
      return res.status(401).json({ error: "Token sin los datos minimos de usuario." });
    }
    req.token = token;
    req.user = { id: claims.sub, username: claims.preferred_username };
    next();
  } catch (err) {
    console.error("auth: token invalido:", err.message);
    res.status(401).json({ error: "Sesion invalida." });
  }
}

module.exports = { requireAuth };
