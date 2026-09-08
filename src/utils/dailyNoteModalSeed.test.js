import { describe, it, expect } from 'vitest';
import { seedDailyNoteText, shouldPersistDailyNote } from './dailyNoteModalSeed.js';

const TEMPLATE = '[[<% tp.date.now("YYYY-MM-DD", -1) %>|← Yesterday]]\n\n## Tasks\n';
const REAL = '[[2026-09-07|← Yesterday]]\n## Tasks\n## Completed\n- ✅ 12:30 Topoff 20Gs\n';

describe('seedDailyNoteText', () => {
  it('shows the vault text when the read has content', () => {
    expect(seedDailyNoteText({ fresh: REAL, known: 'older copy', template: TEMPLATE }))
      .toEqual({ text: REAL, fromTemplate: false, hadContent: true });
  });

  it('falls back to the app copy when the vault read is empty or absent (the 2026-09-07 rule)', () => {
    expect(seedDailyNoteText({ fresh: '', known: REAL, template: TEMPLATE }).text).toBe(REAL);
    expect(seedDailyNoteText({ fresh: null, known: REAL, template: TEMPLATE }).text).toBe(REAL);
    expect(seedDailyNoteText({ known: REAL, template: TEMPLATE }).hadContent).toBe(true);
  });

  it('seeds the template only when neither the vault nor the app holds content', () => {
    expect(seedDailyNoteText({ fresh: '', known: '   ', template: TEMPLATE }))
      .toEqual({ text: TEMPLATE, fromTemplate: true, hadContent: false });
    expect(seedDailyNoteText({ template: null })).toEqual({ text: '', fromTemplate: false, hadContent: false });
  });
});

describe('shouldPersistDailyNote', () => {
  it('THE 2026-09-08 INCIDENT: an untouched template seed is never written back', () => {
    const seed = seedDailyNoteText({ fresh: '', known: null, template: TEMPLATE });
    expect(shouldPersistDailyNote(seed.text, seed.text, seed.hadContent)).toBe(false);
  });

  it('an untouched real note is not re-stamped on close', () => {
    const seed = seedDailyNoteText({ fresh: REAL, template: TEMPLATE });
    expect(shouldPersistDailyNote(REAL, seed.text, seed.hadContent)).toBe(false);
  });

  it('a typed change is written, template seed or not', () => {
    expect(shouldPersistDailyNote(`${TEMPLATE}- [ ] Water the plants\n`, TEMPLATE, false)).toBe(true);
    expect(shouldPersistDailyNote(`${REAL}- [ ] Water the plants\n`, REAL, true)).toBe(true);
  });

  it('clearing a note that had content is written (it becomes a deletion tombstone)', () => {
    expect(shouldPersistDailyNote('', REAL, true)).toBe(true);
  });

  it('an empty note for a date that never had content is not written', () => {
    expect(shouldPersistDailyNote('', TEMPLATE, false)).toBe(false);
    expect(shouldPersistDailyNote('  \n', '', false)).toBe(false);
  });
});
