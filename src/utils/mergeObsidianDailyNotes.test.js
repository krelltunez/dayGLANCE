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

  it('THE 2026-09-08 PING-PONG: scanned text replacing a record stamped after the file mtime keeps that stamp', () => {
    // A device with no copy of the date saved the raw template at 19:22:43.742;
    // the real note's mtime is 18:33:02.841. Stamping the vault's text with
    // the mtime lost every LWW merge to the template copy, forever. Every
    // tier keeps local on a tie, so the equal stamp ends the loop here and
    // never outranks a genuinely newer record elsewhere.
    const prev = { '2026-09-08': note('<% template %>', '2026-09-08T19:22:43.742Z') };
    const scanned = { '2026-09-08': note('real note', '2026-09-08T18:33:02.841Z') };
    const out = mergeObsidianDailyNotes(prev, scanned)['2026-09-08'];
    expect(out.text).toBe('real note');
    expect(out.lastModified).toBe('2026-09-08T19:22:43.742Z');
    // Idempotent: the next scan of the unchanged file carries that stamp forward.
    const again = mergeObsidianDailyNotes({ '2026-09-08': out }, scanned)['2026-09-08'];
    expect(again).toEqual(out);
  });

  it('never stamps the scanned text NEWER than the record it replaces (a late older observation must not win fleet-wide)', () => {
    const prev = { '2026-09-06': note('three lines re-stamped', '2026-09-08T19:39:15.824Z') };
    const late = { '2026-09-06': note('first of the three', '2026-09-08T19:39:12.241Z') };
    const out = mergeObsidianDailyNotes(prev, late)['2026-09-06'];
    expect(out.text).toBe('first of the three');                  // the observation still wins locally
    expect(out.lastModified).toBe('2026-09-08T19:39:15.824Z');     // but ties, so every other tier keeps its own
  });

  it('a file newer than the record it replaces keeps its own mtime (the ordinary edit)', () => {
    const prev = { '2026-09-08': note('old', '2026-09-08T10:00:00.000Z') };
    const scanned = { '2026-09-08': note('edited in Obsidian', '2026-09-08T11:00:00.000Z') };
    expect(mergeObsidianDailyNotes(prev, scanned)['2026-09-08'].lastModified).toBe('2026-09-08T11:00:00.000Z');
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

  it('drops a retained note when a deletion tombstone is newer (propagates a vault delete)', () => {
    const prev = { '2026-04-06': note('a', '2026-04-06T10:00:00.000Z') };
    const tombstones = { '2026-04-06': '2026-07-07T00:00:00.000Z' };
    expect(mergeObsidianDailyNotes(prev, {}, tombstones)).toEqual({}); // gone
  });

  it('drops a scanned note that is tombstoned (deleted, not yet gone from this vault)', () => {
    const prev = {};
    const scanned = { '2026-04-06': note('a', '2026-04-06T10:00:00.000Z') };
    const tombstones = { '2026-04-06': '2026-07-07T00:00:00.000Z' };
    expect(mergeObsidianDailyNotes(prev, scanned, tombstones)).toEqual({});
  });

  it('resurrects a note re-created AFTER the tombstone (newer lastModified wins)', () => {
    const scanned = { '2026-04-06': note('rewritten', '2026-07-08T00:00:00.000Z') };
    const tombstones = { '2026-04-06': '2026-07-07T00:00:00.000Z' };
    const out = mergeObsidianDailyNotes({}, scanned, tombstones);
    expect(out['2026-04-06'].text).toBe('rewritten');
  });
});
