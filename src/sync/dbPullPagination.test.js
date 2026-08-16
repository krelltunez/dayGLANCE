import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// MULTI-PAGE PULL COVERAGE — the first in this repo. Every other sync test's
// mock vault returns its whole backlog in one page (hasMore: false), so
// nothing here-tofore exercised the pagination loop at all, let alone a
// failure inside it.
//
// THE REGRESSION THIS PINS (found in the @glance-apps/sync 1.10.0 survey):
// 1.10.0 persists the pull cursor PER PAGE, assuming an applied row is
// durable when applyRemoteEntity returns. dayGLANCE's wrapper applies pulled
// rows into a per-cycle mirror that is DISCARDED on failure
// (commit-only-on-success), so a pull failing on page 2 would leave the
// cursor advanced past page 1's rows while page 1 was never committed —
// those rows sit below the cursor forever, unreachable by any later
// incremental pull and by the glitch heal. Demonstrated as permanent row
// loss before the wrapper grew its cursor rollback (dbEngine.js dbSyncCycle
// catch); these tests fail without that rollback.
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

// In-memory GLANCEvault that serves list() in pages of `pageSize`, with a
// switch to make the Nth list call throw (the mid-pagination transport
// failure). Mirrors the surface the real vaultClient exposes to the engine.
function createPagedVault({ pageSize = 2 } = {}) {
  const salts = new Map();
  const log = new Map();
  let seq = 0;
  let failListCall = 0; // 0 = never; N = the Nth list() call since arming throws
  let listCalls = 0;
  return {
    async getSalt(accountId) { return salts.get(accountId) || null; },
    async putSalt(accountId, fresh) { if (!salts.has(accountId)) salts.set(accountId, fresh); return salts.get(accountId); },
    async batch(app, { rows }) {
      for (const r of rows) log.set(r.entityId, { entityId: r.entityId, seq: ++seq, envelope: r.envelope, deleted: false });
      return { maxSeq: seq };
    },
    async deleteRow(app, entityId) { log.set(entityId, { entityId, seq: ++seq, envelope: null, deleted: true }); return { seq }; },
    async list(app, { since }) {
      listCalls += 1;
      if (failListCall && listCalls === failListCall) throw new Error('list failed: network blip');
      const all = [...log.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { rows: all.slice(0, pageSize), hasMore: all.length > pageSize };
    },
    async device() { return { updated: true }; },
    armFailure(n) { failListCall = n; listCalls = 0; },
    disarm() { failListCall = 0; listCalls = 0; },
  };
}

const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {},
};
const clone = (x) => JSON.parse(JSON.stringify(x));
const task = (id, lastModified) => ({
  id, title: `task ${id}`, duration: 30, color: 'bg-blue-500', completed: false,
  notes: '', subtasks: [], lastModified, date: '2026-08-16', startTime: '09:00',
});

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

const taskIds = (device) => device.data.tasks.map((t) => t.id).sort();

afterAll(() => { delete global.localStorage; });

describe('multi-page pull: mid-pagination failure must not strand rows below the cursor', () => {
  let vault;
  let seeder;

  beforeEach(async () => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://v', vaultToken: 't', accountId: 'acct' });
    setSyncPassphrase('pagination-test-passphrase');
    vault = createPagedVault({ pageSize: 2 });
    // Seed a two-page backlog (4 rows) from another device.
    seeder = makeDevice('seeder', vault, {
      ...EMPTY,
      tasks: [task('r1', '2026-08-10T10:00:00.000Z'), task('r2', '2026-08-10T10:00:01.000Z'),
              task('r3', '2026-08-10T10:00:02.000Z'), task('r4', '2026-08-10T10:00:03.000Z')],
    });
    await seeder.engine.dbSyncCycle();
  });

  it('a failed cycle leaves the pull cursor where the cycle started', async () => {
    const a = makeDevice('A', vault, EMPTY);
    expect(a.engine.getHighWaterMark()).toBe(0);

    vault.armFailure(2); // page 1 lists fine, page 2's list call throws
    const failed = await a.engine.dbSyncCycle();
    vault.disarm();

    expect(failed.error).toMatch(/network blip/);
    // THE REGRESSION: under 1.10.0 the engine persists the cursor after
    // page 1, so without the wrapper's rollback this reads 2 — past rows
    // that were applied only to the discarded mirror.
    expect(
      a.engine.getHighWaterMark(),
      'cursor advanced past pages the failed cycle never committed - the rollback in dbSyncCycle\'s catch is missing or broken',
    ).toBe(0);
    // Commit-only-on-success: the failed cycle committed nothing.
    expect(taskIds(a)).toEqual([]);
  });

  it('after a mid-pagination failure, one clean cycle converges to ALL rows', async () => {
    const a = makeDevice('A', vault, EMPTY);
    vault.armFailure(2);
    await a.engine.dbSyncCycle();
    vault.disarm();

    await a.engine.dbSyncCycle();
    // Without the rollback this converges to only ['r3', 'r4']: r1/r2 sit
    // below the advanced cursor and no incremental pull ever re-lists them.
    expect(
      taskIds(a),
      'rows consumed by the failed cycle were lost below the cursor (the 1.10.0 per-page persistence hazard)',
    ).toEqual(['r1', 'r2', 'r3', 'r4']);
  });

  it('happy path: a multi-page pull with no failure converges in one cycle and advances the cursor', async () => {
    const a = makeDevice('A', vault, EMPTY);
    const res = await a.engine.dbSyncCycle();
    expect(res.error).toBeUndefined();
    expect(taskIds(a)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(a.engine.getHighWaterMark()).toBeGreaterThan(0);
  });

  it('steady state: a later multi-page backlog with a mid-pagination failure also recovers', async () => {
    // Device A converges first (cursor > 0), THEN a new two-page backlog
    // arrives and its pull fails between pages: the rollback must return the
    // cursor to the pre-cycle value, not to zero, and the retry must converge.
    const a = makeDevice('A', vault, EMPTY);
    await a.engine.dbSyncCycle();
    const settledHwm = a.engine.getHighWaterMark();

    // New rows appear in the seeder's live data; its wrapper's snapshot diff
    // marks them dirty at cycle time (no markDirty needed at write sites).
    const s = seeder.data;
    s.tasks.push(task('r5', '2026-08-11T10:00:00.000Z'), task('r6', '2026-08-11T10:00:01.000Z'), task('r7', '2026-08-11T10:00:02.000Z'));
    await seeder.engine.dbSyncCycle();

    vault.armFailure(2);
    await a.engine.dbSyncCycle();
    vault.disarm();
    expect(a.engine.getHighWaterMark()).toBe(settledHwm);

    await a.engine.dbSyncCycle();
    expect(taskIds(a)).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
  });
});
