// Split GTD frames into those kept and those expired.
//
// A single-day frame (has `singleDate`) is expired once its date is older than
// `cutoff` (a 'YYYY-MM-DD' string, typically today − 7 days). Recurring frames
// (no `singleDate`) never expire.
//
// The startup cleanup removes the expired ones — and MUST tombstone them
// (deletedFrameIds), exactly like the user-facing deleteFrame. Without the
// tombstone the frame is only dropped from local state while a live copy survives
// on another device / a stale sync file, and it resurrects on the next sync →
// the delete↔re-create churn on every app open.
//
// @param {Array<{id:*, singleDate?:string}>} frames
// @param {string} cutoff  'YYYY-MM-DD'; frames with singleDate < cutoff are expired
// @returns {{ kept: object[], removed: object[] }}
export function partitionExpiredSingleDayFrames(frames, cutoff) {
  const kept = [];
  const removed = [];
  for (const f of frames || []) {
    if (f && f.singleDate && f.singleDate < cutoff) removed.push(f);
    else kept.push(f);
  }
  return { kept, removed };
}
