// Merge an Obsidian scan into the existing daily-notes map WITHOUT deleting notes
// the scan didn't produce.
//
// WHY (measured): with two devices on one GLANCEvault, `performObsidianSync` used
// to REPLACE the whole dailyNotes map with the local scan. When the two devices'
// Obsidian vaults differ (different notes, shorter retention window, or one device
// has no vault at all), the device with fewer notes deletes the ones it lacks →
// pushes per-row DELETEs to the vault → the other device's scan re-adds them →
// pushes them back → the other device deletes them again. An endless cross-device
// resurrection loop (the `[pull] DELETE dailyNotes:…` ↔ `new dailyNotes:…` churn
// in the vault log).
//
// FIX: treat the scan as authoritative only for the dates it actually covers.
//   - a date in the scan  → take the scanned note (its text is fresher), but carry
//     the prior `lastModified` forward when the text is unchanged so an unedited
//     note doesn't re-push every scan (the native bridge has no file mtime and
//     restamps `lastModified: new Date()` each scan — see src/obsidian.js);
//   - a date only in `prev` → KEEP it. It belongs to another device's vault (or is
//     outside this device's retention window); deleting it is what caused the loop.
//
// TRADE-OFF: a note genuinely deleted in Obsidian is no longer removed across
// devices by a scan alone (that needs a tombstone, like deletedTaskIds). This is
// strictly safer than the previous behaviour, which both looped forever AND
// deleted one device's notes from the other.
//
// @param {Record<string, {text:string, lastModified?:string}>} prev      current notes
// @param {Record<string, {text:string, lastModified?:string}>} scanned   this device's scan
// @returns {Record<string, object>} union of prev + scanned, timestamps preserved
export function mergeObsidianDailyNotes(prev, scanned) {
  const out = { ...(prev || {}) }; // start from existing → never drop another device's dates
  for (const [date, note] of Object.entries(scanned || {})) {
    const old = prev && prev[date];
    out[date] = (old && old.text === note.text && old.lastModified)
      ? { ...note, lastModified: old.lastModified } // unchanged text → stable timestamp
      : note;
  }
  return out;
}
