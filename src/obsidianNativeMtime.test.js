import { describe, it, expect, vi, afterEach } from 'vitest';
import { nativeNoteLastModified, syncObsidianVaultNative } from './obsidian.js';

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

describe('AUDIT FIX M10 (revival half) — the native scan reports revival evidence from REAL mtimes only', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a note whose entry carries no mtime gets the "now" text stamp but NO noteMtimes entry; a real mtime is carried through', async () => {
    const NOTE = '# Day\n\n## Tasks\n- [ ] 09:00 Something #obsidian\n';
    vi.stubGlobal('window', {
      DayGlanceObsidian: {
        getAllDailyNotes: () => JSON.stringify([
          { date: '2026-05-01', text: NOTE, lastModified: '2026-05-01T09:30:00.000Z' },
          { date: '2026-05-02', text: NOTE }, // old bridge build: no mtime
        ]),
      },
    });
    const result = await syncObsidianVaultNative('', 30, [], []);
    expect(result.dailyNotes['2026-05-01'].lastModified).toBe('2026-05-01T09:30:00.000Z');
    expect(typeof result.dailyNotes['2026-05-02'].lastModified).toBe('string'); // the note-text stamp still exists
    expect(result.noteMtimes).toEqual({ '2026-05-01': '2026-05-01T09:30:00.000Z' }); // but it is not evidence
  });
});
