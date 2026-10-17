import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import JoboSheet from './JoboSheet.jsx';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';
import { formatDuration } from '../../utils/formatDuration.js';
import { aggregateCheckSummaries, STATISTICS_SCOPES, statisticsDatesForScope } from '../../jobo/checkStatistics.js';

const parseDate = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};
const Metric = ({ label, value }) => <div className="min-w-0 rounded-xl border border-current/10 px-3 py-2">
  <dt className="text-xs opacity-70">{label}</dt><dd className="mt-0.5 text-lg font-semibold tabular-nums">{value}</dd>
</div>;
const Section = ({ title, hint, children }) => <section className="space-y-2">
  <h3 className="text-xs font-semibold uppercase tracking-wide opacity-70" title={hint}>{title}</h3>{children}
</section>;

function Summary({ summary, textSecondary, borderClass }) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const formatter = useMemo(() => new Intl.NumberFormat(language), [language]);
  const n = (value) => Number.isFinite(value) ? formatter.format(value) : '—';
  const mins = (value) => Number.isFinite(value) ? formatDuration(value, t) : '—';
  const pair = (value, total) => Number.isFinite(value) && Number.isFinite(total) ? `${n(value)} / ${n(total)}` : '—';
  const comparison = summary.stats.comparison;
  const changes = summary.changes;
  const changed = changes ? Math.max(0, changes.compared - changes.unchanged) : null;

  return <div className="space-y-5">
    {!summary.clean && <p role="status" className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{t('jobo.statistics.invalid')}</span>
    </p>}
    <Section title={t('jobo.statistics.overview')} hint={t('jobo.statistics.taskScope')}>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Metric label={t('jobo.stats.native')} value={pair(summary.stats.native.completed, summary.stats.native.total)} />
        <Metric label={t('jobo.stats.recorded')} value={mins(summary.stats.recordedMinutes)} />
        <Metric label={t('jobo.statistics.noDo')} value={n(summary.noDo)} />
        <Metric label={t('jobo.statistics.compared')} value={pair(comparison.comparableCount, comparison.groupCount)} />
      </dl>
      <p className={`text-xs ${textSecondary}`}>{t('jobo.stats.timeDetails', {
        planned: mins(summary.stats.native.plannedMinutes),
        untimed: n(summary.stats.untimedCount),
        inferred: n(summary.stats.inferredCount),
      })}{summary.stats.native.skipped > 0 && <span data-statistics-skipped>{` ${t('jobo.stats.skippedDetail', { count: summary.stats.native.skipped })}`}</span>}</p>
    </Section>

    <Section title={t('jobo.statistics.comparison')}>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Metric label={t('jobo.stats.lateStart')} value={pair(comparison.start.late, comparison.comparableCount)} />
        <Metric label={t('jobo.stats.lateFinish')} value={pair(comparison.finish.late, comparison.comparableCount)} />
        <Metric label={t('jobo.stats.longer')} value={pair(comparison.duration.longer, comparison.comparableCount)} />
        <Metric label={t('jobo.statistics.withinPlan')} value={pair(summary.withinPlan, comparison.comparableCount)} />
      </dl>
      <p className={`text-xs ${textSecondary}`}>
        {t('jobo.stats.breakdownTiming', { early: n(comparison.start.early), on: n(comparison.start.onTime) })}
        {' · '}{t('jobo.stats.breakdownDuration', { early: n(comparison.duration.shorter), on: n(comparison.duration.onEstimate) })}
      </p>
    </Section>

    {summary.progress && summary.contexts && <Section title={t('jobo.statistics.execution')}>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Metric label={t('jobo.statistics.doRecords')} value={n(summary.doCount)} />
        <Metric label={t('jobo.statistics.single')} value={n(summary.single)} />
        <Metric label={t('jobo.statistics.split')} value={n(summary.split)} />
        <Metric label={t('common.completed')} value={n(summary.progress.completed)} />
      </dl>
      <p className={`text-xs ${textSecondary}`}>
        {t('jobo.view.progress.mostly')}: {n(summary.progress.mostly)}
        {' · '}{t('jobo.view.progress.partial')}: {n(summary.progress.partial)}
        {' · '}{t('jobo.view.progress.started')}: {n(summary.progress.started)}
        {' · '}{t('jobo.statistics.noPlan')}: {n(summary.contexts.noPlan)}
      </p>
    </Section>}

    <Section title={t('jobo.statistics.planChanges')}>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Metric label={t('jobo.statistics.changed')} value={n(changed)} />
        <Metric label={t('jobo.statistics.startChanged')} value={n(changes?.start)} />
        <Metric label={t('jobo.statistics.finishChanged')} value={n(changes?.finish)} />
        <Metric label={t('jobo.statistics.durationChanged')} value={n(changes?.duration)} />
      </dl>
      {changes && <p className={`text-xs ${textSecondary}`}>
        {t('jobo.statistics.unchanged')}: {n(changes.unchanged)} {' · '}{t('jobo.statistics.unknown')}: {n(changes.unknown)}
      </p>}
    </Section>

    <Section title={t('jobo.statistics.priority')}>
      <div className={`overflow-x-auto rounded-xl border ${borderClass}`}>
        <table className="w-full text-sm">
          <thead className={textSecondary}><tr>
            <th className="text-left font-medium px-3 py-2">{t('jobo.statistics.priority')}</th>
            <th className="text-right font-medium px-3 py-2">{t('common.completed')}</th>
            <th className="text-right font-medium px-3 py-2">{t('jobo.stats.recorded')}</th>
            <th className="text-right font-medium px-3 py-2">{t('jobo.statistics.compared')}</th>
          </tr></thead>
          <tbody>{['high', 'medium', 'low', 'none', 'unknown'].map((key) => {
            const row = summary.priorities[key];
            return <tr key={key} className={`border-t ${borderClass}`}>
              <th className="text-left font-medium px-3 py-2">{t(`jobo.statistics.priority_${key}`)}</th>
              <td className="text-right tabular-nums px-3 py-2">{pair(row.completed, row.total)}</td>
              <td className="text-right tabular-nums px-3 py-2">{mins(row.recordedMinutes)}</td>
              <td className="text-right tabular-nums px-3 py-2">{n(row.comparable)}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </Section>

    <Section title={t('jobo.statistics.timing')} hint={t('jobo.statistics.timingScope')}>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <Metric label={t('jobo.view.overlapLabel')} value={mins(summary.overlapMinutes)} />
        <Metric label={t('jobo.statistics.insidePlan')} value={mins(summary.insideMinutes)} />
        <Metric label={t('jobo.statistics.outsidePlan')} value={mins(summary.outsideMinutes)} />
        <Metric label={t('jobo.statistics.maxSpan')} value={mins(summary.maxSpanMinutes)} />
        <Metric label={t('jobo.statistics.maxLateStart')} value={mins(summary.maxStart)} />
        <Metric label={t('jobo.statistics.maxLateFinish')} value={mins(summary.maxFinish)} />
        <Metric label={t('jobo.statistics.maxOverrun')} value={mins(summary.maxLonger)} />
        {Number.isFinite(summary.gapMinutes) && <Metric label={t('jobo.view.gapLabel')} value={mins(summary.gapMinutes)} />}
      </dl>
    </Section>
  </div>;
}

export default function StatisticsPanel({
  anchorDate, weekDates, evidenceDates, buildReports, loaded, error, onClose,
  cardBg = 'bg-white', textPrimary = '', textSecondary = '', borderClass = '', darkMode = false,
  // The phone's form (JOBO slice 8): the same tabs and figures in a sheet
  // (JoboSheet), which owns dismissal; no focus trap, since a phone has no
  // Tab key to trap.
  sheet = false,
}) {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  const [scope, setScope] = useState('day');
  const titleId = useId();
  const dialog = useRef(null);
  const close = useRef(onClose);
  close.current = onClose;

  const dates = useMemo(() => statisticsDatesForScope({ scope, anchorDate, weekDates, evidenceDates }),
    [scope, anchorDate, weekDates, evidenceDates]);
  const reports = useMemo(() => {
    if (!loaded || error || typeof buildReports !== 'function') return null;
    return buildReports(dates, scope).filter(Boolean);
  }, [loaded, error, buildReports, dates, scope]);
  const summary = useMemo(() => reports ? aggregateCheckSummaries(reports) : null, [reports]);
  const labelDate = (value) => formatLocalizedDate(parseDate(value), {
    year: 'numeric', month: 'short', day: 'numeric',
  }, language);
  const rangeLabel = dates.length > 1 ? `${labelDate(dates[0])} – ${labelDate(dates.at(-1))}` : labelDate(dates[0]);

  useEffect(() => {
    if (sheet) return undefined;
    const previous = document.activeElement;
    const root = dialog.current;
    root?.querySelector('button')?.focus();
    const keyboard = (event) => {
      event.stopImmediatePropagation();
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      const tab = event.target.closest?.('[data-jobo-statistics-scope]');
      if (tab && root.contains(tab)) {
        const index = STATISTICS_SCOPES.indexOf(tab.dataset.joboStatisticsScope);
        const nextIndex = event.key === 'ArrowRight' ? (index + 1) % STATISTICS_SCOPES.length
          : event.key === 'ArrowLeft' ? (index + STATISTICS_SCOPES.length - 1) % STATISTICS_SCOPES.length
            : event.key === 'Home' ? 0
              : event.key === 'End' ? STATISTICS_SCOPES.length - 1 : null;
        if (nextIndex !== null) {
          event.preventDefault();
          const nextScope = STATISTICS_SCOPES[nextIndex];
          setScope(nextScope);
          const nextTab = root.querySelector(`[data-jobo-statistics-scope="${nextScope}"]`);
          nextTab?.focus();
          nextTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          return;
        }
      }
      if (event.key !== 'Tab') return;
      const fields = [...root.querySelectorAll('button:not(:disabled):not([tabindex="-1"]),[tabindex="0"]:not(:disabled)')];
      const first = fields[0], last = fields.at(-1);
      if (!root.contains(document.activeElement) || document.activeElement === (event.shiftKey ? first : last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => {
      document.removeEventListener('keydown', keyboard, true);
      const active = document.activeElement;
      if (previous?.isConnected && (!active || active === document.body || root?.contains(active))) previous.focus();
    };
  }, [sheet]);

  // The tabs and the figures, framed as a dialog on desktop and a sheet on
  // the phone.
  const body = (
    <>
      <div className={`px-5 pt-3 border-b flex gap-1 overflow-x-auto ${borderClass}`} role="tablist" aria-label={t('jobo.statistics.title')}>
        {STATISTICS_SCOPES.map((key) => <button key={key} type="button" role="tab"
          id={`${titleId}-${key}-tab`} aria-controls={`${titleId}-panel`} tabIndex={scope === key ? 0 : -1}
          title={key === 'allTime' ? t('jobo.statistics.allTimeScope') : undefined}
          data-jobo-statistics-scope={key} aria-selected={scope === key} onClick={() => setScope(key)}
          className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 ${scope === key ? 'border-blue-500 text-blue-600 dark:text-blue-400' : 'border-transparent ' + textSecondary}`}>
          {t(`jobo.statistics.${key}`)}
        </button>)}
      </div>
      <div id={`${titleId}-panel`} tabIndex={0} role="tabpanel" aria-labelledby={`${titleId}-${scope}-tab`}
        className="overflow-y-auto px-5 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
        {error ? <p role="alert">{t('jobo.statistics.unavailable')}</p>
          : !loaded ? <p role="status">{t('common.loading')}</p>
            : summary ? <Summary summary={summary} textSecondary={textSecondary} borderClass={borderClass} />
              : <p role="status" className={textSecondary}>{t('jobo.statistics.empty')}</p>}
      </div>
    </>
  );
  if (sheet) {
    return (
      <JoboSheet historyKey="joboStatisticsSheet" title={t('jobo.statistics.title')} subtitle={rangeLabel} onClose={onClose} data-jobo-statistics-panel="sheet">
        {body}
      </JoboSheet>
    );
  }
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/50 flex items-center justify-center p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) { event.preventDefault(); onClose(); }
      }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} data-jobo-statistics-panel
        className={`w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl border shadow-xl ${cardBg} ${textPrimary} ${borderClass}`}>
        <header className={`px-5 py-3 border-b flex-shrink-0 flex items-center justify-between gap-3 ${borderClass}`}>
          <div className="min-w-0"><h2 id={titleId} className="font-semibold">{t('jobo.statistics.title')}</h2>
            <p className={`text-xs truncate ${textSecondary}`}>{rangeLabel}</p></div>
          <button type="button" onClick={onClose} aria-label={t('common.close')}
            className={`p-2 rounded-lg ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}><X size={18} /></button>
        </header>
        {body}
      </div>
    </div>, document.body,
  );
}
