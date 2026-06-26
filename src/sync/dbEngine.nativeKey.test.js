import { describe, it, expect, afterEach } from 'vitest';
import { nativeKeyConfig } from './dbEngine.js';

// Regression for the iOS-only "passphrase prompt on every launch" bug.
//
// The GLANCEvault DB root key must persist across launches so a vault-enabled
// device unlocks silently. It lives in the Android OS keystore on the Android
// shell and in IndexedDB everywhere else (web AND iOS). The bug: iOS exposes
// window.DayGlanceNative as a Proxy whose every property reads truthy, so the
// old `!!bridge.httpRequest` native-app check matched on iOS and routed the key
// through the proxy's non-functional keystore methods — it was never persisted,
// so the passphrase modal reappeared on every launch. Only Android (real
// getSyncKey, no DayGlanceIOS marker) may use the native keystore.

describe('nativeKeyConfig — native keystore only on Android, IndexedDB on iOS/web', () => {
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

  it('iOS (all-truthy Proxy bridge + DayGlanceIOS marker): uses IndexedDB, NOT the proxy keystore', () => {
    // iOS proxies every property lookup to a truthy function — exactly the trap
    // the old `!!bridge.httpRequest` check fell into.
    const proxy = new Proxy({}, { get: () => () => 'truthy' });
    global.window = { DayGlanceNative: proxy, DayGlanceIOS: {} };
    const cfg = nativeKeyConfig();
    expect(cfg.cryptoDBName).toBe('dayglance-db-crypto');
    expect(cfg.nativeGetSyncKey).toBeNull();
    expect(cfg.nativeStoreSyncKey).toBeNull();
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
