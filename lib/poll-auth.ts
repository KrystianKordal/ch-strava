import type { NextRequest } from 'next/server';
import { cronSecret, isProd } from './config';
import { safeEqual } from './safe-equal';

// Wspólna autoryzacja triggerów pollingu (/api/poll oraz /api/poll/[club]).
//
// Jeśli POLL_SECRET (alias: CRON_SECRET) jest ustawiony, klucz trzeba podać:
//   • w URL-u:  ?key=<SEKRET>           (najwygodniej — klikalny link)
//   • lub w nagłówku:  Authorization: Bearer <SEKRET>
// Bez ustawionego sekretu endpoint jest otwarty lokalnie, a w produkcji
// fail-closed (zamknięty).
export function pollAuthorized(req: NextRequest): boolean {
  if (!cronSecret) return !isProd;
  const fromQuery = req.nextUrl.searchParams.get('key') ?? '';
  const fromHeader = req.headers.get('authorization') ?? '';
  return safeEqual(fromQuery, cronSecret) || safeEqual(fromHeader, `Bearer ${cronSecret}`);
}
