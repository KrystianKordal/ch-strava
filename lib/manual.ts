import crypto from 'crypto';
import { DateTime } from 'luxon';
import { db, ensureSchema, syncClubs } from './db';
import { clubs, clubById, timezone } from './config';
import { weekRange } from './week';

// Ręczne dopisanie aktywności. Feed klubowy Stravy nie zwraca dat, więc
// backlog z pierwszego polla jest tylko bazą odniesienia (counted=FALSE).
// Tutaj uzupełniamy ręcznie to, co już się odbyło, ale czego polling nie
// zdążył złapać (np. aktywności z początku wyzwania). Wpis ma counted=TRUE,
// losowy fingerprint (nie koliduje z odciskami Stravy) i first_seen domyślnie
// ustawione na początek wybranego tygodnia — żeby trafił w okno wyzwania i
// właściwy tydzień. Można też podać konkretny first_seen (data i godzina),
// co pozwala trafić w dokładny dzień — istotne np. dla Hali Sław, gdzie
// weekend/niedziela liczone są właśnie z first_seen.

export type ManualActivity = {
  clubId: number;
  athlete: string;
  name?: string;
  sportType?: string;
  movingTime: number; // sekundy
  distance?: number; // metry
  elevation?: number; // metry
  weekKey: string;
  firstSeen?: string; // opcjonalnie: konkretny moment wykrycia (ISO / datetime-local)
};

export async function addManualActivity(a: ManualActivity): Promise<void> {
  if (!clubById(a.clubId)) throw new Error(`Nieznana drużyna (ID ${a.clubId}).`);
  if (!a.athlete.trim()) throw new Error('Podaj imię zawodnika.');
  if (!(a.movingTime > 0)) throw new Error('Czas aktywności musi być większy od zera.');
  if (!/^\d{4}-W\d{2}$/.test(a.weekKey)) throw new Error('Nieprawidłowy tydzień.');

  await ensureSchema();
  await syncClubs(clubs);

  const [weekStart, weekEnd] = weekRange(a.weekKey);

  // first_seen: domyślnie początek tygodnia. Jeśli podano konkretną wartość,
  // parsujemy ją w strefie wyzwania i sprawdzamy, czy mieści się w wybranym
  // tygodniu — inaczej dzień tygodnia i klucz tygodnia byłyby niespójne.
  let firstSeen = weekStart;
  if (a.firstSeen?.trim()) {
    const parsed = DateTime.fromISO(a.firstSeen.trim(), { zone: timezone });
    if (!parsed.isValid) throw new Error('Nieprawidłowa data „pierwszego wykrycia".');
    if (parsed < weekStart || parsed > weekEnd) {
      throw new Error('Data „pierwszego wykrycia" musi mieścić się w wybranym tygodniu.');
    }
    firstSeen = parsed;
  }

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
      firstSeen.toISO()!,
    ],
  });
}

// ----------------------------------------------- Zarządzanie aktywnościami --
// Panel na /manual: lista aktywności wszystkich uczestników z możliwością
// edycji, usunięcia i wyłączenia z liczenia (counted=FALSE). Wyłączenie nie
// kasuje danych — wiersz zostaje, ale wypada ze statystyk (lib/stats.ts).

export type ManagedActivity = {
  id: number;
  club_id: number;
  athlete_name: string;
  activity_name: string | null;
  sport_type: string | null;
  type: string | null;
  distance: number;
  moving_time: number;
  elevation: number;
  week_key: string;
  first_seen: string;
  counted: boolean;
  manual: boolean;
};

// day: konkretny dzień (YYYY-MM-DD) liczony po first_seen w strefie wyzwania.
export type ActivityFilter = { clubId?: number; weekKey?: string; athlete?: string; day?: string };

export async function listActivities(filter: ActivityFilter): Promise<ManagedActivity[]> {
  await ensureSchema();
  const conds: string[] = [];
  const args: (string | number)[] = [];
  if (filter.clubId) {
    conds.push('club_id = ?');
    args.push(filter.clubId);
  }
  if (filter.weekKey) {
    conds.push('week_key = ?');
    args.push(filter.weekKey);
  }
  if (filter.athlete?.trim()) {
    conds.push('LOWER(athlete_name) LIKE ?');
    args.push(`%${filter.athlete.trim().toLowerCase()}%`);
  }
  if (filter.day?.trim()) {
    // Zakres [00:00, 23:59:59] danego dnia w strefie wyzwania. first_seen trzymamy
    // jako ISO z offsetem strefy, więc porównanie tekstowe granic (też w tej
    // strefie) działa — tak jak filtrowanie oknem w lib/stats.ts.
    const d = DateTime.fromISO(filter.day.trim(), { zone: timezone });
    if (d.isValid) {
      conds.push('first_seen >= ? AND first_seen <= ?');
      args.push(d.startOf('day').toISO()!, d.endOf('day').toISO()!);
    }
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const r = await db().execute({
    sql: `SELECT id, club_id, athlete_name, activity_name, sport_type, type,
                 distance, moving_time, elevation, week_key, first_seen, counted, fingerprint
          FROM activities ${where}
          ORDER BY first_seen DESC, id DESC`,
    args,
  });
  return r.rows.map((row) => ({
    id: Number(row.id),
    club_id: Number(row.club_id),
    athlete_name: String(row.athlete_name),
    activity_name: row.activity_name == null ? null : String(row.activity_name),
    sport_type: row.sport_type == null ? null : String(row.sport_type),
    type: row.type == null ? null : String(row.type),
    distance: Number(row.distance),
    moving_time: Number(row.moving_time),
    elevation: Number(row.elevation),
    week_key: String(row.week_key),
    first_seen: String(row.first_seen),
    counted: Boolean(row.counted),
    manual: String(row.fingerprint).startsWith('manual-'),
  }));
}

export async function getActivity(id: number): Promise<ManagedActivity | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  await ensureSchema();
  const r = await db().execute({
    sql: `SELECT id, club_id, athlete_name, activity_name, sport_type, type,
                 distance, moving_time, elevation, week_key, first_seen, counted, fingerprint
          FROM activities WHERE id = ?`,
    args: [id],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    club_id: Number(row.club_id),
    athlete_name: String(row.athlete_name),
    activity_name: row.activity_name == null ? null : String(row.activity_name),
    sport_type: row.sport_type == null ? null : String(row.sport_type),
    type: row.type == null ? null : String(row.type),
    distance: Number(row.distance),
    moving_time: Number(row.moving_time),
    elevation: Number(row.elevation),
    week_key: String(row.week_key),
    first_seen: String(row.first_seen),
    counted: Boolean(row.counted),
    manual: String(row.fingerprint).startsWith('manual-'),
  };
}

export async function deleteActivity(id: number): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Nieprawidłowe ID aktywności.');
  await ensureSchema();
  await db().execute({ sql: 'DELETE FROM activities WHERE id = ?', args: [id] });
}

export async function setActivityCounted(id: number, counted: boolean): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Nieprawidłowe ID aktywności.');
  await ensureSchema();
  await db().execute({ sql: 'UPDATE activities SET counted = ? WHERE id = ?', args: [counted, id] });
}

export type ActivityEdit = {
  athlete: string;
  name?: string;
  sportType?: string;
  movingTime: number; // sekundy
  distance?: number; // metry
  elevation?: number; // metry
  weekKey: string;
  firstSeen?: string;
};

export async function updateActivity(id: number, a: ActivityEdit): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new Error('Nieprawidłowe ID aktywności.');
  if (!a.athlete.trim()) throw new Error('Podaj imię zawodnika.');
  if (!(a.movingTime > 0)) throw new Error('Czas aktywności musi być większy od zera.');
  if (!/^\d{4}-W\d{2}$/.test(a.weekKey)) throw new Error('Nieprawidłowy tydzień.');

  await ensureSchema();
  const [weekStart, weekEnd] = weekRange(a.weekKey);

  // first_seen: domyślnie początek tygodnia; jeśli podano konkretną wartość,
  // musi mieścić się w wybranym tygodniu (jak przy dodawaniu ręcznym).
  let firstSeen = weekStart;
  if (a.firstSeen?.trim()) {
    const parsed = DateTime.fromISO(a.firstSeen.trim(), { zone: timezone });
    if (!parsed.isValid) throw new Error('Nieprawidłowa data „pierwszego wykrycia".');
    if (parsed < weekStart || parsed > weekEnd) {
      throw new Error('Data „pierwszego wykrycia" musi mieścić się w wybranym tygodniu.');
    }
    firstSeen = parsed;
  }

  const sport = a.sportType?.trim() || 'Inne';

  // Świadomie NIE ruszamy fingerprintu — zostaje oryginalny, żeby kolejny poll
  // tej samej aktywności (z niezmienionymi danymi ze Stravy) wciąż się z nią
  // deduplikował, a nie wstawił jej na nowo po naszej ręcznej korekcie.
  await db().execute({
    sql: `UPDATE activities
             SET athlete_name = ?, activity_name = ?, type = ?, sport_type = ?,
                 distance = ?, moving_time = ?, elevation = ?, week_key = ?, first_seen = ?
           WHERE id = ?`,
    args: [
      a.athlete.trim(),
      a.name?.trim() || null,
      sport,
      sport,
      a.distance ?? 0,
      Math.trunc(a.movingTime),
      a.elevation ?? 0,
      a.weekKey,
      firstSeen.toISO()!,
      id,
    ],
  });
}
