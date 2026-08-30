// Bridge status derivation — the three-state indicator's one decision,
// pure so it can be pinned (the settings components are untested DOM).
//
// THE MIDDLE STATE IS THE POINT (field incident, 2026-08-31): per-vault
// pairing travels in the plugin's data.json, which reaches a device only
// through Obsidian Sync's community-plugin-settings sync — a
// user-toggleable setting that can flip without notice. When it does, that
// device's plugin beats `paired: false`, the device silently falls back to
// direct mode, and the fleet splits between modes with no UI saying so.
// Distinguishing "plugin running but NOT paired here" from "no plugin" is
// what makes that split legible without opening Obsidian on each device;
// pairing-meta presence further splits it into "the vault IS paired — this
// device's plugin lost its credentials (check Obsidian Sync's plugin
// settings sync)" versus "the vault was never paired". Recorded beside the
// per-vault granularity ruling in spec §3.2.
//
// @param {{obsidianRunning: boolean, pluginAuthoritative: boolean}|null} hb
//   obsidianHeartbeatState(...) of this device's heartbeat read
// @param {{pairedAt?: string}|null} meta  the discovered meta:pairing row
//   (null: vault unpaired, or unreachable/not yet fetched — callers treat
//   absence conservatively)
// @param {number} [nowMs]
// @returns {{ state: 'active'|'unpairedHere'|'notDetected', vaultPaired: boolean, pairedDays: number|null }}
export function deriveBridgeStatus(hb, meta, nowMs = Date.now()) {
  const t = meta?.pairedAt ? Date.parse(meta.pairedAt) : NaN;
  const pairedDays = Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86400000)) : null;
  const vaultPaired = !!meta;
  if (hb?.pluginAuthoritative) return { state: 'active', vaultPaired, pairedDays };
  if (hb?.obsidianRunning) return { state: 'unpairedHere', vaultPaired, pairedDays };
  return { state: 'notDetected', vaultPaired, pairedDays };
}
