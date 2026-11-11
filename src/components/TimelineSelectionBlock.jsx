import React from 'react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { clearTimelineSelection } from '../hooks/useTimelineSelection.js';

/**
 * A swept range on a timeline column (#2366, hooks/useTimelineSelection.js):
 * a left click adds a task with its start and length, a right click opens
 * the timeline menu for it. The column places it (`top`, `height`, and the
 * `className` that puts it over the column's event area).
 */
export default function TimelineSelectionBlock({ selection, top, height, className = '', style }) {
  const { t } = useTranslation();
  const { setNewTask, setShowAddTask, setTimelineContextMenu, formatTime, minutesToTime, darkMode } = useDayPlannerCtx();
  const { dateStr, start, end, dragging } = selection;
  const label = `${formatTime(minutesToTime(start))} – ${formatTime(minutesToTime(end))}`;

  const addTask = (e) => {
    e.stopPropagation();
    setNewTask({ title: '', startTime: minutesToTime(start), duration: end - start, date: dateStr, isAllDay: false });
    setShowAddTask(true);
    clearTimelineSelection();
  };
  const openMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTimelineContextMenu({ x: e.clientX, y: e.clientY, dateStr, timeMinutes: start, endMinutes: end });
  };

  return (
    <div
      data-timeline-selection
      data-ctx-menu
      role="button"
      aria-label={t('timeline.selectionLabel', { range: label })}
      title={dragging ? undefined : t('timeline.selectionHint')}
      className={`absolute rounded-md border-2 border-blue-500 ${darkMode ? 'bg-blue-500/25' : 'bg-blue-400/20'} pointer-events-auto cursor-pointer select-none z-[6] ${className}`}
      style={{ top: `${top}px`, height: `${Math.max(height, 2)}px`, ...style }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={addTask}
      onContextMenu={openMenu}
    >
      <span className={`absolute top-0.5 left-1.5 text-[11px] font-semibold ${darkMode ? 'text-blue-200' : 'text-blue-700'} pointer-events-none`}>
        {label}
      </span>
    </div>
  );
}
