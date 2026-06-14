import crypto from 'crypto';
import { DateTime } from 'luxon';
import { db, ensureSchema, syncClubs } from './db';
import { clubs, timezone } from './config';
import { clubActivities, hasToken, type StravaActivity } from './strava';
import { currentWeekKey } from './week';

// Port poll.php: pobiera aktywności klubów i zapisuje nowe (deduplikacja po
// odcisku palca, bo endpoint nie zwraca ID/daty).

export type PollResult = {
  ran_at: string;
  week_key: string;
  clubs: { id: number; name: string; status: string; seen?: number; new?: number; baseline?: boolean }[];
};

/**
 * Czy to pierwszy poll tego klubu? Feed Stravy nie zwraca dat, więc backlog
 * widoczny przy pierwszym kontakcie zapisujemy tylko jako bazę odniesienia
 * (counted=FALSE) — inaczej cała historia wpadłaby do bieżącego tygodnia.
 */
async function isFirstPoll(clubId: number): Promise<boolean> {
  const r = await db().execute({
    sql: 'SELECT COUNT(*) AS n FROM poll_log WHERE club_id = ?',
    args: [clubId],
  });
  return Number(r.rows[0]?.n ?? 0) === 0;
}

/**
 * Odcisk palca aktywności — używany do deduplikacji, bo feed klubowy Stravy
 * nie zwraca ID ani daty. KLUCZOWE: bierzemy tylko pola, które się NIE zmieniają
 * po fakcie. Świadomie pomijamy:
 *   • `name` — Strava nadaje auto-tytuł i lokalizuje go zależnie od ustawień
 *     widza („Morning Walk" / „Poranny spacer"), a zawodnicy zmieniają tytuły
 *     ręcznie. Każda taka zmiana = inny odcisk = duplikat całej aktywności.
 *   • `total_elevation_gain` — Strava przelicza je po fakcie (korekta
 *     przewyższenia), więc też potrafiło skakać.
 * Dodatkowo normalizujemy:
 *   • dystans → pełne metry (feed raz oddaje 4670, raz 4670.4),
 *   • imię → NFC + lower (różnice w normalizacji Unicode/wielkości liter dawały
 *     różny odcisk przy wizualnie identycznym imieniu),
 *   • sport → lower (drobne różnice wielkości liter).
 * Czas (moving/elapsed) zostaje co do sekundy — to stała tożsamość aktywności,
 * a przy aktywnościach bez dystansu (trener, siłownia) jedyny rozróżnik.
 */
export function activityFingerprint(input: {
  athlete: string;
  sport: string;
  distance: number;
  movingTime: number;
  elapsedTime: number;
}): string {
  const athlete = input.athlete.normalize('NFC').trim().toLowerCase() || 'nieznany';
  const sport = (input.sport ?? '').normalize('NFC').trim().toLowerCase();
  return crypto
    .createHash('md5')
    .update(
      [
        athlete,
        sport,
        Math.round(input.distance ?? 0),
        Math.trunc(input.movingTime ?? 0),
        Math.trunc(input.elapsedTime ?? 0),
      ].join('|'),
    )
    .digest('hex');
}

function fingerprint(athlete: string, a: StravaActivity): string {
  return activityFingerprint({
    athlete,
    sport: a.sport_type ?? a.type ?? '',
    distance: a.distance ?? 0,
    movingTime: a.moving_time ?? 0,
    elapsedTime: a.elapsed_time ?? 0,
  });
}

export async function runPoll(): Promise<PollResult> {
  await ensureSchema();
  await syncClubs(clubs);

  const c = db();
  const now = DateTime.now().setZone(timezone).toISO()!;
  const weekKey = currentWeekKey();
  const result: PollResult = { ran_at: now, week_key: weekKey, clubs: [] };

  for (const club of clubs) {
    const token = await hasToken(club.id);
    if (!token) {
      result.clubs.push({ id: club.id, name: club.name, status: 'brak autoryzacji' });
      continue;
    }

    let activities: StravaActivity[];
    try {
      activities = await clubActivities(club.id);
    } catch (e) {
      result.clubs.push({ id: club.id, name: club.name, status: `błąd: ${(e as Error).message}` });
      continue;
    }

    // Pierwszy poll klubu = baza odniesienia: zapisujemy backlog z counted=FALSE,
    // żeby historia nie wpadła do bieżącego tygodnia. Liczą się dopiero
    // aktywności zauważone w kolejnych pollach.
    const baseline = await isFirstPoll(club.id);
    const counted = !baseline;

    let newCount = 0;
    for (const a of activities) {
      // Tylko imię (firstname) — w obrębie klubu imiona się nie powtarzają,
      // więc inicjał nazwiska jest zbędny. Strava w feedzie klubowym i tak
      // oddaje nazwisko tylko jako inicjał.
      const athlete = (a.athlete?.firstname ?? '').trim() || 'Nieznany';
      const fp = fingerprint(athlete, a);
      const res = await c.execute({
        sql: `INSERT INTO activities
                (club_id, fingerprint, athlete_name, activity_name, type, sport_type,
                 distance, moving_time, elapsed_time, elevation, week_key, first_seen, counted)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (club_id, fingerprint) DO NOTHING`,
        args: [
          club.id,
          fp,
          athlete,
          a.name ?? null,
          a.type ?? null,
          a.sport_type ?? a.type ?? null,
          a.distance ?? 0,
          Math.trunc(a.moving_time ?? 0),
          Math.trunc(a.elapsed_time ?? 0),
          a.total_elevation_gain ?? 0,
          weekKey,
          now,
          counted,
        ],
      });
      newCount += res.rowsAffected;
    }

    await c.execute({
      sql: 'INSERT INTO poll_log (club_id, seen_count, new_count, ran_at) VALUES (?, ?, ?, ?)',
      args: [club.id, activities.length, newCount, now],
    });
    result.clubs.push({
      id: club.id,
      name: club.name,
      status: baseline ? 'ok (baza odniesienia)' : 'ok',
      seen: activities.length,
      new: newCount,
      baseline,
    });
  }

  return result;
}
