import { describe, it, expect } from 'vitest';
import { computeTaskCalendarTombstones, computeRecurringSeriesTombstones } from './taskUtils.js';

// A synced (non-file) CalDAV task-calendar item as produced by expandMultiDayEvent.
const tcItem = (id, date, extra = {}) => ({
  id,
  date,
  isTaskCalendar: true,
  imported: true,
  importSource: 'sync',
  ...extra,
});

describe('computeTaskCalendarTombstones', () => {
  it('tombstones a non-recurring item that disappeared from the feed', () => {
    const prior = [tcItem('uid-a-2026-06-10', '2026-06-10'), tcItem('uid-b-2026-06-11', '2026-06-11')];
    const fresh = [tcItem('uid-a-2026-06-10', '2026-06-10')]; // uid-b deleted on server
    expect(computeTaskCalendarTombstones(prior, fresh)).toEqual(['uid-b-2026-06-11']);
  });

  it('returns [] when every prior item is still present', () => {
    const prior = [tcItem('uid-a-2026-06-10', '2026-06-10')];
    const fresh = [tcItem('uid-a-2026-06-10', '2026-06-10')];
    expect(computeTaskCalendarTombstones(prior, fresh)).toEqual([]);
  });

  it('treats a moved item (new date => new id) as a deletion of the old id', () => {
    const prior = [tcItem('uid-a-2026-06-10', '2026-06-10')];
    const fresh = [tcItem('uid-a-2026-06-12', '2026-06-12')]; // same VTODO, moved
    expect(computeTaskCalendarTombstones(prior, fresh)).toEqual(['uid-a-2026-06-10']);
  });

  it('skips tombstoning entirely when the fresh feed is empty (transient-glitch guard)', () => {
    const prior = [tcItem('uid-a-2026-06-10', '2026-06-10'), tcItem('uid-b-2026-06-11', '2026-06-11')];
    expect(computeTaskCalendarTombstones(prior, [])).toEqual([]);
  });

  it('never tombstones recurring-series items (v1 scope)', () => {
    const prior = [tcItem('uid-r-2026-06-10', '2026-06-10', { isRecurringSeries: true })];
    const fresh = [tcItem('uid-other-2026-06-10', '2026-06-10')]; // recurring occurrence not in fresh
    expect(computeTaskCalendarTombstones(prior, fresh)).toEqual([]);
  });

  it('ignores non-task-calendar tasks and file imports', () => {
    const prior = [
      { id: 'regular-1', date: '2026-06-10' }, // user task
      tcItem('file-1', '2026-06-10', { importSource: 'file' }), // ICS file import
      tcItem('read-only-1', '2026-06-10', { isTaskCalendar: false }), // read-only calendar event
    ];
    const fresh = [tcItem('something-else', '2026-06-10')];
    expect(computeTaskCalendarTombstones(prior, fresh)).toEqual([]);
  });

  it('only tombstones items within the retention window', () => {
    const prior = [
      tcItem('uid-old-2026-01-01', '2026-01-01'), // before cutoff
      tcItem('uid-new-2026-06-10', '2026-06-10'), // within window
    ];
    const fresh = [tcItem('uid-keep-2026-06-09', '2026-06-09')]; // both prior items gone
    const result = computeTaskCalendarTombstones(prior, fresh, { cutoffDateStr: '2026-05-13' });
    expect(result).toEqual(['uid-new-2026-06-10']);
  });

  it('considers all items when no cutoff is given', () => {
    const prior = [tcItem('uid-old-2020-01-01', '2020-01-01')];
    const fresh = [tcItem('uid-other', '2026-06-10')];
    expect(computeTaskCalendarTombstones(prior, fresh, { cutoffDateStr: null })).toEqual(['uid-old-2020-01-01']);
  });

  it('handles empty/invalid prior input gracefully', () => {
    expect(computeTaskCalendarTombstones([], [tcItem('a', '2026-06-10')])).toEqual([]);
    expect(computeTaskCalendarTombstones(null, [tcItem('a', '2026-06-10')])).toEqual([]);
  });
});

// A synced recurring-series occurrence (carries the master uid + isRecurringSeries).
const recItem = (uid, date, extra = {}) => tcItem(`${uid}-${date}`, date, {
  icalUid: uid,
  isRecurringSeries: true,
  ...extra,
});

describe('computeRecurringSeriesTombstones', () => {
  it('tombstones every occurrence of a series whose master UID left the feed', () => {
    const prior = [
      recItem('uid-r', '2026-06-10'),
      recItem('uid-r', '2026-06-17'),
      recItem('uid-r', '2026-06-24'),
    ];
    // The master VTODO uid-r is gone from the raw feed (deleted on the server).
    expect(computeRecurringSeriesTombstones(prior, new Set(['uid-other']))).toEqual([
      'uid-r-2026-06-10', 'uid-r-2026-06-17', 'uid-r-2026-06-24',
    ]);
  });

  it('leaves a series alone while its master UID is still present (normal churn)', () => {
    // Occurrence dates differ from prior (completion advanced the due date), but the
    // master UID is still in the feed — must not be mistaken for a deletion.
    const prior = [recItem('uid-r', '2026-06-10'), recItem('uid-r', '2026-06-17')];
    expect(computeRecurringSeriesTombstones(prior, new Set(['uid-r']))).toEqual([]);
  });

  it('does NOT tombstone a live series that expands to zero in-window occurrences', () => {
    // The key case: the master is still on the server (uid in presentMasterUids,
    // collected pre-expansion) but produced no occurrences this fetch. The stale
    // local occurrences must survive, not be tombstoned.
    const prior = [recItem('uid-far', '2026-06-10')];
    expect(computeRecurringSeriesTombstones(prior, new Set(['uid-far', 'uid-other']))).toEqual([]);
  });

  it('skips tombstoning entirely when the feed has no master UIDs (transient-glitch guard)', () => {
    const prior = [recItem('uid-r', '2026-06-10')];
    expect(computeRecurringSeriesTombstones(prior, new Set())).toEqual([]);
    expect(computeRecurringSeriesTombstones(prior, [])).toEqual([]);
    expect(computeRecurringSeriesTombstones(prior, null)).toEqual([]);
  });

  it('only tombstones the deleted series when several series coexist', () => {
    const prior = [
      recItem('uid-gone', '2026-06-10'),
      recItem('uid-gone', '2026-06-17'),
      recItem('uid-live', '2026-06-11'),
    ];
    expect(computeRecurringSeriesTombstones(prior, new Set(['uid-live']))).toEqual([
      'uid-gone-2026-06-10', 'uid-gone-2026-06-17',
    ]);
  });

  it('ignores non-recurring, non-task-calendar, and file-imported items', () => {
    const prior = [
      tcItem('plain-2026-06-10', '2026-06-10'), // non-recurring task-calendar (handled elsewhere)
      recItem('uid-file', '2026-06-10', { importSource: 'file' }), // ICS file import
      { id: 'regular-1', date: '2026-06-10', isRecurringSeries: true }, // not task-calendar
    ];
    expect(computeRecurringSeriesTombstones(prior, new Set(['uid-present']))).toEqual([]);
  });

  it('only tombstones occurrences within the retention window', () => {
    const prior = [
      recItem('uid-gone', '2026-01-01'), // before cutoff
      recItem('uid-gone', '2026-06-10'), // within window
    ];
    const result = computeRecurringSeriesTombstones(prior, new Set(['uid-other']), { cutoffDateStr: '2026-05-13' });
    expect(result).toEqual(['uid-gone-2026-06-10']);
  });

  it('accepts the present UIDs as a plain array', () => {
    const prior = [recItem('uid-r', '2026-06-10')];
    expect(computeRecurringSeriesTombstones(prior, ['uid-other'])).toEqual(['uid-r-2026-06-10']);
    expect(computeRecurringSeriesTombstones(prior, ['uid-r'])).toEqual([]);
  });

  it('skips recurring items missing an icalUid (defensive)', () => {
    const prior = [tcItem('no-uid-2026-06-10', '2026-06-10', { isRecurringSeries: true })];
    expect(computeRecurringSeriesTombstones(prior, new Set(['uid-other']))).toEqual([]);
  });

  it('handles empty/invalid prior input gracefully', () => {
    expect(computeRecurringSeriesTombstones([], new Set(['a']))).toEqual([]);
    expect(computeRecurringSeriesTombstones(null, new Set(['a']))).toEqual([]);
  });
});
