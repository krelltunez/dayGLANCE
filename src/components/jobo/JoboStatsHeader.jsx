import React, { useState } from 'react';
import { BarChart3, CheckCircle, Clock, LogIn, LogOut, Hourglass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { formatDuration } from '../../utils/formatDuration.js';
import StatisticsPanel from './StatisticsPanel.jsx';
import useJoboStatistics from '../../hooks/useJoboStatistics.js';

// CalendarHeader's date-row tiles, in MonthStats' label-over-value treatment.
// Reuse the same pure day model as the view, without estimates, drag previews,
// ledger state, or a cross-component writer. Loading is not an empty ledger.
export default function JoboStatsHeader({ className = '' }) {
  const { t, i18n } = useTranslation();
  const planner = useDayPlannerCtx();
  const { textPrimary, textSecondary, borderClass } = planner;
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  // The day's model and the panel's inputs, shared with the phone's sheet.
  const { date, stats, weekDates, evidenceDates, buildReports, loaded: joboLoaded, error: joboError } = useJoboStatistics({ open: statisticsOpen });
  if (!stats) return null;

  const number = new Intl.NumberFormat(i18n?.resolvedLanguage || i18n?.language);
  const count = value => value == null ? '—' : number.format(value);
  const duration = value => value == null ? '—' : formatDuration(value, t);
  const c = stats.comparison;
  const ratio = value => c.comparableCount > 0 ? `${count(value)} / ${count(c.comparableCount)}` : '—';
  const scope = stats.invalidCount ? t('jobo.view.invalidRecords', { count: stats.invalidCount }) : t('jobo.stats.scope', {
    comparable: count(c.comparableCount), total: count(c.groupCount), untimed: count(stats.untimedCount),
  });
  // Each comparison tile names its own two outcomes (early and on time for
  // starts and finishes, shorter and as planned for duration) and how many
  // planned tasks could not be compared for missing times.
  const details = dimension => {
    const values = c[dimension];
    const breakdown = dimension === 'duration'
      ? t('jobo.stats.breakdownDuration', { early: count(values.shorter), on: count(values.onEstimate) })
      : t('jobo.stats.breakdownTiming', { early: count(values.early), on: count(values.onTime) });
    return `${t('jobo.stats.comparisonScope')}\n${breakdown} · ${t('jobo.stats.notCompared', { excluded: count(c.excludedCount) })}`;
  };
  // The row's own tooltip also carries the two secondary figures, which is
  // the only place they can be read below xl, where their tiles step aside.
  const rowTitle = `${scope}\n${t('jobo.stats.secondary', { finish: ratio(c.finish.late), longer: ratio(c.duration.longer) })}`;
  const tiles = [
    // A skipped occurrence is in the total as not done; the tooltip says how
    // many (docs/jobo-skip-occurrence.md).
    ['native', CheckCircle, t('jobo.stats.native'), `${count(stats.native.completed)} / ${count(stats.native.total)}`,
      stats.native.skipped > 0 ? `${t('jobo.stats.nativeScope')} ${t('jobo.stats.skippedDetail', { count: stats.native.skipped })}` : t('jobo.stats.nativeScope'),
      'text-green-500', false],
    ['time', Clock, t('jobo.stats.recorded'), duration(stats.recordedMinutes), `${t('jobo.stats.timeScope')} ${t('jobo.stats.timeDetails', {
      planned: duration(stats.native.plannedMinutes), untimed: count(stats.untimedCount), inferred: count(stats.inferredCount),
    })}`, 'text-orange-400', false],
    ['start', LogIn, t('jobo.stats.lateStart'), ratio(c.start.late), details('start'), 'text-amber-500', false],
    ['finish', LogOut, t('jobo.stats.lateFinish'), ratio(c.finish.late), details('finish'), 'text-orange-400', true],
    ['duration', Hourglass, t('jobo.stats.longer'), ratio(c.duration.longer), details('duration'), 'text-purple-400', true],
  ];
  // Match MonthStats dense mode: keep the three primary measures visible and
  // step the two secondary tiles aside below xl. Their values stay readable
  // in the row's tooltip (rowTitle) without a hidden-scroll affordance.
  const tile = 'flex-1 min-w-[8.5rem] px-3 py-1 flex flex-col justify-center gap-0.5';
  const label = `text-[10px] uppercase tracking-wide leading-none whitespace-nowrap flex items-center gap-1 ${textSecondary}`;
  const valueClass = `text-sm font-semibold leading-tight tabular-nums whitespace-nowrap flex items-baseline gap-1.5 ${textPrimary}`;
  return (
    <>
    <div className={`min-w-0 flex items-stretch ${className}`}>
    <dl data-jobo-stats data-recorded-minutes={stats.recordedMinutes ?? ''}
      data-comparable-groups={c.comparableCount ?? ''} data-jobo-stats-date={date}
      role="group" aria-label={t('jobo.stats.title')} title={rowTitle}
      className="min-w-0 flex-1 flex items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tiles.map(([key, Icon, labelText, value, hint, tone, secondary]) => (
        <div key={key} data-jobo-stat={key} className={`${tile} ${secondary ? 'hidden xl:flex' : ''} border-l ${borderClass}`} title={`${hint}\n${scope}`}>
          <dt className={label}><Icon size={10} className={tone} aria-hidden="true" />{labelText}</dt>
          <dd className={valueClass}>{value}</dd>
        </div>
      ))}
    </dl>
    <button type="button" data-jobo-statistics-toggle aria-haspopup="dialog" aria-expanded={statisticsOpen}
      onClick={() => setStatisticsOpen(true)} title={t('jobo.statistics.button')}
      aria-label={t('jobo.statistics.button')}
      className={`self-center shrink-0 mx-2 p-2 rounded-lg border ${borderClass} text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30`}>
      <BarChart3 size={18} aria-hidden="true" />
    </button>
    </div>
    {statisticsOpen && <StatisticsPanel key={date} anchorDate={date} weekDates={weekDates} evidenceDates={evidenceDates}
      buildReports={buildReports} loaded={joboLoaded} error={joboError} onClose={() => setStatisticsOpen(false)}
      cardBg={planner.cardBg} textPrimary={textPrimary} textSecondary={textSecondary}
      borderClass={borderClass} darkMode={planner.darkMode} />}
    </>
  );
}
