# Strava — Dashboard wyzwania 3 klubów

Jednostronicowy dashboard (PHP + SQLite) do śledzenia rywalizacji **trzech klubów** na Strava.

## Zasady wyzwania

- Każdy **tydzień** wygrywa klub z największą liczbą **godzin aktywności** (sumaryczny `moving_time` członków).
- Na koniec wyzwania wygrywa klub z **największą liczbą wygranych tygodni** (przy remisie decyduje łączny czas).
- Remis w tygodniu = wygrana współdzielona (oba kluby dostają punkt).

## Co pokazuje dashboard

- 🏆 **Klasyfikację generalną** (podium wg wygranych tygodni)
- 📊 Wynik **bieżącego tygodnia** na żywo (kto prowadzi)
- 📅 **Tabelę tydzień po tygodniu** ze zwycięzcami
- 🔥 **Ciekawostki**: najaktywniejszy zawodnik, najdłuższa aktywność, największa przewaga tygodnia
- 👟 **Najaktywniejszych zawodników** w każdym klubie
- 🚴 **Rozkład dyscyplin** (bieganie / rower / pływanie / …)
- Zbiorcze sumy: łączny czas, liczba aktywności, dystans

## Szybki start (tryb demo, bez konta Strava)

```bash
php bin/seed_demo.php                 # generuje przykładowe dane
php -S localhost:8000 -t public       # uruchamia serwer
# otwórz http://localhost:8000
```

## Podłączenie prawdziwych danych Strava

1. Utwórz aplikację na <https://www.strava.com/settings/api>
   (ustaw *Authorization Callback Domain* na `localhost`).
2. Skopiuj konfigurację i uzupełnij dane:
   ```bash
   cp config.example.php config.php
   ```
   W `config.php` wpisz `client_id`, `client_secret` oraz **ID trzech klubów**
   (z URL klubu: `strava.com/clubs/<ID>`) i daty wyzwania.
3. **Autoryzuj każdy klub osobno** (Opcja B) — uruchom serwer i wejdź na:
   ```
   http://localhost:8000/auth.php
   ```
   Zobaczysz listę trzech klubów. Przy każdym kliknij „Autoryzuj" i zaloguj się
   kontem, które jest **członkiem tego konkretnego klubu** — każdy klub może
   autoryzować **inna osoba**. Tokeny zapisują się osobno
   (`data/token_<clubId>.json`) i są automatycznie odświeżane.
   > Strava udostępnia aktywności klubu tylko jego członkom — dlatego dla każdego
   > klubu potrzebny jest token od kogoś, kto do niego należy.
4. Pobierz aktywności (pomija kluby bez autoryzacji):
   ```bash
   php bin/poll.php
   ```
5. Ustaw **regularny polling** w cronie (kluczowe — patrz niżej):
   ```cron
   0 * * * * /usr/bin/php /pełna/ścieżka/strava_dashboard/bin/poll.php >> /tmp/strava_poll.log 2>&1
   ```

## ⚠️ Ważne ograniczenie API Strava

Endpoint `GET /clubs/{id}/activities` zwraca tylko **ostatnie** aktywności
i **nie zawiera daty ani ID** aktywności — podaje jedynie imię + inicjał
zawodnika, dyscyplinę, dystans, czas i przewyższenie.

Dlatego do przypisania aktywności do właściwego **tygodnia** używamy momentu
jej **pierwszego zauważenia** (`first_seen`) przez skrypt `poll.php`. Z tego
powodu:

- Polling musi działać **regularnie z crona** (zalecane co godzinę). Inaczej
  aktywności „wypadną" z listy ostatnich, zanim je zapiszemy.
- Każdą aktywność identyfikujemy „odciskiem palca" (imię + dyscyplina +
  dystans + czas), by nie liczyć duplikatów przy kolejnych odpytaniach.

To standardowe obejście tego ograniczenia API. Dla pełnej dokładności co do
sekundy każdy zawodnik musiałby indywidualnie autoryzować aplikację
(scope `activity:read_all`) — tu świadomie wybrano prostsze podejście klubowe.

## Struktura projektu

```
config.php              # konfiguracja (kluby, dane Strava, daty)
src/
  bootstrap.php         # autoloader + wczytanie configu
  Database.php          # SQLite + schemat
  StravaClient.php      # OAuth (token per klub) + pobieranie aktywności
  Week.php              # liczenie kluczy tygodni (ISO-8601)
  Stats.php             # wszystkie agregacje dashboardu
bin/
  poll.php              # cron: pobiera i zapisuje aktywności
  seed_demo.php         # dane demonstracyjne
public/
  index.php             # jedyna strona — dashboard
  auth.php              # autoryzacja OAuth (per klub) — w web rootcie
  api.php               # endpoint JSON
  assets/style.css, app.js
data/                   # baza SQLite + tokeny token_<id>.json (poza repo)
```

## Wymagania

PHP 8.1+ z rozszerzeniami `pdo_sqlite`, `curl`, `json` (standardowo dostępne).
