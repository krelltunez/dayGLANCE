// The merge rule for a task's `createdAt`, which both sync tiers apply. Moved
// verbatim from the app's src/utils/createdAt.js (#2280), which imports it
// back; the stamping rules stay there.

/**
 * The earlier of two `createdAt` values, for the merges. Both tiers may meet
 * the same task with a stamp on either side (or both, if two devices ever
 * stamped one id); taking the earlier is order-independent and idempotent,
 * which a "remote wins" carry would not be.
 */
export function earlierCreatedAt(a, b) {
  if (!a) return b || undefined;
  if (!b) return a;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta)) return b;
  if (Number.isNaN(tb)) return a;
  if (ta !== tb) return ta < tb ? a : b;
  return a <= b ? a : b; // the same instant written two ways: pick one deterministically
}
