function parseDMY(str) {
  const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(String(str).trim());
  if (!m) return null;
  return {
    d: parseInt(m[1], 10),
    mo: parseInt(m[2], 10),
    y: parseInt(m[3], 10),
  };
}

function todayYYYYMMDDInTz() {
  const tz = process.env.TZ || 'America/Bogota';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function dmyToYYYYMMDD(p) {
  return `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function isDateDMYBeforeToday(str) {
  const p = parseDMY(str);
  if (!p) return true;
  return dmyToYYYYMMDD(p) < todayYYYYMMDDInTz();
}

function validateDateNotPastDMY(str) {
  const p = parseDMY(str);
  if (!p) return { ok: false, message: 'Formato de fecha inválido. Use día-mes-año (ej. 11-01-2026).' };
  if (dmyToYYYYMMDD(p) < todayYYYYMMDDInTz()) {
    return { ok: false, message: 'No se permiten fechas anteriores a la fecha actual.' };
  }
  return { ok: true };
}

function normalizeTarifaKey(valorLabel) {
  return String(valorLabel ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function findTarifaCupo(tarifas, valorLabel) {
  const key = normalizeTarifaKey(valorLabel);
  const list = Array.isArray(tarifas) ? tarifas : [];
  return list.find((t) => normalizeTarifaKey(t.valor) === key) || null;
}

function soldCountForTarifa(boletas, eventId, valorLabel) {
  const key = normalizeTarifaKey(valorLabel);
  return boletas
    .filter((b) => b.eventId === eventId && normalizeTarifaKey(b.valorLabel) === key)
    .reduce((sum, b) => sum + (Number(b.cantidad) || 0), 0);
}

function validateCupo({ tarifas, boletas, eventId, valorLabel, cantidadSolicitada }) {
  const tier = findTarifaCupo(tarifas, valorLabel);
  if (!tier) {
    return { ok: false, message: 'El valor de boleta seleccionado no existe en este evento.' };
  }
  const max = Number(tier.cantidad);
  if (!Number.isFinite(max) || max < 0) {
    return { ok: false, message: 'Configuración de cupos del evento inválida.' };
  }
  const sold = soldCountForTarifa(boletas, eventId, valorLabel);
  const need = Number(cantidadSolicitada) || 0;
  if (sold + need > max) {
    return {
      ok: false,
      message: `No hay cupo suficiente para esta tarifa. Vendidas: ${sold}, máximo: ${max}.`,
    };
  }
  return { ok: true };
}

module.exports = {
  parseDMY,
  validateDateNotPastDMY,
  isDateDMYBeforeToday,
  findTarifaCupo,
  validateCupo,
  soldCountForTarifa,
  normalizeTarifaKey,
};
