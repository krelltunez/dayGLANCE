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
// WALL-CLOCK CONFIRMATION HOLD (reshaped 2026-08-31, after the SSE-speed
// war; §3.10's cycles-vs-wall-clock lesson). A candidate is not tombstoned
// on the batch that evidenced it — it is PENDED, and committed only when
// BOTH hold:
//
//   (1) a SUBSEQUENT complete fetch found the id (and its hint) still
//       absent — a successful fetch reads the stream exhaustively by seq,
//       so "appeared nowhere" is complete knowledge, not a sample; and
//   (2) at least NOTE_DELETION_HOLD_MS (90s) of wall-clock time has passed
//       since the candidate was first pended.
//
// The hold exists for one concrete race: a tagged task moved between notes
// in Obsidian (a reschedule by cut-and-paste) produces two observations —
// source without the line, destination with it — and a fetch landing
// between the two emits sees only the removal. Complete scans are
// structurally immune (both notes in one scan); per-note observations are
// not, so the hold waits for the other half of the move — and the other
// half can be delayed by REPLICATION, not just by emit order: with
// Obsidian Sync, the destination edit may sit on another device for tens
// of seconds before it syncs, is observed, and reaches the stream.
//
// Why wall-clock is load-bearing and "one more cycle" was not: the
// original hold ("commit on the NEXT successful fetch") measured time in
// CYCLES, implicitly sized by the 5-minute poll it was built under —
// "one cycle" meant minutes of real time for the move's other half to
// land. Phase 7 (SSE-triggered fetches) shrank a cycle to ~2 seconds
// without touching this file, and the hold silently became no hold at
// all: the janitor OUTRAN the replication it was waiting for, and
// mid-flight states (a cross-device stamp round-trip, a Sync-lagged note)
// were committed as deletions — one of the three interacting bugs in the
// 2026-08-31 feedback war. The 90s minimum is anchored to the thing
// actually being waited for (Obsidian Sync convergence plus an observation
// round, wall-clock properties of the replication) and is INDEPENDENT OF
// CYCLE SPEED BY CONSTRUCTION: however fast fetches fire, a commit cannot
// happen before 90 real seconds of continuous absence. Faster cycles now
// only mean absence is re-checked more often — never that it is concluded
// sooner.
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

/** The wall-clock minimum a candidate stays pended before it may commit —
 *  sized to what the hold actually waits for (Obsidian Sync convergence of
 *  a cross-note move's other half, plus an observation round), NOT to any
 *  cycle cadence. See the module header. */
export const NOTE_DELETION_HOLD_MS = 90_000;

/**
 * Advance the confirmation hold by one successful fetch. Pure.
 *
 * Pending entries are RESCUED when the id reappeared in this batch (the
 * other half of a cross-note move landed) and DROPPED when the task is no
 * longer live in app state (its removal is someone else's record — an
 * in-app delete, or an identity move whose retirement is already
 * bookkept). An entry that survives both checks COMMITS only when it has
 * been pending for ≥ NOTE_DELETION_HOLD_MS of wall-clock time — this call
 * being a subsequent complete fetch supplies the "never came back"
 * knowledge, the clock supplies the minimum; both are required. A younger
 * entry carries forward with its ORIGINAL pendedAt (absence is continuous;
 * re-evidencing it doesn't restart the clock) and, when this batch
 * re-evidenced it, the NEWEST evidence stamp — the latest observation is
 * the vault's latest statement, matching how the detector stamps at
 * detection time. Fresh candidates enter the pending set stamped at `now`.
 *
 * MIGRATION: a persisted entry without pendedAt (written by a pre-hold
 * build) is treated conservatively — it gets `now` as its pendedAt, i.e.
 * the clock starts here, never "assume it has already waited".
 *
 * @param {Record<string, {noteDate: string, deletedAt: string, pendedAt?: number}>} pending
 * @param {Array<{id, noteDate, deletedAt}>} candidates  this batch's (may be [])
 * @param {Set<string>} scannedIds  this batch's ids + hints (may be empty)
 * @param {Set<string>} liveIds  String ids of current obsidian tasks+inbox
 * @param {number} [nowMs]  injection point for tests; defaults to Date.now()
 * @returns {{ commits: Array<{id, noteDate, deletedAt}>, nextPending: Record<string, {noteDate, deletedAt, pendedAt: number}> }}
 */
export function reconcileNoteScopedDeletions({ pending, candidates, scannedIds, liveIds, nowMs = Date.now() }) {
  const commits = [];
  const nextPending = {};
  const byId = new Map((candidates || []).map((c) => [c.id, c]));
  for (const [id, entry] of Object.entries(pending || {})) {
    if (scannedIds.has(id)) continue; // rescued — the line reappeared
    if (!liveIds.has(id)) continue; // task already gone; not this channel's record
    const fresh = byId.get(id);
    const pendedAt = Number.isFinite(entry.pendedAt) ? entry.pendedAt : nowMs;
    if (pendedAt <= nowMs - NOTE_DELETION_HOLD_MS) {
      commits.push(fresh ? { id: fresh.id, noteDate: fresh.noteDate, deletedAt: fresh.deletedAt } : { id, noteDate: entry.noteDate, deletedAt: entry.deletedAt });
    } else {
      nextPending[id] = {
        noteDate: fresh ? fresh.noteDate : entry.noteDate,
        deletedAt: fresh ? fresh.deletedAt : entry.deletedAt,
        pendedAt,
      };
    }
  }
  for (const c of candidates || []) {
    if (nextPending[c.id] || commits.some((k) => k.id === c.id)) continue;
    nextPending[c.id] = { noteDate: c.noteDate, deletedAt: c.deletedAt, pendedAt: nowMs };
  }
  return { commits, nextPending };
}
