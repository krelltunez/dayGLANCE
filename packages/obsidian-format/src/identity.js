// Line identity: ^dg- block ids (deterministic derivation, frozen), the
// legacy content-derived id, and the block-reference split/suffix helpers.
// Moved verbatim from dayGLANCE src/obsidian.js — format, never policy.

export function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ---------------------------------------------------------------------------
// Block-ID identity (Obsidian build-out Phase 2)
//
// Task lines dayGLANCE writes carry a trailing `^dg-<id>` Obsidian block
// reference — native syntax, invisible in reading view, survives edits and
// reordering. The id is generated at write time, persisted on the task as
// `obsidianBlockId`, and embedded in the line itself, so every device that
// scans the vault derives the same durable identity from the file — unlike
// the legacy content-derived id (date + title hash), which changes whenever
// the title or date does. Matching is ID-first with fallback to the legacy
// text matching for lines that carry no id; existing untagged lines acquire
// ids opportunistically as they get rewritten. No sweep, no flag day.
// ---------------------------------------------------------------------------

/**
 * DERIVE a block id: 8 chars of lowercase base36, a pure function of the
 * line's stable identity — (daily-note date, raw title), the same inputs the
 * legacy content id hashes.
 *
 * WHY DERIVED, NOT RANDOM (the echo-stamp decision): with random minting, an
 * edit that reaches the fleet under the LEGACY id (it originated on a device
 * without vault access, or a vault device's write failed before its rename
 * committed) makes every vault-capable device mint its own token for the same
 * line — an N-way identity race that converges only through retirement
 * records, detector reaping, and Obsidian Sync settling the file, with one
 * no-heal corner (a mint whose device closes before ever scanning it lingers
 * as a permanent duplicate row). Deriving the token makes the race
 * semantically empty: every device mints the SAME token, so an N-way mint is
 * N devices writing an identical line — nothing to reconcile, nothing to
 * reap. One logical edit produces one token by UNANIMITY rather than
 * election.
 *
 * NORMALIZATION (pinned deliberately — a subtle cross-device difference here
 * silently restores the old race): the hash input is
 *     `${dateStr}\u0000${String(rawTitle).normalize('NFC').trim()}`
 *   • dateStr — the ISO `YYYY-MM-DD` the write targets (the daily note's
 *     date, exactly the string used in legacy ids and filenames);
 *   • rawTitle — the title AS IT WILL EXIST ON THE LINE (for a retitling
 *     write, the NEW raw title), NFC-normalized (macOS/iOS text input can
 *     produce decomposed forms) and trimmed; internal whitespace is
 *     PRESERVED (titles differing inside are different lines);
 *   • the display '#obsidian' tag never appears in rawTitle by construction;
 *   • NUL separator so ('2026-08-281', 'x') can't alias ('2026-08-28', '1x').
 *
 * ★ FROZEN ALGORITHM: FNV-1a 64-bit over the UTF-8 bytes, mod 36^8, base36,
 * zero-padded to 8. Tokens derived by different app VERSIONS must agree
 * forever — changing any detail here (hash, seed, input shape) reintroduces
 * cross-device divergence between updated and un-updated devices. The golden
 * values in identity.test.js (beside this file) pin it.
 *
 * Collision profile: same inputs as the legacy id, so colliding pairs are
 * exactly the pairs that already collide today, governed by the existing
 * first-occurrence-wins rule; 36^8 ≈ 2.8e12 makes unrelated collisions
 * vanishingly unlikely at vault scale.
 */
export function deriveBlockId(dateStr, rawTitle) {
  const input = `${dateStr}\u0000${String(rawTitle ?? '').normalize('NFC').trim()}`;
  let h = 0xcbf29ce484222325n; // FNV-1a 64-bit offset basis
  for (const byte of new TextEncoder().encode(input)) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn; // FNV prime, mod 2^64
  }
  return (h % 2821109907456n).toString(36).padStart(8, '0'); // 36^8
}

export function appIdForBlockId(blockId) {
  return `obsidian-dg-${blockId}`;
}

/** The legacy content-derived id for an untagged line (and pre-Phase-2 tasks). */
export function legacyObsidianId(taskDate, rawTitle) {
  return `obsidian-${taskDate}-${simpleHash(rawTitle)}`;
}

const DG_BLOCK_ID_RE = /\s+\^dg-([a-z0-9]+)\s*$/;

/**
 * Split a trailing ` ^dg-<id>` block reference off a task-line body.
 * Only dayGLANCE's own `^dg-` ids are recognised; a user's own block
 * reference (e.g. `^quote1`) stays part of the title, exactly as today.
 * A `^` anywhere else in the title is untouched.
 * @returns {{ text: string, blockId: string|null }}
 */
export function splitBlockId(text) {
  const m = DG_BLOCK_ID_RE.exec(text);
  if (!m) return { text, blockId: null };
  return { text: text.slice(0, m.index), blockId: m[1] };
}

// Obsidian allows exactly one block reference per line, at end of line. A line
// whose title already ends in a user-authored block id must never get a ^dg-
// suffix appended — the appended id would become the line's block id and break
// the user's existing block links.
const FOREIGN_BLOCK_ID_RE = /(^|\s)\^[A-Za-z0-9-]+$/;
export function hasForeignBlockId(text) {
  return FOREIGN_BLOCK_ID_RE.test(String(text).trimEnd());
}

/**
 * The ` ^dg-<id>` suffix for a written task line, or '' when there is no id to
 * write or the title carries a user-authored block reference (see above).
 */
export function blockIdSuffix(blockId, writtenTitle) {
  if (!blockId || hasForeignBlockId(writtenTitle)) return '';
  return ` ^dg-${blockId}`;
}
