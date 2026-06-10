import { NextRequest, NextResponse } from 'next/server';

// Ochrona dashboardu hasłem (HTTP Basic Auth). Hasło ustawiasz w env:
//   DASHBOARD_PASSWORD=...
// Bez ustawionego hasła ochrona jest wyłączona (wygodne lokalnie) —
// PAMIĘTAJ ustawić je na produkcji.
//
// Chronimy tylko widok dashboardu ('/') i jego dane ('/api/stats').
// Poza ochroną świadomie zostają:
//   • /auth, /api/auth, /api/callback — flow OAuth (koledzy autoryzują drużyny
//     bez znajomości hasła do dashboardu; Strava i tak nie wyśle Basic Auth),
//   • /api/poll — ma własny POLL_SECRET (uderza w niego scheduler).

export function middleware(req: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return NextResponse.next();

  const header = req.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    // Format po dekodowaniu: "login:haslo". Login ignorujemy — liczy się hasło.
    const decoded = atob(header.slice(6));
    const supplied = decoded.slice(decoded.indexOf(':') + 1);
    if (supplied === password) return NextResponse.next();
  }

  return new NextResponse('Wymagane uwierzytelnienie.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Dashboard", charset="UTF-8"' },
  });
}

export const config = {
  matcher: ['/', '/api/stats'],
};
