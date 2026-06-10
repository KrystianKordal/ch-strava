import crypto from 'crypto';
import { db, ensureSchema, syncClubs } from './db';
import { clubs, clubById } from './config';
import { weekRange } from './week';

// Ręczne dopisanie aktywności. Feed klubowy Stravy nie zwraca dat, więc
// backlog z pierwszego polla jest tylko bazą odniesienia (counted=FALSE).
// Tutaj uzupełniamy ręcznie to, co już się odbyło, ale czego polling nie
// zdążył złapać (np. aktywności z początku wyzwania). Wpis ma counted=TRUE,
// losowy fingerprint (nie koliduje z odciskami Stravy) i first_seen ustawione
// na początek wybranego tygodnia — żeby trafił w okno wyzwania i właściwy tydzień.

export type ManualActivity = {
  clubId: number;
  athlete: string;
  name?: string;
  sportType?: string;
  movingTime: number; // sekundy
  distance?: number; // metry
  elevation?: number; // metry
  weekKey: string;
};

export async function addManualActivity(a: ManualActivity): Promise<void> {
  if (!clubById(a.clubId)) throw new Error(`Nieznana drużyna (ID ${a.clubId}).`);
  if (!a.athlete.trim()) throw new Error('Podaj imię zawodnika.');
  if (!(a.movingTime > 0)) throw new Error('Czas aktywności musi być większy od zera.');
  if (!/^\d{4}-W\d{2}$/.test(a.weekKey)) throw new Error('Nieprawidłowy tydzień.');

  await ensureSchema();
  await syncClubs(clubs);

  const [weekStart] = weekRange(a.weekKey);
  const sport = a.sportType?.trim() || 'Inne';
  const fp = `manual-${crypto.randomBytes(12).toString('hex')}`;

  await db().execute({
    sql: `INSERT INTO activities
            (club_id, fingerprint, athlete_name, activity_name, type, sport_type,
             distance, moving_time, elapsed_time, elevation, week_key, first_seen, counted)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
    args: [
      a.clubId,
      fp,
      a.athlete.trim(),
      a.name?.trim() || null,
      sport,
      sport,
      a.distance ?? 0,
      Math.trunc(a.movingTime),
      Math.trunc(a.movingTime),
      a.elevation ?? 0,
      a.weekKey,
      weekStart.toISO()!,
    ],
  });
}
