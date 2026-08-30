// NOTE-SCOPED DELETION INFERENCE (plugin mode) — §3.10 availability note,
// second closure.
//
// While the plugin is authoritative this device consumes observations, and
// observations can never establish SCAN completeness — so the vault-wide
// deletion detector (utils/obsidianDeletions.js) deliberately does not run,
// and a task whose line left the vault lingered until the next direct-mode
// scan. That was the availability gap. But an observation DOES establish
// completeness at a smaller grain: it is the plugin's read of the WHOLE
// file, so for the one note it covers, the parse is the complete truth of
// which lines exist. This module closes the gap at that grain:
//
//   A task that claims to live in an observed note (obsidianFileDate — or,
//   for legacy content-derived ids, the date baked into the id) and whose
//   id AND legacy hint are both absent from that note's parse has had its
//   line removed from the vault → tombstone it through the EXISTING
//   deletedObsidianKeys LWW channel, STAMPED AT THE OBSERVATION'S MTIME
//   (never "now") — mirroring the archive-reconcile's archive-time
//   stamping, so an app-side edit newer than the note beats the tombstone
//   and the task survives. Identity is untouched: this infers only
//   existence, through the same conservative, LWW-revivable channel the
//   direct detector writes, and what wins on divergence is decided by the
//   channel's existing rule, unchanged.
//
// ONE-CYCLE CONFIRMATION HOLD. A candidate is not tombstoned on the batch
// that evidenced it — it is PENDED, and committed on the NEXT successful
// fetch unless the id (or its hint) showed up in an observation in between.
// This is the note-scoped analog of the detector's incomplete-scan
// conservatism, and it exists for one concrete race: a tagged task moved
// between notes in Obsidian (a reschedule by cut-and-paste) produces two
// observations — source without the line, destination with it — and a fetch
// landing between the two emits sees only the removal. Complete scans are
// structurally immune to this (both notes in one scan); per-note
// observations are not, so the hold waits one cycle for the other half of
// the move. A successful fetch reads the stream exhaustively by seq, so
// "the id appeared nowhere in the next fetch" is complete knowledge, not a
// sample.
//
// NAMED ASSUMPTION (spec §3.10): daily-note dates are single-sourced per
// account — every paired/scanning device sees the same daily notes (one
// vault, possibly replicated by Obsidian Sync). Already implied by the
// dailyNotes LWW merge; note-scoped inference leans on it the same way the
// vault-wide detector does.
//
// RESIDUALS (named, not hidden): a note never observed while paired still
// can't report deletions (the remaining availability gap); a line removed
// and re-created verbatim across a confirmation boundary stays suppressed
// until the tombstone GCs, exactly as in direct mode (fresh imports carry
// an epoch lastModified, so the documented re-creation revival is inert for
// tasks — a pre-existing trait of the channel, inherited, not widened).

import { obsidianKeyDate } from './obsidianDeletions.js';

/**
 * Candidates this batch evidences: tasks claiming to live in an observed
 * note whose parse contains neither their id nor their legacy hint.
 *
 * @param {Record<string, {lastModified?: string}>} observedNotes
 *   the batch's applied daily notes (applyBridgeObservations().dailyNotes) —
 *   date → { lastModified: the observation's file mtime, ISO }
 * @param {Set<string>} scannedIds  ids + legacy hints across the batch's
 *   parsed tasks (applyBridgeObservations().scannedIds)
 * @param {object[]} tasks  current scheduled tasks (pre-merge)
 * @param {object[]} inbox  current inbox tasks (pre-merge)
 * @returns {Array<{id: string, noteDate: string, deletedAt: string}>}
 */
export function inferNoteScopedDeletionCandidates({ observedNotes, scannedIds, tasks, inbox }) {
  const out = [];
  if (!observedNotes || Object.keys(observedNotes).length === 0) return out;
  for (const t of [...(tasks || []), ...(inbox || [])]) {
    if (!t || t.importSource !== 'obsidian') continue;
    const id = String(t.id);
    // Where does this task claim its line lives? obsidianFileDate is the
    // note the line was last parsed from; a legacy content-derived id
    // carries its note date itself. Neither → conservatively skip (a task
    // whose home note we can't name can't be judged by any note's parse).
    const noteDate = t.obsidianFileDate || obsidianKeyDate(id);
    if (!noteDate) continue;
    const note = observedNotes[noteDate];
    if (!note) continue; // note not in this batch — no evidence either way
    if (scannedIds.has(id)) continue; // line present (or a tagged line advertises this id as its hint)
    if (t.obsidianLegacyId && scannedIds.has(String(t.obsidianLegacyId))) continue;
    out.push({ id, noteDate, deletedAt: note.lastModified || new Date().toISOString() });
  }
  return out;
}

/**
 * Advance the confirmation hold by one successful fetch. Pure.
 *
 * Pending entries are RESCUED when the id reappeared in this batch (the
 * other half of a cross-note move landed) and DROPPED when the task is no
 * longer live in app state (its removal is someone else's record — an
 * in-app delete, or an identity move whose retirement is already
 * bookkept). Everything else pends from a PREVIOUS fetch and this fetch is
 * complete knowledge that the id never came back → COMMIT. This batch's
 * fresh candidates become the next pending set; a candidate that was
 * already pending is the absent-twice case and commits (with the NEWEST
 * evidence stamp — the latest observation is the vault's latest statement,
 * matching how the detector stamps at detection time).
 *
 * @param {Record<string, {noteDate: string, deletedAt: string}>} pending
 * @param {Array<{id, noteDate, deletedAt}>} candidates  this batch's (may be [])
 * @param {Set<string>} scannedIds  this batch's ids + hints (may be empty)
 * @param {Set<string>} liveIds  String ids of current obsidian tasks+inbox
 * @returns {{ commits: Array<{id, noteDate, deletedAt}>, nextPending: Record<string, {noteDate, deletedAt}> }}
 */
export function reconcileNoteScopedDeletions({ pending, candidates, scannedIds, liveIds }) {
  const commits = [];
  const committed = new Set();
  const byId = new Map((candidates || []).map((c) => [c.id, c]));
  for (const [id, entry] of Object.entries(pending || {})) {
    if (scannedIds.has(id)) continue; // rescued — the line reappeared
    if (!liveIds.has(id)) continue; // task already gone; not this channel's record
    const fresh = byId.get(id);
    commits.push(fresh || { id, ...entry });
    committed.add(id);
  }
  const nextPending = {};
  for (const c of candidates || []) {
    if (committed.has(c.id)) continue;
    nextPending[c.id] = { noteDate: c.noteDate, deletedAt: c.deletedAt };
  }
  return { commits, nextPending };
}
