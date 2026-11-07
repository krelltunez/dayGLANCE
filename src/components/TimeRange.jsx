import React from 'react';
import { useTranslation } from 'react-i18next';
import { NEXT_DAY_MARK, timeRange } from '../utils/timeRange.js';

// The next-day mark (#2278): "+1" raised after an end time on the following
// date, titled "Ends the next day". The task dialog's end field and every
// card that prints a range draw this one.
export function NextDayMark({ className = 'ml-0.5 text-[0.75em] font-semibold opacity-70' }) {
  const { t } = useTranslation();
  return <sup data-next-day className={className} title={t('task.nextDay')}>{NEXT_DAY_MARK}</sup>;
}

/**
 * A task's start–end range for a card: real clock times through
 * `formatTime`, and the next-day mark when the end falls on the next date
 * (utils/timeRange.js). "23:00–01:00⁺¹", "9:00 AM–10:00 AM".
 */
export default function TimeRange({ startTime, duration, formatTime, separator = '–' }) {
  const range = timeRange(startTime, duration);
  if (!range) return startTime ? formatTime(startTime) : null;
  return (
    <>
      {formatTime(range.startTime)}{separator}{formatTime(range.endTime)}
      {range.nextDay && <NextDayMark />}
    </>
  );
}
