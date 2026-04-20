const nodemailer = require('nodemailer');

function isSmtpConfigured() {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  return !!(host && user && pass);
}

function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Cuerpo HTML con estética teatral (telón, máscaras sugeridas en tipografía y color).
 */
function buildBoletaEmailHtml({ eventName, holderName, codigo, fecha }) {
  const ev = escapeHtml(eventName);
  const who = escapeHtml(holderName);
  const code = escapeHtml(codigo);
  const when = escapeHtml(fecha);
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Boleta TAVA Teatro</title>
</head>
<body style="margin:0;padding:0;background:#1a0a0e;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(180deg,#2d0a12 0%,#1a0508 40%,#0d0305 100%);padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;background:#fff9f5;border-radius:12px;overflow:hidden;border:3px solid #5c0c1e;box-shadow:0 12px 40px rgba(0,0,0,0.45);">
          <tr>
            <td style="background:linear-gradient(90deg,#5c0c1e,#7a1027,#5c0c1e);padding:18px 22px;text-align:center;">
              <p style="margin:0;font-size:11px;letter-spacing:0.35em;color:#f5d6a8;text-transform:uppercase;">TAVA Teatro</p>
              <h1 style="margin:8px 0 0;font-size:22px;font-weight:700;color:#fff;letter-spacing:0.06em;line-height:1.25;text-shadow:0 2px 8px rgba(0,0,0,0.35);">¡Bienvenid@ al tablado!</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 26px 8px;text-align:center;">
              <p style="margin:0;font-size:42px;line-height:1;color:#5c0c1e;opacity:0.9;">&#127917;&#127916;</p>
              <p style="margin:12px 0 0;font-size:15px;color:#3d2a2e;line-height:1.55;">
                Su <strong>boleta en PDF</strong> va adjunta. Consérvela para el ingreso al evento.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 26px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5ebe8;border-radius:10px;border:1px solid #d4b8b8;">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.12em;color:#7a1027;text-transform:uppercase;font-family:system-ui,sans-serif;font-weight:700;">Obra o evento</p>
                    <p style="margin:0 0 18px;font-size:17px;color:#1a0a0c;font-weight:700;">${ev}</p>
                    <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.12em;color:#7a1027;text-transform:uppercase;font-family:system-ui,sans-serif;font-weight:700;">Titular de la boleta</p>
                    <p style="margin:0 0 18px;font-size:16px;color:#1a0a0c;">${who}</p>
                    <p style="margin:0 0 6px;font-size:12px;color:#5c4a4d;font-family:system-ui,sans-serif;">Código de boleta</p>
                    <p style="margin:0 0 14px;font-size:15px;font-family:ui-monospace,monospace;font-weight:700;color:#5c0c1e;">${code}</p>
                    <p style="margin:0;font-size:12px;color:#6a5a5d;font-family:system-ui,sans-serif;">Fecha del evento (referencia): <strong>${when}</strong></p>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0;text-align:center;font-size:12px;color:#8a7578;font-style:italic;line-height:1.5;">
                Entre bastidores o frente al telón — gracias por apoyar el teatro TAVA.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#5c0c1e;padding:12px;text-align:center;">
              <p style="margin:0;font-size:11px;color:#f0ddd0;letter-spacing:0.08em;">Sistema de boletería TAVA Teatro</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendBoletaEmail({
  to,
  subject,
  pdfBuffer,
  fileName,
  html,
  eventName,
  holderName,
  codigo,
  fecha,
}) {
  const transporter = createTransporter();
  if (!transporter) {
    throw new Error(
      'SMTP no configurado. Defina SMTP_HOST, SMTP_USER y SMTP_PASS en .env para enviar correos.'
    );
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const htmlBody =
    html ||
    buildBoletaEmailHtml({
      eventName: eventName || 'Evento',
      holderName: holderName || 'Titular',
      codigo: codigo || '—',
      fecha: fecha || '—',
    });

  await transporter.sendMail({
    from,
    to,
    subject: subject || 'Su boleta — TAVA Teatro',
    text: `Boleta TAVA Teatro — ${eventName || 'Evento'}\nTitular: ${holderName || '—'}\nCódigo: ${codigo || '—'}\n\nAdjunto: su boleta en PDF.`,
    html: htmlBody,
    attachments: [
      {
        filename: fileName || 'boleta.pdf',
        content: pdfBuffer,
        contentType: 'application/pdf',
      },
    ],
  });
}

module.exports = {
  sendBoletaEmail,
  createTransporter,
  isSmtpConfigured,
  buildBoletaEmailHtml,
};
