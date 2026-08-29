// BRIDGE MODE TRANSITIONS — the deletion detector's baseline across the
// pairing handoff (Phase 6 PR 3, gate b).
//
// A device's vault source is either 'direct' (scan + direct writes) or
// 'plugin' (intent stream + observations). While a device is in plugin mode
// its direct scans stop, so its detector baseline
// ('day-planner-obsidian-last-scanned') stops advancing; if it later flips
// back and diffed a fresh scan against that months-old baseline, everything
// legitimately removed since would look like a fresh deletion — the
// mass-tombstone shape the detector's guards exist to prevent.
//
// THE RULE: every mode transition, IN BOTH DIRECTIONS, clears the baseline
// and its dates sidecar in lockstep. detectObsidianDeletions against an
// empty baseline reports nothing — that IS the one conservative
// no-detection cycle: the first post-transition scan detects nothing and
// (when complete) establishes a fresh baseline; detection resumes on the
// second. Clearing on the direct→plugin edge too is deliberate: a baseline
// with no scans to advance it is only a liability, and clearing early means
// nothing fossilizes no matter how the device later leaves plugin mode
// (unpair, staleness, reinstall).
//
// Mode can flap with Obsidian's own liveness (pluginAuthoritative = fresh
// AND paired heartbeat — a closed Obsidian reverts the device to direct
// writes by design, §3.3's one revert path). Each flap costs one
// conservative cycle; missing a deletion for a cycle is the cheap side of
// this trade, silently tombstoning live tasks is the expensive one.
//
// WHAT ELSE COULD FOSSILIZE (checked, gate b): the dates sidecar — cleared
// here in lockstep (meaningless without its scan). Deletion tombstones —
// deliberately KEPT: they record actually-observed deletions, are
// LWW-revivable, and age out on the shared retention. Wikilink candidates —
// cosmetic autocomplete, refreshed on reconnect. The writeback's prev-state
// snapshot — not a detector input; gate (a)'s emit-in-same-tick discipline
// covers it. The Tasks-plugin detection — still refreshed in plugin mode
// (dot-file READS continue; only writes and the scan stop).

const MODE_KEY = 'day-planner-obsidian-bridge-mode';
const BASELINE_KEY = 'day-planner-obsidian-last-scanned';
const BASELINE_DATES_KEY = 'day-planner-obsidian-last-scanned-dates';

/**
 * Record the mode this cycle runs under ('direct' | 'plugin'). On a
 * transition, clears the detector baseline + sidecar and returns true; on a
 * repeat of the stored mode, does nothing. A missing stored mode (first run
 * after upgrade) records without clearing — the device was always direct.
 */
export function recordBridgeMode(mode) {
  try {
    const prev = localStorage.getItem(MODE_KEY);
    if (prev === mode) return false;
    localStorage.setItem(MODE_KEY, mode);
    if (prev === null) return false;
    localStorage.removeItem(BASELINE_KEY);
    localStorage.removeItem(BASELINE_DATES_KEY);
    return true;
  } catch {
    return false;
  }
}
