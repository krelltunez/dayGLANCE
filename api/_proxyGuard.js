// Shared abuse-damping guard for the HOSTED proxy endpoints
// (api/calendar-proxy.js and api/webdav-proxy.js).
//
// The leading underscore keeps Vercel from exposing this module as its own
// serverless route — it is imported by the two proxy functions, not called
// directly.
//
// ── Who reaches these functions ────────────────────────────────────────────
// ONLY the web / PWA build. Every native platform fetches directly and never
// touches these endpoints:
//   • Android + iOS  → window.DayGlanceNative.httpRequest (native HttpBridge)
//   • Electron        → window.electronAPI.proxyFetch (main-process IPC)
// The web build issues SAME-ORIGIN requests to /api/… . Two consequences for
// origin verification:
//   • calendar-proxy is a GET → browsers send NO `Origin` header on same-origin
//     GET/HEAD, only `Referer`. The app sets no custom Referrer-Policy, so the
//     browser default (strict-origin-when-cross-origin) sends the full
//     same-origin URL as Referer. We therefore fall back to Referer.
//   • webdav-proxy uses PUT/DELETE/PROPFIND/MKCOL → browsers DO send `Origin`.
// So: accept `Origin`, else fall back to `Referer`. A request carrying neither
// (curl, server-side script, scraper) is not a browser fetch and is rejected.

// ── Origin allowlist ───────────────────────────────────────────────────────
// Brand domains mirror the `isHostedApp` regex in src/utils/cloudSyncProviders.js
// so every hosted deployment of the shared engine keeps working. dayglance.app
// is this repo's production origin; the siblings are included defensively.
const APP_DOMAINS = ['dayglance.app', 'lifeglance.app', 'lastglance.app'];

function hostAllowed(hostname) {
  const h = (hostname || '').toLowerCase();
  if (!h) return false;

  // Local development. The vite dev server proxies these paths through its own
  // middleware (see vite.config.js), so this mainly covers direct local testing.
  if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;

  // Production brand domains and any subdomain (e.g. www.dayglance.app).
  if (APP_DOMAINS.some((d) => h === d || h.endsWith('.' + d))) return true;

  // Vercel preview deployments (e.g. dayglance-git-branch-team.vercel.app).
  if (h === 'vercel.app' || h.endsWith('.vercel.app')) return true;

  return false;
}

function hostnameFromHeaders(req) {
  const origin = req.headers['origin'];
  // A serialized "null" origin (opaque/sandboxed context) is not trustworthy.
  if (origin && origin !== 'null') {
    try { return new URL(origin).hostname; } catch { /* fall through */ }
  }
  const referer = req.headers['referer'] || req.headers['referrer'];
  if (referer) {
    try { return new URL(referer).hostname; } catch { /* fall through */ }
  }
  return null;
}

// Returns true when the request originates from an allowed web origin.
export function isOriginAllowed(req) {
  const host = hostnameFromHeaders(req);
  if (!host) return false; // No Origin and no Referer → not a browser fetch.
  return hostAllowed(host);
}

// ── Per-IP rate limiting ───────────────────────────────────────────────────
// Sliding window keyed by the first hop of x-forwarded-for.
//
// HONEST LIMITATION: this state lives in module scope, which on Vercel means it
// is per-warm-instance and not shared across concurrent lambdas or cold starts.
// It is therefore best-effort abuse damping, NOT authoritative enforcement. For
// real rate limiting configure Vercel WAF / rate-limit rules (or an external
// store such as Upstash/Redis) in front of these functions.
const RATE_LIMIT = 60;            // max requests …
const WINDOW_MS = 60 * 1000;      // … per IP per rolling minute.
const buckets = new Map();        // ip -> ascending array of request timestamps

let lastCleanup = Date.now();
function sweep(now) {
  // Opportunistic cleanup (avoids setInterval, which can keep a lambda from
  // freezing). Runs at most once per window.
  if (now - lastCleanup < WINDOW_MS) return;
  lastCleanup = now;
  const cutoff = now - WINDOW_MS;
  for (const [ip, hits] of buckets) {
    while (hits.length && hits[0] <= cutoff) hits.shift();
    if (hits.length === 0) buckets.delete(ip);
  }
}

export function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

// Returns { allowed: true } or { allowed: false, retryAfter: <seconds> }.
export function checkRateLimit(ip) {
  const now = Date.now();
  sweep(now);
  const cutoff = now - WINDOW_MS;

  let hits = buckets.get(ip);
  if (!hits) { hits = []; buckets.set(ip, hits); }
  while (hits.length && hits[0] <= cutoff) hits.shift();

  if (hits.length >= RATE_LIMIT) {
    const retryAfter = Math.max(1, Math.ceil((hits[0] + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfter };
  }
  hits.push(now);
  return { allowed: true };
}

// Combined gate used at the top of each proxy handler. Writes the rejection
// response and returns true when the request should NOT proceed; returns false
// when the handler may continue.
export function rejectIfBlocked(req, res) {
  if (!isOriginAllowed(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return true;
  }
  const { allowed, retryAfter } = checkRateLimit(clientIp(req));
  if (!allowed) {
    res.setHeader('Retry-After', String(retryAfter));
    res.status(429).json({ error: 'Too many requests' });
    return true;
  }
  return false;
}
