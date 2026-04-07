import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// ---------------------------------------------------------------------------
// Dev-only middleware that replicates the Vercel serverless functions for
// /api/webdav-proxy/ and /api/calendar-proxy/ so `npm run dev` works
// identically to the deployed environment.
// ---------------------------------------------------------------------------
function devApiProxy() {
  // Identical validation logic to api/webdav-proxy.js and api/calendar-proxy.js.
  function validateProxyUrl(urlString) {
    let parsed;
    try { parsed = new URL(urlString); } catch { throw new Error('Invalid URL'); }

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
      ) throw new Error('Private/reserved addresses are not allowed');
    }

    if (
      hostname === '::1' || hostname === '::' ||
      /^::ffff:/i.test(hostname) || /^fe80:/i.test(hostname) ||
      /^fc/i.test(hostname)      || /^fd/i.test(hostname)
    ) throw new Error('Private/reserved addresses are not allowed');

    return parsed;
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
  }

  function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }

  return {
    name: 'dev-api-proxy',
    configureServer(server) {

      // ── /api/webdav-proxy/ ──────────────────────────────────────────────
      server.middlewares.use('/api/webdav-proxy', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'Access-Control-Max-Age': '86400' });
          return res.end();
        }

        const targetUrl = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!targetUrl) return sendJson(res, 400, { error: 'Missing url parameter' });

        try { validateProxyUrl(targetUrl); }
        catch (err) { return sendJson(res, 400, { error: err.message }); }

        const headers = {
          'Content-Type': req.headers['content-type'] || 'application/octet-stream',
        };
        if (req.headers['x-webdav-auth']) headers['Authorization'] = req.headers['x-webdav-auth'];
        if (req.headers['depth'] !== undefined) headers['Depth'] = req.headers['depth'];

        const body = (req.method !== 'GET' && req.method !== 'HEAD')
          ? await readBody(req) : undefined;

        try {
          const response = await fetch(targetUrl, {
            method: req.method,
            headers,
            ...(body ? { body } : {}),
          });
          const responseBody = await response.text();
          res.writeHead(response.status, {
            'Content-Type': response.headers.get('content-type') || 'text/plain',
          });
          res.end(responseBody);
        } catch {
          sendJson(res, 502, { error: 'Failed to proxy WebDAV request' });
        }
      });

      // ── /api/calendar-proxy/ ────────────────────────────────────────────
      server.middlewares.use('/api/calendar-proxy', async (req, res) => {
        const targetUrl = new URL(req.url, 'http://localhost').searchParams.get('url');
        if (!targetUrl) return sendJson(res, 400, { error: 'Missing url parameter' });

        try { validateProxyUrl(targetUrl); }
        catch (err) { return sendJson(res, 400, { error: err.message }); }

        const fetchHeaders = { Accept: 'text/calendar, text/plain, */*' };
        if (req.headers['x-calendar-auth']) fetchHeaders['Authorization'] = req.headers['x-calendar-auth'];

        try {
          const response = await fetch(targetUrl, { headers: fetchHeaders });
          const responseBody = await response.text();
          res.writeHead(response.status, {
            'Content-Type': response.headers.get('content-type') || 'text/plain',
            'Cache-Control': 'public, max-age=900, stale-while-revalidate=60',
          });
          res.end(responseBody);
        } catch {
          sendJson(res, 502, { error: 'Failed to fetch calendar' });
        }
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(new Date().toISOString()),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    sourcemap: true,
  },
  plugins: [
    devApiProxy(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,ico,svg}'],
        globIgnores: ['**/dayglance-dark.svg', '**/dayglance-light.svg'],
      },
      manifest: {
        name: 'dayGLANCE',
        short_name: 'dayGLANCE',
        description: 'A beautiful time-blocking day planner with task management',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
})
