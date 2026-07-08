import { describe, it, expect } from 'vitest';
import { nativeNoteLastModified } from './obsidian.js';

const NOW = '2026-07-09T12:00:00.000Z';

describe('nativeNoteLastModified (native scan uses the real file mtime)', () => {
  it('uses the real mtime the native bridge reports', () => {
    const entry = { date: '2026-05-01', text: '# note', lastModified: '2026-05-01T09:30:00.000Z' };
    expect(nativeNoteLastModified(entry, NOW)).toBe('2026-05-01T09:30:00.000Z');
  });

  it('falls back to now for an older bridge build that omits lastModified', () => {
    // Rollout safety: app updated before the native side reports mtime.
    expect(nativeNoteLastModified({ date: '2026-05-01', text: '# note' }, NOW)).toBe(NOW);
  });

  it('falls back to now for an empty-string mtime (never stamps a note with "")', () => {
    expect(nativeNoteLastModified({ lastModified: '' }, NOW)).toBe(NOW);
  });

  it('tolerates a missing/null entry', () => {
    expect(nativeNoteLastModified(null, NOW)).toBe(NOW);
    expect(nativeNoteLastModified(undefined, NOW)).toBe(NOW);
  });
});
