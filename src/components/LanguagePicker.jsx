import React from 'react';
import { useTranslation } from 'react-i18next';
import { languages, resolveLanguage } from '../locales.js';

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

export default function LanguagePicker({ className, id }) {
  const { i18n } = useTranslation();
  // Same resolver the detector uses, so the option shown always matches the
  // language actually rendering. A select whose value matches no option
  // silently displays its first entry instead.
  const value = resolveLanguage(i18n.resolvedLanguage || i18n.language);

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
