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
//   A task that claims to live in an observed note (obsidianFileDate ONLY,
//   since audit fix H4 — the legacy-id fallback date is the TASK date, not
//   the file date, and misattributed rescheduled lines) and whose
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
//
// THE CONTINUITY GUARD (audit fix C1, 2026-08-31/09-01). The hold's premise
// is CONTINUOUS plugin-mode observation: "90s of absence" is only evidence
// while something was watching for the id to reappear. That premise was
// silently conditional — the pending set persists in localStorage, is
// touched ONLY by the plugin-mode branch, and its clocks kept running
// through every discontinuity: Obsidian closed (mode flips to direct), the
// app itself closed, a re-pairing whose rotated subkey even destroys the
// rescue evidence in unread rows. Days later, the FIRST plugin-mode fetch
// (even an empty one) found ancient pendedAt values and committed stale
// entries as deletions — a live task tombstoned on machine wake, with a
// days-old mtime stamp that loses the LWW. Two closures, both conservative
// (dropping or re-pending an entry never deletes anything; the worst cost
// is re-inferring from fresh evidence):
//   • the pending store now records WHEN reconcile last ran (touchedAt,
//     the v2 envelope below); a gap beyond PENDING_CONTINUITY_GAP_MS
//     restarts every entry's clock — absence was not being watched across
//     the gap, so it must be re-established, never assumed. The gap bound
//     is MECHANICAL: sized to the reconcile cadence (the 5-minute poll,
//     the slowest thing that runs it), not to any typing/usage guess.
//   • a successful DIRECT scan clears the pending set outright (wired in
//     useObsidianSync): a vault-wide scan is strictly stronger evidence
//     than any observation batch — present ids are rescued by definition,
//     and absent ids are the vault-wide detector's jurisdiction with its
//     own guards and channel.
// A v1 store (bare entries map, no touchedAt) migrates conservatively:
// unknown continuity is treated as broken, clocks restart.


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
    // Where does this task claim its line lives? obsidianFileDate — the
    // note the line was last parsed from — and NOTHING ELSE (audit fix H4).
    // The first shape fell back to the date embedded in a legacy id, but
    // that date is minted from the TASK date, not the file date
    // (legacyObsidianId(taskDate, rawTitle)), and the two diverge exactly
    // when a line carries an inline date prefix (a dayGLANCE reschedule
    // written into its original note). A task missing obsidianFileDate —
    // synced from a pre-field build and never rescanned on this device —
    // was then judged by the parse of a note that NEVER contained its line:
    // any observation of that note pended it, and the hold committed a
    // false deletion of a live task. A task whose home note we cannot
    // honestly name cannot be judged by any note's parse — skip it; the
    // vault-wide detector still covers it on the next direct scan, and any
    // observation re-import re-establishes obsidianFileDate.
    const noteDate = t.obsidianFileDate;
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

// ── THE CONTINUITY GUARD (audit fix C1 — full rationale in the header) ──────

/** localStorage key for the pending store (owned here so the reader, the
 *  writer, and the direct-scan clear can never drift on the name). */
export const PENDING_NOTE_DELETIONS_KEY = 'day-planner-obsidian-pending-note-deletions';

/** Reconcile-gap bound beyond which observation continuity is considered
 *  BROKEN and every pending clock restarts. MECHANICAL: sized to the
 *  reconcile cadence — the 5-minute poll is the slowest trigger that runs
 *  it, so three missed polls means the watcher was not running (app closed,
 *  mode flipped to direct, plugin gone), never that the vault was quiet. */
export const PENDING_CONTINUITY_GAP_MS = 15 * 60_000;

/**
 * Read the pending store: `{ entries, touchedAt }`. Handles both shapes —
 * the v2 envelope `{v:2, touchedAt, entries}` and the legacy bare entries
 * map, which migrates with `touchedAt: null` (unknown continuity is treated
 * as broken by the guard below — conservative). Corruption reads as empty.
 */
export function readPendingNoteDeletions(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage.getItem(PENDING_NOTE_DELETIONS_KEY) || '{}');
    if (raw && typeof raw === 'object' && raw.v === 2) {
      return {
        entries: raw.entries && typeof raw.entries === 'object' ? raw.entries : {},
        touchedAt: Number.isFinite(raw.touchedAt) ? raw.touchedAt : null,
      };
    }
    return { entries: raw && typeof raw === 'object' ? raw : {}, touchedAt: null };
  } catch {
    return { entries: {}, touchedAt: null };
  }
}

/** Write the pending store in the v2 envelope, stamping this reconcile's
 *  touch time. Failures are swallowed (entries re-infer from fresh
 *  evidence when the note is next observed — the store's standing rule). */
export function writePendingNoteDeletions(entries, nowMs = Date.now(), storage = globalThis.localStorage) {
  try {
    storage.setItem(PENDING_NOTE_DELETIONS_KEY, JSON.stringify({ v: 2, touchedAt: nowMs, entries: entries || {} }));
  } catch { /* re-inferred when the note is next observed */ }
}

/**
 * The guard itself, pure: entries pass through unchanged while continuity
 * held (a recent touch), and every entry's clock RESTARTS (pendedAt → now)
 * when the reconcile gap exceeds the bound or is unknown (null touchedAt —
 * a fresh install, a v1 migration). "90 seconds of absence" is only
 * evidence while something was watching for the id to reappear; across a
 * gap, absence must be re-established, never assumed. Restarting is
 * conservative by construction — it can only delay a commit, never cause
 * one.
 *
 * @param {Record<string, {noteDate, deletedAt, pendedAt?: number}>} entries
 * @param {number|null} touchedAt  when reconcile last ran (null = unknown)
 * @param {number} [nowMs]
 * @returns {Record<string, {noteDate, deletedAt, pendedAt: number}>}
 */
export function applyPendingContinuityGuard(entries, touchedAt, nowMs = Date.now()) {
  const src = entries && typeof entries === 'object' ? entries : {};
  if (Object.keys(src).length === 0) return src;
  const continuous = Number.isFinite(touchedAt) && nowMs - touchedAt <= PENDING_CONTINUITY_GAP_MS && nowMs >= touchedAt;
  if (continuous) return src;
  const out = {};
  for (const [id, e] of Object.entries(src)) {
    out[id] = { ...e, pendedAt: nowMs };
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
