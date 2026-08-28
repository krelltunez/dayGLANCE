// TWO-SIDED RETITLE POLICY (Phase 3 write-safety — the ownership decision).
//
// A tagged task's title can be edited in dayGLANCE and in Obsidian between
// syncs. Three strings decide what happened:
//
//   base   — existing.obsidianRawTitle: the vault line at our last successful
//            observation (write-success commit or scan; #1459 made it honest)
//   theirs — the raw title parsed from the vault line NOW
//   ours   — the app title, stripped of the ' #obsidian' display tag
//
// One-sided changes need no policy: theirs ≠ base alone is an Obsidian
// retitle (vault wins, silently — vaultTitleWins, unchanged); ours ≠ base
// alone is a pending dayGLANCE rename (written back normally). TWO-SIDED —
// both differ from base, and from each other — is the conflict:
//
//   THE VAULT WINS THE TITLE; the dayGLANCE rename is PRESERVED as a durable
//   record on the task (task.notes), plus a fire-and-forget neutral toast.
//
// Why this shape (recorded so it isn't relitigated):
//   • A conflict is a ONE-SHOT EVENT, not a persisting condition — nothing
//     broke, nothing retries, no recovery to await. So the #1462 error latch
//     is the wrong channel: latched, a notice either evaporates before the
//     user looks or squats on the error state blocking real failures — and
//     it shouldn't be red at all, since nothing failed. The durable record
//     belongs ON THE TASK, where the user will be looking when they notice
//     the title isn't what they typed: task.notes lights the card's notes
//     button, syncs fleet-wide, and holds the lost text for copy-paste.
//   • "Vault wins, made visible" alone (option 1) would still want somewhere
//     durable for the old title — at which point it is this policy.
//   • Timestamp LWW (option 4) was rejected as built on sand: there is no
//     per-line vault edit time, file mtime on a synced vault reflects
//     OBSIDIAN SYNC DELIVERY rather than edit time, and clock skew applies —
//     it would resolve confidently and sometimes wrongly.
//   • Reverting the vault (option 3) and conflict UI (option 6) were
//     rejected as hostile and wrong-cost/benefit respectively.
//
// The write-time guard (updateTaskLines' bareTitle-vs-base comparison)
// funnels the write-first interleaving into this same policy: on mismatch it
// writes the state change, keeps the LINE's own title, and the caller skips
// the titleUpdate commit — so obsidianRawTitle stays truthful as the merge
// base and the next scan sees a clean two-sided divergence. One policy point.
//
// The notes append must never itself reach the vault: task.notes is app-only
// (never part of the daily-note line format) and is not in the writeback's
// change-detection snapshot, so preserving the rename cannot trigger a write.

/** The ' #obsidian' display tag the app appends; mirror of the writeback's strip. */
export function stripObsidianDisplayTag(title) {
  return String(title ?? '').replace(/\s*#obsidian\b/gi, '').trim();
}

/**
 * The three-string comparison. `base` undefined (no prior observation) can
 * never be a conflict; identical ours/theirs is a convergent edit, not a
 * conflict (both sides typed the same thing — nothing is lost).
 */
export function detectTwoSidedRetitle({ base, theirs, ours }) {
  if (base === undefined || base === null) return false;
  return theirs !== base && ours !== base && ours !== theirs;
}

// Idempotence key: everything before the date. Deliberately locale-free and
// deterministic so N devices racing through their scans produce the SAME
// line and the guard below collapses them — the same unanimity trick as
// deterministic block ids, applied to prose.
const conflictKey = (dgTitle) => `Renamed in dayGLANCE to "${dgTitle}"`;

/**
 * Append the durable conflict record to a notes string, once. Returns the
 * original string (same reference) when the record for this rename is
 * already present — the guard that keeps N devices' scans, and repeated
 * scans on one device, from stacking duplicates.
 */
export function appendTitleConflictNote(notes, dgTitle, dateIso) {
  const existing = typeof notes === 'string' ? notes : '';
  const key = conflictKey(dgTitle);
  if (existing.includes(key)) return notes;
  const line = `${key} — Obsidian's edit won (${dateIso}).`;
  return existing ? `${existing}\n${line}` : line;
}

/** The fire-and-forget toast text (neutral, never red, never latched). */
export function titleConflictNoticeText(vaultTitle) {
  return `Title conflict: Obsidian's edit "${vaultTitle}" won. Your dayGLANCE rename is saved in the task's notes.`;
}
