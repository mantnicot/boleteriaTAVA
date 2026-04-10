<<<<<<< HEAD
# Sistema de boletería TAVA teatro

Interfaz HTML/CSS/JS, **Node.js (Express)** y **Google Sheets + Google Drive** usando **tu cuenta Gmail personal** (OAuth 2.0). No se usa cuenta de servicio.

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

5. Arranca el servidor y abre en el navegador **`http://localhost:3000/auth/google`** (o el enlace del pie de página). Acepta permisos. Los tokens se guardan en `data/google-oauth-tokens.json` (no lo subas a git).

## Variables `.env`

- **`GOOGLE_CLIENT_ID`** y **`GOOGLE_CLIENT_SECRET`**: credenciales OAuth (aplicación web).
- **`GOOGLE_REDIRECT_URI`**: opcional; por defecto `http://localhost:PUERTO/oauth2callback`.
- **`GOOGLE_DRIVE_FOLDER_ID`**: opcional. Si no lo pones, se usa la carpeta por defecto del proyecto (ID de la carpeta que indicaste para las imágenes de boleta).
- **`GOOGLE_SHEETS_ID`**: opcional; si está vacío, la primera vez que todo funcione se crea una hoja en **tu** Drive y el ID se guarda en `data/spreadsheet-id.txt`.
- **SMTP** y **`MAIL_FROM`**: para enviar boletas por correo. Si dejas `SMTP_USER` y `SMTP_PASS` vacíos, la boleta se crea y descarga igual; solo no se envía correo (mensaje informativo, no error).
  - Con **Gmail**: en tu cuenta Google activa **verificación en 2 pasos**, luego crea una **contraseña de aplicación** (Seguridad → Contraseñas de aplicaciones) y ponla en `SMTP_PASS`. `SMTP_USER` es tu correo completo; `MAIL_FROM` puede ser el mismo correo.

## Arranque

```bash
npm install
npm start
```

Abre `http://localhost:3000`. Si no has vinculado Google, el sistema te ofrecerá abrir la página de consentimiento.

**Windows:** puedes usar `Mucha mierda.bat`.

## Dónde se guardan los datos

- **Hoja de cálculo**: en tu Google Drive (creada por la app o la que indiques en `GOOGLE_SHEETS_ID`).
- **Imágenes de fondo de boleta**: en la carpeta de Drive configurada (`GOOGLE_DRIVE_FOLDER_ID` o la carpeta por defecto con ID `1j8p6D1esaJ8iGUhzo20DsG1TcMvkzdDq`).

## Archivos útiles en código

- [`server/auth.js`](server/auth.js) — OAuth, scopes y tokens.
- [`server/drive.js`](server/drive.js) — subida a tu carpeta de Drive.
- [`server/sheets.js`](server/sheets.js) — lectura/escritura de la base en Sheets.

## Notas

- Si revocas el acceso en [tu cuenta Google](https://myaccount.google.com/permissions), borra `data/google-oauth-tokens.json` y vuelve a entrar en `/auth/google`.
- El archivo `server/credentials.json` (si existe) **no** se usa en esta versión; todo va por OAuth y `.env`.
=======
# boleteriaTAVA
Sistema para sistema de boleteria de TAVA
>>>>>>> 412863634d23b2a3a98fd54b421b3cbc29957adb
