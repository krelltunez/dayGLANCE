// Occurrence edits of a recurring series survive concurrent edits on another
// device (docs/recurring-exceptions-merge.md). Each device has its own storage
// and state and edits with the app's own writers; the real save pass stamps
// (useDataPersistence); the payload is what it stored; each real tier merges
// (mergeSyncData for the file tier, dbAdapter through the vault simulator);
// the apply writes storage then state, as applyEngineData does; and the save
// pass that follows must stamp nothing.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { skipOccurrence, restoreOccurrence } from '../jobo/skipOccurrence.js';
import { applyRecurringInstanceEdit } from '../utils/recurringInstanceEdit.js';
import { recurringTaskInstance } from '../utils/expandRecurringTasks.js';
import { mergeSyncData } from '../mergeSync.js';
import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';
import { shredState } from '@glance-apps/dayglance-vault';

vi.mock('../utils/nativeCalendar.js', () => ({ hasNativeCalendar: () => false }));

const KEY = 'day-planner-recurring-tasks';
const T0 = '2026-10-20T08:00:00.000Z';
const at = (minute) => new Date(Date.UTC(2026, 9, 24, 9, minute));
const base = {
  id: 'r1', title: 'Gym', startTime: '07:00', duration: 45, recurrence: { type: 'daily', startDate: '2026-10-01' },
  completedDates: [], exceptions: { '2026-10-23': { startTime: '06:00' } }, notes: '', subtasks: [], lastModified: T0,
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

const skipToday = (t) => skipOccurrence(t, '2026-10-24', { at: '2026-10-24T11:00:00+02:00' });
const renameSeries = (t, now) => applyRecurringInstanceEdit(t, { dateStr: '2026-10-25', scope: 'all', now,
  edit: { ...recurringTaskInstance(t, '2026-10-25'), title: 'Gym and stretch' } });
const moveOne = (date, startTime) => (t, now) => applyRecurringInstanceEdit(t, { dateStr: date, scope: 'this', now,
  edit: { ...recurringTaskInstance(t, date), startTime } });

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

  it('keeps a skip on the phone against a later rename on the desktop', async () => {
    const [phone, desktop] = await pair();
    phone.edit(1, skipToday);
    desktop.edit(2, renameSeries);
    exchange(phone, desktop);
    for (const dev of [phone, desktop]) {
      const [t] = dev.state.recurringTasks;
      expect(t.title).toBe('Gym and stretch');
      expect(t.exceptions['2026-10-24']).toMatchObject({ skipped: true });
      expect(t.exceptions['2026-10-23']).toEqual({ startTime: '06:00' });
      expect(t.exceptionsTimestamps).toEqual({ '2026-10-24': at(1).toISOString() });
      expect(dev.stored()).toEqual(dev.state.recurringTasks);
    }
    // Undo of the skip still finds it, on either device.
    expect(restoreOccurrence(desktop.state.recurringTasks[0], '2026-10-24', '2026-10-24T11:00:00+02:00')).not.toBeNull();
  });

  it('keeps two occurrences moved on two devices', async () => {
    const [a, b] = await pair();
    a.edit(1, moveOne('2026-10-25', '08:00'));
    b.edit(2, moveOne('2026-10-26', '09:30'));
    exchange(a, b);
    for (const dev of [a, b]) {
      expect(dev.state.recurringTasks[0].exceptions).toEqual({
        '2026-10-23': { startTime: '06:00' }, '2026-10-25': { startTime: '08:00' }, '2026-10-26': { startTime: '09:30' },
      });
    }
  });

  it('carries a removal over an older copy that still has the date', async () => {
    const [a, b] = await pair();
    // MCP undo of an occurrence edit removes the key.
    a.edit(1, (t) => { const { '2026-10-23': _gone, ...rest } = t.exceptions; return { ...t, exceptions: rest }; });
    b.edit(2, moveOne('2026-10-26', '09:30'));
    exchange(a, b);
    for (const dev of [a, b]) {
      expect(dev.state.recurringTasks[0].exceptions).toEqual({ '2026-10-26': { startTime: '09:30' } });
    }
  });

  it('lets the later of two edits to one date win it whole', async () => {
    const [a, b] = await pair();
    a.edit(1, moveOne('2026-10-25', '08:00'));
    b.edit(2, moveOne('2026-10-25', '10:00'));
    exchange(a, b);
    for (const dev of [a, b]) expect(dev.state.recurringTasks[0].exceptions['2026-10-25']).toEqual({ startTime: '10:00' });
  });

  it('never stamps or re-stamps on the save after an apply', async () => {
    const [a, b] = await pair();
    a.edit(1, skipToday);
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
  it('stamps nothing under the suppression flag, and nothing on first sight', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(0));
    const a = await device('A');
    expect(a.stored()[0].exceptionsTimestamps).toBeUndefined();
    vi.setSystemTime(at(1));
    a.state.recurringTasks = a.state.recurringTasks.map(t => skipToday(t));
    a.save({ suppressed: true });
    expect(a.stored()[0].exceptionsTimestamps).toBeUndefined();
  });

  it('writes the stamps back into state, which the payload is built from', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(0));
    const a = await device('A');
    a.edit(1, moveOne('2026-10-25', '08:00'));
    expect(a.state.recurringTasks[0].exceptionsTimestamps).toEqual({ '2026-10-25': at(1).toISOString() });
    expect(a.stored()).toEqual(a.state.recurringTasks);
  });
});

describe('the file tier says which side must be written', () => {
  it('flags the side that lacks the other\'s occurrence edit, so it uploads or persists', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(0));
    const [phone, desktop] = [await device('A'), await device('B')];
    phone.edit(1, skipToday);
    desktop.edit(2, renameSeries);
    const payload = dev => ({ tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: dev.stored(), deletedTaskIds: {} });
    // On the phone: the desktop's newer row wins whole, and still lacks the skip.
    expect(mergeSyncData(payload(phone), payload(desktop), 0)).toMatchObject({ localChanged: true, remoteChanged: true });
    // On the desktop: its own newer row wins whole, but must still take the skip.
    expect(mergeSyncData(payload(desktop), payload(phone), 0)).toMatchObject({ localChanged: true });
    // Once both hold the merged copy, nothing is left to write.
    fileTierExchange(phone, desktop);
    expect(mergeSyncData(payload(phone), payload(desktop), 0)).toMatchObject({ localChanged: false, remoteChanged: false });
  });
});

describe('a change to the stamp map alone is not an edit', () => {
  it('keeps lastModified when only exceptionsTimestamps differs from storage', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(0));
    const a = await device('A');
    // Storage written by an older version that dropped the map; state holds it.
    a.state.recurringTasks = [{ ...a.stored()[0], exceptionsTimestamps: { '2026-10-23': T0 } }];
    vi.setSystemTime(at(9));
    a.save();
    expect(a.stored()[0].lastModified).toBe(T0);
  });
});

describe('an older app version, which does not stamp', () => {
  it('loses a same-date clash to a stamped edit, and otherwise merges as before', async () => {
    vi.useFakeTimers(); vi.setSystemTime(at(0));
    const a = await device('A');
    a.edit(1, moveOne('2026-10-25', '08:00'));
    const legacy = { ...structuredClone(base), title: 'Gym (old app)', lastModified: at(5).toISOString(),
      exceptions: { ...base.exceptions, '2026-10-25': { startTime: '11:00' }, '2026-10-26': { deleted: true } } };
    const payload = list => ({ tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: list, deletedTaskIds: {} });
    const [merged] = mergeSyncData(payload(a.stored()), payload([legacy]), 0).data.recurringTasks;
    expect(merged.title).toBe('Gym (old app)');
    expect(merged.exceptions).toEqual({ '2026-10-23': { startTime: '06:00' }, '2026-10-25': { startTime: '08:00' }, '2026-10-26': { deleted: true } });
  });
});
