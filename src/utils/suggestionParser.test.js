import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import en from '../../public/locales/en/translation.json';
import zhCN from '../../public/locales/zh-CN/translation.json';
import { getDateCandidates, getTimeCandidates } from './suggestionParser.js';

const translator = (language, translation) => {
  const instance = i18next.createInstance();
  instance.init({
    lng: language,
    fallbackLng: false,
    resources: { [language]: { translation } },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return instance.t.bind(instance);
};

const enT = translator('en', en);
const zhT = translator('zh-CN', zhCN);

describe('localized date suggestions', () => {
  it('uses Chinese relative-date and weekday labels', () => {
    expect(getDateCandidates('tod', zhT, 'zh-CN')[0].display).toBe('今天');
    expect(getDateCandidates('tom', zhT, 'zh-CN')[0].display).toBe('明天');
    expect(getDateCandidates('monday', zhT, 'zh-CN')[0].display).toBe('星期一');
    expect(getDateCandidates('next monday', zhT, 'zh-CN')[0].display).toBe('下星期一');
  });

  it('keeps English shortcut labels unchanged', () => {
    expect(getDateCandidates('tod', enT, 'en')[0].display).toBe('Today');
    expect(getDateCandidates('next week', enT, 'en')[0].display).toBe('Next week');
  });
});

describe('localized time suggestions', () => {
  it('honors an explicit clock preference in both directions', () => {
    const chinese12h = new Intl.DateTimeFormat('zh-CN', {
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC',
    }).format(new Date('2026-01-01T21:00:00Z'));
    expect(getTimeCandidates('9', zhT, 'zh-CN', false)[1].display).toBe(chinese12h);
    expect(getTimeCandidates('9', enT, 'en', true)[1].display).toBe('21:00');
  });

  it('defaults zh-CN suggestions to a 24-hour clock', () => {
    expect(getTimeCandidates('9', zhT, 'zh-CN').map(({ time, display }) => ({ time, display }))).toEqual([
      { time: '09:00', display: '09:00' },
      { time: '21:00', display: '21:00' },
    ]);
    expect(getTimeCandidates('noon', zhT, 'zh-CN')[0].display).toBe('12:00（中午）');
  });

  it('keeps the established English 12-hour display', () => {
    expect(getTimeCandidates('9', enT, 'en').map(({ display }) => display)).toEqual(['9:00 AM', '9:00 PM']);
    expect(getTimeCandidates('noon', enT, 'en')[0].display).toBe('12:00 PM (Noon)');
  });
});
