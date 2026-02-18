const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, PROPFIND, MKCOL, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Depth, X-WebDAV-Auth',
};

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Missing url parameter' });
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

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(url, fetchOptions);
    const body = await response.text();

    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }
    res.setHeader('Content-Type', response.headers.get('content-type') || 'text/plain');
    res.status(response.status).send(body);
  } catch (err) {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }
    res.status(502).json({ error: 'Failed to proxy WebDAV request', detail: err.message });
  }
}
