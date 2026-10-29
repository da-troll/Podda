// HIVE-1526: verifies Podda Mobile's Authentik access token (provider podda-mobile-oidc), the
// same way clawdash/server/oidcVerify.js does. A token fault is { ok: false, unavailable: false }
// (401). JWKS unreachable or timing out is { unavailable: true } (503), so the phone never signs
// out over a network blip and keeps its refresh token.
const { createRemoteJWKSet, jwtVerify } = require('jose');

const ISSUER = process.env.PODDA_OIDC_ISSUER || 'https://auth.trollefsen.com/application/o/podda-mobile/';
const AUDIENCE = process.env.PODDA_OIDC_AUDIENCE || 'podda-mobile';
const UNAVAILABLE = new Set(['ERR_JWKS_TIMEOUT', 'ERR_JOSE_GENERIC']);
let remote = null;

// Resolves to { ok: true, sub } | { ok: false, unavailable }. `jwks` is for tests.
async function verifyBearer(token, { jwks } = {}) {
  if (!token || token.split('.').length !== 3) return { ok: false, unavailable: false };
  const keys = jwks || (remote ??= createRemoteJWKSet(new URL('jwks/', ISSUER)));
  try {
    const { payload } = await jwtVerify(token, keys, {
      issuer: ISSUER, audience: AUDIENCE, algorithms: ['RS256'], clockTolerance: 30, requiredClaims: ['exp', 'sub'],
    });
    return { ok: true, sub: payload.sub };
  } catch (e) {
    // jose's own ERR_* codes are token faults, except a JWKS timeout or a generic jose error;
    // anything else (fetch failed, DNS) means the auth server could not be asked.
    return { ok: false, unavailable: !(typeof e?.code === 'string' && e.code.startsWith('ERR_') && !UNAVAILABLE.has(e.code)) };
  }
}

module.exports = { verifyBearer, ISSUER, AUDIENCE };
