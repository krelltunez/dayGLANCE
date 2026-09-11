// Interval lane packing — the one place dayGLANCE decides how overlapping
// blocks stack side by side. Pure. Used by the Day Dial ring, the day/mobile
// time grids (via useTaskDerived), and the month view's day cells; each
// surface maps lanes to its own geometry (radial depth, CSS columns, pixel
// lanes) but they must agree on which blocks share a lane, or the same day
// would pack differently from view to view.
//
// Intervals are half-open [startMin, endMin): back-to-back blocks touch but
// do not overlap, so they share a lane. An interval with no positive span
// (endMin <= startMin, or either bound missing or NaN) is a moment, not a
// block: it takes lane 0 at full width and never joins or extends a cluster.
// That is also what a NaN end must not be allowed to do — a cluster end of
// NaN never closes and would swallow every later block in the day.
//
// Algorithm: a single sweep over start-sorted input. Blocks whose spans chain
// together form one overlap cluster (the transitive closure a BFS would find,
// but O(n) because the input is sorted), and inside a cluster each block takes
// the first lane that has freed up. The lane count is scoped to the cluster —
// a three-deep pile-up at noon must not thin a lone block at 4pm — and it is
// stamped onto every member so a block knows how wide its neighbourhood is.

/**
 * @param {Array<{startMin: number, endMin: number}>} intervals
 *   Sorted by startMin ascending (ties in whatever order the caller wants
 *   lanes handed out: the earlier entry gets the lower lane). Order is
 *   preserved in the output.
 * @returns {Array<object>} New objects: each input spread with {lane, laneCount}.
 */
export function assignLanes(intervals) {
  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;
  let laneEnds = [];

  const flush = () => {
    for (const { solo, ...b } of cluster) out.push(solo ? b : { ...b, laneCount: laneEnds.length });
    cluster = [];
    laneEnds = [];
  };

  for (const b of intervals || []) {
    if (!(b.endMin > b.startMin)) {
      // No span (also catches NaN and missing bounds): outside packing
      // entirely, but emitted in place so the output order still matches.
      cluster.push({ ...b, lane: 0, laneCount: 1, solo: true });
      continue;
    }
    if (b.startMin >= clusterEnd) {
      flush();
      clusterEnd = b.endMin;
    } else {
      clusterEnd = Math.max(clusterEnd, b.endMin);
    }
    let lane = laneEnds.findIndex((end) => end <= b.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = b.endMin;
    cluster.push({ ...b, lane });
  }
  flush();
  return out;
}

/** The most lanes any cluster in a packed list needed (0 for an empty list). */
export function maxLaneCount(packed) {
  let max = 0;
  for (const b of packed || []) if (b.laneCount > max) max = b.laneCount;
  return max;
}
