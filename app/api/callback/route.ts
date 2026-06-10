import { NextRequest, NextResponse } from 'next/server';
import { exchangeCode } from '@/lib/strava';
import { ensureSchema } from '@/lib/db';
import { clubById, appUrl } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Callback OAuth: Strava wraca z ?code=...&state=<clubId>.
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const error = params.get('error');
  const code = params.get('code');
  const clubId = Number(params.get('state'));

  if (error) {
    return NextResponse.redirect(`${appUrl()}/auth?error=${encodeURIComponent(error)}`);
  }
  if (!code || !clubId || !clubById(clubId)) {
    return NextResponse.redirect(`${appUrl()}/auth?error=bad_request`);
  }

  try {
    await ensureSchema();
    await exchangeCode(clubId, code);
    return NextResponse.redirect(`${appUrl()}/auth?ok=${clubId}`);
  } catch (e) {
    return NextResponse.redirect(`${appUrl()}/auth?error=${encodeURIComponent((e as Error).message)}`);
  }
}
