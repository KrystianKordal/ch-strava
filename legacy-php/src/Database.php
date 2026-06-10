<?php

declare(strict_types=1);

namespace App;

use PDO;

/**
 * Cienka warstwa nad SQLite (PDO). Tworzy schemat przy pierwszym użyciu.
 */
final class Database
{
    private PDO $pdo;

    public function __construct(string $path)
    {
        $isNew = !file_exists($path);
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }

        $this->pdo = new PDO('sqlite:' . $path);
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $this->pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $this->pdo->exec('PRAGMA journal_mode = WAL;');
        $this->pdo->exec('PRAGMA foreign_keys = ON;');

        $this->migrate();
    }

    public function pdo(): PDO
    {
        return $this->pdo;
    }

    private function migrate(): void
    {
        $this->pdo->exec(<<<'SQL'
            CREATE TABLE IF NOT EXISTS clubs (
                id    INTEGER PRIMARY KEY,
                name  TEXT NOT NULL,
                color TEXT NOT NULL DEFAULT '#888888'
            );

            CREATE TABLE IF NOT EXISTS activities (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                club_id       INTEGER NOT NULL,
                fingerprint   TEXT NOT NULL,
                athlete_name  TEXT NOT NULL,
                activity_name TEXT,
                type          TEXT,
                sport_type    TEXT,
                distance      REAL NOT NULL DEFAULT 0,   -- metry
                moving_time   INTEGER NOT NULL DEFAULT 0, -- sekundy
                elapsed_time  INTEGER NOT NULL DEFAULT 0, -- sekundy
                elevation     REAL NOT NULL DEFAULT 0,   -- metry
                week_key      TEXT NOT NULL,             -- np. 2026-W23
                first_seen    TEXT NOT NULL,             -- ISO datetime
                UNIQUE (club_id, fingerprint)
            );

            CREATE INDEX IF NOT EXISTS idx_activities_week ON activities (week_key);
            CREATE INDEX IF NOT EXISTS idx_activities_club ON activities (club_id);

            CREATE TABLE IF NOT EXISTS poll_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                club_id    INTEGER NOT NULL,
                seen_count INTEGER NOT NULL DEFAULT 0,
                new_count  INTEGER NOT NULL DEFAULT 0,
                ran_at     TEXT NOT NULL
            );
        SQL);
    }

    /**
     * Zapisuje konfigurację klubów do bazy (upsert) i usuwa kluby, których
     * już nie ma w konfiguracji (wraz z ich aktywnościami). Dzięki temu po
     * zmianie ID klubów stare dane (np. demo) nie zostają w bazie.
     */
    public function syncClubs(array $clubs): void
    {
        if ($clubs === []) {
            return;
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO clubs (id, name, color) VALUES (:id, :name, :color)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color'
        );
        foreach ($clubs as $club) {
            $stmt->execute([
                ':id'    => $club['id'],
                ':name'  => $club['name'],
                ':color' => $club['color'] ?? '#888888',
            ]);
        }

        // Usuń kluby (i ich aktywności) spoza aktualnej konfiguracji.
        $ids = array_map(static fn($c) => (int) $c['id'], $clubs);
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $this->pdo->prepare("DELETE FROM activities WHERE club_id NOT IN ($placeholders)")->execute($ids);
        $this->pdo->prepare("DELETE FROM clubs WHERE id NOT IN ($placeholders)")->execute($ids);
    }
}
