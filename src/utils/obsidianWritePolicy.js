// The Phase 2 READ/WRITE release split — the vault write-format gate.
//
// ═══ THE WRITE-RELEASE SWITCH ══════════════════════════════════════════════
// This ONE constant is the write release. Nothing else changes on a flip.
// Grep anchor: OBSIDIAN_BLOCK_ID_WRITES.
export const OBSIDIAN_BLOCK_ID_WRITES = true;
// ═══════════════════════════════════════════════════════════════════════════
//
// THE STANDING RULE (docs/obsidian-buildout-spec.md, "Staged vault-format
// rollout"): any change to what dayGLANCE WRITES into the vault ships as
// read-support first, write-support one release later. The fleet spans five
// platforms on three release channels whose store approvals never align, plus
// always-on appliances that lag behind — so every write-format change has a
// mixed-version window. A client that does not understand a format token
// reads it as TITLE TEXT, hashes it into a brand-new content-derived id, and
// imports a duplicate that syncs fleet-wide (the staged-rollout analysis, and
// the live incident of 2026-08-26: stable duplicates for the whole mixed
// window, surviving the update in the heavy-stamp case).
//
// WHAT READ-FIRST ACTUALLY BUYS — an ordering discipline, NOT a guarantee.
// Release ordering cannot be enforced: a Docker user pulls `latest` after six
// months and skips every intermediate release, so "once the read release has
// propagated" is a state no one can observe and no sequencing can produce.
// Read-first MAXIMIZES the share of the fleet that understands a format
// before anything emits it; it guarantees nothing about the stragglers.
// The fleet-readiness gate that WOULD guarantee it (per-account capability
// bundle, a GLANCEvault devices endpoint, cursor cross-referencing) was
// investigated and deliberately NOT built: substantial permanent server+client
// surface for a solo maintainer, to close a gap that ghost-row containment
// (utils/obsidianGhostRows.js, PR #1457) reduces to a temporary inconvenience.
// What we accept instead: an old client reading a stamped vault mints local
// duplicates it shows to its OWN user until it updates. Those duplicates no
// longer propagate to current clients — every sync ingress and boot-time load
// contains them, the derived retirement kills the vault ghost row — and the
// minting device self-repairs the moment it updates. Bounded, temporary,
// self-healing; that is the basis on which this constant reads `true`.
//
// WHY THE READER IS THE FULL PHASE 2 READ PATH, not merely "strip and
// ignore": a device that strips `^dg-` tokens but still hashes the clean
// title into a legacy id keeps RE-PRODUCING legacy ids after a write-release
// device retires them — a milder seed of the same war. The read release
// therefore carries token recognition, dg-id adoption, the legacy bridge
// hint, first-occurrence-wins dedup — everything except EMITTING. Tokens
// already present in a line are always PRESERVED on rewrite (stripping them
// would destroy identity other devices rely on); the gate only stops the
// creation of NEW ones.
//
// WHAT THE GATE COVERS — the only two emit sites in the codebase:
//   • the opportunistic stamp on write (useObsidianSync's writeback:
//     assignBlockId), and
//   • creation-time identity for new vault-bound tasks
//     (obsidian.js buildNewObsidianTaskMeta).
// Everything downstream (blockIdSuffix, updateTaskLines, the append path)
// emits a token only when handed a block id, so gating id GENERATION gates
// the entire write surface.
//
// Deliberately a BUILD-TIME CONSTANT, not a user-facing setting and not a
// version handshake: a setting pushes correctness onto the user (someone
// always has a device they forgot about), and release channels are the
// natural vehicle — the write release simply is the build where this reads
// `true`.

let testOverride = null;

/** The live gate the emit sites consult. */
export function blockIdWritesEnabled() {
  return testOverride ?? OBSIDIAN_BLOCK_ID_WRITES;
}

/**
 * TESTS ONLY: force the gate on/off (pass null to restore the constant).
 * Write-release behavior (stamping, id migration, retirement recording) is
 * tested with the override on; read-release behavior with it off/default.
 */
export function __setBlockIdWritesForTests(v) {
  testOverride = v;
}
