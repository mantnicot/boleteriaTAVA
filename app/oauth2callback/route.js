import { NextResponse } from 'next/server';
import { createRequire } from 'module';

export const runtime = 'nodejs';

const require = createRequire(import.meta.url);
const googleAuth = require('../../server/auth');

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
    await googleAuth.saveTokensFromCode(code);
    return NextResponse.redirect(new URL('/index.html?oauth=ok', request.url));
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/index.html?oauth=error&reason=${encodeURIComponent(e.message)}`, request.url)
    );
  }
}
