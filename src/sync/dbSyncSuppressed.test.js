import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { credentialHaltKey } from '@glance-apps/sync/src/dbEngine.js';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// @glance-apps/sync 2.0.0 ADOPTION — per-half suppression (ruling 1) and the
// credential-halt exit (ruling 4).
//
// Since 4a, the package's primitives refuse to run while their direction's
// backoff window is open, throwing a typed SYNC_SUPPRESSED BEFORE any
// network call. That throw is a pause the package already scheduled, not a
// new failure — so dayGLANCE's composed cycle must not escalate its own
// brake on it, and must not roll the cursor back for a call that ran
// nothing. But the two halves are NOT symmetric, and the asymmetry is the
// bug this suite exists to guard (it was nearly specified):
//
//   PULL suppressed → nothing ran. Early return: no rollback, no strike.
//   PUSH suppressed → the pull SUCCEEDED and, under 'end-of-pull', already
//     persisted its cursor. The pulled mirror is good data; the cycle must
//     CONTINUE to commit it — a blanket abort that also skipped the
//     rollback would discard the mirror with the cursor past its rows:
//     permanent row loss. No strike; the dirty set is untouched and pushes
//     when the window lifts.
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

const throw429 = () => { const e = new Error('429: rate limited'); e.status = 429; throw e; };

const FIXTURE_NOW = new Date('2026-08-16T12:00:00.000Z');
const atOffset = (ms) => new Date(FIXTURE_NOW.getTime() + ms);

let warnSpy;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  global.localStorage = memLocalStorage();
  setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 't', accountId: 'acct' });
  setSyncPassphrase('correct horse battery staple');
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); vi.useRealTimers(); });
afterAll(() => { delete global.localStorage; });

const clone = (x) => JSON.parse(JSON.stringify(x));
const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {},
};
const task = (id, lastModified) => ({
  id, title: `task ${id}`, duration: 30, color: 'bg-blue-500', completed: false,
  notes: '', subtasks: [], lastModified, date: '2026-08-16', startTime: '09:00',
});

// A device with a SPYING local breaker (always-open gate, so what reaches
// onFailure is exactly what the cycle chose to report as a failure) and
// captured retry timers.
function makeDevice(name, vault, initial) {
  let data = clone(initial);
  let nativeKey = null;
  const onFailure = vi.fn(() => 0);
  const onSuccess = vi.fn();
  const statuses = [];
  const armed = [];
  const engine = createDbEngine({
    vaultClient: vault,
    storageKeyPrefix: `dev-${name}`,
    deviceId: `device-${name}`,
    nativeGetSyncKey: () => nativeKey,
    nativeStoreSyncKey: (v) => { nativeKey = v; },
    getData: () => clone(data),
    commitData: (d) => { data = d; },
    onStatusChange: (s) => statuses.push(s),
    cycleBreaker: { beforeCycle: () => ({ allowed: true }), onSuccess, onFailure },
    retryTimers: {
      setTimeoutFn: (fn, ms) => { armed.push({ fn, ms }); return armed[armed.length - 1]; },
      clearTimeoutFn: () => {},
    },
  });
  return { engine, onFailure, onSuccess, statuses, armed, get data() { return data; }, set data(d) { data = d; } };
}

describe('ruling 1 — pull suppressed: early return, no rollback, no strike', () => {
  it('a SYNC_SUPPRESSED pull is a pause, not a failure: no onFailure, no error status, cursor untouched, retry armed to the window', async () => {
    const vault = createMemoryVault();
    const seeder = makeDevice('seeder', vault, { ...EMPTY, tasks: [task('r1', '2026-08-10T10:00:00.000Z')] });
    await seeder.engine.dbSyncCycle();

    const a = makeDevice('A', vault, EMPTY);
    // Open the package's pull window with one REAL 429.
    const realList = vault.list;
    vault.list = throw429;
    const failed = await a.engine.dbSyncCycle();
    vault.list = realList;
    expect(failed.error).toMatch(/429/);
    expect(a.onFailure).toHaveBeenCalledTimes(1); // the real failure strikes
    const hwmAfterFailure = a.engine.getHighWaterMark();

    // 5s later — inside the package's 30s pull window — a trigger arrives.
    vi.setSystemTime(atOffset(5000));
    const statusCountBefore = a.statuses.length; // the real failure above legitimately logged 'error'
    const res = await a.engine.dbSyncCycle();

    expect(res.suppressed).toBe(true);
    expect(res.direction).toBe('pull');
    expect(res.retryPending).toBe(true);
    // NOT a failure: no second strike, and the suppressed cycle itself never
    // paints the 'error' status (the earlier REAL failure rightly did).
    expect(a.onFailure).toHaveBeenCalledTimes(1);
    expect(a.statuses.slice(statusCountBefore)).not.toContain('error');
    // Nothing ran, so nothing moved and nothing was rolled back.
    expect(a.engine.getHighWaterMark()).toBe(hwmAfterFailure);
    // The trigger is preserved, aligned to the package window's remainder
    // (30000 − 5000, + the 250ms pad).
    const pending = a.armed[a.armed.length - 1];
    expect(pending.ms).toBe(25250);

    // Past the window, the retry converges — the pause cost nothing.
    vi.setSystemTime(atOffset(31000));
    await a.engine.dbSyncCycle();
    expect(a.data.tasks.map((t) => t.id)).toEqual(['r1']);
  });
});

describe('ruling 1 — push suppressed: skip the push, COMMIT the pull (the case the blanket shape would have lost)', () => {
  it('pull succeeds, push is window-suppressed → pulled rows COMMIT, cursor advance stands, no strike, dirty rows land after the window', async () => {
    const vault = createMemoryVault();
    const seeder = makeDevice('seeder', vault, { ...EMPTY, tasks: [task('r1', '2026-08-10T10:00:00.000Z')] });
    await seeder.engine.dbSyncCycle();

    // Device A has a LOCAL task to push and remote rows to pull.
    const a = makeDevice('A', vault, { ...EMPTY, tasks: [task('local1', '2026-08-12T10:00:00.000Z')] });

    // Open the package's PUSH window only: one cycle where the pull works
    // but the batch 429s (a real failure — strike + rollback, unchanged).
    const realBatch = vault.batch;
    vault.batch = throw429;
    const failed = await a.engine.dbSyncCycle();
    vault.batch = realBatch;
    expect(failed.error).toMatch(/429/);
    expect(a.onFailure).toHaveBeenCalledTimes(1);
    expect(a.engine.getHighWaterMark()).toBe(0); // real failure still rolls back

    // 5s later — pull window closed (the pull never failed), push window
    // open for another 25s — a trigger arrives.
    vi.setSystemTime(atOffset(5000));
    const res = await a.engine.dbSyncCycle();

    // THE PIN: the pulled mirror COMMITTED (r1 is live alongside local1)...
    expect(a.data.tasks.map((t) => t.id).sort()).toEqual(['local1', 'r1']);
    // ...and the pull's cursor advance STANDS — no rollback. A blanket
    // early return (or a blanket failure path) would have left r1 stranded
    // below an advanced cursor in a discarded mirror.
    expect(a.engine.getHighWaterMark()).toBeGreaterThan(0);
    // The suppressed push is a skip, not a failure: no second strike.
    expect(a.onFailure).toHaveBeenCalledTimes(1);
    expect(res.pushSuppressed).toBe(true);
    expect(res.retryPending).toBe(true);
    // The trigger for the owed push half is armed to the window's remainder.
    expect(a.armed[a.armed.length - 1].ms).toBe(25250);
    // And local1 has NOT reached the vault yet — nothing was acked.
    expect(seeder.data.tasks.map((t) => t.id)).toEqual(['r1']);

    // Past the push window: the dirty set (untouched by the suppression)
    // pushes, and the fleet converges.
    vi.setSystemTime(atOffset(31000));
    await a.engine.dbSyncCycle();
    await seeder.engine.dbSyncCycle();
    expect(seeder.data.tasks.map((t) => t.id).sort()).toEqual(['local1', 'r1']);
  });
});

describe('ruling 4 — the credential-halt exit (minimal version)', () => {
  const HALT_KEY = credentialHaltKey('dayglance-vault');

  it('saving CHANGED vault credentials clears a persisted halt (fresh credentials are a fresh chance)', () => {
    localStorage.setItem(HALT_KEY, JSON.stringify({ message: 'credential rejected', at: FIXTURE_NOW.toISOString() }));
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'BRAND-NEW-TOKEN', accountId: 'acct' });
    expect(localStorage.getItem(HALT_KEY)).toBe(null);
  });

  it('re-saving UNCHANGED credentials (e.g. toggling enabled) leaves the halt in place', () => {
    localStorage.setItem(HALT_KEY, JSON.stringify({ message: 'credential rejected', at: FIXTURE_NOW.toISOString() }));
    setVaultConfig({ enabled: false, vaultUrl: 'https://vault.test', vaultToken: 't', accountId: 'acct' });
    expect(localStorage.getItem(HALT_KEY)).not.toBe(null);
  });
});
