// GLANCEvault DB INTENTS config + enablement gate.
//
// This is the app-owned DB intents transport's config. It is deliberately tiny:
// it carries only { enabled, ttlMs, pollIntervalMinutes }. The vault CONNECTION
// (vaultUrl, vaultToken, accountId) is NOT stored here — it is INHERITED from the
// GLANCEvault SYNC config (src/sync/vaultConfig.js), mirroring lastGLANCE where
// the DB intents config was just { enabled, ttlMs, pollIntervalMinutes } and the
// connection came from getVaultConfig().
//
// Gating is independent of BOTH:
//   - the WebDAV intents transport (dayglance-intent-config) — which stays the
//     default and fully intact, and
//   - the vault SYNC transport's own `enabled` flag — a user may run DB intents
//     without enabling DB sync, as long as a vault connection is configured.
//
// NOTE (this prompt): the config is READ from its localStorage key here, but no
// settings UI writes it yet — the toggle is a separate follow-up. Until that
// ships, isDbIntentsEnabled() returns false in normal use and the whole DB
// intents path is inert.

import { getVaultConfig } from '../sync/vaultConfig.js';

export const DB_INTENTS_CONFIG_KEY = 'dayglance-db-intents-config';

// 30 days, matching the WebDAV intents GC retention default. Rows older than this
// are server-expired (TTL) and never returned by /intents/list.
export const DEFAULT_DB_INTENTS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// Foreground cadence, matching the WebDAV intents poller's 2-minute default.
export const DEFAULT_DB_INTENTS_POLL_MINUTES = 2;

/** @returns {{enabled:boolean, ttlMs?:number, pollIntervalMinutes?:number}|null} */
export function getDbIntentsConfig() {
  try {
    const raw = localStorage.getItem(DB_INTENTS_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setDbIntentsConfig(cfg) {
  if (cfg) localStorage.setItem(DB_INTENTS_CONFIG_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(DB_INTENTS_CONFIG_KEY);
}

// The vault connection the DB intents transport talks to, inherited from the
// SYNC config. Returns null unless a full connection is present. Crucially this
// does NOT consult the sync config's `enabled` flag — DB intents is gated on its
// OWN flag (below); it only borrows the connection details.
/** @returns {{vaultUrl:string, vaultToken:string, accountId:string}|null} */
export function getDbIntentsConnection() {
  const v = getVaultConfig();
  if (!v || !v.vaultUrl || !v.vaultToken || !v.accountId) return null;
  return { vaultUrl: v.vaultUrl, vaultToken: v.vaultToken, accountId: v.accountId };
}

// True only when DB intents is toggled on AND a vault connection is configured.
// Everything in the DB intents transport is gated on this; when false the path is
// fully inert (no send, no poll).
export function isDbIntentsEnabled() {
  const c = getDbIntentsConfig();
  return !!(c && c.enabled && getDbIntentsConnection());
}
