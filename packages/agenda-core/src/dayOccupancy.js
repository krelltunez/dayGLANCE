// What occupies a day, in one place.
//
// THE PROBLEM THIS SOLVES. The app grew three independent answers to "what
// is already on this date", and they disagreed:
//
//   getAdjustedTimeForImportedConflicts (App.jsx)  imported events + routines
//   computeAvailableSlots (App.jsx)                every timed task, NO routines
//   buildDayBlocks (the MCP read model)            tasks + recurring + routines
//
// The middle one is a shipped bug rather than a difference of opinion: frame
// availability powers the "N min free" readout in the sidebar, day view,
// mobile list, and the schedule modal, and every one of them over-reports
// free time when a routine sits inside a frame. The drag-and-drop resolver
// on the line above has treated routines as obstacles all along, so the app
// already contradicted itself about the same fifteen minutes.
//
// WHAT IS SHARED AND WHAT IS NOT. The obstacle SET legitimately differs by
// caller, and collapsing that would be wrong:
//
//   - the drop resolver slides a task past IMMOVABLE things only. Two of your
//     own tasks may overlap on purpose; the timeline renders them in conflict
//     columns. Auto-sliding off your own task would fight the user.
//   - frame availability counts EVERY timed task, because a frame asks "how
//     much of this window is unspent", and a deliberate overlap still spends
//     it.
//
// So the caller chooses which tasks count and passes them in. What this
// module owns is everything after that choice: folding routines in, turning
// rows into intervals, merging them, and the arithmetic. Routines are not
// optional at that layer, which is the fix.
//
// PURITY. Nothing here reads the clock, localStorage, or React state. `now`
// arrives as minutes-since-midnight and the date as a string, so the same
// inputs always give the same slots. That is what makes this testable at all
// — computeAvailableSlots previously had six consumers and no unit tests.

import { buildRoutineBlocks } from './routineBlocks.js';

/** Minutes since local midnight for `HH:MM`, or null when unparseable. */
export function timeToMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** `HH:MM` for minutes since local midnight. */
export function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Routines on `date` as occupancy intervals.
 *
 * Deliberately built on buildRoutineBlocks rather than re-reading
 * todayRoutines: that function already owns the date guard (routines exist
 * for exactly one date, and only when routinesDate agrees with the clock),
 * and a second copy of that reasoning is how the three answers diverged in
 * the first place. All-day routines occupy no span and are skipped, which
 * falls out of the block shape reporting them with a null start_time.
 */
export function routineIntervals(state, date) {
  // A block with no span is an unplaced routine: buildRoutineBlocks reports
  // those with a null start_time AND a null duration_minutes, so testing the
  // span alone is sufficient and an extra all_day clause would be unreachable.
  return buildRoutineBlocks(state, date)
    .filter((b) => b.start_time && typeof b.duration_minutes === 'number')
    .map((b) => {
      const start = timeToMinutes(b.start_time);
      return start === null ? null : { start, end: start + b.duration_minutes, label: b.title, id: b.id };
    })
    .filter(Boolean);
}

/** A timed task row as an interval, or null when it has no usable span. */
export function taskInterval(task, { defaultDuration = 30 } = {}) {
  if (task.isAllDay || !task.startTime) return null;
  const start = timeToMinutes(task.startTime);
  if (start === null) return null;
  const duration = typeof task.duration === 'number' ? task.duration : defaultDuration;
  return { start, end: start + duration, label: task.title ?? '', id: task.id };
}

/**
 * Every interval occupying `date`: the caller's chosen tasks plus the day's
 * routines. Sorted by start, NOT merged — callers that need to name the thing
 * they collided with (the drop resolver) need the individual rows, and
 * callers that need gaps (frame availability) merge afterwards.
 *
 * `tasks` is whatever the caller decided counts. Routines are always folded
 * in, because no caller has a good reason to schedule over one: unlike a
 * task, the user cannot drag a routine out of the way from the other side.
 */
export function computeOccupiedIntervals(state, date, { tasks = [], excludeId = null, defaultDuration = 30 } = {}) {
  const fromTasks = tasks
    .filter((t) => t.id !== excludeId)
    .map((t) => taskInterval(t, { defaultDuration }))
    .filter(Boolean);
  return [...fromTasks, ...routineIntervals(state, date)].sort((a, b) => a.start - b.start);
}

/**
 * Merge overlapping intervals, treating anything within `bufferMinutes` of
 * the previous end as contiguous. Order-independent given sorted input.
 */
export function mergeIntervals(intervals, bufferMinutes = 0) {
  const merged = [];
  for (const i of [...intervals].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && i.start <= last.end + bufferMinutes) {
      last.end = Math.max(last.end, i.end);
    } else {
      merged.push({ ...i });
    }
  }
  return merged;
}

/**
 * The free gaps inside one frame instance on one date.
 *
 * Transcribed from App.jsx's computeAvailableSlots, with two changes, both
 * deliberate and both tested:
 *
 *   1. ROUTINES COUNT. The original built its occupied set from tasks alone,
 *      so a routine inside a frame was reported as free time. That is the bug
 *      this module exists to close.
 *   2. THE CLOCK AND THE TASK LIST ARE INJECTED. The original called
 *      getTasksForDate (which applies the user's active TAG FILTER by
 *      default) and read `new Date()` inline. A view preference silently
 *      changing how much time the app thinks you have is wrong on its own
 *      terms, and it makes the function untestable. Callers now pass the list
 *      they mean.
 *
 * `nowMinutes` clips today's slots to the present. Past dates are entirely
 * elapsed; future dates are not clipped at all.
 */
export function computeAvailableSlots(frameInstance, {
  state = {},
  tasks = [],
  dateStr,
  todayStr,
  nowMinutes = 0,
  defaultDuration = 30,
} = {}) {
  const frameStart = timeToMinutes(frameInstance?.start);
  const frameEnd = timeToMinutes(frameInstance?.end);
  // A contract guard rather than a load-bearing branch: the gap arithmetic
  // below happens to yield [] for an absent, zero-length, or inverted frame
  // too. Stated explicitly so a later edit to that arithmetic cannot silently
  // start emitting negative-length slots for a malformed frame.
  if (frameStart === null || frameEnd === null || frameEnd <= frameStart) return [];
  const buffer = frameInstance.bufferMinutes || 0;

  // The "now" floor: today clips to the current minute, past dates are fully
  // elapsed, future dates are untouched.
  let nowFloor = frameStart;
  if (dateStr === todayStr) nowFloor = nowMinutes;
  else if (dateStr < todayStr) nowFloor = frameEnd;

  // Clip occupancy to the frame; anything outside it is not this frame's
  // business, and an interval spilling past the edge would eat the boundary.
  const occupied = computeOccupiedIntervals(state, dateStr, { tasks, defaultDuration })
    .filter((i) => i.end > frameStart && i.start < frameEnd)
    .map((i) => ({ start: Math.max(i.start, frameStart), end: Math.min(i.end, frameEnd) }));

  const merged = mergeIntervals(occupied, buffer);

  const slots = [];
  let cursor = frameStart;
  for (const m of merged) {
    const gapStart = cursor + (cursor === frameStart ? 0 : buffer);
    const gapEnd = m.start - buffer;
    const clippedStart = Math.max(gapStart, nowFloor);
    if (gapEnd > clippedStart) {
      slots.push({ start: minutesToTime(clippedStart), end: minutesToTime(gapEnd), minutes: gapEnd - clippedStart });
    }
    cursor = m.end;
  }
  const finalStart = Math.max(cursor + (cursor === frameStart ? 0 : buffer), nowFloor);
  if (finalStart < frameEnd) {
    slots.push({ start: minutesToTime(finalStart), end: minutesToTime(frameEnd), minutes: frameEnd - finalStart });
  }
  return slots;
}

/** Total free minutes in a frame, the number every readout actually shows. */
export function availableMinutes(frameInstance, options) {
  return computeAvailableSlots(frameInstance, options).reduce((sum, s) => sum + s.minutes, 0);
}

/**
 * Slide a placement past every immovable obstacle, the drag-and-drop
 * behaviour from App.jsx. Returns the first conflict it hit and where the
 * placement ended up.
 *
 * `tasks` should be the IMMOVABLE rows only (imported events, task-calendar
 * reminders). Routines are added here and cannot be opted out of.
 *
 * The iteration cap is inherited: obstacles are re-scanned after each slide,
 * and a pathological set could otherwise loop.
 */
export function adjustPastConflicts(state, date, { startTime, duration, tasks = [], excludeId = null, maxIterations = 100 }) {
  const obstacles = computeOccupiedIntervals(state, date, { tasks, excludeId });
  const startMin = timeToMinutes(startTime);
  if (startMin === null || obstacles.length === 0) {
    return { conflicted: false, adjustedStartTime: startTime, conflictingEvent: null };
  }

  let currentStart = startMin;
  let currentEnd = currentStart + duration;
  let conflictingEvent = null;
  let wasAdjusted = false;

  for (let i = 0; i < maxIterations; i += 1) {
    const hit = obstacles.find((o) => currentStart < o.end && currentEnd > o.start);
    if (!hit) break;
    wasAdjusted = true;
    conflictingEvent = hit;
    currentStart = hit.end;
    currentEnd = currentStart + duration;
  }

  // Cap at end of day, as the original did.
  if (currentStart >= 24 * 60) currentStart = 24 * 60 - duration;

  return { conflicted: wasAdjusted, adjustedStartTime: minutesToTime(currentStart), conflictingEvent };
}

/**
 * The name of the obstacle a placement hit, or null when it has none.
 *
 * Obstacles name themselves with `label` (taskInterval, routineIntervals), not
 * `title`. Messages that read `.title` printed "undefined" after every slide
 * and never named the event Postpone refused for.
 */
export function obstacleName(obstacle) {
  const name = obstacle?.label;
  return typeof name === 'string' && name.trim() ? name : null;
}

/** The obstacle as an English message phrase: its name in quotes, or "a calendar event". */
export function describeObstacle(obstacle) {
  const name = obstacleName(obstacle);
  return name ? `"${name}"` : 'a calendar event';
}

/**
 * The routine a placement would land on, or null when the time is clear.
 *
 * ROUTINES ONLY, deliberately. Task-on-task overlap stays legal: the timeline
 * renders overlapping tasks in conflict columns, it is a thing users do on
 * purpose, and either side can be dragged away afterwards. A routine is
 * different in kind. It cannot be moved through the write surface at all, so
 * a caller that lands on one has no way to recover from either side, and the
 * user is left with two things claiming the same minutes and no gesture that
 * separates them.
 *
 * All-day placements never conflict: they occupy no span, so there is nothing
 * to collide with.
 */
export function findRoutineConflict(state, date, { startTime, durationMinutes, allDay = false } = {}) {
  if (allDay || !startTime) return null;
  const start = timeToMinutes(startTime);
  if (start === null) return null;
  const duration = typeof durationMinutes === 'number' && durationMinutes > 0 ? durationMinutes : 0;
  if (duration === 0) return null;
  const end = start + duration;
  return routineIntervals(state, date).find((r) => start < r.end && end > r.start) ?? null;
}
