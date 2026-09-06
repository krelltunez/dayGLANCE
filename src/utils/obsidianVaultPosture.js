// THE VAULT POSTURE — which side of the bridge this device is on, this cycle.
//
// Three postures, decided from two facts: this device's plugin heartbeat
// (obsidianHeartbeatState of the vault's `.dayglance/heartbeat`) and whether
// the VAULT is paired at all (the discovered meta:pairing row — the stream
// exists).
//
//   'plugin'  — a fresh AND paired heartbeat: the plugin owns this vault
//               copy. Inbound is the observation stream; every write is an
//               intent. (§3.2, unchanged.)
//   'holding' — the vault is paired but this device's heartbeat is stale or
//               missing: Obsidian is not running here. THE 2026-09-06
//               POSTURE RULING: the device neither scans nor writes the
//               vault. It keeps reading the stream, so tasks continue to
//               sync, its writes queue as intents exactly as in plugin
//               mode, and the settings status line says the vault side is
//               waiting on Obsidian.
//   'direct'  — the vault is not paired (no stream to fall back on): the
//               frozen direct-access tier, scan and direct writes, exactly
//               as before pairing existed. Also a plugin that is RUNNING
//               here but not paired here (the §3.2 lost-credentials middle
//               state): the heartbeat is fresh, so the copy is fresh, and
//               the status panel already flags the split for remediation.
//
// WHY 'holding' EXISTS (the reasoning, for the record): a device's vault
// copy is only fresh while Obsidian is running — Obsidian Sync does not run
// in the background on mobile, and not at all on a closed desktop. So a
// direct scan on a stale heartbeat was never reading current data; it was
// reading a snapshot from whenever Obsidian last had focus and treating it
// as authoritative. That looked like a capability and was a source of
// confidently wrong data: the day of the SSE re-arm, the Mac completed a
// task at 19:33:33, an Android with Obsidian backgrounded re-stamped its
// uncompleted copy at 19:36:55 from a stale line, and the fabricated
// timestamp won. The phantom re-stamp itself is fixed (the field carry by
// exclusion), but a stale copy still re-creates lines the fleet deleted and
// tombstones lines the fleet added — the 24-row resupply storm — and only
// this posture stops that. What is lost: nothing a user notices. Obsidian
// edits still reach dayGLANCE through the stream while Obsidian is open
// anywhere; dayGLANCE edits queue as intents and apply when Obsidian next
// opens, which is what mobile always did.
//
// The condition is "stale heartbeat", not "is a phone": the same rule
// everywhere, near-permanent on mobile and rare on desktop.
//
// UNPAIRED DEVICES (a deliberate answer, not an omission): an unpaired vault
// has the same stale-copy exposure and no alternative path — nothing
// reports notes and nothing applies intents. It keeps today's behavior:
// the direct tier is frozen at feature-complete (§3.9, companion spec
// scope), and a device that scans its own copy is at least converging on
// what it has; holding it would stop Obsidian sync on that device entirely
// for no gain. The remedy for an unpaired stale copy is pairing.

/**
 * @param {{obsidianRunning?: boolean, pluginAuthoritative?: boolean}|null} heartbeat
 *   obsidianHeartbeatState(...) of this device's heartbeat read
 * @param {boolean} vaultPaired  the discovered meta:pairing row is present
 * @returns {'plugin'|'holding'|'direct'}
 */
export function vaultPosture({ heartbeat, vaultPaired }) {
  if (heartbeat?.pluginAuthoritative) return 'plugin';
  if (vaultPaired && !heartbeat?.obsidianRunning) return 'holding';
  return 'direct';
}

/**
 * Is this device on the STREAM side (observations in, intents out)? Reads
 * the posture the sync cycle recorded on the heartbeat ref; a ref that
 * carries no posture yet (before the first cycle, or a test fixture) falls
 * back to the heartbeat's own authority claim, which is the pre-ruling rule.
 */
export function isStreamPosture(hbState) {
  if (hbState && typeof hbState.vaultPosture === 'string') return hbState.vaultPosture !== 'direct';
  return !!hbState?.pluginAuthoritative;
}
