import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';
import { mergeSyncData } from '../mergeSync.js';
import { containObsidianGhostRows, persistDerivedGhostRetirements, repairLoadedGhostRows } from '../utils/obsidianGhostRows.js';
import { legacyObsidianId, appIdForBlockId } from '../obsidian.js';

// ─────────────────────────────────────────────────────────────────────────────
// GHOST-ROW CONTAINMENT at the three sync ingresses (the #1454 pattern):
// applyEngineData (modeled in commitData below), the file-tier merge, and the
// DB-tier pull. A ghost — the duplicate an old client mints by parsing a
// stamped line with no block-ref awareness — carries its own successor's id
// inside its mangled title, so current clients derive the retirement from the
// corruption itself and the duplicate stops propagating. CONTAINMENT, NOT
// PREVENTION: the minting device keeps its local duplicate until it updates
// (see utils/obsidianGhostRows.js header).
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
    async deleteRow(app, entityId, accountId, opts = {}) {
      log.set(entityId, { entityId, seq: ++seq, envelope: null, deleted: true, deletedAt: opts.deletedAt });
      return { seq };
    },
    async list(app, { since }) {
      const rows = [...log.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { rows, hasMore: false };
    },
    async device() { return { updated: true }; },
    _row(entityId) { return log.get(entityId) || null; },
    _seq() { return seq; },
  };
}

const FIXTURE_NOW = new Date('2026-08-27T12:00:00.000Z');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  global.localStorage = memLocalStorage();
  setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 't', accountId: 'acct' });
  setSyncPassphrase('correct horse battery staple');
});
afterEach(() => { vi.useRealTimers(); });
afterAll(() => { delete global.localStorage; });

const clone = (x) => JSON.parse(JSON.stringify(x));

const DATE = '2026-08-26';
const BLOCK = 'k3x9q2mf';
const MANGLED = `Buy milk ^dg-${BLOCK}`;
const GHOST_ID = legacyObsidianId(DATE, MANGLED);
const DG_ID = appIdForBlockId(BLOCK);
const T_SUCC = '2026-08-26T11:00:00.000Z';

const ghost = (extra = {}) => ({
  id: GHOST_ID, title: `${MANGLED} #obsidian`, obsidianRawTitle: MANGLED,
  obsidianFileDate: DATE, importSource: 'obsidian',
  completed: false, notes: '', subtasks: [], duration: 30,
  lastModified: '2026-08-26T10:00:00.000Z', ...extra,
});
const successor = (extra = {}) => ({
  id: DG_ID, title: 'Buy milk #obsidian', obsidianRawTitle: 'Buy milk',
  obsidianFileDate: DATE, obsidianBlockId: BLOCK, importSource: 'obsidian',
  completed: false, notes: '', subtasks: [], duration: 30,
  lastModified: T_SUCC, ...extra,
});

const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {}, deletedObsidianKeys: {},
};

// A device whose commitData models the FIXED applyEngineData: ghost
// containment + retirement persistence at the apply boundary.
function makeDevice(name, vault, initial) {
  let data = clone(initial);
  let nativeKey = null;
  const engine = createDbEngine({
    vaultClient: vault,
    storageKeyPrefix: `dev-${name}`,
    deviceId: `device-${name}`,
    nativeGetSyncKey: () => nativeKey,
    nativeStoreSyncKey: (v) => { nativeKey = v; },
    // buildSyncPayload reads the tombstone/retirement bundles from
    // localStorage every build; the harness mirrors that, or the guard could
    // never see retirements the ingresses persisted mid-cycle.
    getData: () => {
      const d = clone(data);
      try { d.retiredTaskIds = JSON.parse(localStorage.getItem('day-planner-retired-task-ids') || '{}'); } catch { d.retiredTaskIds = {}; }
      try { d.deletedTaskIds = { ...d.deletedTaskIds, ...JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}') }; } catch { /* keep seed */ }
      return d;
    },
    commitData: (d) => {
      const contained = containObsidianGhostRows({ tasks: d.tasks, unscheduledTasks: d.unscheduledTasks });
      persistDerivedGhostRetirements(contained.derived);
      data = { ...d, tasks: contained.tasks, unscheduledTasks: contained.unscheduledTasks };
    },
  });
  return { engine, get data() { return data; }, set data(d) { data = d; } };
}

const stateIds = (dev) => dev.data.tasks.map((t) => t.id);

describe('file-tier merge ingress', () => {
  it('a ghost in the remote file is contained when its successor is live — and kept out of the rewritten file', () => {
    const local = { ...EMPTY, tasks: [successor()] };
    const remote = { ...EMPTY, tasks: [successor(), ghost()] }; // old client uploaded the ghost
    const result = mergeSyncData(local, remote, 365);
    expect(result.data.tasks.map((t) => t.id)).toEqual([DG_ID]);
    expect(result.remoteChanged).toBe(true); // the file gets rewritten without the ghost
  });

  it("a NEWER ghost's edit is redirected onto the successor in the merge output", () => {
    const local = { ...EMPTY, tasks: [successor()] };
    const remote = { ...EMPTY, tasks: [successor(), ghost({ completed: true, lastModified: '2026-08-26T12:00:00.000Z' })] };
    const result = mergeSyncData(local, remote, 365);
    expect(result.data.tasks).toHaveLength(1);
    const s = result.data.tasks[0];
    expect(s.id).toBe(DG_ID);
    expect(s.completed).toBe(true);          // the old client's completion survives
    expect(s.title).not.toMatch(/\^dg-/);    // the corruption does not
  });

  it('successor absent → the ghost passes through untouched (conservative fall-through)', () => {
    const local = { ...EMPTY };
    const remote = { ...EMPTY, tasks: [ghost()] };
    const result = mergeSyncData(local, remote, 365);
    expect(result.data.tasks.map((t) => t.id)).toEqual([GHOST_ID]);
  });

  it('a legitimate token-lookalike title is not eaten by the merge', () => {
    const raw = 'Test three ^dg-testtest';
    const lookalike = ghost({ id: legacyObsidianId(DATE, raw), obsidianRawTitle: raw, title: `${raw} #obsidian` });
    const local = { ...EMPTY, tasks: [successor()] };
    const remote = { ...EMPTY, tasks: [successor(), lookalike] };
    const result = mergeSyncData(local, remote, 365);
    expect(result.data.tasks.map((t) => t.id).sort()).toEqual([lookalike.id, DG_ID].sort());
  });
});

describe('DB-tier pull ingress + apply boundary', () => {
  // Simulate the mixed fleet: an "old client" device pushes the ghost row the
  // vault-scan of a stamped line minted (its commitData containment is
  // irrelevant — its DATA already holds the ghost, exactly like a v4.7.0 push).
  async function seedVaultWithGhost(vault, ghostRow) {
    const oldClient = makeDevice('old', vault, { ...EMPTY, tasks: [successor(), ghostRow] });
    // Two cycles: full-seed push, then a pull so its cursor settles.
    await oldClient.engine.dbSyncCycle();
    await oldClient.engine.dbSyncCycle();
    return oldClient;
  }

  it('an OLDER ghost is refused at the pull, its retirement recorded, and the vault ghost row soft-deleted the same cycle', async () => {
    const vault = createMemoryVault();
    await seedVaultWithGhost(vault, ghost());

    const mac = makeDevice('mac', vault, { ...EMPTY, tasks: [successor()] });
    await mac.engine.dbSyncCycle(); // pulls everything the old client pushed
    expect(stateIds(mac)).toEqual([DG_ID]);           // ghost never entered state
    const rec = JSON.parse(localStorage.getItem('day-planner-retired-task-ids'));
    expect(rec[GHOST_ID].successor).toBe(DG_ID);      // derived retirement persisted
    expect(vault._row(`tasks:${GHOST_ID}`).deleted).toBe(true); // echo killed at the source

    // Converged: another cycle changes nothing.
    const seqSettled = vault._seq();
    await mac.engine.dbSyncCycle();
    expect(vault._seq()).toBe(seqSettled);
    expect(stateIds(mac)).toEqual([DG_ID]);
  });

  it("a NEWER ghost passes the pull deliberately: its edit is redirected onto the successor at the apply boundary, then the guard deletes the vault row", async () => {
    const vault = createMemoryVault();
    await seedVaultWithGhost(vault, ghost({ completed: true, lastModified: '2026-08-26T12:00:00.000Z' }));

    const mac = makeDevice('mac', vault, { ...EMPTY, tasks: [successor()] });
    await mac.engine.dbSyncCycle();
    expect(stateIds(mac)).toEqual([DG_ID]);
    const s = mac.data.tasks[0];
    expect(s.completed).toBe(true);                   // the old client's completion survived the redirect
    expect(s.title).not.toMatch(/\^dg-/);
    expect(s.obsidianBlockId).toBe(BLOCK);

    // The mirror carried the ghost this cycle (it passed the pull), so the
    // snapshot holds it while state doesn't: the next cycle's guard finds the
    // persisted retirement and propagates the delete.
    await mac.engine.dbSyncCycle();
    expect(vault._row(`tasks:${GHOST_ID}`).deleted).toBe(true);
    expect(stateIds(mac)).toEqual([DG_ID]);
  });

  it('self-repair at BOOT: the minting device updates and its first LOAD contains its own ghost — no sync required (the local-only case)', () => {
    // loadData runs repairLoadedGhostRows over the persisted lists before
    // setting state, so even an install that never syncs repairs on launch.
    const loaded = repairLoadedGhostRows(
      [successor(), ghost({ completed: true, lastModified: '2026-08-26T12:00:00.000Z' })], [],
    );
    expect(loaded.tasks.map((t) => t.id)).toEqual([DG_ID]);
    expect(loaded.tasks[0].completed).toBe(true);     // the edit made on the ghost survives
    expect(loaded.tasks[0].title).not.toMatch(/\^dg-/);
    const rec = JSON.parse(localStorage.getItem('day-planner-retired-task-ids'));
    expect(rec[GHOST_ID].successor).toBe(DG_ID);
  });

  it('self-repair over SYNC: the upgraded device converges its vault copy too — ghost row deleted, retirement synced out', async () => {
    const vault = createMemoryVault();
    // While old, this device pushed both rows; its state was then boot-repaired.
    await (async () => {
      const asOld = makeDevice('upgraded', vault, {
        ...EMPTY,
        tasks: [successor(), ghost({ completed: true, lastModified: '2026-08-26T12:00:00.000Z' })],
      });
      await asOld.engine.dbSyncCycle(); // pushed while "old" (full-seed)
    })();
    const repaired = repairLoadedGhostRows(
      [successor(), ghost({ completed: true, lastModified: '2026-08-26T12:00:00.000Z' })], [],
    );
    const dev = makeDevice('upgraded', vault, { ...EMPTY, tasks: repaired.tasks });
    await dev.engine.dbSyncCycle(); // snapshot holds the pushed ghost; the guard propagates 'retired'
    await dev.engine.dbSyncCycle();
    expect(vault._row(`tasks:${GHOST_ID}`).deleted).toBe(true);
    expect(stateIds(dev)).toEqual([DG_ID]);
  });
});
