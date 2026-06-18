import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase, createDbSyncEngine } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { getVaultConfig, setVaultConfig, isVaultEnabled } from './vaultConfig.js';
import { getDeviceId } from './deviceId.js';
import { registerDbEngine, markDirty, schedulePush } from './dirtyTracker.js';

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
