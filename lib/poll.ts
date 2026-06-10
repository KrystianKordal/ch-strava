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

function fingerprint(athlete: string, a: StravaActivity): string {
  return crypto
    .createHash('md5')
    .update(
      [
        athlete,
        a.name ?? '',
        a.sport_type ?? a.type ?? '',
        Math.round(a.distance ?? 0),
        Math.trunc(a.moving_time ?? 0),
        Math.trunc(a.elapsed_time ?? 0),
        Math.round(a.total_elevation_gain ?? 0),
      ].join('|'),
    )
    .digest('hex');
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
