// The JOBO ledger through both sync tiers, end to end.
//
// docs/jobo-ledger-persistence.md, "Testing": assert the record is observable
// where the app reads it, not that a function returned it. `originalPlan` had
// unit tests on every boundary and still shipped in a state where it never
// survived one sync cycle, because nothing exercised the path BETWEEN the
// modules. Each scenario here walks the whole path: the hook's state, the
// payload the engine shreds, the vault adapter's per-row merge, the file-tier
// merge, and the hook's state on the other device. Scenario numbers follow the
// design doc. The mutation that must break each one is named beside it.
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';
import { createMemoryKeyValue } from '../utils/idbKeyValue.js';
import {
  shredState, reassembleState, applyRemoteEntity, applyRemoteDelete, getLocalEntity,
  isInsertOnly, makeEntityId, COLLECTION_KINDS, absentCollectionKinds, carryAbsentCollections,
} from '@glance-apps/dayglance-vault';
import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';
import { mergeSyncData } from '../mergeSync.js';
import { createLedger, mergeJoboCollections } from '../jobo/ledger.js';
import { createDoRecord, tombstoneDoRecord, pickJoboRecord } from '../jobo/core.js';
import { snapshotJoboState, planJoboTransitions, buildJoboRecords } from '../jobo/detector.js';

const T0 = '2026-09-19T15:10:02.000Z';
const T1 = '2026-09-19T16:00:00.000Z';
const OLD = '2026-01-05T09:00:00.000Z'; // far outside any tombstone window
const base = {
  id: `do:t1:${T0}`, taskId: 't1', timing: 'timed', date: '2026-09-19', startTime: '14:30',
  endDate: '2026-09-19', endTime: '15:10', title: 'Draft the report',
  planSnapshot: { date: '2026-09-19', startTime: '14:30', duration: 60 },
  source: 'completion', progress: 'completed', createdAt: T0, updatedAt: T0, observedAt: T0,
};
const rec = (over = {}) => createDoRecord({ ...base, ...over });

// A store with the real contract, in memory.
function memStore(initial) {
  let value = initial;
  return {
    async writable() { return true; }, async mode() { return 'indexeddb'; },
    async read() { return { ok: true, value }; },
    async update(fn) { value = fn(value); return { ok: true, value }; },
    async write(v) { value = v; return { ok: true, value }; },
    peek: () => value,
  };
}
// What buildSyncPayload puts in `data` for the ledger: the key only once loaded.
const payloadData = (ledger) => (ledger.get().records === undefined ? {} : { joboRecords: ledger.get().records });
const jid = (record) => makeEntityId('joboRecords', record.id);
const EMPTY = { tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [], habits: [], goals: [], projects: [], areas: [], gtdFrames: [], frameSets: [], users: [], dailyNotes: {} };

describe('registration', () => {
  it('is a collection kind on updatedAt, and insert-only', () => {
    expect(COLLECTION_KINDS.joboRecords).toEqual({ idField: 'id', tsField: 'updatedAt' });
    expect(isInsertOnly({ _kind: 'joboRecords', value: rec() })).toBe(true);
  });
});

// 1. save → state → push → apply.
describe('scenario 1: a record survives save, state, push and apply', () => {
  it('is in state, in the payload, in a vault row, and in the other device state', async () => {
    const a = createLedger({ store: memStore([]) });
    await a.load();
    const record = rec();
    expect((await a.commit([record])).ok).toBe(true);
    expect(a.get().records).toEqual([record]);                       // state
    const data = { ...EMPTY, ...payloadData(a) };
    expect(data.joboRecords).toEqual([record]);                      // payload
    const row = shredState(data).find((r) => r.entityId === jid(record));
    expect(row.entity.value).toEqual(record);                        // vault row
    // MUTATION: drop joboRecords from COLLECTION_KINDS and the row is a
    // singleton blob instead, and reassemble puts nothing under the key.
    expect(reassembleState([row]).joboRecords).toEqual([record]);
    const bMirror = { ...EMPTY, joboRecords: [] };
    applyRemoteEntity(bMirror, row.entity);
    const b = createLedger({ store: memStore([]) });
    await b.load();
    await b.applyRemote(bMirror.joboRecords);                        // applyEngineData → hook
    expect(b.get().records).toEqual([record]);                       // other device state
  });

  it('omits the key while the ledger has not loaded, rather than claiming it is empty', async () => {
    const failing = { ...memStore([]), async read() { return { ok: false, error: 'storageRead' }; } };
    const a = createLedger({ store: failing });
    await a.load();
    // MUTATION: return [] from a failed read and the payload carries an empty
    // ledger that would win nothing and lose everything on the file tier.
    expect(payloadData(a)).toEqual({});
  });
});

// 2. The flag gates the interface, never the data: nothing in this path reads
// joboEnabled. The hook, the payload and the apply are flag-free by construction.

// 3. A device that predates the collection, and the horizon.
describe('scenario 3: an older build and the sync horizon', () => {
  it('a payload without the key merges against one with it, and the records survive', () => {
    const local = { ...EMPTY, joboRecords: [rec()] };
    const remote = { ...EMPTY }; // older build: no key at all
    const { data, localChanged, remoteChanged } = mergeSyncData(local, remote, 90);
    expect(data.joboRecords).toEqual([rec()]);
    expect(remoteChanged).toBe(true);   // the remote needs it
    expect(localChanged).toBe(false);   // nothing new for us
    const other = mergeSyncData(remote, local, 90);
    expect(other.data.joboRecords).toEqual([rec()]);
    expect(other.localChanged).toBe(true);
  });

  it('an old local-only record and an old local-only tombstone survive the file tier past the window', () => {
    const oldRecord = rec({ id: 'do:t9:old', createdAt: OLD, updatedAt: OLD, observedAt: OLD });
    const oldTombstone = tombstoneDoRecord(rec({ id: 'do:t8:gone', createdAt: OLD, updatedAt: OLD, observedAt: OLD }), '2026-01-06T00:00:00.000Z');
    const local = { ...EMPTY, joboRecords: [oldRecord, oldTombstone] };
    // A remote whose tombstone window has long since passed the old rows.
    const remote = { ...EMPTY, joboRecords: [], tombstonePrunedBefore: '2026-09-01T00:00:00.000Z' };
    // MUTATION: pass the sync horizon to the ledger merge and both rows are
    // dropped as presumed zombies.
    const { data } = mergeSyncData(local, remote, 90);
    expect(data.joboRecords.map((r) => r.id).sort()).toEqual(['do:t8:gone', 'do:t9:old']);
    // ...and the kept tombstone still beats a stale live copy arriving later.
    const staleLive = { ...oldTombstone, deleted: false, updatedAt: OLD };
    const again = mergeSyncData(data, { ...EMPTY, joboRecords: [staleLive] }, 90);
    expect(again.data.joboRecords.find((r) => r.id === 'do:t8:gone').deleted).toBe(true);
  });
});

// 4. Same completion, two devices, one record; and the convergence rule.
describe('scenario 4: two devices, one record', () => {
  const early = rec({ observedAt: T0, title: 'as it was' });
  const late = rec({ observedAt: '2026-09-19T15:20:00.000Z', date: '2026-09-18', title: 'after the reschedule' });

  it('vault tier: the earlier observer wins whichever side is local, and the loser re-pushes the winner', () => {
    const mirrorA = { ...EMPTY, joboRecords: [early] };
    // MUTATION: route joboRecords through upsertCollection instead of
    // applyRemoteJobo and the later copy replaces the earlier one here.
    expect(applyRemoteEntity(mirrorA, { _kind: 'joboRecords', value: late })).toEqual([jid(early)]);
    expect(mirrorA.joboRecords[0]).toEqual(early);
    const mirrorB = { ...EMPTY, joboRecords: [late] };
    expect(applyRemoteEntity(mirrorB, { _kind: 'joboRecords', value: early })).toEqual([]);
    expect(mirrorB.joboRecords[0]).toEqual(early);
  });

  it('vault tier: two devices holding different pristine copies converge on one through a shared vault', () => {
    const vault = createVault();
    const a = createDevice('A', { ...EMPTY, joboRecords: [early] });
    const b = createDevice('B', { ...EMPTY, joboRecords: [late] });
    a.markDirty(jid(early));
    b.markDirty(jid(late));
    // MUTATION: make joboRecords LWW instead of insert-only and the sim's
    // "remote newer" test skips the tie, so each device keeps its own copy.
    syncToConvergence(a, b, vault);
    expect(a.data.joboRecords).toEqual([early]);
    expect(b.data.joboRecords).toEqual([early]);
  });

  it('file tier: the same winner in both merge orders', () => {
    const ab = mergeSyncData({ ...EMPTY, joboRecords: [early] }, { ...EMPTY, joboRecords: [late] }, 90);
    const ba = mergeSyncData({ ...EMPTY, joboRecords: [late] }, { ...EMPTY, joboRecords: [early] }, 90);
    expect(ab.data.joboRecords).toEqual([early]);
    expect(ba.data.joboRecords).toEqual([early]);
    expect(ab.remoteChanged).toBe(true);  // remote held the loser
    expect(ab.localChanged).toBe(false);
    expect(ba.localChanged).toBe(true);   // we held the loser
    expect(ba.remoteChanged).toBe(false);
  });

  it('a user edit beats a late re-observation, and a tombstone beats a stale live copy, on both tiers', () => {
    const edited = rec({ updatedAt: T1, progress: 'partial' });
    const mirror = { ...EMPTY, joboRecords: [edited] };
    expect(applyRemoteEntity(mirror, { _kind: 'joboRecords', value: early })).toEqual([jid(early)]);
    expect(mirror.joboRecords[0].progress).toBe('partial');
    const dead = tombstoneDoRecord(early, T1);
    const file = mergeSyncData({ ...EMPTY, joboRecords: [early] }, { ...EMPTY, joboRecords: [dead] }, 90);
    expect(file.data.joboRecords[0].deleted).toBe(true);
    expect(file.localChanged).toBe(true);
  });

  it('an identical pulled copy is a no-op, not a re-push', () => {
    const mirror = { ...EMPTY, joboRecords: [early] };
    expect(applyRemoteEntity(mirror, { _kind: 'joboRecords', value: { ...early } })).toEqual([]);
    const same = mergeSyncData({ ...EMPTY, joboRecords: [early] }, { ...EMPTY, joboRecords: [{ ...early }] }, 90);
    // MUTATION: raise a change flag on equal copies and this is the push churn
    // the archived field once caused.
    expect(same.localChanged).toBe(false);
    expect(same.remoteChanged).toBe(false);
  });
});

describe('deletion is a row, never a row delete', () => {
  it('a vault row delete leaves the ledger untouched', () => {
    const mirror = { ...EMPTY, joboRecords: [rec()] };
    applyRemoteDelete(mirror, jid(rec()));
    expect(mirror.joboRecords).toHaveLength(1);
    expect(getLocalEntity(mirror, jid(rec()))).not.toBeNull();
  });
});

describe('mergeJoboCollections change flags', () => {
  it('neither side carries it: no key, no flags', () => {
    expect(mergeJoboCollections(undefined, undefined)).toEqual({ merged: undefined, localChanged: false, remoteChanged: false });
  });
  it('uses core pickJoboRecord by default', () => {
    const early = rec({ observedAt: T0 });
    const late = rec({ observedAt: T1, title: 'late' });
    expect(mergeJoboCollections([late], [early]).merged).toEqual([pickJoboRecord(late, early)]);
  });
});

// 11. Restore then reload keeps the ledger.
describe('scenario 11: restore writes through the checked write and a fresh hook sees it', () => {
  it('replaces the collection and a new controller over the same store loads it', async () => {
    const store = memStore([rec({ id: 'do:stale', title: 'from before' })]);
    const first = createLedger({ store });
    await first.load();
    const fromBackup = [rec(), tombstoneDoRecord(rec({ id: 'do:t2:x' }), T1)];
    expect((await first.restore(fromBackup)).ok).toBe(true);
    expect(first.get().records.map((r) => r.id).sort()).toEqual([base.id, 'do:t2:x']);
    const second = createLedger({ store });
    await second.load();
    expect(second.get().records.map((r) => r.id).sort()).toEqual([base.id, 'do:t2:x']);
  });

  it('a failed restore write is not acknowledged and does not touch state', async () => {
    const store = { ...memStore([rec()]), async write() { return { ok: false, error: 'storageWrite' }; } };
    const ledger = createLedger({ store });
    await ledger.load();
    // MUTATION: set state before the write resolves ok and the reload that
    // follows a restore reads back the old ledger while the UI showed the new.
    expect((await ledger.restore([rec({ id: 'do:new' })])).ok).toBe(false);
    expect(ledger.get().records.map((r) => r.id)).toEqual([base.id]);
  });
});

// 12. A pulled record whose ledger write fails is not lost.
//
// The real engine over the app's two callbacks, in memory (scenarios 12 and 14).
function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
// The real client's surface, in memory, with the single-row GET the heal uses.
function memVault() {
  const salts = new Map();
  const log = new Map();
  let seq = 0;
  const calls = { batch: 0, deleteRow: 0, getRow: 0 };
  return {
    calls,
    async getSalt(accountId) { return salts.get(accountId) || null; },
    async putSalt(accountId, fresh) { if (!salts.has(accountId)) salts.set(accountId, fresh); return salts.get(accountId); },
    async batch(app, { rows }) {
      calls.batch += 1;
      for (const r of rows) log.set(r.entityId, { entityId: r.entityId, seq: ++seq, envelope: r.envelope, deleted: false });
      return { maxSeq: seq };
    },
    async deleteRow(app, entityId) { calls.deleteRow += 1; log.set(entityId, { entityId, seq: ++seq, envelope: null, deleted: true }); return { seq }; },
    async list(app, { since }) {
      return { rows: [...log.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq), hasMore: false };
    },
    async getRow(app, entityId) {
      // The engine probes `__glance_keycheck` on a fresh engine; only a
      // real row id here is the glitch heal's re-fetch.
      if (!String(entityId).startsWith('__glance')) calls.getRow += 1;
      const r = log.get(entityId);
      return r && !r.deleted ? { ...r } : null;
    },
    async device() { return { updated: true }; },
    has: (entityId) => { const r = log.get(entityId); return !!r && !r.deleted; },
  };
}
// A device is the real engine wrapper over the app's two callbacks, with the
// ledger wired exactly as App.jsx wires it: buildSyncPayload carries the
// collection only once loaded; applyEngineData hands pulled rows to the hook
// and does not await the write.
function makeDevice(name, vault, ledger, snapshotStore = createMemoryKeyValue()) {
  let data = JSON.parse(JSON.stringify(EMPTY));
  let nativeKey = null;
  const engine = createDbEngine({
    vaultClient: vault,
    storageKeyPrefix: `jobo-${name}`,
    deviceId: `device-${name}`,
    snapshotStore,
    nativeGetSyncKey: () => nativeKey,
    nativeStoreSyncKey: (v) => { nativeKey = v; },
    getData: () => ({ ...JSON.parse(JSON.stringify(data)), ...payloadData(ledger) }),
    commitData: (d) => {
      const { joboRecords, ...rest } = d;
      data = rest;
      if (Array.isArray(joboRecords)) ledger.applyRemote(joboRecords);
    },
  });
  return { engine, ledger };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// The engine's contract is that dayGLANCE's applyRemoteEntity writes a per-cycle
// mirror, so the pull cursor advances at end of pull and the mirror is committed
// through applyEngineData, which hands the ledger rows to the hook WITHOUT
// awaiting the IndexedDB write. So a row can be consumed by the cursor before it
// is durable. What makes that safe is the engine's own snapshot-delete guard:
// the committed mirror is the snapshot, the ledger state (what the payload
// reads) lacks the row, and a row that vanishes from the payload with no
// tombstone is a suspected glitch, never a delete. It is re-fetched by id and
// re-committed every cycle until it lands, and the snapshot is withheld until
// then. The other device's copy is never touched.
describe('scenario 12: a ledger write that fails after a pull is re-delivered, never lost', () => {

  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct-jobo' });
    setSyncPassphrase('correct horse battery staple');
  });
  afterAll(() => { delete global.localStorage; });

  it('the row is consumed by the cursor, re-fetched by the glitch heal, and lands once the store recovers', async () => {
    const vault = memVault();
    const record = rec();
    const a = createLedger({ store: memStore([record]) });
    await a.load();
    // B's store fails every write until told otherwise.
    const bStore = memStore([]);
    const original = bStore.update;
    let failing = true;
    bStore.update = (fn) => (failing ? Promise.resolve({ ok: false, error: 'storageWrite' }) : original(fn));
    const b = createLedger({ store: bStore });
    await b.load();
    const A = makeDevice('A', vault, a);
    const B = makeDevice('B', vault, b);

    await A.engine.dbSyncCycle();                       // A pushes the record
    expect(vault.has(jid(record))).toBe(true);
    await B.engine.dbSyncCycle();                       // B pulls it; the ledger write fails
    await settle();
    expect(b.get().records).toEqual([]);                // state is the committed value
    expect(b.get().error).toBe('storageWrite');
    // The cursor moved past the row: an incremental pull will never list it again.
    expect(B.engine.getHighWaterMark()).toBeGreaterThan(0);

    // MUTATION: release joboRecords from the baseline in agedOutReleaseReason
    // (or exclude it from the payload) and the vanish is neither healed nor
    // held: the row stays missing on B forever.
    failing = false;
    await B.engine.dbSyncCycle();                       // vanish vs snapshot → glitch → re-fetch → re-commit
    await settle();
    expect(b.get().records).toEqual([record]);
    expect(bStore.peek()).toEqual([record]);            // on disk, not just in state
    expect(b.get().error).toBe(null);

    // Nothing about the failure reached the vault or the other device.
    await A.engine.dbSyncCycle();
    await settle();
    expect(vault.has(jid(record))).toBe(true);
    expect(a.get().records).toEqual([record]);
  });
});

// 13. Completing a task writes a Do record, once, across two devices (slice 4).
//
// Each device runs the real planner and the real ledger, wired exactly as the
// hook wires them, over the vault simulator. The path under test is the one
// CLAUDE.md demands: the completion edge → the detector → recordJobo → state →
// payload → vault row → the other device's state, and back.
describe('scenario 13: the completion detector, end to end on two devices', () => {
  const DONE_AT = '2026-09-19T15:10:02-05:00';
  const t1 = { id: 't1', title: 'Draft the report', date: '2026-09-19', startTime: '14:30', duration: 60, completed: false, lastModified: '2026-09-19T14:00:00.000Z' };
  const tid = makeEntityId('tasks', 't1');

  // A device: task state, a loaded ledger, the detector's snapshot, and the
  // sim's vault client. `render` is what one React render does: plan, build,
  // commit, advance. `remote` is applyEngineData: task state replaced, ledger
  // rows handed to the hook, and the detector HELD for that render.
  async function device(name, tasks) {
    const ledger = createLedger({ store: memStore([]) });
    await ledger.load();
    const sim = createDevice(name, { ...EMPTY, tasks });
    const d = { name, tasks, ledger, sim, prev: null };
    d.render = async ({ observedAt, isRemoteApply = false } = {}) => {
      const next = snapshotJoboState(d.tasks, [], []);
      const { edges, advanceTo } = planJoboTransitions(d.prev, next, {
        tasks: d.tasks, isRemoteApply, loaded: ledger.get().loaded, writable: ledger.get().writable,
      });
      if (!edges) { if (advanceTo !== null) d.prev = advanceTo; return; }
      const records = buildJoboRecords(edges, ledger.workingSet(), { observedAt });
      if (records.length) expect((await ledger.commit(records)).ok).toBe(true);
      d.prev = next;
    };
    d.records = () => ledger.get().records;
    // buildSyncPayload → the sim's data; dirty what changed since the last
    // push, as the engine's snapshot diff does (a row pushed again unchanged
    // would overwrite a peer's winning copy at the vault).
    const pushed = new Map();
    d.push = (vault) => {
      sim.data.tasks = JSON.parse(JSON.stringify(d.tasks));
      sim.data.joboRecords = JSON.parse(JSON.stringify(d.records()));
      const rows = [[tid, d.tasks.find((t) => t.id === 't1')], ...d.records().map((r) => [jid(r), r])];
      for (const [entityId, value] of rows) {
        const text = JSON.stringify(value);
        if (pushed.get(entityId) !== text) { sim.markDirty(entityId); pushed.set(entityId, text); }
      }
      sim.push(vault);
    };
    // pull → applyEngineData: state from the mirror, rows to the hook, the
    // detector held during the apply and run again on the next quiet render.
    d.pull = async (vault, observedAt) => {
      sim.pull(vault);
      d.tasks = sim.data.tasks;
      await ledger.applyRemote(sim.data.joboRecords || []);
      await d.render({ observedAt, isRemoteApply: true });
      await d.render({ observedAt });
    };
    return d;
  }
  const complete = (tasks, completedAt, lastModified) => tasks.map((t) => (t.id === 't1' ? { ...t, completed: true, completedAt, lastModified } : t));
  const uncomplete = (tasks, lastModified) => tasks.map((t) => (t.id === 't1' ? { ...t, completed: false, completedAt: null, lastModified } : t));

  it('a completion on A becomes one record on both devices; B observing the same completion writes nothing new', async () => {
    const vault = createVault();
    const a = await device('A', [t1]);
    const b = await device('B', [t1]);
    await a.render();
    await b.render(); // first sight on both

    a.tasks = complete(a.tasks, DONE_AT, '2026-09-19T20:10:02.000Z');
    await a.render({ observedAt: '2026-09-19T20:10:03.000Z' });
    expect(a.records()).toHaveLength(1);                       // A: state
    const record = a.records()[0];
    expect(record).toMatchObject({ id: `do:t1:${DONE_AT}`, progress: 'completed', timing: 'untimed', updatedAt: DONE_AT });

    a.push(vault);                                             // A: payload → vault
    await b.pull(vault, '2026-09-19T20:10:30.000Z');           // B: apply → hook → state, then B's own detector sees the edge
    expect(b.tasks[0].completed).toBe(true);
    // MUTATION: replace ensure-present with a plain create and B writes a
    // second copy under the same id with its own observedAt, which then
    // loses to A's on the tie; equal here only by the merge, not by design.
    expect(b.records()).toEqual([record]);                     // B: the other device's state
    b.push(vault);
    await a.pull(vault, '2026-09-19T20:11:00.000Z');
    expect(a.records()).toEqual([record]);                     // nothing echoed back
  });

  it('two devices that each observe the completion before the record arrives converge on the earlier observer, on both tiers', async () => {
    const vault = createVault();
    const a = await device('A', [t1]);
    const b = await device('B', [t1]);
    await a.render();
    await b.render();
    // Both see the same completion (same stamp, from the completing device)
    // but B sees it after a rename, and later.
    a.tasks = complete(a.tasks, DONE_AT, '2026-09-19T20:10:02.000Z');
    await a.render({ observedAt: '2026-09-19T20:10:03.000Z' });
    b.tasks = complete(b.tasks.map((t) => ({ ...t, title: 'Draft the report, renamed' })), DONE_AT, '2026-09-19T20:10:02.000Z');
    await b.render({ observedAt: '2026-09-19T20:10:30.000Z' });
    expect(a.records()[0].id).toBe(b.records()[0].id);         // MUTATION: key on the observer's clock and these differ
    expect(a.records()[0].title).not.toBe(b.records()[0].title);

    a.push(vault); b.push(vault);
    await a.pull(vault, '2026-09-19T20:11:00.000Z');
    await b.pull(vault, '2026-09-19T20:11:00.000Z');
    a.push(vault); b.push(vault);
    await a.pull(vault, '2026-09-19T20:12:00.000Z');
    await b.pull(vault, '2026-09-19T20:12:00.000Z');
    expect(a.records()).toHaveLength(1);
    expect(b.records()).toEqual(a.records());
    expect(a.records()[0].title).toBe('Draft the report');     // the earlier observer

    // The file tier picks the same copy in either order.
    const early = { ...a.records()[0] };
    const late = { ...early, title: 'Draft the report, renamed', observedAt: '2026-09-19T20:10:30.000Z' };
    expect(mergeSyncData({ ...EMPTY, joboRecords: [early] }, { ...EMPTY, joboRecords: [late] }, 90).data.joboRecords).toEqual([early]);
    expect(mergeSyncData({ ...EMPTY, joboRecords: [late] }, { ...EMPTY, joboRecords: [early] }, 90).data.joboRecords).toEqual([early]);
  });

  it('un-completing drops the attempt to partial everywhere; completing again is a second attempt', async () => {
    const vault = createVault();
    const a = await device('A', [t1]);
    const b = await device('B', [t1]);
    await a.render();
    await b.render();
    a.tasks = complete(a.tasks, DONE_AT, '2026-09-19T20:10:02.000Z');
    await a.render({ observedAt: '2026-09-19T20:10:03.000Z' });
    a.push(vault);
    await b.pull(vault, '2026-09-19T20:10:30.000Z');
    const first = a.records()[0];

    // Uncheck on A. The live task has no stamp any more; the key is from prev.
    a.tasks = uncomplete(a.tasks, '2026-09-19T21:00:00.000Z');
    await a.render({ observedAt: '2026-09-19T21:00:00.500Z' });
    expect(a.records()).toHaveLength(1);
    expect(a.records()[0]).toMatchObject({ id: first.id, progress: 'partial', planSnapshot: first.planSnapshot });
    a.push(vault);
    await b.pull(vault, '2026-09-19T21:00:10.000Z');
    expect(b.tasks[0].completed).toBe(false);
    expect(b.records()[0].progress).toBe('partial');           // B: the reassessment, not a second uncheck
    expect(b.records()).toHaveLength(1);

    // Complete again on B, later: a new key, and the first attempt untouched.
    const AGAIN = '2026-09-19T17:30:00-05:00';
    b.tasks = complete(b.tasks, AGAIN, '2026-09-19T22:30:00.000Z');
    await b.render({ observedAt: '2026-09-19T22:30:01.000Z' });
    b.push(vault);
    await a.pull(vault, '2026-09-19T22:31:00.000Z');
    const ids = a.records().map((r) => r.id).sort();
    expect(ids).toEqual([`do:t1:${DONE_AT}`, `do:t1:${AGAIN}`]);
    expect(a.records().find((r) => r.id === first.id).progress).toBe('partial');
    expect(a.records().find((r) => r.id === `do:t1:${AGAIN}`).progress).toBe('completed');
    expect(b.records().map((r) => r.id).sort()).toEqual(ids);
  });

  it('a device with the flag off creates nothing from a completion it observes, and still forwards the record', async () => {
    const vault = createVault();
    const a = await device('A', [t1]);
    const b = await device('B', [t1]);
    await a.render();
    await b.render();
    a.tasks = complete(a.tasks, DONE_AT, '2026-09-19T20:10:02.000Z');
    // A has the flag off: the edge is consumed, no record.
    const next = snapshotJoboState(a.tasks, [], []);
    const plan = planJoboTransitions(a.prev, next, { tasks: a.tasks, enabled: false });
    expect(plan).toEqual({ edges: null, advanceTo: next });
    a.prev = next;
    expect(a.records()).toEqual([]);
    a.push(vault);
    await b.pull(vault, '2026-09-19T20:10:30.000Z');           // B has it on: B records A's completion
    expect(b.records()).toHaveLength(1);
    b.push(vault);
    await a.pull(vault, '2026-09-19T20:11:00.000Z');
    expect(a.records()).toHaveLength(1);                       // forwarded, not created
  });
});

// 14. The launch push before the ledger has loaded.
//
// buildSyncPayload omits `joboRecords` until the strict IndexedDB read
// completes, and the first cycle after launch usually runs before it does.
// The push diff compares the payload against the previous snapshot, and it
// used to read an omitted collection as an EMPTY one: every ledger row in the
// snapshot became a vanish-delete, the guard skipped each as a glitch and
// re-fetched it by id (23 row-gets and a wall of GUARD warnings per launch on
// a real account). An omitted kind is unknown, not empty: its snapshot entries
// carry forward untouched, and `[]` alone means empty.
describe('scenario 14: a payload that omits the ledger key at the launch push', () => {
  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct-jobo' });
    setSyncPassphrase('correct horse battery staple');
  });
  afterAll(() => { delete global.localStorage; });

  const guardWarnings = (spy) => spy.mock.calls.filter((args) => String(args[0]).includes('GUARD'));

  it('the carry helper: an omitted kind carries its snapshot entries, an empty one carries nothing', () => {
    const prev = { [jid(rec())]: 'h1', 'tasks:t1': 'h2', 'dailyNotes:2026-09-19': 'h3' };
    expect(absentCollectionKinds({ ...EMPTY })).toEqual(['joboRecords']);
    expect(absentCollectionKinds({ ...EMPTY, joboRecords: [] })).toEqual([]);
    expect(carryAbsentCollections(prev, { ...EMPTY })).toEqual({ [jid(rec())]: 'h1' });
    expect(carryAbsentCollections(prev, { ...EMPTY, joboRecords: [] })).toEqual({});
    // A payload with no tasks key either carries both kinds.
    const { tasks, ...noTasks } = EMPTY;
    expect(carryAbsentCollections(prev, noTasks)).toEqual({ [jid(rec())]: 'h1', 'tasks:t1': 'h2' });
    // The daily-notes date map follows the same rule (#2141): omitted until it
    // has loaded from IndexedDB, and an omitted map carries; {} does not.
    const { dailyNotes, ...noNotes } = EMPTY;
    expect(carryAbsentCollections(prev, { ...noNotes, joboRecords: [] })).toEqual({ 'dailyNotes:2026-09-19': 'h3' });
  });

  it('proposes no vanish-delete, re-fetches nothing, and re-pushes nothing once the ledger loads', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const vault = memVault();
      const record = rec();
      const store = memStore([record]);
      const snapshots = createMemoryKeyValue();
      const first = createLedger({ store });
      await first.load();
      const A = makeDevice('A', vault, first, snapshots);
      await A.engine.dbSyncCycle();                       // HWM=0 seed: the record reaches the vault
      await A.engine.dbSyncCycle();                       // the pull lists it; HWM advances; snapshot holds the row
      expect(vault.has(jid(record))).toBe(true);
      expect(A.engine.getHighWaterMark()).toBeGreaterThan(0);
      const pushesBefore = vault.calls.batch;

      // Relaunch: same device, same snapshot, a ledger whose strict read has
      // not completed. The payload has no joboRecords key at all.
      const relaunched = createLedger({ store });
      expect(payloadData(relaunched)).toEqual({});
      const A2 = makeDevice('A', vault, relaunched, snapshots);
      await A2.engine.dbSyncCycle();
      // MUTATION: drop carryAbsentCollections from the diff (`cur = baseHashes`)
      // and the row is a vanish-delete: the guard warns and getRow is called.
      expect(guardWarnings(warn)).toEqual([]);
      expect(vault.calls.getRow).toBe(0);
      expect(vault.calls.deleteRow).toBe(0);
      expect(vault.calls.batch).toBe(pushesBefore);
      expect(vault.has(jid(record))).toBe(true);

      // The ledger loads; the next cycle has nothing to say about the row.
      // MUTATION: save `vaultSnapshot` alone and the row is 'new' against the
      // saved snapshot: one more batch push here.
      await relaunched.load();
      expect(relaunched.get().records).toEqual([record]);
      await A2.engine.dbSyncCycle();
      expect(vault.calls.batch).toBe(pushesBefore);
      expect(guardWarnings(warn)).toEqual([]);
      expect(vault.has(jid(record))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('an empty loaded ledger still reads as empty: the vanish is proposed and the guard handles it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const vault = memVault();
      const record = rec();
      const snapshots = createMemoryKeyValue();
      const first = createLedger({ store: memStore([record]) });
      await first.load();
      const A = makeDevice('A', vault, first, snapshots);
      await A.engine.dbSyncCycle();
      await A.engine.dbSyncCycle();

      // Relaunch with a ledger that has loaded and is EMPTY (`joboRecords: []`).
      const emptied = createLedger({ store: memStore([]) });
      await emptied.load();
      expect(payloadData(emptied)).toEqual({ joboRecords: [] });
      const A2 = makeDevice('A', vault, emptied, snapshots);
      await A2.engine.dbSyncCycle();
      // The diff sees the row vanish; with no tombstone the guard keeps it and
      // re-fetches it, exactly as before this change.
      expect(guardWarnings(warn).length).toBeGreaterThan(0);
      expect(vault.calls.getRow).toBe(1);
      expect(vault.calls.deleteRow).toBe(0);
      expect(vault.has(jid(record))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

// #2141: daily notes moved to IndexedDB, and buildSyncPayload omits the map
// until they have loaded. A launch cycle that runs before then must not read
// every note in the snapshot as deleted.
describe('daily notes omitted from the payload until they have loaded', () => {
  beforeEach(() => {
    global.localStorage = memLocalStorage();
    setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 'tok', accountId: 'acct-notes' });
    setSyncPassphrase('correct horse battery staple');
  });
  afterAll(() => { delete global.localStorage; });

  function notesDevice(vault, snapshotStore, getNotes) {
    let data = JSON.parse(JSON.stringify(EMPTY));
    let nativeKey = null;
    const engine = createDbEngine({
      vaultClient: vault,
      storageKeyPrefix: 'notes-A',
      deviceId: 'device-A',
      snapshotStore,
      nativeGetSyncKey: () => nativeKey,
      nativeStoreSyncKey: (v) => { nativeKey = v; },
      getData: () => {
        const { dailyNotes, ...rest } = JSON.parse(JSON.stringify(data));
        const notes = getNotes();
        return notes === undefined ? rest : { ...rest, dailyNotes: notes };
      },
      commitData: (d) => { data = d; },
    });
    return engine;
  }

  it('proposes no note deletes before the load, and nothing to push after it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const vault = memVault();
      const snapshots = createMemoryKeyValue();
      const notes = { '2026-10-19': { text: 'journal', lastModified: T0 } };
      const nid = makeEntityId('dailyNotes', '2026-10-19');
      const first = notesDevice(vault, snapshots, () => notes);
      await first.dbSyncCycle();
      await first.dbSyncCycle();
      expect(vault.has(nid)).toBe(true);
      const pushesBefore = vault.calls.batch;

      // Relaunch before the IndexedDB read has finished: no dailyNotes key.
      let loaded;
      const relaunched = notesDevice(vault, snapshots, () => loaded);
      await relaunched.dbSyncCycle();
      // MUTATION: drop DATE_MAP_KIND from absentCollectionKinds and the note
      // is a vanish-delete the guard has to skip and re-fetch.
      expect(guardWarnings(warn)).toEqual([]);
      expect(vault.calls.getRow).toBe(0);
      expect(vault.calls.deleteRow).toBe(0);
      expect(vault.calls.batch).toBe(pushesBefore);
      expect(vault.has(nid)).toBe(true);

      // Loaded: the same notes, nothing to push.
      loaded = notes;
      await relaunched.dbSyncCycle();
      expect(vault.calls.batch).toBe(pushesBefore);
    } finally {
      warn.mockRestore();
    }
  });

  const guardWarnings = (spy) => spy.mock.calls.filter((args) => String(args[0]).includes('GUARD'));
});
