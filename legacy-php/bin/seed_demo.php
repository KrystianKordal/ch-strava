<?php

declare(strict_types=1);

/**
 * Wypełnia bazę danymi DEMONSTRACYJNYMI, by zobaczyć dashboard bez
 * podłączania prawdziwego konta Strava.
 *
 *   php bin/seed_demo.php
 *
 * Uruchomienie czyści tabelę activities i generuje losowe aktywności
 * dla wszystkich tygodni wyzwania.
 */

$config = require __DIR__ . '/../src/bootstrap.php';

use App\Database;
use App\Week;

date_default_timezone_set($config['timezone'] ?? 'UTC');

$db = new Database((string) $config['db_path']);
$db->syncClubs($config['clubs']);
$pdo = $db->pdo();
$pdo->exec('DELETE FROM activities');
$pdo->exec('DELETE FROM poll_log');

$week = new Week(new DateTimeZone($config['timezone'] ?? 'UTC'));
$weeks = $week->between($config['challenge']['start_date'], $config['challenge']['end_date']);
if ($weeks === []) {
    // Gdy wyzwanie zaczyna się w przyszłości — pokaż ostatnie 6 tygodni.
    $weeks = [];
    $cursor = new DateTimeImmutable('-5 weeks', new DateTimeZone($config['timezone'] ?? 'UTC'));
    for ($i = 0; $i < 6; $i++) {
        $weeks[] = $week->keyFor($cursor);
        $cursor = $cursor->modify('+1 week');
    }
}

$firstNames = ['Anna', 'Marek', 'Kasia', 'Tomek', 'Ola', 'Piotr', 'Magda', 'Bartek', 'Ewa', 'Kuba', 'Zofia', 'Michał'];
$lastInits = ['K.', 'N.', 'W.', 'L.', 'S.', 'B.', 'M.', 'Z.', 'P.', 'C.'];
$sports = ['Run', 'Ride', 'Walk', 'Swim', 'Hike', 'WeightTraining', 'VirtualRide'];
$names = ['Poranny bieg', 'Trening interwałowy', 'Spokojna jazda', 'Długi wybieg', 'Po pracy', 'Weekendowa wycieczka', 'Basen', 'Siłownia'];

// Każdy klub ma stałą pulę zawodników o różnej "formie".
mt_srand(42);
$athletesByClub = [];
foreach ($config['clubs'] as $club) {
    $count = mt_rand(6, 11);
    $list = [];
    for ($i = 0; $i < $count; $i++) {
        $list[] = [
            'name'   => $firstNames[array_rand($firstNames)] . ' ' . $lastInits[array_rand($lastInits)],
            'energy' => mt_rand(40, 130) / 100, // mnożnik aktywności
        ];
    }
    $athletesByClub[$club['id']] = $list;
}

$insert = $pdo->prepare(
    'INSERT INTO activities
        (club_id, fingerprint, athlete_name, activity_name, type, sport_type,
         distance, moving_time, elapsed_time, elevation, week_key, first_seen)
     VALUES (:club_id, :fp, :an, :nm, :tp, :st, :di, :mt, :et, :el, :wk, :fs)'
);

$total = 0;
foreach ($weeks as $wk) {
    [$start] = $week->range($wk);
    foreach ($config['clubs'] as $club) {
        $clubId = (int) $club['id'];
        $pdo->beginTransaction();
        foreach ($athletesByClub[$clubId] as $ath) {
            $sessions = (int) round(mt_rand(2, 6) * $ath['energy']);
            for ($s = 0; $s < $sessions; $s++) {
                $sport = $sports[array_rand($sports)];
                $moving = (int) (mt_rand(20, 130) * 60 * $ath['energy']); // sekundy
                $distance = in_array($sport, ['Run', 'Walk', 'Hike'], true)
                    ? $moving / 60 * mt_rand(150, 320)
                    : ($sport === 'Swim' ? $moving / 60 * 40 : $moving / 60 * mt_rand(250, 600));
                $dayOffset = mt_rand(0, 6);
                $seen = $start->modify("+$dayOffset days")->modify('+' . mt_rand(6, 21) . ' hours');
                $insert->execute([
                    ':club_id' => $clubId,
                    ':fp' => bin2hex(random_bytes(8)),
                    ':an' => $ath['name'],
                    ':nm' => $names[array_rand($names)],
                    ':tp' => $sport,
                    ':st' => $sport,
                    ':di' => round($distance, 1),
                    ':mt' => $moving,
                    ':et' => $moving + mt_rand(0, 600),
                    ':el' => mt_rand(0, 600),
                    ':wk' => $wk,
                    ':fs' => $seen->format('c'),
                ]);
                $total++;
            }
        }
        $pdo->commit();
        $pdo->prepare('INSERT INTO poll_log (club_id, seen_count, new_count, ran_at) VALUES (?,?,?,?)')
            ->execute([$clubId, 0, 0, date('c')]);
    }
}

echo "Wygenerowano $total aktywności demonstracyjnych dla " . count($weeks) . " tygodni.\n";
echo "Otwórz dashboard: php -S localhost:8000 -t public  →  http://localhost:8000\n";
