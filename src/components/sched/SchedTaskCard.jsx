import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookOpen, Calendar, CalendarPlus, CheckCircle2, CheckSquare, ChevronUp, Circle, ExternalLink, FileText, GripVertical, Repeat, SkipForward } from 'lucide-react';
import { hasTaskEnded } from '@glance-apps/agenda-core';
import TaskPlanHistory from '../TaskPlanHistory.jsx';
import DoSessionsBadge from '../jobo/DoSessionsBadge.jsx';
import TaskStarButton from '../TaskStarButton.jsx';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { useTranslation } from 'react-i18next';
import { taskColorToHex, hexToRgba } from '../../utils/colorUtils.js';
import { isObsidianNoteOnlyTask, renderTitleWithoutTags, URL_REGEX } from '../../utils/textFormatting.jsx';
import { dateToString, extractTags, extractWikilinks, formatDeadlineDate } from '../../utils/taskUtils.js';
import { formatLocalizedDate } from '../../utils/localeFormatting.js';
import { cardTitleTooltip } from '../../utils/cardTitle.js';
import NotesSubtasksPanel from '../NotesSubtasksPanel.jsx';
import DeadlinePickerPopover from '../DeadlinePickerPopover.jsx';

/**
 * Task card for the SCHED agenda and the Project Planner columns.
 *
 * Uniform two-line layout: title row (wikilinks and tags stripped), then a
 * meta row with time, a notes/subtasks button (always present on editable
 * tasks so notes/subtasks/links can be ADDED, not just viewed), link icon,
 * tags (small, italic), and optionally the project pill. Imported calendar
 * events render read-only.
 *
 * Optional `dnd` prop wires the card into a drag-to-reorder list (the
 * planner's unscheduled column) using the same pattern as ProjectCard:
 * whole-card HTML5 drag off-iOS, grip-only touch drag on iOS.
 *
 * `selected` and `onOpen` serve a list where a click selects (the planner
 * with its notes sidebar open): the card shows the selection, and a
 * double-click opens it through `onOpen`.
 *
 * `continuation` (agenda-core's continuationsFromPreviousDay) draws the card
 * as the after-midnight piece of a task that started the day before (#2278),
 * on the day it runs into: the piece's own time from 00:00 and "from <day>",
 * as the timelines' ContinuationCard labels it. `task` is still the real row,
 * so every action on the card acts on the task itself.
 */
// Sizes, shared by SCHED, the Project Planner, MONTH's panel and day sheet:
// one step up from the old text-sm/text-xs card, with tap targets the size
// guidance asks for. Meta-row controls keep the row's height by pairing
// their padding with a negative margin, and the row's gap keeps two
// neighbouring targets from overlapping.
const META_ICON = 14;
const META_HIT = 'p-1.5 -m-1.5';
const ACTION_ICON = 18;

const SchedTaskCard = ({ task, isInbox = false, showProject = false, onEdit = null, dnd = null, showOverdueDate = false, onSchedule = null, selected = false, onOpen = null, continuation = null }) => {
  const {
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
    formatTime, toggleComplete, openMobileEditTask, currentTime,
    postponeTask, showDeadlinePicker, setShowDeadlinePicker,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    getDoSessionsForTask, setTaskContextMenu, recurringTasks, isMobile, isTablet,
  } = useDayPlannerCtx();
  const { projects, goalsProjectsEnabled, generateAISubtasks, aiSubtasksLoadingForTask, aiConfig } = useFeaturesCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx();
  const { t } = useTranslation();

  const [showNotes, setShowNotes] = useState(false);

  // ESC closes this overlay only. The GoalDashboard/global handlers yield to
  // an open .sched-notes-panel, so this capture listener is the one that runs.
  useEffect(() => {
    if (!showNotes) return;
    const handler = (e) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setShowNotes(false);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [showNotes]);

  const hex = taskColorToHex(task.color, task.nativeCalendarColor);
  const isEvent = task.imported && !task.isTaskCalendar;
  // A finished task with a Do badge tells one story, planned then done, so
  // its plan history moves into the badge's panel and the separate icon goes
  // (components/jobo/DoSessionsBadge.jsx). Every other card keeps the icon.
  const planHistoryInDoBadge = !!task.completed && !isEvent && !isInbox
    && typeof getDoSessionsForTask === 'function' && getDoSessionsForTask(task).length > 0;
  const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');

  const timeLabel = continuation
    ? `${formatTime('00:00')} · ${continuation.minutes}m`
    : task.isAllDay
    ? t('task.allDay', 'All day')
    : task.startTime
      ? `${formatTime(task.startTime)}${task.duration ? ` · ${task.duration}m` : ''}`
      // Unscheduled (planner column): no time yet, but the duration is still
      // useful planning information — show it where the time would sit.
      : task.duration ? `${task.duration}m` : '';

  // Past-time treatment (Todoist model): a task whose start time has passed
  // stays in place with a red time label; a calendar event that has ENDED
  // fades like a completed task. All-day items don't go stale until the day
  // ends.
  const todayStr = dateToString(currentTime);
  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
  const startMin = task.startTime
    ? parseInt(task.startTime.slice(0, 2), 10) * 60 + parseInt(task.startTime.slice(3, 5), 10)
    : null;
  // Happening right now: a timed card whose window contains the current
  // minute. Tasks default to 30 min (matching the scheduler); events with no
  // duration are instantaneous. In-progress tasks are NOT past-due — the red
  // label starts when the window ends, the dot covers the window itself.
  //
  // The window ends at the task's REAL end (#2278, agenda-core's
  // hasTaskEnded): a task from 23:00 to 01:00 is still running at 00:30 the
  // next day, not past due because its date is behind us.
  const timed = !task.isAllDay && !!task.date && startMin !== null;
  const ended = timed && hasTaskEnded(task, { todayStr, nowMinutes: nowMin, defaultDuration: isEvent ? 0 : 30 });
  const started = timed && (task.date < todayStr || (task.date === todayStr && startMin <= nowMin));
  const inProgress = started && !ended && !task.completed;
  const isPastDueTask = ended && !isEvent && !task.completed;
  const isFinishedEvent = ended && isEvent;

  const subtasks = task.subtasks || [];
  const subtasksDone = subtasks.filter(s => s.completed).length;
  const linkUrl = (task.title?.match(URL_REGEX) || task.notes?.match(URL_REGEX) || [])[0] || null;
  const tags = extractTags(task.title || '');
  const project = showProject && goalsProjectsEnabled && task.projectId
    ? projects.find(p => p.id === task.projectId)
    : null;
  const wikilinks = extractWikilinks(task.title || '');
  // A wikilinked note in the vault counts as notes (the open-book rule,
  // #1658): the button lights and shows the open book, as on every other card.
  const hasNotesContent = !!(task.notes || subtasks.length > 0 || wikilinks.length > 0);

  const handleTap = () => {
    if (isEvent) return;
    if (onEdit) onEdit(task);
    else openMobileEditTask(task, isInbox);
  };

  // Right-click opens the app's task menu, as on every other task surface
  // (#2132). Edit opens what this list opens (the planner's editor), and
  // Notes / subtasks opens this card's own panel, which the menu's shared
  // expandedNotesTaskId does not drive. Pointer devices only: a long-press
  // on a phone or tablet drags the row. A recurring template (the planner's
  // Scheduled column lists them) has no date for the menu to act on.
  const isTemplate = !isRecurring && (recurringTasks || []).some(r => r.id === task.id);
  const handleContextMenu = setTaskContextMenu && !isMobile && !isTablet && !isTemplate ? (e) => {
    e.preventDefault();
    e.stopPropagation();
    setTaskContextMenu({
      x: e.clientX, y: e.clientY,
      taskId: task.id,
      isRecurring,
      isImported: !!task.imported,
      isAllDay: !!task.isAllDay,
      dateStr: task.date || dateToString(new Date()),
      onEdit: () => (onOpen || onEdit || ((target) => openMobileEditTask(target, isInbox)))(task),
      onNotes: isEvent && !task.notes ? null : () => setShowNotes(true),
    });
  } : undefined;

  const openNotesPanel = (e) => {
    e.stopPropagation();
    if (!isEvent) setShowNotes(true);
  };

  // Postpone (same action as the timeline's button): dated, editable,
  // incomplete cards only. Hidden when a schedule-for-today action is present
  // (overdue cards) — postponing an already-past date would stay in the past.
  // The picker state is one shared id. The PLANNER opens over the project
  // card that lists the same task, so this card keys its picker apart, or
  // both would open.
  const deadlinePickerKey = `sched:${task.id}`;

  const canPostpone = !isEvent && !task.completed && !!task.date && !isInbox && !onSchedule;

  return (
    <div
      onClick={handleTap}
      // Where a click selects (the planner with its notes sidebar open),
      // a double-click opens the task.
      onDoubleClick={onOpen && !isEvent ? (e) => { e.stopPropagation(); onOpen(task); } : undefined}
      onContextMenu={handleContextMenu}
      data-sched-task={task.id}
      data-selected={selected ? 'true' : undefined}
      data-drag-idx={dnd ? dnd.idx : undefined}
      draggable={!!dnd?.rowDraggable}
      onDragStart={dnd?.rowDraggable ? e => dnd.onDragStart(e, dnd.idx) : undefined}
      onDragEnd={dnd?.rowDraggable ? dnd.onDragEnd : undefined}
      onDragOver={dnd ? e => dnd.onDragOver(e, dnd.idx) : undefined}
      onDrop={dnd ? e => dnd.onDrop(e, dnd.idx) : undefined}
      onTouchStart={dnd?.onRowTouchStart ? e => dnd.onRowTouchStart(e, dnd.idx) : undefined}
      className={`flex items-center gap-2 rounded-xl border ${borderClass} ${cardBg} px-3 py-2.5 ${
        isEvent ? '' : 'cursor-pointer active:opacity-70'
      } ${task.completed || isFinishedEvent ? 'opacity-55' : ''} ${dnd ? 'select-none dnd-no-select' : ''} ${
        dnd?.isSource ? 'opacity-40' : ''
      } ${dnd?.isTarget ? (darkMode ? 'border-t-2 border-t-blue-400' : 'border-t-2 border-t-blue-500') : ''} ${
        selected ? 'ring-2 ring-blue-500' : ''
      }`}
      style={{ borderLeft: `4px solid ${hex}` }}
    >
      {dnd && (
        <div
          onTouchStart={dnd.onGripTouchStart ? e => dnd.onGripTouchStart(e, dnd.idx) : undefined}
          className={`flex-shrink-0 p-1.5 -m-1 cursor-grab active:cursor-grabbing touch-none select-none ${textSecondary} opacity-30`}
          aria-label={t('sched.dragToReorder', 'Drag to reorder')}
        >
          <GripVertical size={16} />
        </div>
      )}
      {/* An imported event has nothing to tick off: a calendar glyph holds the
          checkbox's slot so the card says so and the titles line up. */}
      {isEvent && (
        <Calendar size={22} aria-hidden="true" className={`flex-shrink-0 ${darkMode ? 'text-gray-600' : 'text-stone-300'}`} />
      )}
      {!isEvent && (
        <button
          onClick={e => { e.stopPropagation(); toggleComplete(task.id, isInbox); }}
          className="flex-shrink-0 p-1 -m-0.5"
          aria-label={task.completed ? t('sched.markIncomplete', 'Mark incomplete') : t('sched.markComplete', 'Mark complete')}
        >
          {task.completed
            ? <CheckCircle2 size={22} className="text-green-500" />
            : <Circle size={22} className={darkMode ? 'text-gray-600' : 'text-stone-300'} />}
        </button>
      )}
      <div className="flex flex-col min-w-0 flex-1 gap-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className={`text-base font-medium ${textPrimary} truncate ${task.completed ? 'line-through' : ''}`} title={cardTitleTooltip(task.title)}>
            {renderTitleWithoutTags(task.title)}
          </span>
          {/* On a phone the Do badge is a dot here; elsewhere, the pill below. */}
          {!isEvent && !isInbox && <DoSessionsBadge task={task} placement="title" pad="" withPlanHistory={planHistoryInDoBadge} />}
        </span>
        {/* Meta row — always rendered on editable tasks so cards stay uniform */}
        {(!isEvent || timeLabel) && (
          <span className={`text-sm ${textSecondary} flex items-center gap-3 min-w-0`} style={{ minHeight: '1.25rem' }}>
            {/* The row's own date: the scheduled day, or — for an Inbox task in
                the Overdue section — the deadline that put it there. */}
            {showOverdueDate && (task.deadline || task.date) && (
              <span className="flex-shrink-0 font-medium text-amber-500">
                {formatLocalizedDate(new Date((task.deadline || task.date) + 'T00:00:00'), { month: 'short', day: 'numeric' })}
              </span>
            )}
            {inProgress && (
              <span
                className="flex items-center gap-1 animate-pulse flex-shrink-0"
                title={t('sched.happeningNow', 'Happening now')}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <span className="text-xs font-semibold uppercase tracking-wide text-red-500">
                  {t('sched.nowLabel', 'Now')}
                </span>
              </span>
            )}
            {timeLabel && (
              <span className={`flex-shrink-0 ${isPastDueTask ? 'text-red-400 font-medium' : ''}`}>{timeLabel}</span>
            )}
            {continuation && (
              <span data-continuation-from={continuation.fromDate || ''} className="flex items-center gap-0.5 flex-shrink-0 opacity-80">
                <ChevronUp size={META_ICON} aria-hidden="true" />
                {t('task.continuesFrom', { day: continuation.fromDate ? formatLocalizedDate(new Date(`${continuation.fromDate}T12:00:00`), { weekday: 'short' }) : '' })}
              </span>
            )}
            {isRecurring && <Repeat size={META_ICON} className="opacity-60 flex-shrink-0" />}
            {!isEvent && !isInbox && <DoSessionsBadge task={task} withPlanHistory={planHistoryInDoBadge} />}
            {!isEvent && !planHistoryInDoBadge && <TaskPlanHistory task={task} size={META_ICON} pad={META_HIT} />}
            {!isEvent && <TaskStarButton task={task} size={META_ICON} accent pad={META_HIT} />}
            {!isEvent && (
              <button
                onClick={openNotesPanel}
                className={`flex items-center gap-1 flex-shrink-0 ${META_HIT} rounded hover:opacity-100 hover:text-blue-500 ${
                  hasNotesContent ? 'opacity-70' : 'opacity-35'
                }`}
                title={hasNotesContent ? t('sched.notesSubtasks', 'Notes & subtasks') : t('sched.addNotesSubtasks', 'Add notes or subtasks')}
                aria-label={hasNotesContent ? t('sched.viewNotesSubtasks', 'View notes and subtasks') : t('sched.addNotesSubtasks', 'Add notes or subtasks')}
              >
                {isObsidianNoteOnlyTask(task) ? <BookOpen size={META_ICON} /> : <FileText size={META_ICON} />}
                {subtasks.length > 0 && (
                  <span className="flex items-center gap-0.5">
                    <CheckSquare size={META_ICON} />
                    {subtasksDone}/{subtasks.length}
                  </span>
                )}
              </button>
            )}
            {/* Deadline — the inbox's button and picker, on inbox cards
                (the PLANNER's unscheduled column). */}
            {isInbox && !isEvent && !task.completed && (
              <span className="deadline-picker-container relative flex-shrink-0 flex">
                <button
                  onClick={e => {
                    e.stopPropagation();
                    setShowDeadlinePicker(showDeadlinePicker === deadlinePickerKey ? null : deadlinePickerKey);
                  }}
                  className={`flex items-center gap-1 ${META_HIT} rounded hover:opacity-100 hover:text-blue-500 ${
                    task.deadline ? `font-medium ${darkMode ? 'text-blue-400' : 'text-blue-600'}` : 'opacity-35'
                  }`}
                  title={task.deadline
                    ? t('task.deadlineWithDate', { date: formatDeadlineDate(task.deadline), defaultValue: 'Deadline: {{date}}' })
                    : t('task.setDeadline', { defaultValue: 'Set deadline' })}
                  aria-label={t('task.setDeadline', { defaultValue: 'Set deadline' })}
                >
                  <Calendar size={META_ICON} />
                  {task.deadline && <span className="whitespace-nowrap">{formatDeadlineDate(task.deadline)}</span>}
                </button>
                {showDeadlinePicker === deadlinePickerKey && (
                  <DeadlinePickerPopover
                    portal
                    taskId={task.id}
                    currentDeadline={task.deadline}
                    onClose={() => setShowDeadlinePicker(null)}
                  />
                )}
              </span>
            )}
            {linkUrl && (
              <a
                href={linkUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className={`flex-shrink-0 ${META_HIT} rounded opacity-70 hover:opacity-100 hover:text-blue-500`}
                title={linkUrl}
              >
                <ExternalLink size={META_ICON} />
              </a>
            )}
            {tags.length > 0 && (
              <span className="italic opacity-75 truncate min-w-0" title={tags.map(t => `#${t}`).join(' ')}>
                {tags.map(t => `#${t}`).join(' ')}
              </span>
            )}
            {project && (
              <span
                className="px-2 py-0.5 rounded-full text-xs font-medium truncate flex-shrink-0 max-w-[12rem] ml-auto"
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
      {onSchedule && !task.completed && !isEvent && (
        <button
          onClick={e => { e.stopPropagation(); onSchedule(task); }}
          className={`flex-shrink-0 p-2 -my-1 rounded-lg opacity-60 hover:opacity-100 hover:text-blue-500 ${textSecondary}`}
          title={t('sched.scheduleForTodaySlot', 'Schedule for today (next open slot)')}
          aria-label={t('sched.scheduleForToday', 'Schedule for today')}
        >
          <CalendarPlus size={ACTION_ICON} />
        </button>
      )}
      {canPostpone && (
        <button
          onClick={e => { e.stopPropagation(); postponeTask(task.id); }}
          className={`flex-shrink-0 p-2 -my-1 rounded-lg opacity-60 hover:opacity-100 hover:text-blue-500 ${textSecondary}`}
          title={t('sched.postponeTomorrow', 'Postpone to tomorrow')}
          aria-label={t('sched.postponeTomorrow', 'Postpone to tomorrow')}
        >
          {/* Same icon as the timeline's postpone button — same action. */}
          <SkipForward size={ACTION_ICON} />
        </button>
      )}

      {/* Notes/subtasks overlay — portaled to body at z-90 so it tops the
          planner (70) and the task editor (80) regardless of where the card
          renders. The sched-notes-panel class tells other ESC handlers to
          stand down. */}
      {showNotes && createPortal(
        <div
          className="sched-notes-panel notes-panel-container fixed inset-0 z-[90] flex items-center justify-center p-4"
          onClick={e => { e.stopPropagation(); setShowNotes(false); }}
        >
          <div className="absolute inset-0 bg-black/40" />
          <div
            onClick={e => e.stopPropagation()}
            className={`relative w-[720px] max-w-[92vw] max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl border ${
              darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'
            }`}
          >
            <NotesSubtasksPanel
              task={task}
              isInbox={isInbox}
              darkMode={darkMode}
              compact={false}
              updateTaskNotes={updateTaskNotes}
              addSubtask={addSubtask}
              toggleSubtask={toggleSubtask}
              deleteSubtask={deleteSubtask}
              updateSubtaskTitle={updateSubtaskTitle}
              aiConfig={aiConfig}
              aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
              onGenerateSubtasks={generateAISubtasks}
              wikilinks={wikilinks.length > 0 ? wikilinks : undefined}
              onLoadWikiNote={wikilinks.length > 0 ? loadWikiNote : undefined}
              onSaveWikiNote={wikilinks.length > 0 ? saveWikiNote : undefined}
              onOpenInObsidian={wikilinks.length > 0 ? openInObsidian : undefined}
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default SchedTaskCard;
