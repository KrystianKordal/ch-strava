// Konfiguracja wyzwania. Kluby i daty nie są tajne — trzymamy je w repo.
// Dane wrażliwe (Strava, Turso) idą przez zmienne środowiskowe.

export type Club = { id: number; name: string; color: string };

export const clubs: Club[] = [
  { id: 2173191, name: 'Drużyna H', color: '#2563eb' }, // niebieska
  { id: 2173293, name: 'Drużyna R', color: '#dc2626' }, // czerwona
  { id: 2173396, name: 'Drużyna O', color: '#16a34a' }, // zielona
];

export const challenge = {
  name: 'Strava: letnie wyzwanie',
  startDate: '2026-06-08', // pierwszy dzień (poniedziałek)
  endDate: '2026-07-31',   // ostatni dzień
};

export const timezone = 'Europe/Warsaw';

export const strava = {
  clientId: process.env.STRAVA_CLIENT_ID ?? '',
  clientSecret: process.env.STRAVA_CLIENT_SECRET ?? '',
};

/** Bazowy URL aplikacji (do callbacku OAuth). */
export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

// Sekret chroniący ręczny trigger /api/poll. POLL_SECRET to nowa nazwa,
// CRON_SECRET zostaje jako alias dla kompatybilności wstecznej.
export const cronSecret = process.env.POLL_SECRET ?? process.env.CRON_SECRET ?? '';
export const allowSeed = process.env.ALLOW_SEED === '1';

export function clubById(id: number): Club | undefined {
  return clubs.find((c) => c.id === id);
}
