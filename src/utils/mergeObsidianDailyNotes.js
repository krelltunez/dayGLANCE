import { isObsidianTombstoned } from './obsidianDeletions.js';

// Merge an Obsidian scan into the existing daily-notes map WITHOUT deleting notes
// the scan didn't produce — unless a deletion tombstone says the note was really
// removed from the vault.
//
// WHY (measured): with two devices on one GLANCEvault, `performObsidianSync` used
// to REPLACE the whole dailyNotes map with the local scan. When the two devices'
// scans differ (different notes, shorter retention, lazy-downloaded mobile vault,
// or one device has no vault at all), the device with fewer notes deletes the ones
// it lacks → per-row DELETEs → the other device's scan re-adds them → forever (the
// `[pull] DELETE dailyNotes:… ↔ new dailyNotes:…` churn in the vault log).
//
// RULE:
//   - a date in the scan  → take the scanned note (fresher text), carrying the
//     prior `lastModified` forward when the text is unchanged so an unedited note
//     doesn't re-push every scan (the native bridge restamps it each scan);
//   - a date only in `prev` → KEEP it (belongs to another device's vault);
//   - EXCEPT: a date whose deletion tombstone is at least as new as the note is
//     dropped — a genuine vault deletion propagates. A note re-created in Obsidian
//     later (newer lastModified than the tombstone) wins and comes back.
//
// @param {Record<string, {text:string, lastModified?:string}>} prev       current notes
// @param {Record<string, {text:string, lastModified?:string}>} scanned    this device's scan
// @param {Record<string, string>} [tombstones]  deletedObsidianKeys (date → deletedAt ISO)
// @returns {Record<string, object>} merged map
export function mergeObsidianDailyNotes(prev, scanned, tombstones = {}) {
  const out = {};
  // Retain existing dates (other devices' notes / out-of-window) unless tombstoned.
  for (const [date, note] of Object.entries(prev || {})) {
    if (isObsidianTombstoned(tombstones, date, note && note.lastModified)) continue;
    out[date] = note;
  }
  // Apply the scan: override text, preserve timestamp when unchanged, honor deletes.
  for (const [date, note] of Object.entries(scanned || {})) {
    const old = prev && prev[date];
    const merged = (old && old.text === note.text && old.lastModified)
      ? { ...note, lastModified: old.lastModified }
      : note;
    if (isObsidianTombstoned(tombstones, date, merged.lastModified)) { delete out[date]; continue; }
    out[date] = merged;
  }
  return out;
}
