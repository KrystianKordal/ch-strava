import { DateTime } from 'luxon';
import { timezone } from './config';

// Klucze tygodni ISO-8601 (tydzień zaczyna się w poniedziałek), liczone
// w strefie czasowej wyzwania. Klucz ma postać "2026-W23".

const PL_MONTHS = ['', 'sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function weekKeyFor(dt?: DateTime): string {
  const d = (dt ?? DateTime.now()).setZone(timezone);
  return `${d.weekYear}-W${pad2(d.weekNumber)}`;
}

export function currentWeekKey(): string {
  return weekKeyFor();
}

/** [poniedziałek 00:00, niedziela 23:59:59] danego tygodnia. */
export function weekRange(weekKey: string): [DateTime, DateTime] {
  const [yearStr, weekStr] = weekKey.split('-W');
  const start = DateTime.fromObject(
    { weekYear: Number(yearStr), weekNumber: Number(weekStr), weekday: 1 },
    { zone: timezone },
  ).startOf('day');
  const end = start.plus({ days: 6 }).endOf('day');
  return [start, end];
}

/** Etykieta zakresu dat, np. "2 cze – 8 cze". */
export function weekLabel(weekKey: string): string {
  const [start, end] = weekRange(weekKey);
  const fmt = (d: DateTime) => `${d.day} ${PL_MONTHS[d.month]}`;
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Klucze tygodni od startDate do endDate (włącznie), nie później niż dziś.
 */
export function weeksBetween(startDate: string, endDate: string): string[] {
  let cursor = DateTime.fromISO(startDate, { zone: timezone }).startOf('day');
  let end = DateTime.fromISO(endDate, { zone: timezone }).endOf('day');
  const now = DateTime.now().setZone(timezone);
  if (end > now) end = now;

  const keys = new Set<string>();
  while (cursor <= end) {
    keys.add(weekKeyFor(cursor));
    cursor = cursor.plus({ days: 1 });
  }
  return [...keys];
}
