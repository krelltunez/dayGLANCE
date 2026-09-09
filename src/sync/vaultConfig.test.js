import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getVaultConfig, setVaultConfig, isVaultEnabled, VAULT_CONFIG_KEY,
  _resetVaultConfigSecureRestoreForTests,
} from './vaultConfig.js';

// The iOS secure-store mirror of the GLANCEvault connection: restored once per
// session when web storage has none (the WebKit purge of 2026-09-09), kept
// current on every save, cleared on a clear.

const CFG = { enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct' };

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

describe('vaultConfig secure-store mirror', () => {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
  const origWindow = hadWindow ? globalThis.window : undefined;
  let secureGetFn;
  let secureSetFn;
  let mirror;

  beforeEach(() => {
    _resetVaultConfigSecureRestoreForTests();
    globalThis.localStorage = fakeStorage();
    mirror = null;
    secureGetFn = vi.fn(() => mirror ?? '');
    secureSetFn = vi.fn((_, v) => { mirror = v; return 'true'; });
    globalThis.window = { DayGlanceIOS: true, DayGlanceNative: { secureGet: secureGetFn, secureSet: secureSetFn } };
  });

  afterEach(() => {
    delete globalThis.localStorage;
    if (hadWindow) globalThis.window = origWindow;
    else delete globalThis.window;
  });

  it('restores the connection from the mirror when web storage is empty, and asks the bridge only once', () => {
    mirror = JSON.stringify(CFG);
    expect(getVaultConfig()).toEqual(CFG);
    expect(JSON.parse(localStorage.getItem(VAULT_CONFIG_KEY))).toEqual(CFG);
    expect(isVaultEnabled()).toBe(true);
    getVaultConfig();
    expect(secureGetFn).toHaveBeenCalledTimes(1);
  });

  it('with no mirror either, reports unconfigured and does not keep asking', () => {
    expect(getVaultConfig()).toBeNull();
    expect(isVaultEnabled()).toBe(false);
    expect(getVaultConfig()).toBeNull();
    expect(secureGetFn).toHaveBeenCalledTimes(1);
  });

  it('web storage wins when it has a config; the mirror is not consulted', () => {
    localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({ ...CFG, accountId: 'local' }));
    mirror = JSON.stringify(CFG);
    expect(getVaultConfig().accountId).toBe('local');
    expect(secureGetFn).not.toHaveBeenCalled();
  });

  it('saving mirrors the config, and clearing clears the mirror', () => {
    setVaultConfig(CFG);
    expect(secureSetFn).toHaveBeenLastCalledWith('vault-config', JSON.stringify(CFG));
    expect(mirror).toBe(JSON.stringify(CFG));
    setVaultConfig(null);
    expect(secureSetFn).toHaveBeenLastCalledWith('vault-config', null);
    expect(localStorage.getItem(VAULT_CONFIG_KEY)).toBeNull();
  });

  it('an unreadable mirror is ignored', () => {
    mirror = '{not json';
    expect(getVaultConfig()).toBeNull();
    expect(localStorage.getItem(VAULT_CONFIG_KEY)).toBeNull();
  });

  it('off iOS nothing touches a bridge', () => {
    globalThis.window = { DayGlanceNative: { secureGet: secureGetFn, secureSet: secureSetFn } }; // Android shape
    expect(getVaultConfig()).toBeNull();
    setVaultConfig(CFG);
    expect(secureGetFn).not.toHaveBeenCalled();
    expect(secureSetFn).not.toHaveBeenCalled();
  });
});
