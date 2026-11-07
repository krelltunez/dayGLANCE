import React from 'react';
import { ChevronUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatLocalizedDate } from '../utils/localeFormatting.js';

// "from Fri" (#2278): the mark on a row that is the after-midnight piece of a
// task that started the day before, as SCHED's card and the phone list print
// it. `fromDate` is the date the task started on.
export default function ContinuesFrom({ fromDate, size = 14, className = 'flex items-center gap-0.5 flex-shrink-0 opacity-80' }) {
  const { t } = useTranslation();
  const day = fromDate ? formatLocalizedDate(new Date(`${fromDate}T12:00:00`), { weekday: 'short' }) : '';
  return (
    <span data-continuation-from={fromDate || ''} className={className}>
      <ChevronUp size={size} aria-hidden="true" />
      {t('task.continuesFrom', { day })}
    </span>
  );
}
