/**
 * Google Drive — imágenes de fondo de boleta (OAuth, tu Drive personal)
 * ----------------------------------------------------------------------
 * Los archivos se crean en la carpeta indicada por GOOGLE_DRIVE_FOLDER_ID
 * o, si no está en .env, en la carpeta por defecto del proyecto TAVA.
 *
 * Edita GOOGLE_DRIVE_FOLDER_ID en .env para cambiar la carpeta (ID en la URL .../folders/ID).
 */

const { Readable } = require('stream');
const { getDriveClient } = require('./auth');

/** Carpeta por defecto (Drive personal) — la que indicaste */
const DEFAULT_DRIVE_FOLDER_ID = '1j8p6D1esaJ8iGUhzo20DsG1TcMvkzdDq';

const ALL_DRIVES = { supportsAllDrives: true };

function getFolderId() {
  const raw = process.env.GOOGLE_DRIVE_FOLDER_ID;
  const id = raw != null ? String(raw).trim().replace(/^["']|["']$/g, '') : '';
  return id || DEFAULT_DRIVE_FOLDER_ID;
}

/**
 * Sube un JPEG a la carpeta configurada. Devuelve el fileId de Drive.
 */
async function uploadJpeg(buffer, fileName) {
  const drive = await getDriveClient();
  const parentId = getFolderId();
  const stream = Readable.from(buffer);

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'image/jpeg',
      parents: [parentId],
    },
    media: {
      mimeType: 'image/jpeg',
      body: stream,
    },
    fields: 'id,name',
    ...ALL_DRIVES,
  });

  if (!created.data.id) {
    throw new Error('Drive no devolvió id de archivo tras subir.');
  }
  return created.data.id;
}

/**
 * Sube un PDF a la misma carpeta que las imágenes de boleta.
 * Devuelve { id, webViewLink } (webViewLink puede ser null según permisos de la API).
 */
async function uploadPdf(buffer, fileName) {
  const drive = await getDriveClient();
  const parentId = getFolderId();
  const stream = Readable.from(buffer);

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      mimeType: 'application/pdf',
      parents: [parentId],
    },
    media: {
      mimeType: 'application/pdf',
      body: stream,
    },
    fields: 'id,name,webViewLink',
    ...ALL_DRIVES,
  });

  if (!created.data.id) {
    throw new Error('Drive no devolvió id de archivo PDF tras subir.');
  }
  return {
    id: created.data.id,
    webViewLink: created.data.webViewLink || null,
  };
}

async function downloadFile(fileId) {
  const drive = await getDriveClient();
  const res = await drive.files.get(
    {
      fileId,
      alt: 'media',
      ...ALL_DRIVES,
    },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data);
}

async function deleteFile(fileId) {
  if (!fileId) return;
  try {
    const drive = await getDriveClient();
    await drive.files.delete({
      fileId,
      ...ALL_DRIVES,
    });
  } catch (e) {
    console.warn('Drive deleteFile:', e.message);
  }
}

module.exports = {
  uploadJpeg,
  uploadPdf,
  downloadFile,
  deleteFile,
  getFolderId,
};
