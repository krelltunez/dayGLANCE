import { describe, it, expect } from 'vitest';
import { noteTextHash } from '@glance-apps/obsidian-format';
import { fileNoteDescription, newestNoteDescription, isReportedDescription } from './linkedNoteDescription.js';

// The two-source rule for a linked note's description (#2291), the owner's
// rulings one by one. Each guard here was mutation-checked: break it and a
// test below fails.

const NOTE = (section) => `---\ndayglance-id: p1\n---\n# House\n${section}\n\n## Tasks\n- [ ] Gutters\n`;
const file = (section, lastModified) => fileNoteDescription({ text: NOTE(section), lastModified });
const report = (text, mtimeIso, observedAt = '2026-11-05T10:00:05.000Z') => ({ text, base: noteTextHash(text), observedAt, lastModified: mtimeIso });

describe('fileNoteDescription', () => {
  it('reads the section and hashes it as the loader always has; absence and an unreadable note pass through', () => {
    expect(file('Keep the roof dry.', 'L')).toEqual({ text: 'Keep the roof dry.', base: noteTextHash('Keep the roof dry.'), lastModified: 'L' });
    expect(fileNoteDescription({ notFound: true })).toEqual({ notFound: true });
    expect(fileNoteDescription(null)).toBe(null);
    expect(fileNoteDescription({ text: '' })).toEqual({ text: '', base: noteTextHash(''), lastModified: null });
  });
});

describe('newestNoteDescription', () => {
  it('never reported (null) is no information: the folder\'s answer stands, and with no folder there is none', () => {
    const f = file('Mine.', '2026-11-05T10:00:00.000Z');
    expect(newestNoteDescription(f, null)).toBe(f);
    expect(newestNoteDescription({ notFound: true }, null)).toEqual({ notFound: true });
    expect(newestNoteDescription(null, null)).toBe(null);
  });

  it('no folder, or a folder without the note: the report, marked as one', () => {
    const r = report('From Obsidian.', '2026-11-05T10:00:00.000Z');
    expect(newestNoteDescription(null, r)).toEqual({ ...r, source: 'report' });
    expect(newestNoteDescription({ notFound: true }, r)).toEqual({ ...r, source: 'report' });
    expect(isReportedDescription(newestNoteDescription(null, r))).toBe(true);
  });

  it('a deleted or withdrawn report is not found, even over a folder copy that still has the note', () => {
    expect(newestNoteDescription(null, { notFound: true })).toEqual({ notFound: true });
    expect(newestNoteDescription(file('Still here.', '2026-11-06T00:00:00.000Z'), { notFound: true })).toEqual({ notFound: true });
  });

  it('both: the newer wins, the report\'s file mtime against the local file\'s lastModified', () => {
    const r = report('Edited on the desktop.', '2026-11-05T10:00:00.000Z');
    const behind = file('Old copy.', '2026-11-05T09:59:59.000Z');
    const ahead = file('Edited here.', '2026-11-05T10:00:01.000Z');
    expect(newestNoteDescription(behind, r)).toEqual({ ...r, source: 'report' });
    expect(newestNoteDescription(ahead, r)).toBe(ahead);
    // A tie is the file's: the report must be NEWER.
    expect(newestNoteDescription(file('Same time.', '2026-11-05T10:00:00.000Z'), r)).toMatchObject({ text: 'Same time.' });
    // Native reads may give epoch milliseconds.
    expect(newestNoteDescription(file('Old copy.', Date.parse('2026-11-05T09:00:00.000Z')), r)).toMatchObject({ source: 'report' });
  });

  it('a time that is missing on either side proves nothing: the file stands', () => {
    expect(newestNoteDescription(file('Mine.', null), report('Theirs.', '2026-11-05T10:00:00.000Z'))).toMatchObject({ text: 'Mine.' });
    expect(newestNoteDescription(file('Mine.', '2026-11-05T10:00:00.000Z'), report('Theirs.', null))).toMatchObject({ text: 'Mine.' });
    expect(newestNoteDescription(file('Mine.', 'not a date'), report('Theirs.', '2026-11-05T10:00:00.000Z'))).toMatchObject({ text: 'Mine.' });
  });

  it('a newer report with the same section leaves the local reading: same text, same base, no report age', () => {
    const f = file('Same section.', '2026-11-05T09:00:00.000Z');
    const r = report('Same section.', '2026-11-05T10:00:00.000Z');
    expect(newestNoteDescription(f, r)).toBe(f);
    expect(isReportedDescription(f)).toBe(false);
  });
});
