import React, { useRef, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useTranslation } from 'react-i18next';
import { taskColorToHex } from '../../utils/colorUtils.js';
import { renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import ClockTimePicker from '../ClockTimePicker.jsx';

/**
 * Non-task rows in a SCHED day group: deadline tasks and (today only) routine
 * pills. Both are "not yet on the clock" items — tapping opens a time picker
 * that schedules them into the day, mirroring what dragging them onto the
 * timeline does in the MULTI views.
 */

/** A deadline task on its deadline day — all-day-task look with a dashed
    border and a calendar affordance; tap picks a time on that day. */
export const SchedDeadlineCard = ({ task, dateStr }) => {
  const {
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
    scheduleDeadlineTaskAt, use24HourClock, isTablet,
  } = useDayPlannerCtx();
  const { t } = useTranslation();
  const [showPicker, setShowPicker] = useState(false);
  const hex = taskColorToHex(task.color);

  return (
    <>
      <div
        onClick={() => !task.completed && setShowPicker(true)}
        className={`flex items-center gap-2 rounded-xl border border-dashed ${borderClass} ${cardBg} px-3 py-2 ${
          task.completed ? 'opacity-55' : 'cursor-pointer active:opacity-70'
        }`}
        style={{ borderLeft: `4px solid ${hex}` }}
        title={t('sched.deadlineTapToSchedule', 'Deadline — tap to pick a time')}
      >
        <div className="flex flex-col min-w-0 flex-1 gap-0.5">
          <span className={`text-sm font-medium ${textPrimary} truncate ${task.completed ? 'line-through' : ''}`}>
            {renderTitleWithoutTags(task.title || '') || task.title}
          </span>
          <span className={`text-xs ${textSecondary} flex items-center gap-1.5`}>
            <span className="font-medium text-red-400">{t('sched.deadline', 'Deadline')}</span>
            {task.duration ? <span>{task.duration}m</span> : null}
          </span>
        </div>
        {!task.completed && (
          <CalendarPlus size={14} className={`flex-shrink-0 ${textSecondary} opacity-60`} />
        )}
      </div>
      {showPicker && (
        <ClockTimePicker
          value="09:00"
          onChange={(time) => { setShowPicker(false); scheduleDeadlineTaskAt(task.id, dateStr, time); }}
          onClose={() => setShowPicker(false)}
          darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
        />
      )}
    </>
  );
};

/** How long a press must be held before it means "pick a time" instead of
    "toggle complete". Matches typical platform long-press timing. */
const LONG_PRESS_MS = 500;

/** Today's routines as the familiar teal pills. All-day (unplaced) pills come
    first; placed ones show their time. Tap toggles completion (like routine
    chips everywhere else); press-and-hold opens the time picker. */
export const SchedRoutinePills = () => {
  const {
    darkMode, scheduleRoutineAt, formatTime, use24HourClock, isTablet,
  } = useDayPlannerCtx();
  // Routine state lives in the FEATURES context (same as TimeGrid), not the
  // day-planner one — destructuring it from the wrong context reads undefined
  // and silently renders nothing.
  const { routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion } = useFeaturesCtx();
  const { t } = useTranslation();
  const [pickerFor, setPickerFor] = useState(null);
  // { timer, longFired } — longFired swallows the click that follows a
  // completed long-press so it doesn't ALSO toggle completion.
  const pressRef = useRef({ timer: null, longFired: false });

  if (!routinesEnabled || todayRoutines.length === 0) return null;

  const startPress = (routine) => {
    pressRef.current.longFired = false;
    clearTimeout(pressRef.current.timer);
    pressRef.current.timer = setTimeout(() => {
      pressRef.current.longFired = true;
      setPickerFor(routine);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => clearTimeout(pressRef.current.timer);

  const sorted = [...todayRoutines].sort((a, b) =>
    ((a.isAllDay || !a.startTime) ? 0 : 1) - ((b.isAllDay || !b.startTime) ? 0 : 1) ||
    (a.startTime || '').localeCompare(b.startTime || ''));

  return (
    <div className="flex flex-wrap gap-1.5">
      {sorted.map(r => (
        <button
          key={r.id}
          onPointerDown={() => startPress(r)}
          onPointerUp={cancelPress}
          onPointerLeave={cancelPress}
          onPointerCancel={cancelPress}
          onTouchMove={cancelPress}
          onContextMenu={e => e.preventDefault()}
          onClick={() => {
            if (pressRef.current.longFired) { pressRef.current.longFired = false; return; }
            cancelPress();
            toggleRoutineCompletion(r.id);
          }}
          className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-opacity select-none dnd-no-select ${
            darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'
          } ${routineCompletions[r.id] ? 'line-through opacity-75' : ''}`}
          title={t('sched.routineTapHint', 'Tap to complete · hold to pick a time')}
        >
          {r.startTime && !r.isAllDay ? `${formatTime(r.startTime)} · ` : ''}{r.name}
        </button>
      ))}
      {pickerFor && (
        <ClockTimePicker
          value={(!pickerFor.isAllDay && pickerFor.startTime) || '09:00'}
          onChange={(time) => { const id = pickerFor.id; setPickerFor(null); scheduleRoutineAt(id, time); }}
          onClose={() => setPickerFor(null)}
          darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
        />
      )}
    </div>
  );
};
