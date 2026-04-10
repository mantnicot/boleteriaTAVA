# Deploy a Vercel (Next.js)

## 1) Variables de entorno en Vercel

Configura estas variables en el proyecto de Vercel:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (ejemplo: `https://tu-app.vercel.app/oauth2callback`)
- `GOOGLE_OAUTH_TOKENS_JSON` (recomendado para no depender de archivos locales)
- `GOOGLE_SHEETS_ID` (recomendado en producción)
- `GOOGLE_DRIVE_FOLDER_ID`
- `TZ`
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
