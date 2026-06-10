import { db } from './db';
import { strava, appUrl } from './config';
import { encryptToken, decryptToken } from './token-crypto';

// Klient API Strava: OAuth (autoryzacja per klub) + pobieranie aktywności.
// Tokeny trzymamy w tabeli `tokens` (jeden wiersz na klub).

const OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token';
const API_BASE = 'https://www.strava.com/api/v3';

export type TokenRow = {
  club_id: number;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete_name: string | null;
};

export type StravaActivity = {
  athlete?: { firstname?: string; lastname?: string };
  name?: string;
  type?: string;
  sport_type?: string;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  total_elevation_gain?: number;
};

/**
 * URL ekranu autoryzacji dla danego klubu. `state` to ciąg anty-CSRF
 * (`<clubId>.<nonce>`) — nonce jest dodatkowo zapisany w cookie i sprawdzany
 * w callbacku, żeby cudzy `code` nie mógł podszyć się pod naszą sesję.
 */
export function authorizeUrl(clubId: number, state: string): string {
  const params = new URLSearchParams({
    client_id: strava.clientId,
    redirect_uri: `${appUrl()}/api/callback`,
    response_type: 'code',
    approval_prompt: 'force',
    // Minimalny scope: do feedu klubowego wystarcza 'read'. NIE prosimy o
    // 'activity:read_all' (prywatne aktywności) ani o nic więcej.
    // Jeśli feed klubowy okaże się wymagać 'activity:read', zmień na
    // 'read,activity:read' — to wciąż nie daje aktywności prywatnych.
    scope: 'read',
    state,
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

/** Wymienia kod autoryzacyjny na token i zapisuje go dla klubu. */
export async function exchangeCode(clubId: number, code: string): Promise<TokenRow> {
  const data = await postToken({
    client_id: strava.clientId,
    client_secret: strava.clientSecret,
    code,
    grant_type: 'authorization_code',
  });
  const athleteName = [data.athlete?.firstname, data.athlete?.lastname].filter(Boolean).join(' ') || null;
  return saveToken(clubId, data, athleteName);
}

/** Zwraca ważny access token klubu, odświeżając go w razie potrzeby. */
export async function accessTokenForClub(clubId: number): Promise<string> {
  const row = await loadToken(clubId);
  if (!row) {
    throw new Error(`Brak tokenu dla klubu ${clubId}. Autoryzuj go na /auth.`);
  }
  if (row.expires_at <= Math.floor(Date.now() / 1000) + 60) {
    const data = await postToken({
      client_id: strava.clientId,
      client_secret: strava.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: row.refresh_token,
    });
    const refreshed = await saveToken(clubId, data, row.athlete_name);
    return refreshed.access_token;
  }
  return row.access_token;
}

/**
 * Pobiera aktywności klubu (paginacja). Endpoint NIE zwraca dat ani ID —
 * datę przypisuje poll na podstawie momentu pierwszego zauważenia.
 */
export async function clubActivities(
  clubId: number,
  perPage = 200,
  maxPages = 3,
): Promise<StravaActivity[]> {
  const token = await accessTokenForClub(clubId);
  const all: StravaActivity[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetch(`${API_BASE}/clubs/${clubId}/activities?per_page=${perPage}&page=${page}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (res.status === 429) throw new Error('Przekroczono limit zapytań do API Strava (429).');
    if (!res.ok) throw new Error(`API Strava błąd (${res.status}): ${await res.text()}`);
    const batch = (await res.json()) as StravaActivity[];
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < perPage) break;
  }
  return all;
}

// ---------------------------------------------------------------- HTTP --

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { firstname?: string; lastname?: string };
};

async function postToken(fields: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
    cache: 'no-store',
  });
  const data = (await res.json()) as TokenResponse & { message?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`OAuth Strava błąd (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

// --------------------------------------------------------- Token store --

async function loadToken(clubId: number): Promise<TokenRow | null> {
  const r = await db().execute({ sql: 'SELECT * FROM tokens WHERE club_id = ?', args: [clubId] });
  const row = r.rows[0];
  if (!row) return null;
  return {
    club_id: Number(row.club_id),
    access_token: decryptToken(String(row.access_token)),
    refresh_token: decryptToken(String(row.refresh_token)),
    expires_at: Number(row.expires_at),
    athlete_name: row.athlete_name ? String(row.athlete_name) : null,
  };
}

async function saveToken(clubId: number, data: TokenResponse, athleteName: string | null): Promise<TokenRow> {
  await db().execute({
    sql: `INSERT INTO tokens (club_id, access_token, refresh_token, expires_at, athlete_name)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(club_id) DO UPDATE SET
            access_token = excluded.access_token,
            refresh_token = excluded.refresh_token,
            expires_at = excluded.expires_at,
            athlete_name = COALESCE(excluded.athlete_name, tokens.athlete_name)`,
    args: [
      clubId,
      encryptToken(data.access_token),
      encryptToken(data.refresh_token),
      data.expires_at,
      athleteName,
    ],
  });
  return {
    club_id: clubId,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
    athlete_name: athleteName,
  };
}

/** Czy klub ma zapisany token? (do widoku /auth) */
export async function hasToken(clubId: number): Promise<TokenRow | null> {
  return loadToken(clubId);
}
