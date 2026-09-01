import { describe, expect, it } from 'vitest';
import { getDateCandidates, getTimeCandidates } from './suggestionParser.js';

describe('localized date suggestions', () => {
  it('uses Chinese relative-date and weekday labels', () => {
    expect(getDateCandidates('tod', 'zh-CN')[0].display).toBe('今天');
    expect(getDateCandidates('tom', 'zh-CN')[0].display).toBe('明天');
    expect(getDateCandidates('monday', 'zh-CN')[0].display).toBe('星期一');
    expect(getDateCandidates('next monday', 'zh-CN')[0].display).toBe('下周一');
  });

  it('keeps English shortcut labels unchanged', () => {
    expect(getDateCandidates('tod', 'en')[0].display).toBe('Today');
    expect(getDateCandidates('next week', 'en')[0].display).toBe('Next week');
  });
});

describe('localized time suggestions', () => {
  it('defaults zh-CN suggestions to a 24-hour clock', () => {
    expect(getTimeCandidates('9', 'zh-CN').map(({ time, display }) => ({ time, display }))).toEqual([
      { time: '09:00', display: '09:00' },
      { time: '21:00', display: '21:00' },
    ]);
    expect(getTimeCandidates('noon', 'zh-CN')[0].display).toBe('12:00（中午）');
  });

  it('keeps the established English 12-hour display', () => {
    expect(getTimeCandidates('9', 'en').map(({ display }) => display)).toEqual(['9:00 AM', '9:00 PM']);
    expect(getTimeCandidates('noon', 'en')[0].display).toBe('12:00 PM (Noon)');
  });
});
