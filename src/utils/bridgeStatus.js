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
// THE WAITING STATE (the 2026-09-06 posture ruling; utils/obsidianVaultPosture.js
// 'holding'): the vault IS paired and this device's heartbeat is stale or
// missing — Obsidian is not running here. The device is on the stream side
// (tasks keep syncing, its writes queue as intents) and does NOT scan or
// write its own vault copy, which Obsidian is not refreshing. This is the
// normal resting state of every phone, so its copy must read as "fine,
// waiting", never as a fault: the panel says vault changes will apply the
// next time Obsidian runs on this device, and when the last beat's time is
// known, how long ago that was. `lastBeatMs` is the raw beat's timestamp
// (the state helper drops it; callers pass it alongside).
//
// @param {{obsidianRunning: boolean, pluginAuthoritative: boolean, stamping?: string|null, lastBeatMs?: number|null}|null} hb
//   obsidianHeartbeatState(...) of this device's heartbeat read
// @param {{pairedAt?: string}|null} meta  the discovered meta:pairing row
//   (null: vault unpaired, or unreachable/not yet fetched — callers treat
//   absence conservatively)
// @param {number} [nowMs]
// @returns {{ state: 'active'|'unpairedHere'|'waiting'|'notDetected', vaultPaired: boolean, pairedDays: number|null, stamping: 'armed'|'off'|'no-config'|null, lastBeatMs: number|null }}
export function deriveBridgeStatus(hb, meta, nowMs = Date.now()) {
  const t = meta?.pairedAt ? Date.parse(meta.pairedAt) : NaN;
  const pairedDays = Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / 86400000)) : null;
  const vaultPaired = !!meta;
  const lastBeatMs = Number.isFinite(hb?.lastBeatMs) ? hb.lastBeatMs : null;
  if (hb?.pluginAuthoritative) return { state: 'active', vaultPaired, pairedDays, stamping: hb.stamping ?? null, lastBeatMs };
  if (hb?.obsidianRunning) return { state: 'unpairedHere', vaultPaired, pairedDays, stamping: null, lastBeatMs };
  if (vaultPaired) return { state: 'waiting', vaultPaired, pairedDays, stamping: null, lastBeatMs };
  return { state: 'notDetected', vaultPaired, pairedDays, stamping: null, lastBeatMs };
}

/**
 * "3 hours ago" for the waiting line, in the viewer's language. Coarse on
 * purpose (minutes, hours, days): the panel polls every ten seconds and a
 * seconds-grain figure would tick like a fault counter.
 */
export function describeAgo(thenMs, nowMs = Date.now(), locale = undefined) {
  const diffMs = Math.max(0, nowMs - thenMs);
  const rtf = typeof Intl !== 'undefined' && Intl.RelativeTimeFormat ? new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }) : null;
  const minutes = Math.round(diffMs / 60000);
  const hours = Math.round(diffMs / 3600000);
  const days = Math.round(diffMs / 86400000);
  const [value, unit] = days >= 2 ? [-days, 'day'] : hours >= 2 ? [-hours, 'hour'] : [-minutes, 'minute'];
  if (rtf) return rtf.format(value, unit);
  const n = Math.abs(value);
  return n === 0 ? 'just now' : `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}
