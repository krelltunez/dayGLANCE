import i18n from 'i18next';

export const activeLocale = () => i18n.resolvedLanguage || i18n.language || 'en';

export const isSimplifiedChinese = (language = activeLocale()) =>
  typeof language === 'string' && language.toLowerCase().startsWith('zh');

export const defaultUse24HourClock = (language = activeLocale()) =>
  isSimplifiedChinese(language);

export const defaultWeekStartDay = (language = activeLocale()) =>
  isSimplifiedChinese(language) ? 1 : 0;

export const formatLocalizedDate = (date, options, language = activeLocale()) =>
  new Intl.DateTimeFormat(language, options).format(date);

export const formatLocalizedDurationMinutes = (minutes, language = activeLocale()) => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  if (isSimplifiedChinese(language)) {
    if (hours && remainingMinutes) return `${hours}小时${remainingMinutes}分钟`;
    if (hours) return `${hours}小时`;
    return `${remainingMinutes}分钟`;
  }
  if (hours && remainingMinutes) return `${hours}h ${remainingMinutes}m`;
  if (hours) return `${hours}h`;
  return `${remainingMinutes}m`;
};

export const localizedWeekdays = (width = 'short', language = activeLocale()) => {
  const formatter = new Intl.DateTimeFormat(language, { weekday: width, timeZone: 'UTC' });
  const sunday = Date.UTC(2024, 0, 7);
  return Array.from({ length: 7 }, (_, day) => formatter.format(new Date(sunday + day * 86400000)));
};
