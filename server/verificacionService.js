const sheets = require('./sheets');
const validation = require('./validation');
const { parseVerificacionToken } = require('./verificacionToken');

const MSG_OK = 'Se validó';
const MSG_FULL = 'Ya está validada la boleta';
const MSG_NOT = 'La fecha del evento no se ha habilitado';

function mapEstado(b) {
  const cap = Number(b.cantidad) || 0;
  const ing = Number(b.ingresados) || 0;
  if (ing <= 0) return 'pendiente';
  if (ing >= cap) return 'completo';
  return 'parcial';
}

async function validarIngreso({ eventId, boletaId, add }) {
  const n = Math.max(1, Math.min(200, Math.floor(Number(add) || 1)));
  const list = await sheets.listBoletasByEvent(eventId);
  const b = list.find((x) => x.boletaId === boletaId);
  if (!b) return { ok: false, userText: MSG_NOT, code: 'NOT_ENABLED' };
  if (!validation.isAccesoVerificacionHabilitada(String(b.fechaEvento || ''))) {
    return { ok: false, userText: MSG_NOT, code: 'NOT_ENABLED' };
  }
  const ing = Number(b.ingresados) || 0;
  const cap = Number(b.cantidad) || 0;
  if (cap < 1) return { ok: false, userText: MSG_NOT, code: 'NOT_ENABLED' };
  if (ing >= cap) return { ok: false, userText: MSG_FULL, code: 'ALREADY_FULL' };
  if (ing + n > cap) return { ok: false, userText: MSG_FULL, code: 'ALREADY_FULL' };
  const final = ing + n;
  const now = new Date().toISOString();
  await sheets.updateBoletaIngresoRow(boletaId, final, now);
  const b2 = { ...b, ingresados: final, verificacionUpdatedAt: now };
  return { ok: true, userText: MSG_OK, code: 'OK', boleta: b2, estado: mapEstado(b2) };
}

/**
 * Escaner QR: +1 ingreso, mismo evento que el de la sesión de verificación, token firmado.
 */
async function validarEscaneo({ eventId, token }) {
  const p = parseVerificacionToken(token);
  if (!p || p.eventId !== eventId) {
    return { ok: false, userText: MSG_NOT, code: 'NOT_ENABLED' };
  }
  const list = await sheets.listBoletasByEvent(eventId);
  const b = list.find((x) => x.codigoBoleta === p.codigoBoleta);
  if (!b) {
    return { ok: false, userText: MSG_NOT, code: 'NOT_ENABLED' };
  }
  return validarIngreso({ eventId, boletaId: b.boletaId, add: 1 });
}

async function listVerificacionBoletas(eventId) {
  const rows = await sheets.listBoletasByEvent(eventId);
  return rows.map((b) => {
    const cap = Number(b.cantidad) || 0;
    const ing = Math.min(cap, Math.max(0, Number(b.ingresados) || 0));
    return {
      boletaId: b.boletaId,
      nombre: b.nombre,
      correo: b.correo,
      codigoBoleta: b.codigoBoleta,
      cantidad: cap,
      ingresados: ing,
      restante: Math.max(0, cap - ing),
      fechaEvento: b.fechaEvento,
      vendedor: b.vendedor,
      verificacionUpdatedAt: b.verificacionUpdatedAt || '',
      estado: mapEstado({ ...b, ingresados: ing, cantidad: cap }),
    };
  });
}

module.exports = {
  MSG_OK,
  MSG_FULL,
  MSG_NOT,
  validarIngreso,
  validarEscaneo,
  listVerificacionBoletas,
  mapEstado,
};
