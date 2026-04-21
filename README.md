# Sistema de boletería TAVA teatro

Interfaz HTML/CSS/JS, **Next.js** (API `app/api/[...slug]/route.js`) y **Google Sheets + Google Drive** con **tu cuenta Gmail personal** (OAuth 2.0). No se usa cuenta de servicio.

## Requisitos

- Node.js 18+
- Cuenta Google personal
- Proyecto en [Google Cloud Console](https://console.cloud.google.com/) con **Google Sheets API** y **Google Drive API** habilitadas

## Configuración OAuth (una vez)

1. En Google Cloud → **APIs y servicios** → **Pantalla de consentimiento de OAuth**: tipo “Externo”, añade tu correo como usuario de prueba si la app está en pruebas.
2. **Credenciales** → **Crear credenciales** → **ID de cliente OAuth** → tipo **Aplicación web**.
3. En **URI de redirección autorizados** agrega exactamente:
   - `http://localhost:3000/oauth2callback`  
   (Si cambias el puerto en `.env`, usa el mismo puerto aquí y en `GOOGLE_REDIRECT_URI`.)
4. Copia el **ID de cliente** y el **Secreto del cliente** al archivo `.env` (ver `.env.example`).

5. Arranca el servidor y abre en el navegador **`http://localhost:3000/auth/google`**. Acepta permisos. Los tokens se guardan en `data/google-oauth-tokens.json` (no lo subas a git).

## Variables `.env` (resumen)

- **`GOOGLE_CLIENT_ID`** y **`GOOGLE_CLIENT_SECRET`**: credenciales OAuth (aplicación web).
- **`GOOGLE_REDIRECT_URI`**: opcional; por defecto `http://localhost:PUERTO/oauth2callback`.
- **`PUBLIC_BASE_URL`**: base pública de la app (sin barra final), ej. `https://tudominio.com` o `http://localhost:3000`. Se usa en el **código QR** de la boleta (PDF) para abrir `index.html#verificacion?qr=...`. En local deja `http://localhost:3000` o el puerto de `next dev`.
- **`VERIFICACION_QR_SECRET`**: opcional. Firma HMAC de los tokens del QR; por defecto se reutiliza `APP_SESSION_SECRET` o `GOOGLE_CLIENT_SECRET` (cambiar en producción).
- **`APP_SESSION_SECRET`**: secret para la cookie de sesión del correo (boletería y verificación en puerta).
- **`GOOGLE_DRIVE_FOLDER_ID`**, **`GOOGLE_SHEETS_ID`**: opcionales (ver comentarios en `.env.example` si lo creas).
- **SMTP** / **`MAIL_FROM`**: ver `.env.example`.

## Arranque

```bash
npm install
npm run dev
```

En producción: `npm run build` y `npm start`. Abre `http://localhost:3000` (o el puerto que muestre Next). Si no has vinculado Google, el flujo de setup te ofrecerá conectar.

**Windows:** puedes usar `Mucha mierda.bat` si existe en el repo.

## Verificación de ingreso (puerta)

- Tras **iniciar sesión con el mismo correo** que el resto de la boletería, en el menú: **VERIFICACIÓN** (`#verificacion`).
- Solo se listan **eventos que ya tienen al menos una boleta**. Puedes registrar ingresos por fila, escanear el **QR** del PDF (cámara o imagen) o abrir en el móvil el enlace del QR: debe coincidir el **mismo evento** seleccionado en pantalla; el token del QR va firmado en servidor.
- **Fecha de acceso:** la verificación de ingreso solo aplica **desde el día de la función** de la boleta (zona `America/Bogota`) en adelante. Antes, la API y la UI responden con el mensaje fijo: *«La fecha del evento no se ha habilitado»* (código `NOT_ENABLED`).
- Mensajes mostrados al personal: solo *«Se validó»*, *«Ya está validada la boleta»* o *«La fecha del evento no se ha habilitado»* (incluye QR inválido, evento distinto, o fuera de fecha).
- **Persistencia:** en la hoja `Boletas` se añadieron columnas `ingresados` y `verificacionUpdatedAt` (ver `server/sheets.js`). Hojas antiguas: al escribir la primera verificación, Google Sheets expande la fila; conviene añadir manualmente los títulos de columna M y N en la fila 1.
- **Reporte:** botón *Generar reporte* (Excel) con hojas de ingresos completos y pendientes/parciales.

## Dónde se guardan los datos

- **Hoja de cálculo** en Google Drive.
- **Imágenes de fondo de boleta** en Drive (carpeta configurada).

## Archivos útiles en código

- [`server/auth.js`](server/auth.js) — OAuth, scopes y tokens.
- [`server/drive.js`](server/drive.js) — subida a Drive.
- [`server/sheets.js`](server/sheets.js) — filas de eventos y boletas.
- [`server/verificacionToken.js`](server/verificacionToken.js) — firma del token del QR.
- [`server/verificacionService.js`](server/verificacionService.js) — lógica de ingreso/escáner.

## Notas

- Si revocas el acceso en [tu cuenta Google](https://myaccount.google.com/permissions), borra `data/google-oauth-tokens.json` y vuelve a vincular en `/auth/google`.
