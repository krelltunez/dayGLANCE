// The merge rule for a task's `planTrail`, which both sync tiers apply: the
// union, its cap, and the comparison that tells a tier whether the merge
// changed anything. Moved verbatim from the app's src/utils/planTrail.js
// (#2280), which imports them back; the save pass that records a stop, and
// the display helpers, stay there. `clean` is exported for that module only
// (as cleanTrail) and is not part of the package's public API.

// Six stops plus the baseline and the current plan is eight lines — about as
// much as the popover holds before it stops being glanceable.
export const TRAIL_CAP = 6;

const key = (entry) => `${entry.at}|${entry.date}|${entry.startTime}`;

const clean = (trail) => (Array.isArray(trail) ? trail : [])
  .filter((e) => e && e.date && e.startTime && Number.isFinite(Number(e.at)));

/**
 * Merge two trails. A union rather than a carry-forward or a last-writer-wins:
 * two devices can each have watched different slips, and either one dropping
 * the other's would lose history nothing can reconstruct.
 *
 * Union is the same family of rule as the count's max — order-independent,
 * idempotent, and safe to apply twice — which is what lets both survive a merge
 * without the two devices agreeing on anything first. Sorted by when the move
 * happened and trimmed to the most recent, so a merge cannot grow past the cap.
 */
export function mergePlanTrail(a, b) {
  const seen = new Map();
  for (const entry of [...clean(a), ...clean(b)]) {
    if (!seen.has(key(entry))) seen.set(key(entry), entry);
  }
  if (seen.size === 0) return undefined;
  const merged = [...seen.values()]
    .sort((x, y) => Number(x.at) - Number(y.at))
    .slice(-TRAIL_CAP);
  return merged;
}

/**
 * Do two trails hold the same stops in the same order?
 *
 * The merge is a pure function that always returns a fresh array, so identity
 * says nothing about whether anything actually changed. Every caller needs to
 * know that — to skip a re-render, to decide whether a sync tier has to write
 * back — so the comparison lives here rather than being re-derived at each one.
 */
export function sameTrail(a, b) {
  const left = clean(a);
  const right = clean(b);
  return left.length === right.length && left.every((e, i) => key(e) === key(right[i]));
}
export { clean as cleanTrail };
