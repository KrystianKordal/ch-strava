import { unstable_cache } from 'next/cache';
import { DateTime } from 'luxon';
import type { InValue } from './db';
import { db, ensureSchema } from './db';
import { challenge, timezone } from './config';
import { weekKeyFor, weekLabel, weekRange, weeksBetween } from './week';

// Port logiki Stats.php. Wszystkie statystyki filtrowane oknem czasowym
// wyzwania; przed startem ('before') pokazujemy cały zebrany okres
// przygotowawczy bez filtra.

export type Phase = 'before' | 'running' | 'ended';

export type DashboardData = Awaited<ReturnType<typeof computeDashboard>>;

type ClubInfo = { id: number; name: string; color: string };

function n(v: InValue | undefined): number {
  return v == null ? 0 : Number(v);
}
function s(v: InValue | undefined): string {
  return v == null ? '' : String(v);
}

type Window = {
  phase: Phase;
  lower: string | null;
  upper: string | null;
  start: DateTime;
  end: DateTime;
  now: DateTime;
};

function computeWindow(): Window {
  const now = DateTime.now().setZone(timezone);
  const start = DateTime.fromISO(challenge.startDate, { zone: timezone }).startOf('day');
  const end = DateTime.fromISO(challenge.endDate, { zone: timezone }).endOf('day');
  if (now < start) {
    return { phase: 'before', lower: null, upper: null, start, end, now };
  }
  return {
    phase: now > end ? 'ended' : 'running',
    lower: start.toISO(),
    upper: end.toISO(),
    start,
    end,
    now,
  };
}

/** Buduje fragment WHERE z oknem czasowym + ewentualnym dodatkowym warunkiem. */
function whereWindow(win: Window, extra?: string): { clause: string; winArgs: InValue[] } {
  // counted=FALSE to baza odniesienia (backlog z pierwszego polla bez znanej
  // daty) — nigdy nie wliczamy jej do statystyk.
  const conds: string[] = ['counted = TRUE'];
  const winArgs: InValue[] = [];
  if (extra) conds.push(extra);
  if (win.lower !== null) {
    conds.push('first_seen >= ? AND first_seen <= ?');
    winArgs.push(win.lower, win.upper as string);
  }
  return { clause: conds.length ? `WHERE ${conds.join(' AND ')}` : '', winArgs };
}

// Wynik dashboardu cache'ujemy w Data Cache Next.js na REVALIDATE_SECONDS.
// To zwykły obiekt JSON, więc cache jest współdzielony między SSR strony
// (app/page.tsx) a /api/stats — kolejne wejścia i auto-odświeżenia w tym oknie
// nie odpalają ani jednego zapytania do bazy, tylko dostają gotowy wynik.
const REVALIDATE_SECONDS = 60;

export const getDashboard = unstable_cache(computeDashboard, ['dashboard'], {
  revalidate: REVALIDATE_SECONDS,
});

async function computeDashboard() {
  await ensureSchema();
  // syncClubs() celowo NIE jest tu wołane — to zapisy (INSERT/DELETE), które nie
  // mają nic do roboty na ścieżce odczytu. Kluby synchronizuje polling (lib/poll.ts),
  // wpis ręczny (lib/manual.ts) i seed (app/api/seed). Trzymanie tego poza odczytem
  // usuwa 5 zbędnych round-tripów do bazy z każdego ładowania dashboardu.

  const win = computeWindow();

  // Faza 1: zapytania zależne tylko od okna czasowego — równolegle.
  const [clubs, weeks, sport_breakdown, last_poll] = await Promise.all([
    loadClubs(),
    challengeWeeks(win),
    sportBreakdown(win),
    lastPoll(),
  ]);

  // Faza 2: zapytania zależne od listy klubów / tygodni — równolegle.
  const [weekly, totals, current_week, top_athletes] = await Promise.all([
    weeklyResults(win, weeks, clubs),
    loadTotals(win, clubs),
    currentWeek(win, clubs),
    topAthletes(win, clubs),
  ]);

  // Faza 3: czyste obliczenia + highlights (zależne od weekly i totals).
  const standings = buildStandings(weekly, clubs);
  const highlightsData = await highlights(win, weekly, totals);

  const daysToStart =
    win.phase === 'before'
      ? Math.max(0, Math.ceil(win.start.diff(win.now, 'days').days))
      : 0;

  return {
    challenge: { name: challenge.name, start_date: challenge.startDate, end_date: challenge.endDate },
    phase: win.phase,
    days_to_start: daysToStart,
    generated_at: new Date().toISOString(),
    clubs,
    standings,
    current_week,
    weekly,
    totals,
    top_athletes,
    sport_breakdown,
    highlights: highlightsData,
    last_poll,
  };
}

async function loadClubs(): Promise<ClubInfo[]> {
  const r = await db().execute('SELECT id, name, color FROM clubs ORDER BY id');
  return r.rows.map((row) => ({ id: n(row.id), name: s(row.name), color: s(row.color) }));
}

async function challengeWeeks(win: Window): Promise<string[]> {
  if (win.phase === 'before') {
    const r = await db().execute('SELECT MIN(first_seen) AS m FROM activities WHERE counted = TRUE');
    const min = r.rows[0]?.m;
    if (!min) return [];
    return weeksBetween(String(min).slice(0, 10), win.now.toISODate()!);
  }
  return weeksBetween(challenge.startDate, challenge.endDate);
}

type WeeklyClub = {
  club_id: number;
  moving_time: number;
  distance: number;
  elevation: number;
  activities: number;
  athletes: number;
  winner: boolean;
};
type WeeklyRow = {
  week_key: string;
  label: string;
  clubs: WeeklyClub[];
  winners: number[];
  tie: boolean;
  // Czy tydzień już się zakończył. Bieżący (trwający) tydzień nie ma jeszcze
  // rozstrzygnięcia, więc nie liczymy go do klasyfikacji wygranych tygodni.
  ended: boolean;
};

async function weeklyResults(win: Window, weeks: string[], clubs: ClubInfo[]): Promise<WeeklyRow[]> {
  const { clause, winArgs } = whereWindow(win);
  const r = await db().execute({
    sql: `SELECT week_key, club_id,
                 SUM(moving_time) AS moving_time,
                 SUM(distance)    AS distance,
                 SUM(elevation)   AS elevation,
                 COUNT(*)         AS activities,
                 COUNT(DISTINCT athlete_name) AS athletes
          FROM activities ${clause}
          GROUP BY week_key, club_id`,
    args: winArgs,
  });

  const byWeek = new Map<string, Map<number, (typeof r.rows)[number]>>();
  for (const row of r.rows) {
    const wk = s(row.week_key);
    if (!byWeek.has(wk)) byWeek.set(wk, new Map());
    byWeek.get(wk)!.set(n(row.club_id), row);
  }

  const result: WeeklyRow[] = [];
  for (const wk of weeks) {
    const clubRows: WeeklyClub[] = [];
    let maxTime = -1;
    for (const club of clubs) {
      const row = byWeek.get(wk)?.get(club.id);
      const time = n(row?.moving_time);
      clubRows.push({
        club_id: club.id,
        moving_time: time,
        distance: n(row?.distance),
        elevation: n(row?.elevation),
        activities: n(row?.activities),
        athletes: n(row?.athletes),
        winner: false,
      });
      maxTime = Math.max(maxTime, time);
    }

    const winners: number[] = [];
    if (maxTime > 0) {
      for (const row of clubRows) {
        if (row.moving_time === maxTime) {
          row.winner = true;
          winners.push(row.club_id);
        }
      }
    }

    const ended = weekRange(wk)[1] < win.now;
    result.push({ week_key: wk, label: weekLabel(wk), clubs: clubRows, winners, tie: winners.length > 1, ended });
  }
  return result;
}

function buildStandings(weekly: WeeklyRow[], clubs: ClubInfo[]) {
  const wins = new Map<number, number>();
  const totalTime = new Map<number, number>();
  for (const club of clubs) {
    wins.set(club.id, 0);
    totalTime.set(club.id, 0);
  }
  for (const w of weekly) {
    // Wygrane liczymy tylko z zakończonych tygodni — bieżący trwający tydzień
    // nie jest jeszcze rozstrzygnięty. Czas łączny zbieramy ze wszystkich.
    if (w.ended) for (const cid of w.winners) wins.set(cid, (wins.get(cid) ?? 0) + 1);
    for (const row of w.clubs) totalTime.set(row.club_id, (totalTime.get(row.club_id) ?? 0) + row.moving_time);
  }

  const out = clubs.map((club) => ({
    club_id: club.id,
    name: club.name,
    color: club.color,
    weeks_won: wins.get(club.id) ?? 0,
    total_time: totalTime.get(club.id) ?? 0,
    rank: 0,
  }));

  out.sort((a, b) => b.weeks_won - a.weeks_won || b.total_time - a.total_time);
  out.forEach((row, i) => (row.rank = i + 1));
  return out;
}

async function currentWeek(win: Window, clubs: ClubInfo[]) {
  const wk = weekKeyFor();
  const { clause, winArgs } = whereWindow(win, 'week_key = ?');
  const r = await db().execute({
    sql: `SELECT club_id,
                 SUM(moving_time) AS moving_time,
                 SUM(distance)    AS distance,
                 SUM(elevation)   AS elevation,
                 COUNT(*)         AS activities,
                 COUNT(DISTINCT athlete_name) AS athletes
          FROM activities ${clause} GROUP BY club_id`,
    args: [wk, ...winArgs],
  });
  const byClub = new Map<number, (typeof r.rows)[number]>();
  for (const row of r.rows) byClub.set(n(row.club_id), row);

  let maxTime = 0;
  const clubsOut = clubs.map((club) => {
    const row = byClub.get(club.id);
    const time = n(row?.moving_time);
    maxTime = Math.max(maxTime, time);
    return {
      club_id: club.id,
      name: club.name,
      color: club.color,
      moving_time: time,
      distance: n(row?.distance),
      elevation: n(row?.elevation),
      activities: n(row?.activities),
      athletes: n(row?.athletes),
    };
  });
  clubsOut.sort((a, b) => b.moving_time - a.moving_time);

  return {
    week_key: wk,
    label: weekLabel(wk),
    clubs: clubsOut,
    leader: maxTime > 0 ? (clubsOut[0]?.club_id ?? null) : null,
  };
}

async function loadTotals(win: Window, clubs: ClubInfo[]) {
  const { clause, winArgs } = whereWindow(win);
  const r = await db().execute({
    sql: `SELECT club_id,
                 SUM(moving_time) AS moving_time,
                 SUM(distance)    AS distance,
                 SUM(elevation)   AS elevation,
                 COUNT(*)         AS activities,
                 COUNT(DISTINCT athlete_name) AS athletes
          FROM activities ${clause} GROUP BY club_id`,
    args: winArgs,
  });
  const byClub = new Map<number, (typeof r.rows)[number]>();
  for (const row of r.rows) byClub.set(n(row.club_id), row);

  return clubs.map((club) => {
    const row = byClub.get(club.id);
    const activities = n(row?.activities);
    const time = n(row?.moving_time);
    return {
      club_id: club.id,
      name: club.name,
      color: club.color,
      moving_time: time,
      distance: n(row?.distance),
      elevation: n(row?.elevation),
      activities,
      athletes: n(row?.athletes),
      avg_time: activities > 0 ? Math.round(time / activities) : 0,
    };
  });
}

async function topAthletes(win: Window, clubs: ClubInfo[], limit = 5) {
  // Jedno zapytanie zamiast pętli N zapytań (po jednym na klub): ranking
  // zawodników w obrębie klubu liczymy oknem ROW_NUMBER() i tniemy do `limit`.
  const { clause, winArgs } = whereWindow(win);
  const r = await db().execute({
    sql: `SELECT club_id, athlete_name, moving_time, distance, activities
          FROM (
            SELECT club_id, athlete_name,
                   SUM(moving_time) AS moving_time,
                   SUM(distance)    AS distance,
                   COUNT(*)         AS activities,
                   ROW_NUMBER() OVER (PARTITION BY club_id ORDER BY SUM(moving_time) DESC) AS rn
            FROM activities ${clause}
            GROUP BY club_id, athlete_name
          ) t
          WHERE rn <= ?
          ORDER BY club_id, rn`,
    args: [...winArgs, limit],
  });

  const byClub = new Map<number, { name: string; moving_time: number; distance: number; activities: number }[]>();
  for (const row of r.rows) {
    const cid = n(row.club_id);
    if (!byClub.has(cid)) byClub.set(cid, []);
    byClub.get(cid)!.push({
      name: s(row.athlete_name),
      moving_time: n(row.moving_time),
      distance: n(row.distance),
      activities: n(row.activities),
    });
  }

  return clubs.map((club) => ({
    club_id: club.id,
    name: club.name,
    color: club.color,
    athletes: byClub.get(club.id) ?? [],
  }));
}

async function sportBreakdown(win: Window) {
  const { clause, winArgs } = whereWindow(win);
  const r = await db().execute({
    sql: `SELECT COALESCE(NULLIF(sport_type, ''), COALESCE(NULLIF(type, ''), 'Inne')) AS sport,
                 SUM(moving_time) AS moving_time,
                 COUNT(*)         AS activities
          FROM activities ${clause}
          GROUP BY sport
          ORDER BY moving_time DESC`,
    args: winArgs,
  });
  return r.rows.map((row) => ({
    sport: s(row.sport),
    moving_time: n(row.moving_time),
    activities: n(row.activities),
  }));
}

type Highlights = {
  longest_activity?: { athlete: string; club: string; name: string; moving_time: number; distance: number; sport: string };
  top_athlete?: { athlete: string; club: string; moving_time: number; activities: number };
  biggest_margin?: { week: string; margin: number };
  total_hours: number;
  total_activities: number;
  total_distance_km: number;
};

async function highlights(
  win: Window,
  weekly: WeeklyRow[],
  totals: Awaited<ReturnType<typeof loadTotals>>,
): Promise<Highlights> {
  const c = db();

  const totalSeconds = totals.reduce((acc, t) => acc + t.moving_time, 0);
  const h: Highlights = {
    total_hours: Math.round((totalSeconds / 3600) * 10) / 10,
    total_activities: totals.reduce((acc, t) => acc + t.activities, 0),
    total_distance_km: Math.round((totals.reduce((acc, t) => acc + t.distance, 0) / 1000) * 10) / 10,
  };

  const longestQ = whereWindow(win);
  const athleteQ = whereWindow(win);
  // Oba zapytania są niezależne — odpalamy je równolegle.
  const [longest, athlete] = await Promise.all([
    c.execute({
      sql: `SELECT a.*, cl.name AS club_name FROM activities a
            JOIN clubs cl ON cl.id = a.club_id
            ${longestQ.clause}
            ORDER BY a.moving_time DESC LIMIT 1`,
      args: longestQ.winArgs,
    }),
    c.execute({
      sql: `SELECT a.athlete_name, cl.name AS club_name,
                   SUM(a.moving_time) AS moving_time, COUNT(*) AS activities
            FROM activities a JOIN clubs cl ON cl.id = a.club_id
            ${athleteQ.clause}
            GROUP BY a.athlete_name, a.club_id, cl.name
            ORDER BY moving_time DESC LIMIT 1`,
      args: athleteQ.winArgs,
    }),
  ]);
  if (longest.rows[0]) {
    const row = longest.rows[0];
    h.longest_activity = {
      athlete: s(row.athlete_name),
      club: s(row.club_name),
      name: s(row.activity_name),
      moving_time: n(row.moving_time),
      distance: n(row.distance),
      sport: s(row.sport_type) || s(row.type),
    };
  }

  if (athlete.rows[0]) {
    const row = athlete.rows[0];
    h.top_athlete = {
      athlete: s(row.athlete_name),
      club: s(row.club_name),
      moving_time: n(row.moving_time),
      activities: n(row.activities),
    };
  }

  let biggestMargin: { week: string; margin: number } | null = null;
  for (const w of weekly) {
    const times = w.clubs.map((cl) => cl.moving_time).sort((a, b) => b - a);
    if (times.length < 2 || times[0] === 0) continue;
    const margin = times[0] - times[1];
    if (!biggestMargin || margin > biggestMargin.margin) biggestMargin = { week: w.label, margin };
  }
  if (biggestMargin) h.biggest_margin = biggestMargin;

  return h;
}

async function lastPoll(): Promise<string | null> {
  const r = await db().execute('SELECT MAX(ran_at) AS t FROM poll_log');
  const t = r.rows[0]?.t;
  return t ? String(t) : null;
}
