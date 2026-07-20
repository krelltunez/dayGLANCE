import React from 'react';
import { CheckCircle2, Circle, Repeat } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { taskColorToHex } from '../../utils/colorUtils.js';

/**
 * Compact task card for the SCHED agenda (mobile + desktop dashboards).
 * Color accent on the left, completion toggle, title, time/duration line.
 * Imported calendar events render read-only (no editor on tap).
 */
const SchedTaskCard = ({ task, isInbox = false }) => {
  const {
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
    formatTime, toggleComplete, openMobileEditTask,
  } = useDayPlannerCtx();

  const hex = taskColorToHex(task.color, task.nativeCalendarColor);
  const isEvent = task.imported && !task.isTaskCalendar;
  const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');

  const timeLabel = task.isAllDay
    ? 'All day'
    : task.startTime
      ? `${formatTime(task.startTime)}${task.duration ? ` · ${task.duration}m` : ''}`
      : '';

  return (
    <div
      onClick={() => { if (!isEvent) openMobileEditTask(task, isInbox); }}
      className={`flex items-center gap-2.5 rounded-xl border ${borderClass} ${cardBg} px-3 py-2.5 ${
        isEvent ? '' : 'cursor-pointer active:opacity-70'
      } ${task.completed ? 'opacity-55' : ''}`}
      style={{ borderLeft: `4px solid ${hex}` }}
    >
      {!isEvent && (
        <button
          onClick={e => { e.stopPropagation(); toggleComplete(task.id, isInbox); }}
          className="flex-shrink-0 p-0.5"
          aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
        >
          {task.completed
            ? <CheckCircle2 size={18} className="text-green-500" />
            : <Circle size={18} className={darkMode ? 'text-gray-600' : 'text-stone-300'} />}
        </button>
      )}
      <div className="flex flex-col min-w-0 flex-1">
        <span className={`text-sm font-medium ${textPrimary} truncate ${task.completed ? 'line-through' : ''}`}>
          {task.title}
        </span>
        {timeLabel && (
          <span className={`text-xs ${textSecondary} flex items-center gap-1`}>
            {timeLabel}
            {isRecurring && <Repeat size={10} className="opacity-60" />}
          </span>
        )}
      </div>
    </div>
  );
};

export default SchedTaskCard;
