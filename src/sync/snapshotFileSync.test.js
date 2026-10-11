import { describe, it, expect, vi } from 'vitest';
import { runSnapshotFileCycle, classifySnapshotText, LOCAL_MODIFIED_KEY, RELAY_CONFIRM_MS, RELAY_STAGGER_MS, relayDecision, relayWaitMs, noteWriter, readWriters } from './snapshotFileSync.js';
import { MISSING_GRACE_MS } from '../utils/icloudSeedGuard.js';

// Every guard the App.jsx iCloud loop carried, asserted at the one place a
// second transport will now share it. Each test names the guard it protects;
// removing that guard from runSnapshotFileCycle makes the test fail.

const T0 = 1_700_000_000_000;

const makeStorage = (initial = {}) => {
  const m = { ...initial };
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
    dump: () => ({ ...m }),
  };
};

const task = (id, extra = {}) => ({ id, title: id, date: '2026-10-01', lastModified: '2026-10-01T00:00:00.000Z', ...extra });
const data = (tasks = [], unscheduledTasks = []) => ({ tasks, unscheduledTasks });
const envelope = (d, lastModified = '2026-10-02T00:00:00.000Z') => JSON.stringify({ version: 2, lastModified, data: d });

const makeTransport = (over = {}) => ({
  id: 'fake',
  read: vi.fn(async () => null),
  write: vi.fn(async () => true),
  lastSyncedKey: 'fake-last-synced',
  firstRunDecided: () => true,
  writeThrottleMs: 5000,
  allowsPlaintextReseed: true,
  ...over,
});

const makeIo = (over = {}) => ({
  buildSyncPayload: () => ({ version: 2, data: data() }),
  applyEngineData: vi.fn(),
  // Default merge: take the remote copy whole and report it as a local change.
  mergeSyncData: vi.fn((local, remote) => ({ data: remote, localChanged: true, remoteChanged: false })),
  stripHealthSourcedLogs: vi.fn((payload) => payload),
  habits: [],
  syncRetentionDays: 90,
  isEncryptedEnvelope: (e) => !!e?.__encrypted,
  decryptData: vi.fn(async () => { throw new Error('no key'); }),
  storage: makeStorage(),
  // By default the device has a change of its own to write (an edit stamped
  // at T0, after any read); relay tests override this with null.
  lastLocalEditAt: () => new Date(T0).toISOString(),
  now: () => T0,
  log: { warn: vi.fn(), error: vi.fn() },
  ...over,
});

const fresh = { missingSince: 0, lastWriteAt: 0 };
const written = (transport, n = 0) => JSON.parse(transport.write.mock.calls[n][0]);

// A relay (no change of this device's own) waits RELAY_CONFIRM_MS for the
// file to catch up: this runs the cycle, and if it deferred, runs it again
// that much later and returns the second result. An own edit writes at once,
// and then this is just the one cycle.
const settled = async ({ transport, io, state }) => {
  const first = await runSnapshotFileCycle({ transport, io, state });
  if (first.outcome.kind !== 'merged' || !first.outcome.deferred) return first;
  const clock = io.now;
  io.now = () => clock() + RELAY_CONFIRM_MS;
  try { return await runSnapshotFileCycle({ transport, io, state: first.state }); }
  finally { io.now = clock; }
};

describe('classifySnapshotText', () => {
  it('distinguishes absent, placeholder, error, garbage and a snapshot', () => {
    expect(classifySnapshotText(null)).toEqual({ kind: 'absent' });
    expect(classifySnapshotText('')).toEqual({ kind: 'absent' });
    expect(classifySnapshotText('null')).toEqual({ kind: 'absent' });
    expect(classifySnapshotText('{"downloading":true}')).toEqual({ kind: 'downloading' });
    expect(classifySnapshotText('{"error":"iCloud not available"}')).toEqual({ kind: 'error', error: 'iCloud not available' });
    expect(classifySnapshotText('{"version":2,"da')).toEqual({ kind: 'unparseable' });
    expect(classifySnapshotText(envelope(data())).kind).toBe('snapshot');
  });
});

describe('absent snapshot', () => {
  it('seeds the file from local data on a device that has never synced', async () => {
    const transport = makeTransport();
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('a')]) }) });
    const { state, outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'seeded', wrote: true });
    expect(written(transport).data.tasks).toHaveLength(1);
    expect(state.missingSince).toBe(0);
  });

  it('guard: an absence on a device that HAS synced is treated as eviction until the grace window passes', async () => {
    const transport = makeTransport();
    const io = makeIo({ storage: makeStorage({ 'fake-last-synced': '2026-10-01T00:00:00.000Z' }) });

    const first = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(first.outcome).toEqual({ kind: 'skipped', reason: 'missing-grace' });
    expect(first.state.missingSince).toBe(T0);
    expect(transport.write).not.toHaveBeenCalled();

    // Still inside the window: keeps waiting, preserving the original sighting.
    io.now = () => T0 + MISSING_GRACE_MS - 1;
    const second = await runSnapshotFileCycle({ transport, io, state: first.state });
    expect(second.outcome.reason).toBe('missing-grace');
    expect(second.state.missingSince).toBe(T0);

    // Past it: really gone, so seed again and clear the streak.
    io.now = () => T0 + MISSING_GRACE_MS;
    const third = await runSnapshotFileCycle({ transport, io, state: second.state });
    expect(third.outcome.kind).toBe('seeded');
    expect(third.state.missingSince).toBe(0);
  });

  it('guard: never seeds an empty payload over a localStorage that holds tasks (state not hydrated)', async () => {
    const transport = makeTransport();
    const io = makeIo({
      storage: makeStorage({ 'day-planner-tasks': JSON.stringify([task('stored')]) }),
      buildSyncPayload: () => ({ version: 2, data: data() }),
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'empty-state-guard' });
    expect(transport.write).not.toHaveBeenCalled();
  });

  it('counts inbox items in that guard too', async () => {
    const transport = makeTransport();
    const io = makeIo({
      storage: makeStorage({ 'day-planner-unscheduled': JSON.stringify([{ id: 'u' }]) }),
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.reason).toBe('empty-state-guard');
  });
});

describe('placeholder, garbage and error reads', () => {
  it('skips a downloading placeholder without writing or stamping', async () => {
    const transport = makeTransport({ read: async () => '{"downloading":true}' });
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'downloading' });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.storage.getItem('fake-last-synced')).toBeNull();
  });

  it('skips a half-written file (daemon mid-write) rather than seeding over it', async () => {
    const transport = makeTransport({ read: async () => '{"version":2,"data":{"tas' });
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'unparseable' });
    expect(transport.write).not.toHaveBeenCalled();
  });

  it('surfaces an error object and touches nothing', async () => {
    const transport = makeTransport({ read: async () => '{"error":"iCloud not available"}' });
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'error', reason: 'unavailable', error: 'iCloud not available' });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.applyEngineData).not.toHaveBeenCalled();
    expect(io.storage.getItem('fake-last-synced')).toBeNull();
  });

  it('skips an envelope with no data', async () => {
    const transport = makeTransport({ read: async () => JSON.stringify({ version: 2 }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io: makeIo(), state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'no-data' });
  });
});

describe('a real snapshot', () => {
  it('stamps the transport\'s own last-synced key and clears the eviction clock', async () => {
    const transport = makeTransport({ read: async () => envelope(data([task('r')])) });
    const io = makeIo();
    const { state } = await runSnapshotFileCycle({ transport, io, state: { missingSince: T0 - 1000, lastWriteAt: 0 } });
    expect(io.storage.getItem('fake-last-synced')).toBe(new Date(T0).toISOString());
    expect(state.missingSince).toBe(0);
  });

  it('applies the merged data locally when the merge changed local, and stamps local-modified', async () => {
    const remote = data([task('r')]);
    const transport = makeTransport({ read: async () => envelope(remote) });
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    // The merged copy IS the file's copy, so there is nothing to write back.
    expect(outcome).toMatchObject({ kind: 'merged', localChanged: true, remoteChanged: false, applied: true, wrote: false });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.mergeSyncData).toHaveBeenCalledWith(data(), remote, 90);
    expect(io.applyEngineData).toHaveBeenCalledWith(remote, { allowEmpty: true });
    expect(io.storage.getItem(LOCAL_MODIFIED_KEY)).toBe(new Date(T0).toISOString());
  });

  it('allowEmpty follows the presence of a remote lastModified', async () => {
    const transport = makeTransport({ read: async () => JSON.stringify({ version: 2, data: data([task('r')]) }) });
    const io = makeIo();
    await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(io.applyEngineData).toHaveBeenCalledWith(expect.anything(), { allowEmpty: false });
  });

  it('writes a fresh version-2 envelope when either side changed, and nothing when neither did', async () => {
    const remote = data([task('r')]);
    const transport = makeTransport({ read: async () => envelope(remote) });

    const quiet = makeIo({ mergeSyncData: () => ({ data: remote, localChanged: false, remoteChanged: false }) });
    const a = await runSnapshotFileCycle({ transport, io: quiet, state: fresh });
    expect(a.outcome).toMatchObject({ kind: 'merged', wrote: false });
    expect(transport.write).not.toHaveBeenCalled();
    expect(quiet.applyEngineData).not.toHaveBeenCalled();

    const merged = data([task('r'), task('l')]);
    const remoteOnly = makeIo({ mergeSyncData: () => ({ data: merged, localChanged: false, remoteChanged: true }) });
    const b = await settled({ transport, io: remoteOnly, state: fresh });
    expect(b.outcome).toMatchObject({ wrote: true });
    expect(remoteOnly.applyEngineData).not.toHaveBeenCalled();
    expect(written(transport)).toEqual({ version: 2, lastModified: new Date(T0).toISOString(), data: merged });
  });

  it('guard: HealthKit-derived counts are stripped from every outgoing copy, never from the local apply', async () => {
    const remote = data([task('r')]);
    const transport = makeTransport({ read: async () => envelope(remote) });
    const habits = [{ id: 'h', source: 'health' }];
    const merged = data([task('r'), task('l')]);
    const io = makeIo({
      habits,
      mergeSyncData: () => ({ data: merged, localChanged: true, remoteChanged: true }),
      stripHealthSourcedLogs: vi.fn((p) => ({ ...p, stripped: true })),
    });
    await settled({ transport, io, state: fresh });
    expect(io.stripHealthSourcedLogs).toHaveBeenCalledWith(expect.objectContaining({ data: merged }), habits);
    expect(written(transport).stripped).toBe(true);
    expect(io.applyEngineData.mock.calls[0][0].stripped).toBeUndefined();

    // Seeding strips as well (a never-synced device, so a fresh storage).
    const seeding = makeTransport();
    const seedIo = makeIo({
      habits,
      buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }),
      stripHealthSourcedLogs: (p) => ({ ...p, stripped: true }),
    });
    await runSnapshotFileCycle({ transport: seeding, io: seedIo, state: fresh });
    expect(written(seeding).stripped).toBe(true);
  });
});

describe('guard: the health strip follows the transport', () => {
  // Apple's guideline 5.1.3 is about Apple's container. The iCloud transport
  // strips HealthKit-derived counts; a Direct Access folder is the user's own
  // cloud and carries them, like GLANCEvault and WebDAV do. Stripping there
  // kept an Android phone's Health Connect steps from reaching the Macs
  // (2026-10-07).
  const habits = [{ id: 'steps', source: 'healthConnect' }];
  const strip = vi.fn((p) => ({ ...p, stripped: true }));

  it('a transport that says stripsHealthLogs: false writes the counts whole, on merge and on seed', async () => {
    const remote = data([task('r')]);
    const merged = data([task('r'), task('l')]);
    const transport = makeTransport({ stripsHealthLogs: false, read: async () => envelope(remote) });
    const io = makeIo({ habits, mergeSyncData: () => ({ data: merged, localChanged: true, remoteChanged: true }), stripHealthSourcedLogs: strip });
    await settled({ transport, io, state: fresh });
    expect(strip).not.toHaveBeenCalled();
    expect(written(transport).stripped).toBeUndefined();

    const seeding = makeTransport({ stripsHealthLogs: false });
    await runSnapshotFileCycle({ transport: seeding, io: makeIo({ habits, buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }), stripHealthSourcedLogs: strip }), state: fresh });
    expect(strip).not.toHaveBeenCalled();
    expect(written(seeding).stripped).toBeUndefined();
  });

  it('a transport that says true, or says nothing, strips as before', async () => {
    for (const over of [{ stripsHealthLogs: true }, {}]) {
      const t = makeTransport({ ...over, read: async () => envelope(data([task('r')])) });
      const io = makeIo({ habits, mergeSyncData: () => ({ data: data([task('r'), task('l')]), localChanged: true, remoteChanged: true }), stripHealthSourcedLogs: (p) => ({ ...p, stripped: true }) });
      await settled({ transport: t, io, state: fresh });
      expect(written(t).stripped).toBe(true);
    }
  });

  it('SCENARIO (2026-10-07): Health Connect steps on the phone reach a Mac over the folder, with the real merge and strip', async () => {
    const { mergeSyncData } = await import('../mergeSync.js');
    const { stripHealthSourcedLogs } = await import('../utils/healthLogFilter.js');
    const base = { tasks: [task('a')], unscheduledTasks: [], recycleBin: [], completedTaskUids: [], deletedTaskIds: {}, habits, habitLogs: {}, habitLogTimestamps: {} };
    const phone = { ...base, habitLogs: { '2026-10-07': { steps: 6543 } }, habitLogTimestamps: { '2026-10-07:steps': '2026-10-07T12:00:00.000Z' } };
    const file = mergeSyncData(base, base, 90).data;                       // what the Macs wrote: no counts
    const real = (over) => makeIo({ habits, mergeSyncData, stripHealthSourcedLogs, ...over });

    // The phone's cycle over a Direct Access folder: the write carries the steps.
    const folder = makeTransport({ stripsHealthLogs: false, read: async () => envelope(file) });
    const r1 = await settled({ transport: folder, io: real({ buildSyncPayload: () => ({ version: 2, data: phone }) }), state: fresh });
    expect(r1.outcome).toMatchObject({ kind: 'merged', wrote: true });
    expect(written(folder).data.habitLogs['2026-10-07']).toEqual({ steps: 6543 });

    // A Mac reads that file: it has no health store, so it adopts the counts.
    const onMac = makeTransport({ stripsHealthLogs: false, read: async () => folder.write.mock.calls[0][0] });
    const macIo = real({ buildSyncPayload: () => ({ version: 2, data: file }) });
    const r2 = await runSnapshotFileCycle({ transport: onMac, io: macIo, state: fresh });
    expect(r2.outcome).toMatchObject({ kind: 'merged', applied: true });
    expect(macIo.applyEngineData.mock.calls[0][0].habitLogs['2026-10-07']).toEqual({ steps: 6543 });

    // The same phone over iCloud: the strip holds, and the counts never leave the device.
    const icloud = makeTransport({ stripsHealthLogs: true, read: async () => envelope(file) });
    const r3 = await settled({ transport: icloud, io: real({ buildSyncPayload: () => ({ version: 2, data: phone }) }), state: fresh });
    expect(r3.outcome.wrote).toBe(false);
    expect(icloud.write).not.toHaveBeenCalled();
  });
});

describe('first-run restore prompt', () => {
  const populated = () => makeTransport({
    read: async () => envelope(data([task('r1'), task('r2')], [task('i1')]), '2026-10-03T00:00:00.000Z'),
    firstRunDecided: () => false,
  });

  it('guard: a fresh device facing a populated snapshot is asked, not restored', async () => {
    const transport = populated();
    const io = makeIo();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    // The package hands the prompt the remote `data` too, for apps whose
    // slices it does not name; dayGLANCE's prompt reads the two counts.
    expect(outcome).toMatchObject({
      kind: 'prompted',
      info: { taskCount: 2, inboxCount: 1, lastModified: '2026-10-03T00:00:00.000Z' },
    });
    expect(io.applyEngineData).not.toHaveBeenCalled();
    expect(transport.write).not.toHaveBeenCalled();
    // The stamp lands before the prompt: reading the snapshot proved the transport.
    expect(io.storage.getItem('fake-last-synced')).toBe(new Date(T0).toISOString());
  });

  it('does not ask once a decision is recorded', async () => {
    const transport = populated();
    transport.firstRunDecided = () => true;
    const { outcome } = await runSnapshotFileCycle({ transport, io: makeIo(), state: fresh });
    expect(outcome.kind).toBe('merged');
  });

  it('does not ask a device that has data of its own (ordinary merge)', async () => {
    const transport = populated();
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.kind).toBe('merged');
  });

  it('does not ask when the snapshot carries no tasks (nothing to restore)', async () => {
    const transport = makeTransport({ read: async () => envelope(data()), firstRunDecided: () => false });
    const { outcome } = await runSnapshotFileCycle({ transport, io: makeIo(), state: fresh });
    expect(outcome.kind).toBe('merged');
  });
});

describe('encrypted envelopes', () => {
  const sealed = () => makeTransport({
    read: async () => JSON.stringify({ __encrypted: true, blob: 'x' }),
  });

  it('decrypts with the cached key and merges the plaintext', async () => {
    const transport = sealed();
    const inner = { version: 2, lastModified: '2026-10-02T00:00:00.000Z', data: data([task('r')]) };
    const io = makeIo({ decryptData: vi.fn(async () => inner) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.kind).toBe('merged');
    expect(io.mergeSyncData).toHaveBeenCalledWith(data(), inner.data, 90);
  });

  it('iCloud: an undecryptable legacy envelope is replaced by local plaintext', async () => {
    const transport = sealed();
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'reseeded', wrote: true });
    expect(written(transport).data.tasks[0].id).toBe('mine');
    expect(io.log.warn).toHaveBeenCalled();
  });

  it('guard: a transport that forbids plaintext reseed never writes over a file it cannot read', async () => {
    const transport = sealed();
    transport.allowsPlaintextReseed = false;
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'encrypted-unreadable', needsKey: false });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.applyEngineData).not.toHaveBeenCalled();
  });
});

describe('Phase 6: the file decides, the switch decides the first write', () => {
  // A fake of @glance-apps/sync's envelope: the plaintext JSON, base64, under
  // the real envelope header, sealed and opened with a shared "key" flag.
  const seal = (payload) => ({ v: 1, enc: 'AES-GCM-256', data: Buffer.from(JSON.stringify(payload)).toString('base64') });
  const open = (env) => JSON.parse(Buffer.from(env.data, 'base64').toString());
  const isSealed = (v) => !!v && v.v === 1 && v.enc === 'AES-GCM-256' && typeof v.data === 'string';
  const crypto = (ready = true) => ({
    isEncryptedEnvelope: isSealed,
    encryptData: vi.fn(async (p) => { if (!ready) throw new Error('Encryption key not available'); return seal(p); }),
    decryptData: vi.fn(async (e) => { if (!ready) { const err = new Error('Encryption key not available'); err.code = 'PASSPHRASE_REQUIRED'; throw err; } return open(e); }),
    encryptionReady: () => ready,
  });
  const plain = (d) => JSON.stringify({ version: 2, lastModified: '2026-10-02T00:00:00.000Z', data: d });
  const sealedText = (d) => JSON.stringify(seal({ version: 2, lastModified: '2026-10-02T00:00:00.000Z', data: d }));
  const folderTransport = (text, encrypts = false) => makeTransport({
    read: async () => text,
    allowsPlaintextReseed: false,
    encryptsWrites: () => encrypts,
  });
  const realMerge = (local, remote) => {
    const ids = new Set(local.tasks.map((t) => t.id));
    const tasks = [...local.tasks, ...remote.tasks.filter((t) => !ids.has(t.id))];
    return { data: { tasks, unscheduledTasks: [] }, localChanged: tasks.length > local.tasks.length, remoteChanged: tasks.length > remote.tasks.length };
  };

  it('upgrade: the switch is on and a plaintext file is read → the write is an envelope', async () => {
    const transport = folderTransport(plain(data([task('r')])), true);
    const io = makeIo({ ...crypto(), buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }), mergeSyncData: realMerge });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', wrote: true, keyNeeded: false });
    const file = written(transport);
    expect(isSealed(file)).toBe(true);
    expect(open(file).data.tasks.map((t) => t.id).sort()).toEqual(['mine', 'r']);
  });

  it('guard: never downgrade. An envelope is read and the switch is off → the write is still an envelope', async () => {
    const transport = folderTransport(sealedText(data([task('r')])), false);
    const io = makeIo({ ...crypto(), buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }), mergeSyncData: realMerge });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', wrote: true });
    expect(isSealed(written(transport))).toBe(true);
    expect(io.applyEngineData).toHaveBeenCalled();                    // the plaintext was applied
  });

  it('seed: an absent file is seeded as an envelope when the switch is on, plaintext when off', async () => {
    const on = folderTransport(null, true);
    const io = makeIo({ ...crypto(), buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    expect((await runSnapshotFileCycle({ transport: on, io, state: fresh })).outcome).toEqual({ kind: 'seeded', wrote: true });
    expect(isSealed(written(on))).toBe(true);
    const off = folderTransport(null, false);
    await runSnapshotFileCycle({ transport: off, io, state: fresh });
    expect(isSealed(written(off))).toBe(false);
    expect(written(off).data.tasks[0].id).toBe('mine');
  });

  it('guard: the strip reads plaintext — health counts are stripped before the envelope, not lost inside it', async () => {
    const transport = folderTransport(null, true);
    transport.stripsHealthLogs = true;
    const io = makeIo({ ...crypto(), buildSyncPayload: () => ({ version: 2, data: { ...data([task('mine')]), habitLogs: [{ id: 'h' }] } }),
      stripHealthSourcedLogs: vi.fn((payload) => ({ ...payload, data: { ...payload.data, habitLogs: [] } })) });
    await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(io.stripHealthSourcedLogs).toHaveBeenCalled();
    expect(open(written(transport)).data.habitLogs).toEqual([]);
  });

  it('key gate: an envelope is read and no key or passphrase is in memory → nothing applied, nothing written, needsKey', async () => {
    const transport = folderTransport(sealedText(data([task('r')])), false);
    const io = makeIo({ ...crypto(false), buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'encrypted-unreadable', needsKey: true });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.applyEngineData).not.toHaveBeenCalled();
    expect(io.storage.getItem(transport.lastSyncedKey)).toBeNull();
  });

  it('key gate: the switch is on, the file is plaintext and no key is ready → the plaintext is applied, the write is held, never plaintext', async () => {
    const transport = folderTransport(plain(data([task('r')])), true);
    const io = makeIo({ ...crypto(false), buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }), mergeSyncData: realMerge });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', applied: true, wrote: false, keyNeeded: true });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.encryptData).not.toHaveBeenCalled();
  });

  it('key gate: seeding with the switch on and no key ready is skipped, not written plaintext', async () => {
    const transport = folderTransport(null, true);
    const io = makeIo({ ...crypto(false), buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'skipped', reason: 'key-needed' });
    expect(transport.write).not.toHaveBeenCalled();
  });

  it('a transport without the switch, and an io without encryptData, behave exactly as before (plaintext)', async () => {
    const transport = makeTransport({ read: async () => plain(data([task('r')])) });
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }), mergeSyncData: realMerge });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', wrote: true, keyNeeded: false });
    expect(isSealed(written(transport))).toBe(false);
  });

  it('SCENARIO: two devices on one folder; one turns the switch on, the file becomes an envelope, the other is prompted, then they converge', async () => {
    const folder = { text: plain(data([task('shared')])) };
    const device = (name, tasks, { encrypts = false, ready = true } = {}) => {
      const dev = { tasks, applied: null, state: { ...fresh }, clock: T0 };
      dev.transport = makeTransport({
        id: name,
        read: async () => folder.text,
        write: vi.fn(async (text) => { folder.text = text; return true; }),
        allowsPlaintextReseed: false,
        encryptsWrites: () => encrypts,
        writeThrottleMs: 0,
      });
      dev.io = makeIo({
        ...crypto(ready),
        buildSyncPayload: () => ({ version: 2, data: data(dev.applied ?? dev.tasks) }),
        applyEngineData: vi.fn((d) => { dev.applied = d.tasks; }),
        mergeSyncData: realMerge,
        now: () => dev.clock,
      });
      dev.run = async () => {
        const r = await runSnapshotFileCycle({ transport: dev.transport, io: dev.io, state: dev.state });
        dev.state = r.state;
        return r.outcome;
      };
      dev.setReady = (ready) => { Object.assign(dev.io, crypto(ready)); };
      return dev;
    };
    const a = device('A', [task('shared'), task('from-a')], { encrypts: true });
    const b = device('B', [task('shared')], { ready: false });
    // A's switch is on: its next write seals the file.
    expect(await a.run()).toMatchObject({ kind: 'merged', wrote: true });
    expect(isSealed(JSON.parse(folder.text))).toBe(true);
    // B has no key: it is prompted and touches nothing.
    expect(await b.run()).toEqual({ kind: 'skipped', reason: 'encrypted-unreadable', needsKey: true });
    expect(b.io.applyEngineData).not.toHaveBeenCalled();
    // The passphrase is entered on B: it reads the envelope, applies, and its own later edit goes out sealed.
    b.setReady(true);
    expect(await b.run()).toMatchObject({ kind: 'merged', applied: true });
    expect(b.applied.map((t) => t.id).sort()).toEqual(['from-a', 'shared']);
    b.applied = [...b.applied, task('from-b')];
    b.clock += 1000;
    b.io.lastLocalEditAt = () => new Date(b.clock).toISOString();
    expect(await b.run()).toMatchObject({ kind: 'merged', wrote: true });
    expect(isSealed(JSON.parse(folder.text))).toBe(true);
    // A, switch now OFF, still follows the file: reads B's edit, and writes nothing plaintext ever.
    Object.assign(a.transport, { encryptsWrites: () => false });
    expect(await a.run()).toMatchObject({ kind: 'merged', applied: true });
    expect(a.applied.map((t) => t.id).sort()).toEqual(['from-a', 'from-b', 'shared']);
    for (const call of [...a.transport.write.mock.calls, ...b.transport.write.mock.calls]) {
      expect(isSealed(JSON.parse(call[0]))).toBe(true);
    }
  });
});

describe('relayDecision (the rule the event-set cycle shares)', () => {
  it('starts a look on a new fingerprint, keeps it on the same one, writes once it is RELAY_CONFIRM_MS old, and starts over on a different one', () => {
    const first = relayDecision(null, 'A', T0);
    expect(first).toEqual({ write: false, pending: { fingerprint: 'A', at: T0 } });
    const same = relayDecision(first.pending, 'A', T0 + 1000);
    expect(same).toEqual({ write: false, pending: { fingerprint: 'A', at: T0 } });
    expect(relayDecision(same.pending, 'A', T0 + RELAY_CONFIRM_MS - 1).write).toBe(false);
    expect(relayDecision(same.pending, 'A', T0 + RELAY_CONFIRM_MS)).toEqual({ write: true, pending: { fingerprint: 'A', at: T0 } });
    expect(relayDecision(same.pending, 'B', T0 + RELAY_CONFIRM_MS)).toEqual({ write: false, pending: { fingerprint: 'B', at: T0 + RELAY_CONFIRM_MS } });
  });
});

describe('guard: made here, or relayed', () => {
  const file = data([task('r')]);
  const merged = data([task('r'), task('l')]);
  const iso = (t) => new Date(t).toISOString();
  // A change that reached this device by another road: no edit of its own.
  const relaying = (over = {}) => makeIo({ lastLocalEditAt: () => null, mergeSyncData: () => ({ data: merged, localChanged: false, remoteChanged: true }), ...over });

  it('a change made here is written at once (the Mac that created a task, 2026-10-08 21:06)', async () => {
    const transport = makeTransport({ read: async () => envelope(file) });
    const io = makeIo({ mergeSyncData: () => ({ data: merged, localChanged: false, remoteChanged: true }) });
    const { state, outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', wrote: true, deferred: false, ownEdits: true });
    expect(written(transport).data).toEqual(merged);
    expect(state.lastWrittenAt).toBe(T0);
    expect(state.pendingWrite).toBeNull();
  });

  it('a relay defers, and the apply is not deferred', async () => {
    const transport = makeTransport({ read: async () => envelope(file) });
    const io = relaying({ mergeSyncData: () => ({ data: merged, localChanged: true, remoteChanged: true }) });
    const { state, outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', wrote: false, deferred: true, applied: true, ownEdits: false });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.applyEngineData).toHaveBeenCalledTimes(1);
    expect(state.pendingWrite).toEqual({ fingerprint: expect.any(String), at: T0 });
  });

  it('SCENARIO (2026-10-08): the change came by the vault first; the folder catches up, and the relay is dropped', async () => {
    // The second Mac learned of an iPhone's edit from GLANCEvault seconds
    // before its Nextcloud client delivered the phone's file. It wrote the
    // same data with a fresh stamp, and Nextcloud reported a conflict.
    let onDisk = envelope(file, '2026-10-08T14:26:20.000Z');
    const transport = makeTransport({ read: async () => onDisk });
    const io = relaying({
      buildSyncPayload: () => ({ version: 2, data: merged }),
      mergeSyncData: (local, remote) => ({ data: merged, localChanged: false, remoteChanged: remote.tasks.length < merged.tasks.length }),
    });
    const a = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(a.outcome).toMatchObject({ deferred: true });
    onDisk = envelope(merged, '2026-10-08T14:26:35.000Z');  // the phone's version arrives
    io.now = () => T0 + 15_000;
    const b = await runSnapshotFileCycle({ transport, io, state: a.state });
    expect(b.outcome).toMatchObject({ kind: 'merged', wrote: false, deferred: false });
    expect(transport.write).not.toHaveBeenCalled();
    expect(b.state.pendingWrite).toBeNull();
  });

  it('a relay goes out once the file has sat unchanged, still lacking it, for RELAY_CONFIRM_MS; a kick sooner does not', async () => {
    const transport = makeTransport({ read: async () => envelope(file) });
    const io = relaying();
    const a = await runSnapshotFileCycle({ transport, io, state: fresh });
    io.now = () => T0 + RELAY_CONFIRM_MS - 1;
    const b = await runSnapshotFileCycle({ transport, io, state: a.state });
    expect(b.outcome).toMatchObject({ wrote: false, deferred: true });
    expect(b.state.pendingWrite.at).toBe(T0);
    io.now = () => T0 + RELAY_CONFIRM_MS;
    const c = await runSnapshotFileCycle({ transport, io, state: b.state });
    expect(c.outcome).toMatchObject({ wrote: true, deferred: false, ownEdits: false });
    expect(c.state.lastWrittenAt).toBe(T0 + RELAY_CONFIRM_MS);
  });

  it('a file that changed in between, with the difference still there, starts the relay over', async () => {
    let onDisk = envelope(file, '2026-10-08T14:26:20.000Z');
    const transport = makeTransport({ read: async () => onDisk });
    const io = relaying();
    const a = await runSnapshotFileCycle({ transport, io, state: fresh });
    onDisk = envelope(file, '2026-10-08T14:26:35.000Z');    // someone rewrote it, still without the task
    io.now = () => T0 + RELAY_CONFIRM_MS;
    const b = await runSnapshotFileCycle({ transport, io, state: a.state });
    expect(b.outcome).toMatchObject({ wrote: false, deferred: true });
    expect(b.state.pendingWrite.at).toBe(T0 + RELAY_CONFIRM_MS);
  });

  it('an edit older than the last read of this file is not "made here, unwritten": the device relays', async () => {
    // The other Mac had edited hours ago and read the file every 15 s since;
    // the task it now holds came by the vault.
    const transport = makeTransport({ read: async () => envelope(file) });
    const io = relaying({
      lastLocalEditAt: () => iso(T0 - 3_600_000),
      storage: makeStorage({ 'fake-last-synced': iso(T0 - 15_000) }),
    });
    const { outcome, state } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ wrote: false, deferred: true, ownEdits: false });
    expect(state.lastWrittenAt).toBe(T0 - 15_000);
    // An edit since that read IS made here.
    const io2 = relaying({ lastLocalEditAt: () => iso(T0 - 5_000), storage: makeStorage({ 'fake-last-synced': iso(T0 - 15_000) }) });
    const t2 = makeTransport({ read: async () => envelope(file) });
    expect((await runSnapshotFileCycle({ transport: t2, io: io2, state: fresh })).outcome).toMatchObject({ wrote: true, ownEdits: true });
  });

  it('a successful write moves the baseline: the next difference without a new edit is a relay', async () => {
    let onDisk = envelope(file);
    const transport = makeTransport({ read: async () => onDisk });
    const io = makeIo({ mergeSyncData: () => ({ data: merged, localChanged: false, remoteChanged: true }) });
    const a = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(a.outcome).toMatchObject({ wrote: true, ownEdits: true });
    // The file still lacks the task (the write did not land yet, or was undone elsewhere): no new edit here.
    io.now = () => T0 + 15_000;
    const b = await runSnapshotFileCycle({ transport, io, state: a.state });
    expect(b.outcome).toMatchObject({ wrote: false, deferred: true, ownEdits: false });
  });

  it('a cycle that wants no write clears the pending relay', async () => {
    const transport = makeTransport({ read: async () => envelope(file) });
    const a = await runSnapshotFileCycle({ transport, io: relaying(), state: fresh });
    expect(a.state.pendingWrite).not.toBeNull();
    const quiet = makeIo({ mergeSyncData: () => ({ data: file, localChanged: false, remoteChanged: false }) });
    const b = await runSnapshotFileCycle({ transport, io: quiet, state: a.state });
    expect(b.state.pendingWrite).toBeNull();
  });

  it('seeding an absent file is not deferred: nothing could have raced it', async () => {
    const transport = makeTransport();
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('a')]) }) });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'seeded', wrote: true });
  });
});

describe('write throttle', () => {
  it('guard: skips writes inside the transport\'s window and resumes after it', async () => {
    const remote = data([task('r')]);
    const transport = makeTransport({ read: async () => envelope(remote) });
    const merged = data([task('r'), task('l')]);
    const io = makeIo({ mergeSyncData: () => ({ data: merged, localChanged: false, remoteChanged: true }) });

    // The device keeps editing (its edit stamp follows the clock), so every
    // cycle has a change of its own and only the window holds it back.
    io.lastLocalEditAt = () => new Date(io.now()).toISOString();
    const a = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(a.outcome.wrote).toBe(true);
    expect(a.state.lastWriteAt).toBe(T0);

    io.now = () => T0 + 4999;
    const b = await runSnapshotFileCycle({ transport, io, state: a.state });
    expect(b.outcome).toMatchObject({ kind: 'merged', wrote: false, deferred: false, ownEdits: true });
    expect(b.state.lastWriteAt).toBe(T0);
    expect(transport.write).toHaveBeenCalledTimes(1);

    io.now = () => T0 + 5000;
    const c = await runSnapshotFileCycle({ transport, io, state: b.state });
    expect(c.outcome.wrote).toBe(true);
    expect(transport.write).toHaveBeenCalledTimes(2);
  });

  it('a failed write is logged and still counts against the window', async () => {
    const transport = makeTransport({ write: vi.fn(async () => false) });
    const io = makeIo({ buildSyncPayload: () => ({ version: 2, data: data([task('a')]) }) });
    const { state, outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toEqual({ kind: 'seeded', wrote: false });
    expect(state.lastWriteAt).toBe(T0);
    expect(io.log.error).toHaveBeenCalled();
  });
});

describe('guard: the merge flags are necessary, not sufficient', () => {
  const remote = data([task('r')]);
  const flagsOnly = () => makeIo({
    // The merge says both sides changed, and hands back exactly the file's data.
    mergeSyncData: () => ({ data: remote, localChanged: true, remoteChanged: true }),
    buildSyncPayload: () => ({ version: 2, data: remote }),
  });

  it('a write flag with nothing differing from the file writes nothing', async () => {
    const transport = makeTransport({ read: async () => envelope(remote) });
    const io = flagsOnly();
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', remoteChanged: true, wrote: false, applied: false });
    expect(transport.write).not.toHaveBeenCalled();
    expect(io.applyEngineData).not.toHaveBeenCalled();
  });

  it('the 2026-10-05 case: health counts the file never carries do not cause a rewrite', async () => {
    // A Mac holds HealthKit-derived counts (arrived through GLANCEvault); the
    // iCloud file is kept free of them by the strip. The merge keeps the counts
    // in its result and flags a write; the stripped copy equals the file.
    const habits = [{ id: 'steps', source: 'healthKit' }];
    const fileData = { tasks: [task('r')], unscheduledTasks: [], habits, habitLogs: { '2026-10-01': { water: 3 } } };
    const localData = { ...fileData, habitLogs: { '2026-10-01': { water: 3, steps: 8000 } } };
    const strip = (payload) => ({
      ...payload,
      data: { ...payload.data, habitLogs: Object.fromEntries(Object.entries(payload.data.habitLogs).map(([d, e]) => [d, Object.fromEntries(Object.entries(e).filter(([h]) => h !== 'steps'))])) },
    });
    const transport = makeTransport({ read: async () => envelope(fileData) });
    const io = makeIo({
      habits,
      buildSyncPayload: () => ({ version: 2, data: localData }),
      mergeSyncData: () => ({ data: localData, localChanged: false, remoteChanged: true }),
      stripHealthSourcedLogs: strip,
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', remoteChanged: true, wrote: false });
    expect(transport.write).not.toHaveBeenCalled();

    // A real local change alongside the health counts still writes, stripped.
    const edited = { ...localData, tasks: [task('r', { title: 'renamed' })] };
    const io2 = makeIo({
      habits,
      buildSyncPayload: () => ({ version: 2, data: edited }),
      mergeSyncData: () => ({ data: edited, localChanged: false, remoteChanged: true }),
      stripHealthSourcedLogs: strip,
    });
    const t2 = makeTransport({ read: async () => envelope(fileData) });
    const r2 = await settled({ transport: t2, io: io2, state: fresh });
    expect(r2.outcome.wrote).toBe(true);
    expect(written(t2).data.habitLogs['2026-10-01']).toEqual({ water: 3 });
    expect(written(t2).data.tasks[0].title).toBe('renamed');
  });

  it('guard: a difference only in the keys the merge calls device-local writes nothing', async () => {
    const fileData = { ...data([task('a')]), use24HourClock: false, minimizedSections: { inbox: false } };
    const localData = { ...data([task('a')]), use24HourClock: true, minimizedSections: { inbox: true } };
    const transport = makeTransport({ read: async () => envelope(fileData) });
    const io = makeIo({
      buildSyncPayload: () => ({ version: 2, data: localData }),
      mergeSyncData: () => ({ data: localData, localChanged: false, remoteChanged: true, deviceLocalKeys: ['use24HourClock', 'minimizedSections'] }),
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome).toMatchObject({ kind: 'merged', wrote: false, deferred: false });
    expect(transport.write).not.toHaveBeenCalled();
    // The same merge without the list: the difference counts, and the write goes out.
    const io2 = makeIo({ buildSyncPayload: () => ({ version: 2, data: localData }), mergeSyncData: () => ({ data: localData, localChanged: false, remoteChanged: true }) });
    const t2 = makeTransport({ read: async () => envelope(fileData) });
    expect((await runSnapshotFileCycle({ transport: t2, io: io2, state: fresh })).outcome.wrote).toBe(true);
  });

  it('guard: an order-only difference from the file writes nothing', async () => {
    const fileData = data([task('a'), task('b')]);
    const localData = data([task('b'), task('a')]);
    const transport = makeTransport({ read: async () => envelope(fileData) });
    const io = makeIo({
      buildSyncPayload: () => ({ version: 2, data: localData }),
      mergeSyncData: () => ({ data: localData, localChanged: false, remoteChanged: true }),
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.wrote).toBe(false);
    expect(transport.write).not.toHaveBeenCalled();
  });

  it('an apply flag with nothing differing from local state applies nothing', async () => {
    const transport = makeTransport({ read: async () => envelope(remote) });
    const io = makeIo({
      buildSyncPayload: () => ({ version: 2, data: remote }),
      mergeSyncData: () => ({ data: remote, localChanged: true, remoteChanged: false }),
    });
    const { outcome } = await runSnapshotFileCycle({ transport, io, state: fresh });
    expect(outcome.applied).toBe(false);
    expect(io.applyEngineData).not.toHaveBeenCalled();
    expect(io.storage.getItem(LOCAL_MODIFIED_KEY)).toBeNull();
  });
});

describe('staggered relays across devices (two Macs, 2026-10-10)', () => {
  const realMerge = (local, remote) => {
    const ids = new Set(local.tasks.map((t) => t.id));
    const tasks = [...local.tasks, ...remote.tasks.filter((t) => !ids.has(t.id))];
    return { data: { tasks, unscheduledTasks: [] }, localChanged: tasks.length > local.tasks.length, remoteChanged: tasks.length > remote.tasks.length };
  };

  it('relayWaitMs: 90 s alone, a minute more per writer that sorts before this device; writers are learned from the file, own id never recorded', () => {
    const storage = makeStorage();
    expect(relayWaitMs(storage, 'k', 'mac-b')).toBe(RELAY_CONFIRM_MS);
    expect(noteWriter(storage, 'k', 'mac-a')).toBe(true);
    expect(noteWriter(storage, 'k', 'mac-a')).toBe(false);
    expect(noteWriter(storage, 'k', null)).toBe(false);
    expect(readWriters(storage, 'k')).toEqual(['mac-a']);
    expect(relayWaitMs(storage, 'k', 'mac-b')).toBe(RELAY_CONFIRM_MS + RELAY_STAGGER_MS);
    expect(relayWaitMs(storage, 'k', 'mac-0')).toBe(RELAY_CONFIRM_MS);           // sorts first
    noteWriter(storage, 'k', 'phone');
    expect(relayWaitMs(storage, 'k', 'mac-b')).toBe(RELAY_CONFIRM_MS + RELAY_STAGGER_MS);
    expect(relayWaitMs(storage, 'k', 'zzz')).toBe(RELAY_CONFIRM_MS + 2 * RELAY_STAGGER_MS);
    expect(relayWaitMs(storage, 'k', null)).toBe(RELAY_CONFIRM_MS);               // no id: the old rule
    storage.setItem('k', '{bad');
    expect(readWriters(storage, 'k')).toEqual([]);
  });

  it('every write carries writtenBy (seed and merge), and a read records the writer', async () => {
    const seedT = makeTransport();
    const io = makeIo({ deviceId: 'mac-a', buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }) });
    await runSnapshotFileCycle({ transport: seedT, io, state: fresh });
    expect(written(seedT).writtenBy).toBe('mac-a');
    const t = makeTransport({ read: async () => JSON.stringify({ version: 2, lastModified: '2026-10-02T00:00:00.000Z', writtenBy: 'mac-b', data: data([task('r')]) }) });
    const io2 = makeIo({ deviceId: () => 'mac-a', buildSyncPayload: () => ({ version: 2, data: data([task('mine')]) }), mergeSyncData: realMerge });
    await runSnapshotFileCycle({ transport: t, io: io2, state: fresh });
    expect(written(t).writtenBy).toBe('mac-a');
    expect(readWriters(io2.storage, `${t.lastSyncedKey}:writers`)).toEqual(['mac-b']);
    // The content gate is unmoved by the header: a file differing only in writtenBy is not rewritten.
    const same = makeTransport({ read: async () => JSON.stringify({ version: 2, lastModified: '2026-10-02T00:00:00.000Z', writtenBy: 'mac-b', data: data([task('r')]) }) });
    const io3 = makeIo({ deviceId: 'mac-a', buildSyncPayload: () => ({ version: 2, data: data([task('r')]) }), mergeSyncData: realMerge });
    expect((await runSnapshotFileCycle({ transport: same, io: io3, state: fresh })).outcome).toMatchObject({ kind: 'merged', wrote: false });
  });

  it('SCENARIO: a change reaches two Macs by the vault in the same second; one relays, the other sees the file catch up and never writes', async () => {
    // The folder: the daemon delivers a write to the other Mac PROPAGATION_MS later.
    const PROPAGATION_MS = 30_000;
    const folder = { text: envelope(data([task('shared')])), pending: null };
    const deliver = (at) => { if (folder.pending && at >= folder.pending.at) { folder.text = folder.pending.text; folder.pending = null; } };
    const mac = (id, writers) => {
      const dev = { id, clock: T0, state: { ...fresh }, storage: makeStorage() };
      for (const w of writers) noteWriter(dev.storage, 'fake-last-synced:writers', w);
      dev.transport = makeTransport({
        id,
        writeThrottleMs: 0,
        read: async () => { deliver(dev.clock); return folder.text; },
        write: vi.fn(async (text) => { folder.pending = { text, at: dev.clock + PROPAGATION_MS }; return true; }),
      });
      // Both already applied the vault's copy of the new task: local has it, the file lacks it, no edit was made here.
      dev.io = makeIo({ deviceId: id, storage: dev.storage, now: () => dev.clock, lastLocalEditAt: () => null,
        buildSyncPayload: () => ({ version: 2, data: data([task('shared'), task('from-phone')]) }), mergeSyncData: realMerge });
      dev.run = async () => { const r = await runSnapshotFileCycle({ transport: dev.transport, io: dev.io, state: dev.state }); dev.state = r.state; return r.outcome; };
      return dev;
    };
    const a = mac('mac-a', ['mac-b']);
    const b = mac('mac-b', ['mac-a']);
    const tick = async (ms) => { a.clock += ms; b.clock += ms; const ra = await a.run(); const rb = await b.run(); return [ra, rb]; };
    let [ra, rb] = await tick(0);
    expect(ra.deferred && rb.deferred).toBe(true);
    [ra, rb] = await tick(RELAY_CONFIRM_MS);                     // 90 s: a (rank 0) writes, b (rank 1) still waiting
    expect(ra.wrote).toBe(true);
    expect(rb).toMatchObject({ wrote: false, deferred: true });
    [ra, rb] = await tick(RELAY_STAGGER_MS);                     // 150 s: a's write reached b 30 s ago; nothing left to relay
    expect(rb.wrote).toBe(false);
    expect(b.transport.write).not.toHaveBeenCalled();
    expect(a.transport.write).toHaveBeenCalledTimes(1);
    // Without the stagger, b would have written at 90 s too (the mutation this guards).
  });

  it('a device that has not seen the others yet ranks first and learns them from the file it reads', async () => {
    const t = makeTransport({ read: async () => JSON.stringify({ version: 2, lastModified: 'x', writtenBy: 'mac-a', data: data([task('r')]) }) });
    const io = makeIo({ deviceId: 'mac-b', buildSyncPayload: () => ({ version: 2, data: data([task('r')]) }), mergeSyncData: realMerge });
    expect(relayWaitMs(io.storage, `${t.lastSyncedKey}:writers`, 'mac-b')).toBe(RELAY_CONFIRM_MS);
    await runSnapshotFileCycle({ transport: t, io, state: fresh });
    expect(relayWaitMs(io.storage, `${t.lastSyncedKey}:writers`, 'mac-b')).toBe(RELAY_CONFIRM_MS + RELAY_STAGGER_MS);
  });
});
