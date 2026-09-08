import { describe, it, expect, vi, afterEach } from 'vitest';
import { pushToTrmnl } from './trmnl.js';

const cfg = { webhookUrl: 'https://usetrmnl.com/api/custom_plugins/abc' };
afterEach(() => { vi.unstubAllGlobals(); });

describe('pushToTrmnl', () => {
  it('reports a 429 as rate limited and carries Retry-After in seconds', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 429, ok: false, headers: { get: (h) => (h === 'Retry-After' ? '900' : null) } })));
    const r = await pushToTrmnl(cfg, { a: 1 });
    expect(r).toMatchObject({ success: false, rateLimited: true, retryAfterSeconds: 900 });
  });

  it('a 429 without Retry-After still backs off (null hint)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 429, ok: false, headers: { get: () => null } })));
    const r = await pushToTrmnl(cfg, { a: 1 });
    expect(r).toMatchObject({ success: false, rateLimited: true, retryAfterSeconds: null });
  });

  it('posts the merge variables and reports success', async () => {
    const fetchMock = vi.fn(async () => ({ status: 200, ok: true, headers: { get: () => null } }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await pushToTrmnl({ ...cfg, apiKey: 'k' }, { a: 1 });
    expect(r).toEqual({ success: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(cfg.webhookUrl);
    expect(JSON.parse(init.body)).toEqual({ merge_variables: { a: 1 } });
    expect(init.headers.Authorization).toBe('Bearer k');
  });
});
