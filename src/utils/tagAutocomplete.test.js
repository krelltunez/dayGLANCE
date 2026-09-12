import { describe, it, expect } from 'vitest';
import { extractTags, TAG_BODY_CHAR, TAG_NAME } from './taskUtils.js';
import { getPartialTag, getFilteredTags } from './suggestionParser.js';

// Regression cover for #1614. extractTags was Unicode-aware (`\p{L}` with the
// `u` flag) while getPartialTag was ASCII-only, so a non-Latin tag stored and
// filtered correctly but its autocomplete never appeared: the only way to reuse
// an existing tag was to retype it in full. The same mismatch also broke
// completion of nested tags, because `/` is not a `\w` character.
//
// Both now build on the one tag alphabet exported from taskUtils, so the two
// halves cannot drift apart again.

const at = (text) => getPartialTag(text, text.length);

describe('tag alphabet is shared by extraction and completion', () => {
  it.each([
    ['工作', 'CJK'],
    ['café', 'accented Latin'],
    ['Привет', 'Cyrillic'],
    ['πλάνο', 'Greek'],
    ['work', 'ASCII'],
    ['work/deep', 'nested'],
    ['to-do', 'hyphenated'],
    ['home_2', 'digits and underscore'],
  ])('accepts %s (%s) for both extraction and completion', (tag) => {
    expect(extractTags(`note #${tag}`)).toEqual([tag.toLowerCase()]);
    expect(TAG_NAME.test(tag)).toBe(true);
    expect(at(`note #${tag}`)).toEqual({ tag: tag.toLowerCase(), startIndex: 5 });
  });

  it.each(['1bad', '-bad', '/bad'])('rejects %s from both, tags must start with a letter', (tag) => {
    expect(extractTags(`note #${tag}`)).toEqual([]);
    expect(TAG_NAME.test(tag)).toBe(false);
    expect(at(`note #${tag}`)).toBeNull();
  });
});

describe('getPartialTag', () => {
  it('completes a partially typed non-Latin tag', () => {
    expect(at('报告 #工')).toEqual({ tag: '工', startIndex: 3 });
    expect(at('note #ca')).toEqual({ tag: 'ca', startIndex: 5 });
  });

  it('completes a partially typed nested tag past the slash', () => {
    expect(at('a #work/de')).toEqual({ tag: 'work/de', startIndex: 2 });
  });

  it('returns an empty partial immediately after the hash', () => {
    expect(at('note #')).toEqual({ tag: '', startIndex: 5 });
  });

  it('stops at characters that cannot appear in a tag', () => {
    expect(TAG_BODY_CHAR.test(' ')).toBe(false);
    expect(at('no hash here')).toBeNull();
    expect(at('#done then more words')).toBeNull();
  });

  it('does not cross an earlier sigil to find a hash', () => {
    expect(at('#tag ~15:00')).toBeNull();
  });
});

describe('getFilteredTags', () => {
  it('filters non-Latin tags by prefix so the dropdown can offer them', () => {
    const all = ['工作', '工具', 'work', 'café'];
    expect(getFilteredTags('工', all)).toEqual(['工作', '工具']);
    expect(getFilteredTags('caf', all)).toEqual(['café']);
    expect(getFilteredTags('', all)).toEqual([...all].sort());
  });
});
