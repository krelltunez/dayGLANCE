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
// STAMPING PASSTHROUGH (2026-08-31 config-null incident): an active plugin's
// heartbeat now carries its normalize-then-observe arming tri-state —
// 'armed' / 'off' / 'no-config' — and 'no-config' is the state that was
// invisible while the fragment factory ran: the plugin held no config row,
// so (pre-fix) it reported daily notes UNSTAMPED, and nothing on any screen
// said so. Post-fix the plugin holds daily-note reporting instead (fail
// closed), and this passthrough is what lets the panel say "paused, waiting
// for configuration" rather than looking healthy. Only an ACTIVE plugin's
// claim is surfaced; null = unknown (stale beat, or a pre-field build).
//
// @param {{obsidianRunning: boolean, pluginAuthoritative: boolean, stamping?: string|null}|null} hb
//   obsidianHeartbeatState(...) of this device's heartbeat read
// @param {{pairedAt?: string}|null} meta  the discovered meta:pairing row
//   (null: vault unpaired, or unreachable/not yet fetched — callers treat
//   absence conservatively)
// @param {number} [nowMs]
// @returns {{ state: 'active'|'unpairedHere'|'notDetected', vaultPaired: boolean, pairedDays: number|null, stamping: 'armed'|'off'|'no-config'|null }}
export function deriveBridgeStatus(hb, meta, nowMs = Date.now()) {
  const t = meta?.pairedAt ? Date.parse(meta.pairedAt) : NaN;
  const pairedDays = Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86400000)) : null;
  const vaultPaired = !!meta;
  if (hb?.pluginAuthoritative) return { state: 'active', vaultPaired, pairedDays, stamping: hb.stamping ?? null };
  if (hb?.obsidianRunning) return { state: 'unpairedHere', vaultPaired, pairedDays, stamping: null };
  return { state: 'notDetected', vaultPaired, pairedDays, stamping: null };
}
