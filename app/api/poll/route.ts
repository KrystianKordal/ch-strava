import { NextRequest, NextResponse } from 'next/server';
import { runPoll } from '@/lib/poll';
import { cronSecret } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Wywoływane przez Vercel Cron (z nagłówkiem Authorization: Bearer <CRON_SECRET>)
// albo ręcznie. Jeśli CRON_SECRET ustawiony, wymagamy go.
export async function GET(req: NextRequest) {
  if (cronSecret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
    }
  }
  try {
    const result = await runPoll();
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
