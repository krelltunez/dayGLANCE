import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { enabledIntentTargets } from './emitTargets.js';
import { isIcloudIntentsEnabled, ICLOUD_INTENTS_ENABLED_KEY } from './icloudIntentsConfig.js';

// ─────────────────────────────────────────────────────────────────────────────
// enabledIntentTargets decides which transports an emit goes to AND gates the
// "Track in lifeGLANCE" share UI. These cover the WebDAV/vault/iCloud matrix —
// crucially the vault-only case (a target even with no WebDAV config) and the
// iCloud OPT-IN gate: 'icloud' must be excluded unless iCloud is BOTH available
// AND explicitly enabled, so the "opt-in, off by default" claim holds.
// ─────────────────────────────────────────────────────────────────────────────

// iCloud availability is a module-level platform check; mock it so we can drive
// both the available and unavailable branches. Only isAvailable is consumed here.
let mockIcloudAvailable = false;
vi.mock('./icloudFileTransport.js', () => ({
  isAvailable: () => mockIcloudAvailable,
}));

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}
beforeEach(() => {
  global.localStorage = memLocalStorage();
  mockIcloudAvailable = false;
});
afterAll(() => { delete global.localStorage; });

const WEBDAV = { webdavUrl: 'https://dav', username: 'u', appPassword: 'p' };

function enableVault() {
  localStorage.setItem('dayglance-db-intents-config', JSON.stringify({ enabled: true }));
  localStorage.setItem('dayglance-vault-config', JSON.stringify({ enabled: true, vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }));
}

function optInICloud() {
  localStorage.setItem(ICLOUD_INTENTS_ENABLED_KEY, 'true');
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

  it('EXCLUDES "icloud" when iCloud is available but the opt-in is off', () => {
    mockIcloudAvailable = true;
    // no opt-in flag written
    expect(enabledIntentTargets(null)).toEqual([]);
    expect(enabledIntentTargets(WEBDAV)).toEqual(['webdav']);
  });

  it('EXCLUDES "icloud" when opted in but iCloud is unavailable (e.g. Android/web)', () => {
    mockIcloudAvailable = false;
    optInICloud();
    expect(enabledIntentTargets(null)).toEqual([]);
  });

  it('INCLUDES "icloud" only when iCloud is available AND opted in', () => {
    mockIcloudAvailable = true;
    optInICloud();
    expect(enabledIntentTargets(null)).toEqual(['icloud']);
    expect(enabledIntentTargets(WEBDAV)).toEqual(['webdav', 'icloud']);
  });
});

describe('isIcloudIntentsEnabled', () => {
  it('requires BOTH availability and the opt-in flag', () => {
    // neither
    expect(isIcloudIntentsEnabled()).toBe(false);
    // available only
    mockIcloudAvailable = true;
    expect(isIcloudIntentsEnabled()).toBe(false);
    // opted in only
    mockIcloudAvailable = false;
    optInICloud();
    expect(isIcloudIntentsEnabled()).toBe(false);
    // both
    mockIcloudAvailable = true;
    expect(isIcloudIntentsEnabled()).toBe(true);
  });
});
