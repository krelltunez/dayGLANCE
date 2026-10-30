import React from 'react';
import {
  BookOpen, Check, Clock, Repeat, FileText, Inbox, MapPin, MoreHorizontal,
  Pencil, RefreshCw, SkipForward, Trash2,
} from 'lucide-react';
import { isNativeAndroid, SOURCE_APPS } from '../native.js';
import { renderTitleWithoutTags, renderTitleWithoutWikilinks, hasNotesOrSubtasks, isLinkOnlyTask, openNoteAction, NoteIcon, noteActionTarget, isTaskLinkOnlyTask } from '../utils/textFormatting.jsx';
import { extractTags, extractWikilinks, stripWikilinks } from '../utils/taskUtils.js';
import TaskTitleRenameField from './TaskTitleRenameField.jsx';
import LastGlanceBadge from './LastGlanceBadge.jsx';
import TaskPlanHistory from './TaskPlanHistory.jsx';
import TaskStarButton from './TaskStarButton.jsx';
import UserAssignmentBadge from './UserAssignmentBadge.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import EventNotesPanel, { editsDeviceCalendar } from './EventNotesPanel.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useTranslation } from 'react-i18next';

const CardContent = ({ task, height, isNarrowWidth, flipNotesPanel }) => {
  const { t } = useTranslation();
  const {
    isTablet,
    darkMode,
    editingTaskId,
    expandedNotesTaskId, setExpandedNotesTaskId,
    expandedTaskMenu, setExpandedTaskMenu,
    longPressTimerRef, longPressTriggeredRef,
    setEditingRecurrenceTaskId,
    openMobileEditTask,
    toggleComplete,
    startEditingTask,
    moveToInbox, moveToRecycleBin, postponeTask,
    formatTime, timeToMinutes,
    setTasks,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    setInboxProjectFilter, setInboxPriorityFilter, setHideCompletedInbox,
    setHideProjectTasksInbox, setHideStandaloneTasksInbox,
  } = useDayPlannerCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx();
  const {
    goalsProjectsEnabled,
    projects,
    projectFilter, setProjectFilter,
    aiConfig, aiSubtasksLoadingForTask, generateAISubtasks,
    multiUserEnabled, users,
  } = useFeaturesCtx();

  const isImported = task.imported;
  const isCalendarEvent = isImported && !task.isTaskCalendar;
  const isMicroHeight = height <= 40;
  const isRecurringTask = typeof task.id === 'string' && task.id.startsWith('recurring-');

  const NotesButton = ({ inMenu = false }) => (
    <button
      onMouseDown={() => {
        if (isLinkOnlyTask(task)) {
          longPressTriggeredRef.current = false;
          longPressTimerRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
          }, 500);
        }
      }}
      onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
      onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
      onClick={(e) => {
        e.stopPropagation();
        if (isLinkOnlyTask(task)) {
          if (!longPressTriggeredRef.current) {
            openNoteAction(task);
          }
          longPressTriggeredRef.current = false;
        } else {
          setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
        }
      }}
      className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) || extractWikilinks(task.title).length > 0 ? '' : 'opacity-40'}`}
      title={isLinkOnlyTask(task)
        ? `${noteActionTarget(task)} ${t('task.holdToEditHint', { defaultValue: '(hold to edit)' })}`
        : t('sched.notesSubtasks')}
    >
      <NoteIcon task={task} size={14} />
      {inMenu && <span className="text-xs">{isTaskLinkOnlyTask(task) ? t('task.openLinkedTask', { defaultValue: 'Open task' }) : isLinkOnlyTask(task) ? t('task.openLink', { defaultValue: 'Open Link' }) : t('task.notes')}</span>}
    </button>
  );

  const ActionButtons = ({ inMenu = false }) => {
    if (isRecurringTask) {
      return (
        <>
          <NotesButton inMenu={inMenu} />
          {task.recurrenceType !== 'daily' && (
          <button
            onClick={() => postponeTask(task.id)}
            className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
            title={t('sched.postponeTomorrow')}
          >
            <SkipForward size={14} />
            {inMenu && <span className="text-xs">{t('common.postpone')}</span>}
          </button>
          )}
          {!isTablet && (
          <button
            onClick={() => openMobileEditTask(task, false)}
            className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
            title={t('common.edit')}
          >
            <Pencil size={14} />
            {inMenu && <span className="text-xs">{t('common.edit')}</span>}
          </button>
          )}
          {!isTablet && (
          <button
            onClick={() => moveToRecycleBin(task.id)}
            className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
            title={t('common.delete')}
          >
            <Trash2 size={14} />
            {inMenu && <span className="text-xs">{t('common.delete')}</span>}
          </button>
          )}
        </>
      );
    }
    return (
      <>
        <NotesButton inMenu={inMenu} />
        <button
          onClick={() => postponeTask(task.id)}
          className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
          title={t('sched.postponeTomorrow')}
        >
          <SkipForward size={14} />
          {inMenu && <span className="text-xs">{t('common.postpone')}</span>}
        </button>
        {!isTablet && (
        <button
          onClick={() => openMobileEditTask(task, false)}
          className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
          title={t('common.edit')}
        >
          <Pencil size={14} />
          {inMenu && <span className="text-xs">{t('common.edit')}</span>}
        </button>
        )}
        {!isTablet && (
        <button
          onClick={() => moveToInbox(task.id)}
          className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
          title={t('task.moveToInbox')}
        >
          <Inbox size={14} />
          {inMenu && <span className="text-xs">{t('common.toInbox')}</span>}
        </button>
        )}
      </>
    );
  };

  return (
    <>
      <div className="px-2 py-1 flex-1 min-w-0 h-full flex flex-col">
        {isImported && !isCalendarEvent ? null : isCalendarEvent ? (
          /* IMPORTED EVENT LAYOUT: Always show time on right with truncated title */
          <div className="flex flex-col h-full justify-start gap-0.5">
            <div className="flex items-center justify-between gap-2">
              <div
                className="font-semibold text-sm leading-tight truncate flex-1 min-w-0"
                title={stripWikilinks(task.title)}
              >
                {renderTitleWithoutWikilinks(task.title)}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* The calendar's description, your own note, or (faint)
                    room to add one, as a task's notes button does. */}
                {(!isMicroHeight || task.notes || task.eventNote) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                    }}
                    className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${task.notes || task.eventNote ? '' : 'opacity-40'}`}
                    title={t('sched.viewNotesSubtasks')}
                  >
                    <FileText size={12} />
                  </button>
                )}
                <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1">
                  <Clock size={10} />
                  {formatTime(task.startTime)} • {t('common.minutesShort', { count: task.duration, defaultValue: '{{count}} min' })}
                </div>
              </div>
            </div>
            {!isMicroHeight && (task.calendarName || task.location) && (
              <div className="text-xs opacity-75 truncate flex items-center gap-1">
                {task.calendarName && <span className="truncate max-w-[50%]">{task.calendarName}</span>}
                {task.calendarName && task.location && <span className="opacity-50">·</span>}
                {task.location && <><MapPin size={9} /><span className="truncate">{task.location}</span></>}
              </div>
            )}
          </div>
        ) : isNarrowWidth ? (
          /* NARROW LAYOUT: overflow menu + checkbox + title + tags */
          <>
            {!isImported && (
              <button
                onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                className="task-menu-container absolute top-0.5 right-0.5 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
              >
                <MoreHorizontal size={14} />
                {expandedTaskMenu === task.id && (
                  <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-stone-300 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                    <ActionButtons inMenu={true} />
                  </div>
                )}
              </button>
            )}
            <div className="pr-6">
              <div className="flex items-center gap-1">
                {(!isImported || task.isTaskCalendar) && (
                  <button
                    onClick={() => toggleComplete(task.id)}
                    className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                  >
                    {task.completed && <Check size={10} strokeWidth={3} />}
                  </button>
                )}
                {task.isRecurring && <RefreshCw size={12} data-no-card-dblclick className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                {task.importSource === 'obsidian' && <BookOpen size={12} className="flex-shrink-0 opacity-75" title={t('task.fromObsidian', { defaultValue: 'From Obsidian' })} />}
                {task.obsidianRecurrence && <Repeat size={12} className="flex-shrink-0 opacity-75" title={t('task.obsidianRecurrenceManaged', { defaultValue: "Recurring in Obsidian — this task's recurrence is managed by the Tasks plugin; completing it here won't create the next instance" })} />}
                {task.source_app === SOURCE_APPS.LASTGLANCE && <LastGlanceBadge size={12} className="flex-shrink-0" title={t('task.addedByLastGlance')} />}
                {!isImported && <TaskPlanHistory task={task} />}
                {!isImported && <TaskStarButton task={task} />}
              {task.obsidianNotePath && <FileText size={12} className="flex-shrink-0 opacity-75" title={t('task.obsidianNoteSource', { note: task.obsidianNotePath.replace(/\.md$/, ''), defaultValue: 'In {{note}} (Obsidian)' })} />}
                {multiUserEnabled && <UserAssignmentBadge users={users} assignedUserSyncIds={task.assignedUserSyncIds} size={14} />}
                <div className="flex-1 min-w-0">
                  {!isTablet && editingTaskId === task.id ? (
                    <TaskTitleRenameField />
                  ) : (
                    <div className="flex items-center gap-0.5">
                      <div
                        className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''} ${!isImported && !isTablet ? 'cursor-text' : ''}`}
                        onDoubleClick={!isTablet ? (e) => {
                          if (!isImported) {
                            e.stopPropagation();
                            startEditingTask(task, false);
                          }
                        } : undefined}
                        title={stripWikilinks(task.title)}
                      >
                        {renderTitleWithoutTags(task.title)}
                      </div>
                    </div>
                  )}
                  {(extractTags(task.title).length > 0 || (goalsProjectsEnabled && task.projectId)) && (
                    <div className="flex items-center gap-1 flex-wrap text-xs italic opacity-75">
                      {extractTags(task.title).length > 0 && (
                        <span className="truncate">{extractTags(task.title).map(tag => `#${tag}`).join(' ')}</span>
                      )}
                      {goalsProjectsEnabled && task.projectId && (() => {
                        const proj = projects.find(p => p.id === task.projectId);
                        if (!proj) return null;
                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); const next = projectFilter === task.projectId ? null : task.projectId; setProjectFilter(next); setInboxProjectFilter(next ? [next] : []); if (next) { setInboxPriorityFilter(0); setHideCompletedInbox(false); setHideProjectTasksInbox(false); setHideStandaloneTasksInbox(true); } else { setHideProjectTasksInbox(true); setHideStandaloneTasksInbox(false); } }}
                            className={`not-italic inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors flex-shrink-0 ${projectFilter === task.projectId ? 'ring-1 ring-white/60' : ''}`}
                            title={projectFilter === task.projectId
                              ? t('sched.clearProjectFilter', { defaultValue: 'Clear project filter' })
                              : `${t('sched.filter')}: ${proj.title}`}
                          >
                            {proj.title}
                          </button>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          /* WIDE LAYOUT: Title+tags row 1 with action buttons, time row 2 */
          <>
            <div className="flex items-center justify-between gap-1">
              <div className="flex items-center gap-1 flex-1 min-w-0">
                {(!isImported || task.isTaskCalendar) && (
                  <button
                    onClick={() => toggleComplete(task.id)}
                    className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                  >
                    {task.completed && <Check size={10} strokeWidth={3} />}
                  </button>
                )}
                {task.isRecurring && <RefreshCw size={12} data-no-card-dblclick className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                {task.importSource === 'obsidian' && <BookOpen size={12} className="flex-shrink-0 opacity-75" title={t('task.fromObsidian', { defaultValue: 'From Obsidian' })} />}
                {task.obsidianRecurrence && <Repeat size={12} className="flex-shrink-0 opacity-75" title={t('task.obsidianRecurrenceManaged', { defaultValue: "Recurring in Obsidian — this task's recurrence is managed by the Tasks plugin; completing it here won't create the next instance" })} />}
                {task.source_app === SOURCE_APPS.LASTGLANCE && <LastGlanceBadge size={12} className="flex-shrink-0" title={t('task.addedByLastGlance')} />}
                {!isImported && <TaskPlanHistory task={task} />}
                {!isImported && <TaskStarButton task={task} />}
                {multiUserEnabled && <UserAssignmentBadge users={users} assignedUserSyncIds={task.assignedUserSyncIds} size={14} />}
                <div className="flex-1 min-w-0">
                  {!isTablet && editingTaskId === task.id ? (
                    <TaskTitleRenameField />
                  ) : (
                    <div className="flex items-center gap-0.5">
                      <div
                        className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''} ${!isImported && !isTablet ? 'cursor-text' : ''}`}
                        onDoubleClick={!isTablet ? (e) => {
                          if (!isImported) {
                            e.stopPropagation();
                            startEditingTask(task, false);
                          }
                        } : undefined}
                        title={!isImported && !isTablet ? t('task.doubleClickToRename') : undefined}
                      >
                        {renderTitleWithoutTags(task.title)}
                      </div>
                    </div>
                  )}
                  {(extractTags(task.title).length > 0 || (goalsProjectsEnabled && task.projectId)) && (
                    <div className="flex items-center gap-1 flex-wrap text-xs italic opacity-75">
                      {extractTags(task.title).length > 0 && (
                        <span className="truncate">{extractTags(task.title).map(tag => `#${tag}`).join(' ')}</span>
                      )}
                      {goalsProjectsEnabled && task.projectId && (() => {
                        const proj = projects.find(p => p.id === task.projectId);
                        if (!proj) return null;
                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); const next = projectFilter === task.projectId ? null : task.projectId; setProjectFilter(next); setInboxProjectFilter(next ? [next] : []); if (next) { setInboxPriorityFilter(0); setHideCompletedInbox(false); setHideProjectTasksInbox(false); setHideStandaloneTasksInbox(true); } else { setHideProjectTasksInbox(true); setHideStandaloneTasksInbox(false); } }}
                            className={`not-italic inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors flex-shrink-0 ${projectFilter === task.projectId ? 'ring-1 ring-white/60' : ''}`}
                            title={projectFilter === task.projectId
                              ? t('sched.clearProjectFilter', { defaultValue: 'Clear project filter' })
                              : `${t('sched.filter')}: ${proj.title}`}
                          >
                            {proj.title}
                          </button>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
              {!isImported && (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <ActionButtons />
                </div>
              )}
            </div>
            {!isImported && height >= 55 && (
              <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1 mt-0.5">
                <Clock size={10} />
                {formatTime(task.startTime)} • {t('common.minutesShort', { count: task.duration, defaultValue: '{{count}} min' })}
              </div>
            )}
          </>
        )}
      </div>
      {/* Notes panel - floating below task (or above if task ends after 22:00).
          A calendar event gets the same panel as a task (EventNotesPanel.jsx). */}
      {expandedNotesTaskId === task.id && !editsDeviceCalendar(task) && (() => {
        const startMin = timeToMinutes(task.startTime || '0:00');
        const endMin = startMin + (task.duration || 0);
        const showAbove = flipNotesPanel !== undefined ? flipNotesPanel : endMin >= 22 * 60;
        return (
          <div
            className="notes-panel-container absolute left-0 right-0 z-40"
            style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
          >
            <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
              <NotesSubtasksPanel
                task={task}
                isInbox={false}
                darkMode={darkMode}
                updateTaskNotes={updateTaskNotes}
                addSubtask={addSubtask}
                toggleSubtask={toggleSubtask}
                deleteSubtask={deleteSubtask}
                updateSubtaskTitle={updateSubtaskTitle}
                compact={false}
                aiConfig={aiConfig}
                aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                onGenerateSubtasks={generateAISubtasks}
                wikilinks={extractWikilinks(task.title).length > 0 ? extractWikilinks(task.title) : undefined}
                onLoadWikiNote={extractWikilinks(task.title).length > 0 ? loadWikiNote : undefined}
                onSaveWikiNote={extractWikilinks(task.title).length > 0 ? saveWikiNote : undefined}
                onOpenInObsidian={extractWikilinks(task.title).length > 0 ? openInObsidian : undefined}
              />
            </div>
          </div>
        );
      })()}
      {/* An event from the device's own calendar: its description, written back */}
      {expandedNotesTaskId === task.id && editsDeviceCalendar(task) && (() => {
        const startMin = timeToMinutes(task.startTime || '0:00');
        const endMin = startMin + (task.duration || 0);
        const showAbove = flipNotesPanel !== undefined ? flipNotesPanel : endMin >= 22 * 60;
        return (
          <div
            className="notes-panel-container absolute left-0 right-0 z-40"
            style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
          >
            <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
              <div className={`p-3 rounded-lg ${darkMode ? 'bg-black/30' : 'bg-white/30'} text-white`} onClick={(e) => e.stopPropagation()}>
                <EventNotesPanel task={task} />
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
};

/**
 * A timeline card's contents. `zoom` (timeline magnification, see
 * utils/timelineZoom.js) draws them larger while laying them out as they
 * would be at 100%: the card's height reaches the contents divided by the
 * zoom, so a card keeps its tier (micro, short, full) at every level. The
 * card itself is placed by the column in real pixels and is not zoomed.
 */
const TimelineTaskCardContent = ({ zoom = 1, height, ...props }) => (zoom === 1
  ? <CardContent height={height} {...props} />
  : (
    <div data-card-zoom={zoom} className="relative flex-1 min-w-0 h-full flex" style={{ zoom }}>
      <CardContent height={height / zoom} {...props} />
    </div>
  ));

export default TimelineTaskCardContent;
