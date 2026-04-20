const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT_DIR, '.env');
const ENV_EXAMPLE = path.join(ROOT_DIR, '.env.example');

function loadEnvFallback(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) continue;

    const key = line.slice(0, eqIdx).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = line.slice(eqIdx + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }

    process.env[key] = value;
  }
}

if (!fs.existsSync(ENV_PATH) && fs.existsSync(ENV_EXAMPLE)) {
  try {
    fs.copyFileSync(ENV_EXAMPLE, ENV_PATH);
    console.log('Se creó .env a partir de .env.example. Edita .env y pon la ruta a tu JSON de Google.');
  } catch (e) {
    console.warn('No se pudo crear .env:', e.message);
  }
}

try {
  require('dotenv').config({ path: ENV_PATH });
} catch (e) {
  console.warn('dotenv no disponible, usando cargador .env interno:', e.message);
  loadEnvFallback(ENV_PATH);
}

const crypto = require('crypto');
const { exec } = require('child_process');
const express = require('express');
const multer = require('multer');

const sheets = require('./sheets');
const drive = require('./drive');
const fondoStorage = require('./fondoStorage');
const { buildBoletaPdf } = require('./pdfBoleta');
const { sendBoletaEmail, isSmtpConfigured } = require('./mail');
const { buildTotalEventosExcel } = require('./excelReport');
const validation = require('./validation');
const { ROOT } = require('./paths');
const googleAuth = require('./auth');
const {
  buildBoletaPdfFileName,
  buildBoletaEmailSubject,
  buildPdfContentDisposition,
} = require('./boletaNaming');

/**
 * API principal. Rutas relevantes:
 * - Eventos: Sheets (sheets.js); fondos de boleta: Drive en carpeta GOOGLE_DRIVE_FOLDER_ID (drive.js + fondoStorage.js).
 * - Boletas: Sheets + PDF + correo.
 * Para cambiar dónde se guardan las imágenes, edita server/drive.js y .env.
 */

const app = express();
const PORT = process.env.PORT || 3000;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = /\.(jpe?g)$/i.test(file.originalname);
    const mime = /jpeg|jpg/i.test(file.mimetype || '');
    if (ext && mime) return cb(null, true);
    return cb(new Error('Solo se permiten archivos JPG o JPEG.'));
  },
});

app.use(express.json({ limit: '4mb' }));

function parseJsonField(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function newEventId() {
  return `ev_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

function newBoletaId() {
  return `bl_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
}

async function uniqueCodigoBoleta(eventId) {
  const existing = await sheets.listBoletasByEvent(eventId);
  const codes = new Set(existing.map((b) => b.codigoBoleta));
  for (let i = 0; i < 20; i++) {
    const num = crypto.randomInt(100000, 9999999);
    const suffix = String(eventId).replace(/\D/g, '').slice(-3).padStart(3, '0');
    const code = `${suffix}${num}`;
    if (!codes.has(code)) return code;
  }
  return `${eventId.slice(-4)}${crypto.randomBytes(3).toString('hex')}`;
}

function validateFechasList(arr) {
  if (!Array.isArray(arr)) return { ok: false, message: 'Lista de fechas inválida.' };
  for (const f of arr) {
    const r = validation.validateDateNotPastDMY(String(f));
    if (!r.ok) return r;
  }
  return { ok: true };
}

async function buildPdfForBoleta(boleta, event) {
  let fondoBuffer = null;
  if (event.fondoFileId) {
    try {
      fondoBuffer = await fondoStorage.getFondoBuffer(
        event.fondoFileId,
        drive.downloadFile.bind(drive)
      );
    } catch (e) {
      console.warn('Fondo boleta:', e.message);
    }
  }
  return buildBoletaPdf({
    fondoBuffer,
    nombreProyecto: event.nombreProyecto,
    nombre: boleta.nombre,
    fecha: boleta.fechaEvento,
    cantidad: boleta.cantidad,
    codigoBoleta: boleta.codigoBoleta,
    hora: event.hora,
    direccion: event.direccion,
    terminos: event.terminos,
  });
}

function apiError(res, e) {
  if (e && e.code === 'OAUTH_REQUIRED') {
    return res.status(401).json({
      error: e.message,
      code: 'OAUTH_REQUIRED',
      authUrl: '/auth/google',
    });
  }
  return res.status(500).json({ error: e.message || String(e) });
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

function isLocalRequest(req) {
  const ip = req.socket.remoteAddress || '';
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.endsWith('127.0.0.1')
  );
}

/** Solo uso en equipo local: detiene Node (cierra el servidor). */
app.post('/api/shutdown', (req, res) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'No permitido.' });
  }
  res.json({ ok: true, message: 'Servidor detenido.' });
  setTimeout(() => process.exit(0), 200);
});

/** Primera vez: abre esta URL en el navegador para vincular tu Gmail con la app. */
app.get('/auth/google', (req, res) => {
  try {
    res.redirect(googleAuth.getAuthorizationUrl());
  } catch (e) {
    res
      .status(500)
      .type('html')
      .send(
        `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;max-width:560px"><h1>OAuth</h1><p>${e.message}</p><p>Configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en .env (Google Cloud → Credenciales → ID de cliente OAuth tipo “Aplicación web”).</p></body></html>`
      );
  }
});

app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  const err = req.query.error;
  if (err) {
    return res.redirect(`/?oauth=error&reason=${encodeURIComponent(String(err))}`);
  }
  if (!code) {
    return res.redirect('/?oauth=error&reason=no_code');
  }
  try {
    await googleAuth.saveTokensFromCode(code);
    return res.redirect('/?oauth=ok');
  } catch (e) {
    return res.redirect(`/?oauth=error&reason=${encodeURIComponent(e.message)}`);
  }
});

app.get('/api/setup', async (req, res) => {
  try {
    const hasOAuth = googleAuth.hasOAuthTokens();
    let spreadsheetId = null;
    if (hasOAuth) {
      try {
        spreadsheetId = await sheets.getSpreadsheetId();
      } catch (_) {
        spreadsheetId = null;
      }
    }
    res.json({
      ok: true,
      hasCredentials: hasOAuth,
      hasDriveFolder: true,
      needsOAuth: !hasOAuth,
      authUrl: '/auth/google',
      spreadsheetId,
    });
  } catch (e) {
    return apiError(res, e);
  }
});

app.get('/api/media/:fileId', async (req, res) => {
  try {
    const id = decodeURIComponent(req.params.fileId);
    const buf = await fondoStorage.getFondoBuffer(id, drive.downloadFile.bind(drive));
    if (!buf) return res.status(404).send('No encontrado');
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(buf);
  } catch (e) {
    if (e && e.code === 'OAUTH_REQUIRED') return apiError(res, e);
    res.status(404).send('No encontrado');
  }
});

app.get('/api/eventos', async (req, res) => {
  try {
    const list = await sheets.listEvents();
    res.json(list);
  } catch (e) {
    return apiError(res, e);
  }
});

app.get('/api/eventos/:id', async (req, res) => {
  try {
    const e = await sheets.getEventById(req.params.id);
    if (!e) return res.status(404).json({ error: 'Evento no encontrado' });
    res.json(e);
  } catch (e) {
    return apiError(res, e);
  }
});

app.post('/api/eventos', upload.single('fondo'), async (req, res) => {
  try {
    const nombreProyecto = (req.body.nombreProyecto || '').trim();
    if (!nombreProyecto) {
      return res.status(400).json({ error: 'El nombre del proyecto es obligatorio.' });
    }

    const fechas = parseJsonField(req.body.fechasJson, []);
    const tarifas = parseJsonField(req.body.tarifasJson, []);
    const vendedores = parseJsonField(req.body.vendedoresJson, []);

    const vf = validateFechasList(fechas);
    if (!vf.ok) return res.status(400).json({ error: vf.message });

    let fondoFileId = '';
    if (req.file && req.file.buffer) {
      fondoFileId = await fondoStorage.saveFondoToDrive(drive.uploadJpeg, req.file.buffer);
    }

    const now = new Date().toISOString();
    const event = {
      eventId: newEventId(),
      nombreProyecto,
      descripcion: req.body.descripcion || '',
      fechasJson: JSON.stringify(fechas),
      tarifasJson: JSON.stringify(tarifas),
      direccion: req.body.direccion || '',
      hora: req.body.hora || '',
      terminos: req.body.terminos || '',
      vendedoresJson: JSON.stringify(vendedores),
      fondoFileId,
      createdAt: now,
      updatedAt: now,
    };

    await sheets.appendEvent(event);
    res.json({ ok: true, event });
  } catch (e) {
    return apiError(res, e);
  }
});

app.put('/api/eventos/:id', upload.single('fondo'), async (req, res) => {
  try {
    const prev = await sheets.getEventById(req.params.id);
    if (!prev) return res.status(404).json({ error: 'Evento no encontrado' });

    const nombreProyecto = (req.body.nombreProyecto ?? prev.nombreProyecto).trim();
    const fechas = parseJsonField(
      req.body.fechasJson !== undefined ? req.body.fechasJson : prev.fechasJson,
      []
    );
    const tarifas = parseJsonField(
      req.body.tarifasJson !== undefined ? req.body.tarifasJson : prev.tarifasJson,
      []
    );
    const vendedores = parseJsonField(
      req.body.vendedoresJson !== undefined ? req.body.vendedoresJson : prev.vendedoresJson,
      []
    );

    const vf = validateFechasList(fechas);
    if (!vf.ok) return res.status(400).json({ error: vf.message });

    let fondoFileId = prev.fondoFileId;
    if (req.file && req.file.buffer) {
      if (prev.fondoFileId) await fondoStorage.deleteFondoRef(prev.fondoFileId, drive);
      fondoFileId = await fondoStorage.saveFondoToDrive(drive.uploadJpeg, req.file.buffer);
    }

    const now = new Date().toISOString();
    const event = {
      eventId: prev.eventId,
      nombreProyecto,
      descripcion:
        req.body.descripcion !== undefined ? req.body.descripcion : prev.descripcion,
      fechasJson: JSON.stringify(fechas),
      tarifasJson: JSON.stringify(tarifas),
      direccion: req.body.direccion !== undefined ? req.body.direccion : prev.direccion,
      hora: req.body.hora !== undefined ? req.body.hora : prev.hora,
      terminos: req.body.terminos !== undefined ? req.body.terminos : prev.terminos,
      vendedoresJson: JSON.stringify(vendedores),
      fondoFileId,
      createdAt: prev.createdAt,
      updatedAt: now,
    };

    await sheets.updateEventRow(req.params.id, event);
    res.json({ ok: true, event });
  } catch (e) {
    return apiError(res, e);
  }
});

app.delete('/api/eventos/:id', async (req, res) => {
  try {
    const prev = await sheets.getEventById(req.params.id);
    if (!prev) return res.status(404).json({ error: 'Evento no encontrado' });
    if (prev.fondoFileId) await fondoStorage.deleteFondoRef(prev.fondoFileId, drive);
    await sheets.deleteBoletasByEvent(req.params.id);
    await sheets.deleteEventRow(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    return apiError(res, e);
  }
});

app.get('/api/boletas', async (req, res) => {
  try {
    const list = await sheets.listBoletas();
    res.json(list);
  } catch (e) {
    return apiError(res, e);
  }
});

app.get('/api/eventos/:id/asistentes', async (req, res) => {
  try {
    const list = await sheets.listBoletasByEvent(req.params.id);
    const rows = list.map((b) => ({
      nombre: b.nombre,
      cantidad: b.cantidad,
      vendedor: b.vendedor,
      fecha: b.fechaEvento,
      edad: b.edad || '',
      telefono: b.telefono || '',
      email: b.correo || '',
    }));
    res.json(rows);
  } catch (e) {
    return apiError(res, e);
  }
});

app.get('/api/reportes/asistentes-todos', async (req, res) => {
  try {
    const rows = await sheets.listAsistentesTodosUnicos();
    res.json(rows);
  } catch (e) {
    return apiError(res, e);
  }
});

app.post('/api/boletas', async (req, res) => {
  try {
    const {
      eventId,
      nombre,
      correo,
      valorLabel,
      cantidad,
      fechaEvento,
      vendedor,
      edad,
      telefono,
    } = req.body;

    if (!eventId || !nombre || !correo || !valorLabel || !fechaEvento || !vendedor) {
      return res.status(400).json({ error: 'Complete todos los campos obligatorios.' });
    }

    const qty = Number(cantidad);
    if (!Number.isFinite(qty) || qty < 1) {
      return res.status(400).json({ error: 'La cantidad de personas debe ser al menos 1.' });
    }

    const event = await sheets.getEventById(eventId);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado.' });

    const fechas = parseJsonField(event.fechasJson, []);
    if (!fechas.map(String).includes(String(fechaEvento).trim())) {
      return res.status(400).json({ error: 'La fecha seleccionada no pertenece a este evento.' });
    }

    const fd = validation.validateDateNotPastDMY(fechaEvento);
    if (!fd.ok) return res.status(400).json({ error: fd.message });

    const tarifas = parseJsonField(event.tarifasJson, []);
    const allBoletas = await sheets.listBoletas();
    const cupo = validation.validateCupo({
      tarifas,
      boletas: allBoletas,
      eventId,
      valorLabel,
      cantidadSolicitada: qty,
    });
    if (!cupo.ok) return res.status(400).json({ error: cupo.message });

    const codigoBoleta = await uniqueCodigoBoleta(eventId);
    const now = new Date().toISOString();
    const boleta = {
      boletaId: newBoletaId(),
      eventId,
      nombre: String(nombre).trim(),
      correo: String(correo).trim(),
      valorLabel: String(valorLabel).trim(),
      cantidad: qty,
      fechaEvento: String(fechaEvento).trim(),
      vendedor: String(vendedor).trim(),
      codigoBoleta,
      createdAt: now,
      edad: edad != null && edad !== '' ? String(edad).trim() : '',
      telefono: telefono != null && telefono !== '' ? String(telefono).trim() : '',
    };

    await sheets.appendBoleta(boleta);

    const pdfBytes = await buildPdfForBoleta(boleta, event);
    const pdfBuffer = Buffer.from(pdfBytes);

    const boletaNameParams = {
      nombre: boleta.nombre,
      nombreProyecto: event.nombreProyecto,
      fecha: boleta.fechaEvento,
      cantidad: boleta.cantidad,
    };
    const pdfFileName = buildBoletaPdfFileName(boletaNameParams);
    const emailSubject = buildBoletaEmailSubject(boletaNameParams);

    let pdfDrive;
    try {
      pdfDrive = await drive.uploadPdf(pdfBuffer, pdfFileName);
    } catch (upErr) {
      console.error('Drive uploadPdf:', upErr);
      return res.status(500).json({
        error: `No se pudo guardar el PDF en Google Drive: ${upErr.message || upErr}`,
      });
    }

    const pdfDriveUrl =
      pdfDrive.webViewLink || `https://drive.google.com/file/d/${pdfDrive.id}/view`;

    let emailSent = false;
    let emailError = null;
    let emailInfo = null;

    if (isSmtpConfigured()) {
      try {
        await sendBoletaEmail({
          to: boleta.correo,
          subject: emailSubject,
          pdfBuffer,
          fileName: pdfFileName,
          eventName: event.nombreProyecto,
          holderName: boleta.nombre,
          codigo: codigoBoleta,
          fecha: boleta.fechaEvento,
        });
        emailSent = true;
      } catch (err) {
        emailError = err.message;
      }
    } else {
      emailInfo =
        'Correo no enviado: no hay SMTP en .env. La boleta quedó guardada en Google Drive. ' +
        'Para enviar por Gmail, complete SMTP_HOST, SMTP_USER, SMTP_PASS (contraseña de aplicación) y MAIL_FROM.';
    }

    res.json({
      ok: true,
      boleta,
      pdfDriveId: pdfDrive.id,
      pdfDriveUrl,
      emailSent,
      emailError,
      emailInfo,
    });
  } catch (e) {
    return apiError(res, e);
  }
});

app.get('/api/boletas/:id/pdf', async (req, res) => {
  try {
    const b = await sheets.getBoletaById(req.params.id);
    if (!b) return res.status(404).json({ error: 'Boleta no encontrada' });
    const event = await sheets.getEventById(b.eventId);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado' });
    const pdfBytes = await buildPdfForBoleta(b, event);
    const pdfFileName = buildBoletaPdfFileName({
      nombre: b.nombre,
      nombreProyecto: event.nombreProyecto,
      fecha: b.fechaEvento,
      cantidad: b.cantidad,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', buildPdfContentDisposition(pdfFileName));
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    return apiError(res, e);
  }
});

app.get('/api/reportes/evento/:id', async (req, res) => {
  try {
    const event = await sheets.getEventById(req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento no encontrado' });
    const boletas = await sheets.listBoletasByEvent(req.params.id);
    res.json({ event, boletas });
  } catch (e) {
    return apiError(res, e);
  }
});

app.get('/api/reportes/excel/total-eventos', async (req, res) => {
  try {
    const events = await sheets.listEvents();
    const boletas = await sheets.listBoletas();
    const buf = await buildTotalEventosExcel(events, boletas);
    const name = `reporte-total-eventos-${Date.now()}.xlsx`;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(Buffer.from(buf));
  } catch (e) {
    return apiError(res, e);
  }
});

app.use(express.static(path.join(ROOT, 'public')));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: 'Error al subir el archivo (tamaño o tipo).' });
  }
  if (err && err.message && String(err.message).includes('Solo se permiten')) {
    return res.status(400).json({ error: err.message });
  }
  console.error(err);
  return res.status(500).json({ error: err.message || 'Error del servidor' });
});

function openBrowserToApp() {
  if (process.env.OPEN_BROWSER === '0' || process.env.OPEN_BROWSER === 'false') return;
  const url = `http://localhost:${PORT}/#inicio`;
  try {
    if (process.platform === 'win32') {
      exec(`start "" "${url}"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  } catch (e) {
    console.warn('No se pudo abrir el navegador:', e.message);
  }
}

app.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
  openBrowserToApp();
});
