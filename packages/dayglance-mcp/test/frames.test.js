// @vitest-environment node
// Frames on the read surface: frame objects, their free slots, the consent
// tier, owner scoping, and their place in the get_day envelope. Which frames
// apply to a date is agenda-core's (packages/agenda-core/src/frameInstances.test.js).
import { describe, it, expect } from 'vitest';
import { frameInstancesForDate, isOwnedBy, isTaskVisibleForUser } from '@glance-apps/agenda-core';
import { FRAME_ID_PREFIX, frameWireId, toFrameObject, buildFrames } from '../src/frames.js';
import { buildDayBlocks } from '../src/readModel.js';

// 2026-09-19 is a Saturday (day 6); 2026-09-21 a Monday (day 1).
const SAT = '2026-09-19';
const MON = '2026-09-21';

const F = (over = {}) => ({
  id: 'f1', label: 'Deep work', enabled: true, days: [1, 2, 3, 4, 5],
  start: '09:00', end: '12:00', color: 'blue',
  tagAffinity: ['#writing'], energyLevel: 'high', bufferMinutes: 5, ...over,
});

const T = (over = {}) => ({
  id: 't1', title: 'Task', date: MON, startTime: '10:00', duration: 60, isAllDay: false, ...over,
});

const R = (over = {}) => ({
  id: 'r1', name: 'Morning pages', startTime: '09:30', duration: 30, isAllDay: false, ...over,
});

const state = (over = {}) => ({
  frames: [F()], tasks: [], recurringTasks: [],
  routines: [], routinesDate: MON, routineCompletions: {}, routinesEnabled: true,
  todayDate: MON, nowMinutes: 0, ...over,
});

describe('frame objects', () => {
  it('namespaces the id by frame AND date', () => {
    // A frame recurs, so the id has to say which instance this is.
    expect(frameWireId('f1', MON)).toBe('frame-f1-2026-09-21');
    expect(frameWireId('f1', MON).startsWith(FRAME_ID_PREFIX)).toBe(true);
  });

  it('carries affinity, energy, buffer and the free slots', () => {
    const [inst] = frameInstancesForDate([F()], MON);
    expect(toFrameObject(inst, [{ start: '09:00', end: '12:00', minutes: 180 }])).toEqual({
      id: 'frame-f1-2026-09-21',
      type: 'frame',
      label: 'Deep work',
      date: MON,
      start: '09:00',
      end: '12:00',
      energy_level: 'high',
      buffer_minutes: 5,
      tag_affinity: ['#writing'],
      available_minutes: 180,
      available_slots: [{ start: '09:00', end: '12:00', minutes: 180 }],
      read_only: true,
    });
  });

  it('sums available_minutes across split slots', () => {
    const [inst] = frameInstancesForDate([F()], MON);
    const obj = toFrameObject(inst, [
      { start: '09:00', end: '10:00', minutes: 60 },
      { start: '11:00', end: '12:00', minutes: 60 },
    ]);
    expect(obj.available_minutes).toBe(120);
  });
});

describe('buildFrames availability', () => {
  it('reports the whole frame free on an empty day', () => {
    const [f] = buildFrames(state(), MON);
    expect(f.available_minutes).toBe(180);
  });

  it('subtracts a task, with the frame buffer applied', () => {
    // 10:00-11:00 task, 5-minute buffer: free is 09:00-09:55 and 11:05-12:00.
    const [f] = buildFrames(state({ tasks: [T()] }), MON);
    expect(f.available_slots).toEqual([
      { start: '09:00', end: '09:55', minutes: 55 },
      { start: '11:05', end: '12:00', minutes: 55 },
    ]);
  });

  it('subtracts a ROUTINE, which is the whole point of the occupancy work', () => {
    const [f] = buildFrames(state({ routines: [R()] }), MON);
    expect(f.available_minutes).toBeLessThan(180);
    expect(f.available_slots.some((s) => s.start === '09:00' && s.end === '09:25')).toBe(true);
  });

  it('clips today to the current minute', () => {
    const [f] = buildFrames(state({ nowMinutes: 10 * 60 + 30 }), MON);
    expect(f.available_slots).toEqual([{ start: '10:30', end: '12:00', minutes: 90 }]);
  });

  it('reports a past date as fully spent', () => {
    const [f] = buildFrames(state({ todayDate: '2026-09-22' }), MON);
    expect(f.available_minutes).toBe(0);
  });

  it('does not clip a future date', () => {
    const [f] = buildFrames(state({ todayDate: '2026-09-20', nowMinutes: 23 * 60 }), MON);
    expect(f.available_minutes).toBe(180);
  });

  it('ignores tasks on other dates', () => {
    const [f] = buildFrames(state({ tasks: [T({ date: '2026-09-22' })] }), MON);
    expect(f.available_minutes).toBe(180);
  });

  it('returns [] for a date with no frames and for a missing date', () => {
    expect(buildFrames(state(), SAT)).toEqual([]);
    expect(buildFrames(state(), undefined)).toEqual([]);
    expect(buildFrames(undefined, MON)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Availability must not leak calendar data the user declined to share.
// ---------------------------------------------------------------------------
describe('device calendar events follow the consent tier', () => {
  const nativeDay = state({ tasks: [T({ id: 'n1', _native: true, startTime: '10:00', duration: 60 })] });

  it('ignores _native events without the calendar tier', () => {
    // Counting them would shrink available_minutes around meetings the caller
    // cannot see, letting it infer both their existence and their span by
    // comparing free time against the blocks it IS allowed to read.
    const [f] = buildFrames(nativeDay, MON, { includeNative: false });
    expect(f.available_minutes).toBe(180);
  });

  it('counts _native events under the calendar tier', () => {
    const [f] = buildFrames(nativeDay, MON, { includeNative: true });
    expect(f.available_minutes).toBeLessThan(180);
  });

  it('matches what get_day reports for the same tier', () => {
    // The invariant: availability describes exactly the data the tier
    // permits, so free time and visible blocks never tell different stories.
    const withoutTier = buildDayBlocks(nativeDay, { date: MON });
    expect(withoutTier.blocks.some((b) => b.type === 'device_calendar_event')).toBe(false);
    expect(withoutTier.frames[0].available_minutes).toBe(180);

    const withTier = buildDayBlocks(nativeDay, { date: MON, include_native: true });
    expect(withTier.blocks.some((b) => b.type === 'device_calendar_event')).toBe(true);
    expect(withTier.frames[0].available_minutes).toBeLessThan(180);
  });
});

// ---------------------------------------------------------------------------
// Same leak as routines, same shape of defence.
// ---------------------------------------------------------------------------
describe('frame ownership is scoped BEFORE the read model', () => {
  // buildMcpReadState does the scoping (readState.test.js pins it); these
  // pin why it has to.
  const mine = F({ id: 'mine', label: 'My frame', ownerSyncId: 'user-me' });
  const theirs = F({ id: 'theirs', label: 'Their frame', ownerSyncId: 'user-other' });

  // The real predicates, in multi-user mode as user-me.
  const ownedBy = (item, syncId) => isOwnedBy(item, true, 'user-me', syncId);
  const isVisibleForUser = (t) => isTaskVisibleForUser(t, true, 'user-me');

  it('does not surface a frame owned by another user', () => {
    const scoped = [mine, theirs].filter((f) => ownedBy(f, 'user-me'));
    expect(buildFrames(state({ frames: scoped }), MON).map((f) => f.label)).toEqual(['My frame']);
  });

  it('proves isVisibleForUser cannot do this job for frames either', () => {
    // Frames carry ownerSyncId, not assignedUserSyncIds, so the predicate
    // every other slice uses admits BOTH.
    expect([mine, theirs].filter(isVisibleForUser)).toHaveLength(2);
    expect([mine, theirs].filter((f) => ownedBy(f, 'user-me'))).toHaveLength(1);
  });
});

describe('frames in the get_day envelope', () => {
  it('rides alongside blocks rather than inside them', () => {
    const day = buildDayBlocks(state({ tasks: [T()] }), { date: MON });
    // A frame is a window, not work. Existing callers iterating `blocks` must
    // not start seeing them.
    expect(day.blocks.every((b) => b.type !== 'frame')).toBe(true);
    expect(day.frames.map((f) => f.type)).toEqual(['frame']);
  });

  it('is present and empty on a day with no frames', () => {
    // An absent key and an empty array read differently to a model: absent
    // invites "frames are unsupported", empty says "none today".
    expect(buildDayBlocks(state(), { date: SAT }).frames).toEqual([]);
  });
});
