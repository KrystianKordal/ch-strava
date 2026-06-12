#!/usr/bin/env node
// =============================================================================
//  Weryfikacja wgrania ostatnich aktywności zawodników
// =============================================================================
//
//  Samodzielny skrypt diagnostyczny — NIE jest częścią aplikacji (nie jest
//  importowany przez Next.js ani nigdzie podpięty). Odpalasz go ręcznie, gdy
//  chcesz sprawdzić, czy ostatnie aktywności wszystkich zawodników wgrały się
//  poprawnie do bazy.
//
//  CO ROBI:
//    1. (Strava ↔ baza) Pobiera ŻYWY feed każdego klubu ze Stravy i liczy ten
//       sam odcisk palca (MD5), którego używa polling. Wszystko, co jest w
//       feedzie Stravy, a czego NIE MA w bazie = aktywność, która się nie
//       wgrała. To jest właściwa weryfikacja.
//    2. (Zdrowie bazy) Pokazuje ostatni udany poll każdego klubu, liczbę
//       zawodników i aktywności oraz datę ostatnio zauważonej aktywności
//       każdego zawodnika — żeby wychwycić klub, który dawno nie pollował
//       (czyli polling mu się wywala), albo zawodnika bez świeżych danych.
//
//  WYMAGANIA (zmienne środowiskowe — te same co aplikacja):
//    DATABASE_URL (lub POSTGRES_URL)  — wymagane (część "zdrowie bazy")
//    STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY
//                                      — wymagane do porównania ze Stravą
//    Skrypt czyta też plik .env z katalogu głównego repo, jeśli istnieje.
//
//  URUCHOMIENIE (z katalogu repo):
//    node scripts/verify-activities.mjs            # pełna weryfikacja
//    node scripts/verify-activities.mjs --db-only  # tylko baza, bez Stravy
//
//  Skrypt jest praktycznie tylko-do-odczytu. Jedyny zapis to odświeżenie
//  wygasłego tokenu Stravy (dokładnie to samo, co robi normalny polling) —
//  bez tego nie da się pobrać feedu.
// =============================================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

// --- Kluby (jawne, te same co lib/config.ts) --------------------------------
const CLUBS = [
  { id: 2173191, name: 'Drużyna H', color: '#2563eb' },
  { id: 2173293, name: 'Drużyna R', color: '#dc2626' },
  { id: 2173396, name: 'Drużyna O', color: '#16a34a' },
];

const API_BASE = 'https://www.strava.com/api/v3';
const OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token';

const DB_ONLY = process.argv.includes('--db-only');

// --- Wczytanie .env (minimalny parser, bez zależności) ----------------------
function loadDotEnv() {
  const root = path.resolve(fileURLToPath(import.meta.url), '..', '..');
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

// --- Małe pomocniki wyświetlania --------------------------------------------
const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const ok = (s) => `${c.green}${s}${c.reset}`;
const warn = (s) => `${c.yellow}${s}${c.reset}`;
const bad = (s) => `${c.red}${s}${c.reset}`;
const head = (s) => `\n${c.bold}${c.cyan}${s}${c.reset}`;

function fmtAgo(iso) {
  if (!iso) return 'nigdy';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 60) return `${mins} min temu`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} h temu`;
  return `${Math.round(hrs / 24)} dni temu`;
}

// --- DB ----------------------------------------------------------------------
function dbConnect() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error('Brak DATABASE_URL — ustaw zmienną środowiskową albo wpisz ją w .env.');
  }
  const ssl = /[?&]sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url) ? false : 'require';
  return postgres(url, { ssl, prepare: false, max: 5, idle_timeout: 20 });
}

// --- Szyfrowanie tokenów (port lib/token-crypto.ts) --------------------------
function tokenKey() {
  const secret = process.env.TOKEN_ENCRYPTION_KEY ?? '';
  if (!secret) return null;
  return crypto.createHash('sha256').update(secret).digest();
}
function decryptToken(stored) {
  if (!stored.startsWith('v1:')) return stored; // legacy plaintext
  const k = tokenKey();
  if (!k) throw new Error('Token zaszyfrowany, ale brak TOKEN_ENCRYPTION_KEY.');
  const [, ivB64, tagB64, ctB64] = stored.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', k, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
function encryptToken(plain) {
  const k = tokenKey();
  if (!k) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

// --- Odcisk palca (port lib/poll.ts — musi być IDENTYCZNY) ------------------
function fingerprint(athlete, a) {
  return crypto
    .createHash('md5')
    .update([
      athlete,
      a.name ?? '',
      a.sport_type ?? a.type ?? '',
      Math.round(a.distance ?? 0),
      Math.trunc(a.moving_time ?? 0),
      Math.trunc(a.elapsed_time ?? 0),
      Math.round(a.total_elevation_gain ?? 0),
    ].join('|'))
    .digest('hex');
}
const athleteOf = (a) => (a.athlete?.firstname ?? '').trim() || 'Nieznany';

// --- Strava ------------------------------------------------------------------
async function accessTokenForClub(sql, clubId) {
  const rows = await sql.unsafe('SELECT * FROM tokens WHERE club_id = $1', [clubId]);
  if (!rows[0]) return null;
  const row = rows[0];
  const refreshToken = decryptToken(String(row.refresh_token));
  const expiresAt = Number(row.expires_at);

  if (expiresAt > Math.floor(Date.now() / 1000) + 60) {
    return decryptToken(String(row.access_token)); // wciąż ważny — używamy bez zmian
  }

  // Wygasł — odświeżamy (i zapisujemy, jak robi to polling; Strava rotuje refresh tokeny).
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID ?? '',
      client_secret: process.env.STRAVA_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
    cache: 'no-store',
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(`odświeżenie tokenu nieudane (${res.status}): ${JSON.stringify(data)}`);
  }
  await sql.unsafe(
    `UPDATE tokens SET access_token = $1, refresh_token = $2, expires_at = $3 WHERE club_id = $4`,
    [encryptToken(data.access_token), encryptToken(data.refresh_token), data.expires_at, clubId],
  );
  return data.access_token;
}

async function clubActivities(token, clubId, perPage = 200, maxPages = 3) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${API_BASE}/clubs/${clubId}/activities?per_page=${perPage}&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.status === 429) throw new Error('limit zapytań Strava (429) — spróbuj później');
    if (!res.ok) throw new Error(`API Strava (${res.status}): ${await res.text()}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return all;
}

// =============================================================================
//  Główna logika
// =============================================================================
async function main() {
  loadDotEnv();
  const sql = dbConnect();
  let problems = 0;

  try {
    // --------------------------------------------------------------- CZĘŚĆ 1
    // Porównanie żywego feedu Stravy z bazą (właściwa weryfikacja wgrania).
    const stravaReady =
      process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET;

    if (DB_ONLY) {
      console.log(warn('\n(pomijam porównanie ze Stravą — uruchomiono z --db-only)'));
    } else if (!stravaReady) {
      console.log(warn(
        '\n(pomijam porównanie ze Stravą — brak STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET.\n' +
        ' Zostanie tylko sprawdzenie zdrowia bazy. Ustaw zmienne, by porównać z feedem.)'));
    } else {
      console.log(head('1) STRAVA ↔ BAZA — czy ostatnie aktywności z feedu są w bazie'));
      for (const club of CLUBS) {
        process.stdout.write(`\n  ${c.bold}${club.name}${c.reset} (${club.id}): `);

        let token;
        try {
          token = await accessTokenForClub(sql, club.id);
        } catch (e) {
          console.log(bad(`BŁĄD tokenu — ${e.message}`));
          problems++;
          continue;
        }
        if (!token) {
          console.log(bad('BRAK AUTORYZACJI — klub niezautoryzowany, aktywności się nie wgrywają. Wejdź na /auth.'));
          problems++;
          continue;
        }

        let feed;
        try {
          feed = await clubActivities(token, club.id);
        } catch (e) {
          console.log(bad(`BŁĄD pobierania feedu — ${e.message}`));
          problems++;
          continue;
        }

        // Odciski palca obecne w bazie dla tego klubu.
        const dbRows = await sql.unsafe('SELECT fingerprint FROM activities WHERE club_id = $1', [club.id]);
        const inDb = new Set(dbRows.map((r) => String(r.fingerprint)));

        // Każdą aktywność z feedu sprawdzamy po tym samym odcisku co polling.
        const missingByAthlete = new Map();
        for (const a of feed) {
          const athlete = athleteOf(a);
          const fp = fingerprint(athlete, a);
          if (!inDb.has(fp)) {
            if (!missingByAthlete.has(athlete)) missingByAthlete.set(athlete, []);
            missingByAthlete.get(athlete).push(a);
          }
        }

        const athletesInFeed = new Set(feed.map(athleteOf)).size;
        if (missingByAthlete.size === 0) {
          console.log(ok(`OK — ${feed.length} akt. w feedzie, ${athletesInFeed} zawodników, wszystko jest w bazie`));
        } else {
          const missTotal = [...missingByAthlete.values()].reduce((n, l) => n + l.length, 0);
          console.log(bad(`BRAKUJE ${missTotal} akt. (${feed.length} w feedzie) — nie wgrały się do bazy:`));
          for (const [athlete, list] of missingByAthlete) {
            console.log(`      ${bad('•')} ${c.bold}${athlete}${c.reset}: ${list.length} akt.`);
            for (const a of list.slice(0, 5)) {
              const km = ((a.distance ?? 0) / 1000).toFixed(1);
              const min = Math.round((a.moving_time ?? 0) / 60);
              console.log(`          ${c.dim}- ${a.name ?? '(bez nazwy)'} | ${a.sport_type ?? a.type ?? '?'} | ${km} km | ${min} min${c.reset}`);
            }
            if (list.length > 5) console.log(`          ${c.dim}… i ${list.length - 5} więcej${c.reset}`);
          }
          problems += missTotal;
        }
      }
    }

    // --------------------------------------------------------------- CZĘŚĆ 2
    // Zdrowie bazy: ostatni poll, liczniki, świeżość danych zawodników.
    console.log(head('2) ZDROWIE BAZY'));

    console.log(`\n  ${c.bold}Ostatni udany poll na klub${c.reset} ${c.dim}(stary = polling się wywala)${c.reset}:`);
    for (const club of CLUBS) {
      const r = await sql.unsafe(
        `SELECT ran_at, seen_count, new_count FROM poll_log
         WHERE club_id = $1 ORDER BY ran_at DESC LIMIT 1`, [club.id]);
      if (!r[0]) {
        console.log(`    ${warn('•')} ${club.name}: ${warn('NIGDY nie pollowany')}`);
        problems++;
        continue;
      }
      const ago = fmtAgo(r[0].ran_at);
      const stale = (Date.now() - new Date(r[0].ran_at).getTime()) > 6 * 3600 * 1000;
      const mark = stale ? warn('•') : ok('•');
      const agoStr = stale ? warn(ago) : ago;
      console.log(`    ${mark} ${club.name}: ${agoStr} ${c.dim}(widziano ${r[0].seen_count}, nowych ${r[0].new_count})${c.reset}`);
      if (stale) problems++;
    }

    console.log(`\n  ${c.bold}Podsumowanie na klub${c.reset}:`);
    for (const club of CLUBS) {
      const r = await sql.unsafe(
        `SELECT COUNT(*) AS total,
                COUNT(DISTINCT athlete_name) AS athletes,
                MAX(first_seen) AS last_seen,
                SUM(CASE WHEN counted THEN 1 ELSE 0 END) AS counted
         FROM activities WHERE club_id = $1`, [club.id]);
      const row = r[0] ?? {};
      console.log(`    ${ok('•')} ${club.name}: ${row.total ?? 0} akt. (liczonych ${row.counted ?? 0}), ` +
        `${row.athletes ?? 0} zawodn., ostatnia ${fmtAgo(row.last_seen)}`);
    }

    console.log(`\n  ${c.bold}Ostatnia aktywność każdego zawodnika${c.reset} ${c.dim}(sortowane od najstarszej)${c.reset}:`);
    const athletes = await sql.unsafe(
      `SELECT a.club_id, a.athlete_name, MAX(a.first_seen) AS last_seen, COUNT(*) AS n
       FROM activities a
       GROUP BY a.club_id, a.athlete_name
       ORDER BY MAX(a.first_seen) ASC`);
    const clubName = (id) => CLUBS.find((c) => c.id === Number(id))?.name ?? id;
    for (const a of athletes) {
      const stale = (Date.now() - new Date(a.last_seen).getTime()) > 5 * 24 * 3600 * 1000;
      const mark = stale ? warn('•') : c.dim + '•' + c.reset;
      const when = stale ? warn(fmtAgo(a.last_seen)) : fmtAgo(a.last_seen);
      console.log(`    ${mark} ${a.athlete_name} ${c.dim}(${clubName(a.club_id)})${c.reset}: ${when} ${c.dim}· ${a.n} akt.${c.reset}`);
    }

    // --------------------------------------------------------------- PODSUMOWANIE
    console.log(head('PODSUMOWANIE'));
    if (problems === 0) {
      console.log(ok('  ✓ Wygląda dobrze — nie wykryto brakujących aktywności ani problemów z pollingiem.\n'));
    } else {
      console.log(bad(`  ✗ Wykryto ${problems} potencjalnych problemów (zob. wpisy na czerwono/żółto wyżej).\n`));
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  process.exitCode = problems === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(`\n${c.red}Błąd:${c.reset} ${e.message}`);
  process.exitCode = 2;
});
