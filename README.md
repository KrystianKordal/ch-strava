# Strava: letnie wyzwanie — dashboard (Next.js + Supabase)

Jednostronicowy dashboard rywalizacji **3 drużyn** na Strava, gotowy do wdrożenia na **Vercel**.

- **Frontend:** Next.js (App Router) + React, motyw CustomerHero
- **Baza:** Supabase (Postgres), przez `postgres.js`
- **Backend:** API routes (OAuth, polling, statystyki) — polling odpalany ręcznie przez `/api/poll`

## Zasady wyzwania
- Każdy **tydzień** wygrywa drużyna z największą liczbą **godzin aktywności** (`moving_time`).
- Wygrywa drużyna z **największą liczbą wygranych tygodni** (remis → łączny czas).
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
| `POLL_SECRET` | dowolny losowy ciąg (chroni ręczny trigger `/api/poll`) |
| `DASHBOARD_PASSWORD` | hasło do dashboardu (Basic Auth na `/` i `/api/stats`) |
| `ALLOW_SEED` | **nie ustawiaj** na produkcji (zostaw puste) |

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

> ⚠️ **Pierwszy poll = baza odniesienia.** Strava oddaje tylko ostatnie ~200 aktywności klubu **bez dat**, więc cały backlog widoczny przy pierwszym kontakcie z feedem zapisujemy z `counted=false` (tylko deduplikacja) i **nie wliczamy** go do statystyk — inaczej cała historia wpadłaby do bieżącego tygodnia. Liczą się dopiero aktywności zauważone w kolejnych pollach. W odpowiedzi pierwszego polla zobaczysz `baseline: true`.
>
> 💡 Chcesz to mieć automatycznie? Podłącz dowolny zewnętrzny scheduler (GitHub Actions, cron-job.org, EasyCron) uderzający w ten sam URL co godzinę.
>
> ⚠️ Regularny polling jest kluczowy — tydzień aktywności ustalamy na podstawie momentu pobrania.

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
- `/api/poll` — ręczny trigger pollingu, `?key=<POLL_SECRET>` (chroniony `POLL_SECRET`)
- `/api/seed` — dane demo (tylko gdy `ALLOW_SEED=1`)
