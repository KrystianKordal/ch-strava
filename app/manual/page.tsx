import { clubs, challenge, cronSecret, isProd } from '@/lib/config';
import { safeEqual } from '@/lib/safe-equal';
import { weeksBetween, weekLabel, weekKeyFor } from '@/lib/week';
import { sportPl, SPORT_KEYS } from '@/lib/sport-names';
import { listActivities } from '@/lib/manual';
import { hm, toLocalInput, activityDisplay } from '@/lib/activity-format';
import ActivityItem from './activity-item';

export const dynamic = 'force-dynamic';

// Pełna lista typów aktywności (ze słownika tłumaczeń) — żeby przy ręcznym
// dopisywaniu/edycji dało się wybrać dowolny sport, nie tylko najczęstsze.
const SPORTS = SPORT_KEYS;

// Ręczne dopisywanie aktywności + panel zarządzania (edycja / usunięcie /
// wyłączenie z liczenia). Chronione tym samym sekretem co /api/poll:
// wejdź na /manual?key=<POLL_SECRET>.
export default async function ManualPage({
  searchParams,
}: {
  searchParams: Promise<{
    key?: string;
    ok?: string;
    error?: string;
    fclub?: string;
    fweek?: string;
    fathlete?: string;
    fday?: string;
  }>;
}) {
  const sp = await searchParams;
  const key = sp.key ?? '';
  // Z sekretem: trzeba podać poprawny klucz. Bez sekretu: dozwolone tylko
  // lokalnie (w produkcji fail-closed, tak jak /api/manual).
  const locked = cronSecret !== '' ? !safeEqual(key, cronSecret) : isProd;

  if (locked) {
    return (
      <div className="auth-wrap">
        <h1>Ręczne dopisanie aktywności</h1>
        <p className="bad-txt">Brak dostępu.</p>
        <p>
          Wejdź na tę stronę z kluczem: <code>/manual?key=&lt;POLL_SECRET&gt;</code> (ten sam sekret co przy{' '}
          <code>/api/poll</code>).
        </p>
      </div>
    );
  }

  const currentWk = weekKeyFor();
  let weeks = weeksBetween(challenge.startDate, challenge.endDate);
  if (!weeks.includes(currentWk)) weeks = [currentWk, ...weeks];
  const action = `/api/manual${key ? `?key=${encodeURIComponent(key)}` : ''}`;
  const actAction = `/api/activities${key ? `?key=${encodeURIComponent(key)}` : ''}`;

  // Filtry panelu zarządzania.
  const fclub = sp.fclub ? Number(sp.fclub) : undefined;
  const fweek = sp.fweek || undefined;
  const fathlete = sp.fathlete || undefined;
  const fday = sp.fday || undefined;
  const activities = await listActivities({ clubId: fclub, weekKey: fweek, athlete: fathlete, day: fday });
  const clubName = (id: number) => clubs.find((c) => c.id === id)?.name ?? `#${id}`;
  const clubColor = (id: number) => clubs.find((c) => c.id === id)?.color ?? '#888';

  // Filtry przekazywane do edycji (zwykły submit), żeby wrócić do tego widoku.
  const filters = {
    ...(sp.fclub ? { fclub: sp.fclub } : {}),
    ...(sp.fweek ? { fweek: sp.fweek } : {}),
    ...(sp.fathlete ? { fathlete: sp.fathlete } : {}),
    ...(sp.fday ? { fday: sp.fday } : {}),
  };

  return (
    <div className="auth-wrap">
      <h1>Ręczne dopisanie aktywności</h1>

      {/* Wspólna lista podpowiedzi typów aktywności dla formularza dodawania
          i wszystkich formularzy edycji (pole sport to wolny tekst). */}
      <datalist id="manual-sports">
        {SPORTS.map((sportKey) => (
          <option key={sportKey} value={sportKey} label={sportPl(sportKey)} />
        ))}
      </datalist>

      {sp.ok && <p className="ok-txt">✓ {sp.ok === '1' ? 'Aktywność dopisana. Możesz dodać kolejną.' : sp.ok}</p>}
      {sp.error && <p className="bad-txt">✗ {sp.error}</p>}

      <div className="notice">
        Uzupełnij aktywności, których polling nie złapał (np. z początku wyzwania, zanim ruszył pierwszy
        poll). Dopisane tu wpisy <strong>liczą się</strong> do wyników wybranego tygodnia. Dane podejrzyj na
        stronie klubu w Stravie.
      </div>

      <form className="manual-form" method="post" action={action}>
        <input type="hidden" name="key" value={key} />

        <label>
          Drużyna
          <select name="club" required>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Tydzień
          <select name="week" defaultValue={currentWk} required>
            {weeks.map((wk) => (
              <option key={wk} value={wk}>
                {wk} ({weekLabel(wk)})
              </option>
            ))}
          </select>
        </label>

        <label>
          Pierwsze wykrycie (opcjonalnie)
          <input name="first_seen" type="datetime-local" />
          <span className="hint">
            Konkretna data i godzina aktywności. Puste = początek wybranego tygodnia. Musi mieścić się w
            wybranym tygodniu (wpływa m.in. na Halę Sław: weekend / niedziela).
          </span>
        </label>

        <label>
          Zawodnik
          <input name="athlete" type="text" placeholder="np. Anna" required />
        </label>

        <label>
          Nazwa aktywności (opcjonalnie)
          <input name="name" type="text" placeholder="np. Poranny bieg" />
        </label>

        <label>
          Sport
          <input name="sport" list="manual-sports" defaultValue="Run" placeholder="np. Run" autoComplete="off" />
          <span className="hint">
            Wybierz z podpowiedzi lub wpisz dowolny typ aktywności (nazwa ze Stravy, np. „Run", „Ride").
          </span>
        </label>

        <div className="row2">
          <label>
            Czas — godziny
            <input name="hours" type="number" min="0" step="1" defaultValue="0" />
          </label>
          <label>
            Czas — minuty
            <input name="minutes" type="number" min="0" max="59" step="1" defaultValue="0" />
          </label>
        </div>

        <div className="row2">
          <label>
            Dystans (km, opcjonalnie)
            <input name="distance_km" type="number" min="0" step="0.01" placeholder="0" />
          </label>
          <label>
            Przewyższenie (m, opcjonalnie)
            <input name="elevation" type="number" min="0" step="1" placeholder="0" />
          </label>
        </div>

        <button className="btn" type="submit">Dopisz aktywność</button>
      </form>

      {/* ---------- Panel zarządzania ---------- */}
      <section className="manage">
        <h2>Aktywności uczestników</h2>
        <p className="hint">
          Edytuj, usuń albo wyłącz aktywność z liczenia. <strong>Wyłączona</strong> aktywność zostaje w
          bazie, ale nie wlicza się do wyników (przydatne np. dla duplikatów backlogu).
        </p>

        <form className="filter-form" method="get" action="/manual">
          <input type="hidden" name="key" value={key} />
          <label>
            Drużyna
            <select name="fclub" defaultValue={sp.fclub ?? ''}>
              <option value="">Wszystkie</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tydzień
            <select name="fweek" defaultValue={sp.fweek ?? ''}>
              <option value="">Wszystkie</option>
              {weeks.map((wk) => (
                <option key={wk} value={wk}>
                  {wk} ({weekLabel(wk)})
                </option>
              ))}
            </select>
          </label>
          <label>
            Zawodnik
            <input name="fathlete" type="text" placeholder="szukaj imienia" defaultValue={sp.fathlete ?? ''} />
          </label>
          <label>
            Dzień
            <input name="fday" type="date" defaultValue={sp.fday ?? ''} />
          </label>
          <button className="btn" type="submit">Filtruj</button>
        </form>

        <p className="act-count">Znaleziono: {activities.length}</p>

        {activities.length === 0 ? (
          <p className="act-empty">Brak aktywności dla wybranych filtrów.</p>
        ) : (
          <div className="act-list">
            {activities.map((a) => {
              const sport = a.sport_type ?? a.type ?? 'Inne';
              const { h, m } = hm(a.moving_time);
              const weekKeys = weeks.includes(a.week_key) ? weeks : [a.week_key, ...weeks];
              const { title, sub } = activityDisplay(a, clubName(a.club_id));
              return (
                <ActivityItem
                  key={a.id}
                  id={a.id}
                  actAction={actAction}
                  keyVal={key}
                  dotColor={clubColor(a.club_id)}
                  title={title}
                  sub={sub}
                  manual={a.manual}
                  initialCounted={a.counted}
                  filters={filters}
                  weekOptions={weekKeys.map((wk) => ({ key: wk, label: weekLabel(wk) }))}
                  edit={{
                    week: a.week_key,
                    firstSeenLocal: toLocalInput(a.first_seen),
                    athlete: a.athlete_name,
                    name: a.activity_name ?? '',
                    sport,
                    hours: h,
                    minutes: m,
                    distanceKm: a.distance > 0 ? (a.distance / 1000).toFixed(2) : '',
                    elevation: a.elevation > 0 ? String(Math.round(a.elevation)) : '',
                  }}
                />
              );
            })}
          </div>
        )}
      </section>

      <p className="muted">
        Wróć na <a href="/">dashboard</a>.
      </p>
    </div>
  );
}
