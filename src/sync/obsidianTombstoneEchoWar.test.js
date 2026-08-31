import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { __resetRetirementHealBreakerForTests } from './retirementHealBreaker.js';
import { setVaultConfig } from './vaultConfig.js';
import { rescueUnsyncedTasks } from '../utils/rescueUnsyncedTasks.js';
import { mergeObsidianTasks } from '../utils/mergeObsidianTasks.js';
import { mergeObsidianDailyNotes } from '../utils/mergeObsidianDailyNotes.js';
import { dropTombstonedObsidianTasks, dropTombstonedObsidianNotes } from '../utils/obsidianDeletions.js';
import { mergeSyncData } from '../mergeSync.js';

// ─────────────────────────────────────────────────────────────────────────────
// THE TOMBSTONE ECHO WAR — reproduction of the 2026-08-26 log, now pinning the
// FIX: symmetric enforcement of deletedObsidianKeys at the apply boundary.
//
// THE WAR (as captured live): three rows — one legacy Obsidian task, two daily
// notes — cycled pull-DELETE → snapshot-diff-new → push written:3 → "honored
// deletes: Array(3)" → propagate, ~12 successful rounds, counts oscillating
// 577/576 and 48/46. The mechanism: the rows carried deletion tombstones newer
// than their lastModified, and the channel was HONORED ON THE WAY OUT BUT
// IGNORED ON THE WAY IN — every deleting path consulted it (the vault-scan
// merges, rescue, the commit merge's honored-delete blessing, the push guard's
// 'tombstoned' propagation) while no applying path did (applyEngineData
// admitted pulled rows unfiltered and replaced dailyNotes wholesale; the
// file-tier merge unioned tombstoned rows back from the remote file — issue
// #1448, the same asymmetry's file-tier face). Add the commit-visibility lag
// (React's flush racing back-to-back SSE drains) and the device fought its own
// echo: stale state re-pushed the rows the vault just deleted, the flushed
// state re-propagated blessed deletes, each push seeding the opposite half a
// cycle later. Every cycle SUCCEEDED, so no failure-armed brake engaged.
//
// THE FIX (utils/obsidianDeletions.js — dropTombstonedObsidianTasks/Notes, one
// shared gate for BOTH tiers): applyEngineData filters the merged task lists
// and gates the dailyNotes apply, and mergeSyncData cleanses its merge output
// (which is also the uploaded file — closing #1448 and the day-61 resurrection
// a dirty file would cause when tombstones GC). Same LWW as the scan merge:
// revive-preserving — a copy whose lastModified beats its tombstone passes and
// propagates. The echo is refused, the first blessed delete sticks, and the
// war collapses in one round.
//
// HARNESS: real @glance-apps/sync engine + real crypto over the in-memory
// vault. The device models React's commit-visibility lag explicitly
// (pending/flush). commitData models the FIXED applyEngineData: merged tasks
// through the apply-boundary gate + real tombstone-gated rescue; dailyNotes
// replace through the same gate. The scan step is the REAL merge functions
// fed the localStorage tombstones, exactly as useObsidianSync feeds them.
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

const FIXTURE_NOW = new Date('2026-08-26T19:00:00.000Z');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  global.localStorage = memLocalStorage();
  setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 't', accountId: 'acct' });
  setSyncPassphrase('correct horse battery staple');
  // The delete-propagation latch is module state and this file both FREEZES
  // the clock (its 10-minute window never expires) and reuses the same war
  // ids across tests — without a reset, deletes propagated in earlier tests
  // count toward later tests' streaks.
  __resetRetirementHealBreakerForTests();
});
afterEach(() => { vi.useRealTimers(); });
afterAll(() => { delete global.localStorage; });

const clone = (x) => JSON.parse(JSON.stringify(x));

const TASK_ID = 'obsidian-2026-04-27-3a979k';
const NOTE_A = '2026-08-10';
const NOTE_B = '2026-08-11';
const T_OLD = '2026-08-12T10:00:00.000Z';
const T_TOMB = '2026-08-20T10:00:00.000Z';

const warTask = (lastModified = T_OLD) => ({
  id: TASK_ID,
  title: 'Check in with Jake #obsidian',
  duration: 30, color: 'bg-purple-600', completed: true, notes: '', subtasks: [],
  importSource: 'obsidian', obsidianRawTitle: 'Check in with Jake', obsidianFileDate: '2026-04-27',
  lastModified,
});
const warNote = (lastModified = T_OLD, text = '## Quick Notes\n- Testing on Windows') =>
  ({ text, lastModified, fromObsidian: true });

const TOMBSTONES = { [TASK_ID]: T_TOMB, [NOTE_A]: T_TOMB, [NOTE_B]: T_TOMB };

const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {}, deletedObsidianKeys: {},
};

// A device with EXPLICIT commit-visibility lag (the React-flush stand-in):
// getData reads `visible`; commitData computes the applyEngineData model into
// `pending`; flush() promotes it. `flushOnPush` promotes the previous pending
// right after a vault write lands — the mid-cycle render flush that produced
// the log's "honored deletes: Array(3)".
function makeLaggedDevice(name, vault, initial, { flushOnPush = false, engineOverrides = {} } = {}) {
  let visible = clone(initial);
  let pending = null;
  const dev = {
    flush() { if (pending) { visible = pending; pending = null; } },
    get visible() { return visible; },
    set visible(v) { visible = v; },
    get pending() { return pending; },
  };
  const realBatch = vault.batch.bind(vault);
  const realDelete = vault.deleteRow.bind(vault);
  const wrappedVault = Object.create(vault);
  wrappedVault.batch = async (...a) => { const r = await realBatch(...a); if (flushOnPush) dev.flush(); return r; };
  wrappedVault.deleteRow = async (...a) => { const r = await realDelete(...a); if (flushOnPush) dev.flush(); return r; };
  dev.engine = createDbEngine({
    vaultClient: wrappedVault,
    storageKeyPrefix: `dev-${name}`,
    deviceId: `device-${name}`,
    nativeGetSyncKey: () => dev._key ?? null,
    nativeStoreSyncKey: (v) => { dev._key = v; },
    ...engineOverrides,
    getData: () => clone(visible),
    commitData: (d) => {
      const tombs = d.deletedObsidianKeys || {};
      const prevTasks = visible.tasks;
      pending = {
        ...d,
        // The FIXED applyEngineData: the apply-boundary gate on the merged
        // list, then the (real, already tombstone-gated) rescue of prev-only
        // rows, and the same gate on the notes replace.
        tasks: rescueUnsyncedTasks(
          dropTombstonedObsidianTasks(d.tasks, tombs),
          prevTasks, d.deletedTaskIds || {}, undefined, tombs,
        ),
        dailyNotes: dropTombstonedObsidianNotes(d.dailyNotes, tombs),
      };
    },
  });
  return dev;
}

// The REAL vault-scan merge step, fed exactly what useObsidianSync feeds it.
function runVaultScan(dev, { scannedNotes = {} } = {}) {
  let tombstones = {};
  try { tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-obsidian-keys') || '{}'); } catch { tombstones = {}; }
  dev.visible = {
    ...dev.visible,
    tasks: mergeObsidianTasks(dev.visible.tasks, [], new Set(), () => ({}), tombstones),
    dailyNotes: mergeObsidianDailyNotes(dev.visible.dailyNotes, scannedNotes, tombstones),
  };
}

const warIds = [`tasks:${TASK_ID}`, `dailyNotes:${NOTE_A}`, `dailyNotes:${NOTE_B}`];
const hasWarRows = (data) =>
  data.tasks.some((t) => t.id === TASK_ID) && !!data.dailyNotes[NOTE_A] && !!data.dailyNotes[NOTE_B];

// Seed, HISTORICALLY: the rows exist and sync everywhere FIRST (no tombstones
// yet — two cycles so the engine leaves the HWM=0 full-seed path and consumes
// its own seed rows), and only THEN are the tombstones written (the detector
// firing / the bundle syncing in). That is the field pre-state: state and
// vault holding tombstoned-and-older copies. Seeding the other way around is
// impossible post-fix — the gated apply strips the rows during seeding, which
// is the fix itself working.
async function seedWar(vault, opts = {}) {
  const dev = makeLaggedDevice('mac', vault, {
    ...EMPTY,
    tasks: [warTask()],
    dailyNotes: { [NOTE_A]: warNote(), [NOTE_B]: warNote(T_OLD, '## Quick Notes\n## Thoughts') },
  }, opts);
  await dev.engine.dbSyncCycle();
  await dev.engine.dbSyncCycle();
  dev.flush();
  localStorage.setItem('day-planner-deleted-obsidian-keys', JSON.stringify(TOMBSTONES));
  dev.visible = { ...dev.visible, deletedObsidianKeys: TOMBSTONES };
  expect(hasWarRows(dev.visible)).toBe(true);
  return dev;
}

describe('the echo war — FIXED by symmetric enforcement at the apply boundary', () => {
  it("the log's round anatomy now collapses: pull-DELETE supersedes → stale re-push resurrects once → the echo is REFUSED → the deletes stick and the vault converges dead", async () => {
    const vault = createMemoryVault();
    const dev = await seedWar(vault, { flushOnPush: true });

    // Mid-war pre-state, as in the log: the vault's latest rows are DELETES
    // (a previous round's blessed propagation), the snapshot lacks them, but
    // visible state still HAS them (the flush lagged).
    for (const id of warIds) await vault.deleteRow('dayglance', id, 'acct', { deletedAt: new Date(T_TOMB).getTime() });
    const snapKey = 'dev-mac-db-sync-snapshot';
    const snap = JSON.parse(localStorage.getItem(snapKey));
    for (const id of warIds) delete snap[id];
    localStorage.setItem(snapKey, JSON.stringify(snap));

    // ROUND A (log: "[pull] DELETE ×3 … did NOT write"): the pulled deletes
    // supersede the dirty marks; no war-row is written (the one legitimate
    // write this cycle is the freshly-grown deletedObsidianKeys bundle
    // syncing out); the commit carries the deletions into `pending` while
    // visible state still shows the rows.
    const rowSeqsA0 = warIds.map((id) => vault._row(id).seq);
    const resA = await dev.engine.dbSyncCycle();
    expect(resA.error).toBeUndefined();
    expect(warIds.map((id) => vault._row(id).seq)).toEqual(rowSeqsA0); // war rows untouched
    expect(hasWarRows(dev.visible)).toBe(true);

    // ROUND B (log: "written:3 … honored deletes: Array(3)"): the still-stale
    // state re-pushes the rows — the ONE resurrection the visibility lag can
    // still cause — and the mid-cycle flush lets the commit merge honor the
    // blessed deletes.
    const resB = await dev.engine.dbSyncCycle();
    expect(resB.error).toBeUndefined();
    for (const id of warIds) expect(vault._row(id).deleted).toBe(false); // resurrected once
    expect(hasWarRows(dev.pending ?? dev.visible)).toBe(false);

    // ROUND C — where the war used to re-arm: the pull echoes round B's
    // upserts into the mirror, but the apply-boundary gate REFUSES them
    // (tombstone ≥ lastModified). State stays clean.
    dev.flush();
    expect(hasWarRows(dev.visible)).toBe(false);
    const resC = await dev.engine.dbSyncCycle();
    expect(resC.error).toBeUndefined();
    dev.flush();
    expect(hasWarRows(dev.visible)).toBe(false); // the echo did NOT re-enter state

    // ROUND D: the snapshot vanish propagates as blessed deletes, the vault
    // converges dead, and further cycles write nothing.
    await dev.engine.dbSyncCycle();
    dev.flush();
    for (const id of warIds) expect(vault._row(id).deleted).toBe(true);
    const settledSeq = vault._seq();
    await dev.engine.dbSyncCycle();
    dev.flush();
    expect(vault._seq()).toBe(settledSeq);
    expect(hasWarRows(dev.visible)).toBe(false);
  });

  it('the eviction sticks: a pulled echo of a tombstoned-and-older row does not re-enter state (the former it.fails, flipped)', async () => {
    const vault = createMemoryVault();
    const dev = await seedWar(vault);

    runVaultScan(dev);
    expect(hasWarRows(dev.visible)).toBe(false);
    await dev.engine.dbSyncCycle();
    dev.flush();
    // CORRECT (now true): the echo is refused and the rows stay gone…
    expect(hasWarRows(dev.visible)).toBe(false);
    // …so the next cycle propagates clean deletes and the vault converges dead.
    await dev.engine.dbSyncCycle();
    dev.flush();
    for (const id of warIds) expect(vault._row(id).deleted).toBe(true);
  });

  it('the orphan case in isolation: a tombstoned task with NO scannable file (outside the import window) converges through the gate alone — no self-heal needed', async () => {
    // The April task's shape, alone: nothing can ever refresh its lastModified
    // (its daily note is outside the 90-day scan window), so before the fix it
    // had NO self-heal path and would loop until its tombstone's 60-day GC.
    // The fix must converge it on its own — not carried by healable rows.
    const vault = createMemoryVault();
    const dev = makeLaggedDevice('solo', vault, {
      ...EMPTY,
      tasks: [warTask()],
    });
    await dev.engine.dbSyncCycle();
    await dev.engine.dbSyncCycle();
    dev.flush();
    // The tombstone arrives AFTER the row is everywhere (historical order).
    localStorage.setItem('day-planner-deleted-obsidian-keys', JSON.stringify({ [TASK_ID]: T_TOMB }));
    dev.visible = { ...dev.visible, deletedObsidianKeys: { [TASK_ID]: T_TOMB } };

    runVaultScan(dev); // the scan-merge drops it (tombstone ≥ lastModified)
    expect(dev.visible.tasks.some((t) => t.id === TASK_ID)).toBe(false);

    await dev.engine.dbSyncCycle(); // echo refused at the apply boundary
    dev.flush();
    expect(dev.visible.tasks.some((t) => t.id === TASK_ID)).toBe(false);

    await dev.engine.dbSyncCycle(); // blessed delete propagates
    dev.flush();
    expect(vault._row(`tasks:${TASK_ID}`).deleted).toBe(true);

    const settledSeq = vault._seq();
    for (let round = 0; round < 3; round++) { // stays converged, no loop, no writes
      runVaultScan(dev);
      const res = await dev.engine.dbSyncCycle();
      expect(res.error).toBeUndefined();
      dev.flush();
    }
    expect(vault._seq()).toBe(settledSeq);
    expect(dev.visible.tasks.some((t) => t.id === TASK_ID)).toBe(false);
  });

  it('legitimate restore: a copy whose lastModified beats its tombstone by even a small margin passes the gate, survives every merge, and syncs fleet-wide', async () => {
    const vault = createMemoryVault();
    const dev = await seedWar(vault);

    // Converge the war first: the old copies die.
    runVaultScan(dev);
    await dev.engine.dbSyncCycle();
    await dev.engine.dbSyncCycle();
    dev.flush();
    for (const id of warIds) expect(vault._row(id).deleted).toBe(true);

    // A peer restores the task and re-creates one note — lastModified beats
    // the tombstone by ONE SECOND. That must be enough: the LWW has no margin
    // in the restore direction (strictly-newer wins).
    const T_RESTORE = '2026-08-20T10:00:01.000Z'; // T_TOMB + 1s
    const peer = makeLaggedDevice('peer', vault, {
      ...EMPTY,
      tasks: [warTask(T_RESTORE)],
      dailyNotes: { [NOTE_A]: warNote(T_RESTORE, '## Quick Notes\n- restored') },
      deletedObsidianKeys: TOMBSTONES,
    });
    await peer.engine.dbSyncCycle();
    await peer.engine.dbSyncCycle();
    peer.flush();
    // The restoring device's own apply keeps the restored copies (revive-preserving).
    expect(peer.visible.tasks.some((t) => t.id === TASK_ID)).toBe(true);
    expect(peer.visible.dailyNotes[NOTE_A]).toBeTruthy();

    // The original device pulls the restore: the gate passes it (newer than
    // tombstone), and the scan-merge keeps it thereafter.
    await dev.engine.dbSyncCycle();
    dev.flush();
    expect(dev.visible.tasks.some((t) => t.id === TASK_ID)).toBe(true);
    expect(dev.visible.dailyNotes[NOTE_A]).toBeTruthy();
    runVaultScan(dev);
    expect(dev.visible.tasks.some((t) => t.id === TASK_ID)).toBe(true);
    expect(dev.visible.dailyNotes[NOTE_A]).toBeTruthy();
  });

  it("clock-skew characterization: a restore whose lastModified lands BELOW the tombstone (inside the push guard's 5s epsilon) is dropped — the obsidian LWW has no epsilon, by pre-existing rule", async () => {
    // The boundary, stated rather than assured: isObsidianTombstoned is
    // tombstone ≥ lastModified with NO margin — the same rule the scan merge
    // and rescue gate have always enforced; symmetric enforcement adopts it
    // unchanged. A restoring device whose clock runs ~3s behind the deleting
    // device stamps its restore below the tombstone and the restore loses —
    // everywhere, including on the restoring device's own next apply (that
    // was already true via the rescue gate before this fix). The push guard's
    // 5s STALE_TOMBSTONE_EPSILON protects a different comparison (tombstone
    // vs snapshot copy at the push diff) and does not soften this one. The
    // recovery path is the same as ever: any later edit or vault write
    // re-stamps lastModified past the tombstone and the copy revives.
    const vault = createMemoryVault();
    const dev = await seedWar(vault);
    runVaultScan(dev);
    await dev.engine.dbSyncCycle();
    await dev.engine.dbSyncCycle();
    dev.flush();

    const T_SKEWED = '2026-08-20T09:59:57.000Z'; // tombstone − 3s: inside the guard's epsilon
    const peer = makeLaggedDevice('skewed', vault, {
      ...EMPTY,
      tasks: [warTask(T_SKEWED)],
      deletedObsidianKeys: TOMBSTONES,
    });
    await peer.engine.dbSyncCycle();
    await peer.engine.dbSyncCycle();
    peer.flush();
    // The skewed restore is dropped by the restoring device's own apply…
    expect(peer.visible.tasks.some((t) => t.id === TASK_ID)).toBe(false);
    // …and never re-enters the original device either.
    await dev.engine.dbSyncCycle();
    dev.flush();
    expect(dev.visible.tasks.some((t) => t.id === TASK_ID)).toBe(false);
  });

  it('re-creation with fresh content ends up stable everywhere (the self-resolution mechanism, still intact post-fix)', async () => {
    const vault = createMemoryVault();
    const dev = await seedWar(vault);

    // The war converges dead first (post-fix behavior).
    runVaultScan(dev);
    await dev.engine.dbSyncCycle();
    await dev.engine.dbSyncCycle();
    dev.flush();

    // Obsidian's own sync later delivers the notes with fresh mtimes AND
    // changed text; the scan re-imports them newer than their tombstones.
    const T_FRESH = '2026-08-26T19:30:00.000Z';
    const freshNotes = {
      [NOTE_A]: warNote(T_FRESH, '## Quick Notes\n- Testing on Windows\n- Back on the Mac'),
      [NOTE_B]: warNote(T_FRESH, '## Quick Notes\n## Thoughts\n- resolved'),
    };
    runVaultScan(dev, { scannedNotes: freshNotes });
    expect(dev.visible.dailyNotes[NOTE_A]).toBeTruthy();

    await dev.engine.dbSyncCycle(); // pushes the newer-than-tombstone notes
    dev.flush();
    const settledSeq = vault._seq();
    for (let round = 0; round < 2; round++) {
      runVaultScan(dev, { scannedNotes: freshNotes });
      const res = await dev.engine.dbSyncCycle();
      expect(res.error).toBeUndefined();
      dev.flush();
    }
    expect(vault._seq()).toBe(settledSeq); // stable — no war, no churn
    expect(dev.visible.dailyNotes[NOTE_A]).toBeTruthy();
    expect(dev.visible.dailyNotes[NOTE_B]).toBeTruthy();
  });
});

describe('the file-tier half — deletedObsidianKeys reaches the merge (fixes #1448)', () => {
  const localData = () => ({
    ...EMPTY,
    deletedObsidianKeys: TOMBSTONES,
  });
  // The remote FILE (WebDAV/iCloud) still carries the zombie rows a vaultless
  // device kept re-uploading — the #1448 scenario.
  const remoteData = () => ({
    ...EMPTY,
    tasks: [warTask()],
    dailyNotes: { [NOTE_A]: warNote() },
    deletedObsidianKeys: {},
  });

  it('a tombstoned-and-older row in the remote file is dropped from the merge output — and from the rewritten file', () => {
    const result = mergeSyncData(localData(), remoteData(), 365);
    expect(result.data.tasks.some((t) => t.id === TASK_ID)).toBe(false);
    expect(result.data.dailyNotes[NOTE_A]).toBeUndefined();
    // Both sides need the cleansed result: local applies it, the remote file
    // is rewritten without the zombies (so nothing is left to resurrect when
    // the tombstones hit the 60-day GC).
    expect(result.remoteChanged).toBe(true);
  });

  it('a revived row in the remote file (newer than its tombstone) survives the merge and syncs', () => {
    const remote = remoteData();
    remote.tasks = [warTask('2026-08-21T10:00:00.000Z')]; // newer than T_TOMB
    remote.dailyNotes = { [NOTE_A]: warNote('2026-08-21T10:00:00.000Z', 'restored') };
    const result = mergeSyncData(localData(), remote, 365);
    expect(result.data.tasks.some((t) => t.id === TASK_ID)).toBe(true);
    expect(result.data.dailyNotes[NOTE_A]).toBeTruthy();
  });
});
