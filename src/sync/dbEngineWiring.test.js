import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase, createDbSyncEngine } from '@glance-apps/sync';
import { createDbEngine, resetVaultSyncCursor } from './dbEngine.js';
import { getVaultConfig, setVaultConfig, isVaultEnabled } from './vaultConfig.js';
import { getDeviceId } from './deviceId.js';
import { registerDbEngine, markDirty, schedulePush } from './dirtyTracker.js';
import { tombstoneCutoff } from './tombstoneRetention.js';
import { keepImportedTask } from './payloadExclusions.js';

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
// seq. Mirrors the real vaultClient surface the engine calls. Pass
// { rowGet: true } to also expose the single-row GET the real client has
// (vaultClient.getRow — null on 404/deleted): it enables the engine's key
// verifier AND the wrapper's glitch-skip row re-fetch heal. Off by default so
// the long-standing tests keep their hardcoded seq expectations (the verifier
// writes a keycheck row at seq 1).
function createMemoryVault({ rowGet = false } = {}) {
  const salts = new Map();
  const log = new Map();
  let seq = 0;
  const vault = {
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
  if (rowGet) {
    vault.getRow = async (app, entityId) => {
      const r = log.get(entityId);
      return r && !r.deleted ? { entityId: r.entityId, seq: r.seq, envelope: r.envelope, deleted: false } : null;
    };
  }
  return vault;
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

  it('GUARD: a glitch-vanish is NOT propagated (kept), but a tombstoned delete IS', async () => {
    // Reproduces the incident end-to-end through the REAL cycle: a device's in-memory
    // task list transiently shrinks. Without the guard the diff broadcasts that as a
    // permanent delete and the fleet loses a live, un-deleted task. 700 exercises the
    // glitch path; 701 the genuine-deletion path.
    const vault = createMemoryVault();
    const A = makeDevice('A', vault, {
      ...EMPTY,
      tasks: [task(700, '2026-06-18T10:00:00.000Z'), task(701, '2026-06-18T10:00:00.000Z')],
    });
    const B = makeDevice('B', vault, { ...EMPTY });
    await runRounds(A, B);
    expect(B.data.tasks.map((t) => t.id).sort()).toEqual([700, 701]); // both converged

    // GLITCH: A drops 700 from memory with NO tombstone (a transient shrink).
    A.data.tasks = A.data.tasks.filter((t) => t.id !== 700);
    await runRounds(A, B);
    // The guard skips the un-tombstoned vanish → the deletion does NOT propagate:
    // device B (which never glitched) still holds the live task. No fleet-wide loss.
    // (This vault exposes no getRow, so the row re-fetch heal is unavailable and A
    // stays locally short — the poisoned cycle withholds its snapshot so the row
    // stays in the diff baseline. The heal + snapshot-withholding mechanics are
    // covered in the "glitch shrink" describe below.)
    expect(B.data.tasks.map((t) => t.id)).toContain(700);

    // REAL DELETE: A removes 701 AND records its tombstone (what every delete path
    // does). Now it is a genuine deletion, not a glitch.
    A.data.tasks = A.data.tasks.filter((t) => t.id !== 701);
    A.data.deletedTaskIds = { ...(A.data.deletedTaskIds || {}), 701: '2026-07-08T00:00:00.000Z' };
    await runRounds(A, B);
    // Tombstoned → the delete propagates and sticks; the glitch-kept 700 stays safe.
    expect(B.data.tasks.map((t) => t.id)).not.toContain(701);
    expect(B.data.tasks.map((t) => t.id)).toContain(700);
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

// ─────────────────────────────────────────────────────────────────────────────
// WAVE A (pre-4.0 review) — the three data-loss fixes, end-to-end through the
// REAL engine:
//   1. Merge-aware commit: local writes made DURING a cycle's network window
//      survive the commit and are pushed on the next cycle (commitMerge.js).
//   2. Glitch-shrink poisoned cycle: skipped (un-tombstoned) vanish-deletes
//      withhold the snapshot and are healed by a vault row re-fetch.
//   3. Restore/re-link: resetVaultSyncCursor forces a full LWW pull-merge; a
//      stale restore never pushes over newer vault rows and previously-missed
//      rows reappear.
// ─────────────────────────────────────────────────────────────────────────────
describe('Wave A — merge-aware commit: mid-cycle writes survive and get pushed', () => {
  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct1' });
    setSyncPassphrase('correct horse battery staple');
  });

  // Interleave hook: run `fn` once, from inside the cycle's PULL (vault.list),
  // i.e. after the mirror was cloned but before commit — exactly the network
  // window in which a user write used to be clobbered.
  function onNextPull(vault, fn) {
    const origList = vault.list.bind(vault);
    let fired = false;
    vault.list = async (...args) => {
      if (!fired) { fired = true; fn(); }
      return origList(...args);
    };
    return () => { vault.list = origList; };
  }

  it('a task CREATED and another EDITED during the network window survive the commit AND push next cycle', async () => {
    const vault = createMemoryVault();
    const A = makeDevice('A', vault, { ...EMPTY, tasks: [task(1, '2026-06-18T10:00:00.000Z')] });
    const B = makeDevice('B', vault, { ...EMPTY });
    await runRounds(A, B);

    // B pushes a new row so A's next pull actually applies remote changes —
    // proving the merge path (not just the applied===0 skip-commit shortcut).
    B.data.tasks.push(task(3, '2026-06-18T11:00:00.000Z'));
    await B.engine.dbSyncCycle();

    const restore = onNextPull(vault, () => {
      // Mid-cycle user writes on A: edit task 1, create task 2.
      const t1 = A.data.tasks.find((t) => t.id === 1);
      t1.title = 'edited mid-cycle';
      t1.lastModified = '2026-06-18T12:00:00.000Z';
      A.data.tasks.push(task(2, '2026-06-18T12:00:00.000Z'));
    });
    await A.engine.dbSyncCycle();
    restore();

    // (a) The pull LANDED (task 3 from B) and (b) BOTH mid-cycle writes survived.
    expect(A.data.tasks.map((t) => t.id).sort()).toEqual([1, 2, 3]);
    expect(A.data.tasks.find((t) => t.id === 1).title).toBe('edited mid-cycle');

    // The snapshot contract: the saved snapshot is the VAULT-consistent (pre-merge)
    // state, so the survivors are absent/stale in it — that's what makes them
    // dirty next cycle.
    const snap = JSON.parse(global.localStorage.getItem('dev-A-db-sync-snapshot'));
    expect(snap['tasks:2']).toBeUndefined();
    expect(snap['tasks:1']).not.toContain('edited mid-cycle');

    // (c) Next cycle PUSHES them: B converges on both writes.
    await A.engine.dbSyncCycle();
    await B.engine.dbSyncCycle();
    expect(B.data.tasks.map((t) => t.id).sort()).toEqual([1, 2, 3]);
    expect(B.data.tasks.find((t) => t.id === 1).title).toBe('edited mid-cycle');

    // ...and the snapshot advanced to include them (no perpetual re-push).
    const snap2 = JSON.parse(global.localStorage.getItem('dev-A-db-sync-snapshot'));
    expect(snap2['tasks:2']).toBeDefined();
    expect(snap2['tasks:1']).toContain('edited mid-cycle');
  });

  it('a mid-cycle edit racing a pull of the SAME entity resolves by LWW (both directions)', async () => {
    const vault = createMemoryVault();
    const A = makeDevice('A', vault, { ...EMPTY, tasks: [task(5, '2026-06-18T10:00:00.000Z'), task(6, '2026-06-18T10:00:00.000Z')] });
    const B = makeDevice('B', vault, { ...EMPTY });
    await runRounds(A, B);

    // Direction 1: B's pulled write is NEWER than A's mid-cycle edit → B wins.
    const t5 = B.data.tasks.find((t) => t.id === 5);
    t5.title = 'B newer';
    t5.lastModified = '2026-06-18T13:00:00.000Z';
    await B.engine.dbSyncCycle();
    let restore = onNextPull(vault, () => {
      const mine = A.data.tasks.find((t) => t.id === 5);
      mine.title = 'A older mid-cycle';
      mine.lastModified = '2026-06-18T12:00:00.000Z';
    });
    await A.engine.dbSyncCycle();
    restore();
    expect(A.data.tasks.find((t) => t.id === 5).title).toBe('B newer');

    // Direction 2: A's mid-cycle edit is NEWER than B's pulled write → A wins
    // and A's version reaches B.
    const t6 = B.data.tasks.find((t) => t.id === 6);
    t6.title = 'B older';
    t6.lastModified = '2026-06-18T12:00:00.000Z';
    await B.engine.dbSyncCycle();
    restore = onNextPull(vault, () => {
      const mine = A.data.tasks.find((t) => t.id === 6);
      mine.title = 'A newer mid-cycle';
      mine.lastModified = '2026-06-18T13:00:00.000Z';
    });
    await A.engine.dbSyncCycle();
    restore();
    expect(A.data.tasks.find((t) => t.id === 6).title).toBe('A newer mid-cycle');
    await A.engine.dbSyncCycle(); // pushes the surviving edit
    await B.engine.dbSyncCycle();
    expect(B.data.tasks.find((t) => t.id === 6).title).toBe('A newer mid-cycle');
  });
});

describe('Wave A — glitch shrink: poisoned cycle withholds the snapshot; row re-fetch heals', () => {
  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct1' });
    setSyncPassphrase('correct horse battery staple');
  });

  const snapOf = (name) => JSON.parse(global.localStorage.getItem(`dev-${name}-db-sync-snapshot`) || 'null');
  const deletedIds = (spy) => spy.mock.calls.map((c) => c[1]);

  it('HEAL: a persistent un-tombstoned shrink is recovered by re-fetching the vault row (no delete, no divergence)', async () => {
    const vault = createMemoryVault({ rowGet: true }); // real-client surface: single-row GET available
    const A = makeDevice('A', vault, {
      ...EMPTY,
      tasks: [task(800, '2026-06-18T10:00:00.000Z'), task(801, '2026-06-18T10:00:00.000Z')],
    });
    const B = makeDevice('B', vault, { ...EMPTY });
    await runRounds(A, B);

    const delSpy = vi.spyOn(vault, 'deleteRow');
    // PERSISTENT glitch: 800 vanishes from A's live state with no tombstone and
    // never comes back on its own. Its vault seq sits below A's pull cursor, so
    // only the row re-fetch can recover it.
    A.data.tasks = A.data.tasks.filter((t) => t.id !== 800);
    await A.engine.dbSyncCycle();

    // Recovered: the vault row was re-fetched, re-injected, and committed back.
    expect(A.data.tasks.map((t) => t.id)).toContain(800);
    // No delete was ever pushed for the glitched row.
    expect(deletedIds(delSpy)).not.toContain('tasks:800');
    // The healed cycle is clean → its snapshot WAS saved and still holds the row.
    expect(snapOf('A')['tasks:800']).toBeDefined();
    // Fleet unaffected, and stays converged on subsequent cycles.
    await runRounds(A, B, 2);
    expect(B.data.tasks.map((t) => t.id).sort()).toEqual([800, 801]);
    expect(A.data.tasks.map((t) => t.id).sort()).toEqual([800, 801]);
  });

  it('ABORT-ONLY (no row-get): the poisoned cycle withholds the snapshot; a transient shrink self-heals next cycle', async () => {
    const vault = createMemoryVault(); // no getRow → heal unavailable
    const A = makeDevice('A', vault, {
      ...EMPTY,
      tasks: [task(810, '2026-06-18T10:00:00.000Z'), task(811, '2026-06-18T10:00:00.000Z')],
    });
    const B = makeDevice('B', vault, { ...EMPTY });
    await runRounds(A, B);

    const delSpy = vi.spyOn(vault, 'deleteRow');
    const snapBefore = snapOf('A');
    expect(snapBefore['tasks:810']).toBeDefined();

    // A peer pushes a new row: the poisoned cycle must still LAND pulled
    // changes (the pull advances the HWM past them, so aborting the commit
    // outright would lose them forever — only the SNAPSHOT is withheld).
    B.data.tasks.push(task(812, '2026-06-18T11:00:00.000Z'));
    await B.engine.dbSyncCycle();

    // TRANSIENT glitch: 810 vanishes for one cycle.
    const kept = A.data.tasks.find((t) => t.id === 810);
    A.data.tasks = A.data.tasks.filter((t) => t.id !== 810);
    await A.engine.dbSyncCycle();

    // Poisoned: no delete pushed, snapshot NOT overwritten — the row stays in
    // the diff baseline (had the shrunk snapshot been saved, the row would have
    // silently left the baseline forever). The pulled row still landed.
    expect(deletedIds(delSpy)).not.toContain('tasks:810');
    expect(snapOf('A')['tasks:810']).toBe(snapBefore['tasks:810']);
    expect(A.data.tasks.map((t) => t.id)).toContain(812);

    // The glitch heals (live state regains the identical row) → next cycle is
    // clean against the PRESERVED snapshot: no dirt, no delete, snapshot saved.
    A.data.tasks.push(kept);
    await A.engine.dbSyncCycle();
    expect(deletedIds(delSpy)).not.toContain('tasks:810');
    await runRounds(A, B, 2);
    expect(A.data.tasks.map((t) => t.id).sort()).toEqual([810, 811, 812]);
    expect(B.data.tasks.map((t) => t.id).sort()).toEqual([810, 811, 812]);
  });

  it('STALE TOMBSTONE: a revived task with a lingering tombstone survives a transient shrink (no delete pushed, row heals); a fresh re-delete still propagates', async () => {
    // The revived-task window: delete (tombstone written) → task legitimately
    // comes back with a NEWER lastModified (edit-beats-delete / recycle-bin
    // restore) while the tombstone lingers for up to 60 days. A transient
    // local-state shrink during that window must NOT be blessed by the stale
    // tombstone — that would be a real, fleet-wide deletion of a live task.
    const vault = createMemoryVault({ rowGet: true }); // heal available, as on the real client
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    const A = makeDevice('A', vault, {
      ...EMPTY,
      tasks: [task(900, iso(now - 10 * 86400e3)), task(901, iso(now - 10 * 86400e3))],
    });
    const B = makeDevice('B', vault, { ...EMPTY });
    await runRounds(A, B);
    expect(B.data.tasks.map((t) => t.id).sort()).toEqual([900, 901]);

    // GENUINE DELETE (5 days ago): tombstone + removal → propagates fleet-wide.
    A.data.tasks = A.data.tasks.filter((t) => t.id !== 900);
    A.data.deletedTaskIds = { ...(A.data.deletedTaskIds || {}), 900: iso(now - 5 * 86400e3) };
    await runRounds(A, B);
    expect(B.data.tasks.map((t) => t.id)).toEqual([901]);

    // REVIVED: the task returns with a fresh lastModified; the tombstone lingers.
    A.data.tasks.push(task(900, iso(now - 60e3), { title: 'revived' }));
    await runRounds(A, B);
    expect(B.data.tasks.find((t) => t.id === 900)?.title).toBe('revived');

    const delSpy = vi.spyOn(vault, 'deleteRow');
    // TRANSIENT SHRINK: A's live state drops the revived task with no fingerprint
    // beyond the STALE tombstone.
    A.data.tasks = A.data.tasks.filter((t) => t.id !== 900);
    await A.engine.dbSyncCycle();

    // No delete pushed to the vault, and the row-get heal re-injected the revived
    // row into A's committed state; the clean (healed) cycle saved its snapshot,
    // so the row persists in the diff baseline.
    expect(deletedIds(delSpy)).not.toContain('tasks:900');
    expect(A.data.tasks.find((t) => t.id === 900)?.title).toBe('revived');
    expect(snapOf('A')['tasks:900']).toBeDefined();
    await runRounds(A, B, 2);
    expect(B.data.tasks.find((t) => t.id === 900)?.title).toBe('revived'); // fleet unaffected

    // INVERSE: a genuine RE-DELETE with a FRESH tombstone still soft-deletes.
    A.data.tasks = A.data.tasks.filter((t) => t.id !== 900);
    A.data.deletedTaskIds = { ...(A.data.deletedTaskIds || {}), 900: iso(Date.now()) };
    await runRounds(A, B);
    expect(deletedIds(delSpy)).toContain('tasks:900');
    expect(A.data.tasks.map((t) => t.id)).toEqual([901]);
    expect(B.data.tasks.map((t) => t.id)).toEqual([901]);
  });

  it('ABORT-ONLY persistent shrink never loop-propagates deletes; a REAL tombstoned delete still propagates (idempotently)', async () => {
    const vault = createMemoryVault(); // no getRow
    const A = makeDevice('A', vault, {
      ...EMPTY,
      tasks: [task(820, '2026-06-18T10:00:00.000Z'), task(821, '2026-06-18T10:00:00.000Z')],
    });
    const B = makeDevice('B', vault, { ...EMPTY });
    await runRounds(A, B);

    const delSpy = vi.spyOn(vault, 'deleteRow');
    // 820 glitch-vanishes PERSISTENTLY while 821 is GENUINELY deleted (tombstoned).
    A.data.tasks = A.data.tasks.filter((t) => t.id !== 820 && t.id !== 821);
    A.data.deletedTaskIds = { ...(A.data.deletedTaskIds || {}), 821: '2026-07-08T00:00:00.000Z' };

    // Several poisoned cycles in a row (the snapshot is withheld each time, so
    // the tombstoned delete re-propagates — that re-propagation must stay an
    // idempotent soft-delete and must never drag the glitched row with it).
    for (let i = 0; i < 3; i++) await A.engine.dbSyncCycle();
    const ids = deletedIds(delSpy);
    expect(ids).toContain('tasks:821');       // real delete propagated
    expect(ids).not.toContain('tasks:820');   // glitch NEVER propagated, no loop

    await runRounds(A, B, 2);
    expect(B.data.tasks.map((t) => t.id)).toContain(820);     // fleet kept the glitched row
    expect(B.data.tasks.map((t) => t.id)).not.toContain(821); // real delete stuck
  });
});

describe('Wave A — restore/re-link: resetVaultSyncCursor forces a full LWW pull-merge', () => {
  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct1' });
    setSyncPassphrase('correct horse battery staple');
  });

  it('clears exactly the cursor/baseline keys (default and custom prefix), keeping config + last-synced', () => {
    const cursorKeys = ['snapshot', 'hwm', 'push-ack', 'dirty', 'quarantine'];
    for (const k of cursorKeys) global.localStorage.setItem(`dayglance-vault-db-sync-${k}`, 'stale');
    global.localStorage.setItem('dayglance-vault-db-sync-config', 'keep');
    global.localStorage.setItem('dayglance-vault-db-sync-last-synced', 'keep');
    resetVaultSyncCursor(); // default prefix = the app's engine prefix
    for (const k of cursorKeys) expect(global.localStorage.getItem(`dayglance-vault-db-sync-${k}`)).toBeNull();
    expect(global.localStorage.getItem('dayglance-vault-db-sync-config')).toBe('keep');
    expect(global.localStorage.getItem('dayglance-vault-db-sync-last-synced')).toBe('keep');

    global.localStorage.setItem('dev-X-db-sync-hwm', '42');
    resetVaultSyncCursor('dev-X');
    expect(global.localStorage.getItem('dev-X-db-sync-hwm')).toBeNull();
  });

  it('after a stale restore, the next cycle FULL-pulls: newer vault rows win, missed rows reappear, and the stale copy is never pushed', async () => {
    const vault = createMemoryVault();
    const A = makeDevice('A', vault, { ...EMPTY, tasks: [task(1, '2026-06-18T10:00:00.000Z')] });
    const B = makeDevice('B', vault, { ...EMPTY });
    await runRounds(A, B);

    // The fleet advances past the (future) backup: B edits task 1 and creates
    // task 2; A pulls both, so A's HWM/snapshot now describe the ADVANCED state.
    B.data.tasks = [
      task(1, '2026-06-20T10:00:00.000Z', { title: 'newer from B' }),
      task(2, '2026-06-20T11:00:00.000Z'),
    ];
    await runRounds(A, B);
    expect(A.data.tasks.find((t) => t.id === 1).title).toBe('newer from B');
    expect(A.data.tasks.map((t) => t.id)).toContain(2);

    // A restores an OLD backup: a stale copy of task 1, task 2 missing — a full
    // state replacement. Without a cursor reset, the stale snapshot would diff
    // task 1 as dirty (stale push over B's newer row) and task 2 would sit below
    // the pull HWM forever. The restore paths call resetVaultSyncCursor:
    A.data.tasks = [task(1, '2026-06-18T10:00:00.000Z', { title: 'stale restored copy' })];
    resetVaultSyncCursor('dev-A');

    const batchSpy = vi.spyOn(vault, 'batch');
    await A.engine.dbSyncCycle();
    await A.engine.dbSyncCycle();

    // Full pull re-applied everything: B's newer row won over the restored copy
    // (LWW) and the previously-missed row reappeared.
    expect(A.data.tasks.find((t) => t.id === 1).title).toBe('newer from B');
    expect(A.data.tasks.map((t) => t.id)).toContain(2);

    // The stale copy was NEVER pushed: the full-seed marks it dirty, but the
    // pull (which runs first) sees the vault's newer row win and un-dirties it.
    const pushedIds = batchSpy.mock.calls.flatMap(([, { rows }]) => rows.map((r) => r.entityId));
    expect(pushedIds).not.toContain('tasks:1');

    // And the vault/fleet still holds the newer version.
    await B.engine.dbSyncCycle();
    expect(B.data.tasks.find((t) => t.id === 1).title).toBe('newer from B');
    expect(B.data.tasks.map((t) => t.id)).toContain(2);
  });
});

describe('Wave B — payload-excluded baseline rows (the fresh-device churn loop) + heal load discipline', () => {
  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct1' });
    setSyncPassphrase('correct horse battery staple');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const snapOf = (name) => JSON.parse(global.localStorage.getItem(`dev-${name}-db-sync-snapshot`) || 'null');

  // A device whose getData applies buildSyncPayload's structural exclusions —
  // the current-build analog (makeDevice's unfiltered getData is the old-build
  // analog that put legacy rows into the vault in the first place).
  function makeFilteringDevice(name, vault, initial) {
    let data = clone(initial);
    let nativeKey = null;
    const engine = createDbEngine({
      vaultClient: vault,
      storageKeyPrefix: `dev-${name}`,
      deviceId: `device-${name}`,
      nativeGetSyncKey: () => nativeKey,
      nativeStoreSyncKey: (v) => { nativeKey = v; },
      getData: () => {
        const d = clone(data);
        d.tasks = d.tasks.filter((t) => !t._native && keepImportedTask(t, false));
        d.unscheduledTasks = d.unscheduledTasks.filter((t) => keepImportedTask(t, false));
        return d;
      },
      commitData: (d) => { data = d; },
      isMultiUserEnabled: () => false,
    });
    return { engine, get data() { return data; } };
  }

  it('THE LOOP, end-to-end: a fresh device that full-pulls legacy excluded rows releases them ONCE — no heal fetches, no repeat, vault rows untouched', async () => {
    const vault = createMemoryVault({ rowGet: true });
    // Old-build analog pushes a legacy CalDAV-import row into the vault.
    const legacy = task(900, '2026-06-18T10:00:00.000Z', { imported: true, importSource: 'caldav' });
    const A = makeDevice('A', vault, { ...EMPTY, tasks: [legacy, task(901, '2026-06-18T10:00:00.000Z')] });
    await A.engine.dbSyncCycle();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const getRowSpy = vi.spyOn(vault, 'getRow');
    const delSpy = vi.spyOn(vault, 'deleteRow');

    // Fresh device (cursor 0) with the CURRENT payload exclusions.
    const B = makeFilteringDevice('B', vault, { ...EMPTY });
    await B.engine.dbSyncCycle(); // full pull ingests the legacy row into mirror + snapshot
    expect(snapOf('B')['tasks:900']).toBeDefined();

    await B.engine.dbSyncCycle(); // classification cycle: released from the baseline
    await B.engine.dbSyncCycle(); // must already be clean
    await B.engine.dbSyncCycle(); // and stay clean

    // Released exactly once, then silence — the loop does not repeat.
    const released = infoSpy.mock.calls.filter((c) => String(c[0]).includes('payload-excluded'));
    expect(released).toHaveLength(1);
    // No GUARD skip/recover churn, ever.
    const guardWarns = warnSpy.mock.calls.filter((c) => String(c[0]).includes('GUARD'));
    expect(guardWarns).toEqual([]);
    // The heal never fetched the legacy row — this was the per-row request storm.
    expect(getRowSpy.mock.calls.some((c) => c[1] === 'tasks:900')).toBe(false);
    // Nothing was deleted from the vault; the legacy row is still live for old devices.
    expect(delSpy.mock.calls.map((c) => c[1])).not.toContain('tasks:900');
    expect(await vault.getRow('dayglance', 'tasks:900')).not.toBeNull();
    // The baseline no longer tracks it; the synced row 901 is tracked normally.
    expect(snapOf('B')['tasks:900']).toBeUndefined();
    expect(snapOf('B')['tasks:901']).toBeDefined();
    // And the fleet's normal data converged on B despite the released row.
    expect(B.data.tasks.some((t) => t.id === 901)).toBe(true);
  });

  it('HEAL CAP: a huge glitch shrink recovers at most 40 rows per cycle and converges over following cycles', async () => {
    const vault = createMemoryVault({ rowGet: true });
    const many = [];
    for (let i = 0; i < 50; i++) many.push(task(1000 + i, '2026-06-18T10:00:00.000Z'));
    const A = makeDevice('A', vault, { ...EMPTY, tasks: many });
    await A.engine.dbSyncCycle();
    await A.engine.dbSyncCycle(); // settle the baseline

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getRowSpy = vi.spyOn(vault, 'getRow');

    // PERSISTENT glitch: all 50 vanish from live state, untombstoned.
    A.data.tasks = [];
    await A.engine.dbSyncCycle();
    const taskGets1 = getRowSpy.mock.calls.filter((c) => String(c[1]).startsWith('tasks:')).length;
    expect(taskGets1).toBeLessThanOrEqual(40); // capped — no request storm
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('capped'))).toBe(true);

    await A.engine.dbSyncCycle(); // heals the deferred remainder
    expect(A.data.tasks).toHaveLength(50); // fully recovered, nothing lost
  });

  it('HEAL 429 BAIL: the first rate-limited row-get aborts the rest of the cycle instead of hammering the vault', async () => {
    const vault = createMemoryVault({ rowGet: true });
    const many = [];
    for (let i = 0; i < 12; i++) many.push(task(1100 + i, '2026-06-18T10:00:00.000Z'));
    const A = makeDevice('A', vault, { ...EMPTY, tasks: many });
    await A.engine.dbSyncCycle();
    await A.engine.dbSyncCycle();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const realGetRow = vault.getRow;
    let rateLimitedCalls = 0;
    vault.getRow = async () => {
      rateLimitedCalls++;
      const err = new Error('row get failed: 429');
      err.status = 429;
      throw err;
    };

    A.data.tasks = []; // 12-row untombstoned shrink
    await A.engine.dbSyncCycle();
    expect(rateLimitedCalls).toBe(1); // bailed after the FIRST 429 — not 12 doomed attempts
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('rate-limited'))).toBe(true);

    // Limiter clears → the withheld snapshot retries and fully recovers.
    vault.getRow = realGetRow;
    await A.engine.dbSyncCycle();
    expect(A.data.tasks).toHaveLength(12);
  });
});

describe('Wave C — retention-aged release: the two-tier prune-vs-vault fight (wife\'s-Mac churn)', () => {
  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct1' });
    setSyncPassphrase('correct horse battery staple');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const snapOf = (name) => JSON.parse(global.localStorage.getItem(`dev-${name}-db-sync-snapshot`) || 'null');

  // A device whose getData models the FILE TIER's retention prune: completed
  // tasks that are archived, or completed + older than the retention window,
  // have been aged out of React state (WebDAV/iCloud retention) and so never
  // appear in the payload — while their rows still sit in the vault. This is the
  // exact split-brain behind the observed churn: the file tier removes them, the
  // vault vanish-guard keeps re-fetching them. retentionDays is wired through so
  // the classifier can release the aged-but-unarchived population too.
  function makeRetentionDevice(name, vault, initial, retentionDays = 30) {
    let data = clone(initial);
    let nativeKey = null;
    const nowMs = Date.now();
    const aged = (t) => {
      if (!t.completed) return false;
      if (t.archived) return true;
      const ms = Date.parse(t.completedAt || t.lastModified || '');
      return Number.isFinite(ms) && ms < nowMs - retentionDays * 86400e3;
    };
    const engine = createDbEngine({
      vaultClient: vault,
      storageKeyPrefix: `dev-${name}`,
      deviceId: `device-${name}`,
      nativeGetSyncKey: () => nativeKey,
      nativeStoreSyncKey: (v) => { nativeKey = v; },
      getData: () => {
        const d = clone(data);
        d.tasks = d.tasks.filter((t) => !aged(t));
        d.unscheduledTasks = d.unscheduledTasks.filter((t) => !aged(t));
        return d;
      },
      commitData: (d) => { data = d; },
      isMultiUserEnabled: () => false,
      getSyncRetentionDays: () => retentionDays,
    });
    return { engine, get data() { return data; } };
  }

  it('THE FIGHT ends: completed+archived and completed+aged rows in the baseline are RELEASED once — no heal storm, vault untouched', async () => {
    const vault = createMemoryVault({ rowGet: true });
    // An old/peer device seeds the vault with the two stuck populations plus one
    // live synced task, exactly as the wife's-Mac console showed.
    const archivedInbox = task(500, '2026-04-01T10:00:00.000Z', { completed: true, archived: true });
    const agedScheduled = task(501, '2026-04-02T10:00:00.000Z', {
      completed: true, completedAt: '2026-04-02T10:00:00.000Z', date: '2026-04-02',
    });
    const live = task(502, '2026-06-18T10:00:00.000Z');
    const A = makeDevice('A', vault, {
      ...EMPTY,
      unscheduledTasks: [archivedInbox],
      tasks: [agedScheduled, live],
    });
    await A.engine.dbSyncCycle();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const getRowSpy = vi.spyOn(vault, 'getRow');
    const delSpy = vi.spyOn(vault, 'deleteRow');

    // The retention device full-pulls all three rows into mirror + snapshot, but
    // its payload never lists the two aged ones (the file tier pruned them).
    const B = makeRetentionDevice('B', vault, { ...EMPTY });
    await B.engine.dbSyncCycle(); // full pull ingests all rows into the baseline
    expect(snapOf('B')['unscheduledTasks:500']).toBeDefined();
    expect(snapOf('B')['tasks:501']).toBeDefined();

    await B.engine.dbSyncCycle(); // classification cycle: both aged rows released
    await B.engine.dbSyncCycle(); // must already be clean
    await B.engine.dbSyncCycle(); // and STAY clean — no re-fight

    // Released as retention-aged exactly once, then silence.
    const released = infoSpy.mock.calls.filter((c) => String(c[0]).includes('retention-aged'));
    expect(released).toHaveLength(1);
    // No GUARD skip/recover churn — this was the endless stream of GUARD messages.
    expect(warnSpy.mock.calls.filter((c) => String(c[0]).includes('GUARD'))).toEqual([]);
    // The heal NEVER fetched the aged rows — that per-row storm is what pinned
    // the inbox count and rate-limited the vault.
    expect(getRowSpy.mock.calls.some((c) => c[1] === 'unscheduledTasks:500')).toBe(false);
    expect(getRowSpy.mock.calls.some((c) => c[1] === 'tasks:501')).toBe(false);
    // NOTHING was deleted from the vault — the rows survive for other devices
    // (this is the "deletes nothing" guarantee of the guard-side release).
    const deleted = delSpy.mock.calls.map((c) => c[1]);
    expect(deleted).not.toContain('unscheduledTasks:500');
    expect(deleted).not.toContain('tasks:501');
    expect(await vault.getRow('dayglance', 'unscheduledTasks:500')).not.toBeNull();
    expect(await vault.getRow('dayglance', 'tasks:501')).not.toBeNull();
    // The baseline stops tracking the aged rows; the live synced row is unaffected.
    expect(snapOf('B')['unscheduledTasks:500']).toBeUndefined();
    expect(snapOf('B')['tasks:501']).toBeUndefined();
    expect(snapOf('B')['tasks:502']).toBeDefined();
    expect(B.data.tasks.some((t) => t.id === 502)).toBe(true);
  });

  it('CONTRAST: an ACTIVE (not-completed) task that transiently vanishes is NOT released — it still heals', async () => {
    // The release is completion-gated: a live task that briefly drops out of
    // getData must never be swept up as "retention-aged" — it heals as before.
    const vault = createMemoryVault({ rowGet: true });
    const A = makeDevice('A', vault, {
      ...EMPTY,
      tasks: [task(600, '2026-04-01T10:00:00.000Z'), task(601, '2026-06-18T10:00:00.000Z')],
    });
    const B = makeRetentionDevice('B', vault, { ...EMPTY });
    await runRounds(A, B);
    expect(B.data.tasks.map((t) => t.id).sort()).toEqual([600, 601]);

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const getRowSpy = vi.spyOn(vault, 'getRow');
    // 600 is OLD but NOT completed → the retention filter does not drop it; force
    // a transient shrink on A instead and confirm it heals (not released).
    A.data.tasks = A.data.tasks.filter((t) => t.id !== 600);
    await A.engine.dbSyncCycle();
    expect(getRowSpy.mock.calls.some((c) => c[1] === 'tasks:600')).toBe(true); // healed, not released
    expect(infoSpy.mock.calls.filter((c) => String(c[0]).includes('retention-aged'))).toEqual([]);
    expect(A.data.tasks.map((t) => t.id)).toContain(600);
  });
});

describe('issue #1196 — the midnight rollover speaks the vanish-delete guard\'s language', () => {
  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct1' });
    setSyncPassphrase('correct horse battery staple');
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const routine = (id, lastModified) => ({
    id, name: `routine ${id}`, bucket: 'everyday', startTime: '08:00',
    duration: 15, isAllDay: false, lastModified,
  });

  it('a midnight clear WITH removal tombstones propagates real deletes — no guard skip, no heal, no resurrection', async () => {
    const vault = createMemoryVault({ rowGet: true });
    const A = makeDevice('A', vault, {
      ...EMPTY,
      todayRoutines: [routine('chipA', '2026-06-18T10:00:00.000Z'), routine('chipB', '2026-06-18T21:00:00.000Z')],
      routinesDate: '2026-06-18',
      removedTodayRoutineIds: {},
    });
    await A.engine.dbSyncCycle();
    await A.engine.dbSyncCycle(); // settle the baseline

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const getRowSpy = vi.spyOn(vault, 'getRow');

    // What useRoutines' FIXED rollover effect now writes at day change: rows
    // cleared, removal tombstones stamped at local midnight of the new day.
    const midnightIso = '2026-06-19T00:00:00.000Z';
    A.data.removedTodayRoutineIds = { chipA: midnightIso, chipB: midnightIso };
    A.data.todayRoutines = [];
    A.data.routinesDate = '2026-06-19';
    await A.engine.dbSyncCycle();

    // Tombstone-authorized: no glitch classification, so no skip and no per-row
    // heal fetches — the resurrection mechanics never engage.
    expect(warnSpy.mock.calls.filter((c) => String(c[0]).includes('GUARD'))).toEqual([]);
    expect(getRowSpy.mock.calls.some((c) => String(c[1]).startsWith('todayRoutines:'))).toBe(false);
    // The vault rows are genuinely deleted (memory vault getRow → null when deleted).
    expect(await vault.getRow('dayglance', 'todayRoutines:chipA')).toBeNull();
    expect(await vault.getRow('dayglance', 'todayRoutines:chipB')).toBeNull();

    // And they STAY gone across further cycles — yesterday's routines do not
    // reappear on today's timeline.
    await A.engine.dbSyncCycle();
    await A.engine.dbSyncCycle();
    expect(A.data.todayRoutines).toEqual([]);
    const snap = JSON.parse(global.localStorage.getItem('dev-A-db-sync-snapshot') || '{}');
    expect(snap['todayRoutines:chipA']).toBeUndefined();
  });

  it('CONTROL (the pre-fix bug): a bare clear with a WIPED tombstone map is skipped by the guard and resurrected by the heal', async () => {
    const vault = createMemoryVault({ rowGet: true });
    const A = makeDevice('A', vault, {
      ...EMPTY,
      todayRoutines: [routine('chipA', '2026-06-18T10:00:00.000Z')],
      routinesDate: '2026-06-18',
      removedTodayRoutineIds: {},
    });
    await A.engine.dbSyncCycle();
    await A.engine.dbSyncCycle();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // The OLD rollover: rows cleared, tombstone map wiped — no removal signal.
    A.data.todayRoutines = [];
    A.data.routinesDate = '2026-06-19';
    await A.engine.dbSyncCycle();

    // Guard skips the un-tombstoned vanish and the heal resurrects the row —
    // this is the reported symptom, pinned here so the fix's contract is clear.
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('GUARD'))).toBe(true);
    expect(A.data.todayRoutines.map((r) => r.id)).toContain('chipA');
  });
});
