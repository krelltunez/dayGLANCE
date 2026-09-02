import { describe, it, expect } from 'vitest';
import { routinesForDate } from './routines.js';
import { splitTitle } from './title.js';

describe('routinesForDate', () => {
  const chips = [
    { id: 'b', name: 'Stretch', startTime: null, isAllDay: true, duration: 15, lastModified: '2026-09-02T13:00:00.000Z' },
    { id: 'a', name: 'Coffee', startTime: '07:30', isAllDay: false, duration: 15, lastModified: '2026-09-02T13:00:00.000Z' },
    { id: 'c', name: 'Journal', startTime: '07:00', isAllDay: false, duration: 10, lastModified: '2026-09-02T13:00:00.000Z' },
  ];

  it('answers only for the stamped routinesDate, all-day first then by time, with completions marked', () => {
    const out = routinesForDate({ todayRoutines: chips, routinesDate: '2026-09-02', routineCompletions: { a: '2026-09-02', c: '2026-09-01' } }, '2026-09-02');
    expect(out.map((r) => r.name)).toEqual(['Stretch', 'Journal', 'Coffee']);
    expect(out.find((r) => r.id === 'a').completed).toBe(true);
    expect(out.find((r) => r.id === 'c').completed).toBe(false); // yesterday's completion does not carry
    expect(routinesForDate({ todayRoutines: chips, routinesDate: '2026-09-02' }, '2026-09-03')).toEqual([]);
  });

  it('without a routinesDate, falls back to the local day each chip was touched', () => {
    const local = new Date(2026, 8, 2, 9, 0, 0).toISOString();
    const out = routinesForDate({ todayRoutines: [{ id: 'x', name: 'Walk', startTime: '08:00', lastModified: local }] }, '2026-09-02');
    expect(out).toHaveLength(1);
    expect(routinesForDate({ todayRoutines: [{ id: 'x', name: 'Walk', startTime: '08:00', lastModified: local }] }, '2026-09-01')).toEqual([]);
  });

  it('treats a time-bearing chip flagged isAllDay as all-day (the app clears the time on unplace)', () => {
    const out = routinesForDate({ todayRoutines: [{ id: 'x', name: 'Walk', startTime: '08:00', isAllDay: true, lastModified: '2026-09-02T13:00:00.000Z' }], routinesDate: '2026-09-02' }, '2026-09-02');
    expect(out[0]).toMatchObject({ startTime: null, isAllDay: true });
  });
});

describe('splitTitle', () => {
  it('segments tags and wikilinks, keeping text verbatim and aliases as display text', () => {
    expect(splitTitle('Call [[Alice Smith|Alice]] about #work/deep and #Q3-plan')).toEqual([
      { type: 'text', text: 'Call ' },
      { type: 'link', text: 'Alice', target: 'Alice Smith' },
      { type: 'text', text: ' about ' },
      { type: 'tag', text: '#work/deep', tag: 'work/deep' },
      { type: 'text', text: ' and ' },
      { type: 'tag', text: '#Q3-plan', tag: 'q3-plan' },
    ]);
  });

  it('plain titles come back as one text segment; a bare link uses its target as text; #1 is not a tag', () => {
    expect(splitTitle('Buy milk')).toEqual([{ type: 'text', text: 'Buy milk' }]);
    expect(splitTitle('[[Weekly review]]')).toEqual([{ type: 'link', text: 'Weekly review', target: 'Weekly review' }]);
    expect(splitTitle('Issue #1')).toEqual([{ type: 'text', text: 'Issue #1' }]);
    expect(splitTitle('')).toEqual([]);
  });
});
