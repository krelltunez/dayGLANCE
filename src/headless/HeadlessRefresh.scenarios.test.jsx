// The headless refresh root, end to end under a fake native bridge: storage →
// the payload both tiers receive → the apply → storage and state → the
// launcher snapshot and heartbeat pushed → the outcome reported. The engines
// are scripted at the seams the root takes (sync/adapter.js's and
// sync/dbEngine.js's factories); their transports have their own tests.
//
// Two rules are held here that nothing else can see:
//   - the root boots only the allowlist: every bridge method it looks up is
//     in HEADLESS_BRIDGE_METHODS, so a feature that initialised here would
//     show up as a lookup outside it;
//   - the payload it builds from storage carries the slices App would load
//     through its own hooks (use24HourClock, users, …), because a slice read
//     differently here would be pushed to every device as an edit.

import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HEADLESS_BRIDGE_METHODS } from './headlessMode.js';
import { mergeSyncData } from '../mergeSync.js';

vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));
// The vault's root key lives in the Android Keystore; the "cached key" case
// is a resolved restore. The uncached case is the file tier's encrypted
// scenario below, which runs the real restore against the empty bridge.
vi.mock('../sync/dbEngine.js', async (importOriginal) => ({
  ...(await importOriginal()),
  restoreDbRootKey: async () => true,
}));

const { default: HeadlessRefresh } = await import('./HeadlessRefresh.jsx');
const { IDBFactory } = await import('fake-indexeddb');
const notesStore = await import('../utils/dailyNotesStore.js');
const { openDatabase } = await import('../utils/idbKeyValue.js');
const { createJoboStore } = await import('../jobo/store.js');
const { missingSyncEngineDeps } = await import('../hooks/useSyncEngineData.js');

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
  };
}

/** A bridge that answers only the allowlist and records every name looked up. */
function fakeBridge({ abort = false, queue = [] } = {}) {
  const lookups = new Set();
  const calls = { updateLauncherSnapshot: [], touchLauncherHeartbeat: [], recordLauncherRefresh: [], headlessDone: [], acked: [] };
  // The launcher queue, taken as the shell takes it (LauncherWriteQueue): every
  // entry handed over, the writes kept until acknowledged.
  let pending = [...queue];
  const impl = {
    getPendingLauncherIntents: () => {
      const all = JSON.stringify(pending);
      pending = pending.filter(e => e.action !== 'com.dayglance.app.launcher.REFRESH');
      return all;
    },
    ackLauncherIntents: (json) => {
      const ids = JSON.parse(json);
      calls.acked.push(...ids);
      pending = pending.filter(e => !ids.includes(e.clientId));
    },
    get pending() { return pending; },
    httpRequest: () => JSON.stringify({ status: 0, ok: false, error: 'no network in tests' }),
    supportsAsyncHttp: () => false,
    getSyncKey: () => '',
    getSyncKeyForSlot: () => '',
    storeSyncKey: () => {},
    storeSyncKeyForSlot: () => {},
    isVaultSseSupported: () => false,
    updateLauncherSnapshot: (json) => calls.updateLauncherSnapshot.push(JSON.parse(json)),
    touchLauncherHeartbeat: (json) => calls.touchLauncherHeartbeat.push(JSON.parse(json)),
    recordLauncherRefresh: (json) => calls.recordLauncherRefresh.push(JSON.parse(json)),
    headlessShouldAbort: () => abort,
    headlessDone: (json) => calls.headlessDone.push(JSON.parse(json)),
  };
  const proxy = new Proxy(impl, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop === 'then') return undefined;
      lookups.add(prop);
      return target[prop];
    },
    has(target, prop) { lookups.add(prop); return prop in target; },
  });
  return { bridge: proxy, lookups, calls };
}

const T = (id, title, extra = {}) => ({ id, title, date: '2026-10-19', startTime: '09:00', duration: 60, completed: false, notes: '', subtasks: [], lastModified: '2026-10-19T08:00:00.000Z', ...extra });

const seedStorage = (ls, { cloud = true, vault = false, encrypted = false } = {}) => {
  ls.setItem('day-planner-tasks', JSON.stringify([T('t1', 'Local task')]));
  ls.setItem('day-planner-unscheduled', JSON.stringify([{ id: 'u1', title: 'Inbox item', notes: '', subtasks: [], lastModified: '2026-10-19T08:00:00.000Z' }]));
  ls.setItem('day-planner-use-24h-clock', 'true');
  ls.setItem('dayglance-users', JSON.stringify([{ id: 'me', syncId: 'me', name: 'Me', updatedAt: '2026-10-01T00:00:00.000Z' }]));
  ls.setItem('day-planner-weather-temp-unit', 'celsius');
  ls.setItem('day-planner-dial-layers', JSON.stringify({ weather: false }));
  ls.setItem('day-planner-gtd-frames', JSON.stringify([]));
  ls.setItem('day-planner-calendar-filter', JSON.stringify(['cal-1']));
  ls.setItem('day-planner-native-time-overrides', JSON.stringify({ 'ev-9': { title: 'Moved' } }));
  if (cloud) ls.setItem('day-planner-cloud-sync-config', JSON.stringify({ enabled: true, provider: 'webdav', webdavUrl: 'https://dav.example', syncFolder: 'GLANCE/dayglance', encryptionEnabled: encrypted }));
  if (vault) ls.setItem('dayglance-vault-config', JSON.stringify({ enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acc' }));
};

/** A file-tier engine that merges one remote task into whatever payload it is given. */
function scriptedFileEngine({ remoteTasks = [T('t2', 'From the other device', { lastModified: '2026-10-19T09:30:00.000Z' })], remoteNotes = null, fail = null, lastSynced = '2026-10-19T10:00:00.000Z' } = {}) {
  const seen = { payloads: [], applies: 0 };
  const factory = vi.fn((callbacks) => ({
    sync: async () => {
      if (fail) throw fail;
      const payload = await callbacks.buildPayload();
      seen.payloads.push(payload);
      const merged = { ...payload.data, tasks: [...payload.data.tasks, ...remoteTasks] };
      if (remoteNotes) merged.dailyNotes = { ...(payload.data.dailyNotes || {}), ...remoteNotes };
      await callbacks.applyPayload(merged, { allowEmpty: true });
      seen.applies += 1;
    },
    getLastSynced: () => lastSynced,
  }));
  return { factory, seen };
}

async function until(predicate, { tries = 200 } = {}) {
  for (let i = 0; i < tries; i += 1) {
    if (predicate()) return;
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
  }
  throw new Error('condition never held');
}

async function mount(props) {
  let root;
  await act(async () => { root = create(<HeadlessRefresh {...props} />); });
  return root;
}

describe('HeadlessRefresh', () => {
  let ls;
  let errors;
  beforeEach(() => {
    ls = memoryStorage();
    globalThis.localStorage = ls;
    globalThis.window = { location: { search: '?headless=refresh&clientId=rf-1' }, localStorage: ls };
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.localStorage;
    delete globalThis.window;
  });

  it('runs the file tier from storage, applies the pull, pushes the snapshot and reports ran', async () => {
    seedStorage(ls);
    const { bridge, lookups, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine();
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null, now: () => new Date('2026-10-19T12:00:00') });
    await until(() => calls.headlessDone.length > 0);

    // The payload the tier received is what App would have sent: the stored
    // task lists AND the slices App loads through its own hooks.
    expect(engine.seen.payloads).toHaveLength(1);
    const data = engine.seen.payloads[0].data;
    expect(data.tasks.map((t) => t.id)).toEqual(['t1']);
    expect(data.unscheduledTasks.map((t) => t.id)).toEqual(['u1']);
    expect(data.use24HourClock).toBe(true);
    expect(data.users).toEqual([expect.objectContaining({ syncId: 'me' })]);
    expect(data.weatherTempUnit).toBe('celsius');
    expect(data.tombstonePrunedBefore).toEqual(expect.any(String));

    // The apply landed in storage (the save pass wrote state back)…
    const stored = JSON.parse(ls.getItem('day-planner-tasks'));
    expect(stored.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    // …and the snapshot was built from the settled state, with the pulled task.
    expect(calls.updateLauncherSnapshot).toHaveLength(1);
    const snapshot = calls.updateLauncherSnapshot[0];
    // It cannot read the device calendar, and says so: the shell keeps the last events.
    expect(snapshot.carryDeviceEvents).toBe(true);
    // The dial's layer toggles from this device's storage, as the app sends them.
    expect(snapshot.dayShape.dialLayers).toEqual({ solar: true, weather: false, calendars: true, routines: true, frames: true });
    // The Inbox count through the app's own filter and stored preferences.
    expect(snapshot.inboxCount).toBe(1);
    // …and tells the provider how to read it itself: the stored filter and edits.
    expect(snapshot.deviceCalendar).toMatchObject({ filter: ['cal-1'], overrides: { 'ev-9': { title: 'Moved' } } });
    expect(snapshot.tasks.map((t) => t.title)).toEqual(expect.arrayContaining(['Local task', 'From the other device']));
    // The heartbeat carries the tier's completed cycle, and the outcome is logged.
    const heartbeat = calls.touchLauncherHeartbeat.at(-1);
    expect(heartbeat.syncedAt).toBe('2026-10-19T10:00:00.000Z');
    expect(heartbeat.checkedAt).toEqual(expect.any(Number));
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ clientId: 'rf-1', outcome: 'ran', durationMs: expect.any(Number) });
    expect(calls.headlessDone[0]).toMatchObject({ clientId: 'rf-1', outcome: 'ran' });

    // The allowlist: nothing the root booted reached for another native method.
    const outside = [...lookups].filter((name) => !HEADLESS_BRIDGE_METHODS.includes(name));
    expect(outside).toEqual([]);
    // The deps guard saw a complete wiring.
    expect(errors.mock.calls.filter((c) => String(c[0]).includes('useSyncEngineData'))).toEqual([]);
    root.unmount();
  });

  // docs/recurring-exceptions-merge.md: the headless root runs the same save
  // pass and the same merge, so a series' per-date stamps reach the payload,
  // survive the real file-tier merge, and a pulled occurrence edit lands in
  // storage without the save that follows re-stamping the series.
  it('carries a series\' occurrence edits and their per-date stamps through payload, merge and apply', async () => {
    seedStorage(ls);
    const series = { id: 'r1', title: 'Gym', startTime: '07:00', duration: 45, recurrence: { type: 'daily', startDate: '2026-10-01' },
      completedDates: [], notes: '', subtasks: [], lastModified: '2026-10-19T08:00:00.000Z',
      exceptions: { '2026-10-19': { skipped: true, skip: { at: '2026-10-19T09:00:00+02:00', plan: { startTime: '07:00', duration: 45, isAllDay: false } } } },
      exceptionsTimestamps: { '2026-10-19': '2026-10-19T07:00:00.000Z' } };
    ls.setItem('day-planner-recurring-tasks', JSON.stringify([series]));
    // The other device renamed the series later and moved another occurrence.
    const theirs = { ...series, title: 'Gym and stretch', lastModified: '2026-10-19T09:30:00.000Z',
      exceptions: { '2026-10-20': { startTime: '08:00' } }, exceptionsTimestamps: { '2026-10-20': '2026-10-19T09:30:00.000Z' } };
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const seen = [];
    const factory = vi.fn((callbacks) => ({
      sync: async () => {
        const payload = await callbacks.buildPayload();
        seen.push(payload.data);
        const { data } = mergeSyncData(payload.data, { ...payload.data, recurringTasks: [theirs] }, 0);
        await callbacks.applyPayload(data, { allowEmpty: true });
      },
      getLastSynced: () => '2026-10-19T10:00:00.000Z',
    }));
    const root = await mount({ bridge: () => bridge, createFileEngine: factory, createVaultEngine: () => null, now: () => new Date('2026-10-19T12:00:00') });
    await until(() => calls.headlessDone.length > 0);

    expect(seen[0].recurringTasks[0].exceptionsTimestamps).toEqual(series.exceptionsTimestamps);
    const [stored] = JSON.parse(ls.getItem('day-planner-recurring-tasks'));
    expect(stored.title).toBe('Gym and stretch');
    expect(stored.exceptions).toEqual({ ...series.exceptions, ...theirs.exceptions });
    expect(stored.exceptionsTimestamps).toEqual({ ...series.exceptionsTimestamps, ...theirs.exceptionsTimestamps });
    expect(stored.lastModified).toBe(theirs.lastModified);
    expect(calls.headlessDone[0]).toMatchObject({ outcome: 'ran' });
    root.unmount();
  });

  // Frame sets (#2305): the root loads the slice with the app's reader, pushes
  // it like the app, applies a pulled change into storage, and the launcher
  // snapshot it builds honours the sets, as App's getFrameInstancesForDate does.
  it('loads, pushes and applies frame sets, and the snapshot honours them', async () => {
    seedStorage(ls);
    const frames = [
      { id: 'f-work', label: 'Work', enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', setId: 'work', lastModified: '2026-10-01T00:00:00.000Z' },
      { id: 'f-free', label: 'Reading', enabled: true, days: [1, 2, 3, 4, 5], start: '18:00', end: '19:00', lastModified: '2026-10-01T00:00:00.000Z' },
    ];
    const sets = [{ id: 'work', name: 'Work', periods: [{ from: null, until: null }], lastModified: '2026-10-01T00:00:00.000Z' }];
    ls.setItem('day-planner-gtd-frames', JSON.stringify(frames));
    ls.setItem('day-planner-frame-sets', JSON.stringify(sets));
    // The other device switched Work off on 2026-10-17, before this run's today.
    const theirs = [{ ...sets[0], periods: [{ from: null, until: '2026-10-16' }], lastModified: '2026-10-19T09:00:00.000Z' }];
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const seen = [];
    const factory = vi.fn((callbacks) => ({
      sync: async () => {
        const payload = await callbacks.buildPayload();
        seen.push(payload.data);
        const { data } = mergeSyncData(payload.data, { ...payload.data, frameSets: theirs }, 0);
        await callbacks.applyPayload(data, { allowEmpty: true });
      },
      getLastSynced: () => '2026-10-19T10:00:00.000Z',
    }));
    const root = await mount({ bridge: () => bridge, createFileEngine: factory, createVaultEngine: () => null, now: () => new Date('2026-10-19T12:00:00') });
    await until(() => calls.headlessDone.length > 0);

    // Pushed as App would: the stored sets, their tombstones, the frame's setId.
    expect(seen[0].frameSets).toEqual(sets);
    expect(seen[0].deletedFrameSetIds).toEqual({});
    expect(seen[0].gtdFrames.find((f) => f.id === 'f-work').setId).toBe('work');
    // The pulled switch landed in storage.
    expect(JSON.parse(ls.getItem('day-planner-frame-sets'))).toEqual(theirs);
    // The snapshot's frames: Work only on the days its set was on.
    const rows = calls.updateLauncherSnapshot[0].frames;
    const on = (date) => rows.filter((r) => r.date === date).map((r) => r.frameId);
    expect(on('2026-10-16')).toEqual(['f-work', 'f-free']);
    expect(on('2026-10-19')).toEqual(['f-free']);
    expect(calls.headlessDone[0]).toMatchObject({ outcome: 'ran' });
    root.unmount();
  });

  it('leaves unreadable frame sets out of the payload rather than pushing []', async () => {
    seedStorage(ls);
    ls.setItem('day-planner-frame-sets', '{not json');
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine();
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null, now: () => new Date('2026-10-19T12:00:00') });
    await until(() => calls.headlessDone.length > 0);

    expect(engine.seen.payloads[0].data).not.toHaveProperty('frameSets');
    // …and the save pass did not write over the stored copy.
    expect(ls.getItem('day-planner-frame-sets')).toBe('{not json');
    // The deps guard accepted an undefined slice whose key is present.
    expect(errors.mock.calls.filter((c) => String(c[0]).includes('useSyncEngineData'))).toEqual([]);
    root.unmount();
  });

  it('fetches the forecast for the stored location and pushes it in the snapshot', async () => {
    seedStorage(ls);
    ls.setItem('day-planner-weather-coords', JSON.stringify({ lat: 39.74, lon: -104.99 }));
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const fetchForecast = vi.fn(async () => ({ '2026-10-19': { 9: { temp: 12, code: 1, uv: 3 } } }));
    const root = await mount({ bridge: () => bridge, createFileEngine: scriptedFileEngine().factory, createVaultEngine: () => null, fetchForecast, now: () => new Date('2026-10-19T12:00:00') });
    await until(() => calls.headlessDone.length > 0);

    // One request, for the stored coordinates in the user's unit; not the
    // geocode (the coordinates are already resolved) and nothing else.
    expect(fetchForecast).toHaveBeenCalledTimes(1);
    expect(fetchForecast.mock.calls[0][0]).toMatchObject({ coords: { lat: 39.74, lon: -104.99 }, tempUnit: 'celsius' });
    const snapshot = calls.updateLauncherSnapshot[0];
    expect(snapshot.weather).toEqual([expect.objectContaining({ date: '2026-10-19', unit: 'celsius', hours: [expect.objectContaining({ hour: 9, temp: 12 })] })]);
    expect(calls.headlessDone[0]).toMatchObject({ outcome: 'ran' });
    root.unmount();
  });

  it('a failed forecast is no forecast: the run still reports ran and the shell keeps the last one', async () => {
    seedStorage(ls);
    ls.setItem('day-planner-weather-coords', JSON.stringify({ lat: 39.74, lon: -104.99 }));
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const fetchForecast = vi.fn(async () => { throw new Error('offline'); });
    const root = await mount({ bridge: () => bridge, createFileEngine: scriptedFileEngine().factory, createVaultEngine: () => null, fetchForecast, now: () => new Date('2026-10-19T12:00:00') });
    await until(() => calls.headlessDone.length > 0);

    expect(calls.updateLauncherSnapshot[0].weather).toEqual([]);
    expect(calls.headlessDone[0]).toMatchObject({ outcome: 'ran' });
    root.unmount();
  });

  it('runs the vault tier too, and the heartbeat takes the latest completed cycle', async () => {
    seedStorage(ls, { vault: true });
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const file = scriptedFileEngine({ lastSynced: '2026-10-19T10:00:00.000Z' });
    const vaultApplies = [];
    const createVaultEngine = vi.fn((callbacks) => ({
      dbSyncCycle: async () => {
        const data = callbacks.getData();
        expect(data.tasks.map((t) => t.id)).toContain('t1');
        vaultApplies.push(data);
        callbacks.commitData({ ...data, tasks: [...data.tasks, T('t3', 'From the vault', { lastModified: '2026-10-19T09:45:00.000Z' })] });
      },
      getLastSynced: () => '2026-10-19T10:05:00.000Z',
      dispose: vi.fn(),
    }));
    const root = await mount({ bridge: () => bridge, createFileEngine: file.factory, createVaultEngine });
    await until(() => calls.headlessDone.length > 0);
    expect(createVaultEngine).toHaveBeenCalledTimes(1);
    expect(vaultApplies).toHaveLength(1);
    const stored = JSON.parse(ls.getItem('day-planner-tasks')).map((t) => t.id).sort();
    expect(stored).toEqual(['t1', 't2', 't3']);
    expect(calls.touchLauncherHeartbeat.at(-1).syncedAt).toBe('2026-10-19T10:05:00.000Z');
    expect(calls.headlessDone[0].outcome).toBe('ran');
    root.unmount();
  });

  // A launcher write that reached the app while it was closed: applied after
  // the pull, saved, acknowledged, pushed by a second pass, and in the snapshot.
  const LAUNCHER = 'com.dayglance.app.launcher.';
  const writesQueue = () => [
    { action: `${LAUNCHER}REFRESH`, clientId: 'rf-0' },
    { action: `${LAUNCHER}COMPLETE`, clientId: 'w-done', payload: { task_id: 't1' } },
    { action: `${LAUNCHER}CREATE`, clientId: 'w-new', payload: { title: 'Call the plumber' } },
    { action: `${LAUNCHER}TOGGLE_ROUTINE`, clientId: 'w-routine', payload: { routine_id: 'r-1' } },
  ];
  const flushInAct = (fn) => act(() => { fn(); });

  // MUTATION: skip the writes phase (go straight to 'synced') and every expectation on t1 and the ack fails.
  it('applies the launcher\'s queued writes after the pull, acknowledges each, pushes them, and puts them in the snapshot', async () => {
    seedStorage(ls, { cloud: false, vault: true });
    const { bridge, lookups, calls } = fakeBridge({ queue: writesQueue() });
    globalThis.window.DayGlanceNative = bridge;
    const pushed = [];
    const createVaultEngine = vi.fn((callbacks) => ({
      dbSyncCycle: async () => { pushed.push(callbacks.getData()); },
      getLastSynced: () => '2026-10-19T10:05:00.000Z',
      dispose: vi.fn(),
    }));
    const root = await mount({ bridge: () => bridge, createFileEngine: () => null, createVaultEngine, flush: flushInAct });
    await until(() => calls.headlessDone.length > 0);

    // Saved on this device…
    const stored = JSON.parse(ls.getItem('day-planner-tasks'));
    expect(stored.find(t => t.id === 't1').completed).toBe(true);
    const created = [...stored, ...JSON.parse(ls.getItem('day-planner-unscheduled'))].find(t => t.title === 'Call the plumber');
    expect(created).toMatchObject({ clientId: 'w-new' });
    // …acknowledged, except the routine toggle, which waits for the app…
    expect(calls.acked).toEqual(['w-done', 'w-new']);
    expect(bridge.pending.map(e => e.clientId)).toEqual(['w-routine']);
    // …pushed by a second pass of the tier, which carries them…
    expect(pushed).toHaveLength(2);
    expect(pushed[0].tasks.find(t => t.id === 't1').completed).toBe(false);
    expect(pushed[1].tasks.find(t => t.id === 't1').completed).toBe(true);
    // …and in the snapshot, with the ids the launcher retires its outbox on.
    const snapshot = calls.updateLauncherSnapshot[0];
    expect(snapshot.handledWrites.map(h => h.clientId)).toEqual(expect.arrayContaining(['w-done', 'w-new']));
    expect(snapshot.tasks.find(t => t.id === 't1').completed).toBe(true);
    expect(calls.headlessDone[0].outcome).toBe('ran');
    const outside = [...lookups].filter((name) => !HEADLESS_BRIDGE_METHODS.includes(name) && name !== 'pending');
    expect(outside).toEqual([]);
    root.unmount();
  });

  // JOBO: a launcher completion this run applies is a completion transition
  // here and nowhere else (the app, opened later, sees the task already done),
  // so the run's own detector records it, and the push after the writes
  // carries the record. With JOBO off on this device, nothing is recorded.
  // MUTATION: drop useJoboDetector from the root and the first case fails.
  for (const on of [true, false]) {
    it(`a launcher completion applied here ${on ? 'gets its JOBO Do record, pushed with it' : 'makes no Do record with JOBO off'}`, async () => {
      seedStorage(ls, { cloud: false, vault: true });
      if (on) ls.setItem('day-planner-jobo-enabled', 'true');
      // The ledger lives in IndexedDB, as in a WebView; without it the ledger is read-only.
      globalThis.indexedDB = new IDBFactory();
      const { bridge, calls } = fakeBridge({ queue: [{ action: `${LAUNCHER}COMPLETE`, clientId: 'w-jobo', payload: { task_id: 't1' } }] });
      globalThis.window.DayGlanceNative = bridge;
      const pushed = [];
      const createVaultEngine = vi.fn((callbacks) => ({
        dbSyncCycle: async () => { pushed.push(callbacks.getData()); },
        getLastSynced: () => '2026-10-19T10:05:00.000Z',
        dispose: vi.fn(),
      }));
      // A database of its own: the opener caches one connection per name, and an
      // earlier test without IndexedDB cached "unavailable" for the default one.
      const joboStore = createJoboStore({ dbName: `headless-jobo-${Math.random()}` });
      const root = await mount({ bridge: () => bridge, createFileEngine: () => null, createVaultEngine, flush: flushInAct, joboStore });
      await until(() => calls.headlessDone.length > 0);
      expect(calls.headlessDone[0].outcome).toBe('ran');
      const completedAt = JSON.parse(ls.getItem('day-planner-tasks')).find(t => t.id === 't1').completedAt;
      expect(completedAt).toEqual(expect.any(String));
      expect(pushed).toHaveLength(2);
      const doRecords = (pushed[1].joboRecords || []).filter(r => r.id === `do:t1:${completedAt}`);
      expect(doRecords).toHaveLength(on ? 1 : 0);
      if (on) expect(doRecords[0]).toMatchObject({ progress: 'completed' });
      root.unmount();
      delete globalThis.indexedDB;
    });
  }

  it('with no sync tier, still applies the writes and pushes the snapshot, and says why it did not sync', async () => {
    seedStorage(ls, { cloud: false });
    const { bridge, calls } = fakeBridge({ queue: writesQueue() });
    globalThis.window.DayGlanceNative = bridge;
    const root = await mount({ bridge: () => bridge, createFileEngine: () => null, createVaultEngine: () => null, flush: flushInAct });
    await until(() => calls.headlessDone.length > 0);
    expect(JSON.parse(ls.getItem('day-planner-tasks')).find(t => t.id === 't1').completed).toBe(true);
    expect(calls.acked).toEqual(['w-done', 'w-new']);
    expect(calls.updateLauncherSnapshot).toHaveLength(1);
    expect(calls.headlessDone[0]).toMatchObject({ outcome: 'failed', reason: 'no sync tier is configured' });
    root.unmount();
  });

  it('a failed pull applies no writes: they stay queued for the next run or the app', async () => {
    seedStorage(ls);
    const { bridge, calls } = fakeBridge({ queue: writesQueue() });
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine({ fail: new Error('offline') });
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null, flush: flushInAct });
    await until(() => calls.headlessDone.length > 0);
    expect(calls.acked).toEqual([]);
    expect(bridge.pending.map(e => e.clientId)).toEqual(['rf-0', 'w-done', 'w-new', 'w-routine']);
    expect(JSON.parse(ls.getItem('day-planner-tasks')).find(t => t.id === 't1').completed).toBe(false);
    root.unmount();
  });

  it('aborts before running when the app has opened, and pushes nothing', async () => {
    seedStorage(ls);
    const { bridge, calls } = fakeBridge({ abort: true });
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine();
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null });
    await until(() => calls.headlessDone.length > 0);
    expect(engine.seen.payloads).toHaveLength(0);
    expect(calls.updateLauncherSnapshot).toHaveLength(0);
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ clientId: 'rf-1', outcome: 'aborted', reason: 'app opened' });
    root.unmount();
  });

  it('an engine clearing its previous error is not a failure; a reported error is', async () => {
    seedStorage(ls, { vault: true });
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const file = scriptedFileEngine();
    // The vault engine clears, as both engines do at the start of a cycle, then succeeds.
    const clearing = vi.fn((callbacks) => ({
      dbSyncCycle: async () => { callbacks.onError(null, null); callbacks.onStatusChange('success'); },
      getLastSynced: () => '2026-10-19T10:05:00.000Z',
      dispose: vi.fn(),
    }));
    const root = await mount({ bridge: () => bridge, createFileEngine: file.factory, createVaultEngine: clearing });
    await until(() => calls.headlessDone.length > 0);
    expect(calls.headlessDone[0].outcome).toBe('ran');
    root.unmount();

    // A real report, without a throw, is the failure's reason.
    const second = fakeBridge();
    globalThis.window.DayGlanceNative = second.bridge;
    const reporting = vi.fn((callbacks) => ({
      dbSyncCycle: async () => { callbacks.onError(null, null); callbacks.onError('vault unreachable', 'NETWORK'); },
      getLastSynced: () => null,
      dispose: vi.fn(),
    }));
    const root2 = await mount({ bridge: () => second.bridge, createFileEngine: scriptedFileEngine().factory, createVaultEngine: reporting });
    await until(() => second.calls.headlessDone.length > 0);
    expect(second.calls.recordLauncherRefresh.at(-1)).toMatchObject({ outcome: 'failed', reason: 'vault: NETWORK vault unreachable' });
    expect(second.calls.updateLauncherSnapshot).toHaveLength(0);
    root2.unmount();
  });

  it('reports a throwing cycle as failed with its reason, still stamps the heartbeat, pushes no snapshot', async () => {
    seedStorage(ls);
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine({ fail: new Error('server unreachable') });
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null });
    await until(() => calls.headlessDone.length > 0);
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ outcome: 'failed', reason: 'server unreachable' });
    expect(calls.touchLauncherHeartbeat.length).toBeGreaterThan(0);
    expect(calls.updateLauncherSnapshot).toHaveLength(0);
    // Storage untouched by a failed cycle.
    expect(JSON.parse(ls.getItem('day-planner-tasks')).map((t) => t.id)).toEqual(['t1']);
    root.unmount();
  });

  it('fails honestly when the file tier is encrypted and no key is cached', async () => {
    seedStorage(ls, { encrypted: true });
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine();
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null });
    await until(() => calls.headlessDone.length > 0);
    expect(engine.seen.payloads).toHaveLength(0);
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ outcome: 'failed', reason: 'passphrase required' });
    root.unmount();
  });

  it('fails when no sync tier is configured', async () => {
    seedStorage(ls, { cloud: false });
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    const engine = scriptedFileEngine();
    const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null });
    await until(() => calls.headlessDone.length > 0);
    expect(engine.factory).not.toHaveBeenCalled();
    expect(calls.recordLauncherRefresh.at(-1)).toMatchObject({ outcome: 'failed', reason: 'no sync tier is configured' });
    root.unmount();
  });

  // #2141: daily notes live in IndexedDB. The root loads them the way App
  // does (loadData, which moves them out of localStorage on the first run),
  // publishes them only once loaded, and an applied note lands in the database.
  it('moves the notes to IndexedDB, publishes them once loaded, and applies a pulled note there', async () => {
    globalThis.indexedDB = new IDBFactory();
    const dbName = `headless-notes-${Math.random()}`;
    notesStore.resetDailyNotesStore({ backend: notesStore.createIdbNotesBackend(openDatabase, dbName), storage: ls });
    try {
      seedStorage(ls);
      const mine = { '2026-10-18': { text: 'written here', lastModified: '2026-10-18T20:00:00.000Z' } };
      const theirs = { '2026-10-19': { text: 'from the phone', lastModified: '2026-10-19T07:00:00.000Z' } };
      ls.setItem(notesStore.LEGACY_NOTES_KEY, JSON.stringify(mine));
      const { bridge, calls } = fakeBridge();
      globalThis.window.DayGlanceNative = bridge;
      const engine = scriptedFileEngine({ remoteNotes: theirs });
      const root = await mount({ bridge: () => bridge, createFileEngine: engine.factory, createVaultEngine: () => null, now: () => new Date('2026-10-19T12:00:00') });
      await until(() => calls.headlessDone.length > 0);
      await notesStore.flushDailyNotes();

      // The payload carried the moved notes, not an empty map.
      expect(engine.seen.payloads[0].data.dailyNotes).toEqual(mine);
      // They left localStorage, and the database holds both, the pulled one included.
      expect(ls.getItem(notesStore.LEGACY_NOTES_KEY)).toBeNull();
      const rows = await notesStore.createIdbNotesBackend(openDatabase, dbName).readAll();
      expect(rows.value).toEqual({ ...mine, ...theirs });
      root.unmount();
    } finally {
      notesStore.resetDailyNotesStore();
      delete globalThis.indexedDB;
    }
  });

  // The file tier's idle gate (@glance-apps/sync 2.3.0, #2142) skips a poll
  // only when the local data's JSON matches the last quiet cycle's. A payload
  // whose `data` carried the clock would differ on every poll, and the gate
  // would never engage: every poll would merge the whole file, as before.
  it('builds the same payload data twice when nothing changed, minutes apart', async () => {
    seedStorage(ls);
    const { bridge, calls } = fakeBridge();
    globalThis.window.DayGlanceNative = bridge;
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-19T12:00:00Z') });
    try {
      const built = [];
      const factory = vi.fn((callbacks) => ({
        sync: async () => {
          built.push(await callbacks.buildPayload());
          vi.setSystemTime(new Date('2026-10-19T12:05:00Z'));
          built.push(await callbacks.buildPayload());
        },
        getLastSynced: () => '2026-10-19T10:00:00.000Z',
      }));
      await mount({ bridge: () => bridge, createFileEngine: factory, createVaultEngine: () => null, now: () => new Date() });
      await until(() => calls.headlessDone.length > 0);

      expect(built).toHaveLength(2);
      expect(built[1].lastModified).not.toBe(built[0].lastModified);
      expect(JSON.stringify(built[1].data)).toBe(JSON.stringify(built[0].data));
    } finally {
      vi.useRealTimers();
    }
  });

  it('the store supplies every dep the sync payload and apply read', () => {
    // A key the store does not carry is a slice the headless payload would
    // send as undefined with a fresh lastModified; the hook names it.
    expect(missingSyncEngineDeps({})).not.toEqual([]);
  });
});
