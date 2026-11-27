// The merge rule for a task's `completedAt`, which both sync tiers and the
// app's apply step use.
//
// A completion stamp is recorded once, by the device that saw the task
// become done (a toggle, or the Obsidian bridge reading a ticked line). Every
// merge keeps the newer copy WHOLE, so a newer copy of the same done task
// from a device that recorded no stamp (a device on a build that did not
// stamp a vault tick: 2026-11-27, dayGLANCE 5.16.0 against #2457) replaced
// the copy that had one, and nothing put it back: the task stayed done with
// no completion time anywhere.
//
// The rule: when the winning copy is done and has no stamp, take the stamp
// from the other copy if that copy is done too. A copy that is open says
// nothing about a completion, and a stamp on the winner is never replaced,
// so a reopen and a real re-completion still propagate on their own
// timestamps. Two copies, one with a stamp and one without, give the stamp
// whichever wins, so the result does not depend on the order the tiers
// apply it; applying it again changes nothing.

const stampOf = (t) => (t && t.completed === true && typeof t.completedAt === 'string' && t.completedAt ? t.completedAt : null);

/**
 * The `completedAt` the merged copy should carry: the winner's own, or, when
 * the winner is done without one, the first other done copy's. Returns the
 * winner's value unchanged when there is nothing to carry.
 */
export function carriedCompletedAt(winner, ...others) {
  if (!winner || winner.completed !== true || stampOf(winner)) return winner?.completedAt;
  for (const other of others) {
    const stamp = stampOf(other);
    if (stamp) return stamp;
  }
  return winner.completedAt;
}
