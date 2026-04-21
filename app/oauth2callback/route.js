import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const runtime = 'nodejs';

const require = createRequire(import.meta.url);
const googleAuth = require('../../server/auth');
const { encryptGoogleTokensToCookie, COOKIE_NAME_OAUTH } = require('../../server/oauthCookie');

function isHttpsRequest(req) {
  if (!req) return false;
  if (String(req.headers.get('x-forwarded-proto') || '').toLowerCase() === 'https') return true;
  try {
    return new URL(req.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');

  if (err) {
    return NextResponse.redirect(
      new URL(`/index.html?oauth=error&reason=${encodeURIComponent(String(err))}`, request.url)
    );
  }

  if (!code) {
    return NextResponse.redirect(new URL('/index.html?oauth=error&reason=no_code', request.url));
  }

  try {
    const tokens = await googleAuth.saveTokensFromCode(code);
    const res = NextResponse.redirect(new URL('/index.html?oauth=ok', request.url));
    const secure = isHttpsRequest(request) || process.env.VERCEL === '1';
    const packed = encryptGoogleTokensToCookie(tokens);
    res.cookies.set({
      name: COOKIE_NAME_OAUTH,
      value: packed,
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: 60 * 60 * 24 * 180,
    });
    return res;
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/index.html?oauth=error&reason=${encodeURIComponent(e.message)}`, request.url)
    );
  }
}
