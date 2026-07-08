import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase, createDbSyncEngine } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { getVaultConfig, setVaultConfig, isVaultEnabled } from './vaultConfig.js';
import { getDeviceId } from './deviceId.js';
import { registerDbEngine, markDirty, schedulePush } from './dirtyTracker.js';
import { tombstoneCutoff } from './tombstoneRetention.js';

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2 PART B — live wiring. These exercise the REAL @glance-apps/sync
// createDbSyncEngine (real per-entity AES-GCM) via an injected in-memory vault
// client and an in-memory native key store (so no network and no indexedDB).
// ─────────────────────────────────────────────────────────────────────────────

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

// In-memory GLANCEvault: one row per entityId (upsert, last-write-wins), global
// seq. Mirrors the real vaultClient surface the engine calls.
function createMemoryVault() {
  const salts = new Map();
  const log = new Map();
  let seq = 0;
  return {
    async getSalt(accountId) { return salts.get(accountId) || null; },
    async putSalt(accountId, fresh) { if (!salts.has(accountId)) salts.set(accountId, fresh); return salts.get(accountId); },
    async batch(app, { rows }) {
      for (const r of rows) log.set(r.entityId, { entityId: r.entityId, seq: ++seq, envelope: r.envelope, deleted: false });
      return { maxSeq: seq };
    },
    async deleteRow(app, entityId) { log.set(entityId, { entityId, seq: ++seq, envelope: null, deleted: true }); return { seq }; },
    async list(app, { since }) {
      const rows = [...log.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { rows, hasMore: false };
    },
    async device() { return { updated: true }; },
  };
}

// Hermetic teardown: never let fake timers or the localStorage shim leak into
// other test files sharing this worker.
afterEach(() => { vi.useRealTimers(); });
afterAll(() => { delete global.localStorage; });

const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {},
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const task = (id, lastModified, extra = {}) => ({
  id, title: `task ${id}`, duration: 30, color: 'bg-blue-500', completed: false,
  notes: '', subtasks: [], lastModified, ...extra,
});

// A device: its own data object + native key store + storageKeyPrefix, sharing
// one vault. getData/commitData are the app's buildSyncPayload().data /
// applyPayload analogs.
function makeDevice(name, vault, initial) {
  let data = clone(initial);
  let nativeKey = null;
  const engine = createDbEngine({
    vaultClient: vault,
    storageKeyPrefix: `dev-${name}`,
    deviceId: `device-${name}`,
    nativeGetSyncKey: () => nativeKey,
    nativeStoreSyncKey: (v) => { nativeKey = v; },
    getData: () => clone(data),
    commitData: (d) => { data = d; },
  });
  return { engine, get data() { return data; } };
}

async function runRounds(a, b, rounds = 6) {
  for (let i = 0; i < rounds; i++) {
    await a.engine.dbSyncCycle();
    await b.engine.dbSyncCycle();
  }
}

describe('Part B — vaultConfig gate', () => {
  beforeEach(() => { global.localStorage = memLocalStorage(); });

  it('isVaultEnabled is false until fully configured + enabled', () => {
    expect(isVaultEnabled()).toBe(false);
    setVaultConfig({ enabled: true, vaultUrl: 'https://v', vaultToken: 't', accountId: 'acct' });
    expect(isVaultEnabled()).toBe(true);
    expect(getVaultConfig().accountId).toBe('acct');
    setVaultConfig(null);
    expect(isVaultEnabled()).toBe(false);
  });

  it('createDbEngine returns null when the vault is disabled (DB path inert)', () => {
    expect(createDbEngine({ getData: () => ({}), commitData: () => {} })).toBeNull();
  });
});

describe('Part B — deviceId is stable', () => {
  beforeEach(() => { global.localStorage = memLocalStorage(); });
  it('returns the same id across calls and persists it', () => {
    const a = getDeviceId();
    expect(a).toBeTruthy();
    expect(getDeviceId()).toBe(a);
    expect(global.localStorage.getItem('dayglance-device-id')).toBe(a);
  });
});

describe('Part B — dirtyTracker push-on-write (vault-only, debounced)', () => {
  beforeEach(() => { vi.useFakeTimers(); registerDbEngine(null); });

  it('schedules ONE debounced vault cycle ~3s after a burst of writes, off-safe', async () => {
    const dbSyncCycle = vi.fn().mockResolvedValue();
    registerDbEngine({ dbSyncCycle, markDirty: vi.fn() });

    markDirty('tasks:1');
    markDirty('tasks:2');
    schedulePush(); // a third write resets the timer
    expect(dbSyncCycle).not.toHaveBeenCalled(); // debounced, not yet

    await vi.advanceTimersByTimeAsync(3000);
    expect(dbSyncCycle).toHaveBeenCalledTimes(1); // burst collapsed into one cycle

    registerDbEngine(null); // detach
    markDirty('tasks:3');
    await vi.advanceTimersByTimeAsync(5000);
    expect(dbSyncCycle).toHaveBeenCalledTimes(1); // no-op when vault is off
    vi.useRealTimers();
  });
});

describe('Part B — end-to-end two-device sync via the REAL engine', () => {
  beforeAll(() => { /* passphrase shared by both devices, like the file tier */ });

  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct1' });
    setSyncPassphrase('correct horse battery staple');
  });

  it('a task created on device A reaches device B', async () => {
    const vault = createMemoryVault();
    const A = makeDevice('A', vault, { ...EMPTY, tasks: [task(1, '2026-06-18T10:00:00.000Z')] });
    const B = makeDevice('B', vault, { ...EMPTY });

    await runRounds(A, B);

    expect(B.data.tasks.map((t) => t.id)).toContain(1);
    expect(B.data.tasks.find((t) => t.id === 1).title).toBe('task 1');
  });

  it('concurrent bundle edits on both devices converge (set-union) through real crypto', async () => {
    const vault = createMemoryVault();
    const base = { ...EMPTY, completedTaskUids: ['uid-base::2026-06-17'] };
    const A = makeDevice('A', vault, base);
    const B = makeDevice('B', vault, base);
    // baseline seed
    await runRounds(A, B, 2);

    // each device appends a different uid offline
    A.engine /* mutate via commit path */;
    // simulate local edits by mutating the device data through getData/commitData:
    // easiest is to push directly into the live data object.
    A.data.completedTaskUids.push('uid-a::2026-06-18');
    B.data.completedTaskUids.push('uid-b::2026-06-18');

    await runRounds(A, B);

    for (const dev of [A, B]) {
      expect(new Set(dev.data.completedTaskUids)).toEqual(
        new Set(['uid-base::2026-06-17', 'uid-a::2026-06-18', 'uid-b::2026-06-18']),
      );
    }
  });

  it('CONVERGES with stable content — repeated cycles stop pushing (no self-nudge loop)', async () => {
    // The heart of the loop fix: with no content change, the dirty set must drain
    // to empty and STAY empty, so the device stops writing to the vault (no batch →
    // no account-seq advance → no nudge). Real content changes still push.
    const vault = createMemoryVault();
    const batchSpy = vi.spyOn(vault, 'batch');
    const A = makeDevice('A', vault, { ...EMPTY, tasks: [task(1, '2026-06-18T10:00:00.000Z')] });

    // Let it settle (pull-then-push + HWM-on-pull take a couple cycles to quiesce).
    for (let i = 0; i < 6; i++) await A.engine.dbSyncCycle();
    const settled = batchSpy.mock.calls.length;

    // Further no-change cycles must push NOTHING — this is what breaks the loop.
    await A.engine.dbSyncCycle();
    await A.engine.dbSyncCycle();
    expect(batchSpy.mock.calls.length).toBe(settled);

    // A genuine content change still pushes instantly (real nudges preserved).
    A.data.tasks.push(task(2, '2026-06-18T11:00:00.000Z'));
    await A.engine.dbSyncCycle();
    expect(batchSpy.mock.calls.length).toBeGreaterThan(settled);
  });

  it('a field that CHANGES every cycle NEVER converges — re-pushed forever (the loop the horizon fix removes)', async () => {
    // Reproduces the root cause: a synced singleton whose value moves each build
    // (as tombstonePrunedBefore did via Date.now()) is dirty every cycle and
    // re-pushed forever. This is why the horizon had to be made stable.
    const vault = createMemoryVault();
    const batchSpy = vi.spyOn(vault, 'batch');
    let key = null;
    let data = { ...EMPTY, tasks: [task(1, '2026-06-18T10:00:00.000Z')] };
    let tick = 0;
    const engine = createDbEngine({
      vaultClient: vault,
      storageKeyPrefix: 'dev-moving',
      deviceId: 'device-moving',
      nativeGetSyncKey: () => key,
      nativeStoreSyncKey: (v) => { key = v; },
      // A moving singleton value (stands in for the old Date.now()-per-build field).
      getData: () => ({ ...clone(data), movingHorizon: new Date(tick * 3600000).toISOString() }),
      commitData: (d) => { data = d; },
    });

    // Warm up so the initial full-seed settles, then advance the field every cycle.
    for (let i = 0; i < 3; i++) { tick += 1; await engine.dbSyncCycle(); }
    const before = batchSpy.mock.calls.length;
    for (let i = 0; i < 4; i++) { tick += 1; await engine.dbSyncCycle(); }
    // Every one of those 4 cycles re-pushed the moving row — it never quiesces.
    expect(batchSpy.mock.calls.length).toBeGreaterThanOrEqual(before + 4);
  });

  it('tombstonePrunedBefore CONVERGES — a stuck-HIGH vault value is overwritten with the recomputed cutoff and pushing stops', async () => {
    // Fence rework: the horizon is a pure function of the current UTC day
    // (tombstoneCutoff() = the fixed 60-day GC window). getData emits it every cycle
    // and the merge RECOMPUTES-and-OVERWRITES it, so a peer's value can never
    // survive as "newer". This is the fix to the monotonic-max() trap that made a
    // fixed value churn forever (PR #1142): max()/newerIso could never LOWER a
    // stuck-high value, so the device emitting the correct (lower) value re-pushed
    // it every cycle without converging. Here a peer seeds a FUTURE (stuck-high)
    // fence; the real engine must drag it down to the cutoff and then quiesce.
    const vault = createMemoryVault();
    const STUCK_HIGH = '2099-01-01T12:34:56.789Z'; // a value max() could never lower
    const cutoff = tombstoneCutoff().toISOString(); // what buildSyncPayload emits

    // Seed the vault with the stuck-high value via another device.
    const B = makeDevice('B', vault, { ...EMPTY, tombstonePrunedBefore: STUCK_HIGH });
    await B.engine.dbSyncCycle();

    // Device A's getData ALWAYS returns the recomputed cutoff (as buildSyncPayload does).
    let key = null;
    let data = { ...EMPTY };
    const engineA = createDbEngine({
      vaultClient: vault,
      storageKeyPrefix: 'dev-A-fence',
      deviceId: 'device-A-fence',
      nativeGetSyncKey: () => key,
      nativeStoreSyncKey: (v) => { key = v; },
      getData: () => ({ ...clone(data), tombstonePrunedBefore: cutoff }),
      commitData: (d) => { data = d; },
    });

    const batchSpy = vi.spyOn(vault, 'batch');
    for (let i = 0; i < 6; i++) await engineA.dbSyncCycle();  // settle (incl. the corrective re-push)
    const settled = batchSpy.mock.calls.length;

    // Unchanged cycles now push NOTHING — recomputed payload == overwritten stored value.
    await engineA.dbSyncCycle();
    await engineA.dbSyncCycle();
    expect(batchSpy.mock.calls.length).toBe(settled);
    // The stuck-high value was overwritten with the local cutoff — NOT kept (which
    // newerIso/max() would have done, churning forever).
    expect(data.tombstonePrunedBefore).toBe(cutoff);
  });

  it('a cross-list move (unscheduled → scheduled) ends under exactly one kind on both devices', async () => {
    const vault = createMemoryVault();
    const start = { ...EMPTY, unscheduledTasks: [task(1003, '2026-06-18T10:00:00.000Z')] };
    const A = makeDevice('A', vault, start);
    const B = makeDevice('B', vault, start);
    await runRounds(A, B, 2); // share baseline

    // device A promotes 1003 to the schedule
    A.data.unscheduledTasks = A.data.unscheduledTasks.filter((t) => t.id !== 1003);
    A.data.tasks.push(task(1003, '2026-06-18T11:00:00.000Z', { date: '2026-06-18' }));

    await runRounds(A, B);

    for (const dev of [A, B]) {
      const inTasks = dev.data.tasks.some((t) => t.id === 1003);
      const inUnsched = dev.data.unscheduledTasks.some((t) => t.id === 1003);
      expect(inTasks).toBe(true);
      expect(inUnsched).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1.4.0 cursor fix — targeted interleave test.
//
// Proves the residual race the package fix closed: a PUSH must not advance the
// PULL cursor (getHighWaterMark) past a remote row the device has not yet read.
// Under 1.3.2 the engine advanced a single shared HWM on push, so a remote row
// whose seq sat below the device's freshly-pushed rows was skipped forever
// (unrecoverable for insert-only rows). 1.4.0 split the cursor: getHighWaterMark
// is pull-only, getPushAck tracks push idempotency.
// ─────────────────────────────────────────────────────────────────────────────
describe('1.4.0 — push does not advance the pull cursor past an unread remote row', () => {
  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setSyncPassphrase('correct horse battery staple');
  });

  // A raw createDbSyncEngine over a flat entityId→entity map (no app adapter),
  // so we can drive push/pull steps and inspect the cursors directly.
  function makeRawEngine(name, vault) {
    let nativeKey = null;
    const data = {};
    const engine = createDbSyncEngine({
      storageKeyPrefix: `raw-${name}`,
      appId: 'dayglance',
      vaultApp: 'dayglance',
      cryptoDBName: `raw-${name}-crypto`,
      accountId: 'acct-raw',
      vaultClient: vault,
      deviceId: `raw-${name}`,
      nativeGetSyncKey: () => nativeKey,
      nativeStoreSyncKey: (v) => { nativeKey = v; },
      getLocalEntity: (id) => (id in data ? data[id] : null),
      applyRemoteEntity: (id, e) => { data[id] = e; },
      applyRemoteDelete: (id) => { delete data[id]; },
      isInsertOnly: () => false,
      getEntityLastModified: (e) => e && e.lastModified,
    });
    return { engine, data };
  }

  it('A push (seqs > N+1) leaves the pull cursor at N, so the next pull still lists B@N+1', async () => {
    const vault = createMemoryVault();
    const A = makeRawEngine('A', vault);
    const B = makeRawEngine('B', vault);

    // Baseline: A writes a1 (seq 1) and pulls, so A's pull cursor sits at N = 1.
    A.data['a1'] = { id: 'a1', lastModified: '2026-06-18T10:00:00.000Z' };
    A.engine.markDirty('a1');
    await A.engine.pushDirtyRows();      // a1 → seq 1
    await A.engine.pullRemoteChanges();  // A pull cursor advances to 1
    const N = A.engine.getHighWaterMark();
    expect(N).toBe(1);

    // B writes b1 at seq N+1 = 2 (A has NOT read it yet).
    B.data['b1'] = { id: 'b1', lastModified: '2026-06-18T10:05:00.000Z' };
    B.engine.markDirty('b1');
    await B.engine.pushDirtyRows();      // b1 → seq 2 (= N+1)

    // A pushes a new row, which the server assigns a seq ABOVE N+1 (seq 3).
    A.data['a2'] = { id: 'a2', lastModified: '2026-06-18T10:10:00.000Z' };
    A.engine.markDirty('a2');
    await A.engine.pushDirtyRows();      // a2 → seq 3 (> N+1)

    // The fix: A's push consumed nothing, so the PULL cursor is unchanged (still
    // N); only the push-ack marker advanced.
    expect(A.engine.getHighWaterMark()).toBe(N);
    expect(A.engine.getPushAck()).toBeGreaterThanOrEqual(3);

    // Therefore A's NEXT pull resumes from N and still lists B's row at N+1.
    await A.engine.pullRemoteChanges();
    expect(A.data['b1']).toBeTruthy();
    expect(A.data['b1'].id).toBe('b1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Electron transport — the DB tier must adapt the vaultClient's
// fetch-style `doFetch(url, init)` calls to the POSITIONAL
// `proxyFetch(method, url, headers, body)` IPC bridge.
//
// Regression: previously the electron branch handed `electronProxyFetch`
// straight to the engine as `fetchImpl`. The vaultClient then called it
// `doFetch(url, init)`, so the URL string landed in proxyFetch's `method` slot
// and the options object in its `url` slot. The electron main process rejects
// an unrecognized method with a SYNTHETIC 400 ("Method not allowed") WITHOUT
// ever hitting the network — which is exactly the client-side "list failed:
// 400" / VERIFIER_UNSUPPORTED that never reached the server (Caddy logged
// nothing). These tests prove the bridge is now invoked positionally and that a
// real request is emitted for the actual vault URL.
// ─────────────────────────────────────────────────────────────────────────────
describe('Electron transport — proxyFetch is called positionally (real request emitted)', () => {
  const VALID_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH']);

  // An in-memory GLANCEvault speaking the same HTTP surface the real server
  // does, driven through proxyFetch's positional (method, url, headers, body)
  // contract. Records every call so the test can assert the arg ORDER.
  function createHttpVault() {
    const salts = new Map();
    const rows = new Map(); // entityId -> { entityId, seq, envelope, deleted }
    let seq = 0;
    const calls = [];
    const json = (status, obj) => ({
      status, ok: status >= 200 && status < 300, statusText: 'OK',
      body: JSON.stringify(obj), headers: { etag: null },
    });
    const notFound = () => ({ status: 404, ok: false, statusText: 'Not Found', body: '', headers: { etag: null } });

    const proxyFetch = async (method, url, headers, body) => {
      calls.push({ method, url, headers, body });
      const u = new URL(url);
      const p = u.pathname;
      const q = u.searchParams;
      let m;
      if ((m = p.match(/^\/salt\/(.+)$/))) {
        const acct = decodeURIComponent(m[1]);
        if (method === 'GET') return salts.has(acct) ? json(200, { salt: salts.get(acct) }) : notFound();
        if (method === 'PUT') { const b = JSON.parse(body); if (!salts.has(acct)) salts.set(acct, b.salt); return json(200, { salt: salts.get(acct) }); }
      }
      if ((m = p.match(/^\/sync\/[^/]+\/batch$/))) {
        const b = JSON.parse(body);
        for (const r of b.rows) rows.set(r.entityId, { entityId: r.entityId, seq: ++seq, envelope: r.envelope, deleted: false });
        return json(200, { written: b.rows.length, maxSeq: seq });
      }
      if ((m = p.match(/^\/sync\/[^/]+\/list$/))) {
        const since = Number(q.get('since') || 0);
        const out = [...rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
        return json(200, { rows: out, hasMore: false });
      }
      if ((m = p.match(/^\/sync\/[^/]+\/device$/))) return json(200, { updated: true });
      if ((m = p.match(/^\/sync\/[^/]+\/(.+)$/))) {
        const entityId = decodeURIComponent(m[1]);
        if (method === 'GET') { const r = rows.get(entityId); return (r && !r.deleted) ? json(200, r) : notFound(); }
        if (method === 'DELETE') { rows.set(entityId, { entityId, seq: ++seq, envelope: null, deleted: true }); return json(200, { seq }); }
      }
      return json(400, { error: `unhandled ${method} ${p}` });
    };
    return { proxyFetch, calls, rows };
  }

  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://glancevault.test', vaultToken: 'tok', accountId: 'acct-electron' });
    setSyncPassphrase('correct horse battery staple');
  });
  afterEach(() => { delete global.window; });

  function makeElectronEngine(vault, initial) {
    let data = clone(initial);
    let nativeKey = null;
    // Mark the shell as Electron and expose the positional proxyFetch the way
    // preload.ts does — but route it into our in-memory HTTP vault.
    global.window = { electronAPI: { isElectron: true, proxyFetch: vault.proxyFetch } };
    const engine = createDbEngine({
      // No vaultClient + no fetchImpl: forces createDbEngine to build the REAL
      // vaultClient over the electron fetchImpl adapter under test.
      storageKeyPrefix: 'electron-dev',
      deviceId: 'device-electron',
      nativeGetSyncKey: () => nativeKey,
      nativeStoreSyncKey: (v) => { nativeKey = v; },
      getData: () => clone(data),
      commitData: (d) => { data = d; },
    });
    return { engine, get data() { return data; } };
  }

  it('emits real, positionally-correct requests to the vault URL (no synthetic 400)', async () => {
    const vault = createHttpVault();
    const dev = makeElectronEngine(vault, { ...EMPTY, tasks: [task(7, '2026-06-18T10:00:00.000Z')] });

    await dev.engine.dbSyncCycle();

    // A real request was emitted (acceptance criterion (a)).
    expect(vault.calls.length).toBeGreaterThan(0);

    // EVERY call used the positional contract: arg 1 is an HTTP method, arg 2 is
    // the full vault URL. Under the old bug arg 1 would be the URL string.
    for (const c of vault.calls) {
      expect(VALID_METHODS.has(c.method)).toBe(true);
      expect(typeof c.url).toBe('string');
      expect(c.url.startsWith('https://glancevault.test/')).toBe(true);
    }

    // The key verifier's single-row GET went out as a real GET (not a 400),
    // and an incremental list was actually requested.
    expect(vault.calls.some((c) => c.method === 'GET' && c.url.includes('__glance_keycheck'))).toBe(true);
    expect(vault.calls.some((c) => c.method === 'GET' && c.url.includes('/list?'))).toBe(true);

    // Bearer auth survived the bridge hop (headers landed in the headers slot,
    // not swallowed by an off-by-one in the arg order).
    expect(vault.calls.every((c) => c.headers && c.headers.Authorization === 'Bearer tok')).toBe(true);
  });

  it('round-trips a task through the HTTP vault and back into a second device', async () => {
    const vault = createHttpVault();
    const A = makeElectronEngine(vault, { ...EMPTY, tasks: [task(42, '2026-06-18T10:00:00.000Z')] });
    await A.engine.dbSyncCycle();

    const B = makeElectronEngine(vault, { ...EMPTY });
    await B.engine.dbSyncCycle();
    await B.engine.dbSyncCycle();

    expect(B.data.tasks.map((t) => t.id)).toContain(42);
  });
});
