import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../public/locales/en/translation.json';
import { languages, loaders } from './locales.js';

// Resolves a language from the lazy chunks in locales.js. i18next only asks for
// a language it is about to use, so this fetches one bundle, not six.
const lazyBundles = {
  type: 'backend',
  init() {},
  read(lng, ns, callback) {
    const load = loaders[lng];
    // Not a crash: i18next falls back to en, which is bundled below.
    if (!load) return callback(new Error(`no translation bundle for ${lng}`), null);
    load().then(
      (translation) => callback(null, translation),
      (err) => callback(err, null),
    );
  },
};

// en stays inlined even though the backend could fetch it. It is the fallback
// every other language leans on for untranslated keys, so it has to be present
// synchronously — including when a chunk fetch fails offline.
export const ready = i18n
  .use(lazyBundles)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: languages,
    ns: ['translation'],
    defaultNS: 'translation',
    resources: {
      en: { translation: en },
    },
    // Without this, the inlined en above would tell i18next every language is
    // already in memory and the backend would never be consulted.
    partialBundledLanguages: true,
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
  });

export default i18n;
