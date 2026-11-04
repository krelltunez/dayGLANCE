// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { isTaskVisibleForUser, isOwnedBy, localDateStr } from '@glance-apps/agenda-core';
import { buildMcpReadState, readClock } from '../src/readState.js';
import { handleMcpRequest } from '../src/readModel.js';

// buildMcpReadState is the state App.jsx used to assemble inline in its
// useMcpBridge({...}) call, and the state a GLANCEvault-client host assembles
// from its own copy of the slices. The characterization below was written
// against App.jsx's inline assembly BEFORE the extraction (transcribed as
// appBefore) and pins its output; the extraction had to leave every pinned
// value as it was.

/** App.jsx's useMcpBridge({...}) state argument before #2280 step 3a, transcribed. */
function appBefore(s, { currentTime, meUserSyncId, weekStartDay }) {
  const isVisibleForUser = (task) => isTaskVisibleForUser(task, s.multiUserEnabled, meUserSyncId);
  const ownedBy = (item, syncId) => isOwnedBy(item, s.multiUserEnabled, meUserSyncId, syncId);
  return {
    tasks: s.tasks,
    recurringTasks: s.recurringTasks,
    unscheduledTasks: s.unscheduledTasks,
    routines: s.todayRoutines.filter((r) => ownedBy(r, meUserSyncId)),
    routinesDate: s.routinesDate,
    routineCompletions: s.routineCompletions,
    routinesEnabled: s.routinesEnabled,
    todayDate: localDateStr(currentTime), // the app's dateToString
    frames: s.gtdFrames.filter((f) => ownedBy(f, meUserSyncId)),
    nowMinutes: currentTime.getHours() * 60 + currentTime.getMinutes(),
    recycleBin: s.recycleBin,
    goals: s.goals,
    projects: s.projects,
    areas: s.areas,
    dailyNotes: s.dailyNotes,
    bucketConfig: s.bucketConfig,
    isVisibleForUser,
    weekStartDay,
    users: s.users,
    multiUserEnabled: s.multiUserEnabled,
  };
}

const TODAY = '2026-10-21'; // a Wednesday
const ME = 'u-me';
const OTHER = 'u-other';

const data = () => ({
  multiUserEnabled: true,
  users: [
    { id: 1, syncId: ME, name: 'Me' },
    { id: 2, syncId: OTHER, name: 'Other' },
    { id: 3, syncId: 'u-gone', name: 'Gone', deleted: true },
  ],
  tasks: [
    { id: 't-mine', title: 'Mine', date: TODAY, startTime: '09:00', duration: 30, assignedUserSyncIds: [ME] },
    { id: 't-other', title: 'Theirs', date: TODAY, startTime: '10:00', duration: 30, assignedUserSyncIds: [OTHER] },
    { id: 't-all', title: 'Everyone', date: TODAY, startTime: '11:00', duration: 30 },
    { id: 'n-1', title: 'Device event', date: TODAY, startTime: '12:00', duration: 60, _native: true },
  ],
  recurringTasks: [
    { id: 'rt-other', title: 'Their series', startTime: '15:00', duration: 15, assignedUserSyncIds: [OTHER], recurrence: { type: 'daily', startDate: '2026-10-01' } },
    { id: 'rt-all', title: 'Shared series', startTime: '16:00', duration: 15, recurrence: { type: 'daily', startDate: '2026-10-01' } },
  ],
  unscheduledTasks: [
    { id: 'u-mine', title: 'My inbox', assignedUserSyncIds: [ME] },
    { id: 'u-other', title: 'Their inbox', assignedUserSyncIds: [OTHER] },
    { id: 'u-bucket', title: 'Someday', bucketId: 'b2' },
  ],
  recycleBin: [{ id: 'gone', title: 'Binned' }],
  todayRoutines: [
    { id: 'r-mine', name: 'My routine', startTime: '07:00', duration: 15, ownerSyncId: ME },
    { id: 'r-other', name: 'Their routine', startTime: '08:00', duration: 15, ownerSyncId: OTHER },
    { id: 'r-unowned', name: 'Legacy routine', startTime: '08:30', duration: 15 },
  ],
  routinesDate: TODAY,
  routineCompletions: { 'r-mine': TODAY },
  routinesEnabled: true,
  gtdFrames: [
    { id: 'f-mine', label: 'My frame', enabled: true, days: [3], start: '13:00', end: '14:00', ownerSyncId: ME },
    { id: 'f-other', label: 'Their frame', enabled: true, days: [3], start: '13:00', end: '14:00', ownerSyncId: OTHER },
    { id: 'f-unowned', label: 'Legacy frame', enabled: true, days: [3], start: '17:00', end: '18:00' },
  ],
  goals: [{ id: 'g1', title: 'Goal', status: 'active' }],
  projects: [{ id: 'p1', title: 'Project', status: 'active', goalId: 'g1' }],
  areas: [{ id: 'a1', name: 'Home', order: 0 }],
  dailyNotes: { [TODAY]: { text: 'Note', lastModified: '2026-10-21T08:00:00.000Z' } },
  bucketConfig: { headings: { b1: 'Anytime', b2: 'Later' } },
});

// The suite runs with TZ=UTC: 09:30 local is the machine's clock.
const NOW = new Date(2026, 9, 21, 9, 30);
const APP = { now: NOW, userSyncId: ME, weekStartDay: 1 };
const APP_BEFORE = { currentTime: NOW, meUserSyncId: ME, weekStartDay: 1 };

const KEYS = [
  'areas', 'bucketConfig', 'dailyNotes', 'frames', 'goals', 'isVisibleForUser', 'multiUserEnabled',
  'nowMinutes', 'projects', 'recurringTasks', 'recycleBin', 'routineCompletions', 'routines',
  'routinesDate', 'routinesEnabled', 'tasks', 'todayDate', 'unscheduledTasks', 'users', 'weekStartDay',
];
const PASSED_THROUGH = [
  'tasks', 'recurringTasks', 'unscheduledTasks', 'recycleBin', 'routinesDate', 'routineCompletions',
  'routinesEnabled', 'goals', 'projects', 'areas', 'dailyNotes', 'bucketConfig', 'users', 'multiUserEnabled',
];

/** Everything observable about a state: its values, and its visibility predicate applied to every item. */
function observe(state, d) {
  const items = [...d.tasks, ...d.unscheduledTasks, ...d.recurringTasks, ...d.goals, ...d.projects];
  const { isVisibleForUser, ...rest } = state;
  return { ...rest, visible: items.map((t) => [t.id, isVisibleForUser(t)]) };
}

describe('buildMcpReadState: the state App.jsx hands the bridge (characterization)', () => {
  it('has exactly the keys App passed, scopes routines and frames to the user, passes every other slice through', () => {
    const d = data();
    const s = buildMcpReadState(d, APP);
    expect(Object.keys(s).sort()).toEqual(KEYS);
    expect(s.routines.map((r) => r.id)).toEqual(['r-mine', 'r-unowned']);
    expect(s.frames.map((f) => f.id)).toEqual(['f-mine', 'f-unowned']);
    expect(s.todayDate).toBe(TODAY);
    expect(s.nowMinutes).toBe(570);
    expect(s.weekStartDay).toBe(1);
    for (const k of PASSED_THROUGH) expect(s[k], k).toBe(d[k]);
    expect(d.tasks.filter(s.isVisibleForUser).map((t) => t.id)).toEqual(['t-mine', 't-all', 'n-1']);
  });

  it('equals what App.jsx assembled before the extraction, for each user and in single-user mode', () => {
    const cases = [
      [data(), ME],
      [data(), OTHER],
      [data(), null],
      [{ ...data(), multiUserEnabled: false }, ME],
    ];
    for (const [d, user] of cases) {
      const before = appBefore(d, { ...APP_BEFORE, meUserSyncId: user });
      const after = buildMcpReadState(d, { ...APP, userSyncId: user });
      expect(observe(after, d), `user ${user}, multi-user ${d.multiUserEnabled}`).toEqual(observe(before, d));
    }
  });

  it('answers get_day without another member\'s tasks, routines or frames', () => {
    const r = handleMcpRequest(buildMcpReadState(data(), APP), { method: 'get_day', params: { date: TODAY } });
    expect(r.ok).toBe(true);
    expect(r.data.blocks.map((b) => b.id)).toEqual([
      'routine-r-mine', 'routine-r-unowned', 't-mine', 't-all', 'recurring-rt-all-2026-10-21',
    ]);
    expect(r.data.frames.map((f) => [f.id, f.available_minutes])).toEqual([
      ['frame-f-mine-2026-10-21', 60], ['frame-f-unowned-2026-10-21', 60],
    ]);
  });

  it('answers as the other member when configured as them, and never shows them mine', () => {
    const s = buildMcpReadState(data(), { ...APP, userSyncId: OTHER });
    expect(s.routines.map((r) => r.id)).toEqual(['r-other', 'r-unowned']);
    expect(s.frames.map((f) => f.id)).toEqual(['f-other', 'f-unowned']);
    const r = handleMcpRequest(s, { method: 'get_day', params: { date: TODAY } });
    expect(r.data.blocks.map((b) => b.title)).not.toContain('My routine');
    expect(r.data.blocks.map((b) => b.title)).not.toContain('Mine');
  });

  it('single-user mode scopes nothing', () => {
    const s = buildMcpReadState({ ...data(), multiUserEnabled: false }, APP);
    expect(s.routines.map((r) => r.id)).toEqual(['r-mine', 'r-other', 'r-unowned']);
    expect(s.frames.map((f) => f.id)).toEqual(['f-mine', 'f-other', 'f-unowned']);
  });

  it('tolerates absent routine and frame slices (a host whose copy lacks them) as none', () => {
    const { todayRoutines: _r, gtdFrames: _f, ...rest } = data();
    const s = buildMcpReadState(rest, APP);
    expect(s.routines).toEqual([]);
    expect(s.frames).toEqual([]);
  });
});

describe('buildMcpReadState: the user\'s clock, not the machine\'s', () => {
  // The machine running this suite is on UTC, as a server host often is.
  const AUCKLAND = 'Pacific/Auckland'; // UTC+13 in October (NZDT)
  const LA = 'America/Los_Angeles';    // UTC-7 in October (PDT)

  it('reads today and the minute in the given zone, across the date line either way', () => {
    // 23:30 UTC on the 21st is 12:30 on the 22nd in Auckland.
    const late = Date.parse('2026-10-21T23:30:00Z');
    expect(buildMcpReadState(data(), { ...APP, now: late, timeZone: AUCKLAND })).toMatchObject({ todayDate: '2026-10-22', nowMinutes: 750 });
    // 03:00 UTC on the 22nd is still 20:00 on the 21st in Los Angeles.
    const early = Date.parse('2026-10-22T03:00:00Z');
    expect(buildMcpReadState(data(), { ...APP, now: early, timeZone: LA })).toMatchObject({ todayDate: '2026-10-21', nowMinutes: 1200 });
    // Without a zone, the same instants read on the machine's (UTC) clock.
    expect(buildMcpReadState(data(), { ...APP, now: late })).toMatchObject({ todayDate: '2026-10-21', nowMinutes: 1410 });
    expect(buildMcpReadState(data(), { ...APP, now: early })).toMatchObject({ todayDate: '2026-10-22', nowMinutes: 180 });
  });

  it('reports today\'s routines on the user\'s today, when the server\'s UTC date is still yesterday', () => {
    const d = { ...data(), routinesDate: '2026-10-22' };
    const late = Date.parse('2026-10-21T23:30:00Z');
    const inZone = handleMcpRequest(buildMcpReadState(d, { ...APP, now: late, timeZone: AUCKLAND }), { method: 'get_day', params: { date: '2026-10-22' } });
    expect(inZone.data.blocks.filter((b) => b.type === 'routine').map((b) => b.id)).toEqual(['routine-r-mine', 'routine-r-unowned']);
    // Read on the server's clock it is still the 21st, so the routine date
    // guard (rightly, for that clock) reports none: the bug a zone fixes.
    const onUtc = handleMcpRequest(buildMcpReadState(d, { ...APP, now: late }), { method: 'get_day', params: { date: '2026-10-22' } });
    expect(onUtc.data.blocks.filter((b) => b.type === 'routine')).toEqual([]);
  });

  it('clips today\'s frame to the user\'s minute, not the server\'s', () => {
    // 13:30 in Los Angeles is 20:30 UTC: on the user's clock half the 13:00-14:00 frame is left.
    const now = Date.parse('2026-10-21T20:30:00Z');
    const r = handleMcpRequest(buildMcpReadState(data(), { ...APP, now, timeZone: LA }), { method: 'get_day', params: { date: TODAY } });
    expect(r.data.frames.find((f) => f.id === 'frame-f-mine-2026-10-21').available_minutes).toBe(30);
  });

  it('reports stamps in the zone it was given', () => {
    const d = { ...data(), unscheduledTasks: [{ id: 'x', title: 'Done late', completed: true, createdAt: '2026-10-20T10:00:00.000Z', completedAt: '2026-10-21T23:30:00.000Z' }] };
    const now = Date.parse('2026-10-21T23:45:00Z');
    const [item] = handleMcpRequest(buildMcpReadState(d, { ...APP, now, timeZone: AUCKLAND }), { method: 'list_unscheduled', params: {} }).data.items;
    expect(item.completed_at).toEqual({ date: '2026-10-22', time: '12:30' });
    expect(item.created_at).toEqual({ date: '2026-10-20', time: '23:00' });
    // The Bucket List's items are inbox-shaped, stamps included.
    const bucketed = { ...d, unscheduledTasks: [{ ...d.unscheduledTasks[0], bucketId: 'b1' }] };
    const { lists } = handleMcpRequest(buildMcpReadState(bucketed, { ...APP, now, timeZone: AUCKLAND }), { method: 'list_bucket_list', params: {} }).data;
    expect(lists[0].items[0].completed_at).toEqual({ date: '2026-10-22', time: '12:30' });
  });

  it('carries the zone only when one was given, so the app\'s state keeps the keys it had', () => {
    expect(buildMcpReadState(data(), APP)).not.toHaveProperty('timeZone');
    expect(buildMcpReadState(data(), { ...APP, timeZone: LA }).timeZone).toBe(LA);
  });

  it('refuses to guess the instant', () => {
    expect(() => buildMcpReadState(data(), { userSyncId: ME })).toThrow(TypeError);
    expect(() => readClock(new Date(Number.NaN))).toThrow(TypeError);
    expect(readClock(Date.parse('2026-10-21T23:30:00Z'), AUCKLAND)).toEqual({ todayDate: '2026-10-22', nowMinutes: 750 });
  });
});
