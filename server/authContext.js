const { AsyncLocalStorage } = require('async_hooks');
const { decryptGoogleTokensFromCookie, COOKIE_NAME_OAUTH } = require('./oauthCookie');

const als = new AsyncLocalStorage();

function parseCookieHeader(raw) {
  const out = {};
  String(raw || '')
    .split(';')
    .forEach((pair) => {
      const idx = pair.indexOf('=');
      if (idx <= 0) return;
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) out[k] = decodeURIComponent(v);
    });
  return out;
}

/**
 * Hace visibles los tokens de Google (cookie cifrada) a loadTokens() en esta petición
 * (imprescindible en Vercel: no hay disco persistente).
 */
function runWithGoogleOAuthFromRequest(request, fn) {
  const cookies = parseCookieHeader(request.headers.get('cookie') || '');
  const enc = cookies[COOKIE_NAME_OAUTH] || '';
  let googleTokens = null;
  if (enc) {
    try {
      const t = decryptGoogleTokensFromCookie(enc);
      if (t && (t.refresh_token || t.access_token)) googleTokens = t;
    } catch (e) {
      console.warn('Cookie OAuth inválida o expirada');
    }
  }
  return als.run({ googleTokens }, () => fn());
}

function getRequestGoogleTokens() {
  const s = als.getStore();
  return s?.googleTokens || null;
}

module.exports = {
  runWithGoogleOAuthFromRequest,
  getRequestGoogleTokens,
  COOKIE_NAME_OAUTH,
};
