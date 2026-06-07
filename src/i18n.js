import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import en from '../public/locales/en/translation.json';
import fr from '../public/locales/fr/translation.json';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    supportedLngs: ['en', 'fr'],
    ns: ['translation'],
    defaultNS: 'translation',
    resources: {
      en: { translation: en },
      fr: { translation: fr },
    },
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['navigator', 'htmlTag'],
      caches: ['localStorage'],
    },
  });

export default i18n;
