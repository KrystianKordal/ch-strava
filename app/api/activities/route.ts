import { NextRequest, NextResponse } from 'next/server';
import { deleteActivity, setActivityCounted, updateActivity } from '@/lib/manual';
import { cronSecret, isProd } from '@/lib/config';
import { safeEqual } from '@/lib/safe-equal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Zarządzanie istniejącymi aktywnościami z panelu na /manual: edycja, usunięcie
// oraz włączenie/wyłączenie z liczenia (counted). Chronione tym samym sekretem
// co /api/poll i /api/manual (POLL_SECRET). Obsługuje formularze (redirect 303
// z powrotem na /manual z zachowanymi filtrami).

function authorized(req: NextRequest, key: string | null): boolean {
  if (!cronSecret) return !isProd;
  const fromHeader = req.headers.get('authorization') ?? '';
  return safeEqual(key ?? '', cronSecret) || safeEqual(fromHeader, `Bearer ${cronSecret}`);
}

function num(v: FormDataEntryValue | null | undefined): number {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const key = req.nextUrl.searchParams.get('key') ?? (form.get('key') as string | null);

  // Po operacji wracamy na /manual, zachowując klucz i aktywne filtry, żeby
  // użytkownik został w tym samym widoku listy.
  const filters: Record<string, string> = {};
  for (const f of ['fclub', 'fweek', 'fathlete'] as const) {
    const v = form.get(f);
    if (v) filters[f] = String(v);
  }
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(
      new URL(`/manual?${new URLSearchParams({ ...(key ? { key } : {}), ...filters, ...params })}`, req.url),
      { status: 303 },
    );

  if (!authorized(req, key)) {
    return back({ error: 'Brak autoryzacji (zły klucz).' });
  }

  const op = String(form.get('op') ?? '');
  const id = Number(form.get('id'));

  try {
    if (op === 'delete') {
      await deleteActivity(id);
      return back({ ok: 'Aktywność usunięta.' });
    }
    if (op === 'toggle') {
      const counted = String(form.get('counted')) === '1';
      await setActivityCounted(id, counted);
      return back({ ok: counted ? 'Aktywność włączona do liczenia.' : 'Aktywność wyłączona z liczenia.' });
    }
    if (op === 'update') {
      const hours = num(form.get('hours'));
      const minutes = num(form.get('minutes'));
      await updateActivity(id, {
        athlete: String(form.get('athlete') ?? ''),
        name: (form.get('name') as string) || undefined,
        sportType: (form.get('sport') as string) || undefined,
        movingTime: Math.round((hours * 60 + minutes) * 60),
        distance: Math.round(num(form.get('distance_km')) * 1000),
        elevation: Math.round(num(form.get('elevation'))),
        weekKey: String(form.get('week')),
        firstSeen: (form.get('first_seen') as string) || undefined,
      });
      return back({ ok: 'Aktywność zaktualizowana.' });
    }
    return back({ error: 'Nieznana operacja.' });
  } catch (e) {
    return back({ error: (e as Error).message });
  }
}
