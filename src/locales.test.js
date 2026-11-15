import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { languages, loaders, resolveLanguage } from './locales.js';

// Guards the drift that shipped de/es/it/pt as files with no `resources` entry,
// so every string in those languages silently rendered in English. A test that
// only checked the files existed would have passed throughout that bug — the
// assertions below go through the same loaders i18n.js resolves at runtime.
describe('locale bundles', () => {
  const EXPECTED = ['de', 'en', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk', 'zh-CN', 'zh-TW'];
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

  const keyCache = {};
  const keysOf = (lng) => (keyCache[lng] ??= new Set(flatten(bundles[lng])));

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

    it('offers Simplified Chinese for the bare and Simplified tags', () => {
      for (const tag of ['zh', 'zh-CN', 'zh-Hans', 'zh-Hans-CN', 'zh-SG']) {
        expect(resolveLanguage(tag)).toBe('zh-CN');
      }
    });

    it('offers Traditional Chinese for the Traditional script and its regions', () => {
      for (const tag of ['zh-TW', 'zh-tw', 'zh-Hant', 'zh-Hant-TW', 'zh-Hant-HK', 'zh-HK', 'zh-MO']) {
        expect(resolveLanguage(tag)).toBe('zh-TW');
      }
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

  it.each(EXPECTED)('%s defines each hyperGLANCE task reminder key exactly once', (lng) => {
    const raw = readFileSync(join(process.cwd(), 'public', 'locales', lng, 'translation.json'), 'utf8');
    for (const key of ['hgUpNextWithTasks_one', 'hgUpNextWithTasks_other']) {
      expect(raw.match(new RegExp(`"${key}"\\s*:`, 'g')) ?? [], `${lng} duplicates ${key}`).toHaveLength(1);
    }
  });

  it('defines every literal translation key used by source', () => {
    const englishKeys = keysOf('en');
    const sourceFiles = [];
    const collect = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) collect(path);
        else if (/\.(js|jsx)$/.test(entry.name) && !entry.name.includes('.test.')) sourceFiles.push(path);
      }
    };
    collect(join(process.cwd(), 'src'));

    const missing = new Map();
    const literalCall = /\bt\(\s*['"]([^'"]+)['"]/g;
    for (const file of sourceFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(literalCall)) {
        const key = match[1];
        const covered = englishKeys.has(key)
          || englishKeys.has(`${key}_one`)
          || englishKeys.has(`${key}_other`);
        if (!covered) {
          const files = missing.get(key) || [];
          files.push(file);
          missing.set(key, files);
        }
      }
    }

    expect(
      [...missing].map(([key, files]) => `${key}: ${[...new Set(files)].join(', ')}`),
      'Every literal i18n call must have a real bundle entry instead of silently using an English defaultValue.',
    ).toEqual([]);
  });

  // A bundle can resolve and still be a stub, or be a copy of English that was
  // never translated. This key is carried by every translated language.
  it.each(TRANSLATED)('%s translates a shared key into its own text', (lng) => {
    const en = bundles.en.sync.errors.NETWORK_ERROR;
    const value = bundles[lng]?.sync?.errors?.NETWORK_ERROR;
    expect(value, `${lng} is missing sync.errors.NETWORK_ERROR`).toBeTypeOf('string');
    expect(value, `${lng} still carries the English string`).not.toBe(en);
  });

  /**
   * The canary above catches a bundle that is wholly a copy of English. It
   * cannot catch a handful of keys inside an otherwise translated bundle,
   * which is how five jobo.view strings shipped to eight languages in raw
   * English: key coverage was complete, every placeholder matched, and
   * nothing compared a value against en's.
   *
   * Only multi-word values are flagged. A single word matching English is
   * usually correct (Status, Start and Filter in German, Notifications and
   * Effort in French, color and error in Spanish, Model in Polish), and
   * listing those would take hundreds of entries nobody would read. A
   * multi-word English phrase is the shape the real misses take.
   */
  const englishWords = (value) =>
    [...String(value).replace(/{{[^}]*}}/g, ' ').matchAll(/[A-Za-z]{2,}/g)].map((m) => m[0]);
  const at = (bundle, key) => key.split('.').reduce((value, part) => value?.[part], bundle);
  const isEnglishPhrase = (lng, key) => {
    const value = at(bundles[lng], key);
    return typeof value === 'string' && value === at(bundles.en, key) && englishWords(value).length >= 2;
  };
  const phraseKeys = () => flatten(bundles.en).filter((k) => englishWords(at(bundles.en, k)).length >= 2);

  // Phrases that are English in other languages on purpose.
  const ENGLISH_ON_PURPOSE = {
    'backup.providerNames.nextcloud': 'Product names: Nextcloud and WebDAV.',
    'sync.form.vaultTitle': 'GLANCEvault is the product name. fr, uk and zh-CN localize the "(Beta)" part only.',
    'sync.form.vaultProToggle': 'GLANCEvault Pro is the product name, kept as is in every language.',
    'settings.liveActivity': "Live Activity is Apple's name for the feature.",
    'settings.trmnlWebhookUrl': 'TRMNL plus "Webhook URL", left technical.',
    'settings.aiOllamaUrl': 'Ollama plus "URL", left technical.',
    'task.obsidianNoteSource': 'Obsidian is the product name, and "In" is a preposition in de and it too.',
    // The least certain entry here: pl, uk and zh-CN translate it (Lista
    // marzeń, Список бажань, 心愿清单) while de, es, fr, it and pt keep the
    // English idiom. Listed as deliberate, but a native speaker may disagree.
    'bucket.title': 'Bucket List is carried as the borrowed English idiom.',
    'directAccess.title': 'Direct Access is the feature name (docs/direct-access-sync.md), kept as is in every language.',
    'icloudDiag.platformName.ios': 'Product names: iPhone / iPad.',
    'icloudDiag.platformName.web': 'Web / PWA, left technical; uk and zh-CN localize "Web".',
  };

  /**
   * Keys that still need translating, and who is waiting. The point of the
   * list is that it shrinks: translate one and the staleness checks below
   * tell you to drop that language.
   */
  const UNTRANSLATED = {
    // The JOBO Plan/Do view (5918cef) shipped these with only zh-CN done.
    'jobo.view.addDo': ['de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk'],
    'jobo.view.capturedPlan': ['de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk'],
    'jobo.view.capturedTitle': ['de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk'],
    'jobo.view.titleRequired': ['de', 'es', 'fr', 'it', 'pl', 'pt-BR', 'pt-PT', 'uk'],
  };

  it.each(TRANSLATED)('%s carries no untracked English phrase', (lng) => {
    const untracked = phraseKeys().filter((key) => isEnglishPhrase(lng, key)
      && !(key in ENGLISH_ON_PURPOSE)
      && !(UNTRANSLATED[key] ?? []).includes(lng));
    expect(
      untracked,
      `${lng} renders these in English. Translate them, or record the key in `
      + 'ENGLISH_ON_PURPOSE with a reason, or add the language to UNTRANSLATED:\n  '
      + untracked.map((k) => `${k} = ${JSON.stringify(at(bundles.en, k))}`).join('\n  '),
    ).toEqual([]);
  });

  // An entry that no language still carries has outlived its gap, whether it
  // was translated everywhere or the key was removed from the bundles.
  it('records no phrase that no language still carries', () => {
    const tracked = [...Object.keys(ENGLISH_ON_PURPOSE), ...Object.keys(UNTRANSLATED)];
    const stale = tracked.filter((key) => !TRANSLATED.some((lng) => isEnglishPhrase(lng, key)));
    expect(
      stale,
      'no language renders these in English any more, either translated or deleted; '
      + 'drop them from ENGLISH_ON_PURPOSE / UNTRANSLATED',
    ).toEqual([]);
  });

  // And a language listed as waiting that is not waiting any more.
  it('names only languages still waiting on a translation', () => {
    const done = [];
    for (const [key, waiting] of Object.entries(UNTRANSLATED)) {
      for (const lng of waiting) if (!isEnglishPhrase(lng, key)) done.push(`${key}: ${lng}`);
    }
    expect(done, 'these are translated; drop the language from UNTRANSLATED').toEqual([]);
  });

  // de/es/it/pt were 61 keys behind en, having been frozen while they were
  // unreachable. That backlog is translated, so this is now a strict parity
  // check rather than a ratchet: a key added to en without translations fails
  // here instead of silently rendering English.
  describe('coverage against en', () => {
    // Plural keys differ by language on purpose: English has one/other, Polish and
    // Ukrainian need one/few/many/other, and their ordinals use fewer categories
    // than English's one/two/few/other. Comparing key-for-key would force those
    // languages to carry forms they cannot use, or forbid the ones they must.
    const PLURAL = /_(zero|one|two|few|many|other)$/;
    const family = (key) => key.replace(PLURAL, '');
    const enFamilies = () => new Set([...keysOf('en')].map(family));
    const isPlural = (key) => PLURAL.test(key);

    it.each(TRANSLATED)('%s preserves every interpolation placeholder', (lng) => {
      const get = (bundle, key) => key.split('.').reduce((value, part) => value?.[part], bundle);
      const placeholders = (value) => [...(value || '').matchAll(/{{(.*?)}}/g)].map(match => match[1]).sort();
      // A form that exists for exactly one count may spell it out ("raz") instead
      // of interpolating it, and `plural` is English's "s" suffix, which has no
      // equivalent in a language whose noun changes by number.
      const tolerated = (key) => (name) => name !== 'plural' && !(isPlural(key) && name === 'count');
      const leaves = [...keysOf(lng)].filter((k) => keysOf('en').has(k) || keysOf('en').has(`${family(k)}_other`));
      for (const key of leaves) {
        const enKey = keysOf('en').has(key) ? key : `${family(key)}_other`;
        const want = placeholders(get(bundles.en, enKey));
        const got = placeholders(get(bundles[lng], key));
        expect(got.filter(tolerated(key)), `${lng}: ${key}`).toEqual(want.filter(tolerated(key)));
        // The tolerance is for dropping a placeholder, never for adding one.
        expect(got.every((name) => want.includes(name)), `${lng}: ${key} invents a placeholder`).toBe(true);
      }
    });

    it.each(TRANSLATED)('%s covers every key in en', (lng) => {
      const have = new Set([...keysOf(lng)].map(family));
      const missing = [...keysOf('en')].filter((k) => (isPlural(k) ? !have.has(family(k)) : !keysOf(lng).has(k)));
      expect(
        missing,
        `${lng} is missing keys that en has — translate them:\n  ${missing.slice(0, 10).join('\n  ')}`,
      ).toEqual([]);
    });

    // A language may need a plural form English has no category for. Italian
    // ordinals select `many` for 8 and 11, where English has only one/two/few/
    // other, so `ordinal_ordinal_many` is legitimate in it and absent from en.
    // Such a key is allowed when en carries the same family.
    it.each(TRANSLATED)('%s carries no keys that en does not', (lng) => {
      const known = enFamilies();
      const extra = [...keysOf(lng)].filter((k) => !keysOf('en').has(k) && !(isPlural(k) && known.has(family(k))));
      expect(extra, `${lng} has keys absent from en`).toEqual([]);
    });

    // The point of allowing different plural keys: each language must actually
    // have the forms its own rules select, or i18next falls back to the base key
    // and a count like 3 renders with the wrong noun.
    //
    // Scoped by which categories the language's rules actually select for a
    // count the app can produce (0-1000), not every category it theoretically
    // has: es/fr/it/pt reserve "many" for millions, which no count here
    // reaches, so it drops out on its own instead of needing a hardcoded list
    // of exempt languages. That exemption previously left de/es/fr/it/pt-BR/
    // pt-PT unguarded entirely.
    it.each(TRANSLATED)('%s defines every plural category its rules use', (lng) => {
      const problems = [];
      const families = new Map();
      for (const key of keysOf('en')) {
        if (isPlural(key)) families.set(family(key), key.includes('_ordinal_') ? 'ordinal' : 'cardinal');
      }
      for (const [fam, type] of families) {
        const rules = new Intl.PluralRules(lng, { type });
        const categories = new Set();
        for (let n = 0; n <= 1000; n++) categories.add(rules.select(n));
        for (const cat of categories) {
          // i18next falls back to the un-suffixed key, so a bare key covers a
          // form (task.deferredTimes, task.earlierMoves, settings.weekTimelineHidden).
          if (!keysOf(lng).has(`${fam}_${cat}`) && !keysOf(lng).has(fam)) problems.push(`${fam}_${cat}`);
        }
      }
      expect(problems, `${lng} lacks plural forms its language selects`).toEqual([]);
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
