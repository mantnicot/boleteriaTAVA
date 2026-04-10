import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const runtime = 'nodejs';

const require = createRequire(import.meta.url);
const googleAuth = require('../../../server/auth');

export async function GET(request) {
  try {
    const url = googleAuth.getAuthorizationUrl();
    return NextResponse.redirect(url);
  } catch (e) {
    return new NextResponse(
      `<!DOCTYPE html><html><body style="font-family:system-ui;padding:2rem;max-width:560px"><h1>OAuth</h1><p>${e.message}</p><p>Configura GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET.</p></body></html>`,
      {
        status: 500,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}
