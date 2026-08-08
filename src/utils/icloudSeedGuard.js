/**
 * Decides what an absent iCloud snapshot means: genuine first run, or a file the
 * iCloud daemon has temporarily taken away.
 *
 * ── The bug this replaces ──────────────────────────────────────────────────
 * App.jsx guarded the seed path with:
 *
 *     if (onIOS && localStorage.getItem('day-planner-cloud-sync-last-synced')) return;
 *
 * intending "we have synced before, so an absent file is eviction rather than
 * first run — wait for the daemon to bring it back". But that key is written only
 * by the WebDAV tier (@glance-apps/sync engine.js, and the three WebDAV
 * conflict-dialog handlers). iCloud sync never writes it. So on a device syncing
 * only over iCloud — the zero-config Apple setup, the default on iOS — the key
 * was never set, the condition was always false, and the guard was dead code on
 * exactly the platform and configuration its own comment described. It could only
 * ever fire for someone running iOS *and* WebDAV.
 *
 * Falling through meant the device republished its own snapshot over the evicted
 * one. The union merge means another device generally reconciles it rather than
 * data being destroyed, so this is churn rather than loss: a device that is
 * behind overwrites the container with a staler copy, and every spurious write
 * adds a version to the CloudKit document zone that ICLOUD_WRITE_THROTTLE_MS
 * exists to avoid.
 *
 * ── Why a grace window rather than a plain flag ────────────────────────────
 * Making the guard actually fire introduces a failure the broken version could
 * not have: if the snapshot is genuinely gone — the user deleted it, the
 * container was reset, iCloud was signed out and back in — a device that refuses
 * to seed refuses forever, and sync silently stops with no way back.
 *
 * So absence is timed rather than trusted. A file missing briefly is treated as
 * eviction and left alone; a file missing well past any plausible restore is
 * treated as really gone, and the device seeds it again. Both failure modes are
 * bounded, and the recovery is automatic in each direction.
 */

/** Written by iCloud sync itself on every cycle that reads a real snapshot. */
export const ICLOUD_LAST_SYNCED_KEY = 'dayglance-icloud-last-synced';

/**
 * How long an absent snapshot is assumed to be a temporary eviction.
 *
 * ICloudBridge.readSync already calls startDownloadingUbiquitousItem when the
 * file is missing, so a restore is in flight from the first observation and
 * normally lands in seconds. Ten minutes is far past that while still being a
 * delay a user would sit through rather than a permanent stall.
 */
export const MISSING_GRACE_MS = 10 * 60 * 1000;

/**
 * @param {object} s
 * @param {boolean} s.hasSyncedBefore  this device has previously read a real snapshot
 * @param {number}  s.missingSince     epoch ms of the first consecutive sighting of
 *                                     the file as absent, or 0 if it was present last cycle
 * @param {number}  s.now              epoch ms
 * @param {number} [s.graceMs]
 * @returns {{skip: boolean, missingSince: number}}
 *   skip         — true to leave the container alone this cycle
 *   missingSince — the value to carry into the next cycle (0 clears the streak)
 */
export function evaluateMissingSnapshot({ hasSyncedBefore, missingSince, now, graceMs = MISSING_GRACE_MS } = {}) {
  // Never synced: nothing can have been evicted, so this is a real first run and
  // seeding is the correct, necessary behaviour. Unchanged from before.
  if (!hasSyncedBefore) return { skip: false, missingSince: 0 };

  // First cycle seeing it absent. Start the clock and wait — this is the eviction
  // case the original guard was written for.
  if (!missingSince) return { skip: true, missingSince: now };

  // Still inside the window: keep waiting, preserving the original sighting so the
  // window measures the whole streak rather than restarting every cycle.
  if (now - missingSince < graceMs) return { skip: true, missingSince };

  // Gone long enough that eviction no longer explains it. Seed, and clear the
  // streak so the next absence starts its own window.
  return { skip: false, missingSince: 0 };
}
