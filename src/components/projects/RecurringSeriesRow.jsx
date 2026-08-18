import React from 'react';
import { CheckSquare, Repeat, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { getOccurrencesInRange } from '../../utils/recurrenceEngine.js';
import { renderTitle } from '../../utils/textFormatting.jsx';

/**
 * RecurringSeriesRow — one row per recurring series in a project's task list
 * (ProjectCard, ProjectPlanner). The series is listed ONCE no matter how
 * often it recurs — occurrences are never expanded here, so a daily task
 * can't flood the list.
 *
 * The checkbox appears only when the series actually occurs today and
 * toggles today's occurrence; tapping the title opens the task editor on
 * today's instance (the recurring-id routing in openMobileEditTask /
 * saveMobileEditTask handles the rest).
 */
const RecurringSeriesRow = ({ template, projectHex }) => {
  const {
    toggleComplete, openMobileEditTask, getTodayStr, formatTime,
    textSecondary, hoverBg,
  } = useDayPlannerCtx();
  const { t } = useTranslation();

  const todayStr = getTodayStr();
  const exc = template.exceptions?.[todayStr] || {};
  const occursToday = getOccurrencesInRange(template, todayStr, todayStr).length > 0;
  const completed = occursToday && (template.completedDates || []).includes(todayStr);

  // Exception-aware today-instance, mirroring the expandedRecurringTasks
  // shape in App.jsx so the editor's recurring-id routing works unchanged.
  const instance = {
    id: `recurring-${template.id}-${todayStr}`,
    title: exc.title ?? template.title,
    startTime: exc.startTime ?? template.startTime,
    duration: exc.duration ?? template.duration,
    color: exc.color ?? template.color,
    isAllDay: exc.isAllDay ?? template.isAllDay ?? false,
    notes: template.notes || '',
    subtasks: template.subtasks || [],
    completed,
    date: todayStr,
    isRecurring: true,
    recurringTemplateId: template.id,
    recurrenceType: template.recurrence?.type,
    projectId: template.projectId,
  };

  const timeLabel = instance.isAllDay
    ? null
    : instance.startTime
      ? `${formatTime(instance.startTime)}${instance.duration ? ` · ${instance.duration}m` : ''}`
      : null;

  return (
    <div
      className={`flex items-center rounded-lg select-none transition-colors ${hoverBg}`}
      style={{ borderLeft: `2px solid ${projectHex}99` }}
    >
      {occursToday ? (
        <button
          onClick={() => toggleComplete(instance.id)}
          className="flex items-center justify-center flex-shrink-0 pl-1.5 pr-2 py-1.5"
          aria-label={completed ? t('sched.markIncomplete') : t('sched.markComplete')}
        >
          {completed
            ? <CheckSquare size={12} className="text-green-500" />
            : <Square size={12} className={`${textSecondary} opacity-60`} />}
        </button>
      ) : (
        <span className={`flex items-center justify-center flex-shrink-0 pl-1.5 pr-2 py-1.5 ${textSecondary} opacity-40`}>
          <Repeat size={12} />
        </span>
      )}
      <button
        onClick={() => openMobileEditTask?.(instance, false)}
        className="flex items-center gap-1 flex-1 min-w-0 py-1.5"
      >
        <span className={`text-xs flex-1 min-w-0 truncate text-left ${completed ? `line-through opacity-40 ${textSecondary}` : textSecondary}`}>
          {renderTitle(instance.title)}
        </span>
      </button>
      <span className={`flex items-center gap-1 flex-shrink-0 pr-1.5 text-[10px] ${textSecondary} opacity-60`}>
        {timeLabel}
      </span>
    </div>
  );
};

export default RecurringSeriesRow;
