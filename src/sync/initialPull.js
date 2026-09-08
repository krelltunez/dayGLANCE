// Whether this session has completed its first DB sync cycle, and how long the
// app has been up. Read by the intent drains (intents/intentDrainGate.js).
//
// Field item, 2026-09-08: tasks that lastGLANCE had created through
// GLANCEintents reappeared on a device that had been idle for a while. The
// intent pollers drain on mount, before the first sync pull, and the create
// handler's guards (already exists, already completed, tombstoned) read local
// state that is still as the idle device left it. A re-delivered create then
// passed every guard, was stamped with the moment of creation, and outranked
// the fleet's completion or tombstone. The drains now wait for the first
// pull of the session when vault sync is on.

let initialPullCompletedAt = 0;
const appStartedAt = Date.now();

export function markInitialPullComplete() {
  if (!initialPullCompletedAt) initialPullCompletedAt = Date.now();
}

export function initialPullCompleted() {
  return initialPullCompletedAt > 0;
}

export function msSinceAppStart(now = Date.now()) {
  return now - appStartedAt;
}

/** Test seam. */
export function _resetInitialPullForTests() {
  initialPullCompletedAt = 0;
}
