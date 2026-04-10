/**
 * Resolución de imágenes de fondo para boletas (vista previa + PDF).
 * ------------------------------------------------------------------
 * - Valores nuevos: ID de archivo en Google Drive (subido con drive.uploadJpeg).
 * - Valores antiguos: archivos locales `fondo-xxxxx.jpg` en data/uploads/ (compatibilidad).
 *
 * Si cambias la lógica de almacenamiento, revisa también server/index.js (POST/PUT eventos)
 * y public/js/app.js (URL /api/media/...).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('./paths');

const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');

function ensureUploadDir() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
}

/** Patrón de nombres guardados en disco (migración / modo anterior). */
function isLocalFondoRef(ref) {
  if (!ref || typeof ref !== 'string') return false;
  const base = path.basename(ref.trim());
  return /^fondo-[a-f0-9]{24}\.jpe?g$/i.test(base);
}

function readLocalJpeg(fileName) {
  const base = path.basename(fileName);
  if (!isLocalFondoRef(base)) return null;
  const dest = path.join(UPLOAD_DIR, base);
  if (!fs.existsSync(dest)) return null;
  return fs.readFileSync(dest);
}

/**
 * Elimina fondo: local (nombre archivo) o Drive (fileId).
 * driveModule debe exponer deleteFile(fileId).
 */
async function deleteFondoRef(ref, driveModule) {
  if (!ref) return;
  if (isLocalFondoRef(ref)) {
    const dest = path.join(UPLOAD_DIR, path.basename(ref));
    try {
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
    } catch (e) {
      console.warn('delete local fondo:', e.message);
    }
    return;
  }
  if (driveModule && typeof driveModule.deleteFile === 'function') {
    await driveModule.deleteFile(ref);
  }
}

/**
 * Descarga bytes del fondo: primero archivo local legacy, luego Drive.
 * driveDownload: función (fileId) => Promise<Buffer>, ej. drive.downloadFile
 */
async function getFondoBuffer(ref, driveDownload) {
  if (!ref) return null;
  const s = String(ref).trim();
  if (isLocalFondoRef(s)) {
    const buf = readLocalJpeg(s);
    if (buf) return buf;
  }
  if (driveDownload && s.length > 8) {
    try {
      return await driveDownload(s);
    } catch (e) {
      console.warn('Drive fondo:', e.message);
    }
  }
  return null;
}

/**
 * Sube JPEG a Drive y devuelve fileId para guardar en la hoja Eventos.
 * Nombre único para evitar colisiones en la misma carpeta.
 */
async function saveFondoToDrive(uploadJpegFn, buffer) {
  const name = `fondo-${crypto.randomBytes(8).toString('hex')}-${Date.now()}.jpg`;
  return uploadJpegFn(buffer, name);
}

module.exports = {
  UPLOAD_DIR,
  readLocalJpeg,
  deleteFondoRef,
  getFondoBuffer,
  isLocalFondoRef,
  saveFondoToDrive,
};
