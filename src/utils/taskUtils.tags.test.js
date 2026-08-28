import { describe, it, expect } from 'vitest';
import { extractTags } from './taskUtils.js';

// Drive-by from the Phase 4 investigation: extractTags now accepts
// Obsidian's full tag alphabet, so nested and hyphenated tags survive
// instead of truncating at the first `/` or `-`.
describe('extractTags', () => {
  it('extracts simple tags, lowercased, letter-start required', () => {
    expect(extractTags('Do thing #Work and #home_2')).toEqual(['work', 'home_2']);
    expect(extractTags('no tags here')).toEqual([]);
    expect(extractTags('#123 numeric start ignored')).toEqual([]);
  });

  it('nested and hyphenated tags come through whole', () => {
    expect(extractTags('Deep work #work/deep')).toEqual(['work/deep']);
    expect(extractTags('Errand #to-do')).toEqual(['to-do']);
    expect(extractTags('#a/b/c nested twice')).toEqual(['a/b/c']);
  });

  it('the #obsidian display tag still extracts as before', () => {
    expect(extractTags('Buy milk #obsidian')).toEqual(['obsidian']);
  });
});
