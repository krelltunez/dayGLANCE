import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { languages } from './locales.js';

/**
 * The web bundles, Android's locale list and string resources, and the iOS
 * string catalogs are four separate surfaces that have to agree, and until now
 * nothing said so. `locales.test.js` checks the ten web bundles against each
 * other; `androidStrings.test.js` checks whatever `values-*` directories
 * happen to exist. Neither notices when the web side gains a language and the
 * native sides do not.
 *
 * That is how Ukrainian and Polish shipped without reaching Android's App
 * Languages list: every suite stayed green while the app offered seven
 * locales and the web offered ten.
 *
 * This file cannot make anyone translate 172 Android strings or 78 iOS ones.
 * What it can do is force the decision to be written down: a new language is
 * either localized natively, or listed below as deliberately not. Adding one
 * and doing neither fails here.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID_RES = join(ROOT, 'dayglance-android/app/src/main/res');

// A web tag maps onto one Android resource qualifier. Android has no separate
// pt-BR and pt-PT here: both are served by values-pt, the European standard, as
// the single Portuguese resource set.
const ANDROID_QUALIFIER = { 'zh-CN': 'zh-rCN', 'zh-TW': 'zh-rTW', 'pt-BR': 'pt', 'pt-PT': 'pt' };
const androidDirFor = (tag) => `values-${ANDROID_QUALIFIER[tag] ?? tag}`;

// Apple string catalogs use zh-Hans for Simplified Chinese while the web
// bundle uses zh-CN.
const IOS_LOCALE_NAME = { 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' };
const iosLocaleFor = (tag) => IOS_LOCALE_NAME[tag] ?? tag;

// The <locale> entries in locales_config.xml use the web tags as-is (BCP-47).
// Both Portuguese standards are listed, so Settings > Language can tell them
// apart and the WebView is handed the right one; their native strings still
// share values-pt. The in-app picker hands these same tags to Android
// (LocaleBridge), so the two lists cannot be allowed to differ.
const ANDROID_LOCALE_NAME = {};
const androidLocaleFor = (tag) => ANDROID_LOCALE_NAME[tag] ?? tag;

/**
 * Languages shipped on the web that carry no native translation yet, and why.
 * Removing a line here is the point: it should only come out when the strings
 * actually land.
 */
const NATIVE_TRANSLATION_PENDING = {
  android: { 'zh-TW': 'web bundle first; native strings follow in a separate change' },
  ios: { 'zh-TW': 'web bundle first; native strings follow in a separate change' },
};

const iosCatalogs = ['dayglance-ios/DayGlance/Localizable.xcstrings', 'dayglance-ios/DayGlanceWidget/Localizable.xcstrings']
  .map((rel) => join(ROOT, rel))
  .filter((p) => existsSync(p));

const iosLanguages = () => {
  const seen = new Set();
  for (const path of iosCatalogs) {
    const strings = JSON.parse(readFileSync(path, 'utf8')).strings ?? {};
    for (const entry of Object.values(strings)) {
      for (const lng of Object.keys(entry.localizations ?? {})) seen.add(lng);
    }
  }
  return seen;
};

describe('native locales track the shipped web locales', () => {
  const translatable = languages.filter((l) => l !== 'en');

  it('the locale list Android offers covers every web locale', () => {
    const xml = readFileSync(join(ANDROID_RES, 'xml/locales_config.xml'), 'utf8');
    const declared = new Set([...xml.matchAll(/android:name="([^"]+)"/g)].map((m) => m[1]));
    // Every shipped language must be selectable, whether or not its native
    // strings exist: the WebView takes its locale from this choice, and the
    // web UI is the bulk of the app.
    const missing = languages.filter((l) => !declared.has(androidLocaleFor(l)));
    expect(missing, 'locales_config.xml would hide these from App Languages').toEqual([]);
  });

  it('locales_config offers nothing the web cannot render', () => {
    const xml = readFileSync(join(ANDROID_RES, 'xml/locales_config.xml'), 'utf8');
    const declared = [...xml.matchAll(/android:name="([^"]+)"/g)].map((m) => m[1]);
    const servable = new Set(languages.map(androidLocaleFor));
    const extra = declared.filter((l) => !servable.has(l));
    expect(extra, 'App Languages would offer a locale with no web bundle behind it').toEqual([]);
  });

  it.each(translatable)('%s has Android string resources, or is listed as pending', (lng) => {
    const present = existsSync(join(ANDROID_RES, androidDirFor(lng)));
    const pending = lng in NATIVE_TRANSLATION_PENDING.android;
    expect(present || pending, present
      ? ''
      : `${lng} has no ${androidDirFor(lng)}/. Translate it, or record it in NATIVE_TRANSLATION_PENDING.android with a reason.`).toBe(true);
    // Both at once means the note outlived the gap.
    expect(present && pending, `${lng} is translated; drop it from NATIVE_TRANSLATION_PENDING.android`).toBe(false);
  });

  it.each(translatable)('%s has iOS string catalog entries, or is listed as pending', (lng) => {
    const present = iosLanguages().has(iosLocaleFor(lng));
    const pending = lng in NATIVE_TRANSLATION_PENDING.ios;
    expect(present || pending, present
      ? ''
      : `${lng} (${iosLocaleFor(lng)}) is absent from the .xcstrings catalogs. Translate it, or record it in NATIVE_TRANSLATION_PENDING.ios with a reason.`).toBe(true);
    expect(present && pending, `${lng} is translated; drop it from NATIVE_TRANSLATION_PENDING.ios`).toBe(false);
  });

  it('every pending note names a language the app actually ships', () => {
    const shipped = new Set(languages);
    for (const [platform, notes] of Object.entries(NATIVE_TRANSLATION_PENDING)) {
      const stale = Object.keys(notes).filter((l) => !shipped.has(l));
      expect(stale, `${platform} notes a language the web no longer ships`).toEqual([]);
    }
  });
});
