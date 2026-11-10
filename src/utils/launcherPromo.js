// The GLANCElauncher card in Settings, and its permanent Integrations entry:
// who is told about the launcher, and when. Android only, and only to people
// who can use it (the launcher pairs through a `knownSigner` permission, which
// exists from Android 12; docs/launcher-integration.md, "Permission").
//
// The native shell reports the facts (bridge/LauncherPromo.kt,
// `launcherPromoInfo()`): the SDK level, whether `app.glance.launcher` is
// installed, and the flavour's link (Google Play or the GitHub releases). An
// empty link means the build offers the launcher nowhere.
//
// The card waits until the app has been used on this device for a few days
// and, once dismissed, never returns here. Both stamps are device-local: `dg-`
// keys, which neither sync tier carries and the local backups do not capture
// (utils/deviceSettings.js takes `day-planner-` keys), so a backup restored on
// another phone asks that phone afresh.
import { writeItem } from './storageWrites.js';

export const LAUNCHER_PACKAGE = 'app.glance.launcher';
/** Android 12: the first release with `knownSigner`. */
export const LAUNCHER_PROMO_MIN_SDK = 31;
export const LAUNCHER_PROMO_MIN_DAYS = 3;
export const LAUNCHER_PROMO_FIRST_SEEN_KEY = 'dg-launcher-promo-first-seen';
export const LAUNCHER_PROMO_DISMISSED_KEY = 'dg-launcher-promo-dismissed';

const DAY_MS = 24 * 60 * 60 * 1000;

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

const readKey = (storage, key) => {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
};

const writeKey = (storage, key, value) => {
  if (!storage) return false;
  if (typeof localStorage !== 'undefined' && storage === localStorage) return writeItem(key, value);
  try { storage.setItem(key, value); return true; } catch { return false; }
};

/**
 * The native facts, or null where there are none: not the Android shell, an
 * older shell without the method, or an answer that does not parse.
 * `{ sdk: number, installed: boolean, url: string }`.
 */
export function readLauncherPromoInfo(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win || win.DayGlanceIOS) return null;
  const bridge = win.DayGlanceNative;
  if (!bridge || typeof bridge.launcherPromoInfo !== 'function') return null;
  try {
    const raw = JSON.parse(bridge.launcherPromoInfo());
    if (!raw || typeof raw !== 'object') return null;
    if (typeof raw.sdk !== 'number' || typeof raw.installed !== 'boolean' || typeof raw.url !== 'string') return null;
    return { sdk: raw.sdk, installed: raw.installed, url: raw.url };
  } catch {
    return null;
  }
}

/**
 * The link to offer, or null when this device is not offered the launcher:
 * no native facts, below Android 12, already installed, or no link in this
 * build. Gates both the card and the permanent entry.
 */
export function launcherPromoUrl(info) {
  if (!info) return null;
  if (!(info.sdk >= LAUNCHER_PROMO_MIN_SDK)) return null;
  if (info.installed !== false) return null;
  const url = typeof info.url === 'string' ? info.url.trim() : '';
  if (!/^https:\/\//i.test(url)) return null;
  return url;
}

/** Which button label suits the link: GitHub, Google Play, or neither. */
export function launcherPromoStore(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'github.com') return 'github';
    if (host === 'play.google.com') return 'play';
  } catch { /* not a URL: the plain label */ }
  return 'other';
}

/**
 * When this device first ran the app, recorded the first time it is asked
 * and never moved after. An unreadable stamp is replaced. Returns the stamp
 * in milliseconds.
 */
export function recordLauncherPromoFirstSeen({ storage = defaultStorage(), now = Date.now() } = {}) {
  const stored = Date.parse(readKey(storage, LAUNCHER_PROMO_FIRST_SEEN_KEY) ?? '');
  if (Number.isFinite(stored)) return stored;
  writeKey(storage, LAUNCHER_PROMO_FIRST_SEEN_KEY, new Date(now).toISOString());
  return now;
}

export function isLauncherPromoDismissed(storage = defaultStorage()) {
  return readKey(storage, LAUNCHER_PROMO_DISMISSED_KEY) != null;
}

/** Dismiss the card on this device for good. Returns whether the write landed. */
export function dismissLauncherPromo({ storage = defaultStorage(), now = Date.now() } = {}) {
  return writeKey(storage, LAUNCHER_PROMO_DISMISSED_KEY, new Date(now).toISOString());
}

/**
 * Whether the dismissible card shows: the launcher is offered here, the card
 * was never dismissed, and the app has been used on this device for at least
 * LAUNCHER_PROMO_MIN_DAYS. Records the first-seen stamp if there is none yet,
 * so a device that has never been stamped starts its wait now.
 */
export function shouldShowLauncherPromoCard(info, { storage = defaultStorage(), now = Date.now() } = {}) {
  if (!launcherPromoUrl(info)) return false;
  if (isLauncherPromoDismissed(storage)) return false;
  const firstSeen = recordLauncherPromoFirstSeen({ storage, now });
  return now - firstSeen >= LAUNCHER_PROMO_MIN_DAYS * DAY_MS;
}
