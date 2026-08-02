import { extractTags } from './taskUtils.js';
import { taskColorToHex } from './colorUtils.js';
import { deriveBlockEnergy, ENERGY_RESTORE } from './energyAxis.js';

// Summary-strip rollup for one day of timeline blocks (category totals,
// unblocked time, the effort/restore energy axis, and planned-vs-done). Pure — takes the day's task list and returns numbers, so
// the strip UI stays presentational and the math is testable in isolation. This
// same function is the future Live Activity projection: the widget needs exactly
// this output, no rendering attached.
//
// Scope rules, chosen deliberately:
//  - Only timed blocks count. All-day events have no duration on the timeline
//    and would swamp every number; blocks without a startTime aren't on the
//    timeline at all.
//  - Native/imported calendar events DO count — they occupy real time, which is
//    exactly what unblocked time is measuring.
//  - Completed blocks still count. This is a summary of the day's shape, not a
//    todo list; completing a meeting doesn't un-spend the hour.
//  - Planned-vs-done is planned vs DONE (completion state), not vs actual
//    time spent — the model records that a block completed, not how long it
//    really took. Read-only calendar events (imported, non-task-calendar,
//    incl. native) can never be completed, so they are FIXTURES: excluded from
//    the done metric on BOTH sides, or they would permanently depress it. They
//    still count fully toward category totals and blocked time.
//  - Category totals sum RAW block durations per tag ("total time per label").
//    A block tagged #work #deep contributes its full duration to both labels,
//    so category minutes can exceed wall-clock time — per-label sums, not a
//    partition. Unblocked time is computed separately from merged intervals and
//    never double-counts.

const timeToMin = (t) => {
  const [h, m] = String(t).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

// Merge possibly-overlapping [start, end) intervals and return total covered
// minutes. Overlapping and touching blocks must not double-count unblocked time.
function mergedCoverage(intervals) {
  if (intervals.length === 0) return 0;
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [curStart, curEnd] = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s <= curEnd) {
      curEnd = Math.max(curEnd, e);
    } else {
      total += curEnd - curStart;
      [curStart, curEnd] = [s, e];
    }
  }
  total += curEnd - curStart;
  return total;
}

/** "2h 15m" / "45m" / "3h" / "0m" — durations, not clock times. */
export function formatMinutes(min) {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

/**
 * @param dayTasks     Tasks for one date (user blocks + recurring instances +
 *                     native calendar events — the tasksByDate shape).
 * @param endOfDayTime Optional "HH:MM" end-of-day setting (listEndOfDayTime).
 *                     When set, the day window extends to it, so time between
 *                     the last block and end-of-day counts as unblocked. When
 *                     null, the window is just the span of the blocks and
 *                     unblocked time means gaps between them — no bedtime is
 *                     assumed on the user's behalf.
 * @param dayWindow    Optional user-set START/STOP markers for this day:
 *                     {start: 'HH:MM'|null, stop: 'HH:MM'|null}. An explicit
 *                     declaration of the day's bounds, so it takes precedence:
 *                     start opens the window before the first block (morning
 *                     slack finally counts), stop supersedes endOfDayTime.
 *                     Blocks OUTSIDE the markers still extend the window —
 *                     same rule as the past-end-of-day clamp, a 6am run with a
 *                     7am start marker must never yield negative numbers.
 * @returns {{
 *   categories: Array<{tag: string, minutes: number, colorHex: string,
 *                      doneMinutes: number, completableMinutes: number}>,
 *   untaggedMinutes: number,
 *   untaggedDoneMinutes: number,
 *   untaggedCompletableMinutes: number,
 *   doneMinutes: number,          // day totals, completable blocks only —
 *   completableMinutes: number,   // the Live Activity's day-progress figure
 *
 *   effortMinutes: number,   // raw per-block sums — a partition of block
 *   restoreMinutes: number,  // minutes (see energyAxis.js), so like the
 *                            // category totals they can exceed wall-clock
 *                            // time when blocks overlap.
 *   blockedMinutes: number,
 *   unblockedMinutes: number|null,  // null = no timed blocks, nothing to measure
 *   windowStartMin: number|null,
 *   windowEndMin: number|null,
 * }}
 */
export function computeDaySummary(dayTasks, endOfDayTime = null, dayWindow = null) {
  const timed = (dayTasks || []).filter(
    (t) => t && !t.isAllDay && t.startTime && (t.duration || 0) > 0,
  );

  const markerStart = dayWindow?.start ? timeToMin(dayWindow.start) : null;
  const markerStop = dayWindow?.stop ? timeToMin(dayWindow.stop) : null;

  if (timed.length === 0) {
    // With BOTH markers set, an empty day is finally measurable: the whole
    // declared window is unblocked. Without them there is still no honest
    // window, so null keeps meaning "nothing to measure".
    const hasFullWindow = markerStart !== null && markerStop !== null && markerStop > markerStart;
    return {
      categories: [],
      untaggedMinutes: 0,
      untaggedDoneMinutes: 0,
      untaggedCompletableMinutes: 0,
      doneMinutes: 0,
      completableMinutes: 0,
      effortMinutes: 0,
      restoreMinutes: 0,
      blockedMinutes: 0,
      unblockedMinutes: hasFullWindow ? markerStop - markerStart : null,
      windowStartMin: hasFullWindow ? markerStart : null,
      windowEndMin: hasFullWindow ? markerStop : null,
    };
  }

  // Per-tag minute totals, plus per-tag per-color totals so each category dot
  // can take the color of the blocks that dominate it. There is no tag→color
  // mapping in the data model — color is a block property — so "dominant block
  // color, by minutes" is the honest rule; ties resolve to first-seen.
  const tagMinutes = new Map();
  const tagColorMinutes = new Map();
  const tagDoneMinutes = new Map();
  const tagCompletableMinutes = new Map();
  let untaggedMinutes = 0;
  let untaggedDoneMinutes = 0;
  let untaggedCompletableMinutes = 0;
  let doneMinutes = 0;
  let completableMinutes = 0;
  let effortMinutes = 0;
  let restoreMinutes = 0;
  const intervals = [];

  for (const t of timed) {
    const start = timeToMin(t.startTime);
    const minutes = t.duration || 0;
    intervals.push([start, start + minutes]);

    if (deriveBlockEnergy(t) === ENERGY_RESTORE) restoreMinutes += minutes;
    else effortMinutes += minutes;

    // Fixture check: a read-only calendar event has no completion to track.
    const completable = !(t.imported && !t.isTaskCalendar);
    const done = completable && t.completed ? minutes : 0;
    if (completable) {
      completableMinutes += minutes;
      doneMinutes += done;
    }

    const tags = extractTags(t.title || '');
    if (tags.length === 0) {
      untaggedMinutes += minutes;
      if (completable) {
        untaggedCompletableMinutes += minutes;
        untaggedDoneMinutes += done;
      }
      continue;
    }
    const hex = taskColorToHex(t.color, t.nativeCalendarColor);
    for (const tag of tags) {
      tagMinutes.set(tag, (tagMinutes.get(tag) || 0) + minutes);
      if (completable) {
        tagCompletableMinutes.set(tag, (tagCompletableMinutes.get(tag) || 0) + minutes);
        tagDoneMinutes.set(tag, (tagDoneMinutes.get(tag) || 0) + done);
      }
      if (!tagColorMinutes.has(tag)) tagColorMinutes.set(tag, new Map());
      const colors = tagColorMinutes.get(tag);
      colors.set(hex, (colors.get(hex) || 0) + minutes);
    }
  }

  const categories = [...tagMinutes.entries()]
    .map(([tag, minutes]) => {
      let colorHex = '#3b82f6';
      let best = -1;
      for (const [hex, min] of tagColorMinutes.get(tag)) {
        if (min > best) { best = min; colorHex = hex; }
      }
      return {
        tag, minutes, colorHex,
        doneMinutes: tagDoneMinutes.get(tag) || 0,
        completableMinutes: tagCompletableMinutes.get(tag) || 0,
      };
    })
    .sort((a, b) => b.minutes - a.minutes || a.tag.localeCompare(b.tag));

  const earliestStart = Math.min(...intervals.map(([s]) => s));
  const latestEnd = Math.max(...intervals.map(([, e]) => e));
  // Left edge: the start marker opens the window ahead of the first block, so
  // morning slack counts; a block earlier than the marker extends it further.
  const windowStartMin = markerStart !== null
    ? Math.min(markerStart, earliestStart)
    : earliestStart;
  // Right edge precedence: stop marker (an explicit declaration) supersedes the
  // list-view end-of-day setting. Either way a block running past the edge
  // extends the window rather than producing negative unblocked time.
  const rightEdge = markerStop !== null
    ? markerStop
    : (endOfDayTime ? timeToMin(endOfDayTime) : null);
  const windowEndMin = rightEdge !== null ? Math.max(latestEnd, rightEdge) : latestEnd;

  const blockedMinutes = mergedCoverage(intervals);
  const unblockedMinutes = Math.max(0, windowEndMin - windowStartMin - blockedMinutes);

  return {
    categories,
    untaggedMinutes, untaggedDoneMinutes, untaggedCompletableMinutes,
    doneMinutes, completableMinutes,
    effortMinutes, restoreMinutes,
    blockedMinutes, unblockedMinutes, windowStartMin, windowEndMin,
  };
}
