import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupDbRootKey, clearDbRootKey } from '@glance-apps/sync';
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import {
  deriveBridgeSubkey,
  openBridgeEnvelope,
  sealBridgeEnvelope,
} from '@glance-apps/obsidian-format';
import {
  emitBridgeIntent,
  flushBridgeOutbox,
  getBridgePairingMeta,
  publishBridgeConfig,
  __resetBridgeStreamForTests,
} from './obsidianBridgeStream.js';

// The emitter's load-bearing claims: intents get their id at emit time and
// live in a PERSISTED outbox before any network; flushing seals them under
// the subkey derived from root key + the discovered pairing salt; an
// unpaired or unreachable vault leaves the queue intact (fail-silent, never
// lossy); rows land in the app-scoped namespace with int:-prefixed ids.

const VAULT_CONFIG_KEY = 'dayglance-vault-config';
const OUTBOX_KEY = 'dayglance-bridge-outbox';
const SALT = new Uint8Array(16).fill(5);
const SALT_B64 = btoa(String.fromCharCode(...SALT));
const META = { v: 1, kind: 'pairing-meta', generation: SALT_B64, pairingSalt: SALT_B64, pairedAt: '2026-08-29T00:00:00Z' };

const nativeStub = { get: () => null, store: () => {} };
const installRootKey = () => setupDbRootKey('pw', new Uint8Array(16).fill(9), {
  nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store,
});

// fetch mock: routes by URL; records batch bodies.
const makeFetch = ({ meta = META, failBatch = false } = {}) => {
  const batches = [];
  const impl = async (url, init = {}) => {
    if (url.includes('/sync/dayglance-bridge/batch')) {
      if (failBatch) return { ok: false, status: 500, json: async () => ({}) };
      batches.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ written: 1, maxSeq: 1 }) };
    }
    if (url.includes('/sync/dayglance-bridge/meta')) {
      if (!meta) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: JSON.stringify(meta) }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  impl.batches = batches;
  return impl;
};

beforeEach(async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({
    enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct-1',
  }));
  // Paired-vault baseline: the meta cache the sync cycle keeps fresh (it
  // gates the emit sites — see the unpaired test for the other side).
  localStorage.setItem('dayglance-bridge-pairing-meta', JSON.stringify({ meta: META, fetchedAt: Date.now() }));
  __resetBridgeStreamForTests();
  await installRootKey();
});
afterEach(async () => {
  await clearDbRootKey({ nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
  delete globalThis.localStorage;
  delete globalThis.fetch;
});

describe('emit + flush', () => {
  it('assigns the id at emit time, persists before network, seals under the derived subkey', async () => {
    globalThis.fetch = makeFetch();
    emitBridgeIntent('daily_note_write', { path: '2026-08-29.md', date: '2026-08-29', content: 'hi' });
    const queued = JSON.parse(localStorage.getItem(OUTBOX_KEY));
    expect(queued).toHaveLength(1);
    expect(queued[0].intentId).toBeTruthy();
    expect(queued[0].createdAt).toBeTruthy();

    expect(await flushBridgeOutbox()).toBe(true);
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY))).toHaveLength(0);

    const batch = globalThis.fetch.batches.at(-1);
    expect(batch.accountId).toBe('acct-1');
    expect(batch.rows[0].entityId).toBe(`int:${queued[0].intentId}`);
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    const opened = await openBridgeEnvelope(subkey, batch.rows[0].envelope);
    expect(opened).toMatchObject({ kind: 'intent', type: 'daily_note_write', content: 'hi', intentId: queued[0].intentId });
  });

  it('unpaired vault (no discovered meta): the emit is DROPPED, never queued — a pre-pairing backlog must not exist', async () => {
    localStorage.removeItem('dayglance-bridge-pairing-meta');
    globalThis.fetch = makeFetch({ meta: null });
    emitBridgeIntent('daily_note_write', { path: 'x.md', content: 'y' });
    await new Promise((r) => setTimeout(r, 0));
    expect(localStorage.getItem(OUTBOX_KEY)).toBe(null);
    expect(globalThis.fetch.batches).toHaveLength(0);
  });

  it('a failed batch keeps the queue for the next flush; a later success drains it', async () => {
    globalThis.fetch = makeFetch({ failBatch: true });
    emitBridgeIntent('daily_note_write', { path: 'x.md', content: 'y' });
    await new Promise((r) => setTimeout(r, 0));
    expect(await flushBridgeOutbox()).toBe(false);
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY))).toHaveLength(1);

    globalThis.fetch = makeFetch();
    expect(await flushBridgeOutbox()).toBe(true);
    expect(JSON.parse(localStorage.getItem(OUTBOX_KEY))).toHaveLength(0);
  });

  it('getBridgePairingMeta caches the discovered meta', async () => {
    globalThis.fetch = makeFetch();
    expect(await getBridgePairingMeta()).toMatchObject({ generation: SALT_B64 });
    globalThis.fetch = makeFetch({ meta: null }); // cache still fresh → no refetch
    expect(await getBridgePairingMeta()).toMatchObject({ generation: SALT_B64 });
  });

  it('publishBridgeConfig seals the config row once per distinct value', async () => {
    globalThis.fetch = makeFetch();
    const cfg = { dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks' };
    await publishBridgeConfig(cfg);
    await publishBridgeConfig(cfg); // unchanged → no second publish
    const rows = globalThis.fetch.batches.filter((b) => b.rows[0].entityId === 'meta:config');
    expect(rows).toHaveLength(1);
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    expect(await openBridgeEnvelope(subkey, rows[0].rows[0].envelope)).toMatchObject({ kind: 'config', dailyNotesPath: 'Daily' });
  });
});

describe('round trip with the plugin-side seal', () => {
  it('a row the plugin seals under the imported subkey opens on the app side (both directions, one wire format)', async () => {
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    const sealed = await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', path: 'a.md', content: 'body' });
    expect(await openBridgeEnvelope(subkey, sealed)).toMatchObject({ kind: 'observation', path: 'a.md' });
  });
});
