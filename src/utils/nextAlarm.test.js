import { describe, it, expect } from 'vitest';
import { nextAlarmWithinTomorrow, alarmHHMM } from './nextAlarm.js';

// Local-time epoch ms on a fixed base day (Aug 2) + day offset.
const at = (dayOffset, h, m) => new Date(2026, 7, 2 + dayOffset, h, m, 0, 0).getTime();

describe('nextAlarmWithinTomorrow', () => {
  const now = at(0, 22, 30); // 10:30pm tonight

  it('an alarm tomorrow morning passes through', () => {
    expect(nextAlarmWithinTomorrow(now, at(1, 6, 30))).toBe(at(1, 6, 30));
  });

  it('an alarm later tonight passes through', () => {
    expect(nextAlarmWithinTomorrow(now, at(0, 23, 45))).toBe(at(0, 23, 45));
  });

  it('the end of tomorrow is inclusive; the day after is out', () => {
    expect(nextAlarmWithinTomorrow(now, at(1, 23, 59))).toBe(at(1, 23, 59));
    expect(nextAlarmWithinTomorrow(now, at(2, 0, 30))).toBeNull();
  });

  it('null, absent, or past alarms yield null', () => {
    expect(nextAlarmWithinTomorrow(now, null)).toBeNull();
    expect(nextAlarmWithinTomorrow(now, 0)).toBeNull();
    expect(nextAlarmWithinTomorrow(now, at(0, 8, 0))).toBeNull(); // this morning
  });
});

describe('alarmHHMM', () => {
  it('formats padded local HH:MM', () => {
    expect(alarmHHMM(at(1, 6, 5))).toBe('06:05');
    expect(alarmHHMM(at(1, 23, 45))).toBe('23:45');
  });
});
