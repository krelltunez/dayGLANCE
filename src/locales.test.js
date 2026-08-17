import { describe, it, expect, beforeAll } from 'vitest';
import { languages, loaders, resolveLanguage } from './locales.js';

// Guards the drift that shipped de/es/it/pt as files with no `resources` entry,
// so every string in those languages silently rendered in English. A test that
// only checked the files existed would have passed throughout that bug — the
// assertions below go through the same loaders i18n.js resolves at runtime.
describe('locale bundles', () => {
  const EXPECTED = ['de', 'en', 'es', 'fr', 'it', 'pt-BR', 'pt-PT'];
  const TRANSLATED = EXPECTED.filter((l) => l !== 'en');

  const bundles = {};
  beforeAll(async () => {
    await Promise.all(
      EXPECTED.map(async (lng) => {
        bundles[lng] = await loaders[lng]();
      }),
    );
  });

  const flatten = (obj, prefix = '') =>
    Object.entries(obj).flatMap(([k, v]) => {
      const key = prefix ? `${prefix}.${k}` : k;
      return v && typeof v === 'object' && !Array.isArray(v) ? flatten(v, key) : [key];
    });

  const keysOf = (lng) => new Set(flatten(bundles[lng]));

  it('exposes every shipped language', () => {
    expect(languages).toEqual(EXPECTED);
  });

  describe('resolveLanguage', () => {
    it('passes through a tag that is already shipped', () => {
      expect(resolveLanguage('pt-BR')).toBe('pt-BR');
      expect(resolveLanguage('de')).toBe('de');
    });

    // The regression this exists to prevent. Portuguese shipped as a single
    // "pt" locale before the split, so every Portuguese user has that value
    // cached; without the mapping they would silently land in English.
    it('moves the pre-split "pt" to European rather than English', () => {
      expect(resolveLanguage('pt')).toBe('pt-PT');
    });

    it('sends an unshipped Portuguese region to European', () => {
      expect(resolveLanguage('pt-AO')).toBe('pt-PT');
      expect(resolveLanguage('pt-MZ')).toBe('pt-PT');
    });

    it('matches a regional tag regardless of case', () => {
      expect(resolveLanguage('pt-br')).toBe('pt-BR');
      expect(resolveLanguage('PT-BR')).toBe('pt-BR');
    });

    it('reduces a regional tag to a base language that is shipped', () => {
      expect(resolveLanguage('en-US')).toBe('en');
      expect(resolveLanguage('de-AT')).toBe('de');
    });

    it('falls back to en for a language that is not shipped', () => {
      expect(resolveLanguage('ja')).toBe('en');
      expect(resolveLanguage('zz-ZZ')).toBe('en');
    });

    it('handles a missing or non-string value', () => {
      expect(resolveLanguage(undefined)).toBe('en');
      expect(resolveLanguage(null)).toBe('en');
      expect(resolveLanguage('')).toBe('en');
      expect(resolveLanguage(42)).toBe('en');
    });

    it('prefers any variant of the right language over English', () => {
      expect(resolveLanguage('pt', ['en', 'pt-BR'])).toBe('pt-BR');
    });

    it('falls back to the first option when en is not shipped', () => {
      expect(resolveLanguage('ja', ['de', 'fr'])).toBe('de');
    });

    it('always returns something the picker can render', () => {
      for (const reported of ['en', 'pt', 'pt-AO', 'de-AT', 'zz', '', undefined]) {
        expect(languages).toContain(resolveLanguage(reported));
      }
    });
  });

  it.each(EXPECTED)('%s resolves to a non-empty bundle', (lng) => {
    expect(bundles[lng]).toBeTypeOf('object');
    expect(Object.keys(bundles[lng]).length).toBeGreaterThan(0);
  });

  // A bundle can resolve and still be a stub, or be a copy of English that was
  // never translated. This key is carried by all six languages.
  it.each(TRANSLATED)('%s translates a shared key into its own text', (lng) => {
    const en = bundles.en.sync.errors.NETWORK_ERROR;
    const value = bundles[lng]?.sync?.errors?.NETWORK_ERROR;
    expect(value, `${lng} is missing sync.errors.NETWORK_ERROR`).toBeTypeOf('string');
    expect(value, `${lng} still carries the English string`).not.toBe(en);
  });

  // de/es/it/pt were 61 keys behind en, having been frozen while they were
  // unreachable. That backlog is translated, so this is now a strict parity
  // check rather than a ratchet: a key added to en without translations fails
  // here instead of silently rendering English.
  describe('coverage against en', () => {
    it.each(TRANSLATED)('%s covers every key in en', (lng) => {
      const missing = [...keysOf('en')].filter((k) => !keysOf(lng).has(k));
      expect(
        missing,
        `${lng} is missing keys that en has — translate them:\n  ${missing.slice(0, 10).join('\n  ')}`,
      ).toEqual([]);
    });

    it.each(TRANSLATED)('%s carries no keys that en does not', (lng) => {
      const extra = [...keysOf(lng)].filter((k) => !keysOf('en').has(k));
      expect(extra, `${lng} has keys absent from en`).toEqual([]);
    });
  });

  // The backlog covered four namespaces at once. Spot-checking one string from
  // each catches a namespace merged in as an untranslated copy of the English.
  describe('backlog namespaces are actually translated', () => {
    const SAMPLES = ['reset.title', 'icloudDiag.title', 'icloudFirstRun.title', 'icloudSync.title'];
    const get = (lng, key) => key.split('.').reduce((o, k) => o?.[k], bundles[lng]);

    it.each(TRANSLATED.flatMap((lng) => SAMPLES.map((key) => [lng, key])))(
      '%s translates %s',
      (lng, key) => {
        expect(get(lng, key), `${lng} is missing ${key}`).toBeTypeOf('string');
        expect(get(lng, key), `${lng} left ${key} in English`).not.toBe(get('en', key));
      },
    );
  });
});
