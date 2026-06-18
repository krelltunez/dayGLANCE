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

  it('routineCompletions: completing different routines both survive (set-union)', () => {
    const base = { ...EMPTY_COLLECTIONS, routinesDate: '2026-06-18', routineCompletions: {} };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { d.routineCompletions['5001'] = '2026-06-18'; return ['singleton:routineCompletions']; });
    b.mutate((d) => { d.routineCompletions['5002'] = '2026-06-18'; return ['singleton:routineCompletions']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(dev.data.routineCompletions).toEqual({ 5001: '2026-06-18', 5002: '2026-06-18' });
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

  it('*Enabled pair: last-writer-wins by paired UpdatedAt, deterministic on both', () => {
    const base = { ...EMPTY_COLLECTIONS, habitsEnabled: true, habitsEnabledUpdatedAt: T0 };
    const { vault, a, b } = newPair(base);
    a.mutate((d) => { d.habitsEnabled = false; d.habitsEnabledUpdatedAt = T1; return ['singleton:habitsEnabled']; });
    b.mutate((d) => { d.habitsEnabled = true; d.habitsEnabledUpdatedAt = T2; return ['singleton:habitsEnabled']; });
    syncToConvergence(a, b, vault);
    for (const dev of [a, b]) {
      expect(dev.data.habitsEnabled).toBe(true);          // T2 is newest
      expect(dev.data.habitsEnabledUpdatedAt).toBe(T2);
    }
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
