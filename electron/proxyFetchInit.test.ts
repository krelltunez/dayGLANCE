import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { proxyFetchInit } from './proxyFetchInit';

const signal = new AbortController().signal;

describe('proxyFetchInit', () => {
  it('keeps the HTTP cache out of every request (#2409)', () => {
    const init = proxyFetchInit('GET', { Authorization: 'Basic abc' }, null, signal);
    expect(init.cache).toBe('no-store');
    expect(init.headers['Cache-Control']).toBe('no-cache');
    expect(init.headers.Authorization).toBe('Basic abc');
  });

  it('follows no redirect by itself: the handler re-validates each hop', () => {
    expect(proxyFetchInit('GET', {}, null, signal).redirect).toBe('manual');
  });

  it('carries the method, the signal and a body when there is one', () => {
    const put = proxyFetchInit('PUT', { 'Content-Type': 'application/json', 'If-Match': '"e"' }, '{"a":1}', signal);
    expect(put).toMatchObject({ method: 'PUT', body: '{"a":1}', signal });
    expect(put.headers['If-Match']).toBe('"e"');
    expect('body' in proxyFetchInit('GET', {}, null, signal)).toBe(false);
    expect(proxyFetchInit('PUT', {}, '', signal).body).toBe('');
  });

  it("leaves a caller's own Cache-Control as it is, whatever its case", () => {
    const init = proxyFetchInit('GET', { 'cache-control': 'max-age=0' }, null, signal);
    expect(init.headers).toEqual({ 'cache-control': 'max-age=0' });
  });

  it('does not change the headers it was handed', () => {
    const headers = { Depth: '0' };
    proxyFetchInit('PROPFIND', headers, null, signal);
    expect(headers).toEqual({ Depth: '0' });
  });

  it('tolerates no headers', () => {
    expect(proxyFetchInit('GET', null, null, signal).headers).toEqual({ 'Cache-Control': 'no-cache' });
  });
});

// The handler has no harness; this holds it to the one place the init is built.
describe('the proxy-fetch handler', () => {
  const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
  const handler = main.slice(main.indexOf("ipcMain.handle('proxy-fetch'"));
  const body = handler.slice(0, handler.indexOf('\n});'));

  it('sends every hop with proxyFetchInit', () => {
    expect(body).toContain('send(currentUrl, proxyFetchInit(currentMethod, headers, currentBody, controller.signal))');
    expect(body).not.toMatch(/redirect: 'manual'/);
  });
});
