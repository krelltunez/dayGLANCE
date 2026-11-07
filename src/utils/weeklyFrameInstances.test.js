import { describe, it, expect } from 'vitest';
import { weeklyFrameInstances } from './weeklyFrameInstances.js';

// The weekly review counts the frames the timeline shows (#2305): a set's
// frames only on the dates the set is active, history kept.

// 2026-11-02 .. 2026-11-08 is Monday .. Sunday.
const WEEK = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'];
const F = (id, over = {}) => ({ id, label: id, enabled: true, days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00', ...over });
const dates = (byFrame, id) => (byFrame.get(id) || []).map((i) => i.date);

describe('weeklyFrameInstances', () => {
  it('counts a set\'s frames only on the dates the set is active', () => {
    const work = { id: 'work', periods: [{ from: null, until: '2026-11-04' }] };
    const byFrame = weeklyFrameInstances([F('desk', { setId: 'work' }), F('free')], WEEK, [work]);
    expect(dates(byFrame, 'desk')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(dates(byFrame, 'free')).toEqual(WEEK.slice(0, 5));
  });

  it('keeps the review\'s own rules: no one-off frames, exceptions applied, disabled frames out', () => {
    const byFrame = weeklyFrameInstances([
      F('once', { singleDate: '2026-11-03' }),
      F('off', { enabled: false }),
      F('moved', { exceptions: { '2026-11-02': { start: '10:00', end: '11:00' }, '2026-11-03': { deleted: true } } }),
    ], WEEK, []);
    expect(byFrame.has('once')).toBe(false);
    expect(byFrame.has('off')).toBe(false);
    const moved = byFrame.get('moved');
    expect(moved.map((i) => i.date)).toEqual(['2026-11-02', '2026-11-04', '2026-11-05', '2026-11-06']);
    expect([moved[0].start, moved[0].end]).toEqual(['10:00', '11:00']);
  });
});
