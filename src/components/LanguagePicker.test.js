import { describe, it, expect } from 'vitest';
import { nativeLanguageName } from './LanguagePicker.jsx';
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
    ['pt-BR', 'Português (Brasil)'],
    ['pt-PT', 'Português europeu'],
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
