const crypto = require('crypto');

function getSecret() {
  return (
    process.env.VERIFICACION_QR_SECRET ||
    process.env.APP_SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    'tava-dev-secret-change-me'
  );
}

/**
 * Token opaco para QR (estático por boleta). Incluye eventId + codigo para validar
 * coherencia con el evento seleccionado en la vista de verificación.
 */
function createVerificacionToken(eventId, codigoBoleta) {
  const body = JSON.stringify({
    e: String(eventId),
    c: String(codigoBoleta).trim(),
  });
  const b64 = Buffer.from(body, 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function parseVerificacionToken(token) {
  const t = String(token || '').trim();
  const [b64, sig] = t.split('.');
  if (!b64 || !sig) return null;
  const exp = crypto.createHmac('sha256', getSecret()).update(b64).digest('base64url');
  if (sig.length !== exp.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(exp))) return null;
  try {
    const o = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!o || !o.e || o.c == null) return null;
    return { eventId: String(o.e), codigoBoleta: String(o.c).trim() };
  } catch {
    return null;
  }
}

function buildVerificacionScanUrl(baseUrl, eventId, codigoBoleta) {
  const base = String(baseUrl || '')
    .trim()
    .replace(/\/$/, '');
  const tok = createVerificacionToken(eventId, codigoBoleta);
  return `${base}/index.html#verificacion?qr=${encodeURIComponent(tok)}`;
}

module.exports = {
  createVerificacionToken,
  parseVerificacionToken,
  buildVerificacionScanUrl,
};
