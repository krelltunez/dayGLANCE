/**
 * Skips widget-snapshot pushes whose content has not changed.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 * The snapshot effect re-runs far more often than the snapshot changes. Its
 * dependency array includes `currentTime` (a 15-second interval) and several
 * derived arrays — todayAgenda, activeHabits, hgVisibleProjects, glanceAhead —
 * that are rebuilt each render, so their identity changes even when their
 * contents do not. Observed on a real device: 108 consecutive pushes of a
 * byte-identical 13 KB payload while the app sat idle.
 *
 * Each push is more expensive than it looks. The bridge is a SYNCHRONOUS XHR
 * (see bridgeScript() in WebView.swift), so every call blocks the JS thread for
 * the round trip; and on the native side WidgetBridge.updateSnapshot runs
 * WidgetCenter.reloadAllTimelines() and LiveActivityBridge.sync() each time. A
 * hundred redundant pushes is a hundred timeline reloads for data that did not
 * move.
 *
 * ── The trap ───────────────────────────────────────────────────────────────
 * The obvious fix — remember the last JSON and compare — does nothing, because
 * the snapshot ends with `updatedAt: Date.now()`. Every serialization differs,
 * so a naive comparison never matches and every push still goes through. (It is
 * also why the byte counts looked identical while the bytes were not: a
 * millisecond timestamp is always 13 digits.) The comparison has to exclude that
 * field, which is what this module is for.
 *
 * Everything else in the snapshot is stable between block boundaries:
 * computeDaySummary takes no clock argument, and buildUpNextFact's output is a
 * boundary-derived label plus an absolute countdownEndMs that SwiftUI counts
 * down on its own. So excluding `updatedAt` is sufficient, not merely necessary.
 */

/**
 * Content fingerprint of a snapshot: its JSON minus the always-changing
 * `updatedAt` stamp.
 *
 * Key order is insertion order and the snapshot is built from a single object
 * literal, so stringify is stable across calls and safe to compare directly.
 *
 * @param {object} snapshot
 * @returns {string}
 */
export function snapshotFingerprint(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  // eslint-disable-next-line no-unused-vars
  const { updatedAt, ...rest } = snapshot;
  try {
    return JSON.stringify(rest);
  } catch {
    // A cyclic or otherwise unserialisable snapshot cannot be fingerprinted.
    // Return '' so the caller pushes rather than silently suppressing an update
    // — failing toward "send it" is the safe direction for a widget.
    return '';
  }
}

/**
 * Decides whether this snapshot needs sending.
 *
 * An empty fingerprint (unserialisable snapshot) always pushes: a widget showing
 * stale data is a worse failure than a redundant bridge call.
 *
 * @param {object} snapshot
 * @param {string} lastFingerprint  fingerprint of the last snapshot actually sent
 * @returns {{push: boolean, fingerprint: string}}
 */
export function evaluateSnapshotPush(snapshot, lastFingerprint) {
  const fingerprint = snapshotFingerprint(snapshot);
  if (!fingerprint) return { push: true, fingerprint: '' };
  return { push: fingerprint !== lastFingerprint, fingerprint };
}
