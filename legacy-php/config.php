<?php

/**
 * Działająca konfiguracja. Uzupełnij sekcję 'strava' i 'clubs' swoimi danymi.
 * Daty wyzwania ustawione tak, by demo (bin/seed_demo.php) wyglądało bogato.
 */

return [
    'strava' => [
        'client_id'     => getenv('STRAVA_CLIENT_ID') ?: 'TWOJE_CLIENT_ID',
        'client_secret' => getenv('STRAVA_CLIENT_SECRET') ?: 'TWOJ_CLIENT_SECRET',
        'redirect_uri'  => getenv('STRAVA_REDIRECT_URI') ?: 'http://localhost:8000/auth.php',
    ],

    'clubs' => [
        ['id' => 2173191, 'name' => 'Drużyna H', 'color' => '#2563eb'], // niebieska
        ['id' => 2173293, 'name' => 'Drużyna R', 'color' => '#dc2626'], // czerwona
        ['id' => 2173396, 'name' => 'Drużyna O', 'color' => '#16a34a'], // zielona
    ],

    'challenge' => [
        'name'       => 'Strava: letnie wyzwanie',
        'start_date' => '2026-06-08',
        'end_date'   => '2026-07-31',
        'week_start' => 1,
    ],

    'db_path'   => __DIR__ . '/data/strava.sqlite',
    // Katalog na tokeny — osobny plik na każdy klub: token_<clubId>.json
    'token_dir' => __DIR__ . '/data',
    'timezone'  => 'Europe/Warsaw',
];
