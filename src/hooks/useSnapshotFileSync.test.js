/* eslint-disable react-hooks/rules-of-hooks -- React is mocked below; the hook
   is called as a plain function once per fake device, as the bridge scenario
   harness (dayglance-obsidian-plugin/test) calls useObsidianSync. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The hook is exercised the way the bridge scenario harness exercises
// useObsidianSync: React's primitives are replaced by plain holders and the
// hook is called once per "device". Effects are collected and run by hand.
let effects = [];
let stateSlots = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
  useState: (init) => {
    const slot = { value: init };
    stateSlots.push(slot);
    return [init, (v) => { slot.value = typeof v === 'function' ? v(slot.value) : v; }];
  },
}));

// The real crypto module, with decryptData overridable per test: a device
// with the wrong key (a failing decrypt) is distinct from one with none.
let decryptImpl = null;
let readyImpl = null;
vi.mock('../utils/crypto.js', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    decryptData: (...args) => (decryptImpl ? decryptImpl(...args) : real.decryptData(...args)),
    hasEncryptionReady: () => (readyImpl ? readyImpl() : real.hasEncryptionReady()),
  };
});

const { default: useSnapshotFileSync } = await import('./useSnapshotFileSync.js');

// One shared "folder": whatever the daemon would ferry between devices.
const makeFolder = () => ({ text: null, writes: 0 });

const makeStorage = () => {
  const m = {};
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = String(v); },
    removeItem: (k) => { delete m[k]; },
  };
};

const task = (id, title, lastModified) => ({
  id, title, date: '2026-10-01', completed: false, notes: '', subtasks: [], lastModified,
});

/**
 * A dayGLANCE device: its own tasks, its own storage, its own mutex, a fake
 * transport over the shared folder. `decided` models the per-device first-run
 * preference the transport owns.
 */
function mountDevice(name, folder, { tasks = [], decided = true, enabled = true, resetting = false, mutex = { current: false }, readDelayMs = 0 } = {}) {
  const dev = {
    name, tasks, storage: makeStorage(), folder,
    decided, enabled, resetting,
    applied: [], reads: 0, unavailable: [],
    changedCb: null,
    mutex, pending: { current: false }, startedAt: { current: 0 },
  };
  dev.transport = {
    id: `fake-${name}`,
    pollMs: 15_000,
    writeThrottleMs: 0,
    lastSyncedKey: `fake-last-synced`,
    allowsPlaintextReseed: true,
    isSupported: () => true,
    isAvailable: () => true,
    // A real read is an IPC or bridge round trip that settles on a later
    // task, not in a microtask; readDelayMs models that under fake timers.
    read: vi.fn(async () => {
      if (readDelayMs) await new Promise((r) => setTimeout(r, readDelayMs));
      dev.reads += 1;
      return folder.text;
    }),
    write: vi.fn(async (text) => { folder.text = text; folder.writes += 1; return true; }),
    onChanged: (cb) => { dev.changedCb = cb; return () => { dev.changedCb = null; }; },
    kicksOnVisibility: () => false,
    isEnabled: () => dev.enabled,
    setEnabled: (v) => { dev.enabled = v; dev.decided = true; },
    firstRunDecided: () => dev.decided,
  };
  // The cycle's clock, and when this device last edited its own data: a
  // change made here (editedAt after the last read) is written at once, one
  // that arrived by another road is relayed only after the file sat unchanged.
  dev.clock = Date.now();
  dev.editedAt = null;
  dev.io = {
    buildSyncPayload: () => ({ version: 2, data: { tasks: dev.tasks, unscheduledTasks: [] } }),
    applyEngineData: (data) => { dev.applied.push(data); dev.tasks = data.tasks; },
    habits: [],
    syncRetentionDays: 90,
    isResetInProgress: () => dev.resetting,
    onUnavailable: (e) => dev.unavailable.push(e),
    lastLocalEditAt: () => dev.editedAt,
    now: () => dev.clock,
  };

  effects = [];
  stateSlots = [];
  dev.api = useSnapshotFileSync({
    transport: dev.transport,
    active: true,
    dataLoaded: true,
    cloudSyncInProgressRef: dev.mutex,
    pendingRef: dev.pending,
    startedAtRef: dev.startedAt,
    io: dev.io,
  });
  dev.effects = effects;
  dev.firstRunSlot = stateSlots[0];
  dev.cleanups = [];
  dev.runEffects = () => {
    for (const e of dev.effects) {
      const c = e.fn();
      if (typeof c === 'function') dev.cleanups.push(c);
    }
  };
  // The hook reads the page's localStorage; each device brings its own, and
  // cycles are awaited one at a time so the swap is safe.
  dev.sync = async () => { globalThis.localStorage = dev.storage; await dev.api.runSync(); };
  // The user edits on this device: the clock moves on and the edit is stamped.
  dev.edit = (tasks) => { dev.clock += 1000; dev.editedAt = new Date(dev.clock).toISOString(); dev.tasks = tasks; };
  return dev;
}

const parse = (folder) => JSON.parse(folder.text);

describe('useSnapshotFileSync: save → write → read → apply across two devices', () => {
  afterEach(() => { delete globalThis.localStorage; });

  it('seeds from the first device, prompts the second, then converges edits both ways', async () => {
    const folder = makeFolder();

    // Device A has a task and has never synced: the startup effect seeds the folder.
    const a = mountDevice('A', folder, { tasks: [task('t1', 'Write plan', '2026-10-01T09:00:00.000Z')] });
    globalThis.localStorage = a.storage;
    a.runEffects();
    await vi.waitFor(() => expect(folder.writes).toBe(1));
    expect(parse(folder).data.tasks.map((t) => t.id)).toEqual(['t1']);
    // Seeding does not count as having synced; only reading a real snapshot does.
    expect(a.storage.getItem('fake-last-synced')).toBeNull();

    // Device B is fresh (no data, no decision): it is asked, not restored.
    const b = mountDevice('B', folder, { decided: false });
    await b.sync();
    // The seeded envelope carries no lastModified; the prompt normalises it to null.
    expect(b.firstRunSlot.value).toMatchObject({ taskCount: 1, inboxCount: 0, lastModified: null });
    expect(b.tasks).toEqual([]);
    // While the prompt is open, the poll must not merge behind it.
    const readsBefore = b.reads;
    await b.sync();
    expect(b.reads).toBe(readsBefore);

    // B restores: the decision is recorded and the snapshot is applied to B's state.
    globalThis.localStorage = b.storage;
    b.api.acceptFirstRun();
    await vi.waitFor(() => expect(b.tasks.map((t) => t.id)).toEqual(['t1']));
    expect(b.firstRunSlot.value).toBeNull();
    expect(b.decided).toBe(true);
    expect(b.enabled).toBe(true);

    // B edits the task (a newer lastModified, as a save stamps it). The next
    // cycle on B merges and writes the folder at once, as the change was
    // made there; A's next cycle applies it.
    b.edit([task('t1', 'Write plan (edited)', '2026-10-01T10:00:00.000Z')]);
    await b.sync();
    expect(parse(folder).data.tasks[0].title).toBe('Write plan (edited)');

    await a.sync();
    expect(a.tasks[0].title).toBe('Write plan (edited)');
    expect(a.applied.length).toBeGreaterThan(0);
    expect(a.storage.getItem('fake-last-synced')).toBeTruthy();

    // And back: A adds a task, B picks it up without losing its own edit.
    a.edit([...a.tasks, task('t2', 'Second', '2026-10-01T11:00:00.000Z')]);
    await a.sync();
    await b.sync();
    expect(b.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    expect(b.tasks.find((t) => t.id === 't1').title).toBe('Write plan (edited)');
  });

  it('declining the restore makes the device inert: nothing read, nothing written', async () => {
    const folder = makeFolder();
    folder.text = JSON.stringify({ version: 2, lastModified: '2026-10-02T00:00:00.000Z', data: { tasks: [task('t1', 'x', '2026-10-01T00:00:00.000Z')], unscheduledTasks: [] } });
    const c = mountDevice('C', folder, { decided: false });
    await c.sync();
    expect(c.firstRunSlot.value?.taskCount).toBe(1);

    c.api.declineFirstRun();
    expect(c.enabled).toBe(false);
    expect(c.firstRunSlot.value).toBeNull();

    const reads = c.reads;
    await c.sync();
    expect(c.reads).toBe(reads);
    expect(folder.writes).toBe(0);
    expect(c.tasks).toEqual([]);
  });
});

describe('useSnapshotFileSync: synchronous guards', () => {
  afterEach(() => { delete globalThis.localStorage; });

  it('skips under the shared mutex and raises the pending flag; releases the mutex after a cycle', async () => {
    const folder = makeFolder();
    const d = mountDevice('D', folder, { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')] });
    d.mutex.current = true;
    await d.sync();
    expect(d.reads).toBe(0);
    expect(d.pending.current).toBe(true);

    d.mutex.current = false;
    await d.sync();
    expect(d.reads).toBe(1);
    expect(d.mutex.current).toBe(false);
    expect(d.startedAt.current).toBeGreaterThan(0);
  });

  it('does nothing while a reset is in flight, or when the transport is off or unreachable', async () => {
    const folder = makeFolder();
    const d = mountDevice('E', folder, { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')] });

    d.resetting = true;
    await d.sync();
    d.resetting = false;

    d.enabled = false;
    await d.sync();
    d.enabled = true;

    d.transport.isAvailable = () => false;
    await d.sync();

    expect(d.reads).toBe(0);
    expect(folder.writes).toBe(0);
    expect(d.mutex.current).toBe(false);
  });

  it('surfaces a transport error object through onUnavailable and keeps the mutex clean', async () => {
    const folder = makeFolder();
    folder.text = '{"error":"iCloud not available"}';
    const d = mountDevice('F', folder);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await d.sync();
    err.mockRestore();
    expect(d.unavailable).toEqual(['iCloud not available']);
    expect(d.mutex.current).toBe(false);
  });

  it('an encrypted file with no key in memory tries the cached key once, then asks for the passphrase (onKeyNeeded), untouched', async () => {
    const folder = makeFolder();
    // The real envelope shape (@glance-apps/sync isEncryptedEnvelope); no key is cached here.
    folder.text = JSON.stringify({ v: 1, enc: 'AES-GCM-256', salt: 'abc', iv: 'def', data: 'ghi' });
    const d = mountDevice('F2', folder, { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')] });
    d.transport.allowsPlaintextReseed = false;
    const encrypted = vi.fn();
    const keyNeeded = vi.fn();
    const restore = vi.fn(async () => false);
    d.io.onEncryptedUnreadable = encrypted;
    d.io.onKeyNeeded = keyNeeded;
    d.io.restoreKey = restore;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await d.sync();
    await d.sync();
    warn.mockRestore();
    expect(restore).toHaveBeenCalledTimes(1);                         // once per session, not per cycle
    expect(keyNeeded).toHaveBeenCalledTimes(2);
    expect(encrypted).not.toHaveBeenCalled();
    expect(folder.writes).toBe(0);
    expect(d.applied).toEqual([]);
    expect(d.mutex.current).toBe(false);
  });

  it('guard (2026-10-10): a device whose cached key restores is never asked; the cycle runs again with it at once', async () => {
    const folder = makeFolder();
    folder.text = JSON.stringify({ v: 1, enc: 'AES-GCM-256', salt: 'abc', iv: 'def', data: 'ghi' });
    const d = mountDevice('F2b', folder, { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')] });
    d.transport.allowsPlaintextReseed = false;
    const keyNeeded = vi.fn();
    d.io.onKeyNeeded = keyNeeded;
    // The cached key: once restored, the envelope opens.
    let restored = false;
    d.io.restoreKey = vi.fn(async () => { restored = true; return true; });
    readyImpl = () => restored;                                       // as initSessionKey leaves the real module
    decryptImpl = async () => {
      if (!restored) { const e = new Error('Encryption key not available'); e.code = 'PASSPHRASE_REQUIRED'; throw e; }
      return { version: 2, lastModified: '2026-10-02T00:00:00.000Z', data: { tasks: [task('r', 'remote', '2026-10-02T00:00:00.000Z')], unscheduledTasks: [] } };
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await d.sync(); } finally { warn.mockRestore(); decryptImpl = null; readyImpl = null; }
    expect(keyNeeded).not.toHaveBeenCalled();
    expect(d.io.restoreKey).toHaveBeenCalledTimes(1);
    expect(d.applied.length).toBe(1);                                 // the second run, with the key, applied the file
    expect(d.mutex.current).toBe(false);
  });

  it('an encrypted file the key in memory cannot open is surfaced through onEncryptedUnreadable, untouched', async () => {
    const folder = makeFolder();
    folder.text = JSON.stringify({ v: 1, enc: 'AES-GCM-256', salt: 'abc', iv: 'def', data: 'ghi' });
    const d = mountDevice('F3', folder, { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')] });
    d.transport.allowsPlaintextReseed = false;
    const encrypted = vi.fn();
    const keyNeeded = vi.fn();
    d.io.onEncryptedUnreadable = encrypted;
    d.io.onKeyNeeded = keyNeeded;
    decryptImpl = async () => { throw new Error('Decryption failed — wrong passphrase or corrupted data.'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { await d.sync(); } finally { warn.mockRestore(); decryptImpl = null; }
    expect(encrypted).toHaveBeenCalledTimes(1);
    expect(keyNeeded).not.toHaveBeenCalled();
    expect(folder.writes).toBe(0);
    expect(d.mutex.current).toBe(false);
  });

  it('a device whose switch is on with no key in memory holds its write and asks (onKeyNeeded), on seed and on merge', async () => {
    const folder = makeFolder();
    const d = mountDevice('F4', folder, { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')] });
    d.transport.encryptsWrites = () => true;
    const keyNeeded = vi.fn();
    d.io.onKeyNeeded = keyNeeded;
    d.io.restoreKey = async () => false;
    await d.sync();                                                   // seed wanted as an envelope
    expect(keyNeeded).toHaveBeenCalledTimes(1);
    expect(folder.writes).toBe(0);
    expect(folder.text).toBeNull();
    folder.text = JSON.stringify({ version: 2, lastModified: '2026-10-02T00:00:00.000Z', data: { tasks: [], unscheduledTasks: [] } });
    await d.sync();                                                   // merge: the plaintext is read, the upgrade is held
    expect(keyNeeded).toHaveBeenCalledTimes(2);
    expect(folder.writes).toBe(0);
    expect(d.mutex.current).toBe(false);
  });

  it('a throwing transport is logged, not left as an unhandled rejection, and releases the mutex', async () => {
    const folder = makeFolder();
    const d = mountDevice('G', folder);
    d.transport.read = async () => { throw new Error('bridge gone'); };
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(d.sync()).resolves.toBeUndefined();
    err.mockRestore();
    expect(d.mutex.current).toBe(false);
  });
});

describe('useSnapshotFileSync: scheduling', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); delete globalThis.localStorage; });

  it('polls on the transport cadence and stops on cleanup', async () => {
    const folder = makeFolder();
    const d = mountDevice('H', folder, { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')] });
    globalThis.localStorage = d.storage;
    d.runEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.reads).toBe(1); // startup
    await vi.advanceTimersByTimeAsync(15_000);
    expect(d.reads).toBe(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(d.reads).toBe(3);

    d.cleanups.forEach((c) => c());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(d.reads).toBe(3);
    expect(d.changedCb).toBeNull();
  });

  it('a change event runs a cycle at once, or 2 s later if one is in flight', async () => {
    const folder = makeFolder();
    const d = mountDevice('I', folder, { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')] });
    globalThis.localStorage = d.storage;
    d.runEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.reads).toBe(1);

    d.changedCb();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.reads).toBe(2);

    d.mutex.current = true;
    d.changedCb();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(d.reads).toBe(2);
    d.mutex.current = false;
    await vi.advanceTimersByTimeAsync(1);
    expect(d.reads).toBe(3);
  });

  it('guard: two transports polling in step share the mutex; the one skipped runs 2 s later, every tick', async () => {
    // The desktop case (2026-10-05): iCloud and Direct Access on one Mac, both
    // polling every 15 s from timers started in the same render. iCloud's
    // tick fires first and holds the mutex through its read; Direct Access's
    // tick lands microseconds later. Without the retry it never ran.
    const mutex = { current: false };
    const a = mountDevice('A', makeFolder(), { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')], mutex, readDelayMs: 5 });
    const b = mountDevice('B', makeFolder(), { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')], mutex });
    globalThis.localStorage = a.storage;
    a.runEffects();
    b.runEffects();
    // Startup: A's cycle is in flight when B's startup kick arrives.
    expect(b.pending.current).toBe(true);
    await vi.advanceTimersByTimeAsync(10);
    expect(a.reads).toBe(1);
    expect(b.reads).toBe(0);
    await vi.advanceTimersByTimeAsync(1_990);
    expect(b.reads).toBe(1);
    expect(b.pending.current).toBe(false);

    // Every poll tick collides the same way, and every tick B still runs.
    for (let tick = 1; tick <= 3; tick += 1) {
      await vi.advanceTimersByTimeAsync(13_010);
      expect(a.reads).toBe(1 + tick);
      expect(b.reads).toBe(tick);
      await vi.advanceTimersByTimeAsync(1_990);
      expect(b.reads).toBe(1 + tick);
    }
    expect(mutex.current).toBe(false);
    a.cleanups.forEach((c) => c());
    b.cleanups.forEach((c) => c());
  });

  it('a retry that still finds the lock held does not chain; the next poll tick is the next attempt', async () => {
    const d = mountDevice('K', makeFolder(), { tasks: [task('t', 'x', '2026-10-01T00:00:00.000Z')] });
    globalThis.localStorage = d.storage;
    d.runEffects();
    await vi.advanceTimersByTimeAsync(0);
    expect(d.reads).toBe(1);

    // A lock stranded from outside (iOS suspended the app mid-cycle).
    d.mutex.current = true;
    await vi.advanceTimersByTimeAsync(15_000); // tick: skipped, retry armed
    await vi.advanceTimersByTimeAsync(2_000);  // retry: still locked, no second retry
    d.mutex.current = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(d.reads).toBe(1);
    await vi.advanceTimersByTimeAsync(11_000); // the next tick runs normally
    expect(d.reads).toBe(2);

    // A retry armed just before unmount is cancelled with the instance.
    d.mutex.current = true;
    await vi.advanceTimersByTimeAsync(15_000);
    d.cleanups.forEach((c) => c());
    d.mutex.current = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(d.reads).toBe(2);
  });

  it('does not start anything the transport does not support, or in the tray', () => {
    const folder = makeFolder();
    const d = mountDevice('J', folder);
    d.transport.isSupported = () => false;
    effects = []; stateSlots = [];
    useSnapshotFileSync({
      transport: d.transport, active: true, dataLoaded: true,
      cloudSyncInProgressRef: d.mutex, io: d.io,
    });
    const cleanups = effects.map((e) => e.fn()).filter(Boolean);
    expect(cleanups).toEqual([]);
    expect(d.changedCb).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    effects = []; stateSlots = [];
    d.transport.isSupported = () => true;
    useSnapshotFileSync({
      transport: d.transport, active: false, dataLoaded: true,
      cloudSyncInProgressRef: d.mutex, io: d.io,
    });
    effects.forEach((e) => e.fn());
    expect(vi.getTimerCount()).toBe(0);
    expect(d.reads).toBe(0);
  });
});
