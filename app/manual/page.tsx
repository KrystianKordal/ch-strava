import { clubs, challenge, cronSecret, isProd } from '@/lib/config';
import { safeEqual } from '@/lib/safe-equal';
import { weeksBetween, weekLabel, weekKeyFor } from '@/lib/week';
import { sportPl } from '@/lib/sport-names';

export const dynamic = 'force-dynamic';

const SPORTS = ['Run', 'Ride', 'Walk', 'Swim', 'Hike', 'WeightTraining', 'VirtualRide', 'Inne'];

// Ręczne dopisywanie aktywności — uzupełnienie danych, których polling nie
// złapał (np. z początku wyzwania, zanim ruszył pierwszy poll). Chronione
// tym samym sekretem co /api/poll: wejdź na /manual?key=<POLL_SECRET>.
export default async function ManualPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; ok?: string; error?: string }>;
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

  return (
    <div className="auth-wrap">
      <h1>Ręczne dopisanie aktywności</h1>

      {sp.ok && <p className="ok-txt">✓ Aktywność dopisana. Możesz dodać kolejną.</p>}
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

      <p className="muted">
        Wróć na <a href="/">dashboard</a>.
      </p>
    </div>
  );
}
