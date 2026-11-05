// A linked project's or goal's description from TWO possible sources (#2291):
// the note as this device reads it from a vault folder, and the note as the
// Obsidian plugin last reported it on the bridge's observation stream. Pure:
// the hook (useObsidianSync's loadNoteDescription and saveNoteDescription)
// does the reading and hands both results here.
//
// The owner's rulings, implemented here and nowhere else:
//
//  • NO REPORT IS NO INFORMATION. A path the plugin never reported (null)
//    leaves the folder's answer as it is, and with no folder the box keeps
//    saying the notes live in Obsidian. Absence is never deletion.
//  • DELETED OR WITHDRAWN IS NOT FOUND. When the plugin's latest report of
//    the path says the note is gone or no longer reported, the box says not
//    found, not old text, whatever a folder copy here still holds (a
//    deletion report carries no file time to weigh, and the plugin is the
//    one that saw it happen).
//  • NO FOLDER: THE REPORT. A folder that cannot be read (no vault here, a
//    failed read) or that does not have the note gives way to the report.
//  • BOTH: THE NEWER, FILE TO FILE. The report's file mtime against the
//    local file's lastModified; the report wins only when it is provably
//    newer (both times known, the report's later). A device whose copy is
//    behind (the "holding" posture, utils/obsidianVaultPosture.js) then
//    shows what Obsidian has, not what its copy last had. When the newer
//    report carries the same section, the local reading stands: same text,
//    same base, and no "as reported" age on it.
//
// The result is the loader's contract: { text, base, lastModified } from a
// file; from a report the same plus `source: 'report'` and `observedAt`
// (when the plugin reported it), which is how the box knows to show its
// age; { notFound: true }; or null when nothing could be read.

import { extractNoteDescription, noteTextHash } from '@glance-apps/obsidian-format';

/** loadWikiNote's answer → { text, base, lastModified } | { notFound: true } | null. */
export function fileNoteDescription(note) {
  if (!note) return null;
  if (note.notFound) return { notFound: true };
  const text = extractNoteDescription(note.text ?? '');
  return { text, base: noteTextHash(text), lastModified: note.lastModified ?? null };
}

const timeMs = (v) => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(n) ? n : null;
};

const hasText = (r) => !!r && !r.notFound && typeof r.text === 'string';

/**
 * The description to show, from the folder's reading and the stream's.
 * @param {{text:string, base:string, lastModified?:string|number|null}|{notFound:true}|null} fromFile
 * @param {{text:string, base:string, lastModified:string|null, observedAt:string|null}|{notFound:true}|null} reported
 */
export function newestNoteDescription(fromFile, reported) {
  if (!reported) return fromFile ?? null;
  if (reported.notFound) return { notFound: true };
  if (!hasText(reported)) return fromFile ?? null;
  if (!hasText(fromFile)) return { ...reported, source: 'report' };
  const reportMs = timeMs(reported.lastModified);
  const fileMs = timeMs(fromFile.lastModified);
  const reportNewer = reportMs != null && fileMs != null && reportMs > fileMs;
  if (reportNewer && reported.base !== fromFile.base) return { ...reported, source: 'report' };
  return fromFile;
}

/** Did this description come from the plugin's report rather than a file? */
export const isReportedDescription = (r) => hasText(r) && r.source === 'report';
