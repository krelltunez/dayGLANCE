import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';
import { partitionSnapshotDeletes, STALE_TOMBSTONE_EPSILON_MS } from './snapshotDeleteGuard.js';
import { dropResurrectedTasks } from '../utils/dropResurrectedTasks.js';
import { mergeObsidianTasks } from '../utils/mergeObsidianTasks.js';
import { applyRetirementsToTaskLists } from '../utils/retiredTaskIds.js';

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 TRANSITION × DB-TIER SYNC LOOP — deterministic reproduction.
//
// Field symptom (macOS dev build, main @ #1439, GLANCEvault backend, all peers
// powered off): cloud sync fires ~every second, GLANCEvault rate-limits with
// `list failed: 429`, task rows appear and disappear in a repeating cycle, and
// the whole thing survives an app restart.
//
// THE MECHANISM, in three interlocking parts (each pinned by a test below):
//
//  1. THE SEED — a retired legacy row whose VAULT copy outlived its tombstone.
//     The Phase 2 id migration retires `obsidian-<date>-<hash>` → `obsidian-dg-…`
//     and tombstones the retired id in deletedTaskIds at commit time T_c. During
//     the mixed-version window a v4.7.0 peer still holding the legacy row L
//     re-pushed it to the vault with a lastModified NEWER than T_c (any peer-side
//     re-stamp does it). The vault now holds L alive, newer than its tombstone.
//
//  2. THE WAR — two subsystems permanently disagree about L:
//       • REMOVER: the Phase 2 vault scan evicts L from app state every scan —
//         the legacy-hint bridge puts L in scannedIdsAllLists, so
//         mergeObsidianTasks neither merges nor retains it (utils/
//         mergeObsidianTasks.js). By design: the dg row replaces it.
//       • RESTORER: the DB engine's snapshot still holds L, so the push diff
//         wants to delete it — but snapshotDeleteGuard compares the tombstone
//         (T_c) against the snapshot copy's lastModified (the peer re-stamp,
//         > T_c + 5s) and classifies it 'stale-tombstone': the delete is SKIPPED
//         and healGlitchSkips re-fetches L from the vault (still live there) and
//         re-commits it into app state. Row reappears; snapshot re-learns it;
//         the next scan evicts it again. Neither side ever wins: the vault row
//         is never deleted, the eviction never sticks, and every iteration costs
//         a list + a row-get. The 'completed'/aged-out release valve
//         (payloadExclusions) deliberately does NOT apply to the
//         'stale-tombstone' class, so completed rows — exactly the ones the
//         user completed, stamping and retiring their legacy ids — are the ones
//         that loop. (Contrast test: a legacy row whose tombstone stayed newest
//         propagates its delete cleanly and converges. The peer re-stamp is the
//         whole difference.)
//     ── FIXED by the id-retirement record (utils/retiredTaskIds.js): the
//     commit that renames an id records { oldId → {retiredAt, successor} };
//     the guard classifies a vanish with a LIVE successor 'retired' and
//     propagates it REGARDLESS of timestamps, and the apply path supersedes
//     retired rows — redirecting a NEWER copy's content onto the successor —
//     so nothing is left for the heal to restore. The war section below now
//     pins the fixed behavior; the seed section keeps the pre-record baseline
//     ('stale-tombstone' skip) as the deliberate no-record / no-live-successor
//     fallback.
//
//  3. THE STORM — when a heal row-get fails (429), the cycle withholds its
//     snapshot (dbEngine.js: unresolved glitch-skips poison the baseline). A
//     frozen baseline re-marks every since-changed row dirty EVERY cycle, and
//     pushDirtyRows had no content dedup — each cycle re-wrote the same rows,
//     each write advances the account seq, each seq advance SSE-nudges
//     drainSync (wired straight to dbSyncCycle, originally with no backoff),
//     running the next cycle: the ~1/s self-nudge loop whose request volume
//     feeds the very 429s that keep the heal failing. Restart changes nothing:
//     snapshot, tombstones, task lists and the vault row are all persisted.
//     ── FIXED by the client-side brakes (src/sync/syncBrakes.js + the
//     acked-hash push dedup in dbEngine.js); the storm section below now pins
//     the fixed behavior.
//
// Both halves are now fixed; every section pins its fixed behavior, plus the
// deliberate conservative fallbacks (no record / successor not live).
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

// In-memory GLANCEvault with the single-row GET enabled (the heal path needs it).
function createMemoryVault() {
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
    async getRow(app, entityId) {
      const r = log.get(entityId);
      return r && !r.deleted ? { entityId: r.entityId, seq: r.seq, envelope: r.envelope, deleted: false } : null;
    },
    _row(entityId) { return log.get(entityId) || null; },
    _seq() { return seq; },
  };
  return vault;
}

// Frozen clock: every fixture date below keeps its meaning against the 60-day
// tombstone window permanently (same pattern as dbEngineWiring.test.js).
const FIXTURE_NOW = new Date('2026-07-10T12:00:00.000Z');
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

const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {},
};

// ── The mixed-session cast ──────────────────────────────────────────────────
// D: the migrated dg row the Mac keeps. L: the retired legacy id, completed on
// the Mac at T_EDIT, tombstoned at T_TOMB, re-stamped by a v4.7.0 peer at
// T_PEER (> T_TOMB + epsilon). L2: a retired id whose tombstone stayed newest
// (the healthy case — no peer re-stamp).
const DG_ID = 'obsidian-dg-k3x9q2mf';
const L_ID = 'obsidian-2026-07-08-1a2b3c';
const L2_ID = 'obsidian-2026-07-08-9z8y7x';
const T_EDIT = '2026-07-08T10:00:00.000Z';
const T_TOMB = '2026-07-08T10:00:05.000Z'; // commit-time tombstone, 5s after the edit
const T_PEER = '2026-07-08T11:00:00.000Z'; // peer re-stamp, 1h later — well past epsilon
const T_OLD = '2026-07-08T09:00:00.000Z'; // L2's untouched lastModified — older than its tombstone

const obsidianTask = (id, lastModified, extra = {}) => ({
  id,
  title: 'Buy milk #obsidian',
  duration: 30,
  color: 'bg-purple-600',
  completed: true,
  notes: '',
  subtasks: [],
  importSource: 'obsidian',
  obsidianRawTitle: 'Buy milk',
  obsidianFileDate: '2026-07-08',
  lastModified,
  ...extra,
});

// A device wired like the app: getData mirrors buildSyncPayload (its
// dropResurrectedTasks pass included), commitData mirrors applyEngineData —
// replace semantics, NO deletedTaskIds filter on the merged list (the real
// apply only consults tombstones for prev-only rescue rows), plus the
// id-retirement supersede pass (applyRetirementsToTaskLists) the real apply
// now runs: a pulled row whose id maps to a live successor is dropped, with
// its newer content redirected onto the successor.
function makeDevice(name, vault, initial, engineOverrides = {}) {
  let data = clone(initial);
  let nativeKey = null;
  const engine = createDbEngine({
    vaultClient: vault,
    storageKeyPrefix: `dev-${name}`,
    deviceId: `device-${name}`,
    nativeGetSyncKey: () => nativeKey,
    nativeStoreSyncKey: (v) => { nativeKey = v; },
    ...engineOverrides,
    getData: () => {
      const d = clone(data);
      d.tasks = dropResurrectedTasks(d.tasks, d.deletedTaskIds);
      d.unscheduledTasks = dropResurrectedTasks(d.unscheduledTasks, d.deletedTaskIds);
      return d;
    },
    commitData: (d) => {
      const applied = applyRetirementsToTaskLists(
        { tasks: d.tasks, unscheduledTasks: d.unscheduledTasks }, d.retiredTaskIds || {},
      );
      data = { ...d, tasks: applied.tasks, unscheduledTasks: applied.unscheduledTasks };
    },
  });
  return {
    engine,
    get data() { return data; },
    set data(d) { data = d; },
  };
}

// The Phase 2 vault scan, reduced to its task-merge step: the scan parses the
// stamped line as D and — via the legacy-hint bridge — reports L as "accounted
// for" in scannedIdsAllLists, so mergeObsidianTasks evicts the L row from state.
// This is the REAL merge function, fed exactly what useObsidianSync feeds it.
function runVaultScan(device) {
  const scannedD = obsidianTask(DG_ID, T_EDIT, { obsidianBlockId: 'k3x9q2mf', obsidianLegacyId: L_ID });
  const scannedIdsAllLists = new Set([DG_ID, L_ID]);
  const preserve = () => ({});
  device.data = {
    ...device.data,
    tasks: mergeObsidianTasks(device.data.tasks, [scannedD], scannedIdsAllLists, preserve, {}),
  };
}

const taskIds = (device) => device.data.tasks.map((t) => t.id).sort();

// Shared setup: replay the mixed-version session, then power the peer off.
//   mac cycle 1  — pushes D, the retirement record (L→D, L2→D, both dual-
//                  written into deletedTaskIds by the commit's legacy-fleet
//                  shim), and a plain non-obsidian task G (glitch fodder for
//                  the storm tests).
//   peer cycle 1 — pulls, then pushes its re-stamped L (T_PEER, retitled
//                  offline) and stale L2 (T_OLD).
//   mac cycle 2  — pulls both. Under the retirement record the duplicates NO
//                  LONGER land: L2 (older than D) is plainly superseded, and
//                  L — the NEWER offline edit — is REDIRECTED: its content
//                  moves onto D, its row never enters state.
async function seedMixedSession(vault, macOverrides = {}) {
  const mac = makeDevice('mac', vault, {
    ...EMPTY,
    tasks: [
      obsidianTask(DG_ID, T_EDIT, { obsidianBlockId: 'k3x9q2mf' }),
      { id: 'g1', title: 'plain task', duration: 30, color: 'bg-blue-500', completed: false, notes: '', subtasks: [], lastModified: T_EDIT },
    ],
    deletedTaskIds: { [L_ID]: T_TOMB, [L2_ID]: T_TOMB },
    retiredTaskIds: {
      [L_ID]: { retiredAt: T_TOMB, successor: DG_ID },
      [L2_ID]: { retiredAt: T_TOMB, successor: DG_ID },
    },
  }, macOverrides);
  const peer = makeDevice('peer', vault, {
    ...EMPTY,
    tasks: [
      obsidianTask(L_ID, T_PEER, { title: 'Buy oat milk #obsidian' }),
      obsidianTask(L2_ID, T_OLD),
    ],
  });
  await mac.engine.dbSyncCycle();
  await peer.engine.dbSyncCycle();
  await mac.engine.dbSyncCycle();
  // The retirement record resolved the mixed-session damage at apply time:
  // neither retired id entered state, and the peer's newer offline edit was
  // redirected onto the successor (content + recency, identity kept).
  expect(taskIds(mac)).not.toContain(L_ID);
  expect(taskIds(mac)).not.toContain(L2_ID);
  const dg = mac.data.tasks.find((t) => t.id === DG_ID);
  expect(dg.title).toBe('Buy oat milk #obsidian');
  expect(dg.lastModified).toBe(T_PEER);
  expect(dg.obsidianBlockId).toBe('k3x9q2mf');
  return mac;
}

describe('the seed — guard classification of a peer-re-stamped retired id', () => {
  it("with a retirement record and a LIVE successor, the vanish is 'retired' — propagated REGARDLESS of the copy being newer than its tombstone (the war killer)", () => {
    const snapshotEntity = { _kind: 'tasks', value: obsidianTask(L_ID, T_PEER) };
    const { propagate, skipped, reasons } = partitionSnapshotDeletes(
      [`tasks:${L_ID}`],
      { [`tasks:${DG_ID}`]: 'hash' }, // the successor is live in the current shred
      {
        deletedTaskIds: { [L_ID]: T_TOMB },
        retiredTaskIds: { [L_ID]: { retiredAt: T_TOMB, successor: DG_ID } },
      },
      () => snapshotEntity,
    );
    expect(propagate).toEqual([`tasks:${L_ID}`]);
    expect(skipped).toEqual([]);
    expect(reasons[`tasks:${L_ID}`]).toBe('retired');
    // The exemption is doing real work: the copy IS newer than its tombstone.
    expect(new Date(T_PEER).getTime() - new Date(T_TOMB).getTime()).toBeGreaterThan(STALE_TOMBSTONE_EPSILON_MS);
  });

  it("with a retirement record but NO live successor, the record authorizes nothing — conservative fall-through to 'stale-tombstone'", () => {
    const snapshotEntity = { _kind: 'tasks', value: obsidianTask(L_ID, T_PEER) };
    const { skipped, reasons } = partitionSnapshotDeletes(
      [`tasks:${L_ID}`],
      {}, // successor not present on this device (record arrived before the row)
      {
        deletedTaskIds: { [L_ID]: T_TOMB },
        retiredTaskIds: { [L_ID]: { retiredAt: T_TOMB, successor: DG_ID } },
      },
      () => snapshotEntity,
    );
    expect(skipped).toEqual([`tasks:${L_ID}`]);
    expect(reasons[`tasks:${L_ID}`]).toBe('stale-tombstone');
  });

  it("without a record, a retired id whose vault copy outlived its tombstone is 'stale-tombstone' (skipped + healed) — the pre-record baseline, and the release valve does not cover it", () => {
    const snapshotEntity = { _kind: 'tasks', value: obsidianTask(L_ID, T_PEER) };
    const { skipped, reasons } = partitionSnapshotDeletes(
      [`tasks:${L_ID}`],
      {}, // current shred: the scan evicted L, so it is absent
      { deletedTaskIds: { [L_ID]: T_TOMB } },
      () => snapshotEntity,
      // The release predicate dbEngine passes would say 'completed' for this row —
      // but partitionSnapshotDeletes only consults it for bare-glitch rows, so the
      // completed stale-tombstone row is NOT released. Assert that stays true (it
      // is why the user's COMPLETED tasks are exactly the ones that loop).
      () => 'completed',
    );
    expect(skipped).toEqual([`tasks:${L_ID}`]);
    expect(reasons[`tasks:${L_ID}`]).toBe('stale-tombstone');
    // Sanity: the classification really is the timestamp flip, not something else.
    expect(new Date(T_PEER).getTime() - new Date(T_TOMB).getTime()).toBeGreaterThan(STALE_TOMBSTONE_EPSILON_MS);
  });

  it("the same id with its tombstone still newest is 'tombstoned' (propagates) — the healthy transition", () => {
    const snapshotEntity = { _kind: 'tasks', value: obsidianTask(L2_ID, T_OLD) };
    const { propagate, reasons } = partitionSnapshotDeletes(
      [`tasks:${L2_ID}`], {}, { deletedTaskIds: { [L2_ID]: T_TOMB } }, () => snapshotEntity,
    );
    expect(propagate).toEqual([`tasks:${L2_ID}`]);
    expect(reasons[`tasks:${L2_ID}`]).toBe('tombstoned');
  });
});

describe('the war — RESOLVED: the retirement record supersedes retired ids instead of healing them back', () => {
  // Formerly pinned here as it.fails: the scan evicted L every round while the
  // guard classified its vanish 'stale-tombstone' (the peer's re-stamp was
  // newer than the tombstone) and heal-fetched it straight back — appear/
  // disappear forever, one row-get per round, the vault row never deleted.
  // With the retirement record (utils/retiredTaskIds.js) the guard classifies
  // the vanish 'retired' (successor live → propagate REGARDLESS of
  // timestamps), the apply path never lets the retired row re-enter state,
  // and the newer offline edit is redirected onto the successor.

  it('retired ids converge: deletes propagate (reason: retired) with zero heal traffic, and scan rounds change nothing', async () => {
    const vault = createMemoryVault();
    const mac = await seedMixedSession(vault);
    const getRowSpy = vi.spyOn(vault, 'getRow');
    // The seed's pull cycle left L/L2 in the SNAPSHOT (they were applied to
    // the mirror) but not in state/payload — this cycle diffs them as deletes,
    // and the record propagates them despite L being newer than its tombstone.
    await mac.engine.dbSyncCycle();
    expect(vault._row(`tasks:${L_ID}`).deleted).toBe(true);
    expect(vault._row(`tasks:${L2_ID}`).deleted).toBe(true);
    expect(getRowSpy.mock.calls.filter((c) => c[1] === `tasks:${L_ID}` || c[1] === `tasks:${L2_ID}`).length).toBe(0);

    // Scan rounds are now no-ops: nothing to evict, nothing comes back.
    for (let round = 0; round < 3; round++) {
      runVaultScan(mac);
      await mac.engine.dbSyncCycle();
      expect(taskIds(mac)).not.toContain(L_ID);
    }
    expect(getRowSpy.mock.calls.filter((c) => c[1] === `tasks:${L_ID}`).length).toBe(0);
  });

  it('the (d) cost check: the newer offline edit under the retired id survives — it reaches the whole fleet on the successor', async () => {
    const vault = createMemoryVault();
    const mac = await seedMixedSession(vault); // seed already asserts the redirect landed in mac state
    await mac.engine.dbSyncCycle();            // pushes the redirected successor + the retired-id deletes

    // A fresh device pulling the vault sees exactly one task carrying the
    // peer's offline retitle with its recency — no duplicate, no lost edit.
    const checker = makeDevice('checker', vault, EMPTY);
    await checker.engine.dbSyncCycle();
    const ids = checker.data.tasks.map((t) => t.id);
    expect(ids).toContain(DG_ID);
    expect(ids).not.toContain(L_ID);
    expect(ids).not.toContain(L2_ID);
    const d = checker.data.tasks.find((t) => t.id === DG_ID);
    expect(d.title).toBe('Buy oat milk #obsidian');
    expect(d.lastModified).toBe(T_PEER);
  });

  it('restart: a fresh engine over the same persisted state converges instead of resuming the war', async () => {
    const vault = createMemoryVault();
    const mac = await seedMixedSession(vault);
    await mac.engine.dbSyncCycle();
    runVaultScan(mac);

    // "Quit and reopen": a NEW engine with the same storageKeyPrefix (snapshot,
    // HWM, dirty set all persisted in localStorage) over the same app data.
    const reopened = makeDevice('mac', vault, mac.data);
    const getRowSpy = vi.spyOn(vault, 'getRow');
    await reopened.engine.dbSyncCycle();
    expect(taskIds(reopened)).not.toContain(L_ID); // nothing healed back
    expect(getRowSpy.mock.calls.filter((c) => c[1] === `tasks:${L_ID}`).length).toBe(0);
  });
});

describe('the storm — FIXED: brakes on the withheld-snapshot re-push loop (syncBrakes + acked-hash dedup)', () => {
  // Originally pinned here as it.fails: while any glitch-skip stayed unresolved
  // (429 on the row-get), the snapshot was withheld, the frozen baseline
  // re-diffed the same rows dirty every cycle, and pushDirtyRows re-wrote them —
  // every write advanced the account seq, each seq advance SSE-nudged the next
  // dbSyncCycle, and no backoff existed anywhere: the observed ~1/s self-nudge
  // loop, whose request volume sustained the 429s that kept the heal failing.
  // Two independent brakes now cover it, each proven in isolation below:
  //   • acked-hash push dedup (dbEngine.js): a row whose exact content/delete
  //     the vault already acknowledged is never re-marked dirty by a stale
  //     baseline — the loop's write fuel is gone even if cycles keep running.
  //   • cycle breaker (syncBrakes.js): a failed or rate-limited cycle imposes a
  //     capped-exponential cooldown, so triggers can't hammer a 429ing vault.

  // Cycles keep running here (breaker disarmed) to prove the DEDUP alone stops
  // the writes: one edit → one write, then the seq stops moving even though the
  // heal keeps 429ing and the snapshot stays withheld.
  it('push dedup: an unchanged row is not re-pushed while a 429 pins the heal — the seq stops advancing', async () => {
    const vault = createMemoryVault();
    const noBreaker = { beforeCycle: () => ({ allowed: true }), onSuccess() {}, onFailure() { return 0; } };
    const mac = await seedMixedSession(vault, { cycleBreaker: noBreaker });
    await mac.engine.dbSyncCycle(); // retirement deletes settle

    // Manufacture the withheld snapshot: the plain task g1 VANISHES from state
    // with no tombstone and no retirement (a local-state glitch — the retired
    // ids no longer skip, so the glitch class is the storm's remaining fuel)
    // while the vault rate-limits row-gets, so the heal can't resolve it.
    mac.data = { ...mac.data, tasks: mac.data.tasks.filter((t) => t.id !== 'g1') };
    vault.getRow = async () => { const e = new Error('get row failed: 429'); e.status = 429; throw e; };

    // A single ordinary user edit, made once.
    mac.data = {
      ...mac.data,
      tasks: mac.data.tasks.map((t) => (t.id === DG_ID ? { ...t, title: 'Buy soy milk #obsidian', lastModified: '2026-07-10T11:59:00.000Z' } : t)),
    };

    const batchSpy = vi.spyOn(vault, 'batch');
    await mac.engine.dbSyncCycle(); // pushes the edit; heal 429s → snapshot withheld
    const seqAfterFirst = vault._seq();
    await mac.engine.dbSyncCycle(); // nothing changed since — must push nothing
    await mac.engine.dbSyncCycle();

    const dgWrites = batchSpy.mock.calls
      .flatMap((c) => c[1].rows)
      .filter((r) => r.entityId === `tasks:${DG_ID}`).length;
    expect(dgWrites).toBe(1);
    expect(vault._seq()).toBe(seqAfterFirst);
  });

  it('cycle breaker: a rate-limited heal imposes a cooldown — the next trigger runs no cycle and touches the vault not at all', async () => {
    const vault = createMemoryVault();
    const mac = await seedMixedSession(vault); // default (real) breaker
    await mac.engine.dbSyncCycle();
    // Same glitch fixture as above: an untombstoned, unretired vanish keeps
    // the heal in play now that retired ids propagate instead of skipping.
    mac.data = { ...mac.data, tasks: mac.data.tasks.filter((t) => t.id !== 'g1') };
    vault.getRow = async () => { const e = new Error('get row failed: 429'); e.status = 429; throw e; };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mac.engine.dbSyncCycle(); // heal 429s → breaker strike → cooldown

    const listSpy = vi.spyOn(vault, 'list');
    const gated = await mac.engine.dbSyncCycle(); // an SSE nudge / debounce firing now
    expect(gated.throttled).toBe(true);
    expect(gated.retryInMs).toBeGreaterThan(0);
    expect(listSpy.mock.calls.length).toBe(0); // zero vault traffic while gated

    // Cooldown passes (rate-limit backoff caps at 5min) → cycles run again.
    vi.setSystemTime(new Date(FIXTURE_NOW.getTime() + 5 * 60 * 1000 + 1000));
    const resumed = await mac.engine.dbSyncCycle();
    expect(resumed.throttled).toBeUndefined();
    expect(listSpy.mock.calls.length).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });

  it('cycle breaker: a 429-failed pull (list) gates the immediate retry too', async () => {
    const vault = createMemoryVault();
    const mac = await seedMixedSession(vault);
    await mac.engine.dbSyncCycle();

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const realList = vault.list;
    vault.list = async () => { const e = new Error('list failed: 429'); e.status = 429; throw e; };
    const failed = await mac.engine.dbSyncCycle();
    expect(failed.error).toMatch(/429/);

    vault.list = realList;
    const listSpy = vi.spyOn(vault, 'list');
    const gated = await mac.engine.dbSyncCycle();
    expect(gated.throttled).toBe(true);
    expect(listSpy.mock.calls.length).toBe(0);

    vi.setSystemTime(new Date(FIXTURE_NOW.getTime() + 5 * 60 * 1000 + 1000));
    const resumed = await mac.engine.dbSyncCycle();
    expect(resumed.throttled).toBeUndefined();
    expect(listSpy.mock.calls.length).toBeGreaterThan(0);
    warnSpy.mockRestore();
  });
});
