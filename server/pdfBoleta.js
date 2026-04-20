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
      .resize(32, Math.max(2, Math.round(32 * ratio)), { fit: 'cover', position: 'centre' })
      .blur(10)
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

/** Bandas rojas al ras del borde + texto blanco en negrita (HelveticaBold). */
function drawBannerLeft(page, fontBold, text, size, xText, yBaseline, L, white, bandFill, bandAccent) {
  const tw = fontBold.widthOfTextAtSize(text, size);
  const h = size + 18;
  const y0 = yBaseline - 7;
  const x0 = 4;
  const w = Math.min(L - 8, xText + tw + 22 - x0);
  page.drawRectangle({ x: x0, y: y0, width: w, height: h, color: bandFill });
  page.drawRectangle({ x: x0, y: y0, width: 7, height: h, color: bandAccent });
  page.drawText(text, { x: xText, y: yBaseline, size, font: fontBold, color: white });
}

function drawBannerCenter(page, fontBold, text, size, yBaseline, L, white, bandFill) {
  const tw = fontBold.widthOfTextAtSize(text, size);
  const h = size + 18;
  const y0 = yBaseline - 7;
  const pad = 26;
  const w = tw + pad * 2;
  const x0 = (L - w) / 2;
  page.drawRectangle({ x: x0, y: y0, width: w, height: h, color: bandFill });
  page.drawText(text, { x: (L - tw) / 2, y: yBaseline, size, font: fontBold, color: white });
}

function drawBannerRightLine(page, fontBold, text, size, xRight, yBaseline, L, white, bandFill, bandAccent) {
  const tw = fontBold.widthOfTextAtSize(text, size);
  const xText = xRight - tw;
  const h = size + 16;
  const y0 = yBaseline - 6;
  const x0 = Math.max(10, xText - 22);
  const w = L - 8 - x0;
  page.drawRectangle({ x: x0, y: y0, width: w, height: h, color: bandFill });
  page.drawRectangle({ x: x0 + w - 7, y: y0, width: 7, height: h, color: bandAccent });
  page.drawText(text, { x: xText, y: yBaseline, size, font: fontBold, color: white });
}

function drawWrappedRightBanners(
  page,
  text,
  xRight,
  yTopBaseline,
  maxW,
  size,
  fontBold,
  L,
  white,
  bandFill,
  bandAccent,
  lineGap = 6
) {
  const lines = wrapLines(text, maxW, size, fontBold);
  let y = yTopBaseline;
  const step = size + 26 + lineGap;
  for (const ln of lines) {
    drawBannerRightLine(page, fontBold, ln, size, xRight, y, L, white, bandFill, bandAccent);
    y -= step;
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
  const pad = 20;

  /** Alineado con tema web: --burgundy-dark #5c0c1e, --burgundy #7a1027 */
  const themeDark = rgb(92 / 255, 12 / 255, 30 / 255);
  const themeBurgundy = rgb(122 / 255, 16 / 255, 39 / 255);
  const bandFill = rgb(58 / 255, 6 / 255, 18 / 255);
  const bandAccent = rgb(100 / 255, 14 / 255, 32 / 255);
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

  const logoX = L - pad - logoDrawW;
  const logoY = pad;

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
        opacity: 0.7,
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

  const bodySize = 17;
  const fechaSz = 18;
  const horaSz = 16;
  const dirSz = 15;
  const codigoSz = 16;

  const fechaStr = `Fecha : ${String(fecha || '—').trim()}`;
  const fechaY = H - pad - fechaSz;
  drawBannerCenter(page, fontBold, fechaStr, fechaSz, fechaY, L, white, bandFill);

  const yMid = H * 0.58;
  let yLeft = yMid;
  const nombreStr = `Nombre : ${String(nombre || '—').trim().slice(0, 72)}`;
  drawBannerLeft(page, fontBold, nombreStr, bodySize, pad, yLeft, L, white, bandFill, bandAccent);
  yLeft -= bodySize + 38;
  const cantStr = `Cantidad : ${String(cantidad ?? '—')}`;
  drawBannerLeft(page, fontBold, cantStr, bodySize, pad, yLeft, L, white, bandFill, bandAccent);

  const textRightEdge = logoImg ? logoX - 14 : L - pad;
  const blockMaxW = Math.max(140, textRightEdge - pad - 8);

  const titulo = String(nombreProyecto || 'EVENTO').trim() || 'EVENTO';
  const horaStr = `Hora del evento : ${String(hora || '—').trim()}`;
  const dirStr = `Dirección : ${String(direccion || '—').trim()}`;
  const dirLines = wrapLines(dirStr, blockMaxW, dirSz, fontBold);

  const stackBottom = logoY + logoDrawH + 52;
  const lineGapTitle = 6;
  const lineGapAddr = 6;
  const gapBeforeHora = 14;
  const gapAfterHora = 14;
  const dirStep = dirSz + 26 + lineGapAddr;

  let titleSize = 28;
  const minTitle = 16;
  while (titleSize >= minTitle) {
    const titleLines = wrapLines(titulo.slice(0, 200), blockMaxW, titleSize, fontBold);
    const nTit = titleLines.length;
    const addrSpan = dirLines.length > 0 ? (dirLines.length - 1) * dirStep : 0;
    const yTopAddr = stackBottom + addrSpan;
    const yHora = yTopAddr + dirSz + gapAfterHora;
    const yLowTitle = yHora + horaSz + gapBeforeHora;
    const titleBlockH = nTit > 0 ? (nTit - 1) * (titleSize + 26 + lineGapTitle) + titleSize : titleSize;
    const yTopTitle = yLowTitle + titleBlockH - titleSize;
    if (yTopTitle <= H - pad - 8 && yTopTitle > yLeft - 24) break;
    titleSize -= 1;
  }

  const titleLines = wrapLines(titulo.slice(0, 200), blockMaxW, titleSize, fontBold);
  const nTit = titleLines.length;
  const addrSpan = dirLines.length > 0 ? (dirLines.length - 1) * dirStep : 0;
  const yTopAddr = stackBottom + addrSpan;
  const yHora = yTopAddr + dirSz + gapAfterHora;
  const yLowTitle = yHora + horaSz + gapBeforeHora;
  let yTopTitle = nTit > 0 ? yLowTitle + (nTit - 1) * (titleSize + 26 + lineGapTitle) : yLowTitle;

  if (yTopTitle > H - pad - 8) {
    yTopTitle = H - pad - 8;
  }

  drawWrappedRightBanners(
    page,
    titulo.slice(0, 200),
    textRightEdge,
    yTopTitle,
    blockMaxW,
    titleSize,
    fontBold,
    L,
    white,
    bandFill,
    bandAccent,
    lineGapTitle
  );

  drawBannerRightLine(page, fontBold, horaStr, horaSz, textRightEdge, yHora, L, white, bandFill, bandAccent);

  for (let i = 0; i < dirLines.length; i++) {
    const ln = dirLines[i];
    const yLn = yTopAddr - i * dirStep;
    drawBannerRightLine(page, fontBold, ln, dirSz, textRightEdge, yLn, L, white, bandFill, bandAccent);
  }

  const codigoStr = `Código boleta : ${String(codigoBoleta || '—').trim()}`;
  drawBannerLeft(page, fontBold, codigoStr, codigoSz, pad, stackBottom, L, white, bandFill, bandAccent);

  if (logoImg) {
    page.drawRectangle({
      x: logoX - 3,
      y: logoY - 3,
      width: logoDrawW + 6,
      height: logoDrawH + 6,
      color: rgb(1, 1, 1),
      opacity: 0.92,
    });
    page.drawImage(logoImg, {
      x: logoX,
      y: logoY,
      width: logoDrawW,
      height: logoDrawH,
    });
  }

  return pdfDoc.save();
}

module.exports = { buildBoletaPdf, W, H };
