<?php

declare(strict_types=1);

namespace App;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Pomocnik do liczenia kluczy tygodni (ISO-8601, tydzień zaczyna się
 * w poniedziałek). Klucz ma postać "2026-W23".
 */
final class Week
{
    public function __construct(private DateTimeZone $tz) {}

    /** Klucz tygodnia dla podanej chwili (domyślnie "teraz"). */
    public function keyFor(?DateTimeImmutable $dt = null): string
    {
        $dt = ($dt ?? new DateTimeImmutable('now'))->setTimezone($this->tz);
        return $dt->format('o-\WW');
    }

    /** Etykieta zakresu dat tygodnia, np. "2–8 cze". */
    public function label(string $weekKey): string
    {
        [$start, $end] = $this->range($weekKey);
        $months = ['', 'sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
        $startTxt = $start->format('j') . ' ' . $months[(int) $start->format('n')];
        $endTxt = $end->format('j') . ' ' . $months[(int) $end->format('n')];
        return $startTxt . ' – ' . $endTxt;
    }

    /** Zwraca [poniedziałek 00:00, niedziela 23:59:59] danego tygodnia. */
    public function range(string $weekKey): array
    {
        [$year, $week] = array_map('intval', explode('-W', $weekKey));
        $start = (new DateTimeImmutable('now', $this->tz))
            ->setISODate($year, $week, 1)
            ->setTime(0, 0, 0);
        $end = $start->modify('+6 days')->setTime(23, 59, 59);
        return [$start, $end];
    }

    /**
     * Lista kluczy tygodni od daty startu do daty końca (włącznie),
     * ale nie później niż bieżący tydzień.
     *
     * @return string[]
     */
    public function between(string $startDate, string $endDate): array
    {
        $cursor = (new DateTimeImmutable($startDate, $this->tz))->setTime(0, 0, 0);
        $end = (new DateTimeImmutable($endDate, $this->tz))->setTime(23, 59, 59);
        $now = new DateTimeImmutable('now', $this->tz);
        if ($end > $now) {
            $end = $now;
        }

        $keys = [];
        while ($cursor <= $end) {
            $keys[$this->keyFor($cursor)] = true;
            $cursor = $cursor->modify('+1 day');
        }
        return array_keys($keys);
    }
}
