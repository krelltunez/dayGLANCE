// Keep Obsidian daily-note `lastModified` stable across scans when the note text
// hasn't changed.
//
// WHY: the native Obsidian bridge (Android) exposes no file mtime, so
// syncObsidianVaultNative / readDailyNoteNative stamp `lastModified: new
// Date().toISOString()` on EVERY scan (src/obsidian.js). Each 5-minute poll or
// visibility-triggered re-scan therefore rewrites `lastModified` on every daily
// note, even when nothing changed. Those rows then false-diff in the DB-sync
// snapshot every scan → push → account seq advance → SSE self-nudge loop (the
// same failure class as the tombstonePrunedBefore full-precision churn). The
// browser File System Access path avoids this by deriving `lastModified` from the
// real file mtime (stable), so this only bites native shells.
//
// FIX: when a scanned note's `text` matches the copy we already hold, carry the
// prior `lastModified` forward so the row is byte-identical and does NOT re-push.
// A note new to `prev`, or one whose text genuinely changed, keeps the incoming
// timestamp — mirrors stampTimestamps' "unchanged → keep stored lastModified"
// rule for tasks. `lastModified` still drives per-date LWW across devices, so a
// real edit (text change) advances it and wins the merge exactly as before.
//
// @param {Record<string, {text:string, lastModified?:string}>} prev      current in-memory notes
// @param {Record<string, {text:string, lastModified?:string}>} incoming  freshly scanned notes
// @returns {Record<string, object>} incoming with unchanged notes' lastModified preserved
export function preserveDailyNoteTimestamps(prev, incoming) {
  const out = {};
  for (const [date, note] of Object.entries(incoming || {})) {
    const old = prev && prev[date];
    out[date] = (old && old.text === note.text && old.lastModified)
      ? { ...note, lastModified: old.lastModified }
      : note;
  }
  return out;
}
