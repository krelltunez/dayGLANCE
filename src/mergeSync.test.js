import { describe, it, expect } from 'vitest';
import { mergeTaskArrays, mergeRoutineDefinitions, mergeDailyNotes, mergeHabits, mergeHabitLogs, mergeSyncData } from './mergeSync.js';

// Helpers to create task fixtures with timestamps
const T = (id, title, lastModified, extra = {}) => ({
  id, title, duration: 30, color: 'bg-blue-500', completed: false, lastModified, ...extra
});
const ts = (minutesAgo) => new Date(Date.now() - minutesAgo * 60000).toISOString();

// ─── mergeTaskArrays ────────────────────────────────────────────────

describe('mergeTaskArrays', () => {
  it('returns empty result for two empty arrays', () => {
    const { merged, localChanged, remoteChanged } = mergeTaskArrays([], [], {});
    expect(merged).toEqual([]);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('keeps local-only tasks and flags remoteChanged', () => {
    const local = [T(1, 'Local task', ts(5))];
    const { merged, localChanged, remoteChanged } = mergeTaskArrays(local, [], {});
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Local task');
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(true);
  });

  it('keeps remote-only tasks and flags localChanged', () => {
    const remote = [T(2, 'Remote task', ts(5))];
    const { merged, localChanged, remoteChanged } = mergeTaskArrays([], remote, {});
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Remote task');
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(false);
  });

  it('picks the newer version when both sides have the same task', () => {
    const local  = [T(1, 'Old title', ts(10))];
    const remote = [T(1, 'New title', ts(2))];
    const { merged } = mergeTaskArrays(local, remote, {});
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('New title');
  });

  it('picks local when local is newer', () => {
    const local  = [T(1, 'Local edit', ts(1))];
    const remote = [T(1, 'Remote edit', ts(10))];
    const { merged, remoteChanged } = mergeTaskArrays(local, remote, {});
    expect(merged[0].title).toBe('Local edit');
    expect(remoteChanged).toBe(true);
  });

  it('prefers local on equal timestamps', () => {
    const time = ts(5);
    const local  = [T(1, 'Local ver', time)];
    const remote = [T(1, 'Remote ver', time)];
    const { merged, localChanged, remoteChanged } = mergeTaskArrays(local, remote, {});
    expect(merged[0].title).toBe('Local ver');
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  // ── The core user scenario ──────────────────────────────────────
  it('CORE: adding tasks on two devices preserves both', () => {
    // Desktop adds Task A and Task B
    const desktop = [
      T(1, 'Existing', ts(60)),
      T(2, 'Desktop Task A', ts(5)),
      T(3, 'Desktop Task B', ts(3)),
    ];
    // Tablet still has only the original task
    const tablet = [T(1, 'Existing', ts(60))];

    // Tablet syncs — merge should keep all 3
    const { merged, localChanged } = mergeTaskArrays(tablet, desktop, {});
    expect(merged).toHaveLength(3);
    const ids = merged.map(t => t.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
    expect(localChanged).toBe(true); // tablet needs updating
  });

  it('preserves local ordering and appends remote-only at end', () => {
    const local  = [T(1, 'First', ts(10)), T(2, 'Second', ts(8))];
    const remote = [T(3, 'New from remote', ts(5)), T(1, 'First', ts(10))];
    const { merged } = mergeTaskArrays(local, remote, {});
    expect(merged.map(t => t.id)).toEqual([1, 2, 3]);
  });

  // ── Tombstones ──────────────────────────────────────────────────
  it('excludes local tasks that have a newer tombstone', () => {
    const local = [T(1, 'Should be gone', ts(10))];
    const deleted = { '1': ts(2) }; // deleted more recently
    const { merged, localChanged } = mergeTaskArrays(local, [], deleted);
    expect(merged).toHaveLength(0);
    expect(localChanged).toBe(true);
  });

  it('keeps local tasks when tombstone is older than lastModified', () => {
    const local = [T(1, 'Recreated', ts(2))];
    const deleted = { '1': ts(10) }; // deleted long ago, task is newer
    const { merged } = mergeTaskArrays(local, [], deleted);
    expect(merged).toHaveLength(1);
  });

  it('excludes remote tasks that have a newer tombstone', () => {
    const remote = [T(5, 'Deleted on other device', ts(10))];
    const deleted = { '5': ts(2) };
    const { merged, remoteChanged } = mergeTaskArrays([], remote, deleted);
    expect(merged).toHaveLength(0);
    expect(remoteChanged).toBe(true);
  });

  // ── Tasks without lastModified (backward compat) ───────────────
  it('handles tasks without lastModified (treated as epoch)', () => {
    const local  = [{ id: 1, title: 'No timestamp' }];
    const remote = [T(1, 'Has timestamp', ts(5))];
    const { merged } = mergeTaskArrays(local, remote, {});
    expect(merged[0].title).toBe('Has timestamp');
  });
});

// ─── mergeSyncData (full sync merge) ────────────────────────────────

describe('mergeSyncData', () => {
  const emptyData = () => ({
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
    completedTaskUids: [], deletedTaskIds: {},
    syncUrl: null, taskCalendarUrl: null,
    routineDefinitions: {}, todayRoutines: [], routinesDate: '',
    minimizedSections: {}, use24HourClock: false
  });

  it('merges two empty datasets with no changes', () => {
    const { data, localChanged, remoteChanged } = mergeSyncData(emptyData(), emptyData());
    expect(data.tasks).toEqual([]);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  // ── The user's reported scenario ───────────────────────────────
  it('SCENARIO: tasks added on desktop survive when tablet syncs', () => {
    const desktop = {
      ...emptyData(),
      tasks: [
        T(1, 'Morning standup', ts(30)),
        T(2, 'New from desktop', ts(5)),
      ],
      unscheduledTasks: [T(10, 'Inbox from desktop', ts(4))],
    };
    const tablet = {
      ...emptyData(),
      tasks: [T(1, 'Morning standup', ts(30))],
      unscheduledTasks: [],
    };

    // Tablet merges with desktop data
    const { data, localChanged, remoteChanged } = mergeSyncData(tablet, desktop);
    expect(data.tasks).toHaveLength(2);
    expect(data.tasks.map(t => t.id)).toContain(2);
    expect(data.unscheduledTasks).toHaveLength(1);
    expect(data.unscheduledTasks[0].id).toBe(10);
    expect(localChanged).toBe(true);   // tablet gets new tasks from desktop
    expect(remoteChanged).toBe(false); // tablet has nothing new for the server
  });

  // ── Cross-list: active vs recycle bin ──────────────────────────
  it('deletion wins over older active task', () => {
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Active task', ts(10))],
    };
    const deviceB = {
      ...emptyData(),
      recycleBin: [{ ...T(1, 'Deleted', ts(10)), deletedAt: ts(3), _deletedFrom: 'calendar' }],
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.tasks).toHaveLength(0);        // removed from active
    expect(data.recycleBin).toHaveLength(1);   // stays in bin
  });

  it('active task wins when modified after deletion', () => {
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Re-edited', ts(1))],  // modified very recently
    };
    const deviceB = {
      ...emptyData(),
      recycleBin: [{ ...T(1, 'Deleted', ts(10)), deletedAt: ts(5), _deletedFrom: 'calendar' }],
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe('Re-edited');
    expect(data.recycleBin).toHaveLength(0);
  });

  // ── Cross-list: scheduled ↔ inbox move ─────────────────────────
  it('handles task moved from inbox to scheduled on one device', () => {
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Now scheduled', ts(2), { startTime: '09:00', date: '2026-02-13' })],
    };
    const deviceB = {
      ...emptyData(),
      unscheduledTasks: [T(1, 'Still in inbox', ts(10))],
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    // Scheduled version is newer — should end up in tasks only
    expect(data.tasks).toHaveLength(1);
    expect(data.unscheduledTasks).toHaveLength(0);
    expect(data.tasks[0].title).toBe('Now scheduled');
  });

  // ── Tombstones from both sides ─────────────────────────────────
  it('combines tombstones from both devices', () => {
    const local = {
      ...emptyData(),
      deletedTaskIds: { '100': ts(5) },
    };
    const remote = {
      ...emptyData(),
      deletedTaskIds: { '200': ts(3) },
    };

    const { data } = mergeSyncData(local, remote);
    expect(data.deletedTaskIds).toHaveProperty('100');
    expect(data.deletedTaskIds).toHaveProperty('200');
  });

  it('keeps the later tombstone when both devices deleted the same task', () => {
    const recentDeletion = ts(2);
    const local = {
      ...emptyData(),
      deletedTaskIds: { '1': ts(10) },
    };
    const remote = {
      ...emptyData(),
      deletedTaskIds: { '1': recentDeletion }, // deleted more recently
    };

    const { data } = mergeSyncData(local, remote);
    expect(new Date(data.deletedTaskIds['1']).getTime())
      .toBe(new Date(recentDeletion).getTime());
  });

  // ── Completed UIDs union ───────────────────────────────────────
  it('unions completedTaskUids from both sides', () => {
    const local  = { ...emptyData(), completedTaskUids: ['a', 'b'] };
    const remote = { ...emptyData(), completedTaskUids: ['b', 'c'] };
    const { data } = mergeSyncData(local, remote);
    expect(data.completedTaskUids.sort()).toEqual(['a', 'b', 'c']);
  });

  // ── Settings preferences ───────────────────────────────────────
  it('keeps local device-specific settings', () => {
    const local  = { ...emptyData(), use24HourClock: true, minimizedSections: { inbox: true } };
    const remote = { ...emptyData(), use24HourClock: false, minimizedSections: {} };
    const { data } = mergeSyncData(local, remote);
    expect(data.use24HourClock).toBe(true);
    expect(data.minimizedSections).toEqual({ inbox: true });
  });

  it('prefers remote for shared settings', () => {
    const local  = { ...emptyData(), syncUrl: 'http://old' };
    const remote = { ...emptyData(), syncUrl: 'http://new' };
    const { data } = mergeSyncData(local, remote);
    expect(data.syncUrl).toBe('http://new');
  });

  // ── Bidirectional sync scenario ────────────────────────────────
  it('both devices adding different tasks: all tasks survive', () => {
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Shared', ts(60)), T(2, 'From A', ts(5))],
      unscheduledTasks: [T(10, 'Inbox A', ts(4))],
    };
    const deviceB = {
      ...emptyData(),
      tasks: [T(1, 'Shared', ts(60)), T(3, 'From B', ts(3))],
      unscheduledTasks: [T(11, 'Inbox B', ts(2))],
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.tasks.map(t => t.id).sort()).toEqual([1, 2, 3]);
    expect(data.unscheduledTasks.map(t => t.id).sort()).toEqual([10, 11]);
  });

  it('conflicting edits on same task: newer edit wins', () => {
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Edit from A', ts(5))],
    };
    const deviceB = {
      ...emptyData(),
      tasks: [T(1, 'Edit from B', ts(2))], // more recent
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].title).toBe('Edit from B');
  });

  // ── Recurring tasks merge ──────────────────────────────────────
  it('merges recurring tasks by ID', () => {
    const local = {
      ...emptyData(),
      recurringTasks: [T(100, 'Daily standup', ts(60))],
    };
    const remote = {
      ...emptyData(),
      recurringTasks: [T(100, 'Daily standup', ts(60)), T(101, 'Weekly review', ts(5))],
    };
    const { data } = mergeSyncData(local, remote);
    expect(data.recurringTasks).toHaveLength(2);
  });

  // ── Recurring task deletion sync ─────────────────────────────
  it('SCENARIO: recurring template deleted on one device stays deleted when other device syncs', () => {
    // Device A still has the recurring template
    const deviceA = {
      ...emptyData(),
      recurringTasks: [T(100, 'Daily standup', ts(60))],
    };
    // Device B deleted it and recorded a tombstone
    const deviceB = {
      ...emptyData(),
      recurringTasks: [],
      deletedTaskIds: { '100': ts(2) },
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    // Template should NOT come back — tombstone is newer than lastModified
    expect(data.recurringTasks).toHaveLength(0);
    expect(data.deletedTaskIds).toHaveProperty('100');
  });

  it('SCENARIO: recurring template re-created after deletion survives sync', () => {
    // Device A re-created the template with a newer timestamp
    const deviceA = {
      ...emptyData(),
      recurringTasks: [T(100, 'Daily standup v2', ts(1))],
    };
    // Device B had deleted it earlier
    const deviceB = {
      ...emptyData(),
      recurringTasks: [],
      deletedTaskIds: { '100': ts(5) },
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    // Re-created template (ts(1) = 1 min ago) is newer than tombstone (ts(5) = 5 min ago)
    expect(data.recurringTasks).toHaveLength(1);
    expect(data.recurringTasks[0].title).toBe('Daily standup v2');
  });

  // ── Completion sync scenarios ─────────────────────────────────
  it('SCENARIO: completion on device A survives when stale device B syncs', () => {
    // Device A completed the task (lastModified bumped to ts(1))
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Buy groceries', ts(1), { completed: true })],
    };
    // Device B still has the old uncompleted version (lastModified ts(10))
    const deviceB = {
      ...emptyData(),
      tasks: [T(1, 'Buy groceries', ts(10), { completed: false })],
    };

    // When device B downloads and merges with device A's data
    const { data } = mergeSyncData(deviceB, deviceA);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].completed).toBe(true);
  });

  it('SCENARIO: inbox task completion survives sync', () => {
    const deviceA = {
      ...emptyData(),
      unscheduledTasks: [T(5, 'Read book', ts(1), { completed: true, completedAt: '2026-02-14' })],
    };
    const deviceB = {
      ...emptyData(),
      unscheduledTasks: [T(5, 'Read book', ts(10), { completed: false })],
    };

    const { data } = mergeSyncData(deviceB, deviceA);
    expect(data.unscheduledTasks[0].completed).toBe(true);
    expect(data.unscheduledTasks[0].completedAt).toBe('2026-02-14');
  });

  // ── Task move sync scenarios ──────────────────────────────────
  it('SCENARIO: task moved to inbox on device A survives when device B syncs', () => {
    // Device A moved the task to inbox (lastModified bumped)
    const deviceA = {
      ...emptyData(),
      unscheduledTasks: [T(1, 'Flexible task', ts(1), { startTime: null, date: null })],
    };
    // Device B still has it on the calendar
    const deviceB = {
      ...emptyData(),
      tasks: [T(1, 'Flexible task', ts(10), { startTime: '09:00', date: '2026-02-14' })],
    };

    const { data } = mergeSyncData(deviceB, deviceA);
    // The moved version (inbox, ts(1) = newer) should win
    expect(data.unscheduledTasks).toHaveLength(1);
    expect(data.unscheduledTasks[0].id).toBe(1);
    // Should not also appear in scheduled tasks
    expect(data.tasks).toHaveLength(0);
  });

  it('SCENARIO: task moved to calendar on device A survives when device B syncs', () => {
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Now scheduled', ts(1), { startTime: '14:00', date: '2026-02-14' })],
    };
    const deviceB = {
      ...emptyData(),
      unscheduledTasks: [T(1, 'Now scheduled', ts(10))],
    };

    const { data } = mergeSyncData(deviceB, deviceA);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].startTime).toBe('14:00');
    expect(data.unscheduledTasks).toHaveLength(0);
  });

  // ── Recycle bin sync scenarios ────────────────────────────────
  it('SCENARIO: task deleted on device A stays deleted when device B syncs', () => {
    // Device A deleted the task (in recycle bin with deletedAt)
    const deviceA = {
      ...emptyData(),
      recycleBin: [{ ...T(1, 'Deleted task', ts(10)), deletedAt: ts(1), _deletedFrom: 'calendar' }],
    };
    // Device B still has it active
    const deviceB = {
      ...emptyData(),
      tasks: [T(1, 'Deleted task', ts(10))],
    };

    const { data } = mergeSyncData(deviceB, deviceA);
    // deletedAt (ts(1)) is newer than lastModified (ts(10)), so deletion wins
    expect(data.tasks).toHaveLength(0);
    expect(data.recycleBin).toHaveLength(1);
    expect(data.recycleBin[0].id).toBe(1);
  });

  it('SCENARIO: task deleted from inbox stays deleted when other device syncs', () => {
    const deviceA = {
      ...emptyData(),
      recycleBin: [{ ...T(5, 'Old todo', ts(10)), deletedAt: ts(1), _deletedFrom: 'inbox' }],
    };
    const deviceB = {
      ...emptyData(),
      unscheduledTasks: [T(5, 'Old todo', ts(10))],
    };

    const { data } = mergeSyncData(deviceB, deviceA);
    expect(data.unscheduledTasks).toHaveLength(0);
    expect(data.recycleBin).toHaveLength(1);
  });

  it('SCENARIO: task restored from recycle bin stays active when other device syncs', () => {
    // Device A restored the task (bumped lastModified)
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Restored task', ts(1), { startTime: '10:00', date: '2026-02-14' })],
    };
    // Device B still has it in recycle bin
    const deviceB = {
      ...emptyData(),
      recycleBin: [{ ...T(1, 'Restored task', ts(10)), deletedAt: ts(5), _deletedFrom: 'calendar' }],
    };

    const { data } = mergeSyncData(deviceB, deviceA);
    // Active version (ts(1)) is newer than deletedAt (ts(5)), so active wins
    expect(data.tasks).toHaveLength(1);
    expect(data.recycleBin).toHaveLength(0);
  });

  // ── Task move (startTime/duration) sync scenarios ────────────────
  it('SCENARIO: task moved to new time on device A survives when device B syncs', () => {
    // Device A moved the task from 09:00 to 14:00 (lastModified bumped)
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Meeting', ts(1), { startTime: '14:00', duration: 60, date: '2026-02-14' })],
    };
    // Device B still has it at 09:00 (older lastModified)
    const deviceB = {
      ...emptyData(),
      tasks: [T(1, 'Meeting', ts(10), { startTime: '09:00', duration: 60, date: '2026-02-14' })],
    };

    const { data } = mergeSyncData(deviceB, deviceA);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].startTime).toBe('14:00');
  });

  it('SCENARIO: task duration changed on device A survives when device B syncs', () => {
    const deviceA = {
      ...emptyData(),
      tasks: [T(1, 'Focus block', ts(1), { startTime: '10:00', duration: 120, date: '2026-02-14' })],
    };
    const deviceB = {
      ...emptyData(),
      tasks: [T(1, 'Focus block', ts(10), { startTime: '10:00', duration: 30, date: '2026-02-14' })],
    };

    const { data } = mergeSyncData(deviceB, deviceA);
    expect(data.tasks).toHaveLength(1);
    expect(data.tasks[0].duration).toBe(120);
  });

  it('SCENARIO: tasks with missing notes/subtasks fields merge correctly', () => {
    // Simulates the bug where tasks without notes/subtasks defaults get
    // spuriously re-stamped with a newer lastModified on app load
    const deviceA = {
      ...emptyData(),
      tasks: [{ id: 1, title: 'Moved', startTime: '14:00', duration: 30, date: '2026-02-14',
                color: 'bg-blue-500', completed: false, lastModified: ts(5) }],
    };
    const deviceB = {
      ...emptyData(),
      tasks: [{ id: 1, title: 'Moved', startTime: '09:00', duration: 30, date: '2026-02-14',
                color: 'bg-blue-500', completed: false, notes: '', subtasks: [], lastModified: ts(10) }],
    };

    // Device A's version is newer (ts(5) = 5 min ago, ts(10) = 10 min ago)
    const { data } = mergeSyncData(deviceB, deviceA);
    expect(data.tasks[0].startTime).toBe('14:00');
  });
});

// ─── mergeRoutineDefinitions ─────────────────────────────────────────

describe('mergeRoutineDefinitions', () => {
  const emptyDefs = () => ({
    monday: [], tuesday: [], wednesday: [], thursday: [],
    friday: [], saturday: [], sunday: [], everyday: []
  });

  it('returns empty buckets for two empty definition sets', () => {
    const { merged, localChanged, remoteChanged } = mergeRoutineDefinitions(emptyDefs(), emptyDefs());
    expect(merged.monday).toEqual([]);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('keeps local-only chips and flags remoteChanged', () => {
    const local = { ...emptyDefs(), monday: [{ id: 1, name: 'Workout' }] };
    const remote = emptyDefs();
    const { merged, localChanged, remoteChanged } = mergeRoutineDefinitions(local, remote);
    expect(merged.monday).toHaveLength(1);
    expect(merged.monday[0].name).toBe('Workout');
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(true);
  });

  it('keeps remote-only chips and flags localChanged', () => {
    const local = emptyDefs();
    const remote = { ...emptyDefs(), tuesday: [{ id: 2, name: 'Meditate' }] };
    const { merged, localChanged, remoteChanged } = mergeRoutineDefinitions(local, remote);
    expect(merged.tuesday).toHaveLength(1);
    expect(merged.tuesday[0].name).toBe('Meditate');
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(false);
  });

  it('CORE: routines added on different devices to same bucket are both preserved', () => {
    const local = { ...emptyDefs(), monday: [{ id: 1, name: 'Workout' }] };
    const remote = { ...emptyDefs(), monday: [{ id: 2, name: 'Journal' }] };
    const { merged, localChanged, remoteChanged } = mergeRoutineDefinitions(local, remote);
    expect(merged.monday).toHaveLength(2);
    const ids = merged.monday.map(c => c.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(true);
  });

  it('CORE: routines added to different buckets on different devices are both preserved', () => {
    const local = { ...emptyDefs(), monday: [{ id: 1, name: 'Workout' }] };
    const remote = { ...emptyDefs(), friday: [{ id: 2, name: 'Review' }] };
    const { merged, localChanged, remoteChanged } = mergeRoutineDefinitions(local, remote);
    expect(merged.monday).toHaveLength(1);
    expect(merged.friday).toHaveLength(1);
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(true);
  });

  it('does not duplicate chips that exist on both sides', () => {
    const shared = { id: 1, name: 'Workout' };
    const local = { ...emptyDefs(), monday: [shared] };
    const remote = { ...emptyDefs(), monday: [shared] };
    const { merged, localChanged, remoteChanged } = mergeRoutineDefinitions(local, remote);
    expect(merged.monday).toHaveLength(1);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('preserves local ordering and appends remote-only at end', () => {
    const local = { ...emptyDefs(), everyday: [{ id: 1, name: 'First' }, { id: 2, name: 'Second' }] };
    const remote = { ...emptyDefs(), everyday: [{ id: 3, name: 'New remote' }, { id: 1, name: 'First' }] };
    const { merged } = mergeRoutineDefinitions(local, remote);
    expect(merged.everyday.map(c => c.id)).toEqual([1, 2, 3]);
  });

  it('handles remote bucket not present locally', () => {
    const local = { monday: [{ id: 1, name: 'Workout' }] };
    const remote = { monday: [{ id: 1, name: 'Workout' }], custom: [{ id: 2, name: 'Custom' }] };
    const { merged, localChanged } = mergeRoutineDefinitions(local, remote);
    expect(merged.custom).toHaveLength(1);
    expect(localChanged).toBe(true);
  });

  it('tombstone removes local chip and flags localChanged', () => {
    const local = { ...emptyDefs(), monday: [{ id: 1, name: 'Workout' }, { id: 2, name: 'Journal' }] };
    const remote = { ...emptyDefs(), monday: [{ id: 1, name: 'Workout' }] };
    const tombstones = { '2': new Date().toISOString() };
    const { merged, localChanged } = mergeRoutineDefinitions(local, remote, tombstones);
    expect(merged.monday).toHaveLength(1);
    expect(merged.monday[0].id).toBe(1);
    expect(localChanged).toBe(true);
  });

  it('tombstone prevents remote-only chip from being added', () => {
    const local = emptyDefs();
    const remote = { ...emptyDefs(), monday: [{ id: 1, name: 'Deleted' }] };
    const tombstones = { '1': new Date().toISOString() };
    const { merged, localChanged, remoteChanged } = mergeRoutineDefinitions(local, remote, tombstones);
    expect(merged.monday).toHaveLength(0);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(true);
  });

  it('tombstone does not affect non-tombstoned chips', () => {
    const local = { ...emptyDefs(), monday: [{ id: 1, name: 'Keep' }, { id: 2, name: 'Remove' }] };
    const remote = { ...emptyDefs(), monday: [{ id: 1, name: 'Keep' }, { id: 3, name: 'New' }] };
    const tombstones = { '2': new Date().toISOString() };
    const { merged } = mergeRoutineDefinitions(local, remote, tombstones);
    expect(merged.monday).toHaveLength(2);
    expect(merged.monday.map(c => c.id)).toEqual([1, 3]);
  });

  it('chip with lastModified newer than tombstone resurrects (local)', () => {
    const local = { ...emptyDefs(), monday: [{ id: 1, name: 'Recreated', lastModified: ts(1) }] };
    const remote = emptyDefs();
    const tombstones = { '1': ts(10) }; // deleted 10 min ago, chip modified 1 min ago
    const { merged, remoteChanged } = mergeRoutineDefinitions(local, remote, tombstones);
    expect(merged.monday).toHaveLength(1);
    expect(merged.monday[0].name).toBe('Recreated');
    expect(remoteChanged).toBe(true);
  });

  it('chip with lastModified newer than tombstone resurrects (remote)', () => {
    const local = emptyDefs();
    const remote = { ...emptyDefs(), monday: [{ id: 1, name: 'Recreated', lastModified: ts(1) }] };
    const tombstones = { '1': ts(10) }; // deleted 10 min ago, chip modified 1 min ago
    const { merged, localChanged } = mergeRoutineDefinitions(local, remote, tombstones);
    expect(merged.monday).toHaveLength(1);
    expect(merged.monday[0].name).toBe('Recreated');
    expect(localChanged).toBe(true);
  });

  it('chip with lastModified older than tombstone is still deleted', () => {
    const local = { ...emptyDefs(), monday: [{ id: 1, name: 'Old', lastModified: ts(10) }] };
    const remote = emptyDefs();
    const tombstones = { '1': ts(1) }; // deleted 1 min ago, chip modified 10 min ago
    const { merged, localChanged } = mergeRoutineDefinitions(local, remote, tombstones);
    expect(merged.monday).toHaveLength(0);
    expect(localChanged).toBe(true);
  });

  it('chip without lastModified (legacy) is still deleted by tombstone', () => {
    const local = { ...emptyDefs(), monday: [{ id: 1, name: 'Legacy' }] };
    const remote = emptyDefs();
    const tombstones = { '1': ts(100) }; // any tombstone beats missing lastModified
    const { merged, localChanged } = mergeRoutineDefinitions(local, remote, tombstones);
    expect(merged.monday).toHaveLength(0);
    expect(localChanged).toBe(true);
  });
});

// ─── mergeSyncData: routine definition scenarios ─────────────────────

describe('mergeSyncData — routine definitions', () => {
  const emptyData = () => ({
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
    completedTaskUids: [], deletedTaskIds: {}, deletedRoutineChipIds: {},
    syncUrl: null, taskCalendarUrl: null,
    routineDefinitions: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [], everyday: [] },
    todayRoutines: [], routinesDate: '',
    minimizedSections: {}, use24HourClock: false
  });

  it('SCENARIO: routine added on desktop survives when tablet syncs', () => {
    const desktop = {
      ...emptyData(),
      routineDefinitions: {
        ...emptyData().routineDefinitions,
        monday: [{ id: 100, name: 'Morning workout' }]
      }
    };
    const tablet = emptyData();

    const { data, localChanged } = mergeSyncData(tablet, desktop);
    expect(data.routineDefinitions.monday).toHaveLength(1);
    expect(data.routineDefinitions.monday[0].name).toBe('Morning workout');
    expect(localChanged).toBe(true);
  });

  it('SCENARIO: routines added on two devices to same bucket both survive', () => {
    const deviceA = {
      ...emptyData(),
      routineDefinitions: {
        ...emptyData().routineDefinitions,
        monday: [{ id: 1, name: 'Workout' }, { id: 2, name: 'From A' }]
      }
    };
    const deviceB = {
      ...emptyData(),
      routineDefinitions: {
        ...emptyData().routineDefinitions,
        monday: [{ id: 1, name: 'Workout' }, { id: 3, name: 'From B' }]
      }
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    const ids = data.routineDefinitions.monday.map(c => c.id);
    expect(ids).toContain(1);
    expect(ids).toContain(2);
    expect(ids).toContain(3);
    expect(data.routineDefinitions.monday).toHaveLength(3);
  });

  it('SCENARIO: routines added on two devices to different buckets both survive', () => {
    const deviceA = {
      ...emptyData(),
      routineDefinitions: {
        ...emptyData().routineDefinitions,
        monday: [{ id: 1, name: 'From A' }]
      }
    };
    const deviceB = {
      ...emptyData(),
      routineDefinitions: {
        ...emptyData().routineDefinitions,
        friday: [{ id: 2, name: 'From B' }]
      }
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.routineDefinitions.monday).toHaveLength(1);
    expect(data.routineDefinitions.friday).toHaveLength(1);
  });

  it('SCENARIO: identical routines on both devices produce no changes', () => {
    const shared = {
      ...emptyData(),
      routineDefinitions: {
        ...emptyData().routineDefinitions,
        everyday: [{ id: 1, name: 'Meditate' }]
      }
    };

    const { data, localChanged, remoteChanged } = mergeSyncData({ ...shared }, { ...shared });
    expect(data.routineDefinitions.everyday).toHaveLength(1);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('SCENARIO: routine deleted on one device is removed on the other via tombstone', () => {
    const deviceA = {
      ...emptyData(),
      routineDefinitions: {
        ...emptyData().routineDefinitions,
        monday: [{ id: 1, name: 'Workout' }]
      }
    };
    const deviceB = {
      ...emptyData(),
      deletedRoutineChipIds: { '1': new Date().toISOString() }
    };

    const { data, localChanged, remoteChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.routineDefinitions.monday).toHaveLength(0);
    expect(localChanged).toBe(true); // chip was removed locally
    expect(data.deletedRoutineChipIds['1']).toBeDefined();
  });

  it('SCENARIO: routine tombstones from both devices are combined', () => {
    const deviceA = {
      ...emptyData(),
      deletedRoutineChipIds: { '1': '2025-01-01T00:00:00Z' }
    };
    const deviceB = {
      ...emptyData(),
      deletedRoutineChipIds: { '2': '2025-01-02T00:00:00Z' }
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.deletedRoutineChipIds['1']).toBeDefined();
    expect(data.deletedRoutineChipIds['2']).toBeDefined();
  });
});

// ─── mergeSyncData: todayRoutines sync ──────────────────────────────

describe('mergeSyncData — todayRoutines sync', () => {
  const emptyData = () => ({
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
    completedTaskUids: [], deletedTaskIds: {}, deletedRoutineChipIds: {},
    syncUrl: null, taskCalendarUrl: null,
    routineDefinitions: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [], everyday: [] },
    todayRoutines: [], routinesDate: '',
    minimizedSections: {}, use24HourClock: false
  });

  const R = (id, name, extra = {}) => ({
    id, name, bucket: 'everyday', startTime: null, duration: 15, isAllDay: true, ...extra
  });

  it('SCENARIO: routine selected on tablet appears on desktop after sync (same date)', () => {
    const tablet = {
      ...emptyData(),
      todayRoutines: [R('shower', 'Shower')],
      routinesDate: '2026-02-14',
    };
    const desktop = {
      ...emptyData(),
      todayRoutines: [R('banking', 'Banking', { startTime: '14:30', duration: 60, isAllDay: false })],
      routinesDate: '2026-02-14',
    };

    // Desktop merges with tablet data
    const { data, localChanged } = mergeSyncData(desktop, tablet);
    expect(data.todayRoutines).toHaveLength(2);
    const ids = data.todayRoutines.map(r => r.id);
    expect(ids).toContain('shower');
    expect(ids).toContain('banking');
    expect(localChanged).toBe(true);
  });

  it('SCENARIO: both devices see all routines after bidirectional sync', () => {
    const tablet = {
      ...emptyData(),
      todayRoutines: [R('shower', 'Shower')],
      routinesDate: '2026-02-14',
    };
    const desktop = {
      ...emptyData(),
      todayRoutines: [R('banking', 'Banking', { startTime: '14:30', duration: 60, isAllDay: false })],
      routinesDate: '2026-02-14',
    };

    // Tablet syncs with desktop data
    const tabletResult = mergeSyncData(tablet, desktop);
    expect(tabletResult.data.todayRoutines).toHaveLength(2);
    expect(tabletResult.data.todayRoutines.map(r => r.id)).toContain('banking');

    // Desktop syncs with tablet data
    const desktopResult = mergeSyncData(desktop, tablet);
    expect(desktopResult.data.todayRoutines).toHaveLength(2);
    expect(desktopResult.data.todayRoutines.map(r => r.id)).toContain('shower');
  });

  it('does not duplicate routines that exist on both sides', () => {
    const shared = R('shower', 'Shower');
    const deviceA = { ...emptyData(), todayRoutines: [shared], routinesDate: '2026-02-14' };
    const deviceB = { ...emptyData(), todayRoutines: [shared], routinesDate: '2026-02-14' };

    const { data, localChanged, remoteChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.todayRoutines).toHaveLength(1);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('respects tombstones — deleted routine does not reappear from remote', () => {
    const deviceA = {
      ...emptyData(),
      todayRoutines: [],
      routinesDate: '2026-02-14',
      deletedRoutineChipIds: { 'shower': new Date().toISOString() },
    };
    const deviceB = {
      ...emptyData(),
      todayRoutines: [R('shower', 'Shower')],
      routinesDate: '2026-02-14',
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.todayRoutines).toHaveLength(0);
  });

  it('keeps newer date routines when dates differ (local newer)', () => {
    const deviceA = {
      ...emptyData(),
      todayRoutines: [R('workout', 'Workout')],
      routinesDate: '2026-02-15',
    };
    const deviceB = {
      ...emptyData(),
      todayRoutines: [R('shower', 'Shower'), R('banking', 'Banking')],
      routinesDate: '2026-02-14',
    };

    const { data, remoteChanged } = mergeSyncData(deviceA, deviceB);
    // Local is on a newer date — keep local routines only
    expect(data.todayRoutines).toHaveLength(1);
    expect(data.todayRoutines[0].id).toBe('workout');
    expect(data.routinesDate).toBe('2026-02-15');
    expect(remoteChanged).toBe(true);
  });

  it('takes remote routines when remote date is newer', () => {
    const deviceA = {
      ...emptyData(),
      todayRoutines: [R('shower', 'Shower')],
      routinesDate: '2026-02-14',
    };
    const deviceB = {
      ...emptyData(),
      todayRoutines: [R('workout', 'Workout')],
      routinesDate: '2026-02-15',
    };

    const { data, localChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.todayRoutines).toHaveLength(1);
    expect(data.todayRoutines[0].id).toBe('workout');
    expect(data.routinesDate).toBe('2026-02-15');
    expect(localChanged).toBe(true);
  });

  it('empty todayRoutines on both sides with same date produces no changes', () => {
    const deviceA = { ...emptyData(), routinesDate: '2026-02-14' };
    const deviceB = { ...emptyData(), routinesDate: '2026-02-14' };

    const { data, localChanged, remoteChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.todayRoutines).toEqual([]);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('removedTodayRoutineIds prevents removed routine from reappearing via sync', () => {
    // Device A removed "shower" from today's routines (but kept the definition)
    const deviceA = {
      ...emptyData(),
      todayRoutines: [],
      routinesDate: '2026-02-14',
      removedTodayRoutineIds: { 'shower': new Date().toISOString() },
    };
    // Device B still has "shower" in today's routines
    const deviceB = {
      ...emptyData(),
      todayRoutines: [R('shower', 'Shower')],
      routinesDate: '2026-02-14',
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.todayRoutines).toHaveLength(0);
    // Tombstone should be preserved in merged data
    expect(data.removedTodayRoutineIds).toHaveProperty('shower');
  });

  it('removedTodayRoutineIds merges from both devices', () => {
    const deviceA = {
      ...emptyData(),
      todayRoutines: [],
      routinesDate: '2026-02-14',
      removedTodayRoutineIds: { 'shower': '2026-02-14T10:00:00.000Z' },
    };
    const deviceB = {
      ...emptyData(),
      todayRoutines: [],
      routinesDate: '2026-02-14',
      removedTodayRoutineIds: { 'workout': '2026-02-14T11:00:00.000Z' },
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.removedTodayRoutineIds).toHaveProperty('shower');
    expect(data.removedTodayRoutineIds).toHaveProperty('workout');
  });

  it('removal tombstone does not affect routine definitions', () => {
    // Device A removed "shower" from today but the definition should survive
    const deviceA = {
      ...emptyData(),
      routineDefinitions: { everyday: [{ id: 'shower', name: 'Shower' }] },
      todayRoutines: [],
      routinesDate: '2026-02-14',
      removedTodayRoutineIds: { 'shower': new Date().toISOString() },
    };
    const deviceB = {
      ...emptyData(),
      routineDefinitions: { everyday: [{ id: 'shower', name: 'Shower' }] },
      todayRoutines: [R('shower', 'Shower')],
      routinesDate: '2026-02-14',
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    // Routine should be removed from today...
    expect(data.todayRoutines).toHaveLength(0);
    // ...but definition should still exist
    expect(data.routineDefinitions.everyday).toHaveLength(1);
    expect(data.routineDefinitions.everyday[0].id).toBe('shower');
  });
});

// ─── mergeDailyNotes ─────────────────────────────────────────────────

describe('mergeDailyNotes', () => {
  it('returns empty merged for two empty objects', () => {
    const { merged, localChanged, remoteChanged } = mergeDailyNotes({}, {});
    expect(merged).toEqual({});
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('keeps local-only notes and flags remoteChanged', () => {
    const local = {
      '2026-02-10': { text: 'local note', lastModified: ts(5) }
    };
    const { merged, localChanged, remoteChanged } = mergeDailyNotes(local, {});
    expect(merged['2026-02-10'].text).toBe('local note');
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(true);
  });

  it('keeps remote-only notes and flags localChanged', () => {
    const remote = {
      '2026-02-11': { text: 'remote note', lastModified: ts(5) }
    };
    const { merged, localChanged, remoteChanged } = mergeDailyNotes({}, remote);
    expect(merged['2026-02-11'].text).toBe('remote note');
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(false);
  });

  it('newer local note wins over older remote', () => {
    const local = {
      '2026-02-12': { text: 'updated local', lastModified: ts(1) }
    };
    const remote = {
      '2026-02-12': { text: 'old remote', lastModified: ts(10) }
    };
    const { merged, localChanged, remoteChanged } = mergeDailyNotes(local, remote);
    expect(merged['2026-02-12'].text).toBe('updated local');
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(true);
  });

  it('newer remote note wins over older local', () => {
    const local = {
      '2026-02-12': { text: 'old local', lastModified: ts(10) }
    };
    const remote = {
      '2026-02-12': { text: 'updated remote', lastModified: ts(1) }
    };
    const { merged, localChanged, remoteChanged } = mergeDailyNotes(local, remote);
    expect(merged['2026-02-12'].text).toBe('updated remote');
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(false);
  });

  it('equal timestamps keep local (tie-break)', () => {
    const stamp = ts(5);
    const local = {
      '2026-02-12': { text: 'local version', lastModified: stamp }
    };
    const remote = {
      '2026-02-12': { text: 'remote version', lastModified: stamp }
    };
    const { merged, localChanged, remoteChanged } = mergeDailyNotes(local, remote);
    expect(merged['2026-02-12'].text).toBe('local version');
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('newer tombstone (deleted) wins over older text', () => {
    const local = {
      '2026-02-13': { text: 'some note', lastModified: ts(10) }
    };
    const remote = {
      '2026-02-13': { text: '', deleted: true, lastModified: ts(1) }
    };
    const { merged, localChanged, remoteChanged } = mergeDailyNotes(local, remote);
    expect(merged['2026-02-13'].deleted).toBe(true);
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(false);
  });

  it('newer text wins over older tombstone', () => {
    const local = {
      '2026-02-13': { text: '', deleted: true, lastModified: ts(10) }
    };
    const remote = {
      '2026-02-13': { text: 're-created note', lastModified: ts(1) }
    };
    const { merged, localChanged, remoteChanged } = mergeDailyNotes(local, remote);
    expect(merged['2026-02-13'].text).toBe('re-created note');
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(false);
  });

  it('local-only tombstone is preserved (synced to remote)', () => {
    const local = {
      '2026-02-14': { text: '', deleted: true, lastModified: ts(1) }
    };
    const { merged, localChanged, remoteChanged } = mergeDailyNotes(local, {});
    expect(merged['2026-02-14'].deleted).toBe(true);
    expect(remoteChanged).toBe(true);
  });

  it('merges notes across multiple dates independently', () => {
    const local = {
      '2026-02-10': { text: 'local only', lastModified: ts(5) },
      '2026-02-11': { text: 'old local', lastModified: ts(20) },
      '2026-02-12': { text: 'shared', lastModified: ts(5) },
    };
    const remote = {
      '2026-02-11': { text: 'new remote', lastModified: ts(1) },
      '2026-02-12': { text: 'shared', lastModified: ts(5) },
      '2026-02-13': { text: 'remote only', lastModified: ts(5) },
    };
    const { merged, localChanged, remoteChanged } = mergeDailyNotes(local, remote);
    expect(Object.keys(merged)).toHaveLength(4);
    expect(merged['2026-02-10'].text).toBe('local only');
    expect(merged['2026-02-11'].text).toBe('new remote');
    expect(merged['2026-02-12'].text).toBe('shared');
    expect(merged['2026-02-13'].text).toBe('remote only');
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(true);
  });

  it('handles missing lastModified as epoch zero', () => {
    const local = {
      '2026-02-15': { text: 'no timestamp' }
    };
    const remote = {
      '2026-02-15': { text: 'has timestamp', lastModified: ts(100) }
    };
    const { merged } = mergeDailyNotes(local, remote);
    // remote has a real timestamp vs epoch 0, so remote wins
    expect(merged['2026-02-15'].text).toBe('has timestamp');
  });
});

// ─── mergeSyncData — dailyNotes integration ──────────────────────────

describe('mergeSyncData — dailyNotes integration', () => {
  const base = {
    tasks: [], unscheduledTasks: [], recycleBin: [],
    recurringTasks: [], routineDefinitions: {},
    todayRoutines: [], routinesDate: '',
    deletedTaskIds: {}, deletedRoutineChipIds: {},
    removedTodayRoutineIds: {},
  };

  it('merges dailyNotes from both devices', () => {
    const deviceA = {
      ...base,
      dailyNotes: { '2026-02-10': { text: 'A note', lastModified: ts(5) } },
    };
    const deviceB = {
      ...base,
      dailyNotes: { '2026-02-11': { text: 'B note', lastModified: ts(5) } },
    };
    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.dailyNotes['2026-02-10'].text).toBe('A note');
    expect(data.dailyNotes['2026-02-11'].text).toBe('B note');
  });

  it('newer dailyNote wins in conflict', () => {
    const deviceA = {
      ...base,
      dailyNotes: { '2026-02-10': { text: 'old', lastModified: ts(10) } },
    };
    const deviceB = {
      ...base,
      dailyNotes: { '2026-02-10': { text: 'new', lastModified: ts(1) } },
    };
    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.dailyNotes['2026-02-10'].text).toBe('new');
  });

  it('dailyNotes tombstone propagates via sync', () => {
    const deviceA = {
      ...base,
      dailyNotes: { '2026-02-10': { text: 'some text', lastModified: ts(10) } },
    };
    const deviceB = {
      ...base,
      dailyNotes: { '2026-02-10': { text: '', deleted: true, lastModified: ts(1) } },
    };
    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.dailyNotes['2026-02-10'].deleted).toBe(true);
  });
});

// ─── mergeHabits ──────────────────────────────────────────────────────

describe('mergeHabits', () => {
  const H = (id, name, createdAt, extra = {}) => ({
    id: String(id), name, createdAt, archived: false, ...extra
  });

  it('returns empty for two empty arrays', () => {
    const { merged, localChanged, remoteChanged } = mergeHabits([], []);
    expect(merged).toEqual([]);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('keeps local-only habits and flags remoteChanged', () => {
    const local = [H(1, 'Exercise', ts(5))];
    const { merged, localChanged, remoteChanged } = mergeHabits(local, []);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Exercise');
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(true);
  });

  it('keeps remote-only habits and flags localChanged', () => {
    const remote = [H(2, 'Read', ts(5))];
    const { merged, localChanged, remoteChanged } = mergeHabits([], remote);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('Read');
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(false);
  });

  it('unions habits from both sides', () => {
    const local = [H(1, 'Exercise', ts(5))];
    const remote = [H(2, 'Read', ts(5))];
    const { merged } = mergeHabits(local, remote);
    expect(merged).toHaveLength(2);
    expect(merged[0].name).toBe('Exercise');
    expect(merged[1].name).toBe('Read');
  });

  it('keeps newer version when both sides have the same habit with lastModified', () => {
    const local = [H(1, 'Exercise', ts(10), { lastModified: ts(10) })];
    const remote = [H(1, 'Workout', ts(10), { lastModified: ts(2) })];
    const { merged } = mergeHabits(local, remote);
    expect(merged[0].name).toBe('Workout');
  });

  it('preserves local ordering with remote appended', () => {
    const local = [H(2, 'Read', ts(5)), H(1, 'Exercise', ts(10))];
    const remote = [H(1, 'Exercise', ts(10)), H(3, 'Meditate', ts(3))];
    const { merged } = mergeHabits(local, remote);
    expect(merged.map(h => h.name)).toEqual(['Read', 'Exercise', 'Meditate']);
  });
});

// ─── mergeHabitLogs ───────────────────────────────────────────────────

describe('mergeHabitLogs', () => {
  it('returns empty for two empty objects', () => {
    const { merged, localChanged, remoteChanged } = mergeHabitLogs({}, {});
    expect(merged).toEqual({});
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('keeps local-only date entries', () => {
    const local = { '2026-02-20': { h1: 3 } };
    const { merged, remoteChanged } = mergeHabitLogs(local, {});
    expect(merged['2026-02-20'].h1).toBe(3);
    expect(remoteChanged).toBe(true);
  });

  it('keeps remote-only date entries', () => {
    const remote = { '2026-02-20': { h1: 2 } };
    const { merged, localChanged } = mergeHabitLogs({}, remote);
    expect(merged['2026-02-20'].h1).toBe(2);
    expect(localChanged).toBe(true);
  });

  it('takes max count when both sides have same date and habit', () => {
    const local = { '2026-02-20': { h1: 3, h2: 1 } };
    const remote = { '2026-02-20': { h1: 5, h2: 1 } };
    const { merged, localChanged, remoteChanged } = mergeHabitLogs(local, remote);
    expect(merged['2026-02-20'].h1).toBe(5);
    expect(merged['2026-02-20'].h2).toBe(1);
    expect(localChanged).toBe(true);  // h1 was higher on remote
    expect(remoteChanged).toBe(false);
  });

  it('unions habits within same date from both sides', () => {
    const local = { '2026-02-20': { h1: 2 } };
    const remote = { '2026-02-20': { h2: 4 } };
    const { merged } = mergeHabitLogs(local, remote);
    expect(merged['2026-02-20'].h1).toBe(2);
    expect(merged['2026-02-20'].h2).toBe(4);
  });
});

// ─── mergeSyncData — habits integration ───────────────────────────────

describe('mergeSyncData — habits integration', () => {
  const base = {
    tasks: [], unscheduledTasks: [], recycleBin: [],
    recurringTasks: [], routineDefinitions: {},
    todayRoutines: [], routinesDate: '',
    deletedTaskIds: {}, deletedRoutineChipIds: {},
    removedTodayRoutineIds: {}, dailyNotes: {},
  };

  it('merges habits from both devices', () => {
    const deviceA = {
      ...base,
      habits: [{ id: '1', name: 'Exercise', createdAt: ts(5), archived: false }],
      habitLogs: {},
    };
    const deviceB = {
      ...base,
      habits: [{ id: '2', name: 'Read', createdAt: ts(5), archived: false }],
      habitLogs: {},
    };
    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.habits).toHaveLength(2);
    expect(data.habits.map(h => h.name).sort()).toEqual(['Exercise', 'Read']);
  });

  it('merges habit logs taking max counts', () => {
    const deviceA = {
      ...base,
      habits: [{ id: '1', name: 'Exercise', createdAt: ts(10), archived: false }],
      habitLogs: { '2026-02-20': { '1': 3 } },
    };
    const deviceB = {
      ...base,
      habits: [{ id: '1', name: 'Exercise', createdAt: ts(10), archived: false }],
      habitLogs: { '2026-02-20': { '1': 7 } },
    };
    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.habitLogs['2026-02-20']['1']).toBe(7);
  });

  it('propagates habitsEnabled from remote', () => {
    const deviceA = { ...base, habits: [], habitLogs: {}, habitsEnabled: true };
    const deviceB = { ...base, habits: [], habitLogs: {}, habitsEnabled: false };
    const { data, localChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.habitsEnabled).toBe(false);
    expect(localChanged).toBe(true);
  });

  it('propagates routinesEnabled from remote', () => {
    const deviceA = { ...base, routinesEnabled: true };
    const deviceB = { ...base, routinesEnabled: false };
    const { data, localChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.routinesEnabled).toBe(false);
    expect(localChanged).toBe(true);
  });

  it('defaults routinesEnabled to true when not present', () => {
    const deviceA = { ...base };
    const deviceB = { ...base };
    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.routinesEnabled).toBe(undefined); // not set, defaults handled in app
  });

  it('flags localChanged when remote has habits that local lacks', () => {
    const deviceA = { ...base, habits: [], habitLogs: {} };
    const deviceB = {
      ...base,
      habits: [{ id: '1', name: 'Meditate', createdAt: ts(5), archived: false }],
      habitLogs: { '2026-02-20': { '1': 2 } },
    };
    const { data, localChanged } = mergeSyncData(deviceA, deviceB);
    expect(localChanged).toBe(true);
    expect(data.habits).toHaveLength(1);
    expect(data.habitLogs['2026-02-20']['1']).toBe(2);
  });
});

// ─── mergeSyncData: GTD frames sync ──────────────────────────────────

describe('mergeSyncData — GTD frames sync', () => {
  const emptyData = () => ({
    tasks: [], unscheduledTasks: [], recycleBin: [], recurringTasks: [],
    completedTaskUids: [], deletedTaskIds: {}, deletedRoutineChipIds: {},
    deletedFrameIds: {},
    syncUrl: null, taskCalendarUrl: null,
    routineDefinitions: {}, todayRoutines: [], routinesDate: '',
    minimizedSections: {}, use24HourClock: false,
    gtdFrames: [],
  });

  const F = (id, name, extra = {}) => ({
    id, name, days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    start: '09:00', end: '12:00', color: '#3b82f6', enabled: true, ...extra,
  });

  it('frames added on desktop survive when tablet syncs', () => {
    const desktop = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work'), F('f2', 'Admin')],
    };
    const tablet = emptyData();

    const { data, localChanged, remoteChanged } = mergeSyncData(tablet, desktop);
    expect(data.gtdFrames).toHaveLength(2);
    expect(data.gtdFrames.map(f => f.name)).toEqual(['Deep Work', 'Admin']);
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(false);
  });

  it('frames added on tablet survive when desktop syncs', () => {
    const desktop = emptyData();
    const tablet = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Focus Time')],
    };

    const { data, remoteChanged } = mergeSyncData(desktop, tablet);
    expect(data.gtdFrames).toHaveLength(1);
    expect(data.gtdFrames[0].name).toBe('Focus Time');
    expect(remoteChanged).toBe(false);
  });

  it('identical frames on both devices produce no changes', () => {
    const frames = [F('f1', 'Deep Work'), F('f2', 'Admin')];
    const deviceA = { ...emptyData(), gtdFrames: [...frames] };
    const deviceB = { ...emptyData(), gtdFrames: [...frames] };

    const { data, localChanged, remoteChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.gtdFrames).toHaveLength(2);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('frames added on two devices both survive', () => {
    const deviceA = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work')],
    };
    const deviceB = {
      ...emptyData(),
      gtdFrames: [F('f2', 'Admin')],
    };

    const { data, localChanged, remoteChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.gtdFrames).toHaveLength(2);
    const names = data.gtdFrames.map(f => f.name);
    expect(names).toContain('Deep Work');
    expect(names).toContain('Admin');
    expect(localChanged).toBe(true);  // got Admin from remote
    expect(remoteChanged).toBe(true); // remote needs Deep Work
  });

  it('remote version of a frame wins when frames differ', () => {
    const deviceA = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work', { start: '09:00', end: '12:00' })],
    };
    const deviceB = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work', { start: '08:00', end: '11:00' })],
    };

    const { data, localChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.gtdFrames).toHaveLength(1);
    expect(data.gtdFrames[0].start).toBe('08:00');
    expect(localChanged).toBe(true);
  });

  it('frame deleted on one device is removed on the other via tombstone', () => {
    const deviceA = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work'), F('f2', 'Admin')],
    };
    const deviceB = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work')],
      deletedFrameIds: { 'f2': new Date().toISOString() },
    };

    const { data, localChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.gtdFrames).toHaveLength(1);
    expect(data.gtdFrames[0].id).toBe('f1');
    expect(localChanged).toBe(true);
    expect(data.deletedFrameIds['f2']).toBeDefined();
  });

  it('frame tombstones from both devices are combined', () => {
    const deviceA = {
      ...emptyData(),
      deletedFrameIds: { 'f1': '2026-01-01T00:00:00Z' },
    };
    const deviceB = {
      ...emptyData(),
      deletedFrameIds: { 'f2': '2026-01-02T00:00:00Z' },
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.deletedFrameIds['f1']).toBeDefined();
    expect(data.deletedFrameIds['f2']).toBeDefined();
  });

  it('tombstoned frame is not resurrected from remote', () => {
    // Device A deleted the frame, device B still has it
    const deviceA = {
      ...emptyData(),
      gtdFrames: [],
      deletedFrameIds: { 'f1': new Date().toISOString() },
    };
    const deviceB = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work')],
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.gtdFrames).toHaveLength(0);
    expect(data.deletedFrameIds['f1']).toBeDefined();
  });

  it('tombstoned frame is not resurrected from local', () => {
    // Device B deleted the frame, device A still has it
    const deviceA = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work')],
    };
    const deviceB = {
      ...emptyData(),
      gtdFrames: [],
      deletedFrameIds: { 'f1': new Date().toISOString() },
    };

    const { data, localChanged } = mergeSyncData(deviceA, deviceB);
    expect(data.gtdFrames).toHaveLength(0);
    expect(localChanged).toBe(true);
  });

  it('newer tombstone timestamp wins when both devices have tombstones for same frame', () => {
    const deviceA = {
      ...emptyData(),
      deletedFrameIds: { 'f1': '2026-01-01T00:00:00Z' },
    };
    const deviceB = {
      ...emptyData(),
      deletedFrameIds: { 'f1': '2026-02-01T00:00:00Z' },
    };

    const { data } = mergeSyncData(deviceA, deviceB);
    expect(data.deletedFrameIds['f1']).toBe('2026-02-01T00:00:00Z');
  });

  it('handles undefined gtdFrames gracefully (old remote data)', () => {
    const localDevice = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work')],
    };
    // Simulate old remote payload that has no gtdFrames field
    const oldRemote = { ...emptyData() };
    delete oldRemote.gtdFrames;
    delete oldRemote.deletedFrameIds;

    const { data, remoteChanged } = mergeSyncData(localDevice, oldRemote);
    expect(data.gtdFrames).toHaveLength(1);
    expect(data.gtdFrames[0].name).toBe('Deep Work');
    expect(remoteChanged).toBe(true);
  });

  it('handles undefined gtdFrames on local (fresh device)', () => {
    const freshDevice = { ...emptyData() };
    delete freshDevice.gtdFrames;
    delete freshDevice.deletedFrameIds;
    const remoteDevice = {
      ...emptyData(),
      gtdFrames: [F('f1', 'Deep Work')],
    };

    const { data, localChanged } = mergeSyncData(freshDevice, remoteDevice);
    expect(data.gtdFrames).toHaveLength(1);
    expect(data.gtdFrames[0].name).toBe('Deep Work');
    expect(localChanged).toBe(true);
  });

  it('frame with exceptions syncs correctly', () => {
    const frame = F('f1', 'Deep Work', {
      exceptions: { '2026-02-25': { deleted: true } },
    });
    const deviceA = { ...emptyData(), gtdFrames: [frame] };
    const deviceB = emptyData();

    const { data } = mergeSyncData(deviceB, deviceA);
    expect(data.gtdFrames).toHaveLength(1);
    expect(data.gtdFrames[0].exceptions['2026-02-25'].deleted).toBe(true);
  });
});
