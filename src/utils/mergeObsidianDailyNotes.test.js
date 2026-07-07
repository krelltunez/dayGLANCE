import { describe, it, expect } from 'vitest';
import { mergeObsidianDailyNotes } from './mergeObsidianDailyNotes.js';

const note = (text, lastModified) => ({ text, lastModified, fromObsidian: true });

describe('mergeObsidianDailyNotes', () => {
  it('keeps a note the scan did NOT produce (another device / different vault)', () => {
    // The core loop fix: device B scans only {A}, but state holds {A,B} synced from
    // device A. Merge must NOT drop B, or B pushes a DELETE that A re-adds forever.
    const prev = { '2026-04-06': note('a', 't1'), '2026-06-22': note('b', 't2') };
    const scanned = { '2026-04-06': note('a', 'scan-now') };
    const out = mergeObsidianDailyNotes(prev, scanned);
    expect(Object.keys(out).sort()).toEqual(['2026-04-06', '2026-06-22']); // B retained
    expect(out['2026-06-22']).toEqual(prev['2026-06-22']);                  // untouched
  });

  it('carries prior lastModified forward when scanned text is unchanged', () => {
    const prev = { '2026-04-06': note('body', '2026-04-06T10:00:00.000Z') };
    const scanned = { '2026-04-06': note('body', '2026-07-07T00:00:00.000Z') }; // fresh scan stamp
    expect(mergeObsidianDailyNotes(prev, scanned)['2026-04-06'].lastModified)
      .toBe('2026-04-06T10:00:00.000Z');
  });

  it('takes the scanned note (and its timestamp) when the text changed', () => {
    const prev = { '2026-04-06': note('old', '2026-04-06T10:00:00.000Z') };
    const scanned = { '2026-04-06': note('new', '2026-07-07T00:00:00.000Z') };
    const out = mergeObsidianDailyNotes(prev, scanned)['2026-04-06'];
    expect(out.text).toBe('new');
    expect(out.lastModified).toBe('2026-07-07T00:00:00.000Z');
  });

  it('adds a note new to prev with its scanned timestamp', () => {
    const out = mergeObsidianDailyNotes({}, { '2026-05-01': note('x', 'ts') });
    expect(out['2026-05-01']).toEqual(note('x', 'ts'));
  });

  it('is idempotent across repeated scans — no drift, no dropped dates', () => {
    let prev = { '2026-04-06': note('a', 't-a'), '2026-06-22': note('b', 't-b') };
    for (let scan = 0; scan < 5; scan++) {
      const out = mergeObsidianDailyNotes(prev, { '2026-04-06': note('a', `now-${scan}`) });
      expect(Object.keys(out).sort()).toEqual(['2026-04-06', '2026-06-22']);
      expect(out['2026-04-06'].lastModified).toBe('t-a'); // stable
      prev = out;
    }
  });

  it('tolerates null/undefined inputs', () => {
    expect(mergeObsidianDailyNotes(null, null)).toEqual({});
    expect(mergeObsidianDailyNotes(undefined, { d: note('t', 'ts') })).toEqual({ d: note('t', 'ts') });
    expect(mergeObsidianDailyNotes({ d: note('t', 'ts') }, null)).toEqual({ d: note('t', 'ts') });
  });
});
