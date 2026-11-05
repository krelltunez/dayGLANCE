// A TASK's linked Obsidian note (the `[[Note]]` in its title, shown whole in
// the task's notes panel) from two possible sources: the vault folder this
// device reads, and the note as the Obsidian plugin last reported it on the
// bridge's observation stream (#2291 follow-up: task notes). Pure: the hook
// (useObsidianSync's loadTaskNote and saveTaskNote) does the reading and
// hands the results here.
//
// NAME TO PATH WITHOUT A FOLDER. A task links a note by NAME; the plugin
// reports notes by PATH, in rows keyed by a hash of the path, so the stream
// cannot be asked which notes exist. A device with a folder searches it, as
// Obsidian does. A device without one resolves the name against the INDEX
// OF REPORTED NOTE PATHS (utils/reportedNotePaths.js, kept by
// utils/reportedNoteIndexStore.js from the observation rows it lists: paths
// only, device-local), the way Obsidian resolves a link, case-insensitively
// and NFC-folded:
//
//  • A link with a folder (`[[Projects/House/Gutter repair]]`) is that path
//    when the plugin reports a note there; otherwise the reported notes
//    whose path ENDS with it on a segment boundary (`[[House/Gutter
//    repair]]` finds Projects/House/Gutter repair.md).
//  • A bare name (`[[Gutter repair]]`) is matched by basename, as Obsidian
//    matches it, among EVERY note the plugin reports: a note shared by a
//    scope tag in any folder, a daily note, a linked project note.
//
//    ONE note found is shown (its report read by path). MORE THAN ONE is
//    ambiguous and none is shown: never the wrong note. None found says
//    why: a matching path reported deleted is deleted; one withdrawn (it
//    left the scope; the note exists) or none at all is not shared. When
//    the index could not be brought up to the stream just now, the link's
//    own path is also read directly, in case the note was reported since.
//
//    UNTIL THE INDEX IS COMPLETE (it is built once from a listing of every
//    row from zero, and an unreadable index is incomplete, never empty) the
//    name is resolved as before the index, from what this device can name:
//    a link with a folder is that path alone; a bare name is looked for
//    among the paths its synced state says exist (imported tasks' notes,
//    the projects' and goals' linked notes, the notes the task-notes
//    migration created) and a bounded set of likely homes asked for
//    directly (the vault root, the folder dayGLANCE creates notes in, the
//    daily-notes folder, the plugin's scope folders). There a request that
//    could not be made (unreachable, out of budget) makes the answer
//    unknown, not unique.
//
//    What this cannot see: a note the plugin does not report (outside its
//    scope). Obsidian's own default link format writes a bare link only
//    while the name is unique, and a save goes out under the PATH that was
//    shown, so a write lands on the note the user saw, never on another.
//
// NEWEST SOURCE. With both a folder copy and a report of the same path, the
// rule is the linked description's (utils/linkedNoteDescription.js,
// newestNoteDescription): the newer file mtime wins, a tie keeps the file. A
// report that the note was deleted is not found, over a local copy too. A
// report that it left the plugin's scope (withdrawn) says nothing about the
// file: the note still exists, it is just no longer shared.
//
// No note TEXT is stored: the panel holds the text it shows, and when the
// plugin reported it, for as long as it shows it. The index holds paths.

import { noteTextHash, normalizeNotePath, noteInScope } from '@glance-apps/obsidian-format';
import { noteLinkOf } from './obsidianProjectNotes.js';
import { newestNoteDescription, isReportedDescription } from './linkedNoteDescription.js';

/** At most this many report reads for one bare name (each one or two row reads, through the limiter). */
export const TASK_NOTE_MAX_CANDIDATES = 8;

const folded = (p) => String(p ?? '').normalize('NFC').toLowerCase();
const basenameOf = (path) => String(path).replace(/\.md$/i, '').split('/').pop();
const trimFolder = (f) => String(f ?? '').normalize('NFC').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
const hasText = (r) => !!r && !r.notFound && typeof r.text === 'string';

/**
 * A wikilink as a task names it → { path, qualified, basename }, or null when
 * nothing is left or the name walks out of the vault. The alias (`|…`) and
 * heading (`#…`) are dropped, `.md` is implied, the path is NFC (the
 * report reader also asks for the decomposed form).
 */
export function parseTaskNoteLink(name) {
  let s = String(name ?? '').trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
  s = s.split('|')[0].split('#')[0];
  s = s.normalize('NFC').replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '').replace(/\.md$/i, '').trim();
  if (!s) return null;
  const parts = s.split('/');
  if (parts.some((p) => !p.trim() || p === '.' || p === '..')) return null;
  return { path: `${s}.md`, qualified: parts.length > 1, basename: parts[parts.length - 1] };
}

/**
 * Vault paths this device's synced state says exist: the notes imported
 * tasks were read from, the task notes the migration created, and the
 * projects' and goals' linked notes (not one marked missing, nor a pending
 * link, whose locator may still be a bare name). Normalized, one per path.
 */
export function knownTaskNotePaths({ tasks = [], projects = [], goals = [] } = {}) {
  const out = new Map();
  const add = (p) => {
    const n = normalizeNotePath(p);
    if (n && !out.has(folded(n))) out.set(folded(n), n);
  };
  for (const t of tasks) {
    if (!t || typeof t !== 'object') continue;
    if (typeof t.obsidianNotePath === 'string') add(t.obsidianNotePath);
    if (typeof t.obsidianNoteTarget === 'string') add(t.obsidianNoteTarget);
  }
  for (const e of [...projects, ...goals]) {
    const link = noteLinkOf(e);
    if (link && !link.missing && !link.pending) add(link.path);
  }
  return [...out.values()];
}

/**
 * The reports to ask for, for a parsed link: { paths, known } where `known`
 * holds (folded) the paths the synced state vouches for. A link with a
 * folder asks for its path alone. A bare name asks for the known paths of
 * that basename first, then the likely homes (the root, the new-notes
 * folder, the daily-notes folder, the scope folders), at most
 * TASK_NOTE_MAX_CANDIDATES. More known notes of that name than the cap is
 * ambiguous outright: { ambiguous: true }.
 */
export function taskNoteCandidates(link, { knownPaths = [], newNotesFolder = '', dailyNotesFolder = '', scopeFolders = [] } = {}, max = TASK_NOTE_MAX_CANDIDATES) {
  if (link.qualified) return { paths: [link.path], known: new Set() };
  const name = folded(link.basename);
  const known = knownPaths.filter((p) => folded(basenameOf(p)) === name);
  if (new Set(known.map(folded)).size > max) return { ambiguous: true };
  const homes = [link.path];
  const nf = trimFolder(newNotesFolder);
  if (nf) homes.push(`${nf}/${link.basename}.md`);
  const df = trimFolder(dailyNotesFolder);
  if (df) homes.push(`${df}/${link.basename}.md`);
  for (const f of scopeFolders) {
    const folder = trimFolder(f);
    if (folder) homes.push(`${folder}/${link.basename}.md`);
  }
  const paths = new Map();
  for (const p of [...known, ...homes]) {
    const n = normalizeNotePath(p);
    if (n && !paths.has(folded(n))) paths.set(folded(n), n);
  }
  return { paths: [...paths.values()].slice(0, max), known: new Set(known.map(folded)) };
}

/** A report reading (fetchReportedNote's 'note') → what the panel shows. */
export function reportedTaskNote(reading) {
  return {
    text: reading.text,
    base: reading.base ?? noteTextHash(reading.text),
    lastModified: reading.lastModified ?? null,
    observedAt: reading.observedAt ?? null,
    path: reading.path,
    source: 'report',
  };
}

/**
 * The note a name resolves to on the stream, from the readings of the
 * candidates (readings[i] answers plan.paths[i], fetchReportedNote's
 * shapes):
 *
 *   the report               exactly one note of that name exists, reported
 *   { unavailable: 'ambiguous' }    more than one exists
 *   { unavailable: 'unreachable' }  a request failed, so one is not proven
 *   { unavailable: 'not_shared' }   the one that exists is not reported
 *                            (withdrawn from the scope, or a known path never
 *                            reported), or nothing of that name is reported
 *   { unavailable: 'deleted' }      none exists, and the plugin reported one
 *                            of them deleted
 *
 * A path counts as existing when reported with content, withdrawn (it left
 * the scope; the file is still there), or vouched for by synced state and
 * never reported. A likely home never reported is no information.
 */
export function resolveReportedTaskNote(plan, readings) {
  if (plan.ambiguous) return { unavailable: 'ambiguous' };
  const exists = new Map();
  let deleted = false;
  let failed = false;
  plan.paths.forEach((path, i) => {
    const r = readings[i] ?? { status: 'unavailable' };
    if (r.status === 'note') exists.set(folded(r.path ?? path), r);
    else if (r.status === 'withdrawn') exists.set(folded(path), r);
    else if (r.status === 'deleted') deleted = true;
    else if (r.status === 'never') { if (plan.known.has(folded(path))) exists.set(folded(path), r); }
    else failed = true;
  });
  if (exists.size > 1) return { unavailable: 'ambiguous' };
  if (failed) return { unavailable: 'unreachable' };
  if (exists.size === 1) {
    const [only] = exists.values();
    return only.status === 'note' ? reportedTaskNote(only) : { unavailable: 'not_shared' };
  }
  return { unavailable: deleted ? 'deleted' : 'not_shared' };
}

/**
 * The note a name resolves to through the index of reported note paths:
 * `match` is resolveIndexedTaskNote's answer for the link against a complete
 * index, `reading` fetchReportedNote's answer for the path read (the
 * matched one; for no match, the link's own path when the caller read it
 * because the index may be behind, else null):
 *
 *   { path } and its report        the note
 *   { path }, reported deleted     { unavailable: 'deleted' } (the index
 *                                   was behind the deletion)
 *   { path }, withdrawn or never   { unavailable: 'not_shared' }
 *   { path }, could not ask        { unavailable: 'unreachable' }
 *   { ambiguous }                  { unavailable: 'ambiguous' }
 *   { none } and a note at the link's own path, reported since: the note
 *   { none } otherwise             'not_shared' when a matching note was
 *                                   withdrawn (it exists, no longer shared);
 *                                   'deleted' when one was reported deleted
 *                                   (or the read says so); else 'not_shared'
 */
export function indexedTaskNote(match, reading) {
  if (match?.ambiguous) return { unavailable: 'ambiguous' };
  if (reading?.status === 'note') return reportedTaskNote(reading);
  if (match?.path) {
    if (reading?.status === 'deleted') return { unavailable: 'deleted' };
    if (reading?.status === 'withdrawn' || reading?.status === 'never') return { unavailable: 'not_shared' };
    return { unavailable: 'unreachable' };
  }
  if (reading?.status === 'withdrawn' || match?.none === 'withdrawn') return { unavailable: 'not_shared' };
  if (reading?.status === 'deleted' || match?.none === 'deleted') return { unavailable: 'deleted' };
  return { unavailable: 'not_shared' };
}

/**
 * The note to show from a folder reading (loadWikiNote's answer: { text,
 * lastModified } | { notFound: true } | null) and the report of the SAME
 * path (fetchReportedNote's answer, or null when not asked). A deletion
 * report is not found: the folder's own "not found" where the folder lacks
 * the note too (its create editor stands), else { unavailable: 'deleted' }.
 * Otherwise the newer of the two by file mtime (newestNoteDescription); a
 * report that is not a note (withdrawn, never, unavailable) is no
 * information and the folder's reading stands.
 */
export function newestTaskNote(note, reported) {
  if (reported?.status === 'deleted') return note?.notFound ? { notFound: true } : { unavailable: 'deleted' };
  const fromFile = hasText(note) ? { ...note, source: 'file' } : null;
  if (reported?.status !== 'note') return fromFile ?? (note?.notFound ? { notFound: true } : null);
  const shown = newestNoteDescription(
    fromFile ? { text: fromFile.text, base: noteTextHash(fromFile.text), lastModified: fromFile.lastModified ?? null } : null,
    { text: reported.text, base: reported.base ?? noteTextHash(reported.text), lastModified: reported.lastModified ?? null, observedAt: reported.observedAt ?? null },
  );
  return isReportedDescription(shown) ? reportedTaskNote(reported) : fromFile;
}

/**
 * Is the folder dayGLANCE creates notes in outside the plugin's scope
 * folders, for a link whose home it would be (a bare name, or a link into
 * that folder)? Then the panel can say why a note dayGLANCE made is not
 * shared. Folders only: a note's tags are not known here.
 */
export function newNotesFolderOutsideScope(link, newNotesFolder, scope) {
  const nf = trimFolder(newNotesFolder);
  if (!nf || !link) return false;
  if (link.qualified && folded(link.path.slice(0, link.path.lastIndexOf('/'))) !== folded(nf)) return false;
  return !noteInScope(`${nf}/${link.basename}.md`, [], { folders: scope?.folders ?? [] });
}
