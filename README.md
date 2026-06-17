# Strava: letnie wyzwanie — dashboard (Next.js + Supabase)

Jednostronicowy dashboard rywalizacji **3 drużyn** na Strava, gotowy do wdrożenia na **Vercel**.

- **Frontend:** Next.js (App Router) + React, motyw CustomerHero
- **Baza:** Supabase (Postgres), przez `postgres.js`
- **Backend:** API routes (OAuth, polling, statystyki) — polling odpalany ręcznie przez `/api/poll`

## Zasady wyzwania
- Każdy **tydzień** wygrywa drużyna z największą liczbą **godzin aktywności** (`moving_time`).
- Za miejsce w tygodniu drużyna dostaje **punkty**: 1. miejsce = **3 pkt**, 2. miejsce = **1 pkt**, 3. miejsce = **0 pkt** (remis dzieli miejsce — obie drużyny biorą punkty wyższej pozycji).
- Wygrywa drużyna z **największą liczbą punktów** (remis → więcej wygranych tygodni, dalej łączny czas). Liczba wygranych tygodni i zajętych miejsc (🥇🥈🥉) zostaje jako ciekawostka.
- Wyzwanie trwa **8 cze – 31 lip 2026** (`lib/config.ts`). Przed startem widać „okres przygotowawczy", ale po starcie **liczą się tylko aktywności z okna wyzwania** — wcześniejsze są pomijane.

---

## Szybki start lokalnie

```bash
npm install
cp .env.example .env.local      # ustaw DATABASE_URL (Supabase) i ALLOW_SEED=1
npm run dev                     # http://localhost:3000
# wygeneruj dane demo:
curl http://localhost:3000/api/seed
```

Aplikacja wymaga `DATABASE_URL` (connection string z Supabase) — lokalnie możesz wskazać ten sam projekt co produkcja albo własnego Postgresa. Schemat tabel tworzy się sam przy pierwszym zapytaniu (`ensureSchema()` w [`lib/db.ts`](lib/db.ts)).

---

## Wdrożenie na Vercel

### 1. Baza Supabase
1. Na [supabase.com](https://supabase.com) utwórz projekt (zaloguj się np. przez GitHub).
2. **Project → Settings → Database → Connection string** — skopiuj string z poolera **Transaction** (port `6543`); to będzie `DATABASE_URL`.
3. Nic więcej nie musisz robić ręcznie — tabele tworzą się same przy pierwszym uderzeniu w endpoint (`ensureSchema()`).

> 💡 Jeśli użyjesz **integracji Vercel ↔ Supabase** z Marketplace, zmienne (`POSTGRES_URL` itd.) wstrzykną się same — aplikacja je rozpozna.

### 2. Aplikacja Strava
Na <https://www.strava.com/settings/api> utwórz aplikację. **Authorization Callback Domain** = Twoja domena Vercel (np. `twoja-app.vercel.app`). Zanotuj **Client ID** i **Client Secret**.

### 3. Deploy
Wypchnij repo na GitHub i zaimportuj w Vercel (albo `vercel`). Ustaw **Environment Variables**:

| Zmienna | Wartość |
|---|---|
| `STRAVA_CLIENT_ID` | z ustawień aplikacji Strava |
| `STRAVA_CLIENT_SECRET` | z ustawień aplikacji Strava |
| `APP_URL` | `https://twoja-app.vercel.app` |
| `DATABASE_URL` | connection string z Supabase (pooler Transaction, port 6543) |
| `POLL_SECRET` | dowolny losowy ciąg (chroni `/api/poll` i `/api/manual`; w produkcji bez niego endpointy są zamknięte) |
| `DASHBOARD_PASSWORD` | hasło do dashboardu (Basic Auth na `/` i `/api/stats`; w produkcji bez niego dashboard zwraca 503) |
| `TOKEN_ENCRYPTION_KEY` | **wymagany na produkcji** — szyfruje tokeny Stravy w bazie (AES-256-GCM). Wygeneruj: `openssl rand -hex 32` |
| `ALLOW_SEED` | **nie ustawiaj** na produkcji (`/api/seed` i tak jest tam zablokowany) |

### 4. Autoryzacja drużyn
Wejdź na `https://twoja-app.vercel.app/auth` i przy każdej drużynie kliknij **Autoryzuj**, logując się kontem **członka tej drużyny** (każdą może autoryzować inna osoba — to Opcja B, nie musisz być we wszystkich klubach).

### 5. Polling (ręczny trigger)
Nie ma już crona — dane odświeżasz sam, uderzając w endpoint `/api/poll`. Najprościej wkleić w przeglądarkę / zakładkę:
```
https://twoja-app.vercel.app/api/poll?key=<POLL_SECRET>
```
albo z terminala:
```bash
curl "https://twoja-app.vercel.app/api/poll?key=<POLL_SECRET>"
# lub nagłówkiem:
curl -H "Authorization: Bearer <POLL_SECRET>" https://twoja-app.vercel.app/api/poll
```
Endpoint pobiera aktywności wszystkich drużyn i zapisuje nowe (deduplikacja po odcisku palca). Zwraca JSON z podsumowaniem (`seen`/`new`/`baseline` na drużynę).

**Polling per drużyna.** Przy dużej liczbie aktywności poll wszystkich drużyn naraz może ocierać się o limit czasu funkcji (60 s). Dlatego każdą drużynę można odświeżać osobnym żądaniem — endpoint `/api/poll/<clubId>` przetwarza tylko jeden klub:
```bash
curl "https://twoja-app.vercel.app/api/poll/2173191?key=<POLL_SECRET>"
curl "https://twoja-app.vercel.app/api/poll/2173293?key=<POLL_SECRET>"
curl "https://twoja-app.vercel.app/api/poll/2173396?key=<POLL_SECRET>"
```
Autoryzacja i format odpowiedzi są takie same jak w `/api/poll`. Wywołania rozkładasz po swojej stronie (np. scheduler odpala je osobno dla każdej drużyny).

> ⚠️ **Pierwszy poll = baza odniesienia.** Strava oddaje tylko ostatnie ~200 aktywności klubu **bez dat**, więc cały backlog widoczny przy pierwszym kontakcie z feedem zapisujemy z `counted=false` (tylko deduplikacja) i **nie wliczamy** go do statystyk — inaczej cała historia wpadłaby do bieżącego tygodnia. Liczą się dopiero aktywności zauważone w kolejnych pollach. W odpowiedzi pierwszego polla zobaczysz `baseline: true`.
>
> 💡 Chcesz to mieć automatycznie? Podłącz dowolny zewnętrzny scheduler (GitHub Actions, cron-job.org, EasyCron) uderzający w ten sam URL co godzinę.
>
> ⚠️ Regularny polling jest kluczowy — tydzień aktywności ustalamy na podstawie momentu pobrania.

### 6. Ręczne dopisanie aktywności (uzupełnienie braków)
Skoro pierwszy poll tylko ustala bazę odniesienia, aktywności z początku wyzwania (zanim ruszył polling) trzeba dopisać ręcznie. Wejdź na:
```
https://twoja-app.vercel.app/manual?key=<POLL_SECRET>
```
i wypełnij formularz (drużyna, tydzień, zawodnik, sport, czas, dystans). Wpisy mają `counted=true`, więc **liczą się** do wyników wybranego tygodnia. Dane podejrzyj na stronie klubu w Stravie. Można też wołać `POST /api/manual` JSON-em (`clubId`, `athlete`, `movingTime` w sekundach, `weekKey`, …).

---

## Konfiguracja wyzwania
Drużyny (ID/nazwa/kolor) i daty są w [`lib/config.ts`](lib/config.ts) — nie są tajne, więc trzymane w repo. Zmiana ID drużyn automatycznie usuwa dane starych klubów (`syncClubs`).

## Struktura
```
app/
  page.tsx              # dashboard (SSR → komponent kliencki)
  auth/page.tsx         # autoryzacja drużyn (status + linki)
  api/
    stats/route.ts      # JSON ze statystykami
    poll/route.ts       # ręczny trigger: pobiera aktywności
    auth/route.ts       # start OAuth (redirect do Strava)
    callback/route.ts   # callback OAuth → zapis tokenu
    seed/route.ts       # dane demo (tylko ALLOW_SEED=1)
components/Dashboard.tsx # render dashboardu
lib/
  config.ts  db.ts  strava.ts  week.ts  stats.ts  poll.ts
public/                 # logo + favicon CustomerHero
legacy-php/             # poprzednia wersja PHP (referencja, poza buildem)
```

## Endpointy
- `/` — dashboard 🔒 (Basic Auth, `DASHBOARD_PASSWORD`)
- `/auth` — autoryzacja drużyn (otwarte — koledzy autoryzują bez hasła)
- `/api/stats` — JSON ze statystykami 🔒 (odświeżany co 5 min po stronie klienta)
- `/api/poll` — ręczny trigger pollingu wszystkich drużyn, `?key=<POLL_SECRET>` (chroniony `POLL_SECRET`)
- `/api/poll/<clubId>` — polling jednej drużyny (rozkłada pracę na osobne żądania), `?key=<POLL_SECRET>`
- `/api/seed` — dane demo (tylko gdy `ALLOW_SEED=1`)
