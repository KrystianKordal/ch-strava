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
  clubs: { id: number; name: string; status: string; seen?: number; new?: number }[];
};

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

    let newCount = 0;
    for (const a of activities) {
      const athlete =
        [a.athlete?.firstname, a.athlete?.lastname].filter(Boolean).join(' ').trim() || 'Nieznany';
      const fp = fingerprint(athlete, a);
      const res = await c.execute({
        sql: `INSERT OR IGNORE INTO activities
                (club_id, fingerprint, athlete_name, activity_name, type, sport_type,
                 distance, moving_time, elapsed_time, elevation, week_key, first_seen)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        ],
      });
      newCount += res.rowsAffected;
    }

    await c.execute({
      sql: 'INSERT INTO poll_log (club_id, seen_count, new_count, ran_at) VALUES (?, ?, ?, ?)',
      args: [club.id, activities.length, newCount, now],
    });
    result.clubs.push({ id: club.id, name: club.name, status: 'ok', seen: activities.length, new: newCount });
  }

  return result;
}
