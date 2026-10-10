import { describe, it, expect, afterEach } from 'vitest';
import { nativeKeyConfig, isRootKeyRecord } from './dbEngine.js';

const rec = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64');
const ROOT = rec({ rootBytes: [1, 2, 3], salt: [4] });
const FILE = rec({ rawKey: [9, 9], salt: [4] });

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
    expect(cfg.nativeGetSyncKey()).toBe('k');
    cfg.nativeStoreSyncKey('val');
    expect(calls).toEqual([['get', 'db'], ['store', 'db', 'val']]);
  });

  it('Android with per-slot methods: an empty own slot falls back to a ROOT key in the legacy slot (the upgrade), never to the file key there', () => {
    const native = { getSyncKey: () => ROOT, storeSyncKey: () => {}, getSyncKeyForSlot: () => '', storeSyncKeyForSlot: () => {} };
    global.window = { DayGlanceNative: native };
    expect(nativeKeyConfig().nativeGetSyncKey()).toBe(ROOT);
    native.getSyncKey = () => FILE;
    expect(nativeKeyConfig().nativeGetSyncKey()).toBeNull();
    native.getSyncKey = () => '';
    expect(nativeKeyConfig().nativeGetSyncKey()).toBeNull();
  });

  it('guard (2026-10-10): on a shell with one shared slot, a record of the file tier\'s shape is "no key", not an empty root key', () => {
    // The Direct Access unlock on the phone wrote the file-tier key over the
    // vault's root key; read as a root key it imported empty and failed the
    // account check as "passphrase doesn't match". Now it reads as absent, so
    // the engine re-derives from the passphrase.
    const native = { getSyncKey: () => FILE, storeSyncKey: () => {} };
    global.window = { DayGlanceNative: native };
    expect(nativeKeyConfig().nativeGetSyncKey()).toBeNull();
    native.getSyncKey = () => ROOT;
    expect(nativeKeyConfig().nativeGetSyncKey()).toBe(ROOT);
    expect(isRootKeyRecord(rec({ rootBytes: [], salt: [] }))).toBe(false);
    expect(isRootKeyRecord('not base64 json')).toBe(false);
    expect(isRootKeyRecord(null)).toBe(false);
  });
});
