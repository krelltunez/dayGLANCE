import { describe, it, expect } from 'vitest';
import { nativeLanguageName, selectedLanguage } from './LanguagePicker.jsx';
import { languages } from '../locales.js';

describe('nativeLanguageName', () => {
  // The point of the picker: someone who cannot read the current UI language
  // has to recognise their own. Each name is therefore in its own language,
  // not the active one.
  it.each([
    ['de', 'Deutsch'],
    ['en', 'English'],
    ['es', 'Español'],
    ['fr', 'Français'],
    ['it', 'Italiano'],
    ['pt', 'Português'],
  ])('names %s in its own language', (tag, expected) => {
    expect(nativeLanguageName(tag)).toBe(expected);
  });

  it('covers every shipped language', () => {
    for (const lng of languages) {
      const name = nativeLanguageName(lng);
      expect(name, `${lng} has no display name`).toBeTypeOf('string');
      expect(name, `${lng} fell back to the raw tag`).not.toBe(lng);
    }
  });

  it('falls back to the tag rather than throwing on an unknown one', () => {
    expect(nativeLanguageName('zz')).toBe('zz');
    expect(nativeLanguageName(undefined)).toBe(undefined);
  });
});

describe('selectedLanguage', () => {
  // A select whose value matches no option silently displays its first entry,
  // which would show "Deutsch" to an English user.
  it('passes through a tag that is already an option', () => {
    expect(selectedLanguage('pt')).toBe('pt');
  });

  it('reduces a regional tag to the base language', () => {
    expect(selectedLanguage('en-US')).toBe('en');
    expect(selectedLanguage('pt-BR')).toBe('pt');
  });

  it('falls back to en for a language that is not shipped', () => {
    expect(selectedLanguage('ja')).toBe('en');
  });

  it('handles a missing value', () => {
    expect(selectedLanguage(undefined)).toBe('en');
    expect(selectedLanguage(null)).toBe('en');
  });

  it('falls back to the first option when en is not available', () => {
    expect(selectedLanguage('ja', ['de', 'fr'])).toBe('de');
  });

  it('always returns something the picker can render', () => {
    for (const reported of ['en', 'de-AT', 'zz', '', undefined]) {
      expect(languages).toContain(selectedLanguage(reported));
    }
  });
});
