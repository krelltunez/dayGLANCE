import React, { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { dateToString, stripWikilinksAndTags } from '../utils/taskUtils.js';
import { starredOn, overGuideline, STAR_GUIDELINE } from '../utils/starredTasks.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

// A day header's entry to that day's key tasks (#1684).
//
// WHY THE DAY HEADER
// The star is a statement about one particular day, so it belongs beside that
// day's date rather than in the app chrome. Everything else was worse: the
// all-day row is conventional and load-bearing (you drag work in and out of it),
// timeline height is scarce and scarcest in MONTH, and a third panel tab would
// need a mobile bottom-nav slot that does not exist.
//
// An earlier pass put this in the app header instead, which was wrong twice
// over. On mobile that header only exists on the GLANCE tab, so the control
// vanished on Timeline, inbox and Settings — the tabs where you would actually
// want it. On desktop it landed in the settings cluster, where a task control
// has no business being. DayHeaderActions is rendered by every view's header
// from one place, which is exactly the property this needs.
//
// It renders NOTHING on a day with no starred tasks, which for most days is
// always. That is what keeps a third button out of an already tight header cell:
// it is absent until it has something to say.
export default function DayKeyTasks({ dateStr, size = 14 }) {
  const { t } = useTranslation();
  const ctx = useDayPlannerCtx();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKeyDown = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const { getTasksForDate, getCalendarTasksForDate, goToDate, scrollToHour, formatTime, darkMode, textSecondary, hoverBg } = ctx ?? {};
  // The day as the calendar filter leaves it (tags and hidden projects, #2307).
  const readDay = getCalendarTasksForDate || getTasksForDate;
  if (!readDay || !dateStr) return null;

  const date = new Date(`${dateStr}T12:00:00`);
  const dayTasks = readDay(date);
  const starred = starredOn(dayTasks, dateStr);
  if (!starred.length) return null;

  // Land on the day and on the hour the task starts — the same two steps the
  // GLANCE sidebar takes when you tap a task there, so the two behave alike.
  const openInPlanner = (task) => {
    setOpen(false);
    goToDate?.(date);
    if (task.startTime && !task.isAllDay) setTimeout(() => scrollToHour?.(task.startTime), 150);
  };

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors inline-flex items-center gap-0.5"
        title={t('task.keyTasks')}
        aria-label={t('task.keyTasks')}
        aria-expanded={open}
        data-day-key-tasks={dateStr}
      >
        <Star size={size} fill="currentColor" />
        <span className="text-[10px] font-semibold">{starred.length}</span>
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={`absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 rounded-lg shadow-xl border p-1 text-left font-normal min-w-[220px] max-w-[300px]
            ${darkMode ? 'bg-gray-800 border-gray-700 text-white' : 'bg-white border-stone-300 text-stone-900'}`}
        >
          <div className={`px-2 py-1 text-[11px] uppercase tracking-wide ${textSecondary}`}>
            {t('task.keyTasks')}
          </div>
          {starred.map((task) => (
            <button
              key={task.id}
              onClick={() => openInPlanner(task)}
              className={`w-full text-left px-2 py-1.5 rounded flex items-center gap-2 text-sm ${hoverBg}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} />
              <span className={`flex-1 min-w-0 truncate ${task.completed ? 'line-through opacity-60' : ''}`}>
                {stripWikilinksAndTags(task.title)}
              </span>
              {task.startTime && !task.isAllDay && (
                <span className={`text-xs flex-shrink-0 ${textSecondary}`}>{formatTime?.(task.startTime)}</span>
              )}
            </button>
          ))}
          {overGuideline(dayTasks, dateStr) && (
            // A nudge, not a limit. Nothing anywhere refuses a fourth star; this
            // just says out loud that the day has stopped being a short list.
            <div className={`px-2 pt-1.5 pb-1 text-[11px] ${textSecondary}`}>
              {t('task.keyTasksOverGuideline', { count: STAR_GUIDELINE })}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
