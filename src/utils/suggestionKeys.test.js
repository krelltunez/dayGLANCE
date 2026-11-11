import { describe, expect, it } from 'vitest';
import { acceptsSuggestion, isComposingKey } from './suggestionKeys.js';
import { suggestionAlreadyTyped } from './suggestionParser.js';

// #2379: Enter accepts the highlighted title suggestion, as Tab and Space do,
// unless it is already typed; nothing accepts while an input method composes.

const tag = (value) => ({ type: 'tag', value, display: `#${value}` });
const key = (k, over = {}) => ({ key: k, nativeEvent: {}, ...over });
const at = (text) => ({ text, cursor: text.length });

describe('suggestionAlreadyTyped', () => {
  it('a tag typed in full, whatever its case, is typed; a part of one is not', () => {
    expect(suggestionAlreadyTyped('Plan #work', 10, tag('work'))).toBe(true);
    expect(suggestionAlreadyTyped('Plan #Work', 10, tag('work'))).toBe(true);
    expect(suggestionAlreadyTyped('Plan #wo', 8, tag('work'))).toBe(false);
    expect(suggestionAlreadyTyped('Plan #work', 10, tag('workshop'))).toBe(false);
  });

  it('a shortcut typed in full is typed; a part of one is not', () => {
    const tomorrow = { type: 'date', value: '2026-11-12', keyword: 'tomorrow', startIndex: 5, endIndex: 9 };
    expect(suggestionAlreadyTyped('Call @tom', 9, tomorrow)).toBe(false);
    expect(suggestionAlreadyTyped('Call @tomorrow', 14, { ...tomorrow, endIndex: 14 })).toBe(true);
  });

  it('a suggestion with nothing to complete counts as typed', () => {
    expect(suggestionAlreadyTyped('Call', 4, { type: 'priority', value: 2 })).toBe(true);
    expect(suggestionAlreadyTyped('Call', 4, null)).toBe(true);
  });
});

describe('acceptsSuggestion', () => {
  it('Tab and Space accept, as before', () => {
    expect(acceptsSuggestion(key('Tab'), { ...at('#wo'), suggestion: tag('work') })).toBe(true);
    expect(acceptsSuggestion(key(' '), { ...at('#wo'), suggestion: tag('work') })).toBe(true);
  });

  // MUTATION: leave Enter out and the highlighted tag is saved past (#2379).
  it('Enter accepts a suggestion not yet typed in full', () => {
    expect(acceptsSuggestion(key('Enter'), { ...at('Plan #wo'), suggestion: tag('work') })).toBe(true);
  });

  // MUTATION: drop the check and a fully typed tag takes two presses to save.
  it('Enter saves when the suggestion is already typed', () => {
    expect(acceptsSuggestion(key('Enter'), { ...at('Plan #work'), suggestion: tag('work') })).toBe(false);
  });

  it('Ctrl/Cmd+Enter (save from any field) and other modified Enters never accept', () => {
    for (const mod of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey']) {
      expect(acceptsSuggestion(key('Enter', { [mod]: true }), { ...at('#wo'), suggestion: tag('work') })).toBe(false);
    }
  });

  // MUTATION: drop the guard and confirming 工作 with Enter (or picking it with Space) takes a tag.
  it('no key accepts while an input method is composing', () => {
    for (const k of ['Enter', ' ', 'Tab']) {
      expect(acceptsSuggestion(key(k, { nativeEvent: { isComposing: true } }), { ...at('#wo'), suggestion: tag('work') })).toBe(false);
      expect(acceptsSuggestion(key(k, { nativeEvent: { keyCode: 229 } }), { ...at('#wo'), suggestion: tag('work') })).toBe(false);
    }
    expect(isComposingKey({ isComposing: true })).toBe(true);
    expect(isComposingKey({ key: 'Enter' })).toBe(false);
  });

  it('other keys do not accept', () => {
    expect(acceptsSuggestion(key('a'), { ...at('#wo'), suggestion: tag('work') })).toBe(false);
    expect(acceptsSuggestion(key('ArrowDown'), { ...at('#wo'), suggestion: tag('work') })).toBe(false);
  });
});
