import { NextRequest, NextResponse } from 'next/server';
import { deleteActivity, getActivity, setActivityCounted, updateActivity } from '@/lib/manual';
import { clubs, cronSecret, isProd } from '@/lib/config';
import { activityDisplay } from '@/lib/activity-format';
import { safeEqual } from '@/lib/safe-equal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Zarządzanie istniejącymi aktywnościami z panelu na /manual: edycja, usunięcie
// oraz włączenie/wyłączenie z liczenia (counted). Chronione tym samym sekretem
// co /api/poll i /api/manual (POLL_SECRET).
//   • zwykły formularz → redirect 303 z powrotem na /manual (z filtrami),
//   • żądanie AJAX (pole ajax=1) → odpowiedź JSON, bez przeładowania strony
//     (panel aktualizuje wiersz w miejscu — wyłączanie/usuwanie nie gubi pozycji).

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
  const ajax = String(form.get('ajax') ?? '') === '1';
  // Tryb AJAX: zwracamy JSON i nie przeładowujemy strony. Zwykły formularz:
  // redirect 303 z powrotem na /manual z zachowanym kluczem i filtrami.
  const done = (params: { ok?: string; error?: string; data?: Record<string, unknown> }, status = 200) => {
    if (ajax) {
      return NextResponse.json(
        params.error ? { error: params.error } : { ok: true, message: params.ok ?? '', ...(params.data ?? {}) },
        { status: params.error ? status : 200 },
      );
    }
    const msg: Record<string, string> = {};
    if (params.ok) msg.ok = params.ok;
    if (params.error) msg.error = params.error;
    return NextResponse.redirect(
      new URL(`/manual?${new URLSearchParams({ ...(key ? { key } : {}), ...filters, ...msg })}`, req.url),
      { status: 303 },
    );
  };

  if (!authorized(req, key)) {
    return done({ error: 'Brak autoryzacji (zły klucz).' }, 401);
  }

  const op = String(form.get('op') ?? '');
  const id = Number(form.get('id'));

  try {
    if (op === 'delete') {
      await deleteActivity(id);
      return done({ ok: 'Aktywność usunięta.' });
    }
    if (op === 'toggle') {
      const counted = String(form.get('counted')) === '1';
      await setActivityCounted(id, counted);
      return done({ ok: counted ? 'Aktywność włączona do liczenia.' : 'Aktywność wyłączona z liczenia.' });
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
      // Odświeżony tytuł/opis wiersza do aktualizacji w miejscu (AJAX).
      const row = await getActivity(id);
      const clubName = (cid: number) => clubs.find((c) => c.id === cid)?.name ?? `#${cid}`;
      const data = row ? activityDisplay(row, clubName(row.club_id)) : undefined;
      return done({ ok: 'Aktywność zaktualizowana.', data });
    }
    return done({ error: 'Nieznana operacja.' }, 400);
  } catch (e) {
    return done({ error: (e as Error).message }, 400);
  }
}
