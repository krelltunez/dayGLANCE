import { describe, it, expect } from 'vitest';
import { preserveDailyNoteTimestamps } from './preserveDailyNoteTimestamps.js';

// The native Obsidian scan restamps `lastModified` every scan (no file mtime on
// the bridge). These tests lock in that an unchanged note round-trips with a
// STABLE lastModified — so it does not false-diff / re-push every scan (the SSE
// self-nudge loop) — while a genuine text edit still advances the timestamp.

const scanned = (text, lastModified) => ({ text, lastModified, fromObsidian: true });

describe('preserveDailyNoteTimestamps', () => {
  it('keeps the prior lastModified when a note text is unchanged', () => {
    const prev = { '2026-04-19': scanned('## Notes', '2026-04-19T10:00:00.000Z') };
    const incoming = { '2026-04-19': scanned('## Notes', '2026-07-07T14:22:31.004Z') }; // fresh scan stamp
    const out = preserveDailyNoteTimestamps(prev, incoming);
    expect(out['2026-04-19'].lastModified).toBe('2026-04-19T10:00:00.000Z'); // stable, not the scan stamp
    expect(out['2026-04-19'].text).toBe('## Notes');
    expect(out['2026-04-19'].fromObsidian).toBe(true);
  });

  it('is idempotent across repeated scans — lastModified never drifts', () => {
    let prev = { '2026-04-19': scanned('body', '2026-04-19T10:00:00.000Z') };
    for (let scan = 0; scan < 5; scan++) {
      // Each scan hands us a brand-new "now" timestamp (what the native bridge does).
      const incoming = { '2026-04-19': scanned('body', `2026-07-0${scan + 1}T00:00:00.000Z`) };
      const out = preserveDailyNoteTimestamps(prev, incoming);
      expect(out['2026-04-19'].lastModified).toBe('2026-04-19T10:00:00.000Z'); // never moves
      prev = out; // persist + reload next scan
    }
  });

  it('advances lastModified when the note text genuinely changed', () => {
    const prev = { '2026-04-19': scanned('old body', '2026-04-19T10:00:00.000Z') };
    const incoming = { '2026-04-19': scanned('new body', '2026-07-07T14:22:31.004Z') };
    const out = preserveDailyNoteTimestamps(prev, incoming);
    expect(out['2026-04-19'].lastModified).toBe('2026-07-07T14:22:31.004Z'); // real edit wins
    expect(out['2026-04-19'].text).toBe('new body');
  });

  it('keeps the incoming timestamp for a note new to prev', () => {
    const out = preserveDailyNoteTimestamps({}, { '2026-05-01': scanned('x', '2026-05-01T09:00:00.000Z') });
    expect(out['2026-05-01'].lastModified).toBe('2026-05-01T09:00:00.000Z');
  });

  it('drops notes no longer present in the scan (Obsidian is the sole source)', () => {
    const prev = { '2026-04-19': scanned('a', '2026-04-19T10:00:00.000Z') };
    const out = preserveDailyNoteTimestamps(prev, { '2026-04-20': scanned('b', '2026-04-20T10:00:00.000Z') });
    expect(out['2026-04-19']).toBeUndefined();
    expect(out['2026-04-20']).toBeDefined();
  });

  it('tolerates null/undefined inputs', () => {
    expect(preserveDailyNoteTimestamps(null, null)).toEqual({});
    expect(preserveDailyNoteTimestamps(undefined, { d: scanned('t', 'ts') })).toEqual({ d: scanned('t', 'ts') });
  });
});
