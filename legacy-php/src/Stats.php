<?php

declare(strict_types=1);

namespace App;

use DateTimeImmutable;
use DateTimeZone;
use PDO;

/**
 * Liczy wszystkie statystyki dashboardu na podstawie zebranych aktywności.
 *
 * Okno czasowe wyzwania:
 *  - PRZED startem ('before') — pokazujemy WSZYSTKIE zebrane dane jako okres
 *    przygotowawczy (rozgrzewka), bez filtra dat.
 *  - W TRAKCIE / PO ('running'/'ended') — liczymy WYŁĄCZNIE aktywności z okna
 *    [start_date 00:00, end_date 23:59:59]. Wszystko sprzed startu jest pomijane.
 */
final class Stats
{
    /** @var array{phase:string, lower:?string, upper:?string, start:DateTimeImmutable, end:DateTimeImmutable, now:DateTimeImmutable} */
    private array $window;
    private string $winCond = '';
    /** @var array<string,string> */
    private array $winParams = [];

    public function __construct(
        private PDO $pdo,
        private array $config,
        private Week $week,
    ) {
        $this->window = $this->computeWindow();
        if ($this->window['lower'] !== null) {
            $this->winCond = 'first_seen >= :wlo AND first_seen <= :whi';
            $this->winParams = [':wlo' => $this->window['lower'], ':whi' => $this->window['upper']];
        }
    }

    /** Buduje kompletny payload JSON dla dashboardu. */
    public function dashboard(): array
    {
        $clubs = $this->clubs();
        $weeks = $this->challengeWeeks();

        $weekly = $this->weeklyResults($weeks, $clubs);
        $standings = $this->standings($weekly, $clubs);
        $totals = $this->totals($clubs);

        $start = $this->window['start']->format('Y-m-d');
        $daysToStart = $this->window['phase'] === 'before'
            ? (int) ceil(($this->window['start']->getTimestamp() - $this->window['now']->getTimestamp()) / 86400)
            : 0;

        return [
            'challenge'    => $this->config['challenge'],
            'phase'        => $this->window['phase'],      // before | running | ended
            'days_to_start' => $daysToStart,
            'generated_at' => date('c'),
            'clubs'        => array_values($clubs),
            'standings'    => $standings,
            'current_week' => $this->currentWeek($clubs),
            'weekly'       => $weekly,
            'totals'       => $totals,
            'top_athletes' => $this->topAthletes($clubs),
            'sport_breakdown' => $this->sportBreakdown($clubs),
            'highlights'   => $this->highlights($weekly, $totals, $clubs),
            'last_poll'    => $this->lastPoll(),
        ];
    }

    /** Wyznacza fazę i granice okna czasowego wyzwania. */
    private function computeWindow(): array
    {
        $tz = new DateTimeZone($this->config['timezone'] ?? 'UTC');
        $now = new DateTimeImmutable('now', $tz);
        $start = new DateTimeImmutable($this->config['challenge']['start_date'] . ' 00:00:00', $tz);
        $end = new DateTimeImmutable($this->config['challenge']['end_date'] . ' 23:59:59', $tz);

        if ($now < $start) {
            // Przed startem — okres przygotowawczy, pokazujemy wszystko.
            return ['phase' => 'before', 'lower' => null, 'upper' => null, 'start' => $start, 'end' => $end, 'now' => $now];
        }

        return [
            'phase' => $now > $end ? 'ended' : 'running',
            'lower' => $start->format('c'),
            'upper' => $end->format('c'),
            'start' => $start,
            'end'   => $end,
            'now'   => $now,
        ];
    }

    /** Lista tygodni do pokazania, zależnie od fazy wyzwania. */
    private function challengeWeeks(): array
    {
        if ($this->window['phase'] === 'before') {
            // Rozgrzewka: tygodnie od pierwszej zebranej aktywności do dziś.
            $min = $this->pdo->query('SELECT MIN(first_seen) FROM activities')->fetchColumn();
            if (!$min) {
                return [];
            }
            return $this->week->between(substr((string) $min, 0, 10), $this->window['now']->format('Y-m-d'));
        }

        return $this->week->between(
            $this->config['challenge']['start_date'],
            $this->config['challenge']['end_date']
        );
    }

    /** Dokleja warunek okna czasowego do klauzuli WHERE. */
    private function whereWindow(string $existing = ''): string
    {
        if ($this->winCond === '') {
            return $existing !== '' ? "WHERE $existing" : '';
        }
        if ($existing === '') {
            return "WHERE {$this->winCond}";
        }
        return "WHERE $existing AND {$this->winCond}";
    }

    /** @return array<int, array{id:int,name:string,color:string}> indeksowane po id */
    private function clubs(): array
    {
        $rows = $this->pdo->query('SELECT id, name, color FROM clubs ORDER BY id')->fetchAll();
        $out = [];
        foreach ($rows as $r) {
            $out[(int) $r['id']] = [
                'id'    => (int) $r['id'],
                'name'  => $r['name'],
                'color' => $r['color'],
            ];
        }
        return $out;
    }

    /**
     * Wyniki tydzień po tygodniu: dla każdego tygodnia suma czasu/dystansu
     * każdego klubu oraz zwycięzca (klub z największą liczbą godzin).
     */
    private function weeklyResults(array $weeks, array $clubs): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT week_key, club_id,
                    SUM(moving_time) AS moving_time,
                    SUM(distance)    AS distance,
                    SUM(elevation)   AS elevation,
                    COUNT(*)         AS activities,
                    COUNT(DISTINCT athlete_name) AS athletes
             FROM activities ' . $this->whereWindow() . '
             GROUP BY week_key, club_id'
        );
        $stmt->execute($this->winParams);
        $agg = $stmt->fetchAll();

        // Indeks: [week_key][club_id] => wiersz
        $byWeek = [];
        foreach ($agg as $r) {
            $byWeek[$r['week_key']][(int) $r['club_id']] = $r;
        }

        $result = [];
        foreach ($weeks as $wk) {
            $clubRows = [];
            $maxTime = -1;
            foreach ($clubs as $cid => $club) {
                $row = $byWeek[$wk][$cid] ?? null;
                $time = (int) ($row['moving_time'] ?? 0);
                $clubRows[$cid] = [
                    'club_id'     => $cid,
                    'moving_time' => $time,
                    'distance'    => (float) ($row['distance'] ?? 0),
                    'elevation'   => (float) ($row['elevation'] ?? 0),
                    'activities'  => (int) ($row['activities'] ?? 0),
                    'athletes'    => (int) ($row['athletes'] ?? 0),
                    'winner'      => false,
                ];
                $maxTime = max($maxTime, $time);
            }

            $winners = [];
            if ($maxTime > 0) {
                foreach ($clubRows as $cid => &$row) {
                    if ($row['moving_time'] === $maxTime) {
                        $row['winner'] = true;
                        $winners[] = $cid;
                    }
                }
                unset($row);
            }

            $result[] = [
                'week_key' => $wk,
                'label'    => $this->week->label($wk),
                'clubs'    => array_values($clubRows),
                'winners'  => $winners,
                'tie'      => count($winners) > 1,
            ];
        }

        return $result;
    }

    /** Klasyfikacja generalna: liczba wygranych tygodni przez każdy klub. */
    private function standings(array $weekly, array $clubs): array
    {
        $wins = array_fill_keys(array_keys($clubs), 0);
        $totalTime = array_fill_keys(array_keys($clubs), 0);

        foreach ($weekly as $w) {
            foreach ($w['winners'] as $cid) {
                $wins[$cid]++;
            }
            foreach ($w['clubs'] as $row) {
                $totalTime[$row['club_id']] += $row['moving_time'];
            }
        }

        $out = [];
        foreach ($clubs as $cid => $club) {
            $out[] = [
                'club_id'     => $cid,
                'name'        => $club['name'],
                'color'       => $club['color'],
                'weeks_won'   => $wins[$cid],
                'total_time'  => $totalTime[$cid], // tie-breaker
            ];
        }

        usort($out, fn($a, $b) =>
            $b['weeks_won'] <=> $a['weeks_won'] ?: $b['total_time'] <=> $a['total_time']
        );

        foreach ($out as $i => &$row) {
            $row['rank'] = $i + 1;
        }
        unset($row);

        return $out;
    }

    /** Bieżący (trwający) tydzień — wynik na żywo. */
    private function currentWeek(array $clubs): array
    {
        $wk = $this->week->keyFor();
        $stmt = $this->pdo->prepare(
            'SELECT club_id,
                    SUM(moving_time) AS moving_time,
                    SUM(distance)    AS distance,
                    SUM(elevation)   AS elevation,
                    COUNT(*)         AS activities,
                    COUNT(DISTINCT athlete_name) AS athletes
             FROM activities ' . $this->whereWindow('week_key = :wk') . ' GROUP BY club_id'
        );
        $stmt->execute([':wk' => $wk] + $this->winParams);
        $byClub = [];
        foreach ($stmt->fetchAll() as $r) {
            $byClub[(int) $r['club_id']] = $r;
        }

        $clubsOut = [];
        $maxTime = 0;
        foreach ($clubs as $cid => $club) {
            $time = (int) ($byClub[$cid]['moving_time'] ?? 0);
            $clubsOut[] = [
                'club_id'     => $cid,
                'name'        => $club['name'],
                'color'       => $club['color'],
                'moving_time' => $time,
                'distance'    => (float) ($byClub[$cid]['distance'] ?? 0),
                'elevation'   => (float) ($byClub[$cid]['elevation'] ?? 0),
                'activities'  => (int) ($byClub[$cid]['activities'] ?? 0),
                'athletes'    => (int) ($byClub[$cid]['athletes'] ?? 0),
            ];
            $maxTime = max($maxTime, $time);
        }
        usort($clubsOut, fn($a, $b) => $b['moving_time'] <=> $a['moving_time']);

        return [
            'week_key' => $wk,
            'label'    => $this->week->label($wk),
            'clubs'    => $clubsOut,
            'leader'   => $maxTime > 0 ? ($clubsOut[0]['club_id'] ?? null) : null,
        ];
    }

    /** Sumy z całego okna wyzwania per klub. */
    private function totals(array $clubs): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT club_id,
                    SUM(moving_time) AS moving_time,
                    SUM(distance)    AS distance,
                    SUM(elevation)   AS elevation,
                    COUNT(*)         AS activities,
                    COUNT(DISTINCT athlete_name) AS athletes
             FROM activities ' . $this->whereWindow() . ' GROUP BY club_id'
        );
        $stmt->execute($this->winParams);
        $byClub = [];
        foreach ($stmt->fetchAll() as $r) {
            $byClub[(int) $r['club_id']] = $r;
        }

        $out = [];
        foreach ($clubs as $cid => $club) {
            $r = $byClub[$cid] ?? [];
            $activities = (int) ($r['activities'] ?? 0);
            $time = (int) ($r['moving_time'] ?? 0);
            $out[] = [
                'club_id'     => $cid,
                'name'        => $club['name'],
                'color'       => $club['color'],
                'moving_time' => $time,
                'distance'    => (float) ($r['distance'] ?? 0),
                'elevation'   => (float) ($r['elevation'] ?? 0),
                'activities'  => $activities,
                'athletes'    => (int) ($r['athletes'] ?? 0),
                'avg_time'    => $activities > 0 ? (int) round($time / $activities) : 0,
            ];
        }
        return $out;
    }

    /** Najaktywniejsi zawodnicy każdego klubu (po czasie ruchu). */
    private function topAthletes(array $clubs, int $limit = 5): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT athlete_name,
                    SUM(moving_time) AS moving_time,
                    SUM(distance)    AS distance,
                    COUNT(*)         AS activities
             FROM activities ' . $this->whereWindow('club_id = :cid') . '
             GROUP BY athlete_name
             ORDER BY moving_time DESC
             LIMIT :lim'
        );

        $out = [];
        foreach ($clubs as $cid => $club) {
            $stmt->bindValue(':cid', $cid, PDO::PARAM_INT);
            $stmt->bindValue(':lim', $limit, PDO::PARAM_INT);
            foreach ($this->winParams as $k => $v) {
                $stmt->bindValue($k, $v);
            }
            $stmt->execute();
            $out[] = [
                'club_id'  => $cid,
                'name'     => $club['name'],
                'color'    => $club['color'],
                'athletes' => array_map(fn($r) => [
                    'name'        => $r['athlete_name'],
                    'moving_time' => (int) $r['moving_time'],
                    'distance'    => (float) $r['distance'],
                    'activities'  => (int) $r['activities'],
                ], $stmt->fetchAll()),
            ];
        }
        return $out;
    }

    /** Rozkład typów aktywności (łączny czas wg dyscypliny). */
    private function sportBreakdown(array $clubs): array
    {
        $stmt = $this->pdo->prepare(
            "SELECT COALESCE(NULLIF(sport_type, ''), COALESCE(NULLIF(type, ''), 'Inne')) AS sport,
                    SUM(moving_time) AS moving_time,
                    COUNT(*)         AS activities
             FROM activities " . $this->whereWindow() . "
             GROUP BY sport
             ORDER BY moving_time DESC"
        );
        $stmt->execute($this->winParams);

        return array_map(fn($r) => [
            'sport'       => $r['sport'],
            'moving_time' => (int) $r['moving_time'],
            'activities'  => (int) $r['activities'],
        ], $stmt->fetchAll());
    }

    /** Ciekawostki / rekordy (w obrębie okna wyzwania). */
    private function highlights(array $weekly, array $totals, array $clubs): array
    {
        $highlights = [];

        // Najdłuższa pojedyncza aktywność.
        $stmt = $this->pdo->prepare(
            'SELECT a.*, c.name AS club_name FROM activities a
             JOIN clubs c ON c.id = a.club_id
             ' . $this->whereWindow() . '
             ORDER BY a.moving_time DESC LIMIT 1'
        );
        $stmt->execute($this->winParams);
        $longest = $stmt->fetch();
        if ($longest) {
            $highlights['longest_activity'] = [
                'athlete'     => $longest['athlete_name'],
                'club'        => $longest['club_name'],
                'name'        => $longest['activity_name'],
                'moving_time' => (int) $longest['moving_time'],
                'distance'    => (float) $longest['distance'],
                'sport'       => $longest['sport_type'] ?: $longest['type'],
            ];
        }

        // Najaktywniejszy zawodnik całego wyzwania.
        $stmt = $this->pdo->prepare(
            'SELECT a.athlete_name, c.name AS club_name,
                    SUM(a.moving_time) AS moving_time, COUNT(*) AS activities
             FROM activities a JOIN clubs c ON c.id = a.club_id
             ' . $this->whereWindow() . '
             GROUP BY a.athlete_name, a.club_id
             ORDER BY moving_time DESC LIMIT 1'
        );
        $stmt->execute($this->winParams);
        $athlete = $stmt->fetch();
        if ($athlete) {
            $highlights['top_athlete'] = [
                'athlete'     => $athlete['athlete_name'],
                'club'        => $athlete['club_name'],
                'moving_time' => (int) $athlete['moving_time'],
                'activities'  => (int) $athlete['activities'],
            ];
        }

        // Najbardziej jednostronny tydzień.
        $biggestMargin = null;
        foreach ($weekly as $w) {
            $times = array_map(fn($c) => $c['moving_time'], $w['clubs']);
            rsort($times);
            if (count($times) < 2 || $times[0] === 0) {
                continue;
            }
            $margin = $times[0] - $times[1];
            if ($biggestMargin === null || $margin > $biggestMargin['margin']) {
                $biggestMargin = ['week' => $w['label'], 'margin' => $margin];
            }
        }
        if ($biggestMargin) {
            $highlights['biggest_margin'] = $biggestMargin;
        }

        // Sumy całego okna (wszystkie kluby).
        $totalSeconds = array_sum(array_map(fn($t) => $t['moving_time'], $totals));
        $highlights['total_hours'] = round($totalSeconds / 3600, 1);
        $highlights['total_activities'] = array_sum(array_map(fn($t) => $t['activities'], $totals));
        $highlights['total_distance_km'] = round(array_sum(array_map(fn($t) => $t['distance'], $totals)) / 1000, 1);

        return $highlights;
    }

    private function lastPoll(): ?string
    {
        $row = $this->pdo->query('SELECT MAX(ran_at) AS t FROM poll_log')->fetch();
        return $row['t'] ?? null;
    }
}
