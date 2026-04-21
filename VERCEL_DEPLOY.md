# Deploy a Vercel (Next.js)

## 1) Variables de entorno en Vercel

Configura estas variables en el proyecto de Vercel:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (ejemplo: `https://tu-app.vercel.app/oauth2callback`)
- `GOOGLE_OAUTH_TOKENS_JSON` (recomendado para no depender de archivos locales)
- `APP_SESSION_SECRET` (clave larga para firmar sesión de login por correo)
- `APP_LOGIN_ALLOWED_EMAILS` (correos autorizados separados por coma)
- `GOOGLE_SHEETS_ID` (recomendado en producción)
- `GOOGLE_DRIVE_FOLDER_ID`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`

## 2) OAuth en Google Cloud

En Google Cloud Console:

- Tipo de credencial: OAuth client ID (Aplicación web)
- Authorized redirect URIs: agrega la URL exacta de Vercel:
  - `https://tu-app.vercel.app/oauth2callback`

## 3) Comandos del proyecto

Este proyecto ya quedó preparado con scripts de Next.js:

- `npm run dev`
- `npm run build`
- `npm start`

## 4) Nota importante

En serverless no se debe depender de archivos locales para persistencia.  
Por eso en producción usa:

- `GOOGLE_OAUTH_TOKENS_JSON`
- `GOOGLE_SHEETS_ID`

de forma que la app no necesite escribir en `data/`.

## 5) Error `invalid_client` o bucle a Google

Significa que **Google no reconoce el cliente OAuth** que usan Vercel y el código.

1. En [Google Cloud Console](https://console.cloud.google.com/) → **APIs y servicios** → **Credenciales**, abre el tipo **ID de cliente OAuth (aplicación web)**.
2. Copia el **ID de cliente** y el **Secreto del cliente** (no uses otro tipo de clave, ni de escritorio, ni de iOS).
3. En Vercel → **Settings** → **Environment variables**, pega:
   - `GOOGLE_CLIENT_ID` = el mismo string completo
   - `GOOGLE_CLIENT_SECRET` = el mismo secreto
4. Añade en **URIs de redirección autorizados** (en esa misma credencial web):
   - `https://<tu-dominio-en-vercel>/oauth2callback`  
   exactamente igual, con `https`, sin barra al final, sin otra ruta.
5. En Vercel define también:
   - `GOOGLE_REDIRECT_URI` = `https://<mismo-dominio>/oauth2callback`
6. Vuelve a desplegar (o **Redeploy**). Tras cambiar variables, hace falta un deploy nuevo a veces.
7. En el navegador, vuelve a **Entrar al escenario** con tu correo (limpia caché o ventana de incógnito si hace falta).
