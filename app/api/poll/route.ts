import { NextRequest, NextResponse } from 'next/server';
import { runPoll } from '@/lib/poll';
import { cronSecret, isProd } from '@/lib/config';
import { safeEqual } from '@/lib/safe-equal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Ręczny trigger pollingu (pobranie aktywności drużyn i zapis nowych).
// Odpalasz go sam, kiedy chcesz odświeżyć dane — przez przeglądarkę,
// curl albo dowolny zewnętrzny scheduler.
//
// Jeśli POLL_SECRET (alias: CRON_SECRET) jest ustawiony, klucz trzeba podać:
//   • w URL-u:  /api/poll?key=<SEKRET>      (najwygodniej — klikalny link)
//   • lub w nagłówku:  Authorization: Bearer <SEKRET>
// Bez ustawionego sekretu endpoint jest otwarty (wygodne lokalnie).
function authorized(req: NextRequest): boolean {
  // Brak sekretu: otwarte tylko lokalnie. W produkcji = fail-closed.
  if (!cronSecret) return !isProd;
  const fromQuery = req.nextUrl.searchParams.get('key') ?? '';
  const fromHeader = req.headers.get('authorization') ?? '';
  return safeEqual(fromQuery, cronSecret) || safeEqual(fromHeader, `Bearer ${cronSecret}`);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }
  try {
    const result = await runPoll();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
