// Guards the macOS locale trim that keeps the Mac App Store listing honest.
//
// electron-builder ships every one of Chromium's ~54 locales by default, each
// as an <lang>.lproj folder in Contents/Resources. Apple reads those folders as
// the app's supported languages, so the store page claimed 50+ languages for an
// app translated into eight — a claim no App Store Connect setting can correct.
// mac.electronLanguages deletes the folders we do not ship.
//
// Nothing in CI builds a .app, so these assert the config's properties rather
// than an artifact's. scripts/verify-mas-compileout.mjs checks the real bundle.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const config = require('../electron-builder.config.cjs');
const localesDir = join(__dirname, '..', 'public', 'locales');

/**
 * app-builder-lib's matcher, transcribed from
 * node_modules/app-builder-lib/out/electron/ElectronFramework.js
 * (removeUnusedLanguagesIfNeeded). Separators and case are normalised, and the
 * match is prefix-wise in BOTH directions — which is why 'pt-BR' finds
 * pt_BR.lproj, and why bare 'en' also keeps en_GB.lproj.
 */
const normalizeLocale = (locale: string) => locale.trim().toLowerCase().replace(/_/g, '-');
const isLocaleMatch = (wanted: string, language: string) =>
  wanted === language || language.startsWith(`${wanted}-`) || wanted.startsWith(`${language}-`);

const survives = (lprojBasename: string) =>
  (config.mac.electronLanguages as string[])
    .map(normalizeLocale)
    .some((wanted) => isLocaleMatch(wanted, normalizeLocale(lprojBasename)));

describe('mac.electronLanguages', () => {
  it('lists exactly the languages that have a translation bundle', () => {
    const shipped = readdirSync(localesDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(config.mac.electronLanguages).toEqual(shipped);
  });

  // A list that matched no .lproj at all would make electron-builder skip the
  // cleanup entirely (it refuses to package an app with an empty locales dir),
  // silently restoring the 50-language listing. A list that matched everything
  // *except* en would be worse: Chromium would ship without its fallback pak.
  it('keeps English, whatever else changes', () => {
    expect(config.mac.electronLanguages).toContain('en');
    expect(survives('en')).toBe(true);
  });

  // Electron's macOS folders spell regional variants with an underscore. Our
  // tags use a hyphen; normalisation is what bridges them, so this is the
  // assertion that the tags work as written rather than needing transcription.
  it.each([
    ['pt_BR', true],
    ['pt_PT', true],
    ['zh_CN', true],
    ['de', true],
    ['fr', true],
    ['it', true],
    ['es', true],
    ['ja', true],
    // Prefix matching pulls these two in behind bare 'en' and 'es'. Accepted,
    // and asserted so the store listing showing them is never a surprise.
    ['en_GB', true],
    ['es_419', true],
    ['zh_TW', true],
    // Traditional Chinese is a different written standard from zh-CN, and each
    // is declared on its own; neither drags in other Chinese regions.
    ['zh_HK', false],
    ['ko', false],
    ['ru', false],
    ['ar', false],
    ['nl', false],
  ])('%s survives the trim: %s', (lproj, expected) => {
    expect(survives(lproj as string)).toBe(expected);
  });
});

describe('CFBundleLocalizations', () => {
  it('declares the same set, in Apple’s spelling', () => {
    expect(config.mac.extendInfo.CFBundleLocalizations).toEqual(
      (config.mac.electronLanguages as string[]).map((l) => ({ 'zh-CN': 'zh-Hans', 'zh-TW': 'zh-Hant' }[l] ?? l)),
    );
  });
});

// Both keys live on `mac` alone. electron-builder merges mac into mas with
// deepAssign, which CONCATENATES arrays instead of replacing them — the same
// trap already documented on extraResources in the config. Declaring either key
// in both blocks would produce a doubled list.
describe('the mas block does not redeclare them', () => {
  it('leaves both keys to inheritance', () => {
    expect(config.mas.electronLanguages).toBeUndefined();
    expect(config.mas.extendInfo.CFBundleLocalizations).toBeUndefined();
  });

  it('merges into mas without duplicating an entry', () => {
    const { deepAssign } = require('builder-util-runtime');
    const merged = deepAssign({}, config.mac, config.mas);
    expect(merged.electronLanguages).toEqual(config.mac.electronLanguages);
    expect(merged.extendInfo.CFBundleLocalizations).toEqual(config.mac.extendInfo.CFBundleLocalizations);
    // The mas-only key still arrives, so this is a real merge, not a no-op.
    expect(merged.extendInfo.ITSAppUsesNonExemptEncryption).toBe(false);
  });
});
