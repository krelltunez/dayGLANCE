import React from 'react';
import { CheckCircle2, CheckSquare, Circle, ExternalLink, FileText, Repeat } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { taskColorToHex, hexToRgba } from '../../utils/colorUtils.js';
import { renderTitle, URL_REGEX } from '../../utils/textFormatting.jsx';

/**
 * Task card for the SCHED agenda and the Project Planner columns.
 * Color accent on the left, completion toggle, title rendered through the
 * app-wide renderTitle (wikilinks hidden, tags small/italic), and a meta line
 * surfacing time, notes, subtask progress, links, and (optionally) the
 * project the task belongs to. Imported calendar events render read-only.
 */
const SchedTaskCard = ({ task, isInbox = false, showProject = false, onEdit = null }) => {
  const {
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
    formatTime, toggleComplete, openMobileEditTask,
  } = useDayPlannerCtx();
  const { projects, goalsProjectsEnabled } = useFeaturesCtx();

  const hex = taskColorToHex(task.color, task.nativeCalendarColor);
  const isEvent = task.imported && !task.isTaskCalendar;
  const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');

  const timeLabel = task.isAllDay
    ? 'All day'
    : task.startTime
      ? `${formatTime(task.startTime)}${task.duration ? ` · ${task.duration}m` : ''}`
      : '';

  const subtasks = task.subtasks || [];
  const subtasksDone = subtasks.filter(s => s.completed).length;
  const linkUrl = (task.title?.match(URL_REGEX) || task.notes?.match(URL_REGEX) || [])[0] || null;
  const project = showProject && goalsProjectsEnabled && task.projectId
    ? projects.find(p => p.id === task.projectId)
    : null;

  const handleTap = () => {
    if (isEvent) return;
    if (onEdit) onEdit(task);
    else openMobileEditTask(task, isInbox);
  };

  return (
    <div
      onClick={handleTap}
      className={`flex items-center gap-2.5 rounded-xl border ${borderClass} ${cardBg} px-3 py-2 ${
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
      <div className="flex flex-col min-w-0 flex-1 gap-0.5">
        <span className={`text-sm font-medium ${textPrimary} truncate ${task.completed ? 'line-through' : ''}`}>
          {renderTitle(task.title || '')}
        </span>
        {(timeLabel || task.notes || subtasks.length > 0 || linkUrl || project || isRecurring) && (
          <span className={`text-xs ${textSecondary} flex items-center gap-1.5 min-w-0`}>
            {timeLabel && <span className="flex-shrink-0">{timeLabel}</span>}
            {isRecurring && <Repeat size={10} className="opacity-60 flex-shrink-0" />}
            {task.notes && <FileText size={10} className="opacity-70 flex-shrink-0" title="Has notes" />}
            {subtasks.length > 0 && (
              <span className="flex items-center gap-0.5 flex-shrink-0" title={`${subtasksDone}/${subtasks.length} subtasks`}>
                <CheckSquare size={10} className="opacity-70" />
                {subtasksDone}/{subtasks.length}
              </span>
            )}
            {linkUrl && (
              <a
                href={linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex-shrink-0 opacity-70 hover:opacity-100 hover:text-blue-500"
                title={linkUrl}
              >
                <ExternalLink size={10} />
              </a>
            )}
            {project && (
              <span
                className="px-1.5 py-px rounded-full text-[10px] font-medium truncate"
                style={{
                  backgroundColor: hexToRgba(hex, darkMode ? 0.22 : 0.12),
                  color: hex,
                }}
                title={project.title}
              >
                {project.title}
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
};

export default SchedTaskCard;
