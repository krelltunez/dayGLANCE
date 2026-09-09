import { describe, it, expect, afterEach } from 'vitest';
import { nativeKeyConfig } from './dbEngine.js';

// Regression for the iOS-only "passphrase prompt on every launch" bug, plus
// the iOS secure-store route.
//
// The GLANCEvault DB root key must persist across launches so a vault-enabled
// device unlocks silently. It lives in the Android OS keystore on the Android
// shell, in the iOS shell's Keychain (secureGet/secureSet, the mirror that
// survives a WebKit storage purge), and in IndexedDB on web and Electron. The
// old bug: iOS exposes window.DayGlanceNative as a Proxy whose every property
// reads truthy, so the old `!!bridge.httpRequest` native-app check matched on
// iOS and routed the key through the proxy's non-functional Android keystore
// methods — it was never persisted, so the passphrase modal reappeared on every
// launch. iOS is now routed by its explicit marker to its own real methods.

describe('nativeKeyConfig — Android keystore, iOS secure store, IndexedDB on web', () => {
  const origWindow = Object.prototype.hasOwnProperty.call(global, 'window') ? global.window : undefined;
  const hadWindow = Object.prototype.hasOwnProperty.call(global, 'window');
  afterEach(() => {
    if (hadWindow) global.window = origWindow;
    else delete global.window;
  });

  it('web (no native bridge): uses IndexedDB, no native key methods', () => {
    global.window = {};
    const cfg = nativeKeyConfig();
    expect(cfg.cryptoDBName).toBe('dayglance-db-crypto');
    expect(cfg.nativeGetSyncKey).toBeNull();
    expect(cfg.nativeStoreSyncKey).toBeNull();
  });

  it('iOS (DayGlanceIOS marker): uses the secure store under its own slot, never the Android keystore names', () => {
    const calls = [];
    // The proxy still answers every name; the config must call secureGet /
    // secureSet by name and nothing else.
    const proxy = new Proxy({}, {
      get: (_, name) => (...args) => { calls.push([name, ...args]); return name === 'secureGet' ? 'k' : 'true'; },
    });
    global.window = { DayGlanceNative: proxy, DayGlanceIOS: {} };
    const cfg = nativeKeyConfig();
    expect(cfg.cryptoDBName).toBe('dayglance-db-crypto');
    expect(cfg.nativeGetSyncKey()).toBe('k');
    expect(cfg.nativeStoreSyncKey('val')).toBe(true);
    expect(calls).toEqual([['secureGet', 'db-root-key'], ['secureSet', 'db-root-key', 'val']]);
  });

  it('Android (real getSyncKey, no DayGlanceIOS): uses the native keystore', () => {
    global.window = { DayGlanceNative: { getSyncKey: () => 'k', storeSyncKey: () => {} } };
    const cfg = nativeKeyConfig();
    expect(typeof cfg.nativeGetSyncKey).toBe('function');
    expect(typeof cfg.nativeStoreSyncKey).toBe('function');
  });

  it('Android with per-slot methods: isolates the DB key under its own slot', () => {
    const calls = [];
    global.window = { DayGlanceNative: {
      getSyncKey: () => 'legacy',
      storeSyncKey: () => {},
      getSyncKeyForSlot: (slot) => { calls.push(['get', slot]); return 'k'; },
      storeSyncKeyForSlot: (slot, v) => { calls.push(['store', slot, v]); },
    } };
    const cfg = nativeKeyConfig();
    cfg.nativeGetSyncKey();
    cfg.nativeStoreSyncKey('val');
    expect(calls).toEqual([['get', 'db'], ['store', 'db', 'val']]);
  });
});
