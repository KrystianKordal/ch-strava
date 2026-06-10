import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { DateTime } from 'luxon';
import { db, ensureSchema, syncClubs } from '@/lib/db';
import { clubs, challenge, timezone, allowSeed, isProd } from '@/lib/config';
import { weekKeyFor, weekRange, weeksBetween } from '@/lib/week';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dane DEMO do podglądu bez prawdziwego konta Strava. Dostępne tylko gdy
// ALLOW_SEED=1. NIE używać na produkcji z prawdziwymi danymi.
const FIRST = ['Anna', 'Marek', 'Kasia', 'Tomek', 'Ola', 'Piotr', 'Magda', 'Bartek', 'Ewa', 'Kuba', 'Zofia', 'Michał'];
const SPORTS = ['Run', 'Ride', 'Walk', 'Swim', 'Hike', 'WeightTraining', 'VirtualRide'];
const NAMES = ['Poranny bieg', 'Trening interwałowy', 'Spokojna jazda', 'Długi wybieg', 'Po pracy', 'Weekendowa wycieczka', 'Basen', 'Siłownia'];

const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = <T,>(arr: T[]): T => arr[rnd(0, arr.length - 1)];

export async function GET() {
  // Endpoint kasuje WSZYSTKIE aktywności — w produkcji niedostępny bez wyjątku,
  // żeby przypadkowe ALLOW_SEED=1 nie dało nikomu kasowania bazy.
  if (isProd) {
    return NextResponse.json({ error: 'Seedowanie wyłączone na produkcji.' }, { status: 403 });
  }
  if (!allowSeed) {
    return NextResponse.json({ error: 'Seedowanie wyłączone (ustaw ALLOW_SEED=1).' }, { status: 403 });
  }

  await ensureSchema();
  await syncClubs(clubs);
  const c = db();
  await c.execute('DELETE FROM activities');
  await c.execute('DELETE FROM poll_log');

  let weeks = weeksBetween(challenge.startDate, challenge.endDate);
  if (weeks.length === 0) {
    // Wyzwanie w przyszłości — pokaż ostatnie 6 tygodni jako rozgrzewkę.
    let cursor = DateTime.now().setZone(timezone).minus({ weeks: 5 });
    weeks = [];
    for (let i = 0; i < 6; i++) {
      weeks.push(weekKeyFor(cursor));
      cursor = cursor.plus({ weeks: 1 });
    }
  }

  const athletesByClub = new Map<number, { name: string; energy: number }[]>();
  for (const club of clubs) {
    // Same imiona, unikalne w obrębie klubu (jak w prawdziwych danych z feedu).
    const pool = [...FIRST].sort(() => Math.random() - 0.5).slice(0, rnd(6, 11));
    const list = pool.map((name) => ({ name, energy: rnd(40, 130) / 100 }));
    athletesByClub.set(club.id, list);
  }

  let total = 0;
  for (const wk of weeks) {
    const [start] = weekRange(wk);
    for (const club of clubs) {
      for (const ath of athletesByClub.get(club.id)!) {
        const sessions = Math.round(rnd(2, 6) * ath.energy);
        for (let s = 0; s < sessions; s++) {
          const sport = pick(SPORTS);
          const moving = Math.floor(rnd(20, 130) * 60 * ath.energy);
          const distance = ['Run', 'Walk', 'Hike'].includes(sport)
            ? (moving / 60) * rnd(150, 320)
            : sport === 'Swim'
              ? (moving / 60) * 40
              : (moving / 60) * rnd(250, 600);
          const seen = start.plus({ days: rnd(0, 6), hours: rnd(6, 21) }).toISO();
          await c.execute({
            sql: `INSERT INTO activities
                    (club_id, fingerprint, athlete_name, activity_name, type, sport_type,
                     distance, moving_time, elapsed_time, elevation, week_key, first_seen)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              club.id,
              crypto.randomBytes(8).toString('hex'),
              ath.name,
              pick(NAMES),
              sport,
              sport,
              Math.round(distance * 10) / 10,
              moving,
              moving + rnd(0, 600),
              rnd(0, 600),
              wk,
              seen,
            ],
          });
          total++;
        }
      }
      await c.execute({
        sql: 'INSERT INTO poll_log (club_id, seen_count, new_count, ran_at) VALUES (?, ?, ?, ?)',
        args: [club.id, 0, 0, DateTime.now().toISO()],
      });
    }
  }

  return NextResponse.json({ seeded: total, weeks: weeks.length });
}
