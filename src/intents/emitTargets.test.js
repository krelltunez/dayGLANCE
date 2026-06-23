import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { enabledIntentTargets } from './emitTargets.js';

// ─────────────────────────────────────────────────────────────────────────────
// enabledIntentTargets decides which transports an emit goes to AND gates the
// "Track in lifeGLANCE" share UI. iCloud is unavailable in this environment, so
// these cover the WebDAV/vault matrix — crucially the vault-only case, which
// must yield a target even with no WebDAV config (the bug this guards against).
// ─────────────────────────────────────────────────────────────────────────────

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
beforeEach(() => { global.localStorage = memLocalStorage(); });
afterAll(() => { delete global.localStorage; });

const WEBDAV = { webdavUrl: 'https://dav', username: 'u', appPassword: 'p' };

function enableVault() {
  localStorage.setItem('dayglance-db-intents-config', JSON.stringify({ enabled: true }));
  localStorage.setItem('dayglance-vault-config', JSON.stringify({ enabled: true, vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }));
}

describe('enabledIntentTargets', () => {
  it('returns ["webdav"] when only WebDAV is configured', () => {
    expect(enabledIntentTargets(WEBDAV)).toEqual(['webdav']);
  });

  it('returns ["vault"] when ONLY GLANCEvault intents is enabled (no WebDAV)', () => {
    enableVault();
    expect(enabledIntentTargets(null)).toEqual(['vault']);
  });

  it('returns both when WebDAV is configured and vault is enabled', () => {
    enableVault();
    expect(enabledIntentTargets(WEBDAV)).toEqual(['webdav', 'vault']);
  });

  it('returns [] when nothing is enabled', () => {
    expect(enabledIntentTargets(null)).toEqual([]);
    expect(enabledIntentTargets({})).toEqual([]);
  });

  it('does not count WebDAV when the config is incomplete', () => {
    expect(enabledIntentTargets({ webdavUrl: 'https://dav' })).toEqual([]);
  });
});
