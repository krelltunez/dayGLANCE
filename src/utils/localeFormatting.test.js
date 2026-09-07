import { describe, expect, it } from 'vitest';
import {
  defaultUse24HourClock,
  defaultWeekStartDay,
  formatLocalizedDate,
  formatLocalizedDurationMinutes,
  localizedWeekdays,
} from './localeFormatting.js';

describe('Simplified Chinese locale formatting', () => {
  it.each([['de', 1], ['fr', 1], ['es', 1], ['it', 1], ['pt-PT', 0], ['en-GB', 1]])('uses regional week and clock defaults for %s', (locale, firstDay) => {
    expect(defaultUse24HourClock(locale)).toBe(true);
    expect(defaultWeekStartDay(locale)).toBe(firstDay);
  });

  it('uses the Chinese clock and week defaults for a fresh profile', () => {
    expect(defaultUse24HourClock('zh-CN')).toBe(true);
    expect(defaultWeekStartDay('zh-CN')).toBe(1);
    expect(defaultUse24HourClock('en')).toBe(false);
    expect(defaultWeekStartDay('en')).toBe(0);
  });

  it('formats dates and weekdays in Chinese order', () => {
    const date = new Date(2026, 7, 31, 12);
    expect(formatLocalizedDate(date, { weekday: 'short', month: 'long', day: 'numeric' }, 'zh-CN'))
      .toBe('8月31日周一');
    expect(localizedWeekdays('short', 'zh-CN')).toEqual([
      '周日', '周一', '周二', '周三', '周四', '周五', '周六',
    ]);
  });

  it('formats durations with Chinese units', () => {
    expect(formatLocalizedDurationMinutes(0, 'zh-CN')).toBe('0分钟');
    expect(formatLocalizedDurationMinutes(45, 'zh-CN')).toBe('45分钟');
    expect(formatLocalizedDurationMinutes(135, 'zh-CN')).toBe('2小时15分钟');
    expect(formatLocalizedDurationMinutes(135, 'en')).toBe('2h 15m');
  });
});
