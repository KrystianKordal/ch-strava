'use client';

import { useCallback, useEffect, useState } from 'react';
import type { DashboardData } from '@/lib/stats';

// --- formatery (deterministyczne, by uniknąć rozjazdu SSR/CSR) ---
const PL_MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MEDALS = ['🥇', '🥈', '🥉'];

function dur(sec: number): string {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtInt(n: number): string {
  return Math.round(n || 0)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
function fmtDec1(n: number): string {
  const [i, d] = (Math.round((n || 0) * 10) / 10).toFixed(1).split('.');
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${d}`;
}
function plDate(iso?: string): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${PL_MONTHS[m - 1]} ${y}`;
}
function plDays(n: number): string {
  return n === 1 ? '1 dzień' : `${n} dni`;
}
function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date(iso));
}

const dot = (color: string) => <span className="club-dot" style={{ background: color }} />;

export default function Dashboard({
  initial,
  initialError,
}: {
  initial: DashboardData | null;
  initialError: string | null;
}) {
  const [data, setData] = useState<DashboardData | null>(initial);
  const [error, setError] = useState<string | null>(initialError);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/stats', { cache: 'no-store' });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const id = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <div id="app">
      <header className="topbar">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="ch-logo" src="/customerhero_logo.svg" alt="CustomerHero" width={227} height={40} />
          <span className="brand-divider" />
          <div>
            <h1>{data?.challenge?.name ?? 'Strava: letnie wyzwanie'}</h1>
            <Dates data={data} />
          </div>
        </div>
        <div className="topbar-meta">
          <span className="muted">
            {data?.last_poll ? `Ostatnia aktualizacja: ${fmtDateTime(data.last_poll)}` : 'Brak danych z pollingu'}
          </span>
          <button className="btn" onClick={refresh}>
            Odśwież
          </button>
        </div>
      </header>

      <main>
        {error && <div className="error">Błąd ładowania danych: {error}</div>}
        {!error && !data && <div className="loading">Wczytywanie danych…</div>}
        {data && <Content data={data} />}
      </main>

      <footer className="footer muted">Dane ze Strava Club API • dashboard na Next.js + Turso</footer>
    </div>
  );
}

function Dates({ data }: { data: DashboardData | null }) {
  if (!data) return <p className="muted" />;
  const phase = data.phase;
  const pill =
    phase === 'before'
      ? { cls: 'before', txt: `Start ${plDate(data.challenge.start_date)}` }
      : phase === 'ended'
        ? { cls: 'ended', txt: 'Zakończone' }
        : { cls: 'running', txt: `Trwa do ${plDate(data.challenge.end_date)}` };
  return (
    <p className="muted">
      {plDate(data.challenge.start_date)} – {plDate(data.challenge.end_date)}{' '}
      <span className={`phase-pill ${pill.cls}`}>{pill.txt}</span>
    </p>
  );
}

function Content({ data }: { data: DashboardData }) {
  const hasData = (data.highlights?.total_activities ?? 0) > 0;
  return (
    <>
      {data.phase === 'before' && (
        <div className="phase-banner before">
          <span className="ico">⏳</span>
          <div>
            <strong>
              Wyzwanie startuje {plDate(data.challenge.start_date)}
              {data.days_to_start > 0 ? ` (za ${plDays(data.days_to_start)})` : ''}.
            </strong>{' '}
            Dane poniżej to <strong>okres przygotowawczy</strong> — pokazujemy je na podgląd, ale{' '}
            <strong>nie liczą się do wyzwania</strong>. Po starcie licznik rusza od zera, a aktywności sprzed{' '}
            {plDate(data.challenge.start_date)} zostaną pominięte.
          </div>
        </div>
      )}
      {data.phase === 'ended' && (
        <div className="phase-banner ended">
          <span className="ico">🏁</span>
          <div>
            <strong>Wyzwanie zakończone ({plDate(data.challenge.end_date)}).</strong> Poniżej wyniki końcowe.
          </div>
        </div>
      )}

      {!hasData && (
        <div className="notice">
          <strong>Brak zebranych aktywności.</strong> Autoryzuj drużyny (<a href="/auth">/auth</a>) — po
          pierwszym pollingu pojawią się dane. Lokalnie możesz też wygenerować dane demo:{' '}
          <code>/api/seed</code>.
        </div>
      )}

      <Standings data={data} />
      <Tiles data={data} />

      <div className="grid cols-2 section-gap">
        <LiveWeek data={data} />
        <Highlights data={data} />
      </div>

      <div className="section-gap">
        <WeeklyTable data={data} />
      </div>
      <div className="section-gap">
        <Athletes data={data} />
      </div>
      <div className="section-gap">
        <Sports data={data} />
      </div>
    </>
  );
}

function Standings({ data }: { data: DashboardData }) {
  return (
    <div className="card">
      <h2>Klasyfikacja generalna — wygrane tygodnie</h2>
      <div className="podium">
        {data.standings.map((s, i) => (
          <div key={s.club_id} className={`podium-col${i === 0 ? ' first' : ''}`} style={{ borderTopColor: s.color }}>
            <div className="medal">{MEDALS[i] ?? '🏅'}</div>
            <div className="rank">#{s.rank}</div>
            <div className="club">
              {dot(s.color)}
              {s.name}
            </div>
            <div className="wins">
              {s.weeks_won}
              <small> tyg.</small>
            </div>
            <div className="muted">{dur(s.total_time)} łącznie</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Tiles({ data }: { data: DashboardData }) {
  const h = data.highlights;
  const leader = data.standings[0];
  const periodSub = data.phase === 'before' ? 'okres przygotowawczy' : 'w oknie wyzwania';
  const tiles = [
    { label: 'Prowadzi', value: leader ? leader.name : '—', sub: leader ? `${leader.weeks_won} wygranych tygodni` : '' },
    { label: 'Łączny czas', value: `${fmtDec1(Number(h.total_hours ?? 0))} h`, sub: 'wszystkie kluby' },
    { label: 'Aktywności', value: fmtInt(Number(h.total_activities ?? 0)), sub: periodSub },
    { label: 'Dystans', value: `${fmtDec1(Number(h.total_distance_km ?? 0))} km`, sub: 'razem' },
  ];
  return (
    <div className="tiles section-gap">
      {tiles.map((t) => (
        <div key={t.label} className="tile">
          <div className="label">{t.label}</div>
          <div className="value">{t.value}</div>
          <div className="sub">{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

function LiveWeek({ data }: { data: DashboardData }) {
  const cw = data.current_week;
  const max = Math.max(1, ...cw.clubs.map((x) => x.moving_time));
  return (
    <div className="card">
      <h2>Bieżący tydzień — {cw.label}</h2>
      {cw.clubs.map((club) => {
        const isLeader = cw.leader === club.club_id && club.moving_time > 0;
        return (
          <div key={club.club_id} className="barrow">
            <div className="barhead">
              <span className="name">
                {dot(club.color)}
                {club.name}
                {isLeader && <span className="leader-tag">PROWADZI</span>}
              </span>
              <span className="val">
                {dur(club.moving_time)} • {club.activities} akt.
              </span>
            </div>
            <div className="bartrack">
              <div
                className="barfill"
                style={{ width: `${((club.moving_time / max) * 100).toFixed(1)}%`, background: club.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Highlights({ data }: { data: DashboardData }) {
  const h = data.highlights as Record<string, any>;
  const items: { ico: string; title: string; sub: string }[] = [];
  if (h.top_athlete) {
    items.push({
      ico: '🔥',
      title: `Najaktywniejszy: ${h.top_athlete.athlete}`,
      sub: `${h.top_athlete.club} • ${dur(h.top_athlete.moving_time)} w ${h.top_athlete.activities} aktywnościach`,
    });
  }
  if (h.longest_activity) {
    items.push({
      ico: '⏱️',
      title: `Najdłuższa aktywność: ${dur(h.longest_activity.moving_time)}`,
      sub: `${h.longest_activity.athlete} (${h.longest_activity.club}) • ${h.longest_activity.sport || ''}`,
    });
  }
  if (h.biggest_margin) {
    items.push({
      ico: '💥',
      title: `Największa przewaga tygodnia: ${dur(h.biggest_margin.margin)}`,
      sub: `w tygodniu ${h.biggest_margin.week}`,
    });
  }
  return (
    <div className="card">
      <h2>Ciekawostki i rekordy</h2>
      {items.length === 0 ? (
        <p className="muted">Statystyki pojawią się po zebraniu pierwszych aktywności.</p>
      ) : (
        items.map((it, i) => (
          <div key={i} className="highlight-item">
            <div className="ico">{it.ico}</div>
            <div>
              <div className="h-title">{it.title}</div>
              <div className="h-sub">{it.sub}</div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function WeeklyTable({ data }: { data: DashboardData }) {
  const clubsById = new Map(data.clubs.map((c) => [c.id, c]));
  const rows = [...data.weekly].reverse();
  return (
    <div className="card">
      <h2>Wyniki tydzień po tygodniu</h2>
      {data.weekly.length === 0 ? (
        <p className="muted">Brak tygodni do wyświetlenia.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Tydzień</th>
              {data.clubs.map((c) => (
                <th key={c.id} className="num">
                  {c.name}
                </th>
              ))}
              <th>Zwycięzca</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => {
              const byClub = new Map(w.clubs.map((x) => [x.club_id, x]));
              const winNames = w.winners.map((id) => clubsById.get(id)?.name).filter(Boolean).join(', ');
              return (
                <tr key={w.week_key}>
                  <td>{w.label}</td>
                  {data.clubs.map((c) => {
                    const x = byClub.get(c.id);
                    const winner = x?.winner;
                    return (
                      <td
                        key={c.id}
                        className={`num ${winner ? 'win-cell' : ''}`}
                        style={winner ? { color: c.color } : undefined}
                      >
                        {x ? dur(x.moving_time) : '—'}
                      </td>
                    );
                  })}
                  <td>
                    {winNames ? (
                      <span className="win-badge">
                        {w.tie ? '🤝' : '🏆'} {winNames}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Athletes({ data }: { data: DashboardData }) {
  return (
    <div className="card">
      <h2>Najaktywniejsi zawodnicy w drużynach</h2>
      <div className="grid cols-3">
        {data.top_athletes.map((club) => (
          <div key={club.club_id}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>
              {dot(club.color)}
              {club.name}
            </div>
            <div className="club-list">
              {club.athletes.length === 0 ? (
                <div className="muted">Brak danych</div>
              ) : (
                club.athletes.map((a, i) => (
                  <div key={i} className="athlete">
                    <span className="who">
                      <span className="pos">{i + 1}</span>
                      {a.name}
                    </span>
                    <span className="t">{dur(a.moving_time)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sports({ data }: { data: DashboardData }) {
  const sports = data.sport_breakdown ?? [];
  const max = Math.max(1, ...sports.map((s) => s.moving_time));
  return (
    <div className="card">
      <h2>Rozkład dyscyplin (łączny czas)</h2>
      {sports.length === 0 ? (
        <p className="muted">Brak danych.</p>
      ) : (
        sports.slice(0, 10).map((s) => (
          <div key={s.sport} className="sport-row">
            <span className="sname">{s.sport}</span>
            <span className="strack">
              <span className="sfill" style={{ width: `${((s.moving_time / max) * 100).toFixed(1)}%` }} />
            </span>
            <span className="sval">{dur(s.moving_time)}</span>
          </div>
        ))
      )}
    </div>
  );
}
