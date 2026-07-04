import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveAppRequest, contentTypeFor, APP_ORIGIN, APP_BASE_URL } from './appProtocol.js';

// Pure request→file mapping for the custom app:// protocol handler. No electron,
// no real fs — `isFile` is injected. The REAL end-to-end validation (that
// Chromium loads these under the app:// origin in a packaged/MAS build) is a
// device test; see the deliverable's TestFlight checklist.

const DIST = '/app/dist';
const existing = new Set([
  path.join(DIST, 'index.html'),
  path.join(DIST, 'assets/index-abc123.js'),
  path.join(DIST, 'assets/index-abc123.css'),
  path.join(DIST, 'theme-init.js'),
  path.join(DIST, 'favicon.ico'),
]);
const isFile = (p: string) => existing.has(p);
const resolve = (url: string) => resolveAppRequest(DIST, url, isFile);

describe('app:// origin constants', () => {
  it('produces the exact origin app://dayglance (no trailing slash) to allowlist in vault CORS', () => {
    expect(APP_ORIGIN).toBe('app://dayglance');
    expect(APP_BASE_URL).toBe('app://dayglance/');
  });
});

describe('resolveAppRequest — asset serving', () => {
  it('serves index.html for the root', () => {
    const r = resolve('app://dayglance/');
    expect(r.status).toBe(200);
    expect(r.filePath).toBe(path.join(DIST, 'index.html'));
    expect(r.contentType).toContain('text/html');
  });

  it('serves a hashed JS asset with the JS content type', () => {
    const r = resolve('app://dayglance/assets/index-abc123.js');
    expect(r.status).toBe(200);
    expect(r.filePath).toBe(path.join(DIST, 'assets/index-abc123.js'));
    expect(r.contentType).toContain('text/javascript');
  });

  it('serves the CSS asset with the CSS content type', () => {
    const r = resolve('app://dayglance/assets/index-abc123.css');
    expect(r.status).toBe(200);
    expect(r.contentType).toContain('text/css');
  });

  it('serves a public-dir asset (theme-init.js) referenced absolutely', () => {
    const r = resolve('app://dayglance/theme-init.js');
    expect(r.status).toBe(200);
    expect(r.filePath).toBe(path.join(DIST, 'theme-init.js'));
  });

  it('ignores the query string (tray loads ?tray=1) and still serves index.html', () => {
    const r = resolve('app://dayglance/?tray=1');
    expect(r.status).toBe(200);
    expect(r.filePath).toBe(path.join(DIST, 'index.html'));
  });
});

describe('resolveAppRequest — SPA fallback vs real 404', () => {
  it('falls back to index.html for an extensionless client route', () => {
    const r = resolve('app://dayglance/goals/some-id');
    expect(r.status).toBe(200);
    expect(r.filePath).toBe(path.join(DIST, 'index.html'));
    expect(r.fallback).toBe(true);
  });

  it('returns a real 404 for a MISSING asset (has an extension) — never HTML', () => {
    const r = resolve('app://dayglance/assets/renamed-old.js');
    expect(r.status).toBe(404);
    expect(r.filePath).toBeUndefined();
  });
});

describe('resolveAppRequest — traversal containment', () => {
  it('never resolves a file outside dist (URL parsing clamps .. to root; guard is belt-and-braces)', () => {
    // The WHATWG URL parser resolves %2e%2e (..) away, clamping the pathname to
    // the origin root, so this can never escape dist. Whatever it resolves to must
    // stay inside dist — and it must NOT point at the real /etc/passwd.
    const r = resolve('app://dayglance/%2e%2e/%2e%2e/etc/passwd');
    if (r.filePath) expect(r.filePath.startsWith(DIST)).toBe(true);
    expect(r.filePath).not.toBe('/etc/passwd');
  });
});

describe('contentTypeFor', () => {
  it('maps common extensions', () => {
    expect(contentTypeFor('/x/app.js')).toContain('text/javascript');
    expect(contentTypeFor('/x/app.css')).toContain('text/css');
    expect(contentTypeFor('/x/i.png')).toBe('image/png');
    expect(contentTypeFor('/x/f.woff2')).toBe('font/woff2');
    expect(contentTypeFor('/x/unknown.xyz')).toBe('application/octet-stream');
  });
});
