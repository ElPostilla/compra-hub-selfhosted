const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");

// El middleware keycloak-auth de Traefik ya bloquea toda peticion sin
// sesion antes de que llegue aqui (ver lista-compra/oauth/middle.yaml), que
// reenvia el access token de Keycloak como header X-Auth-Request-Access-Token
// (oauth2-proxy en modo forwardAuth de "upstream estatico" nunca rellena
// "Authorization"). Aun asi este servicio verifica la firma el mismo
// contra el JWKS del realm: es la unica forma de sacar el "sub" (id
// estable de Keycloak) sin darle a esta API credenciales de administrador
// de Keycloak.
// OIDC_ISSUER: URL publica del realm, tal cual aparece en el campo "iss"
// de los tokens (p.ej. https://hub.example.com/auth/realms/compras).
// OIDC_JWKS_URI (opcional): de donde descargar las claves publicas del
// realm. Por defecto <issuer>/protocol/openid-connect/certs; en Docker o
// Kubernetes conviene apuntarlo al Keycloak interno (http://keycloak:8080/...)
// para no salir a internet ni depender del certificado TLS publico.
const ISSUER = process.env.OIDC_ISSUER;
if (!ISSUER) console.error("auth: falta OIDC_ISSUER (URL del realm de Keycloak): se rechazaran todas las peticiones.");
const JWKS_URI = process.env.OIDC_JWKS_URI || `${ISSUER}/protocol/openid-connect/certs`;
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

async function requireAuth(req, res, next) {
  const token = req.get("x-auth-request-access-token") || null;
  if (!token) return res.status(401).json({ error: "No autenticado." });

  try {
    const claims = await verifyToken(token);
    if (!claims.sub || !claims.preferred_username) {
      return res.status(401).json({ error: "Token sin los datos minimos de usuario." });
    }
    req.user = {
      id: claims.sub,
      username: claims.preferred_username,
      email: claims.email || null,
      firstName: claims.given_name || null,
      lastName: claims.family_name || null,
    };
    next();
  } catch (err) {
    console.error("auth: token invalido:", err.message);
    res.status(401).json({ error: "Sesion invalida." });
  }
}

module.exports = { requireAuth, verifyToken };
