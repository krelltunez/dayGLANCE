import { extractTags } from './taskUtils.js';
import { taskColorToHex } from './colorUtils.js';

// Summary-strip rollup for one day of timeline blocks (phase 1: category totals
// + unblocked time). Pure — takes the day's task list and returns numbers, so
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
 * @returns {{
 *   categories: Array<{tag: string, minutes: number, colorHex: string}>,
 *   untaggedMinutes: number,
 *   blockedMinutes: number,
 *   unblockedMinutes: number|null,  // null = no timed blocks, nothing to measure
 *   windowStartMin: number|null,
 *   windowEndMin: number|null,
 * }}
 */
export function computeDaySummary(dayTasks, endOfDayTime = null) {
  const timed = (dayTasks || []).filter(
    (t) => t && !t.isAllDay && t.startTime && (t.duration || 0) > 0,
  );

  if (timed.length === 0) {
    return {
      categories: [],
      untaggedMinutes: 0,
      blockedMinutes: 0,
      unblockedMinutes: null,
      windowStartMin: null,
      windowEndMin: null,
    };
  }

  // Per-tag minute totals, plus per-tag per-color totals so each category dot
  // can take the color of the blocks that dominate it. There is no tag→color
  // mapping in the data model — color is a block property — so "dominant block
  // color, by minutes" is the honest rule; ties resolve to first-seen.
  const tagMinutes = new Map();
  const tagColorMinutes = new Map();
  let untaggedMinutes = 0;
  const intervals = [];

  for (const t of timed) {
    const start = timeToMin(t.startTime);
    const minutes = t.duration || 0;
    intervals.push([start, start + minutes]);

    const tags = extractTags(t.title || '');
    if (tags.length === 0) {
      untaggedMinutes += minutes;
      continue;
    }
    const hex = taskColorToHex(t.color, t.nativeCalendarColor);
    for (const tag of tags) {
      tagMinutes.set(tag, (tagMinutes.get(tag) || 0) + minutes);
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
      return { tag, minutes, colorHex };
    })
    .sort((a, b) => b.minutes - a.minutes || a.tag.localeCompare(b.tag));

  const windowStartMin = Math.min(...intervals.map(([s]) => s));
  const latestEnd = Math.max(...intervals.map(([, e]) => e));
  // A block running past the configured end-of-day extends the window rather
  // than producing negative unblocked time.
  const windowEndMin = endOfDayTime
    ? Math.max(latestEnd, timeToMin(endOfDayTime))
    : latestEnd;

  const blockedMinutes = mergedCoverage(intervals);
  const unblockedMinutes = Math.max(0, windowEndMin - windowStartMin - blockedMinutes);

  return { categories, untaggedMinutes, blockedMinutes, unblockedMinutes, windowStartMin, windowEndMin };
}
