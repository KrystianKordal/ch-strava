import { createClient, type Client } from '@libsql/client';

// libSQL/Turso jest kompatybilne ze SQLite, więc schemat i zapytania
// przenoszą się prawie 1:1 z wersji PHP.
//
// Lokalnie (bez TURSO_DATABASE_URL) używamy pliku file:./data/local.db.
// Na Vercel ustaw TURSO_DATABASE_URL + TURSO_AUTH_TOKEN.

let client: Client | null = null;

export function db(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL || 'file:./data/local.db';
  client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  return client;
}

let schemaReady = false;

/** Tworzy schemat przy pierwszym użyciu (idempotentne). */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const c = db();
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS clubs (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#888888'
    );

    CREATE TABLE IF NOT EXISTS activities (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      club_id       INTEGER NOT NULL,
      fingerprint   TEXT NOT NULL,
      athlete_name  TEXT NOT NULL,
      activity_name TEXT,
      type          TEXT,
      sport_type    TEXT,
      distance      REAL NOT NULL DEFAULT 0,
      moving_time   INTEGER NOT NULL DEFAULT 0,
      elapsed_time  INTEGER NOT NULL DEFAULT 0,
      elevation     REAL NOT NULL DEFAULT 0,
      week_key      TEXT NOT NULL,
      first_seen    TEXT NOT NULL,
      UNIQUE (club_id, fingerprint)
    );

    CREATE INDEX IF NOT EXISTS idx_activities_week ON activities (week_key);
    CREATE INDEX IF NOT EXISTS idx_activities_club ON activities (club_id);

    CREATE TABLE IF NOT EXISTS tokens (
      club_id       INTEGER PRIMARY KEY,
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at    INTEGER NOT NULL,
      athlete_name  TEXT
    );

    CREATE TABLE IF NOT EXISTS poll_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      club_id    INTEGER NOT NULL,
      seen_count INTEGER NOT NULL DEFAULT 0,
      new_count  INTEGER NOT NULL DEFAULT 0,
      ran_at     TEXT NOT NULL
    );
  `);
  schemaReady = true;
}

/**
 * Zapisuje konfigurację klubów (upsert) i usuwa kluby spoza configu
 * (wraz z ich aktywnościami) — żeby zmiana ID nie zostawiała starych danych.
 */
export async function syncClubs(
  list: { id: number; name: string; color: string }[],
): Promise<void> {
  if (list.length === 0) return;
  const c = db();
  for (const club of list) {
    await c.execute({
      sql: `INSERT INTO clubs (id, name, color) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color`,
      args: [club.id, club.name, club.color],
    });
  }
  const ids = list.map((c) => c.id);
  const placeholders = ids.map(() => '?').join(',');
  await c.execute({ sql: `DELETE FROM activities WHERE club_id NOT IN (${placeholders})`, args: ids });
  await c.execute({ sql: `DELETE FROM clubs WHERE id NOT IN (${placeholders})`, args: ids });
}
