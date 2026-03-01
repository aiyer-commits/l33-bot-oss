import { getSignInUrl } from '@workos-inc/authkit-nextjs';
import { NextRequest, NextResponse } from 'next/server';

function normalizeReturnTo(rawValue: string | null) {
  if (!rawValue) return '/';
  if (!rawValue.startsWith('/')) return '/';
  if (rawValue.startsWith('//')) return '/';
  return rawValue;
}

export async function GET(request: NextRequest) {
  const returnTo = normalizeReturnTo(request.nextUrl.searchParams.get('returnTo'));
  const signInUrl = await getSignInUrl({ state: Buffer.from(JSON.stringify({ returnPathname: returnTo })).toString('base64url') });
  return NextResponse.redirect(signInUrl);
}
