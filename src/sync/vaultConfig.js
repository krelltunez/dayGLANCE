// GLANCEvault connection config + enablement gate (mirrors lastGLANCE
// src/sync/vaultConfig.ts). Its own localStorage key, completely independent of
// the file-tier (WebDAV) config — the DB transport runs ALONGSIDE WebDAV and is
// opt-in. Clearing this config reverts to file-only instantly.

// The package's persisted credential-halt key (2.0.0/4a): set when the server
// rejects this device's credential, honoured by every primitive. Imported as
// the exported helper — never a string literal — so the key can't drift.
import { credentialHaltKey } from '@glance-apps/sync/src/dbEngine.js';

const VAULT_CONFIG_KEY = 'dayglance-vault-config';
// Must match the wrapper's DEFAULT_STORAGE_KEY_PREFIX (src/sync/dbEngine.js).
const VAULT_STORAGE_KEY_PREFIX = 'dayglance-vault';

/** @returns {{enabled:boolean, vaultUrl:string, vaultToken:string, accountId:string}|null} */
export function getVaultConfig() {
  try {
    const saved = localStorage.getItem(VAULT_CONFIG_KEY);
    return saved ? JSON.parse(saved) : null;
  } catch {
    return null;
  }
}

export function setVaultConfig(cfg) {
  // HALT EXIT (2.0.0 adoption, ruling 4 — the minimal version): the package
  // persists its credential halt and only its per-account recovery flow
  // (recoverVaultSyncEngine, which needs the bootstrap secret) clears it —
  // a flow dayGLANCE doesn't run. Without this, a once-halted device would
  // refuse to sync forever even after the user pasted a fresh valid token:
  // strictly worse than pre-2.0.0, where replacing a revoked token
  // self-recovered. So saving CHANGED credentials clears the halt — fresh
  // credentials are a fresh chance, and if they are still bad the first
  // cycle re-halts, which is self-correcting. The complete recovery flow
  // (per-account era) remains future work.
  try {
    const prev = getVaultConfig();
    const credsChanged = !!cfg && (
      !prev || prev.vaultUrl !== cfg.vaultUrl || prev.vaultToken !== cfg.vaultToken || prev.accountId !== cfg.accountId
    );
    if (credsChanged) localStorage.removeItem(credentialHaltKey(VAULT_STORAGE_KEY_PREFIX));
  } catch { /* storage unavailable — the halt read would fail the same way */ }
  if (cfg) localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(VAULT_CONFIG_KEY);
}

// True only when the vault is fully configured AND toggled on. Everything in the
// DB transport is gated on this; when false the DB path is fully inert.
export function isVaultEnabled() {
  const c = getVaultConfig();
  return !!(c && c.enabled && c.vaultUrl && c.vaultToken && c.accountId);
}

export { VAULT_CONFIG_KEY };
