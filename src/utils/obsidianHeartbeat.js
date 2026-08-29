// BRIDGE-PLUGIN HEARTBEAT (Obsidian build-out Phase 5 — spec §3.3, §6).
//
// The dayglance-bridge Obsidian plugin writes `.dayglance/heartbeat` every
// 30 seconds while Obsidian has the vault open:
//   {"paired": bool, "accountId": string|null, "deviceId": string, "ts": ISO}
// dayGLANCE reads it for two things:
//   • LAUNCH-ON-WRITE SUPPRESSION — a fresh heartbeat means Obsidian is
//     already running, so the Phase 1 wake (desktop obsidian:// launch,
//     Android arm/notification) is redundant. The platform layers that own
//     the launches do their own freshness reads at fire/arm time
//     (electron/obsidian.ts, Android ObsidianRepository) — this module is
//     the shared semantics they mirror.
//   • ARBITRATION STATE (spec §3.2) — `paired` is always false in Phase 5
//     (no GLANCEvault client exists yet); the plumbing ships now so Phase 6
//     only changes the decision, not the wiring. A fresh AND paired
//     heartbeat will mean "the plugin owns this vault; do not write
//     directly."
//
// STALENESS: 5 minutes — comfortably longer than an Obsidian restart
// (seconds) and ten missed 30-second beats, per §3.3's "minutes rather than
// seconds". MISSING, STALE, AND MALFORMED ARE TREATED IDENTICALLY: the
// revert path must be one path. A backgrounded Obsidian mobile app stops
// beating (WebView timers freeze) and correctly goes stale — a backgrounded
// Obsidian isn't syncing, so it isn't "running" for either purpose.
//
// THIRD-PARTY FILE SYNC CAVEAT (recorded — this is why the false positive
// is benign, not why it can't happen): Obsidian Sync ignores hidden
// dot-paths, so the heartbeat is genuinely per-device there. A vault synced
// by iCloud Drive / Syncthing / Dropbox WILL carry device A's heartbeat to
// device B, where a fresh-looking beat suppresses B's launch-on-write. But
// launch-on-write exists to wake OBSIDIAN SYNC — on a third-party-synced
// vault the launch was pointless to begin with (the file syncer moves bytes
// whether or not Obsidian runs), so the suppression costs nothing that
// mattered. Arbitration (Phase 6) keys on `paired` + per-device pairing
// state, not freshness alone.

export const OBSIDIAN_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/**
 * Parse a heartbeat file's text. Returns the payload object or null for
 * anything unusable (malformed JSON, missing/unparseable ts) — callers
 * treat null exactly like a missing file.
 */
export function parseObsidianHeartbeat(text) {
  if (typeof text !== 'string' || text === '') return null;
  try {
    const hb = JSON.parse(text);
    if (!hb || typeof hb !== 'object') return null;
    const tsMs = new Date(hb.ts).getTime();
    if (!Number.isFinite(tsMs)) return null;
    return {
      paired: hb.paired === true,
      accountId: typeof hb.accountId === 'string' ? hb.accountId : null,
      deviceId: typeof hb.deviceId === 'string' ? hb.deviceId : null,
      tsMs,
    };
  } catch {
    return null;
  }
}

/**
 * The one decision helper both consumers share:
 *   obsidianRunning   — a beat exists and is fresh (suppress launch-on-write)
 *   pluginAuthoritative — fresh AND paired (Phase 6: stop writing directly).
 * Missing (null), stale, and malformed all collapse to the same answer.
 */
export function obsidianHeartbeatState(heartbeat, nowMs = Date.now()) {
  const fresh = !!heartbeat
    && heartbeat.tsMs <= nowMs + OBSIDIAN_HEARTBEAT_STALE_MS // tolerate small clock skew, refuse far-future
    && nowMs - heartbeat.tsMs < OBSIDIAN_HEARTBEAT_STALE_MS;
  return {
    obsidianRunning: fresh,
    pluginAuthoritative: fresh && heartbeat.paired === true,
  };
}
