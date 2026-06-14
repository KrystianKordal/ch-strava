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
  const [clubs, weeks, sport_breakdown, last_poll, all_athletes] = await Promise.all([
    loadClubs(),
    challengeWeeks(win),
    sportBreakdown(win),
    lastPoll(),
    allAthletes(win),
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
  const highlightsData = highlights(totals);
  const hall_of_fame = await buildHallOfFame(win, weekly, clubs);

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
    all_athletes,
    sport_breakdown,
    highlights: highlightsData,
    hall_of_fame,
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

async function allAthletes(win: Window) {
  // Pełny ranking wszystkich zawodników (ze wszystkich drużyn) wg łącznego
  // czasu aktywności liczących się w wyzwaniu (counted=TRUE, okno czasowe).
  const { clause, winArgs } = whereWindow(win);
  const r = await db().execute({
    sql: `SELECT athlete_name, club_id,
                 SUM(moving_time) AS moving_time,
                 SUM(distance)    AS distance,
                 SUM(elevation)   AS elevation,
                 COUNT(*)         AS activities
          FROM activities ${clause}
          GROUP BY athlete_name, club_id
          ORDER BY moving_time DESC, athlete_name ASC`,
    args: winArgs,
  });

  return r.rows.map((row, i) => ({
    rank: i + 1,
    name: s(row.athlete_name),
    club_id: n(row.club_id),
    moving_time: n(row.moving_time),
    distance: n(row.distance),
    elevation: n(row.elevation),
    activities: n(row.activities),
  }));
}

async function sportBreakdown(win: Window) {
  const { clause, winArgs } = whereWindow(win);
  // Rozbicie czasu per dyscyplina ORAZ per klub — pozwala pokolorować pasek
  // segmentami w kolorach drużyn proporcjonalnie do ich udziału w dyscyplinie.
  const r = await db().execute({
    sql: `SELECT COALESCE(NULLIF(sport_type, ''), COALESCE(NULLIF(type, ''), 'Inne')) AS sport,
                 club_id,
                 SUM(moving_time) AS moving_time,
                 COUNT(*)         AS activities
          FROM activities ${clause}
          GROUP BY sport, club_id`,
    args: winArgs,
  });

  type SportAgg = {
    sport: string;
    moving_time: number;
    activities: number;
    clubs: { club_id: number; moving_time: number }[];
  };
  const bySport = new Map<string, SportAgg>();
  for (const row of r.rows) {
    const sport = s(row.sport);
    let agg = bySport.get(sport);
    if (!agg) {
      agg = { sport, moving_time: 0, activities: 0, clubs: [] };
      bySport.set(sport, agg);
    }
    const time = n(row.moving_time);
    agg.moving_time += time;
    agg.activities += n(row.activities);
    agg.clubs.push({ club_id: n(row.club_id), moving_time: time });
  }

  return [...bySport.values()]
    .map((agg) => ({
      ...agg,
      clubs: agg.clubs.sort((a, b) => b.moving_time - a.moving_time),
    }))
    .sort((a, b) => b.moving_time - a.moving_time);
}

type Highlights = {
  total_hours: number;
  total_activities: number;
  total_distance_km: number;
};

// Sumy zbiorcze dla kafelków na górze dashboardu (<Tiles>). Szczegółowe
// „ciekawostki" (najaktywniejszy / najdłuższa aktywność / przewaga tygodnia)
// zostały zastąpione sekcją „Hala Sław" — patrz buildHallOfFame().
function highlights(totals: Awaited<ReturnType<typeof loadTotals>>): Highlights {
  const totalSeconds = totals.reduce((acc, t) => acc + t.moving_time, 0);
  return {
    total_hours: Math.round((totalSeconds / 3600) * 10) / 10,
    total_activities: totals.reduce((acc, t) => acc + t.activities, 0),
    total_distance_km: Math.round((totals.reduce((acc, t) => acc + t.distance, 0) / 1000) * 10) / 10,
  };
}

// ---------- Hala Sław ----------
// 14 humorystycznych osiągnięć liczonych WZGLĘDNIE (najlepszy kandydat wśród
// pozostałych), żeby zawsze ktoś się załapał. Osiągnięcia wymagające
// porównań tydzień-do-tygodnia są wyszarzone (available=false), dopóki nie ma
// dość danych. Trzy osiągnięcia czasowe (Weekendowy Wojownik, As z Rękawa,
// Złodzieje Marzeń) liczymy z first_seen (czas wykrycia przez polling) jako
// przybliżenia — feed Stravy nie zwraca dat aktywności.

export type HallOfFameAward = {
  key: string;
  icon: string;
  title: string;
  subtitle: string;
  scope: 'athlete' | 'team';
  winner: string | null;
  club_id: number | null;
  metric: string | null;
  available: boolean;
  tip: string;
};

type AthAgg = { total: number; longest: number; weekend: number; sunday: number };

function hms(sec: number): string {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
const sumArr = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const avgArr = (xs: number[]) => (xs.length ? sumArr(xs) / xs.length : 0);
const stddevArr = (xs: number[], m: number) => Math.sqrt(avgArr(xs.map((x) => (x - m) ** 2)));

async function buildHallOfFame(
  win: Window,
  weekly: WeeklyRow[],
  clubs: ClubInfo[],
): Promise<HallOfFameAward[]> {
  const { clause, winArgs } = whereWindow(win);
  const r = await db().execute({
    sql: `SELECT club_id, athlete_name, week_key, moving_time, first_seen FROM activities ${clause}`,
    args: winArgs,
  });

  // Agregacja w TS (luxon, strefa wyzwania) — zbiór danych jest mały, a logika
  // dni tygodnia zostaje spójna z resztą aplikacji.
  const byAthlete = new Map<string, { club_id: number; athlete: string; weeks: Map<string, AthAgg> }>();
  const teamWeek = new Map<string, { club_id: number; week: string; total: number; sunday: number; athletes: Map<string, number> }>();

  for (const row of r.rows) {
    const club_id = n(row.club_id);
    const athlete = s(row.athlete_name);
    const week = s(row.week_key);
    const moving = n(row.moving_time);
    const fs = s(row.first_seen);
    const wd = fs ? DateTime.fromISO(fs).setZone(timezone).weekday : 0; // 1=pon … 7=niedz
    const isWeekend = wd === 6 || wd === 7;
    const isSunday = wd === 7;

    const aKey = `${club_id}|${athlete}`;
    let a = byAthlete.get(aKey);
    if (!a) {
      a = { club_id, athlete, weeks: new Map() };
      byAthlete.set(aKey, a);
    }
    let aw = a.weeks.get(week);
    if (!aw) {
      aw = { total: 0, longest: 0, weekend: 0, sunday: 0 };
      a.weeks.set(week, aw);
    }
    aw.total += moving;
    aw.longest = Math.max(aw.longest, moving);
    if (isWeekend) aw.weekend += moving;
    if (isSunday) aw.sunday += moving;

    const twKey = `${club_id}|${week}`;
    let tw = teamWeek.get(twKey);
    if (!tw) {
      tw = { club_id, week, total: 0, sunday: 0, athletes: new Map() };
      teamWeek.set(twKey, tw);
    }
    tw.total += moving;
    if (isSunday) tw.sunday += moving;
    tw.athletes.set(athlete, (tw.athletes.get(athlete) ?? 0) + moving);
  }

  const weeks = weekly.map((w) => w.week_key);
  const numClubs = clubs.length;
  const hasTwoWeeks = weeks.length >= 2;
  const hasEnded = weekly.some((w) => w.ended);
  const clubName = (id: number) => clubs.find((c) => c.id === id)?.name ?? '—';
  const seriesOf = (a: { weeks: Map<string, AthAgg> }) => weeks.map((w) => a.weeks.get(w)?.total ?? 0);
  // Pozycja drużyny w tygodniu: 1 + liczba drużyn z czasem ściśle większym (remisy dzielą miejsce).
  const rankIn = (week: WeeklyRow, club_id: number) => {
    const t = week.clubs.find((c) => c.club_id === club_id)?.moving_time ?? 0;
    return 1 + week.clubs.filter((c) => c.moving_time > t).length;
  };

  type Win = { winner: string; club_id: number; metric: string } | null;
  const make = (
    base: { key: string; icon: string; title: string; subtitle: string; scope: 'athlete' | 'team'; tip: string },
    w: Win,
  ): HallOfFameAward => ({
    ...base,
    available: !!w,
    winner: w?.winner ?? null,
    club_id: w?.club_id ?? null,
    metric: w?.metric ?? null,
  });

  // 1. Efekt Feniksa — największy wzrost godzin tydzień-do-tygodnia.
  let feniks: { delta: number; athlete: string; club_id: number; prev: number; curr: number } | null = null;
  for (const a of byAthlete.values()) {
    const sx = seriesOf(a);
    for (let i = 1; i < sx.length; i++) {
      const delta = sx[i] - sx[i - 1];
      if (delta > 0 && (!feniks || delta > feniks.delta))
        feniks = { delta, athlete: a.athlete, club_id: a.club_id, prev: sx[i - 1], curr: sx[i] };
    }
  }

  // 2. Niezłomny — najniższy współczynnik zmienności serii tygodniowej.
  let niezlomny: { cv: number; athlete: string; club_id: number; mean: number } | null = null;
  for (const a of byAthlete.values()) {
    const active = weeks.filter((w) => (a.weeks.get(w)?.total ?? 0) > 0);
    if (active.length < 2) continue;
    const lo = weeks.indexOf(active[0]);
    const hi = weeks.indexOf(active[active.length - 1]);
    const span = weeks.slice(lo, hi + 1).map((w) => a.weeks.get(w)?.total ?? 0);
    const mean = avgArr(span);
    if (mean <= 0) continue;
    const cv = stddevArr(span, mean) / mean;
    if (!niezlomny || cv < niezlomny.cv) niezlomny = { cv, athlete: a.athlete, club_id: a.club_id, mean };
  }

  // 3. Weekendowy Wojownik — najwyższy udział godzin z weekendów (first_seen).
  let weekend: { share: number; athlete: string; club_id: number } | null = null;
  for (const a of byAthlete.values()) {
    let total = 0;
    let we = 0;
    for (const w of a.weeks.values()) {
      total += w.total;
      we += w.weekend;
    }
    if (total <= 0 || we <= 0) continue;
    const share = we / total;
    if (!weekend || share > weekend.share) weekend = { share, athlete: a.athlete, club_id: a.club_id };
  }

  // 4. Król Posiadów — jeden długi trening dominujący tydzień.
  let krol: { score: number; athlete: string; club_id: number; longest: number; share: number } | null = null;
  for (const a of byAthlete.values()) {
    for (const w of a.weeks.values()) {
      if (w.total <= 0) continue;
      const share = w.longest / w.total;
      const score = w.longest * share;
      if (!krol || score > krol.score)
        krol = { score, athlete: a.athlete, club_id: a.club_id, longest: w.longest, share };
    }
  }

  // 5. Śpiący Rycerz — druga połowa wyzwania znacznie mocniejsza od pierwszej.
  const half = Math.floor(weeks.length / 2);
  let spiacy: { score: number; athlete: string; club_id: number; fh: number; sh: number } | null = null;
  for (const a of byAthlete.values()) {
    let fh = 0;
    let sh = 0;
    weeks.forEach((w, i) => {
      const t = a.weeks.get(w)?.total ?? 0;
      if (i < half) fh += t;
      else sh += t;
    });
    const score = sh - fh;
    if (score > 0 && (!spiacy || score > spiacy.score))
      spiacy = { score, athlete: a.athlete, club_id: a.club_id, fh, sh };
  }

  // 6. As z Rękawa — większość wyniku tygodnia wrzucona w niedzielę (first_seen).
  let as: { score: number; athlete: string; club_id: number; share: number } | null = null;
  for (const a of byAthlete.values()) {
    for (const w of a.weeks.values()) {
      if (w.total <= 0 || w.sunday <= 0) continue;
      const share = w.sunday / w.total;
      const score = w.sunday * share;
      if (!as || score > as.score) as = { score, athlete: a.athlete, club_id: a.club_id, share };
    }
  }

  // 7. Efekt Supernowej — jeden tydzień wielokrotnie powyżej własnej średniej.
  let supernowa: { ratio: number; athlete: string; club_id: number; maxV: number; base: number } | null = null;
  for (const a of byAthlete.values()) {
    const sx = seriesOf(a);
    let maxV = -1;
    let maxI = -1;
    sx.forEach((v, i) => {
      if (v > maxV) {
        maxV = v;
        maxI = i;
      }
    });
    if (maxV <= 0) continue;
    const others = sx.filter((_, i) => i !== maxI);
    const base = avgArr(others);
    if (base <= 0) continue; // musi mieć wcześniejszą (niską) bazę — inaczej to „Śpiący Rycerz"
    const ratio = maxV / base;
    if (!supernowa || ratio > supernowa.ratio)
      supernowa = { ratio, athlete: a.athlete, club_id: a.club_id, maxV, base };
  }

  // 8. Monolit — najbardziej wyrównana drużyna w tygodniu (≥2 aktywnych).
  let monolit: { spread: number; club_id: number; gap: number } | null = null;
  for (const tw of teamWeek.values()) {
    const totals = [...tw.athletes.values()].filter((v) => v > 0);
    if (totals.length < 2) continue;
    const mx = Math.max(...totals);
    const mn = Math.min(...totals);
    const mean = avgArr(totals);
    if (mean <= 0) continue;
    const spread = (mx - mn) / mean;
    if (!monolit || spread < monolit.spread) monolit = { spread, club_id: tw.club_id, gap: mx - mn };
  }

  // 9. Zasada Pareto — jeden zawodnik robi największą część wyniku drużyny.
  let pareto: { share: number; club_id: number; who: string } | null = null;
  for (const tw of teamWeek.values()) {
    const entries = [...tw.athletes.entries()].filter(([, v]) => v > 0);
    if (entries.length < 2 || tw.total <= 0) continue;
    const top = entries.reduce((m, e) => (e[1] > m[1] ? e : m));
    const share = top[1] / tw.total;
    if (!pareto || share > pareto.share) pareto = { share, club_id: tw.club_id, who: top[0] };
  }

  // 10. Czarny Koń — największy awans w tabeli tydzień-do-tygodnia.
  let czarnyKon: { gain: number; club_id: number; from: number; to: number } | null = null;
  for (let i = 1; i < weekly.length; i++) {
    for (const club of clubs) {
      const cur = weekly[i].clubs.find((c) => c.club_id === club.id)?.moving_time ?? 0;
      if (cur <= 0) continue;
      const from = rankIn(weekly[i - 1], club.id);
      const to = rankIn(weekly[i], club.id);
      const gain = from - to;
      if (gain > 0 && (!czarnyKon || gain > czarnyKon.gain))
        czarnyKon = { gain, club_id: club.id, from, to };
    }
  }

  // 11. Złodzieje Marzeń — lider odwrócony aktywnościami z niedzieli (first_seen).
  let zlodzieje: { swing: number; club_id: number; label: string } | null = null;
  for (const w of weekly) {
    if (!w.ended) continue;
    const stats = clubs.map((c) => {
      const t = teamWeek.get(`${c.id}|${w.week_key}`);
      const total = t?.total ?? 0;
      return { club_id: c.id, total, pre: total - (t?.sunday ?? 0) };
    });
    const final = stats.reduce((m, x) => (x.total > m.total ? x : m));
    const prov = stats.reduce((m, x) => (x.pre > m.pre ? x : m));
    if (final.total > 0 && final.club_id !== prov.club_id) {
      const swing = final.total - final.pre; // wkład z niedzieli, który odwrócił losy
      if (!zlodzieje || swing > zlodzieje.swing) zlodzieje = { swing, club_id: final.club_id, label: w.label };
    }
  }

  // 12. Rzutem na Taśmę — najmniejsza przewaga zwycięzcy w zakończonym tygodniu.
  let tasma: { margin: number; club_id: number; label: string } | null = null;
  for (const w of weekly) {
    if (!w.ended || w.tie || w.winners.length !== 1) continue;
    const times = w.clubs.map((c) => c.moving_time).sort((a, b) => b - a);
    if (times.length < 2 || times[0] <= 0) continue;
    const margin = times[0] - times[1];
    if (!tasma || margin < tasma.margin) tasma = { margin, club_id: w.winners[0], label: w.label };
  }

  // 12b. Walec — najbardziej miażdżąca przewaga lidera w tygodniu. „Łagodne":
  // bierzemy też trwający tydzień, byle był wyraźny lider (max > drugi, >0).
  let walec: { margin: number; club_id: number; label: string } | null = null;
  for (const w of weekly) {
    const sorted = [...w.clubs].sort((a, b) => b.moving_time - a.moving_time);
    if (sorted.length < 2 || sorted[0].moving_time <= 0 || sorted[0].moving_time === sorted[1].moving_time) continue;
    const margin = sorted[0].moving_time - sorted[1].moving_time;
    if (!walec || margin > walec.margin) walec = { margin, club_id: sorted[0].club_id, label: w.label };
  }

  // 13. Wiecznie Drudzy — najwięcej drugich miejsc w zakończonych tygodniach.
  const seconds = new Map<number, number>();
  for (const w of weekly) {
    if (!w.ended) continue;
    const sorted = [...w.clubs].filter((c) => c.moving_time > 0).sort((a, b) => b.moving_time - a.moving_time);
    if (sorted.length < 2 || sorted[0].moving_time === sorted[1].moving_time) continue;
    seconds.set(sorted[1].club_id, (seconds.get(sorted[1].club_id) ?? 0) + 1);
  }
  let drudzy: { count: number; club_id: number } | null = null;
  for (const [club_id, count] of seconds) if (!drudzy || count > drudzy.count) drudzy = { count, club_id };

  // 14. Efekt Jojo — zwycięzca tygodnia, który tydzień później spada na dno.
  let jojo: { drop: number; club_id: number; from: string; to: string } | null = null;
  for (let i = 1; i < weekly.length; i++) {
    const prev = weekly[i - 1];
    const cur = weekly[i];
    if (!prev.ended || prev.tie || prev.winners.length !== 1) continue;
    const champ = prev.winners[0];
    const curTimes = cur.clubs.map((c) => c.moving_time);
    const minT = Math.min(...curTimes);
    const maxT = Math.max(...curTimes);
    if (minT === maxT) continue;
    const champCur = cur.clubs.find((c) => c.club_id === champ);
    if (champCur && champCur.moving_time === minT) {
      const prevTime = prev.clubs.find((c) => c.club_id === champ)?.moving_time ?? 0;
      const drop = prevTime - champCur.moving_time;
      if (!jojo || drop > jojo.drop) jojo = { drop, club_id: champ, from: prev.label, to: cur.label };
    }
  }

  return [
    make(
      { key: 'feniks', icon: '🔥', title: 'Efekt Feniksa', subtitle: 'Najlepszy Powrót', scope: 'athlete', tip: 'Największy wzrost liczby godzin tydzień do tygodnia.' },
      hasTwoWeeks && feniks ? { winner: feniks.athlete, club_id: feniks.club_id, metric: `z ${hms(feniks.prev)} do ${hms(feniks.curr)}` } : null,
    ),
    make(
      { key: 'niezlomny', icon: '🎯', title: 'Niezłomny', subtitle: 'Szwajcarski Zegarek', scope: 'athlete', tip: 'Najbardziej regularny — co tydzień niemal tyle samo godzin.' },
      hasTwoWeeks && niezlomny ? { winner: niezlomny.athlete, club_id: niezlomny.club_id, metric: `~${hms(niezlomny.mean)}/tydz., wahania ±${pct(niezlomny.cv)}` } : null,
    ),
    make(
      { key: 'weekend', icon: '🎒', title: 'Weekendowy Wojownik', subtitle: 'Pan Soboty', scope: 'athlete', tip: 'Procentowo najwięcej godzin wykręca w weekendy (sob–niedz). Liczone z czasu wykrycia aktywności.' },
      weekend ? { winner: weekend.athlete, club_id: weekend.club_id, metric: `${pct(weekend.share)} godzin w weekend` } : null,
    ),
    make(
      { key: 'krol', icon: '👑', title: 'Król Posiadów', subtitle: 'Maraton w jeden dzień', scope: 'athlete', tip: 'Jeden bardzo długi trening, który zdominował cały jego tydzień.' },
      krol ? { winner: krol.athlete, club_id: krol.club_id, metric: `${hms(krol.longest)} w jednym treningu (${pct(krol.share)} tygodnia)` } : null,
    ),
    make(
      { key: 'spiacy', icon: '😴', title: 'Śpiący Rycerz', subtitle: 'Późny Zryw', scope: 'athlete', tip: 'Niewidoczny na początku, w drugiej połowie wyzwania stał się filarem.' },
      hasTwoWeeks && spiacy ? { winner: spiacy.athlete, club_id: spiacy.club_id, metric: `${hms(spiacy.fh)} → ${hms(spiacy.sh)} (2. połowa)` } : null,
    ),
    make(
      { key: 'as', icon: '🃏', title: 'As z Rękawa', subtitle: 'Niedzielny Snajper', scope: 'athlete', tip: 'Przez tydzień cisza, a w niedzielę potężny wynik wywracający tabelę. Liczone z czasu wykrycia aktywności.' },
      as ? { winner: as.athlete, club_id: as.club_id, metric: `${pct(as.share)} wyniku w niedzielę` } : null,
    ),
    make(
      { key: 'supernowa', icon: '💫', title: 'Efekt Supernowej', subtitle: 'Nagły Wystrzał', scope: 'athlete', tip: 'Robił niewiele, a w jednym tygodniu wystrzelił z kosmiczną liczbą godzin.' },
      hasTwoWeeks && supernowa ? { winner: supernowa.athlete, club_id: supernowa.club_id, metric: `${hms(supernowa.maxV)} vs śr. ${hms(supernowa.base)} (×${supernowa.ratio.toFixed(1)})` } : null,
    ),
    make(
      { key: 'monolit', icon: '🧱', title: 'Monolit', subtitle: 'Gra Zespołowa', scope: 'team', tip: 'Najbardziej zespołowa drużyna — najmniejsza różnica między najlepszym a najsłabszym zawodnikiem w tygodniu.' },
      monolit ? { winner: clubName(monolit.club_id), club_id: monolit.club_id, metric: `różnica tylko ${hms(monolit.gap)} najlepszy–najsłabszy` } : null,
    ),
    make(
      { key: 'pareto', icon: '⚖️', title: 'Zasada Pareto', subtitle: 'Jeden za Wszystkich', scope: 'team', tip: 'Drużyna, w której jeden zawodnik zrobił największą część wyniku zespołu.' },
      pareto ? { winner: clubName(pareto.club_id), club_id: pareto.club_id, metric: `${pareto.who}: ${pct(pareto.share)} wyniku drużyny` } : null,
    ),
    make(
      { key: 'czarny-kon', icon: '🐴', title: 'Czarny Koń', subtitle: 'Niespodziewany Awans', scope: 'team', tip: 'Drużyna z największym awansem w tabeli tydzień do tygodnia.' },
      hasTwoWeeks && czarnyKon ? { winner: clubName(czarnyKon.club_id), club_id: czarnyKon.club_id, metric: `z ${czarnyKon.from}. na ${czarnyKon.to}. miejsce` } : null,
    ),
    make(
      { key: 'zlodzieje', icon: '🥷', title: 'Złodzieje Marzeń', subtitle: 'Skok po Prowadzenie', scope: 'team', tip: 'Drużyna, która odebrała prowadzenie w samej końcówce tygodnia. Liczone z czasu wykrycia aktywności.' },
      hasEnded && zlodzieje ? { winner: clubName(zlodzieje.club_id), club_id: zlodzieje.club_id, metric: `odwrócenie w niedzielę (+${hms(zlodzieje.swing)}, ${zlodzieje.label})` } : null,
    ),
    make(
      { key: 'tasma', icon: '🏁', title: 'Rzutem na Taśmę', subtitle: 'O Włos', scope: 'team', tip: 'Drużyna, która wygrała tydzień najmniejszą różnicą czasu.' },
      hasEnded && tasma ? { winner: clubName(tasma.club_id), club_id: tasma.club_id, metric: `wygrana o ${hms(tasma.margin)} (${tasma.label})` } : null,
    ),
    make(
      { key: 'walec', icon: '💥', title: 'Walec', subtitle: 'Miażdżąca Przewaga', scope: 'team', tip: 'Tydzień z najbardziej miażdżącą przewagą lidera nad rywalami.' },
      walec ? { winner: clubName(walec.club_id), club_id: walec.club_id, metric: `przewaga ${hms(walec.margin)} (${walec.label})` } : null,
    ),
    make(
      { key: 'drudzy', icon: '🥈', title: 'Wiecznie Drudzy', subtitle: 'Zawsze o Krok', scope: 'team', tip: 'Drużyna, która najczęściej kończyła tydzień tuż za zwycięzcą — na 2. miejscu.' },
      hasEnded && drudzy ? { winner: clubName(drudzy.club_id), club_id: drudzy.club_id, metric: `${drudzy.count}× drugie miejsce` } : null,
    ),
    make(
      { key: 'jojo', icon: '🪀', title: 'Efekt Jojo', subtitle: 'Wzlot i Upadek', scope: 'team', tip: 'Drużyna, która po wygranym tygodniu zaliczyła zjazd na ostatnie miejsce.' },
      hasTwoWeeks && jojo ? { winner: clubName(jojo.club_id), club_id: jojo.club_id, metric: `1. (${jojo.from}) → ostatnie (${jojo.to})` } : null,
    ),
  ];
}

async function lastPoll(): Promise<string | null> {
  const r = await db().execute('SELECT MAX(ran_at) AS t FROM poll_log');
  const t = r.rows[0]?.t;
  return t ? String(t) : null;
}
