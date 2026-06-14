import { DateTime } from 'luxon';
import { timezone } from './config';
import { sportPl } from './sport-names';
import type { ManagedActivity } from './manual';

// Formatowanie aktywności do wyświetlenia w panelu /manual. Współdzielone przez
// stronę (SSR) i /api/activities (odpowiedź AJAX po edycji), żeby tytuł/opis
// wiersza po zapisie były liczone w jednym miejscu.

export function hm(sec: number): { h: number; m: number } {
  const s = Math.max(0, Math.trunc(sec));
  return { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60) };
}

export function fmtTime(sec: number): string {
  const { h, m } = hm(sec);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function fmtKm(m: number): string {
  return m > 0 ? `${(m / 1000).toFixed(2)} km` : '—';
}

/** ISO (z offsetem) → wartość dla <input type="datetime-local"> w strefie wyzwania. */
export function toLocalInput(iso: string): string {
  const d = DateTime.fromISO(iso).setZone(timezone);
  return d.isValid ? d.toFormat("yyyy-LL-dd'T'HH:mm") : '';
}

export function fmtSeen(iso: string): string {
  const d = DateTime.fromISO(iso).setZone(timezone);
  return d.isValid ? d.toFormat('dd.LL.yyyy HH:mm') : iso;
}

/** Tytuł + podpis wiersza aktywności. */
export function activityDisplay(a: ManagedActivity, clubName: string): { title: string; sub: string } {
  const sport = a.sport_type ?? a.type ?? 'Inne';
  return {
    title: `${a.athlete_name} · ${a.activity_name || sportPl(sport) || 'Aktywność'}`,
    sub: `${clubName} · ${sportPl(sport)} · ${fmtTime(a.moving_time)} · ${fmtKm(a.distance)} · ${a.week_key} · ${fmtSeen(a.first_seen)}`,
  };
}
