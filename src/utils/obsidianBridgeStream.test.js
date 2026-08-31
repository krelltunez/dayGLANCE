import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupDbRootKey, clearDbRootKey } from '@glance-apps/sync';
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import {
  deriveBridgeSubkey,
  openBridgeEnvelope,
  sealBridgeEnvelope,
  encodePlainBridgeRow,
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
      // As the real server serves it: envelope bytes, base64-encoded.
      return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(meta) }) };
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
    // The wire envelope must survive the real server's byte round trip
    // (Buffer.from(base64) in, .toString('base64') out) — the raw-JSON
    // regression is caught right here.
    expect(Buffer.from(batch.rows[0].envelope, 'base64').toString('base64')).toBe(batch.rows[0].envelope);
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

  it('force bypasses a fresh NEGATIVE cache — the authority-rising-edge fix: pairing is seen now, not a TTL later', async () => {
    localStorage.removeItem('dayglance-bridge-pairing-meta'); // start pre-discovery
    globalThis.fetch = makeFetch({ meta: null });
    expect(await getBridgePairingMeta()).toBe(null); // pre-pairing negative cached
    globalThis.fetch = makeFetch(); // pairing completes; meta row now exists
    expect(await getBridgePairingMeta()).toBe(null); // TTL still serves the negative…
    expect(await getBridgePairingMeta({ force: true })).toMatchObject({ generation: SALT_B64 }); // …force does not
    expect(await getBridgePairingMeta()).toMatchObject({ generation: SALT_B64 }); // and the cache is corrected
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

  it('the config row carries the block-id write release (§3.10 ruling 7 gate): true publishes true, omitted publishes an explicit false — never an absent field', async () => {
    globalThis.fetch = makeFetch();
    const base = { dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks' };
    await publishBridgeConfig({ ...base, blockIdWrites: true });
    await publishBridgeConfig(base); // release off → value change → republished
    const rows = globalThis.fetch.batches.filter((b) => b.rows[0].entityId === 'meta:config');
    expect(rows).toHaveLength(2);
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    expect(await openBridgeEnvelope(subkey, rows[0].rows[0].envelope)).toMatchObject({ blockIdWrites: true });
    // An explicit false, so a plugin paired to a current build never sees an
    // absent field once the release is off — same refusal either way
    // (bridgeConfigAllowsStamping), but the row states it.
    expect(await openBridgeEnvelope(subkey, rows[1].rows[0].envelope)).toMatchObject({ blockIdWrites: false });
  });

  it('THE SESSION-SCOPED GUARD (2026-08-31 config-null incident): the once-per-value memory never touches localStorage, and a fresh session republishes the same value', async () => {
    // The first shape PERSISTED the hash ('dayglance-bridge-config-hash'),
    // which made "restart dayGLANCE" structurally incapable of republishing
    // the row — the workaround the incident's plugin-side hole needed most.
    // Pre-seed the legacy key exactly as the old code would have written it:
    // it must be IGNORED (publish happens anyway) and CLEANED UP.
    globalThis.fetch = makeFetch();
    const cfg = { dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks' };
    const legacyHash = JSON.stringify({
      v: 1, kind: 'config', dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd',
      taskHeading: '## Tasks', blockIdWrites: false,
    });
    localStorage.setItem('dayglance-bridge-config-hash', legacyHash);
    await publishBridgeConfig(cfg);
    let rows = globalThis.fetch.batches.filter((b) => b.rows[0].entityId === 'meta:config');
    expect(rows).toHaveLength(1); // legacy persisted hash did NOT suppress
    expect(localStorage.getItem('dayglance-bridge-config-hash')).toBe(null); // and was retired

    // Same value again in the same session → coalesced, and still nothing
    // written to localStorage (the guard lives in module memory only).
    await publishBridgeConfig(cfg);
    rows = globalThis.fetch.batches.filter((b) => b.rows[0].entityId === 'meta:config');
    expect(rows).toHaveLength(1);
    expect(localStorage.getItem('dayglance-bridge-config-hash')).toBe(null);

    // A new session (module state reset) republishes the SAME value once —
    // the reachable recovery lever the persisted guard removed.
    __resetBridgeStreamForTests();
    await publishBridgeConfig(cfg);
    rows = globalThis.fetch.batches.filter((b) => b.rows[0].entityId === 'meta:config');
    expect(rows).toHaveLength(2);
  });

  it('A RE-PAIR REPUBLISHES: identical values under a NEW pairing generation publish again — the old sealed row is unreadable garbage to the rotated subkey', async () => {
    globalThis.fetch = makeFetch();
    const cfg = { dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks' };
    await publishBridgeConfig(cfg);
    // Re-pair: new salt, new generation, cached fresh (as the sync cycle's
    // forced meta refresh would leave it).
    const salt2 = new Uint8Array(16).fill(6);
    const salt2B64 = btoa(String.fromCharCode(...salt2));
    localStorage.setItem('dayglance-bridge-pairing-meta', JSON.stringify({
      meta: { v: 1, kind: 'pairing-meta', generation: salt2B64, pairingSalt: salt2B64, pairedAt: '2026-08-31T00:00:00Z' },
      fetchedAt: Date.now(),
    }));
    await publishBridgeConfig(cfg); // same VALUES — must still republish
    const rows = globalThis.fetch.batches.filter((b) => b.rows[0].entityId === 'meta:config');
    expect(rows).toHaveLength(2);
    // Sealed under the NEW generation's subkey — the new stream can read it.
    const subkey2 = await deriveBridgeSubkey(getDbRootKey(), salt2);
    expect(await openBridgeEnvelope(subkey2, rows[1].rows[0].envelope)).toMatchObject({ kind: 'config', dailyNotesPath: 'Daily' });
  });
});

describe('the bridge brake (429 backoff)', () => {
  it('a 429 arms the brake: no bridge request until it lifts, then flush resumes and success resets it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    try {
      const limited = async () => ({ ok: false, status: 429, json: async () => ({ error: 'too many requests' }) });
      globalThis.fetch = limited;
      emitBridgeIntent('daily_note_write', { path: 'x.md', content: 'y' });
      expect(await flushBridgeOutbox()).toBe(false); // 429 → brake armed
      expect(JSON.parse(localStorage.getItem(OUTBOX_KEY))).toHaveLength(1); // nothing lost

      // Brake active: the working server is NOT contacted at all.
      globalThis.fetch = makeFetch();
      expect(await flushBridgeOutbox()).toBe(false);
      expect(globalThis.fetch.batches).toHaveLength(0);
      // …and even a FORCED meta refresh serves the cache instead of fetching.
      expect(await getBridgePairingMeta({ force: true })).toMatchObject({ generation: SALT_B64 });

      // Past the window: flush goes through, queue drains, brake resets.
      vi.setSystemTime(new Date('2026-08-30T12:00:31.000Z'));
      expect(await flushBridgeOutbox()).toBe(true);
      expect(globalThis.fetch.batches).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem(OUTBOX_KEY))).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('emits still QUEUE while braked — the brake pauses the network, never the outbox', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-30T12:00:00.000Z'));
    try {
      globalThis.fetch = async () => ({ ok: false, status: 429, json: async () => ({}) });
      emitBridgeIntent('daily_note_write', { path: 'a.md', content: '1' });
      await flushBridgeOutbox();
      expect(emitBridgeIntent('daily_note_write', { path: 'b.md', content: '2' })).toBe(true);
      expect(JSON.parse(localStorage.getItem(OUTBOX_KEY))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('DECAY, never amnesty (the 2026-08-30 plugin lesson): one lucky success does NOT reset the escalation — the next 429 re-arms at the storm level', async () => {
    vi.useFakeTimers();
    const at = (iso) => vi.setSystemTime(new Date(iso));
    const limited = async () => ({ ok: false, status: 429, json: async () => ({ error: 'too many requests' }) });
    try {
      // Escalate to a 60s arming: 429 (arms 30s), retry past the window 429s again (arms 60s).
      at('2026-08-30T12:00:00.000Z');
      // Re-stamp the meta cache under the FAKE clock so flushes serve it from
      // cache — each network request that succeeds decays the memory once, and
      // this test counts exactly the batch requests.
      localStorage.setItem('dayglance-bridge-pairing-meta', JSON.stringify({ meta: META, fetchedAt: Date.now() }));
      globalThis.fetch = limited;
      emitBridgeIntent('daily_note_write', { path: 'a.md', content: '1' });
      await flushBridgeOutbox();               // arms 30s, memory 30s
      at('2026-08-30T12:00:31.000Z');
      await flushBridgeOutbox();               // 429 again → arms 60s, memory 60s

      // A lucky success past the window: gate opens, memory HALVES (60→30), not zeroed.
      at('2026-08-30T12:01:32.000Z');
      globalThis.fetch = makeFetch();
      expect(await flushBridgeOutbox()).toBe(true);

      // The storm is still on: the very next 429 re-arms at 60s (2×30s memory),
      // NOT the fresh 30s base the amnesty design restarted from.
      globalThis.fetch = limited;
      emitBridgeIntent('daily_note_write', { path: 'b.md', content: '2' });
      await flushBridgeOutbox();               // arms min(30*2, cap) = 60s

      // 31s later — the amnesty design would already be retrying; the brake holds.
      at('2026-08-30T12:02:03.000Z');
      globalThis.fetch = makeFetch();
      expect(await flushBridgeOutbox()).toBe(false);
      expect(globalThis.fetch.batches).toHaveLength(0);

      // Past the full 60s arming it opens again.
      at('2026-08-30T12:02:33.000Z');
      expect(await flushBridgeOutbox()).toBe(true);
      expect(globalThis.fetch.batches).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a genuine recovery drains the memory: consecutive successes decay it to zero, and the next 429 arms at the 30s base again', async () => {
    vi.useFakeTimers();
    const at = (iso) => vi.setSystemTime(new Date(iso));
    const limited = async () => ({ ok: false, status: 429, json: async () => ({ error: 'too many requests' }) });
    try {
      // Build 60s of memory as above.
      at('2026-08-30T12:00:00.000Z');
      localStorage.setItem('dayglance-bridge-pairing-meta', JSON.stringify({ meta: META, fetchedAt: Date.now() }));
      globalThis.fetch = limited;
      emitBridgeIntent('daily_note_write', { path: 'a.md', content: '1' });
      await flushBridgeOutbox();
      at('2026-08-30T12:00:31.000Z');
      await flushBridgeOutbox();               // memory 60s

      // Two quiet successes: 60 → 30 → 0 (released).
      at('2026-08-30T12:01:32.000Z');
      globalThis.fetch = makeFetch();
      expect(await flushBridgeOutbox()).toBe(true);   // memory 30s
      emitBridgeIntent('daily_note_write', { path: 'b.md', content: '2' });
      expect(await flushBridgeOutbox()).toBe(true);   // memory 0 — released

      // Fresh incident later: arms at the 30s base, so at +31s the gate is open.
      globalThis.fetch = limited;
      emitBridgeIntent('daily_note_write', { path: 'c.md', content: '3' });
      await flushBridgeOutbox();               // arms 30s
      at('2026-08-30T12:02:03.000Z');
      globalThis.fetch = makeFetch();
      expect(await flushBridgeOutbox()).toBe(true);
      expect(globalThis.fetch.batches).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('round trip with the plugin-side seal', () => {
  it('a row the plugin seals under the imported subkey opens on the app side (both directions, one wire format)', async () => {
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    const sealed = await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', path: 'a.md', content: 'body' });
    expect(await openBridgeEnvelope(subkey, sealed)).toMatchObject({ kind: 'observation', path: 'a.md' });
  });
});
