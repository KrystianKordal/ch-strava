<?php

declare(strict_types=1);

/**
 * Pobiera aktywności klubów ze Strava i zapisuje nowe do bazy.
 *
 * Uruchamiaj regularnie z crona, np. co godzinę:
 *
 *   0 * * * * /usr/bin/php /sciezka/do/strava_dashboard/bin/poll.php >> /tmp/strava_poll.log 2>&1
 *
 * Dlaczego cron? Endpoint /clubs/{id}/activities zwraca tylko ostatnie
 * aktywności i NIE podaje ich daty. Dlatego o przypisaniu aktywności do
 * tygodnia decyduje moment jej pierwszego zauważenia (first_seen). Im
 * częstszy polling, tym dokładniejsze przypisanie do właściwego tygodnia.
 */

$config = require __DIR__ . '/../src/bootstrap.php';

use App\Database;
use App\StravaClient;
use App\Week;

date_default_timezone_set($config['timezone'] ?? 'UTC');

$db = new Database((string) $config['db_path']);
$db->syncClubs($config['clubs']);
$pdo = $db->pdo();

$tokenDir = rtrim((string) $config['token_dir'], '/');

$week = new Week(new DateTimeZone($config['timezone'] ?? 'UTC'));
$weekKey = $week->keyFor();
$now = date('c');

$insert = $pdo->prepare(
    'INSERT OR IGNORE INTO activities
        (club_id, fingerprint, athlete_name, activity_name, type, sport_type,
         distance, moving_time, elapsed_time, elevation, week_key, first_seen)
     VALUES
        (:club_id, :fingerprint, :athlete_name, :activity_name, :type, :sport_type,
         :distance, :moving_time, :elapsed_time, :elevation, :week_key, :first_seen)'
);

foreach ($config['clubs'] as $club) {
    $clubId = (int) $club['id'];

    // Każdy klub ma własny token (autoryzowany przez swojego członka).
    $tokenPath = $tokenDir . '/token_' . $clubId . '.json';
    if (!is_file($tokenPath)) {
        fwrite(STDERR, "[$now] Klub {$club['name']} ($clubId): pominięty — brak autoryzacji. Otwórz /auth.php?club=$clubId\n");
        continue;
    }

    $client = new StravaClient(
        (string) $config['strava']['client_id'],
        (string) $config['strava']['client_secret'],
        $tokenPath,
    );

    try {
        $activities = $client->clubActivities($clubId);
    } catch (Throwable $e) {
        fwrite(STDERR, "[$now] Klub $clubId: błąd pobierania — {$e->getMessage()}\n");
        continue;
    }

    $new = 0;
    $pdo->beginTransaction();
    foreach ($activities as $a) {
        $athlete = trim(
            ($a['athlete']['firstname'] ?? '') . ' ' . ($a['athlete']['lastname'] ?? '')
        );
        $athlete = $athlete !== '' ? $athlete : 'Nieznany';

        // Odcisk palca aktywności — endpoint nie zwraca ID, więc budujemy
        // stabilny identyfikator z dostępnych pól, by nie liczyć duplikatów.
        $fingerprint = md5(implode('|', [
            $athlete,
            $a['name'] ?? '',
            $a['sport_type'] ?? ($a['type'] ?? ''),
            (int) round((float) ($a['distance'] ?? 0)),
            (int) ($a['moving_time'] ?? 0),
            (int) ($a['elapsed_time'] ?? 0),
            (int) round((float) ($a['total_elevation_gain'] ?? 0)),
        ]));

        $insert->execute([
            ':club_id'       => $clubId,
            ':fingerprint'   => $fingerprint,
            ':athlete_name'  => $athlete,
            ':activity_name' => $a['name'] ?? null,
            ':type'          => $a['type'] ?? null,
            ':sport_type'    => $a['sport_type'] ?? ($a['type'] ?? null),
            ':distance'      => (float) ($a['distance'] ?? 0),
            ':moving_time'   => (int) ($a['moving_time'] ?? 0),
            ':elapsed_time'  => (int) ($a['elapsed_time'] ?? 0),
            ':elevation'     => (float) ($a['total_elevation_gain'] ?? 0),
            ':week_key'      => $weekKey,
            ':first_seen'    => $now,
        ]);
        $new += $insert->rowCount();
    }
    $pdo->commit();

    $pdo->prepare(
        'INSERT INTO poll_log (club_id, seen_count, new_count, ran_at)
         VALUES (:c, :s, :n, :r)'
    )->execute([
        ':c' => $clubId,
        ':s' => count($activities),
        ':n' => $new,
        ':r' => $now,
    ]);

    echo "[$now] Klub {$club['name']} ($clubId): zobaczono " . count($activities) . " aktywności, nowych: $new\n";
}

echo "[$now] Gotowe. Tydzień: $weekKey\n";
