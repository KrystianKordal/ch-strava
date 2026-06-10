import { ensureSchema } from '@/lib/db';
import { hasToken } from '@/lib/strava';
import { clubs, clubById } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const sp = await searchParams;
  await ensureSchema();

  const rows = await Promise.all(
    clubs.map(async (club) => ({ club, token: await hasToken(club.id) })),
  );

  return (
    <div className="auth-wrap">
      <h1>Autoryzacja drużyn — Strava</h1>

      {sp.ok && (
        <p className="ok-txt">
          ✓ Drużyna „{clubById(Number(sp.ok))?.name ?? sp.ok}" autoryzowana.
        </p>
      )}
      {sp.error && <p className="bad-txt">✗ Błąd autoryzacji: {sp.error}</p>}

      <p>
        Autoryzuj <strong>każdą</strong> drużynę kontem, które jest jej członkiem (każdą może autoryzować inna
        osoba).
      </p>

      <div className="notice">
        <strong>Co zbieramy:</strong> wyłącznie zagregowany feed klubowy ze Strava — imię i inicjał, typ
        aktywności, dystans i czas. <strong>Nie pobieramy</strong> tras GPS, tętna, mocy ani aktywności
        prywatnych. Prosimy o najwęższy zakres dostępu (<code>read</code>). Dostęp możesz w każdej chwili
        cofnąć na <a href="https://www.strava.com/settings/apps" target="_blank" rel="noreferrer">
        strava.com/settings/apps</a>.
      </div>

      <ul className="clubs">
        {rows.map(({ club, token }) => (
          <li key={club.id}>
            <span className="club-dot" style={{ background: club.color }} />
            <strong>{club.name}</strong> (ID {club.id}) —{' '}
            {token ? (
              <span className="ok-txt">✓ autoryzowany{token.athlete_name ? ` (${token.athlete_name})` : ''}</span>
            ) : (
              <span className="bad-txt">✗ brak tokenu</span>
            )}
            <a className="b" href={`/api/auth?club=${club.id}`}>
              {token ? 'Autoryzuj ponownie' : 'Autoryzuj'}
            </a>
          </li>
        ))}
      </ul>

      <p className="muted">
        Po autoryzacji wszystkich drużyn polling zadziała automatycznie (Vercel Cron / <code>/api/poll</code>).
        Wróć na <a href="/">dashboard</a>.
      </p>
    </div>
  );
}
