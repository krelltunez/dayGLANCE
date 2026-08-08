import { describe, it, expect } from 'vitest';
import { buildUpNextFact } from './liveActivity.js';

// Identity formatter — label WORDING is the caller's formatTime's business.
const fmt = (t) => t;
// Local-time epoch ms for a fixed day, mirroring how the snapshot resolves
// 'HH:MM' against the wall clock.
const at = (h, m) => new Date(2026, 7, 2, h, m, 0, 0).getTime();

describe('buildUpNextFact', () => {
  it('upcoming block: "at <start>" label, countdown runs now → start', () => {
    const f = buildUpNextFact({ title: 'Standup', startTime: '15:30', duration: 30 }, at(14, 0), fmt);
    expect(f.title).toBe('Standup');
    expect(f.inProgress).toBe(false);
    expect(f.timeLabel).toBe('at 15:30');
    expect(f.countdownStartMs).toBe(at(14, 0));
    expect(f.countdownEndMs).toBe(at(15, 30));
  });

  it('in-progress block: "until <end>" label, countdown runs start → end', () => {
    const f = buildUpNextFact({ title: 'Deep work', startTime: '13:00', duration: 120 }, at(14, 0), fmt);
    expect(f.inProgress).toBe(true);
    expect(f.timeLabel).toBe('until 15:00');
    expect(f.countdownStartMs).toBe(at(13, 0));
    expect(f.countdownEndMs).toBe(at(15, 0));
  });

  it('a block starting exactly now is in progress', () => {
    const f = buildUpNextFact({ title: 'x', startTime: '14:00', duration: 60 }, at(14, 0), fmt);
    expect(f.inProgress).toBe(true);
    expect(f.timeLabel).toBe('until 15:00');
  });

  it('an end past midnight still yields a valid label', () => {
    const f = buildUpNextFact({ title: 'x', startTime: '23:30', duration: 60 }, at(23, 45), fmt);
    expect(f.timeLabel).toBe('until 00:30');
  });

  it('handles unpadded HH:MM and missing duration', () => {
    const f = buildUpNextFact({ title: 'x', startTime: '9:5' }, at(8, 0), fmt);
    expect(f.timeLabel).toBe('at 09:05');
    expect(f.countdownEndMs).toBe(at(9, 5));
  });

  it('returns null for no entry, empty start time, or junk', () => {
    expect(buildUpNextFact(null, at(9, 0), fmt)).toBeNull();
    expect(buildUpNextFact({ title: 'x', startTime: '' }, at(9, 0), fmt)).toBeNull();
    expect(buildUpNextFact({ title: 'x', startTime: 'junk' }, at(9, 0), fmt)).toBeNull();
  });

  it('localized label words replace the English defaults', () => {
    const upcoming = buildUpNextFact({ title: 'x', startTime: '15:30', duration: 30 }, at(14, 0), fmt, { until: 'bis', at: 'um' });
    expect(upcoming.timeLabel).toBe('um 15:30');
    const running = buildUpNextFact({ title: 'x', startTime: '13:00', duration: 120 }, at(14, 0), fmt, { until: 'bis', at: 'um' });
    expect(running.timeLabel).toBe('bis 15:00');
  });

  it('passes a resolved energy through untouched', () => {
    // The snapshot builder resolves energy from the unstripped source block, so
    // a title that would derive the other way must not override it.
    const f = buildUpNextFact({ title: 'Lunch with investors', startTime: '12:00', duration: 60, energy: 'effort' }, at(11, 0), fmt);
    expect(f.energy).toBe('effort');
  });

  it('falls back to deriving energy from the title', () => {
    expect(buildUpNextFact({ title: 'Deep work', startTime: '13:00', duration: 60 }, at(12, 0), fmt).energy).toBe('effort');
    expect(buildUpNextFact({ title: 'Morning walk', startTime: '13:00', duration: 60 }, at(12, 0), fmt).energy).toBe('restore');
  });

  it('always names an energy, even with nothing to go on', () => {
    // The island tints its ring from this field; an absent value would leave the
    // ring's color undefined rather than neutral.
    expect(buildUpNextFact({ startTime: '13:00', duration: 60 }, at(12, 0), fmt).energy).toBe('effort');
  });

  it('label wording goes through the caller-provided formatter', () => {
    const twelveHour = (t) => {
      const [h, m] = t.split(':').map(Number);
      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
      return `${h12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
    };
    const f = buildUpNextFact({ title: 'x', startTime: '15:30', duration: 0 }, at(14, 0), twelveHour);
    expect(f.timeLabel).toBe('at 3:30 PM');
  });
});
