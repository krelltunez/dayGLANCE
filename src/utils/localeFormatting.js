import i18n from 'i18next';

export const activeLocale = () => i18n.resolvedLanguage || i18n.language || 'en';

export const defaultUse24HourClock = (language = activeLocale()) =>
  ['h23', 'h24'].includes(new Intl.DateTimeFormat(language, { hour: 'numeric' }).resolvedOptions().hourCycle);

export const defaultWeekStartDay = (language = activeLocale()) => {
  const locale = new Intl.Locale(language);
  // Chromium exposes getWeekInfo(); Safari exposes the earlier weekInfo getter.
  const weekInfo = locale.getWeekInfo?.() ?? locale.weekInfo;
  return weekInfo ? weekInfo.firstDay % 7 : 0;
};

export const formatLocalizedDate = (date, options, language = activeLocale()) =>
  new Intl.DateTimeFormat(language, options).format(date);

export const formatLocalizedDurationMinutes = (minutes, language = activeLocale()) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  const formatUnit = (value, unit) => new Intl.NumberFormat(language, {
    style: 'unit', unit, unitDisplay: 'narrow',
  }).format(value);
  const parts = [];
  if (hours) parts.push(formatUnit(hours, 'hour'));
  if (remainingMinutes || !hours) parts.push(formatUnit(remainingMinutes, 'minute'));
  // Compact "1h 30m" shape in every locale. The narrow unit list gives each
  // locale its own separator: a space in most, nothing in Chinese, but a
  // comma in German and the word "e" in European Portuguese, which read as
  // a list rather than one duration. Keep whitespace-only separators and
  // reduce anything carrying punctuation or a word to a single space.
  return new Intl.ListFormat(language, { style: 'narrow', type: 'unit' })
    .formatToParts(parts)
    .map((part) => (part.type === 'literal' && part.value.trim() ? ' ' : part.value))
    .join('');
};

export const localizedWeekdays = (width = 'short', language = activeLocale()) => {
  const formatter = new Intl.DateTimeFormat(language, { weekday: width, timeZone: 'UTC' });
  const sunday = Date.UTC(2024, 0, 7);
  return Array.from({ length: 7 }, (_, day) => formatter.format(new Date(sunday + day * 86400000)));
};
