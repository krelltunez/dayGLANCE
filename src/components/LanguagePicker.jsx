import React from 'react';
import { useTranslation } from 'react-i18next';
import { languages } from '../locales.js';

/**
 * The language's own name for itself, derived from the tag rather than a table
 * that would have to be kept in step with the locale directory.
 *
 * Intl returns these lowercase in several languages ("français", "português"),
 * which is right mid-sentence but reads as a typo in a standalone list, so the
 * first letter is uppercased in the language's own casing rules.
 */
export function nativeLanguageName(tag) {
  try {
    const name = new Intl.DisplayNames([tag], { type: 'language' }).of(tag);
    // Intl echoes the input back when it has no name for the tag.
    if (!name || name === tag) return tag;
    return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    return tag;
  }
}

/**
 * Resolve what i18next reports to one of the options actually in the list, so
 * the select never falls back to displaying its first entry while a different
 * language is live. A detected tag can be regional ("en-US") or unsupported.
 */
export function selectedLanguage(reported, available = languages) {
  if (available.includes(reported)) return reported;
  const base = String(reported ?? '').split('-')[0];
  if (available.includes(base)) return base;
  return available.includes('en') ? 'en' : available[0];
}

export default function LanguagePicker({ className, id }) {
  const { i18n } = useTranslation();
  const value = selectedLanguage(i18n.resolvedLanguage || i18n.language);

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      className={className}
    >
      {languages.map((lng) => (
        <option key={lng} value={lng}>
          {nativeLanguageName(lng)}
        </option>
      ))}
    </select>
  );
}
