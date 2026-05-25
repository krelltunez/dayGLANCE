// Standalone Node.js proxy server for the Docker deployment.
// Handles /api/webdav-proxy/ and /api/calendar-proxy/ — identical logic to
// the Vercel serverless functions, but running as a plain http.Server so
// that nginx can forward requests to it after URL-decoding the query string.
// (nginx's $arg_* variables are not URL-decoded, so proxy_pass receives the
// encoded value "https%3A%2F%2F..." which it rejects as an invalid prefix.)
'use strict';

const http = require('http');

// ---------------------------------------------------------------------------
// Shared URL validation (mirrors api/webdav-proxy.js and api/calendar-proxy.js)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleWebDAVProxy(req, res, targetUrl) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, MKCOL, PROPFIND, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, X-WebDAV-Auth, Content-Type, Depth, If-Match, If-None-Match',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  const headers = {};

  const bodylessMethods = new Set(['GET', 'HEAD', 'PROPFIND', 'DELETE', 'MKCOL']);
  if (!bodylessMethods.has(req.method)) {
    headers['Content-Type'] = req.headers['content-type'] || 'application/octet-stream';
  }
  if (req.headers['x-webdav-auth']) {
    headers['Authorization'] = req.headers['x-webdav-auth'];
  }
  if (req.headers['depth'] !== undefined) {
    headers['Depth'] = req.headers['depth'];
  }
  if (req.headers['if-match'])      headers['If-Match']      = req.headers['if-match'];
  if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];

  const fetchOptions = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const rawBody = await readBody(req);
    if (rawBody) fetchOptions.body = rawBody;
  }

  try {
    const response = await fetch(targetUrl, fetchOptions);
    const body = await response.text();
    const resHeaders = {
      'Content-Type': response.headers.get('content-type') || 'text/plain',
      'Cache-Control': 'no-store',
    };
    const etag = response.headers.get('etag');
    if (etag) resHeaders['ETag'] = etag;
    res.writeHead(response.status, resHeaders);
    res.end(body);
  } catch {
    sendJson(res, 502, { error: 'Failed to proxy WebDAV request' });
  }
}

async function handleCalendarProxy(req, res, targetUrl) {
  const fetchHeaders = { Accept: 'text/calendar, text/plain, */*' };
  if (req.headers['x-calendar-auth']) {
    fetchHeaders['Authorization'] = req.headers['x-calendar-auth'];
  }

  try {
    const response = await fetch(targetUrl, { headers: fetchHeaders });
    const body = await response.text();
    res.writeHead(response.status, {
      'Content-Type': response.headers.get('content-type') || 'text/plain',
      'Cache-Control': 'public, max-age=900, stale-while-revalidate=60',
    });
    res.end(body);
  } catch {
    sendJson(res, 502, { error: 'Failed to fetch calendar' });
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, 'http://localhost');
  const targetUrl = parsed.searchParams.get('url'); // automatically URL-decoded

  const isWebDAV  = parsed.pathname.startsWith('/api/webdav-proxy');
  const isCalendar = parsed.pathname.startsWith('/api/calendar-proxy');

  if (!isWebDAV && !isCalendar) {
    res.writeHead(404);
    return res.end();
  }

  if (!targetUrl) return sendJson(res, 400, { error: 'Missing url parameter' });

  try {
    validateProxyUrl(targetUrl);
  } catch (err) {
    return sendJson(res, 400, { error: err.message });
  }

  if (isWebDAV)   return handleWebDAVProxy(req, res, targetUrl);
  if (isCalendar) return handleCalendarProxy(req, res, targetUrl);
});

server.listen(3001, '127.0.0.1', () => {
  process.stdout.write('Proxy server listening on 127.0.0.1:3001\n');
});
