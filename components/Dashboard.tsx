'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardData, HallOfFameAward } from '@/lib/stats';
import { sportPl } from '@/lib/sport-names';

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
        </div>
      </header>

      <main>
        {error && <div className="error">Błąd ładowania danych: {error}</div>}
        {!error && !data && <div className="loading">Wczytywanie danych…</div>}
        {data && <Content data={data} />}
      </main>

      <footer className="footer muted">Dane ze Strava Club API • dashboard na Next.js + Supabase</footer>
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

      <div className="section-gap">
        <LiveWeek data={data} />
      </div>

      <div className="section-gap">
        <WeeklyTable data={data} />
      </div>
      <div className="section-gap">
        <Athletes data={data} />
      </div>
      <div className="section-gap">
        <AthletesAll data={data} />
      </div>
      <div className="section-gap">
        <Sports data={data} />
      </div>
      <div className="section-gap">
        <HallOfFame data={data} />
      </div>
    </>
  );
}

function plPoints(n: number): string {
  // Polska odmiana: 1 punkt, 2–4 punkty, 0/5+ punktów (z wyjątkiem 12–14).
  const abs = Math.abs(n);
  const d = abs % 10;
  const dd = abs % 100;
  if (n === 1) return 'punkt';
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 'punkty';
  return 'punktów';
}

function Standings({ data }: { data: DashboardData }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Klasyfikacja generalna — punkty</h2>
        <span className="muted points-legend">
          🥇 wygrany tydzień = 3 pkt · 🥈 drugie miejsce = 1 pkt · 🥉 trzecie = 0 pkt
        </span>
      </div>
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
              {s.points}
              <small> {plPoints(s.points)}</small>
            </div>
            <div className="place-counts" title="Zajęte miejsca w zakończonych tygodniach">
              <span title="Pierwsze miejsca">①×{s.weeks_won}</span>
              <span title="Drugie miejsca">②×{s.seconds}</span>
              <span title="Trzecie miejsca">③×{s.thirds}</span>
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
    { label: 'Prowadzi', value: leader ? leader.name : '—', sub: leader ? `${leader.points} ${plPoints(leader.points)} · ${leader.weeks_won} wygranych tyg.` : '' },
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

function HallOfFame({ data }: { data: DashboardData }) {
  // Najpierw osiągnięcia z przypisanym zdobywcą, na końcu wyszarzone (bez
  // danych). Sort jest stabilny, więc kolejność w obrębie grup się zachowuje.
  const awards = [...(data.hall_of_fame ?? [])].sort((a, b) => Number(b.available) - Number(a.available));
  const clubColors = new Map(data.clubs.map((c) => [c.id, c.color]));
  const individual = awards.filter((a) => a.scope === 'athlete');
  const team = awards.filter((a) => a.scope === 'team');

  const renderAward = (a: HallOfFameAward) => (
    <div key={a.key} className={`hof-card${a.available ? '' : ' disabled'}`} tabIndex={0}>
      <span className="hof-ico">{a.icon}</span>
      <div className="hof-body">
        <div className="hof-title">{a.title}</div>
        <div className="hof-sub">{a.subtitle}</div>
        <div className="hof-winner">
          {a.available && a.club_id != null && dot(clubColors.get(a.club_id) ?? 'var(--muted)')}
          <span className="hof-name">{a.winner ?? '—'}</span>
        </div>
        <div className="hof-metric">{a.metric ?? 'Za mało danych, by wyłonić zdobywcę'}</div>
      </div>
      <span className="hof-tip" role="tooltip">
        {a.tip}
      </span>
    </div>
  );

  return (
    <div className="card">
      <h2>Hala Sław</h2>
      {awards.length === 0 ? (
        <p className="muted">Osiągnięcia pojawią się po zebraniu pierwszych aktywności.</p>
      ) : (
        <>
          <h3 className="hof-group-title">Osiągnięcia indywidualne</h3>
          <div className="hof-grid">{individual.map(renderAward)}</div>
          <h3 className="hof-group-title">Osiągnięcia drużynowe</h3>
          <div className="hof-grid">{team.map(renderAward)}</div>
        </>
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
        <div className="table-wrap">
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
                    // Tydzień jeszcze trwa — nie wyróżniamy zwycięzcy, bo nie jest rozstrzygnięty.
                    const winner = w.ended && x?.winner;
                    const showPts = w.ended && !!x && x.points > 0;
                    return (
                      <td
                        key={c.id}
                        className={`num ${winner ? 'win-cell' : ''}`}
                        style={winner ? { color: c.color } : undefined}
                      >
                        {x ? dur(x.moving_time) : '—'}
                        {showPts && <small className="pts">+{x.points}</small>}
                      </td>
                    );
                  })}
                  <td>
                    {!w.ended ? (
                      <span className="muted">w trakcie</span>
                    ) : winNames ? (
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
        </div>
      )}
    </div>
  );
}

// Wartość oznaczająca „wszystkie tygodnie razem" w selektorze tygodni.
const ALL_WEEKS = 'all';

type WeekOption = { value: string; label: string };

// Opcje selektora tygodni + domyślny wybór. Domyślnie bieżący tydzień
// (jeśli jest wśród tygodni wyzwania), w przeciwnym razie ostatni dostępny.
function useWeekSelection(data: DashboardData) {
  const options = useMemo<WeekOption[]>(() => {
    const weeks = data.weekly.map((w) => ({ value: w.week_key, label: w.label }));
    // Najnowsze tygodnie na górze, a na końcu wariant zbiorczy.
    return [...[...weeks].reverse(), { value: ALL_WEEKS, label: 'Wszystkie tygodnie' }];
  }, [data.weekly]);

  const defaultWeek = useMemo(() => {
    const keys = data.weekly.map((w) => w.week_key);
    const current = data.current_week.week_key;
    if (keys.includes(current)) return current;
    return keys.length ? keys[keys.length - 1] : ALL_WEEKS;
  }, [data.weekly, data.current_week.week_key]);

  const [week, setWeek] = useState<string>(defaultWeek);
  // Gdy zmieni się zbiór tygodni (np. po odświeżeniu danych), a wybrany
  // tydzień zniknie z listy, wróć do domyślnego.
  useEffect(() => {
    if (week !== ALL_WEEKS && !options.some((o) => o.value === week)) setWeek(defaultWeek);
  }, [options, week, defaultWeek]);

  return { week, setWeek, options };
}

function WeekSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: WeekOption[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="week-select">
      <span className="muted">Tydzień:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Athletes({ data }: { data: DashboardData }) {
  const { week, setWeek, options } = useWeekSelection(data);
  const clubsData =
    week === ALL_WEEKS
      ? data.top_athletes
      : (data.top_athletes_by_week[week] ??
        data.clubs.map((c) => ({ club_id: c.id, name: c.name, color: c.color, athletes: [] })));
  return (
    <div className="card">
      <div className="card-head">
        <h2>Najaktywniejsi zawodnicy w drużynach</h2>
        <WeekSelect value={week} options={options} onChange={setWeek} />
      </div>
      <div className="grid cols-3">
        {clubsData.map((club) => (
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

function AthletesAll({ data }: { data: DashboardData }) {
  const clubsById = new Map(data.clubs.map((c) => [c.id, c]));
  const { week, setWeek, options } = useWeekSelection(data);
  const athletes = (week === ALL_WEEKS ? data.all_athletes : data.all_athletes_by_week[week]) ?? [];
  return (
    <div className="card">
      <div className="card-head">
        <h2>Ranking wszystkich zawodników — łączny czas</h2>
        <WeekSelect value={week} options={options} onChange={setWeek} />
      </div>
      {athletes.length === 0 ? (
        <p className="muted">Brak danych.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Zawodnik</th>
                <th>Drużyna</th>
                <th className="num">Czas</th>
                <th className="num">Aktywności</th>
                <th className="num">Dystans</th>
              </tr>
            </thead>
            <tbody>
              {athletes.map((a) => {
                const club = clubsById.get(a.club_id);
                return (
                  <tr key={`${a.club_id}-${a.name}`}>
                    <td>{a.rank <= 3 ? MEDALS[a.rank - 1] : a.rank}</td>
                    <td>{a.name}</td>
                    <td>
                      {club ? (
                        <>
                          {dot(club.color)}
                          {club.name}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="num">{dur(a.moving_time)}</td>
                    <td className="num">{a.activities}</td>
                    <td className="num">{fmtDec1(a.distance / 1000)} km</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Sports({ data }: { data: DashboardData }) {
  const sports = data.sport_breakdown ?? [];
  const clubColors = new Map(data.clubs.map((c) => [c.id, c.color]));
  const max = Math.max(1, ...sports.map((s) => s.moving_time));
  return (
    <div className="card">
      <h2>Rozkład dyscyplin (łączny czas)</h2>
      {sports.length === 0 ? (
        <p className="muted">Brak danych.</p>
      ) : (
        sports.slice(0, 10).map((s) => (
          <div key={s.sport} className="sport-row">
            <span className="sname">{sportPl(s.sport)}</span>
            <span className="strack">
              {/* Pasek wypełniony proporcjonalnie do największej dyscypliny; w środku
                  segmenty w kolorach drużyn wg ich udziału w tej dyscyplinie. */}
              <span className="sfill" style={{ width: `${((s.moving_time / max) * 100).toFixed(1)}%` }}>
                {s.clubs
                  .filter((c) => c.moving_time > 0)
                  .map((c) => {
                    const color = clubColors.get(c.club_id);
                    const clubName = data.clubs.find((x) => x.id === c.club_id)?.name ?? '';
                    return (
                      <span
                        key={c.club_id}
                        className="sseg"
                        style={{
                          width: `${((c.moving_time / s.moving_time) * 100).toFixed(2)}%`,
                          background: color ?? 'var(--accent)',
                        }}
                        title={`${clubName}: ${dur(c.moving_time)}`}
                      />
                    );
                  })}
              </span>
            </span>
            <span className="sval">{dur(s.moving_time)}</span>
          </div>
        ))
      )}
    </div>
  );
}
