import { describe, it, expect, beforeAll } from 'vitest';
import { languages, loaders } from './locales.js';

// Guards the drift that shipped de/es/it/pt as files with no `resources` entry,
// so every string in those languages silently rendered in English. A test that
// only checked the files existed would have passed throughout that bug — the
// assertions below go through the same loaders i18n.js resolves at runtime.
describe('locale bundles', () => {
  const EXPECTED = ['de', 'en', 'es', 'fr', 'it', 'pt'];
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

  // de/es/it/pt were frozen while they were unreachable, so they sit behind en
  // by a fixed set of keys; those fall back to English per key rather than
  // breaking. Pinning the number keeps the gap from widening unnoticed and
  // fails loudly once the backlog is translated, as the prompt to lower it.
  describe('coverage against en', () => {
    const KNOWN_GAP = { de: 61, es: 61, fr: 0, it: 61, pt: 61 };

    it.each(TRANSLATED)('%s is missing exactly its known number of keys', (lng) => {
      const missing = [...keysOf('en')].filter((k) => !keysOf(lng).has(k));
      expect(
        missing.length,
        `${lng} gap changed — translate the backlog and lower KNOWN_GAP, or investigate the new omissions:\n  ${missing.slice(0, 10).join('\n  ')}`,
      ).toBe(KNOWN_GAP[lng]);
    });

    it.each(TRANSLATED)('%s carries no keys that en does not', (lng) => {
      const extra = [...keysOf(lng)].filter((k) => !keysOf('en').has(k));
      expect(extra, `${lng} has keys absent from en`).toEqual([]);
    });
  });
});
