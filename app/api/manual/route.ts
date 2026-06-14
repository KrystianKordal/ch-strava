import { NextRequest, NextResponse } from 'next/server';
import { addManualActivity } from '@/lib/manual';
import { cronSecret, isProd } from '@/lib/config';
import { safeEqual } from '@/lib/safe-equal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Ręczne dopisanie aktywności (uzupełnienie danych, których polling nie złapał).
// Chronione tym samym sekretem co /api/poll (POLL_SECRET). Obsługuje formularz
// z /manual (x-www-form-urlencoded) oraz JSON (do curla).

function authorized(req: NextRequest, key: string | null): boolean {
  // Brak sekretu: otwarte tylko lokalnie. W produkcji = fail-closed.
  if (!cronSecret) return !isProd;
  const fromHeader = req.headers.get('authorization') ?? '';
  return safeEqual(key ?? '', cronSecret) || safeEqual(fromHeader, `Bearer ${cronSecret}`);
}

function num(v: FormDataEntryValue | null | undefined): number {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') ?? '';

  // --- JSON (np. curl) ---
  if (ct.includes('application/json')) {
    const body = await req.json().catch(() => ({}));
    const key = req.nextUrl.searchParams.get('key') ?? body.key ?? null;
    if (!authorized(req, key)) {
      return NextResponse.json({ error: 'Brak autoryzacji' }, { status: 401 });
    }
    try {
      await addManualActivity({
        clubId: Number(body.clubId),
        athlete: String(body.athlete ?? ''),
        name: body.name ? String(body.name) : undefined,
        sportType: body.sportType ? String(body.sportType) : undefined,
        movingTime: Number(body.movingTime),
        distance: body.distance != null ? Number(body.distance) : undefined,
        elevation: body.elevation != null ? Number(body.elevation) : undefined,
        weekKey: String(body.weekKey),
        firstSeen: body.firstSeen ? String(body.firstSeen) : undefined,
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  // --- Formularz z /manual ---
  const form = await req.formData();
  const key = req.nextUrl.searchParams.get('key') ?? (form.get('key') as string | null);
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(
      new URL(`/manual?${new URLSearchParams({ ...(key ? { key } : {}), ...params })}`, req.url),
      { status: 303 },
    );

  if (!authorized(req, key)) {
    return back({ error: 'Brak autoryzacji (zły klucz).' });
  }

  const hours = num(form.get('hours'));
  const minutes = num(form.get('minutes'));
  try {
    await addManualActivity({
      clubId: Number(form.get('club')),
      athlete: String(form.get('athlete') ?? ''),
      name: (form.get('name') as string) || undefined,
      sportType: (form.get('sport') as string) || undefined,
      movingTime: Math.round((hours * 60 + minutes) * 60),
      distance: Math.round(num(form.get('distance_km')) * 1000),
      elevation: Math.round(num(form.get('elevation'))),
      weekKey: String(form.get('week')),
      firstSeen: (form.get('first_seen') as string) || undefined,
    });
    return back({ ok: '1' });
  } catch (e) {
    return back({ error: (e as Error).message });
  }
}
