/**
 * Autenticación Google — OAuth 2.0 con tu cuenta personal (@gmail.com)
 * --------------------------------------------------------------------
 * No usa cuenta de servicio. Los tokens se guardan en data/google-oauth-tokens.json
 * tras iniciar sesión una vez en /auth/google.
 *
 * Variables en .env (ver .env.example):
 *   GOOGLE_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET
 *   GOOGLE_REDIRECT_URI  (ej. http://localhost:3000/oauth2callback)
 *
 * En Google Cloud Console: APIs habilitadas (Sheets + Drive), pantalla de consentimiento,
 * credenciales tipo "Aplicación web" con URI de redirección autorizada igual a GOOGLE_REDIRECT_URI.
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const { DATA_DIR } = require('./paths');

const TOKEN_FILE = path.join(DATA_DIR, 'google-oauth-tokens.json');
let memoryTokens = null;

/** Permisos: tu hoja en Sheets + archivos en tu Drive personal (carpeta TAVA). */
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive',
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getRedirectUri() {
  const port = process.env.PORT || 3000;
  return (
    process.env.GOOGLE_REDIRECT_URI?.trim() ||
    `http://localhost:${port}/oauth2callback`
  );
}

function createOAuth2Client() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!id || !secret) {
    throw new Error(
      'Configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env (credenciales OAuth de Google Cloud, tipo "Aplicación web").'
    );
  }
  return new google.auth.OAuth2(id, secret, getRedirectUri());
}

function loadTokens() {
  if (memoryTokens) return memoryTokens;
  try {
    const { getRequestGoogleTokens } = require('./authContext');
    const c = getRequestGoogleTokens();
    if (c && (c.refresh_token || c.access_token)) return c;
  } catch (_) {
    /* authContext no disponible o fuera de petición con contexto */
  }
  const envTokens = process.env.GOOGLE_OAUTH_TOKENS_JSON;
  if (envTokens) {
    try {
      const parsed = JSON.parse(envTokens);
      memoryTokens = parsed;
      return parsed;
    } catch (_) {}
  }
  try {
    if (!fs.existsSync(TOKEN_FILE)) return null;
    const raw = fs.readFileSync(TOKEN_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    memoryTokens = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  memoryTokens = tokens;
  if (process.env.GOOGLE_OAUTH_TOKENS_JSON) return;
  try {
    ensureDataDir();
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), 'utf8');
  } catch (_) {}
}

/** Al cerrar sesión de la app: la próxima vez hay que volver a vincular Google (tokens locales). */
function clearOAuthTokens() {
  memoryTokens = null;
  if (process.env.GOOGLE_OAUTH_TOKENS_JSON) return;
  try {
    if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
  } catch (_) {}
}

/**
 * URL para abrir en el navegador y vincular tu cuenta de Gmail (solo la primera vez o si revocas acceso).
 */
function getAuthorizationUrl() {
  const o = createOAuth2Client();
  const tokens = loadTokens();
  const opts = {
    access_type: 'offline',
    scope: SCOPES,
    include_granted_scopes: true,
  };
  /** Forzar consentimiento solo si no hay refresh_token (evita doble pantalla de Google en cada uso). */
  if (!tokens || !tokens.refresh_token) {
    opts.prompt = 'consent';
  }
  return o.generateAuthUrl(opts);
}

/**
 * Intercambia el ?code= de Google por tokens y los guarda en disco.
 */
async function saveTokensFromCode(code) {
  const o = createOAuth2Client();
  const { tokens } = await o.getToken(code);
  o.setCredentials(tokens);
  saveTokens(tokens);
  return tokens;
}

/**
 * Cliente OAuth listo para llamadas a Sheets/Drive. Lanza error con code OAUTH_REQUIRED si falta vincular.
 */
async function getOAuth2ClientReady() {
  const tokens = loadTokens();
  if (!tokens || (!tokens.refresh_token && !tokens.access_token)) {
    const err = new Error(
      'Cuenta de Google no vinculada o inválida. Vuelve a entrar con tu correo en «Entrar al escenario» para vincular Google en este equipo.'
    );
    err.code = 'OAUTH_REQUIRED';
    throw err;
  }
  const o = createOAuth2Client();
  o.setCredentials(tokens);
  o.on('tokens', (t) => {
    if (t.refresh_token || t.access_token) {
      const merged = { ...tokens, ...t };
      saveTokens(merged);
    }
  });
  return o;
}

async function getSheetsClient() {
  const auth = await getOAuth2ClientReady();
  return google.sheets({ version: 'v4', auth });
}

async function getDriveClient() {
  const auth = await getOAuth2ClientReady();
  return google.drive({ version: 'v3', auth });
}

/**
 * Compatibilidad con sheets.js (createSpreadsheet usa getAuth().getClient()).
 */
function getAuth() {
  return {
    getClient: () => getOAuth2ClientReady(),
  };
}

function hasOAuthTokens() {
  const t = loadTokens();
  return Boolean(t && (t.refresh_token || t.access_token));
}

/**
 * Comprueba que los tokens permiten obtener un access_token válido (refresh real contra Google).
 * Si los tokens están revocados o no corresponden a este cliente, devuelve false y borra el archivo local.
 */
async function verifyGoogleOAuthWorks() {
  try {
    const auth = await getOAuth2ClientReady();
    const t = await auth.getAccessToken();
    return Boolean(t && t.token);
  } catch (e) {
    const msg = String(e?.message || e || '').toLowerCase();
    const shouldClearFile =
      !process.env.GOOGLE_OAUTH_TOKENS_JSON &&
      (msg.includes('invalid_grant') ||
        msg.includes('invalid_client') ||
        msg.includes('unauthorized_client') ||
        msg.includes('token has been expired or revoked'));
    if (shouldClearFile) clearOAuthTokens();
    return false;
  }
}

module.exports = {
  getAuthorizationUrl,
  saveTokensFromCode,
  getOAuth2ClientReady,
  getSheetsClient,
  getDriveClient,
  getAuth,
  hasOAuthTokens,
  verifyGoogleOAuthWorks,
  getRedirectUri,
  clearOAuthTokens,
  SCOPES,
};
