// The "made here" stamp (sync/snapshotFileSync.js LOCAL_EDIT_KEY) says this
// device changed its own data, so the snapshot file tiers write at once
// instead of waiting for the folder to catch up. Bookkeeping the app does on
// the clock, on every device at the same moment, is not that: the midnight
// routine rollover ran on two Macs in the same second, each counted it as an
// edit of its own, and both wrote the file together (conflict copies at
// 00:00:04 and 00:00:33, 2026-10-09/10). Such a change still reaches the
// file, by relay, from one device.
//
// A bookkeeping pass marks itself here; the persist pass that follows within
// the window skips the stamp. The window is short because a user edit landing
// inside it would be relayed rather than written at once: a delay, never a
// loss.

export const BOOKKEEPING_WINDOW_MS = 2000;

let bookkeepingUntil = 0;

/** Call right before a clock-driven state change (the day rollover). */
export function markBookkeepingChange(now = Date.now) {
  bookkeepingUntil = now() + BOOKKEEPING_WINDOW_MS;
}

/** True while a bookkeeping change may still be the one being persisted. */
export function inBookkeepingWindow(now = Date.now) {
  return now() < bookkeepingUntil;
}

export function _resetBookkeepingForTests() { bookkeepingUntil = 0; }
