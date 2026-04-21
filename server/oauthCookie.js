const crypto = require('crypto');

const COOKIE = 'tava_goauth';

function getAesKey() {
  const secret = process.env.APP_SESSION_SECRET || process.env.GOOGLE_CLIENT_SECRET || 'tava-dev-secret-change-me';
  return crypto.createHash('sha256').update(secret, 'utf8').digest().subarray(0, 32);
}

function encryptGoogleTokensToCookie(tokens) {
  const key = getAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(tokens), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

function decryptGoogleTokensFromCookie(packed) {
  const buf = Buffer.from(String(packed).trim(), 'base64url');
  if (buf.length < 12 + 16 + 1) return null;
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const key = getAesKey();
  const dec = crypto.createDecipheriv('aes-256-gcm', key, iv);
  dec.setAuthTag(tag);
  const plain = Buffer.concat([dec.update(enc), dec.final()]);
  return JSON.parse(plain.toString('utf8'));
}

module.exports = {
  COOKIE_NAME_OAUTH: COOKIE,
  encryptGoogleTokensToCookie,
  decryptGoogleTokensFromCookie,
};
