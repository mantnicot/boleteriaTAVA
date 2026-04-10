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

  const maroonPanel = rgb(0.375, 0, 0);
  const white = rgb(1, 1, 1);
  const ink = rgb(0.02, 0.02, 0.02);

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
      color: maroonPanel,
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
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: maroonPanel });
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
    } else {
      page.drawRectangle({
        x: 0,
        y: 0,
        width: L,
        height: H,
        color: rgb(0.55, 0.45, 0.45),
      });
    }
  } else {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: L,
      height: H,
      color: rgb(0.55, 0.45, 0.45),
    });
  }

  const bodySize = 12;

  const fechaStr = `Fecha : ${String(fecha || '—').trim()}`;
  const fechaSz = 11;
  const fechaW = fontBold.widthOfTextAtSize(fechaStr, fechaSz);
  page.drawText(fechaStr, {
    x: (L - fechaW) / 2,
    y: H - pad - fechaSz,
    size: fechaSz,
    font: fontBold,
    color: ink,
  });

  const yMid = H * 0.52;
  let yLeft = yMid;
  page.drawText(`Nombre : ${String(nombre || '—').trim().slice(0, 80)}`, {
    x: pad,
    y: yLeft,
    size: bodySize,
    font: fontBold,
    color: ink,
  });
  yLeft -= bodySize + 14;
  page.drawText(`Cantidad : ${String(cantidad ?? '—')}`, {
    x: pad,
    y: yLeft,
    size: bodySize,
    font: fontBold,
    color: ink,
  });

  const textRightEdge = logoImg ? logoX - 10 : L - pad;
  const blockMaxW = Math.max(120, textRightEdge - pad);

  const titulo = String(nombreProyecto || 'EVENTO').trim() || 'EVENTO';
  const horaStr = `Hora del evento : ${String(hora || '—').trim()}`;
  const dirStr = `Dirección : ${String(direccion || '—').trim()}`;
  const dirLines = wrapLines(dirStr, blockMaxW, 10, fontBold);

  const stackBottom = logoY + logoDrawH + 14;
  const lineGapTitle = 3.5;
  const lineGapAddr = 3.2;
  const gapBeforeHora = 10;
  const gapAfterHora = 10;

  let titleSize = 22;
  const minTitle = 11;
  while (titleSize >= minTitle) {
    const titleLines = wrapLines(titulo.slice(0, 200), blockMaxW, titleSize, fontBold);
    const nTit = titleLines.length;
    const addrSpan =
      dirLines.length > 0 ? (dirLines.length - 1) * (10 + lineGapAddr) : 0;
    const yTopAddr = stackBottom + addrSpan;
    const yHora = yTopAddr + 10 + gapAfterHora;
    const yLowTitle = yHora + 11 + gapBeforeHora;
    const yTopTitle =
      nTit > 0 ? yLowTitle + (nTit - 1) * (titleSize + lineGapTitle) : yLowTitle;
    if (yTopTitle <= H - pad && yTopTitle > yLeft + 20) break;
    titleSize -= 1;
  }

  const titleLines = wrapLines(titulo.slice(0, 200), blockMaxW, titleSize, fontBold);
  const nTit = titleLines.length;
  const addrSpan = dirLines.length > 0 ? (dirLines.length - 1) * (10 + lineGapAddr) : 0;
  const yTopAddr = stackBottom + addrSpan;
  const yHora = yTopAddr + 10 + gapAfterHora;
  const yLowTitle = yHora + 11 + gapBeforeHora;
  let yTopTitle = nTit > 0 ? yLowTitle + (nTit - 1) * (titleSize + lineGapTitle) : yLowTitle;

  if (yTopTitle > H - pad - 6) {
    yTopTitle = H - pad - 6;
  }

  drawWrappedRight(
    page,
    titulo.slice(0, 200),
    textRightEdge,
    yTopTitle,
    blockMaxW,
    titleSize,
    fontBold,
    ink,
    lineGapTitle
  );

  page.drawText(horaStr, {
    x: textRightEdge - fontBold.widthOfTextAtSize(horaStr, 11),
    y: yHora,
    size: 11,
    font: fontBold,
    color: ink,
  });

  for (let i = 0; i < dirLines.length; i++) {
    const ln = dirLines[i];
    const tw = fontBold.widthOfTextAtSize(ln, 10);
    const yLn = yTopAddr - i * (10 + lineGapAddr);
    page.drawText(ln, {
      x: textRightEdge - tw,
      y: yLn,
      size: 10,
      font: fontBold,
      color: ink,
    });
  }

  const codigoStr = `Código boleta : ${String(codigoBoleta || '—').trim()}`;
  page.drawText(codigoStr, {
    x: pad,
    y: stackBottom,
    size: 11,
    font: fontBold,
    color: ink,
  });

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
