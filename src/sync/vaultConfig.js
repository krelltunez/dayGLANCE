// GLANCEvault connection config + enablement gate (mirrors lastGLANCE
// src/sync/vaultConfig.ts). Its own localStorage key, completely independent of
// the file-tier (WebDAV) config — the DB transport runs ALONGSIDE WebDAV and is
// opt-in. Clearing this config reverts to file-only instantly.

const VAULT_CONFIG_KEY = 'dayglance-vault-config';

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
