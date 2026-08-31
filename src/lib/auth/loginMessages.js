// Shared login-response copy for the dashboard auth surface.
//
// Tag 3 (M0 security foundation) moved these strings OUT of
// src/app/api/auth/login/route.js: Next.js route files may only export HTTP
// handlers and config (GET/POST/…, dynamic, revalidate). Any other named
// export from a route.js breaks `next build`. Keeping them here lets both the
// route and its test pin the exact operator-facing wording without touching
// the route's export surface.

// Honest refusal for remote logins on an install with no password configured.
// Names the setting path (Dashboard → Profile → Security → Change password)
// so the operator knows exactly where to fix it.
export const NO_PASSWORD_REMOTE_MESSAGE =
  "No dashboard password is configured. Remote login is disabled until one is set: on the Vela host, open the dashboard locally and set a password under Dashboard → Profile → Security → Change password — or set the INITIAL_PASSWORD environment variable and restart. Loopback (local) access stays open.";
