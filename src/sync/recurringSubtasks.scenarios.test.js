// Subtasks of a repeating task are ticked per occurrence, and the ticks survive
// concurrent edits on another device, merged per date by their own stamps
// (utils/recurringSubtasks.js, packages/dayglance-vault/src/recurringExceptions.js).
// The harness is recurringExceptions.scenarios.test.js's: each device has its
// own storage and state and edits with the app's own writers; the real save
// pass stamps (useDataPersistence); each real tier merges (mergeSyncData for
// the file tier, dbAdapter through the vault simulator); the apply writes
// storage then state, as applyEngineData does; the save that follows must
// stamp nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyRecurringInstanceEdit } from '../utils/recurringInstanceEdit.js';
import { recurringTaskInstance } from '../utils/expandRecurringTasks.js';
import { withOccurrenceSubtask } from '../utils/recurringSubtasks.js';
import { mergeSyncData } from '../mergeSync.js';
import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';
import { shredState } from '@glance-apps/dayglance-vault';

vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));

const KEY = 'day-planner-recurring-tasks';
const T0 = '2026-10-20T08:00:00.000Z';
const at = (minute) => new Date(Date.UTC(2026, 9, 24, 9, minute));
// The old shared model left a tick on the series' own subtask: never read.
const base = {
  id: 'r1', title: 'Gym', startTime: '07:00', duration: 45, recurrence: { type: 'daily', startDate: '2026-10-01' },
  completedDates: [], exceptions: {}, notes: '',
  subtasks: [{ id: 'w', title: 'Warm up', completed: true }, { id: 'l', title: 'Lift', completed: false }], lastModified: T0,
};

async function device(name) {
  vi.resetModules();
  globalThis.window = { location: { search: '' } };
  const hook = (await import('../hooks/useDataPersistence.js')).default;
  const map = new Map();
  const storage = { getItem: k => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: k => { map.delete(k); } };
  const state = { recurringTasks: [structuredClone(base)] };
  map.set(KEY, JSON.stringify(state.recurringTasks));
  const dev = {
    name, state, map,
    stored: () => JSON.parse(map.get(KEY)),
    save: ({ suppressed = false } = {}) => {
      globalThis.localStorage = storage;
      hook({
        setTasks: () => {}, setUnscheduledTasks: () => {}, setRecycleBin: () => {},
        setRecurringTasks: (u) => { state.recurringTasks = typeof u === 'function' ? u(state.recurringTasks) : u; },
        setUndoToast: () => {}, t: k => k, suppressTimestampRef: { current: suppressed }, cloudSyncInitialDoneRef: { current: false },
        cloudSyncConfig: null, tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: state.recurringTasks, todayRoutines: [],
        darkMode: false, syncUrl: '', taskCalendarUrl: '', syncRetentionDays: 0, completedTaskUids: new Set(), routineDefinitions: {},
        routinesDate: '2026-10-24', removedTodayRoutineIds: {}, habits: [], habitLogs: {}, habitsEnabled: false, routinesEnabled: false,
        gtdFrames: [], goals: [], projects: [], areas: [], goalsProjectsEnabled: false, unscheduledOrderTimestamp: null,
      }).saveData();
    },
    // An edit with the app's own writer, at a moment, then the save pass.
    edit: (minute, change) => {
      vi.setSystemTime(at(minute));
      const now = at(minute).toISOString();
      state.recurringTasks = state.recurringTasks.map(t => ({ ...change(t, now), lastModified: now }));
      dev.save();
    },
    // What applyEngineData does with a merged list: storage first, then state.
    apply: (recurringTasks) => {
      map.set(KEY, JSON.stringify(recurringTasks));
      state.recurringTasks = structuredClone(recurringTasks);
      dev.save();
    },
  };
  dev.save();
  return dev;
}

// Edits with the app's own writers: a tick on one occurrence (what
// toggleSubtask does for a recurring id), and a rename of the series.
const tick = (date, id, done) => (t) => withOccurrenceSubtask(t, date, id, done);
const renameSeries = (t, now) => applyRecurringInstanceEdit(t, { dateStr: '2026-10-25', scope: 'all', now,
  edit: { ...recurringTaskInstance(t, '2026-10-25'), title: 'Gym and stretch' } });
// What each day's card shows: the occurrence's subtasks, ticked or not.
const ticked = (dev, date) => recurringTaskInstance(dev.state.recurringTasks[0], date).subtasks.filter(s => s.completed).map(s => s.id);

// The file tier, both ways: each device merges the other's stored payload.
function fileTierExchange(a, b) {
  const payload = dev => ({ tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: dev.stored(), deletedTaskIds: {} });
  const forA = mergeSyncData(payload(a), payload(b), 0).data.recurringTasks;
  const forB = mergeSyncData(payload(b), payload(a), 0).data.recurringTasks;
  a.apply(forA);
  b.apply(forB);
}

// The vault tier: the devices' stored rows pushed and pulled to convergence.
function vaultExchange(a, b) {
  const empty = { tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [], habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {} };
  const vault = createVault();
  const va = createDevice('A', { ...empty, recurringTasks: a.stored() });
  const vb = createDevice('B', { ...empty, recurringTasks: b.stored() });
  for (const row of shredState(va.data)) va.markDirty(row.entityId);
  for (const row of shredState(vb.data)) vb.markDirty(row.entityId);
  syncToConvergence(va, vb, vault);
  a.apply(va.data.recurringTasks);
  b.apply(vb.data.recurringTasks);
}

afterEach(() => { vi.useRealTimers(); delete globalThis.localStorage; delete globalThis.window; });

describe.each([['file tier', fileTierExchange], ['vault', vaultExchange]])('%s', (_, exchange) => {
  const pair = async () => { vi.useFakeTimers(); vi.setSystemTime(at(0)); return [await device('A'), await device('B')]; };

  it('a tick is that day\'s alone, and the old shared tick shows on no day', async () => {
    const [a] = await pair();
    expect(ticked(a, '2026-10-24')).toEqual([]);
    a.edit(1, tick('2026-10-24', 'l'));
    expect(ticked(a, '2026-10-24')).toEqual(['l']);
    expect(ticked(a, '2026-10-25')).toEqual([]);
  });

  // MUTATION: drop withMergedSubtaskCompletions from the tier and the newer
  // row (the rename) wins whole, taking the tick with it.
  it('keeps a tick on the phone against a later rename on the desktop', async () => {
    const [phone, desktop] = await pair();
    phone.edit(1, tick('2026-10-24', 'w'));
    desktop.edit(2, renameSeries);
    exchange(phone, desktop);
    for (const dev of [phone, desktop]) {
      expect(dev.state.recurringTasks[0].title).toBe('Gym and stretch');
      expect(ticked(dev, '2026-10-24')).toEqual(['w']);
      expect(ticked(dev, '2026-10-25')).toEqual([]);
    }
  });

  it('keeps ticks made on two days on two devices', async () => {
    const [a, b] = await pair();
    a.edit(1, tick('2026-10-24', 'w'));
    b.edit(2, tick('2026-10-25', 'l'));
    exchange(a, b);
    for (const dev of [a, b]) {
      expect(ticked(dev, '2026-10-24')).toEqual(['w']);
      expect(ticked(dev, '2026-10-25')).toEqual(['l']);
    }
  });

  it('carries an untick over an older copy that still has the tick', async () => {
    const [a, b] = await pair();
    a.edit(1, tick('2026-10-24', 'w'));
    exchange(a, b);
    a.edit(2, tick('2026-10-24', 'w', false));
    b.edit(3, renameSeries);
    exchange(a, b);
    for (const dev of [a, b]) expect(ticked(dev, '2026-10-24')).toEqual([]);
  });

  it('never stamps or re-stamps on the save after an apply', async () => {
    const [a, b] = await pair();
    a.edit(1, tick('2026-10-24', 'w'));
    b.edit(2, renameSeries);
    exchange(a, b);
    for (const dev of [a, b]) {
      const before = dev.map.get(KEY);
      vi.setSystemTime(at(30));
      dev.save();
      expect(dev.map.get(KEY)).toBe(before);
      expect(dev.stored()[0].lastModified).toBe(at(2).toISOString());
    }
  });
});

describe('the save pass', () => {
  it('stamps the date ticked, writes the stamp back into state, and leaves the old shared tick as it was', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(0));
    const a = await device('A');
    expect(a.stored()[0].subtaskCompletionsTimestamps).toBeUndefined();
    a.edit(1, tick('2026-10-24', 'l'));
    const row = a.state.recurringTasks[0];
    expect(row.subtaskCompletions).toEqual({ '2026-10-24': ['l'] });
    expect(row.subtaskCompletionsTimestamps).toEqual({ '2026-10-24': at(1).toISOString() });
    expect(row.subtasks).toEqual(base.subtasks);
    expect(a.stored()).toEqual(a.state.recurringTasks);
  });

  it('stamps nothing under the suppression flag', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(0));
    const a = await device('A');
    vi.setSystemTime(at(1));
    a.state.recurringTasks = a.state.recurringTasks.map(tick('2026-10-24', 'w'));
    a.save({ suppressed: true });
    expect(a.stored()[0].subtaskCompletionsTimestamps).toBeUndefined();
  });

  it('a change to the stamp map alone is not an edit', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(0));
    const a = await device('A');
    a.state.recurringTasks = [{ ...a.stored()[0], subtaskCompletionsTimestamps: { '2026-10-23': T0 } }];
    vi.setSystemTime(at(9));
    a.save();
    expect(a.stored()[0].lastModified).toBe(T0);
  });
});

describe('the file tier says which side must be written', () => {
  it('flags the side that lacks the other\'s tick, and nothing once both hold it', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(0));
    const [phone, desktop] = [await device('A'), await device('B')];
    phone.edit(1, tick('2026-10-24', 'w'));
    desktop.edit(2, renameSeries);
    const payload = dev => ({ tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: dev.stored(), deletedTaskIds: {} });
    // On the desktop: its own newer row wins whole, but must still take the tick.
    expect(mergeSyncData(payload(desktop), payload(phone), 0)).toMatchObject({ localChanged: true });
    fileTierExchange(phone, desktop);
    expect(mergeSyncData(payload(phone), payload(desktop), 0)).toMatchObject({ localChanged: false, remoteChanged: false });
  });
});
