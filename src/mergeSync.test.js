import { describe, it, expect } from 'vitest';
import { mergeTaskArrays, mergeRoutineDefinitions, mergeSyncData } from './mergeSync.js';

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
    const local = {
      ...emptyData(),
      deletedTaskIds: { '1': ts(10) },
    };
    const remote = {
      ...emptyData(),
      deletedTaskIds: { '1': ts(2) }, // deleted more recently
    };

    const { data } = mergeSyncData(local, remote);
    expect(new Date(data.deletedTaskIds['1']).getTime())
      .toBe(new Date(ts(2)).getTime());
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
