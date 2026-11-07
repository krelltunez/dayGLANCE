import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  LAUNCHER_PACKAGE, LAUNCHER_PROMO_MIN_SDK, LAUNCHER_PROMO_MIN_DAYS,
  LAUNCHER_PROMO_FIRST_SEEN_KEY, LAUNCHER_PROMO_DISMISSED_KEY,
  readLauncherPromoInfo, launcherPromoUrl, launcherPromoStore,
  recordLauncherPromoFirstSeen, isLauncherPromoDismissed, dismissLauncherPromo,
  shouldShowLauncherPromoCard,
} from './launcherPromo.js';
import { HEADLESS_BRIDGE_METHODS } from '../headless/headlessMode.js';
import { collectDeviceSettings } from './deviceSettings.js';

// Who is told about GLANCElauncher, and when: Android 12+, not installed, a
// link in this build, a few days of use on this device, never dismissed.

const GITHUB = 'https://github.com/krelltunez/GLANCElauncher/releases/latest';
const PLAY = 'https://play.google.com/store/apps/details?id=app.glance.launcher';
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T09:00:00Z');

const memoryStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
    map,
  };
};

const info = (over = {}) => ({ sdk: 34, installed: false, url: GITHUB, ...over });

// A device first seen T0, now `days` later.
const seenDaysAgo = (days, extra = {}) => {
  const storage = memoryStorage({ [LAUNCHER_PROMO_FIRST_SEEN_KEY]: new Date(T0).toISOString(), ...extra });
  return { storage, now: T0 + days * DAY };
};

describe('readLauncherPromoInfo', () => {
  const win = (bridge, extra = {}) => ({ DayGlanceNative: bridge, ...extra });

  it('parses the Android bridge answer', () => {
    const answer = JSON.stringify({ sdk: 33, installed: false, url: GITHUB });
    expect(readLauncherPromoInfo(win({ launcherPromoInfo: () => answer }))).toEqual({ sdk: 33, installed: false, url: GITHUB });
  });

  it('is null off Android: no bridge, iOS, or an older shell without the method', () => {
    expect(readLauncherPromoInfo({})).toBeNull();
    expect(readLauncherPromoInfo(undefined)).toBeNull();
    // Even a well-formed answer: the iOS shell shares the bridge's name.
    const valid = JSON.stringify({ sdk: 34, installed: false, url: GITHUB });
    expect(readLauncherPromoInfo(win({ launcherPromoInfo: () => valid }, { DayGlanceIOS: true }))).toBeNull();
    expect(readLauncherPromoInfo(win({}))).toBeNull();
  });

  it('is null for an answer that does not parse or has the wrong shape', () => {
    expect(readLauncherPromoInfo(win({ launcherPromoInfo: () => 'nope' }))).toBeNull();
    expect(readLauncherPromoInfo(win({ launcherPromoInfo: () => 'null' }))).toBeNull();
    expect(readLauncherPromoInfo(win({ launcherPromoInfo: () => JSON.stringify({ sdk: '34', installed: false, url: GITHUB }) }))).toBeNull();
    expect(readLauncherPromoInfo(win({ launcherPromoInfo: () => JSON.stringify({ sdk: 34, installed: 'no', url: GITHUB }) }))).toBeNull();
    expect(readLauncherPromoInfo(win({ launcherPromoInfo: () => JSON.stringify({ sdk: 34, installed: false }) }))).toBeNull();
    expect(readLauncherPromoInfo(win({ launcherPromoInfo: () => { throw new Error('bridge'); } }))).toBeNull();
  });

  it("reads org.json's escaped slashes as the plain URL", () => {
    const answer = '{"sdk":34,"installed":false,"url":"https:\\/\\/github.com\\/krelltunez\\/GLANCElauncher\\/releases\\/latest"}';
    expect(readLauncherPromoInfo(win({ launcherPromoInfo: () => answer }))?.url).toBe(GITHUB);
  });
});

describe('launcherPromoUrl: who is offered the launcher at all', () => {
  it('offers the link on Android 12+ without the launcher', () => {
    expect(LAUNCHER_PROMO_MIN_SDK).toBe(31);
    expect(launcherPromoUrl(info())).toBe(GITHUB);
    expect(launcherPromoUrl(info({ sdk: 31 }))).toBe(GITHUB);
    expect(launcherPromoUrl(info({ url: PLAY }))).toBe(PLAY);
  });

  it('not below Android 12', () => {
    expect(launcherPromoUrl(info({ sdk: 30 }))).toBeNull();
    expect(launcherPromoUrl(info({ sdk: 26 }))).toBeNull();
  });

  it('not when the launcher is installed', () => {
    expect(launcherPromoUrl(info({ installed: true }))).toBeNull();
  });

  it('not when the build has no link (the Play build, until the launcher is approved)', () => {
    expect(launcherPromoUrl(info({ url: '' }))).toBeNull();
    expect(launcherPromoUrl(info({ url: '   ' }))).toBeNull();
    expect(launcherPromoUrl(info({ url: 'http://example.com' }))).toBeNull();
    expect(launcherPromoUrl(info({ url: 'javascript:alert(1)' }))).toBeNull();
  });

  it('not without native facts (web, desktop, iOS)', () => {
    expect(launcherPromoUrl(null)).toBeNull();
  });
});

describe('launcherPromoStore', () => {
  it('names the store the link goes to', () => {
    expect(launcherPromoStore(GITHUB)).toBe('github');
    expect(launcherPromoStore(PLAY)).toBe('play');
    expect(launcherPromoStore('https://example.com/launcher')).toBe('other');
    expect(launcherPromoStore('not a url')).toBe('other');
  });
});

describe('the first-seen stamp', () => {
  it('is recorded once, the first time it is asked, and never moves', () => {
    const storage = memoryStorage();
    expect(recordLauncherPromoFirstSeen({ storage, now: T0 })).toBe(T0);
    expect(storage.getItem(LAUNCHER_PROMO_FIRST_SEEN_KEY)).toBe(new Date(T0).toISOString());
    expect(recordLauncherPromoFirstSeen({ storage, now: T0 + 5 * DAY })).toBe(T0);
    expect(storage.getItem(LAUNCHER_PROMO_FIRST_SEEN_KEY)).toBe(new Date(T0).toISOString());
  });

  it('replaces an unreadable stamp', () => {
    const storage = memoryStorage({ [LAUNCHER_PROMO_FIRST_SEEN_KEY]: 'garbage' });
    expect(recordLauncherPromoFirstSeen({ storage, now: T0 })).toBe(T0);
    expect(storage.getItem(LAUNCHER_PROMO_FIRST_SEEN_KEY)).toBe(new Date(T0).toISOString());
  });

  it('is written by the card check on a device never stamped, which then waits', () => {
    const storage = memoryStorage();
    expect(shouldShowLauncherPromoCard(info(), { storage, now: T0 })).toBe(false);
    expect(storage.getItem(LAUNCHER_PROMO_FIRST_SEEN_KEY)).toBe(new Date(T0).toISOString());
    expect(shouldShowLauncherPromoCard(info(), { storage, now: T0 + LAUNCHER_PROMO_MIN_DAYS * DAY })).toBe(true);
  });

  it('is not written where the launcher is not offered', () => {
    const storage = memoryStorage();
    shouldShowLauncherPromoCard(null, { storage, now: T0 });
    shouldShowLauncherPromoCard(info({ url: '' }), { storage, now: T0 });
    expect(storage.map.size).toBe(0);
  });
});

describe('shouldShowLauncherPromoCard', () => {
  it('shows once the app has been used here for three days', () => {
    expect(LAUNCHER_PROMO_MIN_DAYS).toBe(3);
    const { storage, now } = seenDaysAgo(3);
    expect(shouldShowLauncherPromoCard(info(), { storage, now })).toBe(true);
  });

  it('not before three days', () => {
    expect(shouldShowLauncherPromoCard(info(), seenDaysAgo(0))).toBe(false);
    expect(shouldShowLauncherPromoCard(info(), seenDaysAgo(2.9))).toBe(false);
  });

  it('not with a first-seen stamp in the future (a clock set back)', () => {
    expect(shouldShowLauncherPromoCard(info(), seenDaysAgo(-10))).toBe(false);
  });

  it('not below Android 12, when installed, or with no link, however long the wait', () => {
    expect(shouldShowLauncherPromoCard(info({ sdk: 30 }), seenDaysAgo(30))).toBe(false);
    expect(shouldShowLauncherPromoCard(info({ installed: true }), seenDaysAgo(30))).toBe(false);
    expect(shouldShowLauncherPromoCard(info({ url: '' }), seenDaysAgo(30))).toBe(false);
    expect(shouldShowLauncherPromoCard(null, seenDaysAgo(30))).toBe(false);
  });

  it('not once dismissed, for good', () => {
    const { storage, now } = seenDaysAgo(5);
    expect(isLauncherPromoDismissed(storage)).toBe(false);
    expect(dismissLauncherPromo({ storage, now })).toBe(true);
    expect(isLauncherPromoDismissed(storage)).toBe(true);
    expect(shouldShowLauncherPromoCard(info(), { storage, now })).toBe(false);
    expect(shouldShowLauncherPromoCard(info(), { storage, now: now + 365 * DAY })).toBe(false);
  });
});

describe('device-local storage', () => {
  it('uses dg- keys, which the local backups do not capture', () => {
    expect(LAUNCHER_PROMO_FIRST_SEEN_KEY).toMatch(/^dg-/);
    expect(LAUNCHER_PROMO_DISMISSED_KEY).toMatch(/^dg-/);
    const storage = memoryStorage({
      [LAUNCHER_PROMO_FIRST_SEEN_KEY]: new Date(T0).toISOString(),
      [LAUNCHER_PROMO_DISMISSED_KEY]: new Date(T0).toISOString(),
    });
    expect(collectDeviceSettings(storage)).toEqual({});
  });
});

// The native half cannot be compiled here (no Android SDK); these hold the
// pieces it is made of to what the web side expects.
describe('the Android wiring', () => {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const manifest = read('dayglance-android/app/src/main/AndroidManifest.xml');
  const gradle = read('dayglance-android/app/build.gradle.kts');
  const promoKt = read('dayglance-android/app/src/main/java/com/dayglance/app/bridge/LauncherPromo.kt');
  const nativeBridgeKt = read('dayglance-android/app/src/main/java/com/dayglance/app/bridge/NativeBridge.kt');
  const headlessBridgeKt = read('dayglance-android/app/src/main/java/com/dayglance/app/launcher/HeadlessBridge.kt');

  it('lists the launcher in the manifest queries, so it can be seen as installed', () => {
    const queries = manifest.slice(manifest.indexOf('<queries>'), manifest.indexOf('</queries>'));
    expect(queries).toContain(`<package android:name="${LAUNCHER_PACKAGE}" />`);
    expect(promoKt).toContain(`const val LAUNCHER_PACKAGE = "${LAUNCHER_PACKAGE}"`);
  });

  it('links GitHub releases in the github flavour and nothing in play, for now', () => {
    const flavour = (name) => {
      const start = gradle.indexOf(`create("${name}")`);
      return gradle.slice(start, gradle.indexOf('\n        }', start));
    };
    expect(flavour('github')).toContain(`buildConfigField("String", "LAUNCHER_PROMO_URL", "\\"${GITHUB}\\"")`);
    expect(flavour('play')).toContain('buildConfigField("String", "LAUNCHER_PROMO_URL", "\\"\\"")');
    expect(flavour('play')).toContain(PLAY);
  });

  it('exposes launcherPromoInfo on the main bridge only, never the headless one', () => {
    expect(nativeBridgeKt).toMatch(/@JavascriptInterface\s+fun launcherPromoInfo\(\): String/);
    expect(nativeBridgeKt).toContain('BuildConfig.LAUNCHER_PROMO_URL');
    expect(HEADLESS_BRIDGE_METHODS).not.toContain('launcherPromoInfo');
    expect(headlessBridgeKt).not.toContain('launcherPromoInfo');
  });
});
