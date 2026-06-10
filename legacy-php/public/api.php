<?php

declare(strict_types=1);

/**
 * Jedyny endpoint JSON zasilający dashboard. Zwraca komplet statystyk.
 */

$config = require __DIR__ . '/../src/bootstrap.php';

use App\Database;
use App\Stats;
use App\Week;

date_default_timezone_set($config['timezone'] ?? 'UTC');
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $db = new Database((string) $config['db_path']);
    $db->syncClubs($config['clubs']);

    $week = new Week(new DateTimeZone($config['timezone'] ?? 'UTC'));
    $stats = new Stats($db->pdo(), $config, $week);

    echo json_encode($stats->dashboard(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
