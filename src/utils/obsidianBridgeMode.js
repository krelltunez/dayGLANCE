// BRIDGE MODE TRANSITIONS — the deletion detector's baseline across the
// pairing handoff (Phase 6 PR 3, gate b — AS AMENDED; see the correction
// record in the spec's Phase 6 build notes).
//
// A device's vault source is either 'direct' (scan + direct writes) or
// 'plugin' (intent stream + observations). While a device is in plugin mode
// its direct scans stop, so its detector baseline
// ('day-planner-obsidian-last-scanned') stops advancing; if it later flipped
// back and diffed a fresh scan against that months-old baseline, everything
// legitimately removed since would look like a fresh deletion — the
// mass-tombstone shape the detector's guards exist to prevent.
//
// THE FIRST SHAPE OF THIS MODULE cleared the baseline on every transition.
// That bought safety from the mass-tombstone shape by DESTROYING THE
// EVIDENCE a legitimate detection needs: deletions made while paired were
// not detected late — they were never detected at all, because the fresh
// baseline was rebuilt from the post-deletion vault. In the expected Phase 6
// end state (every vault-access device paired) no detector runs anywhere
// and vault deletions stop propagating indefinitely — quietly suspending
// "Obsidian controls task existence" (§3.10, ruling 4; see the availability
// note recorded there).
//
// THE AMENDED RULE — ARCHIVE AND RECONCILE:
//   • Direct→plugin: the live baseline and its dates sidecar are ARCHIVED,
//     stamped with the transition time, not deleted. The live keys clear
//     (they never survive a transition), so the live detector still gets
//     its one conservative empty-baseline cycle after any flip.
//   • Plugin→direct: the live baseline stays empty exactly as before; the
//     archive waits.
//   • On each direct-mode scan while an archive exists, the EXISTING
//     detector runs once more with the archived baseline against the fresh
//     scan (reconcileArchivedBaseline). Every guard applies unchanged: the
//     window cutoff excludes keys that aged out during the paired period
//     (dates from the archived sidecar), empty-scan and drop-too-large
//     skip — a skipped reconcile keeps the archive and retries on the next
//     scan. The archive is a ONE-SHOT side channel: consumed on a clean
//     reconcile, discarded past the 60-day tombstone horizon (past which a
//     tombstone would be GC'd anyway), and never re-fed from live scans —
//     so no oscillation between "too big to trust" and catching up exists.
//   • Reconcile tombstones are stamped with the ARCHIVE time, never `now`.
//     That is what makes a month-late detection safe: anything created,
//     re-created, or merely touched since the device entered plugin mode
//     has a newer lastModified and beats the tombstone under the existing
//     LWW rule — only rows genuinely untouched since before the paired
//     window can drop.
//
// Honest remaining gap: a task created AND deleted entirely within the
// paired window was never in any baseline and still lingers (recorded in
// the spec as the accepted cost). The plugin's `deleted` observations are
// deliberately NOT used — rename-vs-delete event semantics are exactly
// what the detector was built to avoid.
//
// Mode can flap with Obsidian's own liveness (pluginAuthoritative = fresh
// AND paired heartbeat — a closed Obsidian reverts the device to direct by
// design, §3.3's one revert path). A flap while an archive is pending
// merges any newer live baseline INTO the archive under the OLDER stamp —
// an older stamp only weakens the eventual tombstones (loses more LWW
// races), which is the safe direction.
//
// WHAT ELSE COULD FOSSILIZE (checked, gate b): the dates sidecar — archived
// here in lockstep (meaningless without its keys). Deletion tombstones —
// deliberately KEPT: they record actually-observed deletions, are
// LWW-revivable, and age out on the shared retention. Wikilink candidates —
// cosmetic autocomplete, refreshed on reconnect. The writeback's prev-state
// snapshot — not a detector input; gate (a)'s emit-in-same-tick discipline
// covers it. The Tasks-plugin detection — still refreshed in plugin mode
// (dot-file READS continue; only writes and the scan stop).

import { detectObsidianDeletions } from './obsidianDeletions.js';
import { TOMBSTONE_RETENTION_DAYS } from '../sync/tombstoneRetention.js';

const MODE_KEY = 'day-planner-obsidian-bridge-mode';
const BASELINE_KEY = 'day-planner-obsidian-last-scanned';
const BASELINE_DATES_KEY = 'day-planner-obsidian-last-scanned-dates';
const ARCHIVE_KEY = 'day-planner-obsidian-baseline-archive';

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};

// Move the live baseline into the archive. An archive already pending (a
// flap before its reconcile) is merged, keeping the OLDER archivedAt — see
// the module header for why older-is-safer.
function archiveLiveBaseline(nowIso) {
  const keys = readJson(BASELINE_KEY, []);
  if (!Array.isArray(keys) || keys.length === 0) return; // nothing new to preserve
  const dates = readJson(BASELINE_DATES_KEY, {});
  const existing = readJson(ARCHIVE_KEY, null);
  const merged = existing && Array.isArray(existing.keys)
    ? {
      keys: [...new Set([...existing.keys, ...keys])],
      dates: { ...dates, ...(existing.dates || {}) },
      archivedAt: new Date(existing.archivedAt) <= new Date(nowIso) ? existing.archivedAt : nowIso,
    }
    : { keys, dates, archivedAt: nowIso };
  localStorage.setItem(ARCHIVE_KEY, JSON.stringify(merged));
}

/**
 * Record the mode this cycle runs under ('direct' | 'plugin'). On a
 * transition, archives (direct→plugin) and clears the live baseline +
 * sidecar, and returns true; on a repeat of the stored mode, does nothing.
 * A missing stored mode (first run after upgrade) records without touching
 * anything — the device was always direct.
 */
export function recordBridgeMode(mode, nowIso = new Date().toISOString()) {
  try {
    const prev = localStorage.getItem(MODE_KEY);
    if (prev === mode) return false;
    localStorage.setItem(MODE_KEY, mode);
    if (prev === null) return false;
    if (mode === 'plugin') archiveLiveBaseline(nowIso);
    localStorage.removeItem(BASELINE_KEY);
    localStorage.removeItem(BASELINE_DATES_KEY);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the archived baseline (if any) through the existing detector against
 * a fresh direct-mode scan. Call once per direct-mode sync cycle, before
 * the merges consume tombstones.
 *
 * @param {string[]} currentKeys — the fresh scan's keys (notes + tasks).
 * @param {string|null} cutoffDate — the scan's window cutoff (same value
 *   the live detector uses, so the two windows can't drift).
 * @returns {null | {skipped: true} | {skipped: false, deletions: string[], archivedAt: string}}
 *   null — no archive (or it was malformed/expired and got discarded).
 *   skipped — the reconcile's own guards judged this scan untrustworthy
 *   against the archive; the archive is KEPT for the next scan.
 *   Otherwise the archive is CONSUMED; stamp the returned deletions with
 *   `archivedAt` (never now) via addObsidianTombstones.
 */
export function reconcileArchivedBaseline(currentKeys, cutoffDate, nowMs = Date.now()) {
  try {
    const raw = localStorage.getItem(ARCHIVE_KEY);
    if (!raw) return null;
    let archive = null;
    try { archive = JSON.parse(raw); } catch { /* malformed */ }
    if (!archive || !Array.isArray(archive.keys) || typeof archive.archivedAt !== 'string') {
      localStorage.removeItem(ARCHIVE_KEY);
      return null;
    }
    const ageMs = nowMs - new Date(archive.archivedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > TOMBSTONE_RETENTION_DAYS * 86400000) {
      // Past the horizon a tombstone would already be GC'd, so reconciling
      // is moot — this residue degrades to the lingering-task cost, logged.
      localStorage.removeItem(ARCHIVE_KEY);
      console.info(`Obsidian bridge: discarded baseline archive from ${archive.archivedAt} (past the ${TOMBSTONE_RETENTION_DAYS}-day tombstone horizon); vault rows deleted in that window may linger in the app.`);
      return null;
    }
    const { deletions, skipped } = detectObsidianDeletions(
      archive.keys, currentKeys, cutoffDate, { keyDates: archive.dates || {} },
    );
    if (skipped) return { skipped: true };
    localStorage.removeItem(ARCHIVE_KEY);
    return { skipped: false, deletions, archivedAt: archive.archivedAt };
  } catch {
    return null;
  }
}
