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

/** Logo boleta: PNG corporativo en `public/assets/logo-tava-boleta.png`; si no existe, convierte el SVG legacy. */
async function loadBoletaLogoPng() {
  const pngPath = path.join(__dirname, '..', 'public', 'assets', 'logo-tava-boleta.png');
  if (fs.existsSync(pngPath)) {
    try {
      const sharp = require('sharp');
      return await sharp(pngPath).png().resize({ width: 220, height: 220, fit: 'inside' }).toBuffer();
    } catch {
      try {
        return fs.readFileSync(pngPath);
      } catch {
        /* sigue al fallback */
      }
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

  const logoPng = await loadBoletaLogoPng();
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

  /** Panel inferior claro (toda la anchura de la mitad boleta). */
  const cream = rgb(0.99, 0.975, 0.945);
  const creamShadow = rgb(0.88, 0.82, 0.76);
  const goldLine = rgb(0.78, 0.58, 0.22);
  const goldBright = rgb(0.95, 0.82, 0.42);
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
    borderColor: goldLine,
    borderWidth: 2.5,
  });
  page.drawRectangle({
    x: 0,
    y: bandTop - 6,
    width: L,
    height: 6,
    color: goldBright,
  });
  page.drawRectangle({
    x: 10,
    y: bandTop - 8,
    width: L - 20,
    height: 2,
    color: creamShadow,
  });

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
