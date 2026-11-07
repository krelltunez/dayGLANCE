// Frame sets (#2305) and a frame's `setId` through both sync tiers, end to end.
//
// CLAUDE.md, "Adding a field to a task": assert the data is observable where the
// app reads it, not that the function computing it returned it. Every scenario
// here walks production code between the modules:
//   - the vault tier drives the real adapter callbacks through dbVaultSim;
//   - the file tier runs the real mergeSyncData;
//   - the full walks build the payload with the real buildSyncPayload from one
//     device's STATE, carry it through a tier, and land it with the real
//     applyEngineData into another device's state and storage, where
//     frameInstancesForDate (what the timeline, dial and launcher read) is
//     asked which frames apply.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));

import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';
import {
  makeEntityId, COLLECTION_KINDS, TOMBSTONE_BUNDLE_KEYS, shredState, applyRemoteEntity,
  absentCollectionKinds, carryAbsentCollections,
} from '@glance-apps/dayglance-vault';
import { frameInstancesForDate } from '@glance-apps/agenda-core';
import { mergeSyncData } from '../mergeSync.js';
import useSyncEngineData, { SYNC_ENGINE_DATA_DEPS, missingSyncEngineDeps } from '../hooks/useSyncEngineData.js';
import { initialHeadlessState } from '../headless/useHeadlessStore.js';
import { newFrameSet, switchFrameSet, detachFramesFromSet, recordFrameSetTombstones } from '../utils/frameSetEdits.js';
import { FRAME_SETS_KEY, DELETED_FRAME_SET_IDS_KEY } from '../utils/storedSlices.js';

const T0 = '2026-11-01T09:00:00.000Z';
const T1 = '2026-11-07T10:00:00.000Z';
const TODAY = '2026-11-07'; // a Saturday
const MON_PAST = '2026-11-02';
const MON_NEXT = '2026-11-09';

const SET = (id, name, over = {}) => ({ id, name, periods: [{ from: null, until: null }], lastModified: T0, ...over });
const F = (id, over = {}) => ({
  id, label: id, enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00',
  color: 'bg-indigo-200', bufferMinutes: 5, lastModified: T0, ...over,
});

const EMPTY_VAULT_DATA = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], areas: [], gtdFrames: [], frameSets: [], users: [], dailyNotes: {},
};
const emptyFileData = () => ({
  tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
  completedTaskUids: [], deletedTaskIds: {}, deletedRoutineChipIds: {},
  deletedFrameIds: {}, syncUrl: null, taskCalendarUrl: null,
  routineDefinitions: {}, todayRoutines: [], routinesDate: '',
  minimizedSections: {}, use24HourClock: false, gtdFrames: [],
});

const setRow = (id) => makeEntityId('frameSets', id);
const frameRow = (id) => makeEntityId('gtdFrames', id);
const onDates = (frames, sets, date) => frameInstancesForDate(frames, date, { frameSets: sets }).map((i) => i.frameId);

describe('frameSets: declared to the vault tier', () => {
  it('is a collection on lastModified, like the frames it groups', () => {
    expect(COLLECTION_KINDS.frameSets).toEqual({ idField: 'id', tsField: 'lastModified' });
  });

  it('has a deletion tombstone bundle both tiers prune and the delete guard reads', () => {
    expect(TOMBSTONE_BUNDLE_KEYS).toContain('deletedFrameSetIds');
  });

  it('an omitted list is not an empty one: the diff carries its rows forward', () => {
    const { frameSets: _omitted, ...withoutSets } = EMPTY_VAULT_DATA;
    expect(absentCollectionKinds(withoutSets)).toContain('frameSets');
    expect(absentCollectionKinds(EMPTY_VAULT_DATA)).not.toContain('frameSets');
    const prev = { [setRow('s1')]: 'h1', [frameRow('f1')]: 'h2' };
    expect(carryAbsentCollections(prev, { ...withoutSets, gtdFrames: [] })).toEqual({ [setRow('s1')]: 'h1' });
  });
});

describe('frame sets across two devices: vault tier', () => {
  const twoDevices = (sets, frames = []) => {
    const vault = createVault();
    const mac = createDevice('mac', { ...EMPTY_VAULT_DATA, frameSets: sets, gtdFrames: frames });
    const android = createDevice('android', EMPTY_VAULT_DATA);
    for (const s of sets) mac.markDirty(setRow(s.id));
    for (const f of frames) mac.markDirty(frameRow(f.id));
    syncToConvergence(mac, android, vault);
    return { vault, mac, android };
  };

  it('a new set and a frame assigned to it reach the other device', () => {
    const { android } = twoDevices([SET('work', 'Work')], [F('desk', { setId: 'work' })]);
    expect(android.data.frameSets.map((s) => s.name)).toEqual(['Work']);
    expect(android.data.gtdFrames[0].setId).toBe('work');
  });

  it('switching a set off reaches the other device, and history stays', () => {
    const { vault, mac, android } = twoDevices([SET('work', 'Work')], [F('desk', { setId: 'work' })]);
    mac.mutate((d) => {
      d.frameSets = switchFrameSet(d.frameSets, 'work', false, TODAY, T1);
      return [setRow('work')];
    });
    syncToConvergence(mac, android, vault);

    expect(android.data.frameSets[0].periods).toEqual([{ from: null, until: '2026-11-06' }]);
    expect(onDates(android.data.gtdFrames, android.data.frameSets, MON_PAST)).toEqual(['desk']);
    expect(onDates(android.data.gtdFrames, android.data.frameSets, MON_NEXT)).toEqual([]);
  });

  it('assigning a set to an existing frame is an edit that reaches the other device', () => {
    const { vault, mac, android } = twoDevices([SET('work', 'Work')], [F('desk')]);
    mac.mutate((d) => {
      d.gtdFrames = d.gtdFrames.map((f) => (f.id === 'desk' ? { ...f, setId: 'work', lastModified: T1 } : f));
      return [frameRow('desk')];
    });
    syncToConvergence(mac, android, vault);
    expect(android.data.gtdFrames[0].setId).toBe('work');
  });

  it('an older app that edits the frame afterwards keeps setId: its edits spread the stored row', () => {
    // A build without sets stores the pulled row whole and edits with
    // `{ ...f, … }` (saveFrame via FrameEditor, skipFrameForDay,
    // saveFrameAdjust), so a field it does not know rides through.
    const { vault, mac, android } = twoDevices([SET('work', 'Work')], [F('desk', { setId: 'work' })]);
    android.mutate((d) => {
      d.gtdFrames = d.gtdFrames.map((f) => ({ ...f, label: 'Desk work', lastModified: T1 }));
      return [frameRow('desk')];
    });
    syncToConvergence(mac, android, vault);
    expect(mac.data.gtdFrames[0]).toMatchObject({ label: 'Desk work', setId: 'work' });
  });

  it('a set deleted on one device is deleted on the other', () => {
    const { vault, mac, android } = twoDevices([SET('work', 'Work'), SET('hol', 'Holiday')]);
    mac.mutate((d) => {
      d.frameSets = d.frameSets.filter((s) => s.id !== 'hol');
      return [setRow('hol')];
    });
    syncToConvergence(mac, android, vault);
    expect(android.data.frameSets.map((s) => s.id)).toEqual(['work']);
  });
});

describe('frame sets across two devices: file tier', () => {
  it('a set only one side has reaches the other, in both directions', () => {
    const mine = { ...emptyFileData(), frameSets: [SET('work', 'Work')] };
    const theirs = emptyFileData();
    const asLocal = mergeSyncData(mine, theirs);
    expect(asLocal.data.frameSets.map((s) => s.id)).toEqual(['work']);
    expect(asLocal.remoteChanged).toBe(true);
    const asRemote = mergeSyncData(theirs, mine);
    expect(asRemote.data.frameSets.map((s) => s.id)).toEqual(['work']);
    expect(asRemote.localChanged).toBe(true);
  });

  it('keeps the newer copy whichever side is local', () => {
    const off = switchFrameSet([SET('work', 'Work')], 'work', false, TODAY, T1);
    const a = { ...emptyFileData(), frameSets: off };
    const b = { ...emptyFileData(), frameSets: [SET('work', 'Work')] };
    expect(mergeSyncData(a, b).data.frameSets[0].periods).toEqual([{ from: null, until: '2026-11-06' }]);
    expect(mergeSyncData(b, a).data.frameSets[0].periods).toEqual([{ from: null, until: '2026-11-06' }]);
  });

  it('converges on one copy when two copies tie on lastModified', () => {
    const a = { ...emptyFileData(), frameSets: [SET('work', 'Work A')] };
    const b = { ...emptyFileData(), frameSets: [SET('work', 'Work B')] };
    expect(mergeSyncData(a, b).data.frameSets[0].name).toBe(mergeSyncData(b, a).data.frameSets[0].name);
  });

  it('honours a set tombstone newer than the surviving copy, and keeps the tombstone', () => {
    const deleter = { ...emptyFileData(), frameSets: [], deletedFrameSetIds: { hol: T1 } };
    const holder = { ...emptyFileData(), frameSets: [SET('hol', 'Holiday')] };
    const merged = mergeSyncData(holder, deleter).data;
    expect(merged.frameSets).toEqual([]);
    expect(merged.deletedFrameSetIds).toHaveProperty('hol');
  });

  it('neither side carrying the list leaves it out rather than inventing []', () => {
    expect(mergeSyncData(emptyFileData(), emptyFileData()).data).not.toHaveProperty('frameSets');
  });

  it('a frame keeps its setId through the merge', () => {
    const a = { ...emptyFileData(), gtdFrames: [F('desk', { setId: 'work', lastModified: T1 })] };
    const b = { ...emptyFileData(), gtdFrames: [F('desk')] };
    expect(mergeSyncData(b, a).data.gtdFrames[0].setId).toBe('work');
    expect(mergeSyncData(a, b).data.gtdFrames[0].setId).toBe('work');
  });
});

// ── Save → state → push → apply ──────────────────────────────────────────────

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

function on(device, fn) {
  const previous = globalThis.localStorage;
  globalThis.localStorage = device.storage;
  try { return fn(); } finally { globalThis.localStorage = previous; }
}

/** One app instance: its state, React-like setters, storage, and the real payload/apply. */
function appDevice(overrides = {}) {
  const state = { ...initialHeadlessState(), ...overrides };
  const refs = {
    tasksLiveRef: { current: state.tasks },
    unscheduledLiveRef: { current: state.unscheduledTasks },
    dayWindowsRef: { current: null },
    joboRecordsRef: { current: undefined },
    applyingRemoteDataRef: { current: false },
    suppressClearPendingRef: { current: false },
    suppressCloudUploadRef: { current: false },
    suppressTimestampRef: { current: false },
  };
  const setters = {};
  for (const name of SYNC_ENGINE_DATA_DEPS.setters) {
    const key = name[3].toLowerCase() + name.slice(4);
    setters[name] = (next) => { state[key] = typeof next === 'function' ? next(state[key]) : next; };
  }
  return {
    state,
    setters,
    storage: memoryStorage(),
    mount() {
      const deps = {};
      for (const key of SYNC_ENGINE_DATA_DEPS.values) deps[key] = state[key];
      deps.allTodayRoutines = state.todayRoutines;
      Object.assign(deps, refs, setters);
      deps.applyRemoteDayWindows = vi.fn();
      deps.applyRemoteJobo = vi.fn();
      deps.stampTaskTimestamps = (list) => list;
      const build = useSyncEngineData;
      return build(deps);
    },
  };
}

const stored = (device, key) => JSON.parse(device.storage.getItem(key) || 'null');

describe('frame sets: save → state → push → apply', () => {
  beforeEach(() => { globalThis.localStorage = memoryStorage(); });
  afterEach(() => { delete globalThis.localStorage; vi.restoreAllMocks(); });

  // Device A makes a Work set, puts a frame in it and switches it off today;
  // the tiers then carry A's payload to device B.
  const deviceA = () => {
    const A = appDevice({ gtdFrames: [F('desk'), F('always', { start: '18:00', end: '19:00' })] });
    A.setters.setFrameSets((sets) => [...sets, newFrameSet({ id: 'work', name: 'Work', now: T0 })]);
    A.setters.setGtdFrames((frames) => frames.map((f) => (f.id === 'desk' ? { ...f, setId: 'work', lastModified: T0 } : f)));
    A.setters.setFrameSets((sets) => switchFrameSet(sets, 'work', false, TODAY, T1));
    return A;
  };
  const expectLanded = (B) => {
    expect(B.state.frameSets).toEqual([{ id: 'work', name: 'Work', periods: [{ from: null, until: '2026-11-06' }], lastModified: T1 }]);
    expect(B.state.gtdFrames.find((f) => f.id === 'desk').setId).toBe('work');
    expect(stored(B, FRAME_SETS_KEY)).toEqual(B.state.frameSets);
    expect(stored(B, 'day-planner-gtd-frames').find((f) => f.id === 'desk').setId).toBe('work');
    // What the timeline, dial and launcher read on B.
    expect(onDates(B.state.gtdFrames, B.state.frameSets, MON_PAST)).toEqual(['desk', 'always']);
    expect(onDates(B.state.gtdFrames, B.state.frameSets, MON_NEXT)).toEqual(['always']);
  };

  it('the payload carries the sets, their tombstones and every frame\'s setId from state', () => {
    const A = deviceA();
    const data = on(A, () => A.mount().buildSyncPayload()).data;
    expect(data.frameSets).toEqual(A.state.frameSets);
    expect(data.deletedFrameSetIds).toEqual({});
    expect(data.gtdFrames.find((f) => f.id === 'desk').setId).toBe('work');
  });

  it('file tier: A\'s payload merged into B\'s and applied lands in B\'s state and storage', () => {
    const A = deviceA();
    const pushed = on(A, () => A.mount().buildSyncPayload()).data;
    const B = appDevice({ gtdFrames: [] });
    const local = on(B, () => B.mount().buildSyncPayload()).data;
    const { data: merged } = mergeSyncData(local, pushed);
    on(B, () => B.mount().applyEngineData(merged, { allowEmpty: true }));
    expectLanded(B);
  });

  it('vault tier: A\'s rows applied to B\'s mirror and applied land in B\'s state and storage', () => {
    const A = deviceA();
    const pushed = on(A, () => A.mount().buildSyncPayload()).data;
    const B = appDevice({ gtdFrames: [] });
    const mirror = on(B, () => B.mount().buildSyncPayload()).data;
    for (const row of shredState(pushed).filter((r) => r.kind === 'frameSets' || r.kind === 'gtdFrames')) {
      applyRemoteEntity(mirror, JSON.parse(JSON.stringify(row.entity)));
    }
    on(B, () => B.mount().applyEngineData(mirror, { allowEmpty: true }));
    expectLanded(B);
  });

  it('a set deleted on A goes on B, and its frame comes back unassigned', () => {
    const A = deviceA();
    const before = on(A, () => A.mount().buildSyncPayload()).data;
    const B = appDevice({ gtdFrames: [] });
    on(B, () => B.mount().applyEngineData(mergeSyncData(on(B, () => B.mount().buildSyncPayload()).data, before).data, { allowEmpty: true }));
    expect(B.state.frameSets).toHaveLength(1);

    // What useFrameSetActions.deleteSet does on A.
    on(A, () => recordFrameSetTombstones(['work'], '2026-11-07T11:00:00.000Z'));
    A.setters.setFrameSets((sets) => sets.filter((s) => s.id !== 'work'));
    A.setters.setGtdFrames((frames) => detachFramesFromSet(frames, 'work', '2026-11-07T11:00:00.000Z'));
    const pushed = on(A, () => A.mount().buildSyncPayload()).data;
    expect(pushed.deletedFrameSetIds).toEqual({ work: '2026-11-07T11:00:00.000Z' });

    const local = on(B, () => B.mount().buildSyncPayload()).data;
    const { data: merged } = mergeSyncData(local, pushed);
    on(B, () => B.mount().applyEngineData(merged, { allowEmpty: true }));
    expect(B.state.frameSets).toEqual([]);
    expect(B.state.gtdFrames.find((f) => f.id === 'desk')).not.toHaveProperty('setId');
    expect(stored(B, DELETED_FRAME_SET_IDS_KEY)).toHaveProperty('work');
    // The frame is back on every date, as one in no set.
    expect(onDates(B.state.gtdFrames, B.state.frameSets, MON_NEXT)).toEqual(['desk', 'always']);
  });

  it('not loaded is not empty: an unreadable list is left out of the payload, and the tiers fill it', () => {
    const B = appDevice({ gtdFrames: [F('desk', { setId: 'work' })], frameSets: undefined });
    const local = on(B, () => B.mount().buildSyncPayload()).data;
    expect(local).not.toHaveProperty('frameSets');
    // Its tombstones still ride, like every deletion bundle.
    expect(local).toHaveProperty('deletedFrameSetIds');
    // Vault tier: the omitted kind is carried forward, not diffed as deletions.
    expect(absentCollectionKinds(local)).toContain('frameSets');
    // File tier: the other device's sets arrive, and the apply fills the slice.
    const remote = { ...emptyFileData(), frameSets: [SET('work', 'Work')] };
    const { data: merged } = mergeSyncData(local, remote);
    on(B, () => B.mount().applyEngineData(merged, { allowEmpty: true }));
    expect(B.state.frameSets.map((s) => s.id)).toEqual(['work']);
  });

  it('a merge that carries no list leaves this device\'s sets alone', () => {
    const B = appDevice({ frameSets: [SET('work', 'Work')] });
    on(B, () => B.mount().applyEngineData({ ...emptyFileData(), tasks: [] }, { allowEmpty: true }));
    expect(B.state.frameSets.map((s) => s.id)).toEqual(['work']);
  });

  it('a root has to pass the sets key, but may pass it undefined', () => {
    const deps = {};
    for (const key of [...SYNC_ENGINE_DATA_DEPS.values, ...SYNC_ENGINE_DATA_DEPS.setters, ...SYNC_ENGINE_DATA_DEPS.refs, ...SYNC_ENGINE_DATA_DEPS.functions]) deps[key] = () => {};
    deps.frameSets = undefined;
    expect(missingSyncEngineDeps(deps)).toEqual([]);
    delete deps.frameSets;
    expect(missingSyncEngineDeps(deps)).toEqual(['frameSets']);
    delete deps.setFrameSets;
    expect(missingSyncEngineDeps(deps)).toEqual(['frameSets', 'setFrameSets']);
  });
});
