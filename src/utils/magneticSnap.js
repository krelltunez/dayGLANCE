// Magnetic snapping for a dragged block (#2430).
//
// A drag lands on the 15-minute grid, which used to be the only choice. When
// the block before ends off the grid (10:07), that left 10:00 (overlapping) or
// 10:15 (a gap). Now a drag whose start or end comes within a few minutes of
// another block's start or end on the same date lands exactly on it; anywhere
// else it keeps the grid.
//
// The threshold stays under half the grid, so every grid point is still
// reachable a little way from any edge.

export const SNAP_GRID_MINUTES = 15;
export const MAGNET_MINUTES = 5;

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * The start and end, in minutes from the date's midnight, of every timed block
 * among `tasks` other than the one being dragged. An end past midnight stays
 * past 1440; the caller clamps the start it picks.
 *
 * @param {object[]} tasks  the date's tasks as the day holds them (getTasksForDate)
 * @param {string|number} [excludeId]  the dragged task
 */
export function blockEdges(tasks, excludeId) {
  const edges = [];
  for (const t of tasks ?? []) {
    if (!t || t.isAllDay || (excludeId != null && String(t.id) === String(excludeId))) continue;
    const start = toMinutes(t.startTime);
    if (start == null) continue;
    edges.push(start);
    if (typeof t.duration === 'number' && t.duration > 0) edges.push(start + t.duration);
  }
  return edges;
}

/**
 * Where a block dragged to `rawStart` (unrounded minutes) lands: the start
 * that puts its start or its end on the nearest edge within the magnet, or
 * else `rawStart` rounded to the grid.
 *
 * @param {number} rawStart
 * @param {number} duration  the dragged block's length; 0 snaps the start only
 * @param {number[]} edges  from blockEdges
 */
export function snapStart(rawStart, duration, edges, { grid = SNAP_GRID_MINUTES, magnet = MAGNET_MINUTES } = {}) {
  let best = null;
  let bestDist = Infinity;
  const length = typeof duration === 'number' && duration > 0 ? duration : 0;
  for (const edge of edges ?? []) {
    const candidates = length ? [edge, edge - length] : [edge];
    for (const start of candidates) {
      const dist = Math.abs(rawStart - start);
      if (dist <= magnet && dist < bestDist) { best = start; bestDist = dist; }
    }
  }
  return best ?? Math.round(rawStart / grid) * grid;
}
