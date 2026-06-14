import { DateTime } from 'luxon';
import { clubs, challenge, timezone, cronSecret, isProd } from '@/lib/config';
import { safeEqual } from '@/lib/safe-equal';
import { weeksBetween, weekLabel, weekKeyFor } from '@/lib/week';
import { sportPl } from '@/lib/sport-names';
import { listActivities, type ManagedActivity } from '@/lib/manual';

export const dynamic = 'force-dynamic';

const SPORTS = ['Run', 'Ride', 'Walk', 'Swim', 'Hike', 'WeightTraining', 'VirtualRide', 'Inne'];

function hm(sec: number): { h: number; m: number } {
  const s = Math.max(0, Math.trunc(sec));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) };
}
function fmtTime(sec: number): string {
  const { h, m } = hm(sec);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtKm(m: number): string {
  return m > 0 ? `${(m / 1000).toFixed(2)} km` : '—';
}
/** ISO (z offsetem) → wartość dla <input type="datetime-local"> w strefie wyzwania. */
function toLocalInput(iso: string): string {
  const d = DateTime.fromISO(iso).setZone(timezone);
  return d.isValid ? d.toFormat("yyyy-LL-dd'T'HH:mm") : '';
}
function fmtSeen(iso: string): string {
  const d = DateTime.fromISO(iso).setZone(timezone);
  return d.isValid ? d.toFormat('dd.LL.yyyy HH:mm') : iso;
}

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
  const activities = await listActivities({ clubId: fclub, weekKey: fweek, athlete: fathlete });
  const clubName = (id: number) => clubs.find((c) => c.id === id)?.name ?? `#${id}`;
  const clubColor = (id: number) => clubs.find((c) => c.id === id)?.color ?? '#888';

  // Pola filtrów przekazywane przy każdej operacji, żeby wrócić do tego widoku.
  const filterHidden = (
    <>
      {sp.fclub ? <input type="hidden" name="fclub" value={sp.fclub} /> : null}
      {sp.fweek ? <input type="hidden" name="fweek" value={sp.fweek} /> : null}
      {sp.fathlete ? <input type="hidden" name="fathlete" value={sp.fathlete} /> : null}
    </>
  );

  return (
    <div className="auth-wrap">
      <h1>Ręczne dopisanie aktywności</h1>

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
          <select name="sport" defaultValue="Run">
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {sportPl(s)}
              </option>
            ))}
          </select>
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
          <button className="btn" type="submit">Filtruj</button>
        </form>

        <p className="act-count">Znaleziono: {activities.length}</p>

        {activities.length === 0 ? (
          <p className="act-empty">Brak aktywności dla wybranych filtrów.</p>
        ) : (
          <div className="act-list">
            {activities.map((a) => (
              <ActivityItem
                key={a.id}
                a={a}
                actAction={actAction}
                keyVal={key}
                weeks={weeks}
                filterHidden={filterHidden}
                clubName={clubName}
                clubColor={clubColor}
              />
            ))}
          </div>
        )}
      </section>

      <p className="muted">
        Wróć na <a href="/">dashboard</a>.
      </p>

      {/* Potwierdzenie przy usuwaniu (bez frameworka klienta). */}
      <script
        dangerouslySetInnerHTML={{
          __html:
            "document.addEventListener('submit',function(e){var f=e.target;if(f&&f.dataset&&f.dataset.confirm&&!confirm(f.dataset.confirm)){e.preventDefault();}},true);",
        }}
      />
    </div>
  );
}

function ActivityItem({
  a,
  actAction,
  keyVal,
  weeks,
  filterHidden,
  clubName,
  clubColor,
}: {
  a: ManagedActivity;
  actAction: string;
  keyVal: string;
  weeks: string[];
  filterHidden: React.ReactNode;
  clubName: (id: number) => string;
  clubColor: (id: number) => string;
}) {
  const sport = a.sport_type ?? a.type ?? 'Inne';
  const { h, m } = hm(a.moving_time);
  const sportOptions = SPORTS.includes(sport) ? SPORTS : [sport, ...SPORTS];

  return (
    <div className={`act-item${a.counted ? '' : ' off'}`}>
      <div className="act-head">
        <span className="act-dot" style={{ background: clubColor(a.club_id) }} aria-hidden />
        <div className="act-main">
          <span className="act-title">
            {a.athlete_name} · {a.activity_name || sportPl(sport) || 'Aktywność'}
          </span>
          <span className="act-sub">
            {clubName(a.club_id)} · {sportPl(sport)} · {fmtTime(a.moving_time)} · {fmtKm(a.distance)} ·{' '}
            {a.week_key} · {fmtSeen(a.first_seen)}
          </span>
        </div>
        {a.manual && <span className="act-badge man">ręczna</span>}
        {!a.counted && <span className="act-badge off">wyłączona</span>}

        <div className="act-actions">
          <form method="post" action={actAction}>
            <input type="hidden" name="key" value={keyVal} />
            <input type="hidden" name="op" value="toggle" />
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="counted" value={a.counted ? '0' : '1'} />
            {filterHidden}
            <button className="btn-sm" type="submit">
              {a.counted ? 'Wyłącz' : 'Włącz'}
            </button>
          </form>
          <form method="post" action={actAction} data-confirm="Usunąć tę aktywność na stałe?">
            <input type="hidden" name="key" value={keyVal} />
            <input type="hidden" name="op" value="delete" />
            <input type="hidden" name="id" value={a.id} />
            {filterHidden}
            <button className="btn-sm danger" type="submit">
              Usuń
            </button>
          </form>
        </div>
      </div>

      <details className="act-edit">
        <summary>Edytuj</summary>
        <form className="manual-form" method="post" action={actAction}>
          <input type="hidden" name="key" value={keyVal} />
          <input type="hidden" name="op" value="update" />
          <input type="hidden" name="id" value={a.id} />
          {filterHidden}

          <label>
            Tydzień
            <select name="week" defaultValue={a.week_key} required>
              {(weeks.includes(a.week_key) ? weeks : [a.week_key, ...weeks]).map((wk) => (
                <option key={wk} value={wk}>
                  {wk} ({weekLabel(wk)})
                </option>
              ))}
            </select>
          </label>

          <label>
            Pierwsze wykrycie (opcjonalnie)
            <input name="first_seen" type="datetime-local" defaultValue={toLocalInput(a.first_seen)} />
            <span className="hint">Musi mieścić się w wybranym tygodniu. Puste = początek tygodnia.</span>
          </label>

          <label>
            Zawodnik
            <input name="athlete" type="text" defaultValue={a.athlete_name} required />
          </label>

          <label>
            Nazwa aktywności (opcjonalnie)
            <input name="name" type="text" defaultValue={a.activity_name ?? ''} />
          </label>

          <label>
            Sport
            <select name="sport" defaultValue={sport}>
              {sportOptions.map((s) => (
                <option key={s} value={s}>
                  {sportPl(s)}
                </option>
              ))}
            </select>
          </label>

          <div className="row2">
            <label>
              Czas — godziny
              <input name="hours" type="number" min="0" step="1" defaultValue={h} />
            </label>
            <label>
              Czas — minuty
              <input name="minutes" type="number" min="0" max="59" step="1" defaultValue={m} />
            </label>
          </div>

          <div className="row2">
            <label>
              Dystans (km, opcjonalnie)
              <input
                name="distance_km"
                type="number"
                min="0"
                step="0.01"
                defaultValue={a.distance > 0 ? (a.distance / 1000).toFixed(2) : ''}
              />
            </label>
            <label>
              Przewyższenie (m, opcjonalnie)
              <input
                name="elevation"
                type="number"
                min="0"
                step="1"
                defaultValue={a.elevation > 0 ? Math.round(a.elevation) : ''}
              />
            </label>
          </div>

          <button className="btn" type="submit">Zapisz zmiany</button>
        </form>
      </details>
    </div>
  );
}
