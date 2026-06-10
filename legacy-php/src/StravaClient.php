<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

/**
 * Klient API Strava: obsługuje OAuth (wymiana kodu, odświeżanie tokenu)
 * oraz pobieranie aktywności klubów.
 *
 * Token (access + refresh) jest trzymany w pliku JSON, dzięki czemu skrypt
 * cron może działać bez ponownej autoryzacji.
 */
final class StravaClient
{
    private const OAUTH_TOKEN_URL = 'https://www.strava.com/oauth/token';
    private const API_BASE        = 'https://www.strava.com/api/v3';

    public function __construct(
        private string $clientId,
        private string $clientSecret,
        private string $tokenPath,
    ) {}

    /**
     * URL, na który wysyłamy użytkownika, by autoryzował aplikację.
     * $state wraca w callbacku — używamy go do rozpoznania, którego klubu
     * dotyczy autoryzacja.
     */
    public function authorizeUrl(string $redirectUri, string $state = ''): string
    {
        $params = http_build_query([
            'client_id'       => $this->clientId,
            'redirect_uri'    => $redirectUri,
            'response_type'   => 'code',
            'approval_prompt' => 'force',
            'state'           => $state,
            // 'read' wystarcza do odczytu aktywności klubu, którego jesteśmy członkiem.
            'scope'           => 'read,activity:read',
        ]);

        return 'https://www.strava.com/oauth/authorize?' . $params;
    }

    /** Wymienia kod autoryzacyjny na token i zapisuje go na dysk. */
    public function exchangeCode(string $code): array
    {
        $token = $this->postToken([
            'client_id'     => $this->clientId,
            'client_secret' => $this->clientSecret,
            'code'          => $code,
            'grant_type'    => 'authorization_code',
        ]);

        $this->saveToken($token);
        return $token;
    }

    /** Zwraca ważny access token, odświeżając go w razie potrzeby. */
    public function accessToken(): string
    {
        $token = $this->loadToken();
        if ($token === null) {
            throw new RuntimeException(
                'Brak tokenu. Uruchom autoryzację: otwórz bin/auth.php w przeglądarce.'
            );
        }

        // Odśwież, jeśli wygasa w ciągu najbliższych 60 sekund.
        if (($token['expires_at'] ?? 0) <= time() + 60) {
            $token = $this->refreshToken($token['refresh_token']);
        }

        return $token['access_token'];
    }

    private function refreshToken(string $refreshToken): array
    {
        $token = $this->postToken([
            'client_id'     => $this->clientId,
            'client_secret' => $this->clientSecret,
            'grant_type'    => 'refresh_token',
            'refresh_token' => $refreshToken,
        ]);

        $this->saveToken($token);
        return $token;
    }

    /**
     * Pobiera aktywności klubu (z paginacją).
     *
     * UWAGA: endpoint /clubs/{id}/activities zwraca tylko ostatnie aktywności
     * i NIE zawiera daty ani ID aktywności — dlatego datę "pierwszego
     * zauważenia" ustala skrypt pollujący.
     *
     * @return array<int, array<string, mixed>>
     */
    public function clubActivities(int $clubId, int $perPage = 200, int $maxPages = 3): array
    {
        $token = $this->accessToken();
        $all = [];

        for ($page = 1; $page <= $maxPages; $page++) {
            $url = sprintf(
                '%s/clubs/%d/activities?per_page=%d&page=%d',
                self::API_BASE,
                $clubId,
                $perPage,
                $page
            );

            $batch = $this->getJson($url, $token);
            if (!is_array($batch) || $batch === []) {
                break;
            }

            $all = array_merge($all, $batch);

            if (count($batch) < $perPage) {
                break; // ostatnia strona
            }
        }

        return $all;
    }

    // ---------------------------------------------------------------- HTTP --

    private function postToken(array $fields): array
    {
        $ch = curl_init(self::OAUTH_TOKEN_URL);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => http_build_query($fields),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
        ]);

        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new RuntimeException("Błąd połączenia z OAuth Strava: $err");
        }

        $data = json_decode($body, true);
        if ($status >= 400 || !isset($data['access_token'])) {
            throw new RuntimeException("OAuth Strava zwróciło błąd ($status): $body");
        }

        return $data;
    }

    private function getJson(string $url, string $token): mixed
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $token],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 30,
        ]);

        $body = curl_exec($ch);
        $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);

        if ($body === false) {
            throw new RuntimeException("Błąd połączenia z API Strava: $err");
        }
        if ($status === 429) {
            throw new RuntimeException('Przekroczono limit zapytań do API Strava (429). Spróbuj później.');
        }
        if ($status >= 400) {
            throw new RuntimeException("API Strava zwróciło błąd ($status): $body");
        }

        return json_decode($body, true);
    }

    // --------------------------------------------------------- Token store --

    private function loadToken(): ?array
    {
        if (!file_exists($this->tokenPath)) {
            return null;
        }
        $data = json_decode((string) file_get_contents($this->tokenPath), true);
        return is_array($data) ? $data : null;
    }

    private function saveToken(array $token): void
    {
        $dir = dirname($this->tokenPath);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        file_put_contents(
            $this->tokenPath,
            json_encode($token, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)
        );
        @chmod($this->tokenPath, 0600);
    }
}
