<?php

/**
 * Skopiuj ten plik do config.php i uzupełnij swoimi danymi.
 *
 *   cp config.example.php config.php
 *
 * Dane aplikacji znajdziesz na https://www.strava.com/settings/api
 * (utwórz aplikację, ustaw "Authorization Callback Domain" na np. localhost).
 */

return [
    // --- Dane aplikacji Strava (z https://www.strava.com/settings/api) ---
    'strava' => [
        'client_id'     => 'TWOJE_CLIENT_ID',
        'client_secret' => 'TWOJ_CLIENT_SECRET',
        // URL, na który Strava odeśle po autoryzacji (musi pasować do callback domain).
        'redirect_uri'  => 'http://localhost:8000/auth.php',
    ],

    // --- Trzy kluby biorące udział w wyzwaniu ---
    // ID klubu znajdziesz w URL klubu: strava.com/clubs/<ID>
    // 'color' służy do kolorowania klubu na dashboardzie.
    'clubs' => [
        ['id' => 111111, 'name' => 'Klub A', 'color' => '#fc4c02'],
        ['id' => 222222, 'name' => 'Klub B', 'color' => '#2c7be5'],
        ['id' => 333333, 'name' => 'Klub C', 'color' => '#00b894'],
    ],

    // --- Ramy czasowe wyzwania ---
    'challenge' => [
        'name'       => 'Wyzwanie klubowe',
        'start_date' => '2026-06-01', // pierwszy dzień wyzwania (poniedziałek zalecany)
        'end_date'   => '2026-08-31', // ostatni dzień wyzwania
        // Pierwszy dzień tygodnia: 1 = poniedziałek (zgodnie z ISO-8601).
        'week_start' => 1,
    ],

    // --- Lokalna baza danych (SQLite) ---
    'db_path'   => __DIR__ . '/data/strava.sqlite',
    // Katalog na tokeny OAuth. KAŻDY klub ma osobny token (token_<clubId>.json),
    // autoryzowany przez członka tego konkretnego klubu (patrz bin/auth.php).
    'token_dir' => __DIR__ . '/data',

    // Strefa czasowa używana do przypisywania aktywności do tygodni.
    'timezone' => 'Europe/Warsaw',
];
