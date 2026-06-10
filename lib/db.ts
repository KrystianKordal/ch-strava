import postgres from 'postgres';

// Warstwa bazy: Supabase (Postgres). Zapytania w kodzie używają jeszcze
// placeholderów '?' (z czasów SQLite/libSQL) — adapter tłumaczy je na '$1, $2'
// i odpala przez postgres.js, zachowując kształt wyniku { rows, rowsAffected }.
//
// Połączenie bierzemy z DATABASE_URL (albo POSTGRES_URL, które ustawia
// integracja Vercel ↔ Supabase). Na produkcji użyj connection stringa z
// poolera Supabase (Transaction, port 6543) — stąd prepare:false (PgBouncer).

export type InValue = string | number | bigint | boolean | null;

type Row = Record<string, InValue>;
type ExecArg = string | { sql: string; args?: InValue[] };
type Result = { rows: Row[]; rowsAffected: number };

let sql: ReturnType<typeof postgres> | null = null;

function client(): ReturnType<typeof postgres> {
  if (sql) return sql;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      'Brak DATABASE_URL — wklej connection string z Supabase (Settings → Database).',
    );
  }
  sql = postgres(url, {
    ssl: sslOption(url),  // Supabase wymaga TLS; lokalny Postgres zwykle nie
    prepare: false,       // wymagane przy poolerze Supabase (PgBouncer, transaction mode)
    max: 1,               // serverless: jedna instancja funkcji = jedno połączenie
    idle_timeout: 20,
  });
  return sql;
}

// TLS wymagamy domyślnie (Supabase), ale nie dla lokalnego Postgresa
// ani gdy w connection stringu jawnie podano sslmode=disable.
function sslOption(url: string): 'require' | false {
  if (/[?&]sslmode=disable/.test(url)) return false;
  if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return false;
  return 'require';
}

// '?' → '$1, $2, ...' (placeholdery z czasów SQLite/libSQL).
function toPg(text: string): string {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

export function db() {
  return {
    async execute(arg: ExecArg): Promise<Result> {
      const text = typeof arg === 'string' ? arg : arg.sql;
      const args = typeof arg === 'string' ? [] : (arg.args ?? []);
      const res = await client().unsafe(toPg(text), args as never[]);
      return { rows: res as unknown as Row[], rowsAffected: res.count ?? 0 };
    },
    // Wiele instrukcji naraz (schemat) — protokół „simple" (bez parametrów).
    async executeMultiple(text: string): Promise<void> {
      await client().unsafe(text).simple();
    },
  };
}

let schemaReady = false;

/** Tworzy schemat przy pierwszym użyciu (idempotentne). */
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  const c = db();
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS clubs (
      id    BIGINT PRIMARY KEY,
      name  TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#888888'
    );

    CREATE TABLE IF NOT EXISTS activities (
      id            BIGSERIAL PRIMARY KEY,
      club_id       BIGINT NOT NULL,
      fingerprint   TEXT NOT NULL,
      athlete_name  TEXT NOT NULL,
      activity_name TEXT,
      type          TEXT,
      sport_type    TEXT,
      distance      DOUBLE PRECISION NOT NULL DEFAULT 0,
      moving_time   BIGINT NOT NULL DEFAULT 0,
      elapsed_time  BIGINT NOT NULL DEFAULT 0,
      elevation     DOUBLE PRECISION NOT NULL DEFAULT 0,
      week_key      TEXT NOT NULL,
      first_seen    TEXT NOT NULL,
      UNIQUE (club_id, fingerprint)
    );

    CREATE INDEX IF NOT EXISTS idx_activities_week ON activities (week_key);
    CREATE INDEX IF NOT EXISTS idx_activities_club ON activities (club_id);

    CREATE TABLE IF NOT EXISTS tokens (
      club_id       BIGINT PRIMARY KEY,
      access_token  TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at    BIGINT NOT NULL,
      athlete_name  TEXT
    );

    CREATE TABLE IF NOT EXISTS poll_log (
      id         BIGSERIAL PRIMARY KEY,
      club_id    BIGINT NOT NULL,
      seen_count BIGINT NOT NULL DEFAULT 0,
      new_count  BIGINT NOT NULL DEFAULT 0,
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
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, color = excluded.color`,
      args: [club.id, club.name, club.color],
    });
  }
  const ids = list.map((c) => c.id);
  const placeholders = ids.map(() => '?').join(',');
  await c.execute({ sql: `DELETE FROM activities WHERE club_id NOT IN (${placeholders})`, args: ids });
  await c.execute({ sql: `DELETE FROM clubs WHERE id NOT IN (${placeholders})`, args: ids });
}
