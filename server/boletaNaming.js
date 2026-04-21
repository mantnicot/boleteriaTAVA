/**
 * Nombre de archivo PDF y asunto de correo alineados con la boleta.
 */

function sanitizePart(s, maxLen) {
  return String(s ?? '')
    .trim()
    .replace(/[\r\n\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, maxLen)
    .trim();
}

/**
 * Etiqueta legible: "Titular - Evento (fecha) cant N"
 */
function buildBoletaLabel({ nombre, nombreProyecto, fecha, cantidad }) {
  const n = sanitizePart(nombre, 55) || 'Titular';
  const ev = sanitizePart(nombreProyecto, 72) || 'Evento';
  const f = sanitizePart(fecha, 22) || '—';
  const c = String(cantidad ?? '').trim() || '0';
  let base = `${n} - ${ev} (${f}) cant ${c}`;
  if (base.length > 200) base = `${base.slice(0, 197)}…`;
  return base;
}

function buildBoletaPdfFileName(params) {
  const base = buildBoletaLabel(params);
  const stem = base.length > 170 ? `${base.slice(0, 167)}…` : base;
  return `${stem}.pdf`;
}

function buildBoletaEmailSubject(params) {
  return buildBoletaLabel(params).slice(0, 220);
}

function asciiFilenameFromUtf8(name) {
  const base = String(name || 'boleta.pdf').replace(/\.pdf$/i, '');
  const ascii = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${ascii || 'boleta'}.pdf`;
}

/**
 * Cabecera Content-Disposition con fallback ASCII para Windows.
 */
function buildPdfContentDisposition(utf8FileName) {
  const ascii = asciiFilenameFromUtf8(utf8FileName);
  const star = encodeURIComponent(utf8FileName);
  return `attachment; filename="${ascii.replace(/"/g, '')}"; filename*=UTF-8''${star}`;
}

module.exports = {
  buildBoletaLabel,
  buildBoletaPdfFileName,
  buildBoletaEmailSubject,
  buildPdfContentDisposition,
};
