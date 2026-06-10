<?php

declare(strict_types=1);

/**
 * Autoryzacja w Strava — OSOBNO dla każdego klubu (Opcja B).
 *
 * Każdy klub wymaga tokenu od osoby, która jest JEGO członkiem. Token zapisuje
 * się w data/token_<clubId>.json.
 *
 * Użycie:
 *   1. Otwórz http://localhost:8000/auth.php — zobaczysz listę 3 klubów.
 *   2. Przy każdym klubie kliknij „Autoryzuj" i zaloguj się kontem będącym
 *      członkiem tego klubu (każdy klub może autoryzować inna osoba).
 *   3. Strava wraca tutaj z ?code=...&state=<clubId>, a token zostaje zapisany.
 */

$config = require __DIR__ . '/../src/bootstrap.php';

use App\StravaClient;

header('Content-Type: text/html; charset=utf-8');

/** Ścieżka pliku tokenu dla danego klubu. */
function tokenPathFor(array $config, int $clubId): string
{
    return rtrim((string) $config['token_dir'], '/') . '/token_' . $clubId . '.json';
}

/** Znajduje klub po ID w konfiguracji. */
function findClub(array $config, int $clubId): ?array
{
    foreach ($config['clubs'] as $club) {
        if ((int) $club['id'] === $clubId) {
            return $club;
        }
    }
    return null;
}

function makeClient(array $config, int $clubId): StravaClient
{
    return new StravaClient(
        (string) $config['strava']['client_id'],
        (string) $config['strava']['client_secret'],
        tokenPathFor($config, $clubId),
    );
}

$code  = $_GET['code']  ?? null;
$error = $_GET['error'] ?? null;
$state = isset($_GET['state']) ? (int) $_GET['state'] : 0;
$club  = isset($_GET['club'])  ? (int) $_GET['club']  : 0;

// --- Odrzucenie zgody przez użytkownika ---
if ($error) {
    echo page('Autoryzacja odrzucona', "<p>Strava zwróciła błąd: <code>" . htmlspecialchars((string) $error) . "</code></p><p><a href='auth.php'>← wróć do listy</a></p>");
    exit;
}

// --- Powrót z autoryzacji: wymiana kodu na token ---
if ($code && $state) {
    $clubCfg = findClub($config, $state);
    if (!$clubCfg) {
        echo page('Nieznany klub', "<p>Klub o ID <code>$state</code> nie istnieje w config.php.</p>");
        exit;
    }
    try {
        $token = makeClient($config, $state)->exchangeCode((string) $code);
        $athlete = trim(($token['athlete']['firstname'] ?? '') . ' ' . ($token['athlete']['lastname'] ?? ''));
        echo page('✅ Klub autoryzowany', sprintf(
            "<p>Token dla klubu <strong>%s</strong> zapisany.</p>".
            "<p>Autoryzowano jako: <strong>%s</strong></p>".
            "<p><a href='auth.php'>← wróć do listy klubów</a></p>",
            htmlspecialchars((string) $clubCfg['name']),
            htmlspecialchars($athlete !== '' ? $athlete : '(nieznany)')
        ));
    } catch (Throwable $e) {
        echo page('Błąd wymiany kodu', "<pre>" . htmlspecialchars($e->getMessage()) . "</pre><p><a href='auth.php'>← wróć</a></p>");
    }
    exit;
}

// --- Rozpoczęcie autoryzacji konkretnego klubu ---
if ($club) {
    $clubCfg = findClub($config, $club);
    if (!$clubCfg) {
        echo page('Nieznany klub', "<p>Klub o ID <code>$club</code> nie istnieje w config.php.</p>");
        exit;
    }
    $url = makeClient($config, $club)->authorizeUrl(
        (string) $config['strava']['redirect_uri'],
        (string) $club // state = clubId
    );
    header('Location: ' . $url);
    echo "<p>Przekierowanie do Strava… <a href='" . htmlspecialchars($url) . "'>kliknij</a></p>";
    exit;
}

// --- Strona główna: lista klubów ze statusem ---
$rows = '';
foreach ($config['clubs'] as $c) {
    $cid = (int) $c['id'];
    $authorized = is_file(tokenPathFor($config, $cid));
    $status = $authorized
        ? "<span style='color:#00b894'>✓ autoryzowany</span>"
        : "<span style='color:#ff7b72'>✗ brak tokenu</span>";
    $btn = "<a class='b' href='auth.php?club=$cid'>" . ($authorized ? 'Autoryzuj ponownie' : 'Autoryzuj') . "</a>";
    $rows .= "<li><span class='dot' style='background:" . htmlspecialchars((string) ($c['color'] ?? '#888')) . "'></span>"
        . "<strong>" . htmlspecialchars((string) $c['name']) . "</strong> (ID $cid) — $status $btn</li>";
}

echo page('Autoryzacja klubów Strava',
    "<p>Autoryzuj <strong>każdy</strong> klub kontem, które jest jego członkiem ".
    "(każdy klub może autoryzować inna osoba).</p><ul class='clubs'>$rows</ul>".
    "<p class='muted'>Po autoryzacji wszystkich klubów uruchom: <code>php bin/poll.php</code>, ".
    "a potem otwórz <a href='/'>dashboard</a>.</p>"
);

// --- Prosty layout strony ---
function page(string $title, string $body): string
{
    return "<!doctype html><html lang='pl'><head><meta charset='utf-8'>".
        "<meta name='viewport' content='width=device-width, initial-scale=1'>".
        "<title>" . htmlspecialchars($title) . "</title><style>".
        "body{font-family:system-ui,sans-serif;background:#f4f6fb;color:#16203a;max-width:680px;margin:40px auto;padding:0 20px;line-height:1.6}".
        "h1{font-size:22px;color:#0b1530}a{color:#0534c7}code{background:#eef1f8;padding:2px 6px;border-radius:6px}".
        ".clubs{list-style:none;padding:0}.clubs li{background:#fff;border:1px solid #e4e9f2;border-radius:12px;padding:14px 16px;margin-bottom:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(16,32,80,.05)}".
        ".dot{width:12px;height:12px;border-radius:50%;display:inline-block}".
        ".b{margin-left:auto;background:#0534c7;color:#fff;text-decoration:none;padding:7px 14px;border-radius:9px;font-weight:600;font-size:14px;box-shadow:0 2px 8px rgba(5,52,199,.25)}".
        ".muted{color:#5f6368;font-size:14px}</style></head><body>".
        "<h1>" . htmlspecialchars($title) . "</h1>$body</body></html>";
}
