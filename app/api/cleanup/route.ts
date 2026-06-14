import { NextRequest, NextResponse } from 'next/server';
import { runCleanup } from '@/lib/cleanup';
import { cronSecret, isProd } from '@/lib/config';
import { safeEqual } from '@/lib/safe-equal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Jednorazowa migracja po zmianie schematu odcisku palca: przeklucza istniejące
// wiersze na nowy odcisk i scala duplikaty (patrz lib/cleanup.ts).
//
// Chronione tym samym sekretem co /api/poll (POLL_SECRET).
//   • podgląd (nic nie zmienia):  /api/cleanup?key=<SEKRET>
//   • wykonanie zmian:            /api/cleanup?key=<SEKRET>&apply=1
// Bezpiecznie odpalić najpierw bez apply, sprawdzić raport, dopiero potem z apply.
function authorized(req: NextRequest): boolean {
  if (!cronSecret) return !isProd;
  const fromQuery = req.nextUrl.searchParams.get('key') ?? '';
  const fromHeader = req.headers.get('authorization') ?? '';
  return safeEqual(fromQuery, cronSecret) || safeEqual(fromHeader, `Bearer ${cronSecret}`);
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }
  const apply = req.nextUrl.searchParams.get('apply') === '1';
  try {
    const result = await runCleanup(apply);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
