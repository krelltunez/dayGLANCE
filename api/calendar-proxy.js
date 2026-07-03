import { rejectIfBlocked } from './_proxyGuard.js';

function validateProxyUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }

  // SSRF protection only applies on Vercel. Self-hosted Docker deployments need
  // to reach calendar servers on the local network, so we skip these checks there.
  if (!process.env.VERCEL) return parsed;

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new Error('Private/reserved addresses are not allowed');
  }

  // Block IPv4 private/reserved ranges
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 127 ||
      (a === 169 && b === 254) ||
      a === 0 ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      throw new Error('Private/reserved addresses are not allowed');
    }
  }

  // Block IPv6 loopback, unspecified, link-local, and private/ULA ranges.
  //   ::1        — loopback
  //   ::         — unspecified
  //   ::ffff:…   — IPv4-mapped (e.g. ::ffff:127.0.0.1 bypasses the IPv4 check above)
  //   fe80:…     — link-local
  //   fc… / fd…  — Unique Local (ULA, fc00::/7); original code only blocked fd
  // NOTE: DNS rebinding (public hostname → private IP at connection time) is a
  // known limitation that cannot be fixed without a post-connection IP check,
  // which fetch() does not expose.  Risk is low on Vercel (IPv4-only runtime).
  if (
    hostname === '::1' ||
    hostname === '::' ||
    /^::ffff:/i.test(hostname) ||
    /^fe80:/i.test(hostname) ||
    /^fc/i.test(hostname) ||
    /^fd/i.test(hostname)
  ) {
    throw new Error('Private/reserved addresses are not allowed');
  }

  return parsed;
}

export default async function handler(req, res) {
  // Origin allowlist + per-IP rate limiting. Only the web/PWA build reaches
  // this hosted endpoint; native apps and Electron fetch directly.
  if (rejectIfBlocked(req, res)) return;

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  try {
    validateProxyUrl(url);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  try {
    const fetchHeaders = { Accept: 'text/calendar, text/plain, */*' };
    const calendarAuth = req.headers['x-calendar-auth'];
    if (calendarAuth) {
      fetchHeaders['Authorization'] = calendarAuth;
    }
    const response = await fetch(url, { headers: fetchHeaders });

    const body = await response.text();

    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');
    res.setHeader('Cache-Control', 'no-store');
    res.status(response.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch calendar' });
  }
}
