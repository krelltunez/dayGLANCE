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

  // Block IPv6 loopback and private
  if (hostname === '::1' || /^(fd|fe80)/i.test(hostname)) {
    throw new Error('Private/reserved addresses are not allowed');
  }

  return parsed;
}

export default async function handler(req, res) {
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
    const response = await fetch(url, {
      headers: {
        Accept: 'text/calendar, text/plain, */*',
      },
    });

    const body = await response.text();

    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');
    res.setHeader('Cache-Control', 'public, max-age=900, stale-while-revalidate=60');
    res.status(response.status).send(body);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch calendar' });
  }
}
