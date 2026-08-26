import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';
import { createSyncCycleBreaker } from './syncBrakes.js';
import { rescueUnsyncedTasks } from '../utils/rescueUnsyncedTasks.js';
import { mergeObsidianTasks } from '../utils/mergeObsidianTasks.js';
import { mergeObsidianDailyNotes } from '../utils/mergeObsidianDailyNotes.js';

// ─────────────────────────────────────────────────────────────────────────────
// THE TOMBSTONE ECHO WAR — deterministic reproduction of the 2026-08-26 log
// (three rows — one legacy Obsidian task, two daily notes — cycling pull-DELETE
// → snapshot-diff-new → push written:3 → "honored deletes: Array(3)" →
// propagating delete(s) → repeat, ~12 rounds, EVERY cycle successful, counts
// oscillating 577/576 and 48/46 in lockstep).
//
// THE MECHANISM — one deletion channel, enforced asymmetrically:
//
//   The rows carry deletion tombstones newer than their lastModified
//   (deletedObsidianKeys here; any bundle the guard blesses behaves the same).
//   The tombstone is honored by EVERY PATH THAT DELETES:
//     • the vault-scan merges drop the rows from state
//       (mergeObsidianTasks / mergeObsidianDailyNotes, tombstone ≥ lastModified),
//     • rescueUnsyncedTasks refuses to rescue them,
//     • the commit merge blesses their mid-cycle vanish as an honored delete
//       (commitMerge → partitionSnapshotDeletes unions ALL tombstone bundles),
//     • the push guard propagates their snapshot vanish as 'tombstoned';
//   …but by NO PATH THAT APPLIES:
//     • applyEngineData admits pulled task rows with no deletedObsidianKeys
//       gate on the merged list and applies dailyNotes as a PLAIN REPLACE,
//     • the engine's pull applies any vault copy the mirror lacks.
//
//   The third ingredient is TIMING: back-to-back cycles (SSE multi-drains, the
//   3s debounce, the visibility handler firing scan + cycle together) run
//   against state whose React commit hasn't flushed yet — so a cycle can see
//   the PREVIOUS state, diff it against the snapshot of the cycle before, and
//   push the OPPOSITE of what the vault just did. The device fights its own
//   echo: state-with-rows + snapshot-without → push NEW (resurrect); state-
//   without + snapshot-with → blessed delete (kill); each push echoes back
//   through the pull one cycle later and seeds the opposite half. This is the
//   DB-tier sibling of issue #1448 (the same channel never reaching the
//   FILE-tier merge): honored on the way out, ignored on the way in.
//
//   EVERY CYCLE SUCCEEDS — which is why none of the brakes engage: the circuit
//   breaker (#1450) arms only on failure, the deferred retry (#1451) only on a
//   gated cycle, and the acked-hash dedup only suppresses re-pushing content
//   the vault already acked — these rows are ABSENT from the payload when they
//   diff as deletes and freshly re-applied when they diff as new, so the dedup
//   never sees a repeat. Pinned below as the success-loop gap.
//
//   SELF-RESOLUTION (the log's "survivors: Array(3)" flip): the war's substrate
//   is `tombstone ≥ lastModified`. The moment live copies exist whose
//   lastModified EXCEEDS the tombstones (a scan re-importing a note with a
//   fresh file mtime; any genuine edit), commitMerge carries them into the
//   commit as SURVIVORS, the next diff pushes them, and every comparison
//   thereafter keeps them. LWW revive-beats-tombstone ends the war by design —
//   it just cannot START until something bumps lastModified. Pinned below.
//
// HARNESS: real @glance-apps/sync engine + real crypto over the in-memory
// vault (the #1449 pattern). The device models React's commit-visibility lag
// explicitly: commitData lands in `pending`, `flush()` promotes it to the
// state getData sees — the stand-in for the render flush racing back-to-back
// drains. commitData models applyEngineData's verified behavior (tasks:
// merged list unfiltered + real tombstone-gated rescue; dailyNotes: plain
// replace). The scan step is the REAL mergeObsidianTasks /
// mergeObsidianDailyNotes fed the localStorage tombstones, exactly as
// useObsidianSync feeds them.
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
});
afterEach(() => { vi.useRealTimers(); });
afterAll(() => { delete global.localStorage; });

const clone = (x) => JSON.parse(JSON.stringify(x));

// The cast, mirroring the log: a legacy Obsidian task and two daily notes,
// each with lastModified OLDER than its deletion tombstone. Which bundle
// blessed the April task in the field (deletedObsidianKeys, or a
// deletedTaskIds entry inside the guard's 5s epsilon) doesn't change the
// shape; deletedObsidianKeys is used for all three here.
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
// `pending`; flush() promotes pending → visible. `flushOnPush` promotes the
// PREVIOUS pending right after a vault write lands — the mid-cycle render
// flush that produces the log's "honored deletes: Array(3)".
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
      const prevTasks = visible.tasks;
      pending = {
        ...d,
        // applyEngineData: merged list unfiltered + tombstone-gated rescue of
        // prev-only rows. The gate BLOCKS a rescue of the war rows — but a
        // pulled copy inside `d.tasks` walks straight in.
        tasks: rescueUnsyncedTasks(d.tasks, prevTasks, d.deletedTaskIds || {}, undefined, d.deletedObsidianKeys || {}),
        // applyEngineData: `setDailyNotes(data.dailyNotes)` — plain replace.
        dailyNotes: d.dailyNotes,
      };
    },
  });
  return dev;
}

// The REAL vault-scan merge step, fed exactly what useObsidianSync feeds it.
// The local scan does not contain the war rows (the task's note is outside the
// 90-day import window; the notes scan to nothing here), so the tombstones
// decide — and they DROP all three from visible state: the remover.
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

// Seed: state holds the rows (lastModified T_OLD) + the tombstones (T_TOMB);
// two cycles so the engine leaves the HWM=0 full-seed path and has consumed
// its own seed rows (echo drained); flush so visible is settled.
async function seedWar(vault, opts = {}) {
  localStorage.setItem('day-planner-deleted-obsidian-keys', JSON.stringify(TOMBSTONES));
  const dev = makeLaggedDevice('mac', vault, {
    ...EMPTY,
    tasks: [warTask()],
    dailyNotes: { [NOTE_A]: warNote(), [NOTE_B]: warNote(T_OLD, '## Quick Notes\n## Thoughts') },
    deletedObsidianKeys: TOMBSTONES,
  }, opts);
  await dev.engine.dbSyncCycle();
  await dev.engine.dbSyncCycle();
  dev.flush();
  expect(hasWarRows(dev.visible)).toBe(true);
  return dev;
}

describe('the echo war — a tombstone honored by every deleting path and no applying path', () => {
  it("reproduces the log's round anatomy: pull-DELETE supersedes the dirty marks → stale state re-pushes written:3 → honored deletes: 3 → the round re-arms", async () => {
    const vault = createMemoryVault();
    const dev = await seedWar(vault, { flushOnPush: true });

    // Pre-state, as mid-war: the vault's latest rows for the three keys are
    // DELETES (a previous round's blessed propagation), and the snapshot lacks
    // them (saved from that round's post-delete mirror) — while visible state
    // still HAS them (the flush lagged).
    for (const id of warIds) await vault.deleteRow('dayglance', id, 'acct', { deletedAt: new Date(T_TOMB).getTime() });
    const snapKey = 'dev-mac-db-sync-snapshot';
    const snap = JSON.parse(localStorage.getItem(snapKey));
    for (const id of warIds) delete snap[id];
    localStorage.setItem(snapKey, JSON.stringify(snap));
    expect(hasWarRows(dev.visible)).toBe(true);

    // ROUND A (log: "[pull] DELETE ×3 … did NOT write … dirty ids: Array(0) …
    // snapshot-diff new ×3"): the diff marks the rows NEW (state vs snapshot),
    // the pull's delete rows supersede the dirty marks (deletedAt ≥
    // lastModified — the engine's LWW), nothing is written, and the commit
    // carries the deletions — but only into `pending`; visible state still
    // shows the rows.
    const seqA0 = vault._seq();
    const resA = await dev.engine.dbSyncCycle();
    expect(resA.error).toBeUndefined();
    expect(vault._seq()).toBe(seqA0);            // did NOT write this cycle
    expect(hasWarRows(dev.visible)).toBe(true);  // flush hasn't landed

    // ROUND B (log: "written:3 … [commit] mid-cycle merge — survivors:
    // Array(0) honored deletes: Array(3)"): the still-stale state re-diffs the
    // rows as NEW and pushes them — RESURRECTING the vault rows the previous
    // round deleted. The flush lands right after the push (flushOnPush), so
    // the commit merge sees live state WITHOUT the rows, and — because the
    // tombstones bless the vanish — HONORS the deletes into the commit.
    const resB = await dev.engine.dbSyncCycle();
    expect(resB.error).toBeUndefined();
    for (const id of warIds) expect(vault._row(id).deleted).toBe(false); // resurrected
    expect(hasWarRows(dev.pending ?? dev.visible)).toBe(false);          // honored deletes carried

    // ROUND C: the flushed state now lacks the rows while the snapshot (saved
    // pre-merge, WITH the rows) still holds them → the guard blesses the
    // vanish ('tombstoned') — and the pull echoes round B's upserts straight
    // back into the mirror, which the commit RE-ADMITS into state. The war has
    // re-armed itself; nothing converged.
    dev.flush();
    expect(hasWarRows(dev.visible)).toBe(false);
    const resC = await dev.engine.dbSyncCycle();
    expect(resC.error).toBeUndefined();
    dev.flush();
    expect(hasWarRows(dev.visible)).toBe(true);  // re-admitted — appear/disappear, forever
  });

  it('pins the sustained war: scan drops, the echo re-admits, the push re-writes — vault traffic every round, every cycle successful, rows never converge', async () => {
    const vault = createMemoryVault();
    const dev = await seedWar(vault);

    let lastSeq = vault._seq();
    for (let round = 1; round <= 3; round++) {
      runVaultScan(dev);                          // remover: rows leave visible state
      expect(hasWarRows(dev.visible)).toBe(false);
      const res = await dev.engine.dbSyncCycle(); // echo re-applies → push re-writes → commit re-admits
      expect(res.error).toBeUndefined();
      dev.flush();
      expect(hasWarRows(dev.visible)).toBe(true); // …and they are back
      expect(vault._seq()).toBeGreaterThan(lastSeq); // the vault was written AGAIN
      lastSeq = vault._seq();
    }
    for (const id of warIds) expect(vault._row(id).deleted).toBe(false); // never converged
  });

  it('confirms the brake gap: every cycle succeeds — the breaker never strikes, nothing is gated, no deferred retry is armed', async () => {
    const vault = createMemoryVault();
    const breaker = createSyncCycleBreaker({ random: () => 0 });
    const onFailure = vi.spyOn(breaker, 'onFailure');
    const armed = [];
    const dev = await seedWar(vault, {
      engineOverrides: {
        cycleBreaker: breaker,
        retryTimers: { setTimeoutFn: (fn, ms) => { armed.push(ms); return { fn, ms }; }, clearTimeoutFn: () => {} },
      },
    });

    for (let round = 0; round < 4; round++) {
      runVaultScan(dev);
      const res = await dev.engine.dbSyncCycle();
      expect(res.error).toBeUndefined();
      expect(res.throttled).toBeUndefined();
      dev.flush();
    }
    expect(onFailure).not.toHaveBeenCalled(); // failure-brakes are structurally blind to a success loop
    expect(armed).toEqual([]);
  });

  it("pins the self-resolution: copies whose lastModified beats the tombstones end the war (the log's 'survivors' flip) — and it STAYS ended", async () => {
    const vault = createMemoryVault();
    const dev = await seedWar(vault);

    for (let round = 0; round < 2; round++) { // a couple of war rounds first
      runVaultScan(dev);
      await dev.engine.dbSyncCycle();
      dev.flush();
    }
    expect(hasWarRows(dev.visible)).toBe(true);

    // The resolution event: the scan re-imports the notes with FRESH file
    // mtimes AND changed text (Obsidian's own sync delivering updated files),
    // and the task's copy is re-stamped past its tombstone. The changed text
    // matters: mergeObsidianDailyNotes carries the OLD lastModified forward
    // for UNCHANGED text (so unedited notes don't re-push every scan), which
    // means a same-text rescan still loses to the tombstone — only genuinely
    // newer content (or a fresh import into an absent slot) can end the war.
    const T_FRESH = '2026-08-26T19:30:00.000Z';
    const freshNotes = {
      [NOTE_A]: warNote(T_FRESH, '## Quick Notes\n- Testing on Windows\n- Back on the Mac'),
      [NOTE_B]: warNote(T_FRESH, '## Quick Notes\n## Thoughts\n- resolved'),
    };
    dev.visible = {
      ...dev.visible,
      tasks: dev.visible.tasks.map((t) => (t.id === TASK_ID ? { ...t, lastModified: T_FRESH } : t)),
    };
    runVaultScan(dev, { scannedNotes: freshNotes });
    expect(hasWarRows(dev.visible)).toBe(true); // fresh copies now BEAT the tombstones — nothing drops them

    await dev.engine.dbSyncCycle(); // pushes the newer-than-tombstone copies
    dev.flush();
    const settledSeq = vault._seq();

    // Converged: further scan+cycle rounds drop nothing, write nothing.
    for (let round = 0; round < 2; round++) {
      runVaultScan(dev, { scannedNotes: freshNotes });
      expect(hasWarRows(dev.visible)).toBe(true);
      const res = await dev.engine.dbSyncCycle();
      expect(res.error).toBeUndefined();
      dev.flush();
    }
    expect(vault._seq()).toBe(settledSeq);
    expect(hasWarRows(dev.visible)).toBe(true);
  });

  // CORRECT behavior — currently false, deliberately pinned as the bug: a
  // pulled copy of a row whose deletion tombstone is the newest word must not
  // RE-ENTER state. If the apply path honored deletedObsidianKeys the way
  // every deleting path does, the scan's drop would stick, the echo would be
  // refused, and the war would converge instead of re-arming.
  it.fails('a pulled echo of a tombstoned-and-older obsidian row does not re-enter state — the eviction sticks', async () => {
    const vault = createMemoryVault();
    const dev = await seedWar(vault);

    runVaultScan(dev);
    expect(hasWarRows(dev.visible)).toBe(false);
    await dev.engine.dbSyncCycle();
    dev.flush();
    // CORRECT: the echo is refused and the rows stay gone…
    expect(hasWarRows(dev.visible)).toBe(false);
    // …so the next cycle propagates clean deletes and the vault converges dead.
    await dev.engine.dbSyncCycle();
    dev.flush();
    for (const id of warIds) expect(vault._row(id).deleted).toBe(true);
  });
});
