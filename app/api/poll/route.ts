import { NextRequest, NextResponse } from 'next/server';
import { runPoll } from '@/lib/poll';
import { pollAuthorized } from '@/lib/poll-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Ręczny trigger pollingu wszystkich drużyn naraz (pobranie aktywności i zapis
// nowych). Odpalasz go sam, kiedy chcesz odświeżyć dane — przez przeglądarkę,
// curl albo dowolny zewnętrzny scheduler.
//
// Uwaga: przy dużej liczbie aktywności ten wariant może ocierać się o limit
// czasu funkcji (maxDuration). Aby rozłożyć pracę, odpytuj każdą drużynę
// osobno przez /api/poll/<clubId> (po jednym żądaniu na klub).
//
// Autoryzacja: patrz lib/poll-auth.ts (?key=<SEKRET> lub nagłówek Bearer).

async function handle(req: NextRequest) {
  if (!pollAuthorized(req)) {
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
