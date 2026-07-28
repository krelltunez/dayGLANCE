import { describe, it, expect } from 'vitest';
import { parseQuickAdd, stripSpans, spanSignature } from './quickAddParser.js';

// Pinned clock: Monday, July 27 2026, 10:00 local.
// Derived anchors used throughout:
//   today            → 2026-07-27 (Mon)
//   tomorrow         → 2026-07-28 (Tue)
//   friday           → 2026-07-31
//   monday           → 2026-08-03 (today IS Monday → next week, sigil semantics)
//   next week        → 2026-08-03
const NOW = new Date(2026, 6, 27, 10, 0, 0);

const P = (text) => parseQuickAdd(text, { now: NOW });
const span = (result, type) => result.spans.find((s) => s.type === type);

describe('parseQuickAdd — headline', () => {
  it('parses "dentist tomorrow 3pm every 2 weeks" into date + time + recurrence', () => {
    const r = P('dentist tomorrow 3pm every 2 weeks');
    expect(span(r, 'date')).toMatchObject({ value: '2026-07-28', display: 'Tomorrow', text: 'tomorrow' });
    expect(span(r, 'time')).toMatchObject({ value: '15:00', display: '3:00 PM', text: '3pm' });
    expect(span(r, 'recurrence')).toMatchObject({
      value: { type: 'biweekly' },
      display: 'Every 2 weeks',
      text: 'every 2 weeks',
    });
    expect(stripSpans('dentist tomorrow 3pm every 2 weeks', r.spans)).toBe('dentist');
  });
});

describe('dates', () => {
  it.each([
    ['pay bills today', '2026-07-27', 'Today'],
    ['ship tmrw', '2026-07-28', 'Tomorrow'],
    ['review tom', '2026-07-28', 'Tomorrow'],
    ['groceries friday', '2026-07-31', 'Friday'],
    ['groceries fri', '2026-07-31', 'Friday'],
    ['standup monday', '2026-08-03', 'Monday'], // today is Monday → next one
    ['call next tuesday', '2026-07-28', 'Next Tuesday'],
    ['plan next week', '2026-08-03', 'Next week'],
    ['follow up in 3 days', '2026-07-30', 'In 3 days'],
    ['renew in 2 weeks', '2026-08-10', 'In 2 weeks'],
    ['checkup in a month', '2026-08-27', 'In 1 month'],
    ['party on dec 1', '2026-12-01', 'Dec 1'],
    ['taxes june 3', '2027-06-03', 'Jun 3, 2027'], // past this year → rolls forward
    ['review june 3rd 2027', '2027-06-03', 'Jun 3, 2027'],
    ['dentist 8/15', '2026-08-15', 'Aug 15'],
    ['renewal 3/4', '2027-03-04', 'Mar 4, 2027'], // past → rolls forward
  ])('%s → %s (%s)', (text, value, display) => {
    const r = P(text);
    expect(span(r, 'date')).toMatchObject({ value, display });
  });

  it('parses date + day-part with implied time', () => {
    const r = P('gym tomorrow morning');
    expect(span(r, 'date')).toMatchObject({ value: '2026-07-28', display: 'Tomorrow morning', impliedTime: '09:00' });
  });

  it('parses "tonight" as today with implied 9 PM', () => {
    const r = P('movie tonight');
    expect(span(r, 'date')).toMatchObject({ value: '2026-07-27', display: 'Tonight', impliedTime: '21:00' });
  });

  it('parses "this afternoon" as today with implied time', () => {
    const r = P('errands this afternoon');
    expect(span(r, 'date')).toMatchObject({ value: '2026-07-27', impliedTime: '14:00' });
  });

  it('includes the "on" connector in the span so stripping is clean', () => {
    const r = P('dentist on friday');
    expect(span(r, 'date').text).toBe('on friday');
    expect(stripSpans('dentist on friday', r.spans)).toBe('dentist');
  });

  it('does NOT parse bare month names ("email May about budget")', () => {
    expect(span(P('email May about budget'), 'date')).toBeUndefined();
  });

  it('does NOT parse invalid calendar dates (feb 30, 2/30)', () => {
    expect(span(P('note feb 30'), 'date')).toBeUndefined();
    expect(span(P('note 2/30'), 'date')).toBeUndefined();
  });

  it('last date wins when several appear', () => {
    const r = P('move sat to sun');
    expect(span(r, 'date').display).toBe('Sunday');
  });
});

describe('times', () => {
  it.each([
    ['call mom 3pm', '15:00', '3:00 PM'],
    ['call mom at 3:30 pm', '15:30', '3:30 PM'],
    ['sync 9am', '09:00', '9:00 AM'],
    ['ops review 15:00', '15:00', '3:00 PM'],
    ['brief at 9:30', '09:30', '9:30 AM'],
    ['lunch at noon', '12:00', '12:00 PM'],
    ['backup at midnight', '00:00', '12:00 AM'],
    ['12pm check', '12:00', '12:00 PM'],
    ['12am check', '00:00', '12:00 AM'],
  ])('%s → %s', (text, value, display) => {
    const r = P(text);
    expect(span(r, 'time')).toMatchObject({ value, display });
  });

  it.each([
    ['call at 3', '15:00'], // 1-7 bare → PM (working-hours rule)
    ['call at 7', '19:00'],
    ['standup at 8', '08:00'], // 8-11 bare → AM
    ['standup at 11', '11:00'],
    ['lunch at 12', '12:00'], // 12 bare → noon
    ['ops at 14', '14:00'], // ≥13 → 24h literal
  ])('bare-hour rule: %s → %s', (text, value) => {
    expect(span(P(text), 'time')).toMatchObject({ value });
  });

  it('does NOT parse a bare number without the "at" anchor', () => {
    expect(span(P('review section 3'), 'time')).toBeUndefined();
  });

  it('includes the "at" connector in the span text', () => {
    const r = P('dinner at 6pm');
    expect(span(r, 'time').text).toBe('at 6pm');
    expect(stripSpans('dinner at 6pm', r.spans)).toBe('dinner');
  });
});

describe('time ranges → startTime + duration', () => {
  it.each([
    ['meeting 3-4pm', '15:00', 60],
    ['meeting 3pm-5pm', '15:00', 120],
    ['flight from 9 to 11', '09:00', 120],
    ['deep work 9:30-11:00', '09:30', 90],
    ['brunch 11-1pm', '11:00', 120], // pm back-propagation would overshoot → AM start
    ['shift 11pm to 1am', '23:00', 120], // overnight wrap
    ['workshop from 1 to 4:30', '13:00', 210],
  ])('%s → start %s, %d min', (text, startTime, duration) => {
    const r = P(text);
    expect(span(r, 'timerange')).toMatchObject({ value: { startTime, duration } });
  });

  it('does NOT parse an unanchored "N-N" (section numbers)', () => {
    const r = P('read sections 3-4');
    expect(span(r, 'timerange')).toBeUndefined();
    expect(span(r, 'time')).toBeUndefined();
  });

  it('range beats single time for the same text', () => {
    const r = P('sync 3-4pm');
    expect(span(r, 'timerange')).toBeDefined();
    expect(span(r, 'time')).toBeUndefined();
  });
});

describe('recurrence', () => {
  it.each([
    ['water plants every day', { type: 'daily' }, 'Every day'],
    ['journal daily', { type: 'daily' }, 'Every day'],
    ['standup every weekday', { type: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] }, 'Every weekday (Mon-Fri)'],
    ['hike every weekend', { type: 'weekly', daysOfWeek: [0, 6] }, 'Every weekend (Sat-Sun)'],
    ['review every week', { type: 'weekly' }, 'Every week'],
    ['sync every monday', { type: 'weekly', daysOfWeek: [1] }, 'Every week on Monday'],
    ['gym every mon and wed', { type: 'weekly', daysOfWeek: [1, 3] }, 'Every week on Mon/Wed'],
    ['run every tue/thu/sat', { type: 'weekly', daysOfWeek: [2, 4, 6] }, 'Every week on Tue/Thu/Sat'],
    ['payday every 2 weeks', { type: 'biweekly' }, 'Every 2 weeks'],
    ['sprint every other week', { type: 'biweekly' }, 'Every 2 weeks'],
    ['1:1 every other friday', { type: 'biweekly', daysOfWeek: [5] }, 'Every 2 weeks on Friday'],
    ['sync every 2 weeks on tue', { type: 'biweekly', daysOfWeek: [2] }, 'Every 2 weeks on Tuesday'],
    ['rent every month', { type: 'monthly' }, 'Every month'],
    ['invoice monthly', { type: 'monthly' }, 'Every month'],
    ['rent every 1st', { type: 'monthly', monthDay: 1, monthWeekday: null }, 'Monthly on the 1st'],
    ['payroll every 15th of the month', { type: 'monthly', monthDay: 15, monthWeekday: null }, 'Monthly on the 15th'],
    ['retro every first monday of the month', { type: 'monthly', monthDay: null, monthWeekday: { week: 1, day: 1 } }, 'Monthly on the 1st Monday'],
    ['insurance every year', { type: 'yearly' }, 'Every year'],
    ['renewal annually', { type: 'yearly' }, 'Every year'],
  ])('%s', (text, value, display) => {
    const r = P(text);
    expect(span(r, 'recurrence')).toMatchObject({ value, display });
  });

  it('parses "every morning" as daily with implied time', () => {
    const r = P('meditate every morning');
    expect(span(r, 'recurrence')).toMatchObject({ value: { type: 'daily' }, impliedTime: '09:00' });
  });

  it('recurrence claims its weekday — "every monday" is not also a date', () => {
    const r = P('sync every monday');
    expect(span(r, 'date')).toBeUndefined();
  });

  it('does NOT parse unrepresentable intervals (engine honesty)', () => {
    expect(span(P('water every 3 days'), 'recurrence')).toBeUndefined();
    expect(span(P('report every 6 weeks'), 'recurrence')).toBeUndefined();
    expect(span(P('deep clean every 2 months'), 'recurrence')).toBeUndefined();
  });
});

describe('durations', () => {
  it.each([
    ['deep work for 90 min', 90],
    ['deep work for 1.5 hours', 90],
    ['call for an hour', 60],
    ['nap for half an hour', 30],
    ['pairing for 1h 30m', 90],
    ['workout 45m', 45],
    ['focus 2h', 120],
    ['focus 1h30m', 90],
  ])('%s → %d min', (text, mins) => {
    expect(span(P(text), 'duration')).toMatchObject({ value: mins });
  });

  it('does NOT steal spaced units or tiny values', () => {
    expect(span(P('run 100 m sprint'), 'duration')).toBeUndefined();
    expect(span(P('grab 3m hex key'), 'duration')).toBeUndefined();
    expect(span(P('swim for 5 miles'), 'duration')).toBeUndefined();
  });
});

describe('tags', () => {
  it('emits a chip per tag and keeps tag text in the title on strip', () => {
    const r = P('gym #fitness #health tomorrow');
    const tags = r.spans.filter((s) => s.type === 'tag');
    expect(tags.map((t) => t.value)).toEqual(['fitness', 'health']);
    expect(stripSpans('gym #fitness #health tomorrow', r.spans)).toBe('gym #fitness #health');
  });
});

describe('sigil coexistence', () => {
  it('never double-parses inside a sigil region', () => {
    // The @sigil region extends greedily (same as cleanTitle) — the whole
    // trailing region belongs to the sigil system, not the NL layer.
    const r = P('review @tomorrow 3pm');
    expect(span(r, 'date')).toBeUndefined();
    expect(span(r, 'time')).toBeUndefined();
  });

  it('parses NL text that precedes a sigil', () => {
    const r = P('review 3pm @tomorrow');
    expect(span(r, 'time')).toMatchObject({ value: '15:00' });
    expect(span(r, 'date')).toBeUndefined();
  });

  it('ignores ~time and %duration sigil regions', () => {
    const r = P('write up %45 ~3pm');
    expect(span(r, 'time')).toBeUndefined();
    expect(span(r, 'duration')).toBeUndefined();
  });
});

describe('combinations', () => {
  it('date + range + tag: "board prep #work friday 2-3:30pm"', () => {
    const r = P('board prep #work friday 2-3:30pm');
    expect(span(r, 'tag')).toMatchObject({ value: 'work' });
    expect(span(r, 'date')).toMatchObject({ value: '2026-07-31' });
    expect(span(r, 'timerange')).toMatchObject({ value: { startTime: '14:00', duration: 90 } });
    expect(stripSpans('board prep #work friday 2-3:30pm', r.spans)).toBe('board prep #work');
  });

  it('recurrence + time: "standup every weekday at 9:15"', () => {
    const r = P('standup every weekday at 9:15');
    expect(span(r, 'recurrence')).toMatchObject({ value: { type: 'weekly', daysOfWeek: [1, 2, 3, 4, 5] } });
    expect(span(r, 'time')).toMatchObject({ value: '09:15' });
    expect(stripSpans('standup every weekday at 9:15', r.spans)).toBe('standup');
  });

  it('duration + date: "deep work for 2 hours tomorrow"', () => {
    const r = P('deep work for 2 hours tomorrow');
    expect(span(r, 'duration')).toMatchObject({ value: 120 });
    expect(span(r, 'date')).toMatchObject({ value: '2026-07-28' });
    expect(stripSpans('deep work for 2 hours tomorrow', r.spans)).toBe('deep work');
  });
});

describe('plumbing', () => {
  it('returns no spans for empty/plain text', () => {
    expect(P('').spans).toEqual([]);
    expect(P('buy milk').spans).toEqual([]);
    expect(P('summarize meeting notes').spans).toEqual([]);
  });

  it('span.text always mirrors the original slice', () => {
    const text = 'dentist Tomorrow 3PM every 2 weeks';
    const r = P(text);
    for (const s of r.spans) {
      expect(s.text).toBe(text.slice(s.start, s.end));
    }
  });

  it('spanSignature is stable across case', () => {
    const a = span(P('x Tomorrow'), 'date');
    const b = span(P('x tomorrow'), 'date');
    expect(spanSignature(a)).toBe(spanSignature(b));
  });

  it('is deterministic: same input + now → identical output', () => {
    const one = P('dentist tomorrow 3pm every 2 weeks');
    const two = P('dentist tomorrow 3pm every 2 weeks');
    expect(one).toEqual(two);
  });
});
