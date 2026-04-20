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

async function loadLogoPngSmall() {
  const svgPath = path.join(__dirname, '..', 'public', 'assets', 'logo-tava.svg');
  if (!fs.existsSync(svgPath)) return null;
  try {
    const sharp = require('sharp');
    return await sharp(svgPath).png().resize({ width: 88, height: 104, fit: 'inside' }).toBuffer();
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

/** Texto centrado en columna (boleta artística). */
function drawCenteredLines(page, fontBold, text, size, cx, yTop, maxW, white, lineGap = 8) {
  const lines = wrapLines(String(text), maxW, size, fontBold);
  let y = yTop;
  for (const ln of lines) {
    const tw = fontBold.widthOfTextAtSize(ln, size);
    page.drawText(ln, { x: cx - tw / 2, y, size, font: fontBold, color: white });
    y -= size + lineGap;
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

function pickTermsFontSize(terms, maxW, font, yTop, bottomMin, maxSize = 9.5, minSize = 4.5) {
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

function drawTermsOnPage(page, lines, startLine, termsX, yTop, size, font, color, bottomMin) {
  let ly = yTop;
  let i = startLine;
  const lineStep = size + 3.15;
  while (i < lines.length && ly >= bottomMin) {
    const ln = lines[i];
    page.drawText(ln.length > 500 ? `${ln.slice(0, 497)}…` : ln, {
      x: termsX,
      y: ly,
      size,
      font,
      color,
    });
    ly -= lineStep;
    i += 1;
  }
  return i;
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

  const logoPng = await loadLogoPngSmall();
  let logoImg = null;
  if (logoPng && logoPng.length) {
    try {
      logoImg = await pdfDoc.embedPng(logoPng);
    } catch {
      logoImg = null;
    }
  }

  let logoDrawW = 0;
  let logoDrawH = 0;
  if (logoImg) {
    const ar = logoImg.height / logoImg.width;
    logoDrawW = Math.min(76, logoImg.width);
    logoDrawH = logoDrawW * ar;
  }

  const termsPad = 26;
  const termsInnerW = W - splitX - termsPad * 2;
  const termsX = splitX + termsPad;
  const termsHeaderY = H - termsPad - 14;
  const termsBodyTop = termsHeaderY - 26;
  const termsBottomMin = 38;

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

  function drawTermsHeader(p, headerText) {
    p.drawText(headerText, {
      x: termsX,
      y: termsHeaderY,
      size: 14,
      font: fontBold,
      color: white,
    });
  }

  drawRightPanelMaroon(page);
  drawTermsHeader(page, 'Términos y condiciones');

  lineIdx = drawTermsOnPage(
    page,
    termLineList,
    lineIdx,
    termsX,
    termsBodyTop,
    termsFontSize,
    font,
    white,
    termsBottomMin
  );

  let contLines =
    lineIdx < termLineList.length
      ? termLines(termLineList.slice(lineIdx).join(' '), W - termsPad * 2, termsFontSize, font)
      : [];
  let contIdx = 0;

  while (contIdx < contLines.length) {
    page = pdfDoc.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: themeBurgundy });
    const contHeaderY = H - termsPad - 14;
    page.drawText('Términos y condiciones (continuación)', {
      x: termsPad,
      y: contHeaderY,
      size: 12,
      font: fontBold,
      color: white,
    });
    const contBodyTop = contHeaderY - 22;
    contIdx = drawTermsOnPage(
      page,
      contLines,
      contIdx,
      termsPad,
      contBodyTop,
      termsFontSize,
      font,
      white,
      termsBottomMin
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
        opacity: 0.4,
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

  const cx = L / 2;
  const cardW = Math.min(400, L - 28);
  const innerW = cardW - 48;
  const cardPanel = rgb(36 / 255, 5 / 255, 12 / 255);
  const goldLine = rgb(0.9, 0.78, 0.62);

  const titulo = String(nombreProyecto || 'EVENTO').trim() || 'EVENTO';
  const fechaStr = `Fecha : ${String(fecha || '—').trim()}`;
  const nombreStr = `Nombre : ${String(nombre || '—').trim().slice(0, 72)}`;
  const cantStr = `Cantidad : ${String(cantidad ?? '—')}`;
  const horaStr = `Hora del evento : ${String(hora || '—').trim()}`;
  const dirStr = `Dirección : ${String(direccion || '—').trim()}`;
  const codigoStr = `Código boleta : ${String(codigoBoleta || '—').trim()}`;

  const fechaSz = 17;
  const titleSzStart = 23;
  const bodySz = 15;
  const horaSz = 14;
  const dirSz = 13;
  const codigoSz = 15;

  let titleSz = titleSzStart;
  const minTitle = 12;
  while (titleSz >= minTitle) {
    const titleH =
      wrapLines(titulo.slice(0, 200), innerW, titleSz, fontBold).length * (titleSz + 8);
    if (titleH <= H * 0.26) break;
    titleSz -= 1;
  }

  const innerStackH = () => {
    let h = 28;
    h += logoImg ? logoDrawH + 14 : 0;
    h += fechaSz + 10;
    h += wrapLines(titulo.slice(0, 200), innerW, titleSz, fontBold).length * (titleSz + 8) + 18;
    h += (bodySz + 10) * 2 + 12;
    h += horaSz + 10;
    h += wrapLines(dirStr, innerW, dirSz, fontBold).length * (dirSz + 7) + 14;
    h += codigoSz + 22;
    return h;
  };

  const cardH = Math.min(H - 20, Math.max(innerStackH(), H * 0.56));
  const cardBottomY = (H - cardH) / 2;
  const xCard = (L - cardW) / 2;

  page.drawRectangle({
    x: xCard,
    y: cardBottomY,
    width: cardW,
    height: cardH,
    color: cardPanel,
    borderColor: goldLine,
    borderWidth: 1,
  });

  let y = cardBottomY + cardH - 24;
  if (logoImg) {
    const lx = cx - logoDrawW / 2;
    y -= logoDrawH;
    page.drawImage(logoImg, {
      x: lx,
      y,
      width: logoDrawW,
      height: logoDrawH,
    });
    y -= 12;
  }
  y = drawCenteredLines(page, fontBold, fechaStr, fechaSz, cx, y, innerW, white, 9);
  y -= 8;
  y = drawCenteredLines(page, fontBold, titulo.slice(0, 200), titleSz, cx, y, innerW, white, 9);
  y -= 10;
  y = drawCenteredLines(page, fontBold, nombreStr, bodySz, cx, y, innerW, white, 9);
  y -= 6;
  y = drawCenteredLines(page, fontBold, cantStr, bodySz, cx, y, innerW, white, 9);
  y -= 10;
  y = drawCenteredLines(page, fontBold, horaStr, horaSz, cx, y, innerW, white, 8);
  y -= 8;
  y = drawCenteredLines(page, fontBold, dirStr, dirSz, cx, y, innerW, white, 7);
  y -= 12;
  drawCenteredLines(page, fontBold, codigoStr, codigoSz, cx, y, innerW, white, 8);

  return pdfDoc.save();
}

module.exports = { buildBoletaPdf, W, H };
