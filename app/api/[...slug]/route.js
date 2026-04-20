import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const runtime = 'nodejs';

const require = createRequire(import.meta.url);
const sheets = require('../../../server/sheets');
const drive = require('../../../server/drive');
const fondoStorage = require('../../../server/fondoStorage');
const { buildBoletaPdf } = require('../../../server/pdfBoleta');
const { sendBoletaEmail, isSmtpConfigured } = require('../../../server/mail');
const { buildTotalEventosExcel } = require('../../../server/excelReport');
const validation = require('../../../server/validation');
const googleAuth = require('../../../server/auth');
const allowedEmails = require('../../../server/allowedEmails');
const {
  buildBoletaPdfFileName,
  buildBoletaEmailSubject,
  buildPdfContentDisposition,
} = require('../../../server/boletaNaming');

const SESSION_COOKIE = 'tava_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function normalizeEmail(email) {
  return allowedEmails.normalizeEmail(email);
}

function getSessionSecret() {
  return (
    process.env.APP_SESSION_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    'tava-dev-secret-change-me'
  );
}

function toBase64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(input) {
  const base64 = String(input).replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  return Buffer.from(base64 + pad, 'base64').toString('utf8');
}

function signSession(email) {
  const payload = {
    email: normalizeEmail(email),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const payloadB64 = toBase64Url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
  return `${payloadB64}.${sig}`;
}

function parseCookies(request) {
  const raw = String(request.headers.get('cookie') || '');
  const out = {};
  raw.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx <= 0) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (!key) return;
    out[key] = decodeURIComponent(val);
  });
  return out;
}

function readSessionEmail(request) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expected = crypto
    .createHmac('sha256', getSessionSecret())
    .update(payloadB64)
    .digest('base64url');

  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

  try {
    const payload = JSON.parse(fromBase64Url(payloadB64));
    if (!payload?.email || !payload?.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return normalizeEmail(payload.email);
  } catch {
    return null;
  }
}

function requiresAuth(path) {
  if (pathIs(path, 'health')) return false;
  if (pathIs(path, 'auth', 'login')) return false;
  if (pathIs(path, 'auth', 'me')) return false;
  if (pathIs(path, 'auth', 'logout')) return false;
  return true;
}

function authRequired() {
  return json(
    {
      error: 'Debes iniciar sesión con correo para acceder al sistema.',
      code: 'AUTH_REQUIRED',
    },
    401
  );
}

function isOAuthClientError(error) {
  const msg = String(error?.message || '');
  const data = error?.response?.data;
  const serialized = `${msg} ${JSON.stringify(data || {})}`;
  return /unauthorized_client|invalid_grant|invalid_client|deleted_client|access_denied/i.test(
    serialized
  );
}

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
  for (let i = 0; i < 20; i += 1) {
    const num = crypto.randomInt(100000, 9999999);
    const suffix = String(eventId).replace(/\D/g, '').slice(-3).padStart(3, '0');
    const code = `${suffix}${num}`;
    if (!codes.has(code)) return code;
  }
  return `${String(eventId).slice(-4)}${crypto.randomBytes(3).toString('hex')}`;
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

function apiError(error) {
  if (error && (error.code === 'OAUTH_REQUIRED' || isOAuthClientError(error))) {
    return json(
      {
        error:
          error.code === 'OAUTH_REQUIRED'
            ? error.message
            : 'La autorización de Google no es válida en este entorno. Cierra sesión y vuelve a entrar con tu correo para repetir la vinculación con Google.',
        code: 'OAUTH_REQUIRED',
        authUrl: '/auth/google',
      },
      401
    );
  }
  return json({ error: error?.message || String(error) }, 500);
}

function isLocalRequest(request) {
  const url = new URL(request.url);
  const host = (url.hostname || '').toLowerCase();
  const xff = String(request.headers.get('x-forwarded-for') || '').toLowerCase();
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    xff.includes('127.0.0.1') ||
    xff.includes('::1')
  );
}

async function readEventoPayload(request) {
  const contentType = String(request.headers.get('content-type') || '');
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const pick = (key) => {
      const v = form.get(key);
      return typeof v === 'string' ? v : '';
    };
    const fondo = form.get('fondo');
    let fondoBuffer = null;
    if (fondo && typeof fondo === 'object' && typeof fondo.arrayBuffer === 'function') {
      const arr = await fondo.arrayBuffer();
      if (arr && arr.byteLength > 0) fondoBuffer = Buffer.from(arr);
    }
    return {
      body: {
        nombreProyecto: pick('nombreProyecto'),
        descripcion: pick('descripcion'),
        fechasJson: pick('fechasJson'),
        tarifasJson: pick('tarifasJson'),
        direccion: pick('direccion'),
        hora: pick('hora'),
        terminos: pick('terminos'),
        vendedoresJson: pick('vendedoresJson'),
      },
      fondoBuffer,
    };
  }

  const body = (await request.json().catch(() => ({}))) || {};
  return { body, fondoBuffer: null };
}

function asPath(params) {
  return Array.isArray(params?.slug) ? params.slug : [];
}

function pathIs(path, ...parts) {
  return path.length === parts.length && parts.every((p, i) => path[i] === p);
}

export async function GET(request, { params }) {
  const path = asPath(params);
  const sessionEmail = readSessionEmail(request);

  try {
    if (pathIs(path, 'health')) return json({ ok: true });
    if (pathIs(path, 'auth', 'me')) {
      return json({
        ok: true,
        loggedIn: Boolean(sessionEmail),
        email: sessionEmail || '',
      });
    }
    if (pathIs(path, 'auth', 'allowed-emails')) {
      if (!sessionEmail) return authRequired();
      return json({
        ok: true,
        items: allowedEmails.listAllowedEmailsDetailed(),
      });
    }
    if (requiresAuth(path) && !sessionEmail) return authRequired();

    if (pathIs(path, 'setup')) {
      let oauthReady = false;
      if (googleAuth.hasOAuthTokens()) {
        oauthReady = await googleAuth.verifyGoogleOAuthWorks();
      }
      let spreadsheetId = null;
      if (oauthReady) {
        try {
          spreadsheetId = await sheets.getSpreadsheetId();
        } catch {
          spreadsheetId = null;
        }
      }
      return json({
        ok: true,
        hasCredentials: oauthReady,
        hasDriveFolder: true,
        needsOAuth: !oauthReady,
        authUrl: '/auth/google',
        spreadsheetId,
      });
    }

    if (path[0] === 'media' && path.length === 2) {
      const id = decodeURIComponent(path[1]);
      const buf = await fondoStorage.getFondoBuffer(id, drive.downloadFile.bind(drive));
      if (!buf) return new NextResponse('No encontrado', { status: 404 });
      return new NextResponse(buf, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    if (pathIs(path, 'eventos')) {
      const list = await sheets.listEvents();
      return json(list);
    }

    if (path[0] === 'eventos' && path.length === 2) {
      const event = await sheets.getEventById(path[1]);
      if (!event) return json({ error: 'Evento no encontrado' }, 404);
      return json(event);
    }

    if (path[0] === 'eventos' && path[2] === 'asistentes' && path.length === 3) {
      const list = await sheets.listBoletasByEvent(path[1]);
      return json(
        list.map((b) => ({
          nombre: b.nombre,
          cantidad: b.cantidad,
          vendedor: b.vendedor,
          fecha: b.fechaEvento,
          edad: b.edad || '',
          telefono: b.telefono || '',
          email: b.correo || '',
        }))
      );
    }

    if (path[0] === 'reportes' && path[1] === 'asistentes-todos' && path.length === 2) {
      const rows = await sheets.listAsistentesTodosUnicos();
      return json(rows);
    }

    if (pathIs(path, 'boletas')) {
      const list = await sheets.listBoletas();
      return json(list);
    }

    if (path[0] === 'boletas' && path[2] === 'pdf' && path.length === 3) {
      const b = await sheets.getBoletaById(path[1]);
      if (!b) return json({ error: 'Boleta no encontrada' }, 404);
      const event = await sheets.getEventById(b.eventId);
      if (!event) return json({ error: 'Evento no encontrado' }, 404);

      const pdfBytes = await buildPdfForBoleta(b, event);
      const pdfFileName = buildBoletaPdfFileName({
        nombre: b.nombre,
        nombreProyecto: event.nombreProyecto,
        fecha: b.fechaEvento,
        cantidad: b.cantidad,
      });
      return new NextResponse(Buffer.from(pdfBytes), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': buildPdfContentDisposition(pdfFileName),
        },
      });
    }

    if (path[0] === 'reportes' && path[1] === 'evento' && path.length === 3) {
      const event = await sheets.getEventById(path[2]);
      if (!event) return json({ error: 'Evento no encontrado' }, 404);
      const boletas = await sheets.listBoletasByEvent(path[2]);
      return json({ event, boletas });
    }

    if (path[0] === 'reportes' && path[1] === 'excel' && path[2] === 'total-eventos') {
      const events = await sheets.listEvents();
      const boletas = await sheets.listBoletas();
      const buf = await buildTotalEventosExcel(events, boletas);
      const name = `reporte-total-eventos-${Date.now()}.xlsx`;
      return new NextResponse(Buffer.from(buf), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${name}"`,
        },
      });
    }

    return json({ error: 'Ruta no encontrada' }, 404);
  } catch (e) {
    if (path[0] === 'media') return new NextResponse('No encontrado', { status: 404 });
    return apiError(e);
  }
}

export async function POST(request, { params }) {
  const path = asPath(params);
  const sessionEmail = readSessionEmail(request);
  try {
    if (pathIs(path, 'auth', 'login')) {
      const body = (await request.json().catch(() => ({}))) || {};
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) {
        return json({ error: 'Ingresa un correo válido.' }, 400);
      }
      if (!allowedEmails.isAllowedEmail(email)) {
        return json({ error: 'Este correo no está autorizado para ingresar.' }, 403);
      }
      /** Cada ingreso con correo invalida tokens Google previos (un solo archivo de tokens en el servidor). */
      googleAuth.clearOAuthTokens();
      const token = signSession(email);
      const res = json({ ok: true, loggedIn: true, email });
      res.cookies.set({
        name: SESSION_COOKIE,
        value: token,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: SESSION_TTL_SECONDS,
      });
      return res;
    }
    if (pathIs(path, 'auth', 'allowed-emails')) {
      if (!sessionEmail) return authRequired();
      const body = (await request.json().catch(() => ({}))) || {};
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) {
        return json({ error: 'Ingresa un correo válido.' }, 400);
      }
      const items = allowedEmails.addManagedAllowedEmail(email);
      return json({ ok: true, items });
    }

    if (pathIs(path, 'auth', 'logout')) {
      googleAuth.clearOAuthTokens();
      const res = json({ ok: true, loggedIn: false });
      res.cookies.set({
        name: SESSION_COOKIE,
        value: '',
        path: '/',
        maxAge: 0,
      });
      return res;
    }

    if (requiresAuth(path) && !sessionEmail) return authRequired();

    if (pathIs(path, 'shutdown')) {
      if (!isLocalRequest(request)) {
        return json({ error: 'No permitido.' }, 403);
      }
      setTimeout(() => {
        process.exit(0);
      }, 200);
      return json({ ok: true, message: 'Servidor detenido.' });
    }

    if (pathIs(path, 'eventos')) {
      const { body, fondoBuffer } = await readEventoPayload(request);
      const nombreProyecto = String(body.nombreProyecto || '').trim();
      if (!nombreProyecto) {
        return json({ error: 'El nombre del proyecto es obligatorio.' }, 400);
      }

      const fechas = parseJsonField(body.fechasJson, []);
      const tarifas = parseJsonField(body.tarifasJson, []);
      const vendedores = parseJsonField(body.vendedoresJson, []);
      const vf = validateFechasList(fechas);
      if (!vf.ok) return json({ error: vf.message }, 400);

      let fondoFileId = '';
      if (fondoBuffer && fondoBuffer.length) {
        fondoFileId = await fondoStorage.saveFondoToDrive(drive.uploadJpeg, fondoBuffer);
      }

      const now = new Date().toISOString();
      const event = {
        eventId: newEventId(),
        nombreProyecto,
        descripcion: body.descripcion || '',
        fechasJson: JSON.stringify(fechas),
        tarifasJson: JSON.stringify(tarifas),
        direccion: body.direccion || '',
        hora: body.hora || '',
        terminos: body.terminos || '',
        vendedoresJson: JSON.stringify(vendedores),
        fondoFileId,
        createdAt: now,
        updatedAt: now,
      };

      await sheets.appendEvent(event);
      return json({ ok: true, event });
    }

    if (pathIs(path, 'boletas')) {
      const body = (await request.json().catch(() => ({}))) || {};
      const { eventId, nombre, correo, valorLabel, cantidad, fechaEvento, vendedor, edad, telefono } =
        body;

      if (!eventId || !nombre || !correo || !valorLabel || !fechaEvento || !vendedor) {
        return json({ error: 'Complete todos los campos obligatorios.' }, 400);
      }

      const qty = Number(cantidad);
      if (!Number.isFinite(qty) || qty < 1) {
        return json({ error: 'La cantidad de personas debe ser al menos 1.' }, 400);
      }

      const event = await sheets.getEventById(eventId);
      if (!event) return json({ error: 'Evento no encontrado.' }, 404);

      const fechas = parseJsonField(event.fechasJson, []);
      if (!fechas.map(String).includes(String(fechaEvento).trim())) {
        return json({ error: 'La fecha seleccionada no pertenece a este evento.' }, 400);
      }

      const fd = validation.validateDateNotPastDMY(fechaEvento);
      if (!fd.ok) return json({ error: fd.message }, 400);

      const tarifas = parseJsonField(event.tarifasJson, []);
      const allBoletas = await sheets.listBoletas();
      const cupo = validation.validateCupo({
        tarifas,
        boletas: allBoletas,
        eventId,
        valorLabel,
        cantidadSolicitada: qty,
      });
      if (!cupo.ok) return json({ error: cupo.message }, 400);

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
        return json(
          {
            error: `No se pudo guardar el PDF en Google Drive: ${upErr.message || upErr}`,
          },
          500
        );
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
          'Para enviar por Gmail, complete SMTP_HOST, SMTP_USER, SMTP_PASS y MAIL_FROM.';
      }

      return json({
        ok: true,
        boleta,
        pdfDriveId: pdfDrive.id,
        pdfDriveUrl,
        emailSent,
        emailError,
        emailInfo,
      });
    }

    return json({ error: 'Ruta no encontrada' }, 404);
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(request, { params }) {
  const path = asPath(params);
  const sessionEmail = readSessionEmail(request);
  try {
    if (requiresAuth(path) && !sessionEmail) return authRequired();
    if (path[0] !== 'eventos' || path.length !== 2) {
      return json({ error: 'Ruta no encontrada' }, 404);
    }

    const id = path[1];
    const prev = await sheets.getEventById(id);
    if (!prev) return json({ error: 'Evento no encontrado' }, 404);

    const { body, fondoBuffer } = await readEventoPayload(request);
    const nombreProyecto = String(body.nombreProyecto ?? prev.nombreProyecto).trim();
    const fechas = parseJsonField(
      body.fechasJson !== undefined ? body.fechasJson : prev.fechasJson,
      []
    );
    const tarifas = parseJsonField(
      body.tarifasJson !== undefined ? body.tarifasJson : prev.tarifasJson,
      []
    );
    const vendedores = parseJsonField(
      body.vendedoresJson !== undefined ? body.vendedoresJson : prev.vendedoresJson,
      []
    );

    const vf = validateFechasList(fechas);
    if (!vf.ok) return json({ error: vf.message }, 400);

    let fondoFileId = prev.fondoFileId;
    if (fondoBuffer && fondoBuffer.length) {
      if (prev.fondoFileId) await fondoStorage.deleteFondoRef(prev.fondoFileId, drive);
      fondoFileId = await fondoStorage.saveFondoToDrive(drive.uploadJpeg, fondoBuffer);
    }

    const now = new Date().toISOString();
    const event = {
      eventId: prev.eventId,
      nombreProyecto,
      descripcion: body.descripcion !== undefined ? body.descripcion : prev.descripcion,
      fechasJson: JSON.stringify(fechas),
      tarifasJson: JSON.stringify(tarifas),
      direccion: body.direccion !== undefined ? body.direccion : prev.direccion,
      hora: body.hora !== undefined ? body.hora : prev.hora,
      terminos: body.terminos !== undefined ? body.terminos : prev.terminos,
      vendedoresJson: JSON.stringify(vendedores),
      fondoFileId,
      createdAt: prev.createdAt,
      updatedAt: now,
    };

    await sheets.updateEventRow(id, event);
    return json({ ok: true, event });
  } catch (e) {
    return apiError(e);
  }
}

export async function DELETE(request, { params }) {
  const path = asPath(params);
  const sessionEmail = readSessionEmail(request);
  try {
    if (pathIs(path, 'auth', 'logout')) {
      googleAuth.clearOAuthTokens();
      const res = json({ ok: true, loggedIn: false });
      res.cookies.set({
        name: SESSION_COOKIE,
        value: '',
        path: '/',
        maxAge: 0,
      });
      return res;
    }
    if (pathIs(path, 'auth', 'allowed-emails')) {
      if (!sessionEmail) return authRequired();
      const url = new URL(request.url);
      const email = normalizeEmail(url.searchParams.get('email'));
      if (!isValidEmail(email)) {
        return json({ error: 'Debes indicar un correo válido para eliminar.' }, 400);
      }
      const items = allowedEmails.removeManagedAllowedEmail(email);
      return json({ ok: true, items });
    }
    if (requiresAuth(path) && !sessionEmail) return authRequired();
    if (path[0] !== 'eventos' || path.length !== 2) {
      return json({ error: 'Ruta no encontrada' }, 404);
    }

    const prev = await sheets.getEventById(path[1]);
    if (!prev) return json({ error: 'Evento no encontrado' }, 404);
    if (prev.fondoFileId) await fondoStorage.deleteFondoRef(prev.fondoFileId, drive);
    await sheets.deleteBoletasByEvent(path[1]);
    await sheets.deleteEventRow(path[1]);
    return json({ ok: true });
  } catch (e) {
    return apiError(e);
  }
}
