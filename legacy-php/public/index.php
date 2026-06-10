<!DOCTYPE html>
<html lang="pl">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Strava: letnie wyzwanie</title>
    <link rel="icon" type="image/png" href="assets/favicon.png">
    <link rel="apple-touch-icon" href="assets/apple-touch-icon.png">
    <link rel="stylesheet" href="assets/style.css">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
    <div id="app">
        <header class="topbar">
            <div class="brand">
                <img class="ch-logo" src="assets/customerhero_logo.svg" alt="CustomerHero" width="227" height="40">
                <span class="brand-divider"></span>
                <div>
                    <h1 id="challenge-name">Strava: letnie wyzwanie</h1>
                    <p id="challenge-dates" class="muted"></p>
                </div>
            </div>
            <div class="topbar-meta">
                <span id="last-poll" class="muted"></span>
                <button id="refresh" class="btn">Odśwież</button>
            </div>
        </header>

        <main id="content">
            <div class="loading">Wczytywanie danych…</div>
        </main>

        <footer class="footer muted">
            Dane ze Strava Club API • dashboard generowany lokalnie
        </footer>
    </div>

    <script src="assets/app.js"></script>
</body>
</html>
