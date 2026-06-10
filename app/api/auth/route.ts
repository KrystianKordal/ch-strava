import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authorizeUrl } from '@/lib/strava';
import { clubById, strava, isProd, OAUTH_STATE_COOKIE } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Start autoryzacji konkretnej drużyny: /api/auth?club=<id> → redirect do Strava.
export async function GET(req: NextRequest) {
  const clubId = Number(req.nextUrl.searchParams.get('club'));
  if (!clubId || !clubById(clubId)) {
    return NextResponse.json({ error: 'Nieznana drużyna' }, { status: 400 });
  }
  if (!strava.clientId || !strava.clientSecret) {
    return NextResponse.json(
      { error: 'Brak STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET w zmiennych środowiskowych.' },
      { status: 500 },
    );
  }

  // Anty-CSRF: losowy nonce wędruje i w `state` (do Stravy), i w httpOnly cookie.
  // Callback porówna oba — bez tego cudzy `code` mógłby podszyć się pod sesję.
  const nonce = crypto.randomBytes(16).toString('hex');
  const state = `${clubId}.${nonce}`;
  const res = NextResponse.redirect(authorizeUrl(clubId, state));
  res.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax', // pozwala odesłać cookie przy powrocie ze Stravy (GET)
    path: '/',
    maxAge: 600, // 10 minut na dokończenie autoryzacji
  });
  return res;
}
