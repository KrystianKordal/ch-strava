import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/strava';
import { ensureSchema } from '@/lib/db';
import { clubById, appUrl, OAUTH_STATE_COOKIE } from '@/lib/config';
import { safeEqual } from '@/lib/safe-equal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Callback OAuth: Strava wraca z ?code=...&state=<clubId>.<nonce>.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const error = params.get('error');
  const code = params.get('code');
  const [clubIdStr, nonce] = (params.get('state') ?? '').split('.');
  const clubId = Number(clubIdStr);

  // Po obsłudze (sukces lub błąd) cookie z nonce'em jest jednorazowe — kasujemy.
  const redirect = (to: string) => {
    const res = NextResponse.redirect(to);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  };

  if (error) {
    return redirect(`${appUrl()}/auth?error=${encodeURIComponent(error)}`);
  }
  if (!code || !clubId || !clubById(clubId)) {
    return redirect(`${appUrl()}/auth?error=bad_request`);
  }

  // Weryfikacja anty-CSRF: nonce ze `state` musi zgadzać się z cookie.
  const cookieNonce = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? '';
  if (!nonce || !cookieNonce || !safeEqual(nonce, cookieNonce)) {
    return redirect(`${appUrl()}/auth?error=invalid_state`);
  }

  try {
    await ensureSchema();
    await exchangeCode(clubId, code);
    return redirect(`${appUrl()}/auth?ok=${clubId}`);
  } catch (e) {
    return redirect(`${appUrl()}/auth?error=${encodeURIComponent((e as Error).message)}`);
  }
}
