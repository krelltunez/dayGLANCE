import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * CI cannot run Xcode, so the two string catalogs are validated here: a
 * language dropped from a key ships English on that device, and a format
 * specifier lost in translation truncates at render. The xcodegen project
 * (project.yml) picks the catalogs up from the target source directories, so
 * there is no project file to validate.
 */
const IOS = join(dirname(fileURLToPath(import.meta.url)), '../dayglance-ios');
const CATALOGS = ['DayGlanceWidget/Localizable.xcstrings', 'DayGlance/Localizable.xcstrings'];
const LANGS = ['de', 'es', 'fr', 'it', 'pt-PT', 'pt-BR'];
const specifiers = (v) => (v.match(/%(lld|@|d)/g) ?? []).sort().join(',');

describe.each(CATALOGS)('%s', (rel) => {
  const catalog = JSON.parse(readFileSync(join(IOS, rel), 'utf8'));
  const entries = Object.entries(catalog.strings);

  it('parses and declares en as the source language', () => {
    expect(catalog.sourceLanguage).toBe('en');
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(LANGS)('every key carries a translated %s value', (lng) => {
    const missing = entries
      .filter(([, e]) => e.localizations && !e.localizations[lng]?.stringUnit?.value)
      .map(([k]) => k);
    expect(missing, `these keys would render English on ${lng} devices`).toEqual([]);
  });

  it('keeps every format specifier in every translation', () => {
    const bad = [];
    for (const [key, e] of entries) {
      for (const [lng, unit] of Object.entries(e.localizations ?? {})) {
        if (specifiers(unit.stringUnit.value) !== specifiers(key)) bad.push(`${lng}: ${key}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
