'use strict';

const $ = (sel) => document.querySelector(sel);

// ---------------------------------------------------------------- helpers --
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function dur(sec) {
    sec = Math.round(sec || 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

function km(meters) {
    return (meters / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 }) + ' km';
}

function num(n) {
    return Number(n || 0).toLocaleString('pl-PL');
}

const MEDALS = ['🥇', '🥈', '🥉'];
const PL_MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

function plDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${PL_MONTHS[m - 1]} ${y}`;
}

function plDays(n) {
    if (n === 1) return '1 dzień';
    const r = n % 10, rr = n % 100;
    if (r >= 2 && r <= 4 && (rr < 12 || rr > 14)) return `${n} dni`;
    return `${n} dni`;
}

// ----------------------------------------------------------------- render --
function render(data) {
    const phase = data.phase || 'running';
    const startIso = data.challenge?.start_date;
    const endIso = data.challenge?.end_date;

    $('#challenge-name').textContent = data.challenge?.name || 'Wyzwanie klubowe';

    const pill = {
        before:  { cls: 'before',  txt: `Start ${plDate(startIso)}` },
        running: { cls: 'running', txt: `Trwa do ${plDate(endIso)}` },
        ended:   { cls: 'ended',   txt: 'Zakończone' },
    }[phase];
    $('#challenge-dates').innerHTML =
        `${plDate(startIso)} – ${plDate(endIso)} <span class="phase-pill ${pill.cls}">${pill.txt}</span>`;

    $('#last-poll').textContent = data.last_poll
        ? 'Ostatnia aktualizacja: ' + new Date(data.last_poll).toLocaleString('pl-PL')
        : 'Brak danych z pollingu';

    const hasData = (data.highlights?.total_activities ?? 0) > 0;
    const c = $('#content');
    c.innerHTML = '';

    // Baner fazy wyzwania.
    if (phase === 'before') {
        const dni = data.days_to_start > 0 ? ` (za ${plDays(data.days_to_start)})` : '';
        c.innerHTML += `
            <div class="phase-banner before">
                <span class="ico">⏳</span>
                <div><strong>Wyzwanie startuje ${plDate(startIso)}${dni}.</strong>
                Dane poniżej to <strong>okres przygotowawczy</strong> — pokazujemy je na podgląd,
                ale <strong>nie liczą się do wyzwania</strong>. Po starcie licznik rusza od zera,
                a aktywności sprzed ${plDate(startIso)} zostaną pominięte.</div>
            </div>`;
    } else if (phase === 'ended') {
        c.innerHTML += `
            <div class="phase-banner ended">
                <span class="ico">🏁</span>
                <div><strong>Wyzwanie zakończone (${plDate(endIso)}).</strong> Poniżej wyniki końcowe.</div>
            </div>`;
    }

    if (!hasData) {
        c.innerHTML += `
            <div class="notice">
                <strong>Brak zebranych aktywności.</strong>
                Autoryzuj drużyny (<a href="auth.php">/auth.php</a>) i pobierz dane
                (<code>php bin/poll.php</code>), albo wygeneruj dane demonstracyjne
                (<code>php bin/seed_demo.php</code>), aby zobaczyć dashboard w akcji.
            </div>`;
    }

    c.appendChild(standingsCard(data));
    c.appendChild(tilesRow(data));

    const row1 = el('div', 'grid cols-2 section-gap');
    row1.appendChild(liveWeekCard(data));
    row1.appendChild(highlightsCard(data));
    c.appendChild(row1);

    c.appendChild(wrapSection(weeklyTableCard(data)));
    c.appendChild(wrapSection(athletesCard(data)));
    c.appendChild(wrapSection(sportCard(data)));
}

function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
}
function wrapSection(node) {
    const d = el('div', 'section-gap');
    d.appendChild(node);
    return d;
}

// --- Klasyfikacja generalna (wygrane tygodnie) ---
function standingsCard(data) {
    const card = el('div', 'card');
    card.appendChild(el('h2', null, 'Klasyfikacja generalna — wygrane tygodnie'));

    const podium = el('div', 'podium');
    data.standings.forEach((s, i) => {
        const col = el('div', 'podium-col' + (i === 0 ? ' first' : ''));
        col.style.borderTopColor = s.color;
        col.innerHTML = `
            <div class="medal">${MEDALS[i] || '🏅'}</div>
            <div class="rank">#${s.rank}</div>
            <div class="club"><span class="club-dot" style="background:${esc(s.color)}"></span>${esc(s.name)}</div>
            <div class="wins">${s.weeks_won}<small> tyg.</small></div>
            <div class="muted">${dur(s.total_time)} łącznie</div>`;
        podium.appendChild(col);
    });
    card.appendChild(podium);
    return card;
}

// --- Kafelki ze statystykami zbiorczymi ---
function tilesRow(data) {
    const h = data.highlights || {};
    const wrap = el('div', 'tiles section-gap');
    const leader = data.standings?.[0];
    const periodSub = data.phase === 'before' ? 'okres przygotowawczy' : 'w oknie wyzwania';
    const tiles = [
        { label: 'Prowadzi', value: leader ? esc(leader.name) : '—', sub: leader ? `${leader.weeks_won} wygranych tygodni` : '' },
        { label: 'Łączny czas', value: (h.total_hours ?? 0).toLocaleString('pl-PL') + ' h', sub: 'wszystkie kluby' },
        { label: 'Aktywności', value: num(h.total_activities), sub: periodSub },
        { label: 'Dystans', value: num(h.total_distance_km) + ' km', sub: 'razem' },
    ];
    tiles.forEach(t => {
        wrap.appendChild(el('div', 'tile',
            `<div class="label">${t.label}</div><div class="value">${t.value}</div><div class="sub">${t.sub}</div>`));
    });
    return wrap;
}

// --- Bieżący tydzień (na żywo) ---
function liveWeekCard(data) {
    const cw = data.current_week;
    const card = el('div', 'card');
    card.appendChild(el('h2', null, `Bieżący tydzień — ${esc(cw.label)}`));

    const max = Math.max(1, ...cw.clubs.map(x => x.moving_time));
    cw.clubs.forEach(club => {
        const isLeader = data.current_week.leader === club.club_id && club.moving_time > 0;
        const row = el('div', 'barrow');
        row.innerHTML = `
            <div class="barhead">
                <span class="name"><span class="club-dot" style="background:${esc(club.color)}"></span>${esc(club.name)}${isLeader ? '<span class="leader-tag">PROWADZI</span>' : ''}</span>
                <span class="val">${dur(club.moving_time)} • ${club.activities} akt.</span>
            </div>
            <div class="bartrack"><div class="barfill" style="width:${(club.moving_time / max * 100).toFixed(1)}%;background:${esc(club.color)}"></div></div>`;
        card.appendChild(row);
    });
    return card;
}

// --- Ciekawostki ---
function highlightsCard(data) {
    const h = data.highlights || {};
    const card = el('div', 'card');
    card.appendChild(el('h2', null, 'Ciekawostki i rekordy'));

    const items = [];
    if (h.top_athlete) {
        items.push({ ico: '🔥', title: `Najaktywniejszy: ${esc(h.top_athlete.athlete)}`,
            sub: `${esc(h.top_athlete.club)} • ${dur(h.top_athlete.moving_time)} w ${h.top_athlete.activities} aktywnościach` });
    }
    if (h.longest_activity) {
        items.push({ ico: '⏱️', title: `Najdłuższa aktywność: ${dur(h.longest_activity.moving_time)}`,
            sub: `${esc(h.longest_activity.athlete)} (${esc(h.longest_activity.club)}) • ${esc(h.longest_activity.sport || '')}` });
    }
    if (h.biggest_margin) {
        items.push({ ico: '💥', title: `Największa przewaga tygodnia: ${dur(h.biggest_margin.margin)}`,
            sub: `w tygodniu ${esc(h.biggest_margin.week)}` });
    }
    if (items.length === 0) {
        card.appendChild(el('p', 'muted', 'Statystyki pojawią się po zebraniu pierwszych aktywności.'));
        return card;
    }
    items.forEach(it => {
        card.appendChild(el('div', 'highlight-item',
            `<div class="ico">${it.ico}</div><div><div class="h-title">${it.title}</div><div class="h-sub">${it.sub}</div></div>`));
    });
    return card;
}

// --- Tabela tydzień po tygodniu ---
function weeklyTableCard(data) {
    const card = el('div', 'card');
    card.appendChild(el('h2', null, 'Wyniki tydzień po tygodniu'));

    if (!data.weekly.length) {
        card.appendChild(el('p', 'muted', 'Brak tygodni do wyświetlenia.'));
        return card;
    }

    const clubsById = {};
    data.clubs.forEach(c => clubsById[c.id] = c);

    let head = '<tr><th>Tydzień</th>';
    data.clubs.forEach(c => head += `<th class="num">${esc(c.name)}</th>`);
    head += '<th>Zwycięzca</th></tr>';

    let body = '';
    // Najnowsze tygodnie na górze.
    [...data.weekly].reverse().forEach(w => {
        body += `<tr><td>${esc(w.label)}</td>`;
        const byClub = {};
        w.clubs.forEach(x => byClub[x.club_id] = x);
        data.clubs.forEach(c => {
            const x = byClub[c.id];
            const winner = x && x.winner;
            body += `<td class="num ${winner ? 'win-cell' : ''}" style="${winner ? 'color:' + esc(c.color) : ''}">${x ? dur(x.moving_time) : '—'}</td>`;
        });
        const winNames = w.winners.map(id => clubsById[id]?.name).filter(Boolean).join(', ');
        body += `<td>${winNames ? `<span class="win-badge">${w.tie ? '🤝' : '🏆'} ${esc(winNames)}</span>` : '<span class="muted">—</span>'}</td></tr>`;
    });

    const table = el('table');
    table.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
    card.appendChild(table);
    return card;
}

// --- Najlepsi zawodnicy w klubach ---
function athletesCard(data) {
    const card = el('div', 'card');
    card.appendChild(el('h2', null, 'Najaktywniejsi zawodnicy w klubach'));

    const grid = el('div', 'grid cols-3');
    data.top_athletes.forEach(club => {
        const col = el('div');
        col.innerHTML = `<div style="font-weight:700;margin-bottom:10px"><span class="club-dot" style="background:${esc(club.color)}"></span>${esc(club.name)}</div>`;
        const list = el('div', 'club-list');
        if (!club.athletes.length) {
            list.appendChild(el('div', 'muted', 'Brak danych'));
        }
        club.athletes.forEach((a, i) => {
            list.appendChild(el('div', 'athlete',
                `<span class="who"><span class="pos">${i + 1}</span>${esc(a.name)}</span><span class="t">${dur(a.moving_time)}</span>`));
        });
        col.appendChild(list);
        grid.appendChild(col);
    });
    card.appendChild(grid);
    return card;
}

// --- Rozkład dyscyplin ---
function sportCard(data) {
    const card = el('div', 'card');
    card.appendChild(el('h2', null, 'Rozkład dyscyplin (łączny czas)'));

    const sports = data.sport_breakdown || [];
    if (!sports.length) {
        card.appendChild(el('p', 'muted', 'Brak danych.'));
        return card;
    }
    const max = Math.max(...sports.map(s => s.moving_time), 1);
    sports.slice(0, 10).forEach(s => {
        const row = el('div', 'sport-row');
        row.innerHTML = `
            <span class="sname">${esc(s.sport)}</span>
            <span class="strack"><span class="sfill" style="width:${(s.moving_time / max * 100).toFixed(1)}%"></span></span>
            <span class="sval">${dur(s.moving_time)}</span>`;
        card.appendChild(row);
    });
    return card;
}

// ------------------------------------------------------------------- load --
async function load() {
    const c = $('#content');
    try {
        const res = await fetch('api.php', { cache: 'no-store' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        render(data);
    } catch (e) {
        c.innerHTML = `<div class="error">Błąd ładowania danych: ${esc(e.message)}</div>`;
    }
}

$('#refresh').addEventListener('click', load);
load();
// Auto-odświeżanie co 5 minut.
setInterval(load, 5 * 60 * 1000);
