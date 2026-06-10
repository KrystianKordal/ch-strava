<?php

declare(strict_types=1);

/**
 * Wspólny bootstrap: prosty autoloader dla przestrzeni App\ oraz wczytanie
 * konfiguracji. Zwraca tablicę konfiguracji.
 */

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'App\\')) {
        return;
    }
    $file = __DIR__ . '/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

$configFile = dirname(__DIR__) . '/config.php';
if (!is_file($configFile)) {
    throw new RuntimeException(
        'Brak pliku config.php. Skopiuj config.example.php do config.php i uzupełnij dane.'
    );
}

return require $configFile;
