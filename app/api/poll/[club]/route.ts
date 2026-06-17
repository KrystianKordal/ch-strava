import { NextRequest, NextResponse } from 'next/server';
import { runPoll } from '@/lib/poll';
import { clubById } from '@/lib/config';
import { pollAuthorized } from '@/lib/poll-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Trigger pollingu dla jednej drużyny: /api/poll/<clubId>
//
// Dzięki rozbiciu pracy na osobne żądania (po jednym na klub) pojedyncze
// wywołanie przetwarza tylko aktywności jednego klubu i nie przekracza limitu
// czasu funkcji. Wywołania rozkładasz po swojej stronie (scheduler odpala
// /api/poll/<id> dla każdego klubu osobno).
//
// Autoryzacja jak w /api/poll (?key=<SEKRET> albo nagłówek Bearer).

async function handle(req: NextRequest, ctx: { params: Promise<{ club: string }> }) {
  if (!pollAuthorized(req)) {
    return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
  }

  const { club } = await ctx.params;
  const clubId = Number(club);
  if (!Number.isInteger(clubId) || !clubById(clubId)) {
    return NextResponse.json({ error: `Nieznany klub: ${club}` }, { status: 404 });
  }

  try {
    const result = await runPoll(clubId);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
