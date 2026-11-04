// The merge rule for a task's `deferrals` count, which both sync tiers apply.
// Moved verbatim from the app's src/utils/deferrals.js (#2280), which imports
// it back; what a deferral is, and the save pass that counts one, stay there.

/**
 * Merge two counts. Max rather than sum, because both devices may have watched
 * the same slip; max rather than last-writer-wins, because a device that never
 * carried the field would otherwise erase a real count. Absent reads as zero,
 * which makes this subsume the carry-forward the other sticky fields need.
 */
export function mergeDeferrals(a, b) {
  const left = Number(a) || 0;
  const right = Number(b) || 0;
  const merged = Math.max(left, right);
  return merged > 0 ? merged : undefined;
}
