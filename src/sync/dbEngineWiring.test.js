import { describe, it, expect, beforeEach, beforeAll, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
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
