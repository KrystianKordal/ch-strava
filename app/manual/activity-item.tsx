'use client';

import { useRef, useState } from 'react';

// Kliencki wiersz aktywności w panelu /manual. Wyłączanie/włączanie i usuwanie
// idą przez fetch (ajax=1) i aktualizują stan w miejscu — strona się NIE
// przeładowuje, więc nie gubi się pozycja na liście. Edycja zostaje na zwykłym
// submicie formularza (świadoma akcja, pełne przeładowanie jest tu w porządku).

export type ActivityItemProps = {
  id: number;
  actAction: string;
  keyVal: string;
  dotColor: string;
  title: string;
  sub: string;
  manual: boolean;
  initialCounted: boolean;
  filters: { fclub?: string; fweek?: string; fathlete?: string; fday?: string };
  weekOptions: { key: string; label: string }[];
  edit: {
    week: string;
    firstSeenLocal: string;
    athlete: string;
    name: string;
    sport: string;
    hours: number;
    minutes: number;
    distanceKm: string;
    elevation: string;
  };
};

export default function ActivityItem(props: ActivityItemProps) {
  const { id, actAction, keyVal, dotColor, manual, edit, filters, weekOptions } = props;
  const [counted, setCounted] = useState(props.initialCounted);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState<null | 'toggle' | 'delete' | 'edit'>(null);
  const [error, setError] = useState<string | null>(null);
  const [display, setDisplay] = useState({ title: props.title, sub: props.sub });
  const [saved, setSaved] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  async function send(op: 'toggle' | 'delete', extra: Record<string, string> = {}) {
    setBusy(op);
    setError(null);
    try {
      const body = new URLSearchParams({ key: keyVal, op, id: String(id), ajax: '1', ...extra });
      const res = await fetch(actAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Błąd (${res.status}).`);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function onToggle() {
    const next = !counted;
    if (await send('toggle', { counted: next ? '1' : '0' })) setCounted(next);
  }

  async function onDelete() {
    if (!confirm('Usunąć tę aktywność na stałe?')) return;
    if (await send('delete')) setRemoved(true);
  }

  async function onEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy('edit');
    setError(null);
    try {
      const body = new URLSearchParams(new FormData(form) as unknown as Record<string, string>);
      body.set('ajax', '1');
      const res = await fetch(actAction, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Błąd (${res.status}).`);
      if (typeof data.title === 'string' && typeof data.sub === 'string') {
        setDisplay({ title: data.title, sub: data.sub });
      }
      if (detailsRef.current) detailsRef.current.open = false;
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (removed) return null;

  return (
    <div className={`act-item${counted ? '' : ' off'}`}>
      <div className="act-head">
        <span className="act-dot" style={{ background: dotColor }} aria-hidden />
        <div className="act-main">
          <span className="act-title">{display.title}</span>
          <span className="act-sub">{display.sub}</span>
          {saved && <span className="ok-txt" style={{ fontSize: 12 }}>✓ zapisano</span>}
          {error && <span className="bad-txt" style={{ fontSize: 12 }}>✗ {error}</span>}
        </div>
        {manual && <span className="act-badge man">ręczna</span>}
        {!counted && <span className="act-badge off">wyłączona</span>}

        <div className="act-actions">
          <button className="btn-sm" type="button" onClick={onToggle} disabled={busy !== null}>
            {busy === 'toggle' ? '…' : counted ? 'Wyłącz' : 'Włącz'}
          </button>
          <button className="btn-sm danger" type="button" onClick={onDelete} disabled={busy !== null}>
            {busy === 'delete' ? '…' : 'Usuń'}
          </button>
        </div>
      </div>

      <details className="act-edit" ref={detailsRef}>
        <summary>Edytuj</summary>
        <form className="manual-form" method="post" action={actAction} onSubmit={onEdit}>
          <input type="hidden" name="key" value={keyVal} />
          <input type="hidden" name="op" value="update" />
          <input type="hidden" name="id" value={id} />
          {filters.fclub ? <input type="hidden" name="fclub" value={filters.fclub} /> : null}
          {filters.fweek ? <input type="hidden" name="fweek" value={filters.fweek} /> : null}
          {filters.fathlete ? <input type="hidden" name="fathlete" value={filters.fathlete} /> : null}
          {filters.fday ? <input type="hidden" name="fday" value={filters.fday} /> : null}

          <label>
            Tydzień
            <select name="week" defaultValue={edit.week} required>
              {weekOptions.map((w) => (
                <option key={w.key} value={w.key}>
                  {w.key} ({w.label})
                </option>
              ))}
            </select>
          </label>

          <label>
            Pierwsze wykrycie (opcjonalnie)
            <input name="first_seen" type="datetime-local" defaultValue={edit.firstSeenLocal} />
            <span className="hint">Musi mieścić się w wybranym tygodniu. Puste = początek tygodnia.</span>
          </label>

          <label>
            Zawodnik
            <input name="athlete" type="text" defaultValue={edit.athlete} required />
          </label>

          <label>
            Nazwa aktywności (opcjonalnie)
            <input name="name" type="text" defaultValue={edit.name} />
          </label>

          <label>
            Sport
            <input name="sport" list="manual-sports" defaultValue={edit.sport} placeholder="np. Run" autoComplete="off" />
            <span className="hint">Wybierz z podpowiedzi lub wpisz dowolny typ aktywności.</span>
          </label>

          <div className="row2">
            <label>
              Czas — godziny
              <input name="hours" type="number" min="0" step="1" defaultValue={edit.hours} />
            </label>
            <label>
              Czas — minuty
              <input name="minutes" type="number" min="0" max="59" step="1" defaultValue={edit.minutes} />
            </label>
          </div>

          <div className="row2">
            <label>
              Dystans (km, opcjonalnie)
              <input name="distance_km" type="number" min="0" step="0.01" defaultValue={edit.distanceKm} />
            </label>
            <label>
              Przewyższenie (m, opcjonalnie)
              <input name="elevation" type="number" min="0" step="1" defaultValue={edit.elevation} />
            </label>
          </div>

          <button className="btn" type="submit" disabled={busy !== null}>
            {busy === 'edit' ? 'Zapisywanie…' : 'Zapisz zmiany'}
          </button>
        </form>
      </details>
    </div>
  );
}
