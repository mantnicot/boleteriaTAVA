const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./paths');

const ALLOWED_FILE = path.join(DATA_DIR, 'allowed-emails.json');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function parseEnvAllowedEmails() {
  const raw = process.env.APP_LOGIN_ALLOWED_EMAILS || '';
  const set = new Set(
    raw
      .split(',')
      .map((s) => normalizeEmail(s))
      .filter(Boolean)
  );
  return set;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readManagedEmailsSet() {
  try {
    if (!fs.existsSync(ALLOWED_FILE)) return new Set();
    const parsed = JSON.parse(fs.readFileSync(ALLOWED_FILE, 'utf8'));
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map((s) => normalizeEmail(s)).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writeManagedEmailsSet(set) {
  ensureDataDir();
  const list = Array.from(set).sort((a, b) => a.localeCompare(b));
  fs.writeFileSync(ALLOWED_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function listAllowedEmailsDetailed() {
  const envSet = parseEnvAllowedEmails();
  const managedSet = readManagedEmailsSet();

  const merged = [];
  envSet.forEach((email) => merged.push({ email, source: 'env' }));
  managedSet.forEach((email) => {
    if (!envSet.has(email)) merged.push({ email, source: 'managed' });
  });

  merged.sort((a, b) => a.email.localeCompare(b.email));
  return merged;
}

function isAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;
  const allowed = listAllowedEmailsDetailed();
  if (allowed.length === 0) return true;
  return allowed.some((x) => x.email === normalized);
}

function addManagedAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('Correo inválido.');
  const current = readManagedEmailsSet();
  current.add(normalized);
  writeManagedEmailsSet(current);
  return listAllowedEmailsDetailed();
}

function removeManagedAllowedEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('Correo inválido.');

  const envSet = parseEnvAllowedEmails();
  if (envSet.has(normalized)) {
    const err = new Error('Este correo viene de APP_LOGIN_ALLOWED_EMAILS y no se puede borrar aquí.');
    err.code = 'ENV_EMAIL';
    throw err;
  }

  const current = readManagedEmailsSet();
  current.delete(normalized);
  writeManagedEmailsSet(current);
  return listAllowedEmailsDetailed();
}

module.exports = {
  normalizeEmail,
  listAllowedEmailsDetailed,
  isAllowedEmail,
  addManagedAllowedEmail,
  removeManagedAllowedEmail,
};
