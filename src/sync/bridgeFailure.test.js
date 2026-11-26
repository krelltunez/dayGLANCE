import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVaultClient } from '@glance-apps/sync';
import { throwIfBridgeFailure } from './bridgeFailure.js';
import { vaultFetchImpl } from './dbEngine.js';
import { defaultVaultFetch } from '../intents/dbIntentsTransport.js';
import { adaptFetchForVaultClient } from '../intents/vaultIntentsSetup.js';

// #2445: the bridges' status-0 result is "never answered", not an HTTP status.
describe('throwIfBridgeFailure', () => {
  it('passes a real response through unchanged', () => {
    const r = { status: 200, ok: true, body: '{}' };
    expect(throwIfBridgeFailure(r)).toBe(r);
    const notFound = { status: 404, ok: false, body: '' };
    expect(throwIfBridgeFailure(notFound)).toBe(notFound);
  });

  it('throws a TypeError for no result, like browser fetch', () => {
    expect(() => throwIfBridgeFailure(null)).toThrow(new TypeError('Failed to fetch'));
  });

  it("keeps the native bridge's reason (error)", () => {
    let err;
    try { throwIfBridgeFailure({ status: 0, ok: false, body: '', error: 'Failed to connect to /10.0.0.5:8080' }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toBe('Failed to connect to /10.0.0.5:8080');
    expect(err.bridgeReason).toBe('Failed to connect to /10.0.0.5:8080');
    expect(err.status).toBeUndefined();
  });

  it("keeps the desktop proxy's reason (statusText)", () => {
    expect(() => throwIfBridgeFailure({ status: 0, ok: false, statusText: 'Too many redirects', body: '' }))
      .toThrow('Too many redirects');
  });

  it('carries no bridgeReason when the bridge gave none', () => {
    let err;
    try { throwIfBridgeFailure({ status: 0, ok: false, body: '' }); } catch (e) { err = e; }
    expect(err.message).toBe('Failed to fetch');
    expect(err.bridgeReason).toBeUndefined();
  });
});

// The transports the vault surfaces use: the sync engine's (vaultFetchImpl),
// the intents/enroll/Test Connection one (defaultVaultFetch). Each is driven
// through the real vault client, under a desktop proxy that cannot connect.
describe('vault transports under a bridge that cannot connect', () => {
  const failing = { status: 0, ok: false, statusText: 'connect ECONNREFUSED 10.0.0.5:8080', body: '', headers: { etag: null } };
  let savedWindow;
  beforeEach(() => {
    savedWindow = globalThis.window;
    globalThis.window = { electronAPI: { isElectron: true, proxyFetch: vi.fn(async () => failing) } };
  });
  afterEach(() => { globalThis.window = savedWindow; });

  const expectNetworkThrow = async (fetchImpl) => {
    const client = createVaultClient({ vaultUrl: 'https://vault.example.com', vaultToken: 't', fetchImpl });
    let err;
    try { await client.getSalt('acct-1'); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TypeError);
    expect(err.status).toBeUndefined();
    expect(err.message).toContain('ECONNREFUSED');
  };

  it('the sync engine transport throws instead of returning status 0', async () => {
    await expectNetworkThrow(vaultFetchImpl());
  });

  it('defaultVaultFetch throws, so the intents client and Test Connection see no status', async () => {
    await expectNetworkThrow(adaptFetchForVaultClient(defaultVaultFetch()));
  });
});
