import { describe, it, expect } from 'vitest';
import { createVault, createDevice, syncToConvergence } from './dbVaultSim.js';
import { shredState, makeEntityId } from './dbAdapter.js';

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2 PART A — MULTI-DEVICE MERGE CORRECTNESS (the gate)
//
// Two devices share one in-memory vault. Each edits a DIFFERENT entry of the
// same structure between syncs; after syncing both ways, no edit may be lost.
// A plain entity-grain LWW upsert of a whole bundle row fails this — that is the
// point of the per-bundle merge in dbAdapter.js.
// ─────────────────────────────────────────────────────────────────────────────

const T0 = '2026-06-18T10:00:00.000Z';
const T1 = '2026-06-18T11:00:00.000Z';
const T2 = '2026-06-18T12:00:00.000Z';

const EMPTY_COLLECTIONS = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
};

// Mark a device's entire current state dirty and converge, so the vault and both
// devices share a baseline (mirrors the HWM-0 full-snapshot seed).
function seedAndConverge(devA, devB, vault) {
  for (const row of shredState(devA.data)) devA.markDirty(row.entityId);
  syncToConvergence(devA, devB, vault);
}

function newPair(baseData) {
  const vault = createVault();
  const a = createDevice('A', baseData);
  const b = createDevice('B', baseData);
  seedAndConverge(a, b, vault);
  return { vault, a, b };
}

// A naive whole-bundle LWW (newer-writer overwrites the entire bundle) — used
// only to DEMONSTRATE the silent-loss this stage closes.
function naiveLWW(localBundle, localTs, remoteBundle, remoteTs) {
  return new Date(remoteTs) >= new Date(localTs) ? remoteBundle : localBundle;
}

describe('A1 bundle merge — concurrent different-entry edits are not lost', () => {
  it('DEMONSTRATION: naive whole-bundle LWW DOES lose an edit (why per-bundle merge is needed)', () => {
    // device 1 increments habit h1; device 2 increments h2; device 2 writes last.
    const dev1 = { h1: 5, h2: 1 };
    const dev2 = { h1: 4, h2: 3 };
    const merged = naiveLWW(dev1, T1, dev2, T2);
    expect(merged.h1).toBe(4); // device 1's increment to 5 is LOST
  });

  it('habitLogs: different habits on the same day both survive', () => {
    const base = {
      ...EMPTY_COLLECTIONS,
      habitLogs: { '2026-06-18': { h1: 4, h2: 1 } },
      habitLogTimestamps: { '2026-06-18:h1': T0, '2026-06-18:h2': T0 },
    };
    const { vault, a, b } = newPair(base);

    a.mutate((d) => {
      d.habitLogs['2026-06-18'].h1 = 5;
      d.habitLogTimestamps['2026-06-18:h1'] = T1;
      return [makeEntityId('singleton', 'habitLogs')];
    });
    b.mutate((d) => {
      d.habitLogs['2026-06-18'].h2 = 3;
      d.habitLogTimestamps['2026-06-18:h2'] = T2;
      return [makeEntityId('singleton', 'habitLogs')];
    });
    syncToConvergence(a, b, vault);

    for (const dev of [a, b]) {
      expect(dev.data.habitLogs['2026-06-18']).toEqual({ h1: 5, h2: 3 });
    }
  });

  it('habitLogs: edits on different days both survive', () => {
    const base = {
      ...EMPTY_COLLECTIONS,
      habitLogs: { '2026-06-18': { h1: 1 } },
      habitLogTimestamps: { '2026-06-18:h1': T0 },
    };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { d.habitLogs['2026-06-18'].h1 = 2; d.habitLogTimestamps['2026-06-18:h1'] = T1; return ['singleton:habitLogs']; });
    b.mutate((d) => { d.habitLogs['2026-06-19'] = { h1: 1 }; d.habitLogTimestamps['2026-06-19:h1'] = T2; return ['singleton:habitLogs']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(dev.data.habitLogs['2026-06-18'].h1).toBe(2);
      expect(dev.data.habitLogs['2026-06-19'].h1).toBe(1);
    }
  });

  it('routineDefinitions: a renamed chip and a new chip both survive', () => {
    const base = {
      ...EMPTY_COLLECTIONS,
      routineDefinitions: { monday: [{ id: 5001, name: 'Workout', lastModified: T0 }] },
      deletedRoutineChipIds: {},
    };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { d.routineDefinitions.monday[0] = { id: 5001, name: 'Workout v2', lastModified: T1 }; return ['singleton:routineDefinitions']; });
    b.mutate((d) => { d.routineDefinitions.monday.push({ id: 5003, name: 'Review', lastModified: T2 }); return ['singleton:routineDefinitions']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      const monday = dev.data.routineDefinitions.monday;
      expect(monday.find((c) => c.id === 5001).name).toBe('Workout v2');
      expect(monday.find((c) => c.id === 5003)).toBeTruthy();
    }
  });

  it('routineCompletions: completing different routines both survive', () => {
    const base = { ...EMPTY_COLLECTIONS, routinesDate: '2026-06-18', routineCompletions: {}, routineCompletionTimestamps: {} };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { d.routineCompletions['5001'] = '2026-06-18'; d.routineCompletionTimestamps['5001'] = T1; return ['singleton:routineCompletions']; });
    b.mutate((d) => { d.routineCompletions['5002'] = '2026-06-18'; d.routineCompletionTimestamps['5002'] = T1; return ['singleton:routineCompletions']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(dev.data.routineCompletions).toEqual({ 5001: '2026-06-18', 5002: '2026-06-18' });
    }
  });

  it('routineCompletions: an un-complete propagates instead of being resurrected (flip-flop bug)', () => {
    // Both devices see routine 5001 completed. Device A un-completes it (deletes
    // the key, stamps a later timestamp). After sync, BOTH devices must show it
    // un-completed — a grow-union would resurrect it from B's stale completion.
    const base = {
      ...EMPTY_COLLECTIONS, routinesDate: '2026-06-18',
      routineCompletions: { 5001: '2026-06-18' },
      routineCompletionTimestamps: { 5001: T0 },
    };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { delete d.routineCompletions['5001']; d.routineCompletionTimestamps['5001'] = T2; return ['singleton:routineCompletions']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(dev.data.routineCompletions['5001']).toBeUndefined();
    }
  });

  it('routineCompletions: a re-complete after an un-complete wins by recency', () => {
    // A un-completes (T1), then B re-completes the same routine later (T2).
    // The later complete must win on both devices.
    const base = {
      ...EMPTY_COLLECTIONS, routinesDate: '2026-06-18',
      routineCompletions: { 5001: '2026-06-18' },
      routineCompletionTimestamps: { 5001: T0 },
    };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { delete d.routineCompletions['5001']; d.routineCompletionTimestamps['5001'] = T1; return ['singleton:routineCompletions']; });
    b.mutate((d) => { d.routineCompletions['5001'] = '2026-06-18'; d.routineCompletionTimestamps['5001'] = T2; return ['singleton:routineCompletions']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(dev.data.routineCompletions['5001']).toBe('2026-06-18');
    }
  });

  it('routineCompletions: a day-rollover clear is not resurrected by a stale remote completion (completed-on-add bug)', () => {
    // Both devices hold yesterday's completion of routine 5001. Device A rolls
    // over to the new day: it clears the completion but stamps a FRESH tombstone
    // timestamp (T2) for that id instead of just dropping the timestamp. Device B
    // hasn't rolled over yet and still carries the stale completion (T0). After
    // sync, the completion must NOT come back — otherwise a routine re-added on
    // the new day shows up already completed (driven by routineCompletions[id]).
    const base = {
      ...EMPTY_COLLECTIONS, routinesDate: '2026-06-18',
      routineCompletions: { 5001: '2026-06-18' },
      routineCompletionTimestamps: { 5001: T0 },
    };
    const { vault, a, b } = newPair(base);
    // Rollover on A: completion cleared, tombstone timestamp stamped fresh.
    a.mutate((d) => { delete d.routineCompletions['5001']; d.routineCompletionTimestamps['5001'] = T2; return ['singleton:routineCompletions']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(dev.data.routineCompletions['5001']).toBeUndefined();
    }
  });

  it('routineCompletions: a bare clear (no tombstone) WOULD be resurrected — proves the tombstone is load-bearing', () => {
    // Counter-case to the test above: if the rollover had merely dropped the
    // timestamp (leaving T0) instead of stamping a fresh one, the remote's
    // equal-timestamp completion wins by the "present-wins" tie-break and the
    // completion is resurrected. This documents why the fix stamps the tombstone.
    const base = {
      ...EMPTY_COLLECTIONS, routinesDate: '2026-06-18',
      routineCompletions: { 5001: '2026-06-18' },
      routineCompletionTimestamps: { 5001: T0 },
    };
    const { vault, a, b } = newPair(base);
    // Bare clear: completion removed but timestamp left untouched (the old bug).
    a.mutate((d) => { delete d.routineCompletions['5001']; return ['singleton:routineCompletions']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(dev.data.routineCompletions['5001']).toBe('2026-06-18'); // resurrected
    }
  });

  it('recurringTasks: a completion is not clobbered by a concurrent series edit (the cross-device bug)', () => {
    const base = {
      ...EMPTY_COLLECTIONS,
      recurringTasks: [{
        id: 3001, title: 'Stretch', duration: 10, lastModified: T0,
        recurrence: { type: 'daily' },
        completedDates: ['2026-06-17'], completedDatesTimestamps: { '2026-06-17': T0 },
      }],
    };
    const { vault, a, b } = newPair(base);
    // Device A completes a NEW occurrence.
    a.mutate((d) => {
      const t = d.recurringTasks[0];
      t.completedDates = [...t.completedDates, '2026-06-18'];
      t.completedDatesTimestamps = { ...t.completedDatesTimestamps, '2026-06-18': T1 };
      t.lastModified = T1;
      return ['recurringTasks:3001'];
    });
    // Device B edits the same series LATER (e.g. a series-level assignment change);
    // its row does not yet have A's completion. Old whole-row LWW would drop it.
    b.mutate((d) => {
      const t = d.recurringTasks[0];
      t.assignedUserSyncIds = ['user-x'];
      t.lastModified = T2;
      return ['recurringTasks:3001'];
    });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      const t = dev.data.recurringTasks.find((x) => x.id === 3001);
      expect(new Set(t.completedDates)).toEqual(new Set(['2026-06-17', '2026-06-18'])); // completion survived
      expect(t.assignedUserSyncIds).toEqual(['user-x']);                                 // newer scalar edit survived
    }
  });

  it('recurringTasks: completing different occurrences on each device both survive', () => {
    const base = {
      ...EMPTY_COLLECTIONS,
      recurringTasks: [{
        id: 3001, title: 'Stretch', lastModified: T0, recurrence: { type: 'daily' },
        completedDates: [], completedDatesTimestamps: {},
      }],
    };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { const t = d.recurringTasks[0]; t.completedDates = ['2026-06-18']; t.completedDatesTimestamps = { '2026-06-18': T1 }; t.lastModified = T1; return ['recurringTasks:3001']; });
    b.mutate((d) => { const t = d.recurringTasks[0]; t.completedDates = ['2026-06-19']; t.completedDatesTimestamps = { '2026-06-19': T2 }; t.lastModified = T2; return ['recurringTasks:3001']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      const t = dev.data.recurringTasks.find((x) => x.id === 3001);
      expect(new Set(t.completedDates)).toEqual(new Set(['2026-06-18', '2026-06-19']));
    }
  });

  it('recurringTasks: an un-complete propagates instead of being resurrected', () => {
    const base = {
      ...EMPTY_COLLECTIONS,
      recurringTasks: [{
        id: 3001, title: 'Stretch', lastModified: T0, recurrence: { type: 'daily' },
        completedDates: ['2026-06-18'], completedDatesTimestamps: { '2026-06-18': T0 },
      }],
    };
    const { vault, a, b } = newPair(base);
    // A un-completes (removes the date, stamps a later timestamp); B is untouched.
    a.mutate((d) => { const t = d.recurringTasks[0]; t.completedDates = []; t.completedDatesTimestamps = { '2026-06-18': T2 }; t.lastModified = T2; return ['recurringTasks:3001']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      const t = dev.data.recurringTasks.find((x) => x.id === 3001);
      expect(t.completedDates).toEqual([]);
    }
  });

  it('completedTaskUids: appends on both devices both survive (set-union)', () => {
    const base = { ...EMPTY_COLLECTIONS, completedTaskUids: ['uid-base::2026-06-17'] };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { d.completedTaskUids.push('uid-a::2026-06-18'); return ['singleton:completedTaskUids']; });
    b.mutate((d) => { d.completedTaskUids.push('uid-b::2026-06-18'); return ['singleton:completedTaskUids']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(new Set(dev.data.completedTaskUids)).toEqual(
        new Set(['uid-base::2026-06-17', 'uid-a::2026-06-18', 'uid-b::2026-06-18']),
      );
    }
  });

  it('tombstone maps: deleting different ids on each device both survive (set-union)', () => {
    const base = { ...EMPTY_COLLECTIONS, deletedTaskIds: {} };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { d.deletedTaskIds['9001'] = T1; return ['singleton:deletedTaskIds']; });
    b.mutate((d) => { d.deletedTaskIds['9002'] = T2; return ['singleton:deletedTaskIds']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(Object.keys(dev.data.deletedTaskIds).sort()).toEqual(['9001', '9002']);
    }
  });

  it('single-user *Enabled pair: last-writer-wins by paired UpdatedAt, deterministic on both', () => {
    const base = { ...EMPTY_COLLECTIONS, habitsEnabled: true, habitsEnabledUpdatedAt: T0 };
    const { vault, a, b } = newPair(base);
    // No multiUserEnabled → the toggle syncs LWW across the user's own devices.
    a.mutate((d) => { d.habitsEnabled = false; d.habitsEnabledUpdatedAt = T1; return ['singleton:habitsEnabled']; });
    b.mutate((d) => { d.habitsEnabled = true;  d.habitsEnabledUpdatedAt = T2; return ['singleton:habitsEnabled']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(dev.data.habitsEnabled).toBe(true);          // T2 is newest
      expect(dev.data.habitsEnabledUpdatedAt).toBe(T2);
    }
  });

  it('multi-user *Enabled toggle stays device-local: a remote toggle never overrides local', () => {
    const base = { ...EMPTY_COLLECTIONS, multiUserEnabled: true, habitsEnabled: true, habitsEnabledUpdatedAt: T0 };
    const { vault, a, b } = newPair(base);
    // Both devices have multi-user on. B turns Habits off with the NEWEST
    // timestamp — under LWW it would flip A too; device-local keeps each own.
    a.mutate((d) => { d.habitsEnabled = true;  d.habitsEnabledUpdatedAt = T1; return ['singleton:habitsEnabled']; });
    b.mutate((d) => { d.habitsEnabled = false; d.habitsEnabledUpdatedAt = T2; return ['singleton:habitsEnabled']; });
    syncToConvergence(a, b, vault);
    expect(a.data.habitsEnabled).toBe(true);   // A keeps its own
    expect(b.data.habitsEnabled).toBe(false);  // B keeps its own
  });

  it('multi-user: calendar URLs are device-local but calendarConfigByUser merges per syncId', () => {
    const base = { ...EMPTY_COLLECTIONS, multiUserEnabled: true, syncUrl: '', taskCalendarUrl: '', calendarConfigByUser: {} };
    const { vault, a, b } = newPair(base);
    // Each device is a different user editing its own per-user entry; both survive.
    // The top-level syncUrl stays device-local (a different value on each device).
    a.mutate((d) => {
      d.syncUrl = 'https://a-local';
      d.calendarConfigByUser = { ...d.calendarConfigByUser, jason: { syncUrl: 'https://jason', updatedAt: T1 } };
      return ['singleton:syncUrl', 'singleton:calendarConfigByUser'];
    });
    b.mutate((d) => {
      d.syncUrl = 'https://b-local';
      d.calendarConfigByUser = { ...d.calendarConfigByUser, kim: { syncUrl: 'https://kim', updatedAt: T1 } };
      return ['singleton:syncUrl', 'singleton:calendarConfigByUser'];
    });
    syncToConvergence(a, b, vault);
    // Both users' per-user entries converge on both devices...
    for (const dev of [a, b]) {
      expect(dev.data.calendarConfigByUser.jason.syncUrl).toBe('https://jason');
      expect(dev.data.calendarConfigByUser.kim.syncUrl).toBe('https://kim');
    }
    // ...while the top-level URL stays whatever each device set locally.
    expect(a.data.syncUrl).toBe('https://a-local');
    expect(b.data.syncUrl).toBe('https://b-local');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A2 — CROSS-LIST MOVE (a task keeps its id while moving between kinds)
// ─────────────────────────────────────────────────────────────────────────────

const task = (id, lastModified, extra = {}) => ({
  id, title: `task ${id}`, duration: 30, color: 'bg-blue-500', completed: false,
  notes: '', subtasks: [], lastModified, ...extra,
});

// count how many task-kinds a given id is live under
function kindsHolding(data, id) {
  return ['tasks', 'unscheduledTasks', 'recurringTasks', 'recycleBin', 'todayRoutines']
    .filter((k) => (data[k] || []).some((t) => String(t.id) === String(id)));
}

describe('A2 cross-list move — a moved task ends up under exactly one kind', () => {
  it('one device moves unscheduled → scheduled; the other still has it unscheduled', () => {
    const base = { ...EMPTY_COLLECTIONS, unscheduledTasks: [task(1003, T0)] };
    const { vault, a, b } = newPair(base);

    // device A promotes 1003 to the schedule: tombstone-on-old + insert-on-new.
    a.mutate((d) => {
      d.unscheduledTasks = d.unscheduledTasks.filter((t) => t.id !== 1003);
      d.tasks.push(task(1003, T1, { date: '2026-06-18', startTime: '09:00' }));
      return [makeEntityId('unscheduledTasks', 1003), makeEntityId('tasks', 1003)];
    });
    syncToConvergence(a, b, vault);

    for (const dev of [a, b]) {
      expect(kindsHolding(dev.data, 1003)).toEqual(['tasks']); // exactly one, not lost, not duplicated
    }
  });

  it('both devices move the same task to DIFFERENT kinds: deterministic winner, no duplicate', () => {
    const base = { ...EMPTY_COLLECTIONS, unscheduledTasks: [task(1003, T0)] };
    const { vault, a, b } = newPair(base);

    // A → scheduled at T1; B → recycleBin at T2 (T2 newer, so recycleBin wins).
    a.mutate((d) => {
      d.unscheduledTasks = d.unscheduledTasks.filter((t) => t.id !== 1003);
      d.tasks.push(task(1003, T1, { date: '2026-06-18' }));
      return [makeEntityId('unscheduledTasks', 1003), makeEntityId('tasks', 1003)];
    });
    b.mutate((d) => {
      d.unscheduledTasks = d.unscheduledTasks.filter((t) => t.id !== 1003);
      d.recycleBin.push(task(1003, T2, { deletedAt: T2, _deletedFrom: 'inbox' }));
      return [makeEntityId('unscheduledTasks', 1003), makeEntityId('recycleBin', 1003)];
    });
    syncToConvergence(a, b, vault);

    for (const dev of [a, b]) {
      expect(kindsHolding(dev.data, 1003)).toEqual(['recycleBin']); // newest lastModified wins, agreed on both
    }
  });

  it('tie on lastModified resolves by CROSS_LIST_PRIORITY (recycleBin beats tasks)', () => {
    const base = { ...EMPTY_COLLECTIONS, unscheduledTasks: [task(1003, T0)] };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => {
      d.unscheduledTasks = d.unscheduledTasks.filter((t) => t.id !== 1003);
      d.tasks.push(task(1003, T1, { date: '2026-06-18' }));
      return ['unscheduledTasks:1003', 'tasks:1003'];
    });
    b.mutate((d) => {
      d.unscheduledTasks = d.unscheduledTasks.filter((t) => t.id !== 1003);
      d.recycleBin.push(task(1003, T1, { deletedAt: T1 })); // same lastModified as A's
      return ['unscheduledTasks:1003', 'recycleBin:1003'];
    });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(kindsHolding(dev.data, 1003)).toEqual(['recycleBin']);
    }
  });
});
