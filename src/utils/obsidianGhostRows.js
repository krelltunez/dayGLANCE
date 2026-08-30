// GHOST-ROW CONTAINMENT — recognizing and redirecting duplicate rows whose
// pairing to a live successor can be DERIVED from the rows themselves. Two
// recognizers share the cure (derived retirement + the standard supersede):
// the token ghosts an OLD client mints from a stamped line (below), and the
// stamped orphans the pre-general-rule plugin mode left behind (recognizer
// #2, in containObsidianGhostRows). Runs at every sync ingress and at boot,
// so containment is idempotent and needs no one-shot migration.
//
// THE CORRUPTION IS SELF-IDENTIFYING. A pre-block-id client parses
// `- [ ] Buy milk ^dg-k3x9q2mf` with no block-ref awareness: the token becomes
// TITLE TEXT, the mangled title hashes into a brand-new content-derived id,
// and the result is a "ghost" task row — `obsidian-<date>-<hash>` with a title
// that literally ends in `^dg-<id>` — which syncs fleet-wide as a duplicate of
// the real `obsidian-dg-<id>` task. But that embedded token IS the successor's
// identity: the ghost carries the pointer to the task it duplicates, so a
// current client can derive the retirement from the corruption itself — no
// coordination, no capability negotiation, no server change.
//
// ★ THIS IS CONTAINMENT, NOT PREVENTION. The old client that minted the ghost
// keeps showing its local duplicate until it updates — nothing here reaches
// into an old build. What containment buys: the ghost stops PROPAGATING (every
// current client refuses or redirects it at the sync ingresses, and the
// derived retirement propagates the delete so the vault row dies), and the
// minting device SELF-REPAIRS the moment it updates (its first apply runs this
// same containment over its own state). Do not mistake this module for a fix
// for old clients; the fix for old clients is updating them.
//
// RECOGNITION (precision over recall — a false negative leaves a recoverable
// duplicate; a false positive eats a real task). A row is a ghost only when
// ALL of these hold:
//   1. importSource === 'obsidian' — only vault-derived rows qualify;
//   2. no obsidianBlockId — a properly-adopted row is never a ghost;
//   3. obsidianRawTitle is a string ending in ` ^dg-<8 chars of [a-z0-9]>` —
//      the exact emitted token shape, at end of line, exactly where the old
//      parser would have swallowed it;
//   4. the row's id EQUALS the legacy content-derived id of that mangled
//      title (`obsidian-<date>-<simpleHash(rawTitle)>`, date taken from the
//      id itself) — proving the row was MINTED BY the legacy parser from
//      exactly this text, not typed by a person into some other identity;
//   5. the successor the token names (`obsidian-dg-<id>`) is LIVE in the
//      current task lists — the retirement rule's own conservatism, reused:
//      with no live successor the record authorizes nothing and the row is
//      left alone.
// A legitimate title that merely contains token-LIKE text (someone writing
// about block ids, a test line "Test three ^dg-testtest") fails 5 unless the
// 8-char string coincides with a real live block id — and fails 4 as well
// unless the row is also an untagged vault import of exactly that text. The
// conjunction is the confidence.
//
// ACTION: the ghost's title is sanitized (the swallowed token stripped) and
// the row is fed through the SAME successor-aware supersede the retirement
// record uses (utils/retiredTaskIds.js applyTaskRetirements): dropped when
// older than the successor, its content REDIRECTED onto the successor when
// newer (an edit the user made on the old client — a completion, a
// reschedule — survives on the real task). applyEngineData additionally
// PERSISTS the derived retirement into retiredTaskIds (+ the deletedTaskIds
// dual-write shim), so the push guard propagates the ghost's delete
// ('retired'), the vault row dies instead of echoing, and the old client's
// own payload filter (dropResurrectedTasks) stops re-uploading it.

import { legacyObsidianId, appIdForBlockId } from '../obsidian.js';
import {
  applyTaskRetirements,
  recordRetirements,
  readRetiredTaskIds,
  RETIRED_TASK_IDS_STORAGE_KEY,
  RETIRED_ID_DUAL_WRITE,
} from './retiredTaskIds.js';

// The exact emitted token, at end of string: space, ^dg-, 8 chars of lowercase
// base36 (deriveBlockId's alphabet), nothing after.
export const GHOST_TOKEN_RE = /\s\^dg-([a-z0-9]{8})$/;

// Strip ONE SPECIFIC recognized token from a title. The app-level title
// carries the mangled raw title plus the ' #obsidian' display tag, so the
// token sits before the tag rather than at end-of-string — target the exact
// token we recognized (never a general pattern), wherever it appears as a
// standalone word.
const stripSpecificToken = (s, blockId) =>
  (typeof s === 'string' ? s.replace(new RegExp(`\\s\\^dg-${blockId}(?=\\s|$)`), '') : s);

/**
 * Recognition rules 1–4: is this row a legacy-parser mint of a stamped line?
 * Returns the successor app id (`obsidian-dg-<id>`) or null. Rule 5 (the
 * successor must be LIVE) is the caller's — it needs the cross-list id set.
 */
export function ghostSuccessorId(task) {
  if (!task || task.importSource !== 'obsidian') return null;     // 1
  if (task.obsidianBlockId) return null;                          // 2
  const raw = task.obsidianRawTitle;
  if (typeof raw !== 'string') return null;
  const m = raw.match(GHOST_TOKEN_RE);
  if (!m) return null;                                            // 3
  const dateMatch = /^obsidian-(\d{4}-\d{2}-\d{2})-/.exec(String(task.id));
  if (!dateMatch) return null;
  if (String(task.id) !== legacyObsidianId(dateMatch[1], raw)) return null; // 4
  return appIdForBlockId(m[1]);
}

/**
 * Contain ghost rows across a { tasks, unscheduledTasks } pair.
 *
 * Ghosts whose successor is live (rule 5, checked across BOTH lists) are
 * sanitized (token stripped from the title fields) and superseded via
 * applyTaskRetirements — drop, or redirect-if-newer onto the successor. A
 * ghost with no live successor, and any non-ghost, passes through untouched.
 * Returns the SAME arrays when nothing changed (no diff churn), plus the
 * derived retirement entries ({ghostId → successorId}) so applyEngineData can
 * persist them into the retirement record.
 */
export function containObsidianGhostRows({ tasks, unscheduledTasks }) {
  const t = Array.isArray(tasks) ? tasks : [];
  const u = Array.isArray(unscheduledTasks) ? unscheduledTasks : [];
  const liveIds = new Set([...t, ...u].filter(Boolean).map((x) => String(x.id)));

  // Rules 1–5 → the derived retirement record (ephemeral; the caller decides
  // whether to persist it).
  const derived = {};
  for (const row of [...t, ...u]) {
    const succ = ghostSuccessorId(row);
    if (succ && liveIds.has(succ)) derived[String(row.id)] = succ;
  }

  // ── RECOGNIZER #2: STAMPED ORPHANS (the schedule-while-paired duplicate,
  // 2026-08-30). A different corruption with the same cure: a plugin-mode
  // write stamped an untagged line (the opportunistic block id — an identity
  // move) before the gate (a) general rule existed, so no retirement was
  // recorded; the legacy copy then survived every merge drop because the
  // snapshot-delete guard — correctly — healed an unexplained vanish back
  // from the vault. The pair is derivable with the same precision-over-
  // recall discipline as the token ghosts, ALL of these holding:
  //   1. the orphan is an obsidian import with NO obsidianBlockId;
  //   2. a live TAGGED row's parse-attached obsidianLegacyId — recomputed
  //      from the CURRENT vault line every scan — names the orphan's id
  //      exactly: the line that would have minted the orphan now carries
  //      that row's token;
  //   3. exactly ONE such claimant (two rows advertising the same hint is
  //      ambiguity → leave the pair alone rather than guess);
  //   4. the orphan's id equals the legacy derivation of its own recorded
  //      raw title (proving it was MINTED by the legacy parser from exactly
  //      this line, not typed into some other identity);
  //   5. the successor is live (shared with the token rules — with no live
  //      successor the record authorizes nothing).
  // Anything failing any rule passes through untouched. The supersede and
  // the redirect-if-newer are the retirement machinery's own — no new
  // what-wins rule; an edit made on the orphan copy survives on the
  // successor.
  const byLegacyHint = new Map(); // hint → successor id, or null when ambiguous
  for (const row of [...t, ...u]) {
    if (!row || !row.obsidianBlockId || !row.obsidianLegacyId) continue;
    const hint = String(row.obsidianLegacyId);
    byLegacyHint.set(hint, byLegacyHint.has(hint) ? null : String(row.id));
  }
  for (const row of [...t, ...u]) {
    if (!row || row.importSource !== 'obsidian' || row.obsidianBlockId) continue;
    const id = String(row.id);
    if (derived[id]) continue; // already recognized as a token ghost
    const succ = byLegacyHint.get(id);
    if (!succ) continue; // no claimant, or an ambiguous one (null)
    const dateMatch = /^obsidian-(\d{4}-\d{2}-\d{2})-/.exec(id);
    if (!dateMatch) continue;
    if (typeof row.obsidianRawTitle !== 'string') continue;
    if (id !== legacyObsidianId(dateMatch[1], row.obsidianRawTitle)) continue;
    if (!liveIds.has(succ)) continue;
    derived[id] = succ;
  }

  if (Object.keys(derived).length === 0) return { tasks: t, unscheduledTasks: u, derived };

  // Sanitize the ghosts before the supersede: the swallowed token is
  // CORRUPTION, not content — a newer ghost's redirect must not carry it onto
  // the successor's title. (obsidianRawTitle is an identity field the
  // redirect keeps from the successor, so only `title` needs cleaning.)
  const sanitize = (list) => list.map((row) => {
    const succ = row && derived[String(row.id)];
    if (!succ) return row;
    const blockId = succ.slice('obsidian-dg-'.length);
    return { ...row, title: stripSpecificToken(row.title, blockId) };
  });

  // Reuse the retirement supersede verbatim: same live-successor conservatism,
  // same redirect-if-newer, same identity-field preservation. retiredAt is
  // synthetic (the supersede itself never reads it; validity only).
  const record = {};
  for (const [ghostId, succ] of Object.entries(derived)) {
    record[ghostId] = { retiredAt: new Date(0).toISOString(), successor: succ };
  }
  return {
    tasks: applyTaskRetirements(sanitize(t), record, liveIds),
    unscheduledTasks: applyTaskRetirements(sanitize(u), record, liveIds),
    derived,
  };
}

/**
 * Boot-time self-repair, for loadData: contain ghosts already sitting in the
 * PERSISTED task lists — the just-updated minting device's own duplicates.
 * The sync ingresses only run when something syncs; a local-only install
 * would otherwise never repair. Pass persist:false for the tray popup, which
 * must never write localStorage (its state is a read snapshot).
 */
export function repairLoadedGhostRows(tasks, unscheduledTasks, { persist = true } = {}) {
  const contained = containObsidianGhostRows({ tasks, unscheduledTasks });
  if (persist) persistDerivedGhostRetirements(contained.derived);
  return { tasks: contained.tasks, unscheduledTasks: contained.unscheduledTasks };
}

/**
 * Persist derived ghost retirements ({ghostId → successorId}) into the REAL
 * retirement record (+ the deletedTaskIds dual-write shim, exactly like the
 * write-commit's own retirements). This is what makes containment CONVERGE
 * instead of loop: the push guard propagates the ghost's vanish as 'retired'
 * so the vault row dies, and the minting old client's payload filter
 * (dropResurrectedTasks) stops re-uploading its copy once the tombstone
 * syncs. Provenance holds: this writer KNOWS the successor — it derived it
 * from the corruption itself.
 */
export function persistDerivedGhostRetirements(derived) {
  const ghostIds = Object.keys(derived || {});
  if (ghostIds.length === 0) return;
  const nowIso = new Date().toISOString();
  try {
    let rec = readRetiredTaskIds();
    for (const ghostId of ghostIds) rec = recordRetirements(rec, [ghostId], derived[ghostId], nowIso);
    localStorage.setItem(RETIRED_TASK_IDS_STORAGE_KEY, JSON.stringify(rec));
  } catch { /* storage unavailable — the ingress drops still contain locally */ }
  if (RETIRED_ID_DUAL_WRITE) {
    try {
      const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}');
      for (const ghostId of ghostIds) tombstones[String(ghostId)] = nowIso;
      localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(tombstones));
    } catch { /* ditto */ }
  }
}
