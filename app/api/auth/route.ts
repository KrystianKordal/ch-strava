import { NextRequest, NextResponse } from 'next/server';
import { authorizeUrl } from '@/lib/strava';
import { clubById, strava } from '@/lib/config';

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
  return NextResponse.redirect(authorizeUrl(clubId));
}
