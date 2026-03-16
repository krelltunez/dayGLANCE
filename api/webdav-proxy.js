// Disable Vercel's default body parser so we can forward raw request bodies
// (e.g. text/calendar) without them being mangled or rejected as unsupported.
export const config = {
  api: {
    bodyParser: false,
  },
};

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

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

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
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/octet-stream',
    };

    // Forward X-WebDAV-Auth as Authorization
    if (req.headers['x-webdav-auth']) {
      headers['Authorization'] = req.headers['x-webdav-auth'];
    }

    if (req.headers['depth'] !== undefined) {
      headers['Depth'] = req.headers['depth'];
    }

    const fetchOptions = {
      method: req.method,
      headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const rawBody = await readRawBody(req);
      if (rawBody) {
        fetchOptions.body = rawBody;
      }
    }

    const response = await fetch(url, fetchOptions);
    const body = await response.text();

    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');
    res.status(response.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Failed to proxy WebDAV request' });
  }
}
