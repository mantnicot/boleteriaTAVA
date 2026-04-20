const fs = require('fs');
const path = require('path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/** A4 horizontal (puntos PDF) */
const W = 841.89;
const H = 595.28;

const FRACCION_IMAGEN_DATOS = 0.5;

let sharpWarned = false;

/**
 * Difuminado fuerte sin depender solo de blur(): reduce a muy pocos px y vuelve a escalar
 * (efecto similar a ~60 % de desenfoque) + sigma extra. Salida encaja exactamente en la
 * proporción de la mitad izquierda para cubrir L×H sin desbordes.
 */
async function blurFondoBuffer(buf, widthPt, heightPt) {
  if (!buf || buf.length === 0) return null;
  try {
    const sharp = require('sharp');
    const ratio = heightPt / widthPt;
    const outW = 880;
    const outH = Math.max(2, Math.round(outW * ratio));
    return await sharp(buf)
      .rotate()
      .resize(56, Math.max(2, Math.round(56 * ratio)), { fit: 'cover', position: 'centre' })
      .blur(6)
      .resize(outW, outH, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    if (!sharpWarned) {
      sharpWarned = true;
      console.warn(
        'Sharp no pudo procesar el fondo del PDF (difuminado). ¿npm install completo en este equipo?',
        e.message
      );
    }
    return null;
  }
}

/** Logo boleta: bytes PNG/JPEG sin alterar (pdf-lib); fallback SVG vía sharp. */
async function loadBoletaLogoPng() {
  const pngPath = path.join(__dirname, '..', 'public', 'assets', 'logo-tava-boleta.png');
  if (fs.existsSync(pngPath)) {
    try {
      return fs.readFileSync(pngPath);
    } catch {
      /* sigue */
    }
  }
  const svgPath = path.join(__dirname, '..', 'public', 'assets', 'logo-tava.svg');
  if (!fs.existsSync(svgPath)) return null;
  try {
    const sharp = require('sharp');
    return await sharp(svgPath).png().resize({ width: 88, height: 104, fit: 'inside' }).toBuffer();
  } catch {
    return null;
  }
}

async function embedLogoForPdf(pdfDoc, buf) {
  if (!buf || !buf.length) return null;
  try {
    return await pdfDoc.embedPng(buf);
  } catch {
    try {
      return await pdfDoc.embedJpg(buf);
    } catch {
      /* intenta RGB opaco por transparencia / perfil raro */
    }
  }
  try {
    const sharp = require('sharp');
    const normalized = await sharp(buf)
      .resize({ width: 256, height: 256, fit: 'inside' })
      .png({ compressionLevel: 6 })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toBuffer();
    return await pdfDoc.embedPng(normalized);
  } catch {
    return null;
  }
}

function wrapLines(text, maxW, size, font) {
  const words = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) <= maxW || !line) {
      line = test;
    } else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function termLines(text, maxW, size, font) {
  return wrapLines(String(text || '').replace(/\s+/g, ' ').trim() || '—', maxW, size, font);
}

function drawWrappedRight(
  page,
  text,
  xRight,
  yTopBaseline,
  maxW,
  size,
  font,
  color,
  lineGap = 3.5
) {
  const lines = wrapLines(text, maxW, size, font);
  let y = yTopBaseline;
  for (const ln of lines) {
    const tw = font.widthOfTextAtSize(ln, size);
    page.drawText(ln, { x: xRight - tw, y, size, font, color });
    y -= size + lineGap;
  }
  return y;
}

/** Texto alineado a la izquierda (panel boleta). */
function drawLeftBoldLines(page, text, size, xLeft, yTop, maxW, color, fontBold, lineGap = 6) {
  const lines = wrapLines(String(text), maxW, size, fontBold);
  let y = yTop;
  for (const ln of lines) {
    y -= size;
    page.drawText(ln, { x: xLeft, y, size, font: fontBold, color });
    y -= lineGap;
  }
  return y;
}

async function embedFondoImage(pdfDoc, buf) {
  if (!buf || !buf.length) return null;
  try {
    return await pdfDoc.embedJpg(buf);
  } catch {
    try {
      return await pdfDoc.embedPng(buf);
    } catch {
      return null;
    }
  }
}

function pickTermsFontSize(terms, maxW, font, yTop, bottomMin, maxSize = 10.2, minSize = 4.5) {
  const usable = yTop - bottomMin;
  let best = minSize;
  for (let s = maxSize; s >= minSize; s -= 0.45) {
    const lines = termLines(terms, maxW, s, font);
    const h = lines.length * (s + 3.15);
    if (h <= usable) {
      best = s;
      break;
    }
  }
  return best;
}

/**
 * Dibuja un bloque de líneas de términos centrado y repartiendo el espacio vertical entre yBottom e yTop.
 * Devuelve el índice de la siguiente línea por dibujar.
 */
function drawTermsCenteredSpread(page, lines, startIdx, yTop, yBottom, cx, edgeL, edgeR, size, font, color) {
  if (startIdx >= lines.length) return startIdx;
  let available = yTop - yBottom;
  if (available <= size + 4) {
    const raw = lines[startIdx];
    const ln = raw.length > 500 ? `${raw.slice(0, 497)}…` : raw;
    const tw = font.widthOfTextAtSize(ln, size);
    let x = cx - tw / 2;
    if (x < edgeL) x = edgeL;
    if (x + tw > edgeR) x = edgeR - tw;
    page.drawText(ln, { x, y: yBottom + size * 0.72, size, font, color });
    return startIdx + 1;
  }
  let n = 0;
  let acc = 0;
  const minG = 3.2;
  for (let i = startIdx; i < lines.length; i++) {
    const add = n === 0 ? size : minG + size;
    if (acc + add > available + 0.5) break;
    acc += add;
    n++;
  }
  if (n < 1) n = 1;
  let gap = minG;
  let blockH = n * size + (n - 1) * gap;
  if (n > 1 && blockH < available) {
    gap = minG + (available - blockH) / (n - 1);
    blockH = n * size + (n - 1) * gap;
  }
  const yBlockBottom = yBottom + Math.max(0, (available - blockH) / 2);
  let y = yBlockBottom + blockH - size * 0.72;
  for (let k = 0; k < n; k++) {
    const raw = lines[startIdx + k];
    const ln = raw.length > 500 ? `${raw.slice(0, 497)}…` : raw;
    const tw = font.widthOfTextAtSize(ln, size);
    let x = cx - tw / 2;
    if (x < edgeL) x = edgeL;
    if (x + tw > edgeR) x = edgeR - tw;
    page.drawText(ln, { x, y, size, font, color });
    y -= size + gap;
  }
  return startIdx + n;
}

async function buildBoletaPdf({
  fondoBuffer,
  nombreProyecto,
  nombre,
  fecha,
  cantidad,
  codigoBoleta,
  hora,
  direccion,
  terminos,
}) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const splitX = W * FRACCION_IMAGEN_DATOS;
  const L = splitX;

  /** Alineado con tema web: --burgundy-dark #5c0c1e, --burgundy #7a1027 */
  const themeDark = rgb(92 / 255, 12 / 255, 30 / 255);
  const themeBurgundy = rgb(122 / 255, 16 / 255, 39 / 255);
  const white = rgb(1, 1, 1);

  const processedFondo = await blurFondoBuffer(fondoBuffer, L, H);
  let rawFondoForEmbed = processedFondo;
  if (!rawFondoForEmbed && fondoBuffer && fondoBuffer.length) {
    rawFondoForEmbed = fondoBuffer;
  }

  const logoPng = await loadBoletaLogoPng();
  const logoImg = await embedLogoForPdf(pdfDoc, logoPng);

  let logoDrawW = 0;
  let logoDrawH = 0;
  if (logoImg) {
    const ar = logoImg.height / logoImg.width;
    const logoMaxW = 102;
    const logoMaxH = 90;
    logoDrawW = Math.min(logoMaxW, logoImg.width);
    logoDrawH = logoDrawW * ar;
    if (logoDrawH > logoMaxH) {
      logoDrawH = logoMaxH;
      logoDrawW = logoDrawH / ar;
    }
  }

  const termsPad = 26;
  const termsInnerW = W - splitX - termsPad * 2;
  const termsHeaderY = H - termsPad - 14;
  const termsBodyTop = termsHeaderY - 22;
  const termsBottomMin = 32;

  const terms = (terminos || 'Términos no especificados.').trim();
  const termsFontSize = pickTermsFontSize(terms, termsInnerW, font, termsBodyTop, termsBottomMin);
  const termLineList = termLines(terms, termsInnerW, termsFontSize, font);

  let page = pdfDoc.addPage([W, H]);
  let lineIdx = 0;

  function drawRightPanelMaroon(p) {
    p.drawRectangle({
      x: splitX,
      y: 0,
      width: W - splitX,
      height: H,
      color: themeBurgundy,
    });
  }

  function drawTermsHeaderCentered(p, headerText, size, split) {
    const tw = fontBold.widthOfTextAtSize(headerText, size);
    const cx = split + (W - split) / 2;
    p.drawText(headerText, {
      x: cx - tw / 2,
      y: termsHeaderY,
      size,
      font: fontBold,
      color: white,
    });
  }

  drawRightPanelMaroon(page);
  drawTermsHeaderCentered(page, 'Términos y condiciones', 14, splitX);

  const termsCx = splitX + (W - splitX) / 2;
  const termsEdgeL = splitX + 14;
  const termsEdgeR = W - 14;
  lineIdx = drawTermsCenteredSpread(
    page,
    termLineList,
    lineIdx,
    termsBodyTop,
    termsBottomMin,
    termsCx,
    termsEdgeL,
    termsEdgeR,
    termsFontSize,
    font,
    white
  );

  let termsPageGuard = 0;
  while (lineIdx < termLineList.length && termsPageGuard++ < 50) {
    page = pdfDoc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: themeBurgundy });
    const contHeaderY = H - termsPad - 14;
    const contBodyTop = contHeaderY - 24;
    const contTitle = 'Términos y condiciones (continuación)';
    const ctw = fontBold.widthOfTextAtSize(contTitle, 12);
    page.drawText(contTitle, {
      x: W / 2 - ctw / 2,
      y: contHeaderY,
      size: 12,
      font: fontBold,
      color: white,
    });
    lineIdx = drawTermsCenteredSpread(
      page,
      termLineList,
      lineIdx,
      contBodyTop,
      termsBottomMin,
      W / 2,
      termsPad,
      W - termsPad,
      termsFontSize,
      font,
      white
    );
  }

  page = pdfDoc.getPage(0);

  if (rawFondoForEmbed && rawFondoForEmbed.length > 0) {
    const img = await embedFondoImage(pdfDoc, rawFondoForEmbed);
    if (img) {
      page.drawImage(img, { x: 0, y: 0, width: L, height: H });
      page.drawRectangle({
        x: 0,
        y: 0,
        width: L,
        height: H,
        color: themeDark,
        opacity: 0.34,
      });
    } else {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: L,
        height: H,
        color: themeDark,
      });
    }
  } else {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: L,
      height: H,
      color: themeDark,
    });
  }

  /** Panel inferior: crema suave semitransparente (sin amarillos) y borde borgoña discreto. */
  const cream = rgb(0.98, 0.965, 0.94);
  const creamBorder = rgb(58 / 255, 14 / 255, 22 / 255);
  const inkTitle = rgb(62 / 255, 8 / 255, 22 / 255);
  const inkBody = rgb(28 / 255, 10 / 255, 14 / 255);
  const inkAccent = rgb(110 / 255, 18 / 255, 36 / 255);

  const titulo = String(nombreProyecto || 'EVENTO').trim() || 'EVENTO';
  const fechaStr = `Fecha : ${String(fecha || '—').trim()}`;
  const nombreStr = `Nombre : ${String(nombre || '—').trim().slice(0, 72)}`;
  const cantStr = `Cantidad : ${String(cantidad ?? '—')}`;
  const horaStr = `Hora del evento : ${String(hora || '—').trim()}`;
  const dirStr = `Dirección : ${String(direccion || '—').trim()}`;
  const codigoStr = `Código boleta : ${String(codigoBoleta || '—').trim()}`;

  const bandPadX = 22;
  const bandPadTop = 20;
  const bandPadBottom = 18;
  const logoGap = 14;
  const logoMargin = 12;
  const textW = L - bandPadX * 2 - (logoImg ? logoDrawW + logoGap : 0);
  const textX = bandPadX;

  const titleSzStart = 22;
  const fechaSz = 13;
  const bodySz = 12.5;
  const horaSz = 12;
  const dirSz = 11.5;
  const codigoSz = 13;

  let titleSz = titleSzStart;
  const minTitle = 11;
  while (titleSz >= minTitle) {
    const tlTry = wrapLines(titulo.slice(0, 200), textW, titleSz, fontBold);
    const blockTry = tlTry.length * (titleSz + 7) + 8;
    if (blockTry <= H * 0.2) break;
    titleSz -= 1;
  }

  const titleLines = wrapLines(titulo.slice(0, 200), textW, titleSz, fontBold);
  const titleBlockH = titleLines.length * (titleSz + 7) + 8;
  const dirLines = wrapLines(dirStr, textW, dirSz, fontBold).length;
  let contentH =
    bandPadTop +
    titleBlockH +
    (fechaSz + 7) +
    (bodySz + 7) * 2 +
    10 +
    (horaSz + 7) +
    dirLines * (dirSz + 6) +
    10 +
    (codigoSz + 8) +
    bandPadBottom;

  const bandH = Math.min(H * 0.44, Math.max(158, contentH));
  const bandTop = bandH;

  page.drawRectangle({
    x: 0,
    y: 0,
    width: L,
    height: bandH,
    color: cream,
    opacity: 0.86,
    borderColor: creamBorder,
    borderWidth: 1.1,
  });
  for (let s = 0; s < 9; s++) {
    const h = 4;
    const y0 = bandTop - (s + 1) * h;
    page.drawRectangle({
      x: 0,
      y: y0,
      width: L,
      height: h,
      color: cream,
      opacity: 0.06 * (9 - s),
    });
  }

  let y = bandTop - bandPadTop;
  y = drawLeftBoldLines(page, titulo.slice(0, 200), titleSz, textX, y, textW, inkTitle, fontBold, 7);
  y -= 4;
  y = drawLeftBoldLines(page, fechaStr, fechaSz, textX, y, textW, inkAccent, fontBold, 7);
  y -= 2;
  y = drawLeftBoldLines(page, nombreStr, bodySz, textX, y, textW, inkBody, fontBold, 6);
  y = drawLeftBoldLines(page, cantStr, bodySz, textX, y, textW, inkBody, fontBold, 6);
  y -= 4;
  y = drawLeftBoldLines(page, horaStr, horaSz, textX, y, textW, inkBody, fontBold, 6);
  y = drawLeftBoldLines(page, dirStr, dirSz, textX, y, textW, inkBody, fontBold, 5.5);
  y -= 4;
  drawLeftBoldLines(page, codigoStr, codigoSz, textX, y, textW, inkAccent, fontBold, 6);

  if (logoImg) {
    const lx = L - logoMargin - logoDrawW;
    const ly = logoMargin;
    page.drawImage(logoImg, {
      x: lx,
      y: ly,
      width: logoDrawW,
      height: logoDrawH,
    });
  }

  return pdfDoc.save();
}

module.exports = { buildBoletaPdf, W, H };
