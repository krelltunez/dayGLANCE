import React, { memo, useMemo } from 'react';
import { AlertCircle, Archive, Calendar, Check, Pencil, Telescope } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderTitle, hasNotesOrSubtasks, isLinkOnlyTask, openNoteAction, NoteIcon, noteActionTarget } from '../utils/textFormatting.jsx';
import { dateToString, extractWikilinks, formatDeadlineDate } from '../utils/taskUtils.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import TaskTitleRenameField from './TaskTitleRenameField.jsx';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';

/**
 * One task in the desktop Inbox (#2143). Memoized, and it reads no app
 * context: the app's context is a new object on every App render, so a row
 * that read it re-rendered on every keystroke anywhere in the app, and an
 * Inbox of a few thousand tasks took most of a second to answer one. A row
 * now re-renders only when a prop it shows changes: its task (whose object
 * keeps its identity until that task changes), whether it is being renamed,
 * has its notes or deadline picker open, its pending priority, its project.
 *
 * Handlers come through `actions`, a ref the sidebar refreshes every render,
 * so the row's props stay stable and every call reaches the latest function.
 * Anything passed down (the notes panel's callbacks) is wrapped the same way,
 * never captured: a row that skips renders must not hold a stale handler.
 */
function InboxTaskRow({
  task, actions,
  isEditing,
  notesOpen, deadlinePickerOpen, pendingPriority, project, projectFilterActive,
  darkMode,
  aiConfig, aiSubtasksLoadingForTask,
}) {
  const { t } = useTranslation();
  // Stable callers: `call('name')` is the same function on every render and
  // always runs actions.current.name, the latest.
  const call = useMemo(() => {
    const cache = new Map();
    return (name) => {
      if (!cache.has(name)) cache.set(name, (...args) => actions.current[name]?.(...args));
      return cache.get(name);
    };
  }, [actions]);
  const wikilinks = extractWikilinks(task.title);
  const priorityLabels = [t('task.noPriority'), t('task.lowPriority'), t('task.mediumPriority'), t('task.highPriority')];

  return (
    <div
      data-task-id={task.id}
      className="notes-panel-container"
    >
      <div
        data-ctx-menu
        onContextMenu={(e) => {
          e.preventDefault();
          call('setTaskContextMenu')({
            x: e.clientX, y: e.clientY,
            taskId: task.id,
            isRecurring: false,
            isImported: false,
            isAllDay: false,
            dateStr: dateToString(new Date()),
            inlineRename: true,
          });
        }}
        draggable
        onDragStart={(e) => call('handleDragStart')(task, 'inbox', e)}
        onDragEnd={call('handleDragEnd')}
        className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
      >
        {task.isExample && (
          <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
            {t('common.example')}
          </span>
        )}
        <div className="flex items-start justify-between text-white">
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <button
              onClick={() => call('toggleComplete')(task.id, true)}
              className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
            >
              {task.completed && <Check size={10} strokeWidth={3} />}
            </button>
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <TaskTitleRenameField isInbox weight="font-medium" />
              ) : (
                <div
                  className={`font-medium text-sm ${task.completed ? 'line-through' : ''} cursor-text`}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    call('startEditingTask')(task, true);
                  }}
                  title={t('task.doubleClickToRename')}
                >
                  {renderTitle(task.title)}
                </div>
              )}
              <div className="text-xs opacity-90 mt-1 flex items-center gap-2 flex-wrap">
                <span>{t('common.minutesShort', { count: task.duration })}</span>
                {task.deadline && (
                  <span className="flex items-center gap-1">
                    <AlertCircle size={10} />
                    {formatDeadlineDate(task.deadline)}
                  </span>
                )}
                {project && (() => {
                  const proj = project;
                  return (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const a = actions.current;
                        const active = projectFilterActive;
                        a.setProjectFilter(active ? null : task.projectId);
                        a.setInboxProjectFilter(active ? [] : [task.projectId]);
                        if (!active) { a.setInboxPriorityFilter(0); a.setHideCompletedInbox(false); a.setHideProjectTasksInbox(false); a.setHideStandaloneTasksInbox(true); } else { a.setHideProjectTasksInbox(true); a.setHideStandaloneTasksInbox(false); }
                      }}
                      className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors flex-shrink-0 ${projectFilterActive ? 'ring-1 ring-white/60' : ''}`}
                      title={projectFilterActive
                        ? t('sched.clearProjectFilter')
                        : t('sched.filterProject', { project: proj.title, defaultValue: 'Filter: {{project}}' })}
                    >
                      {proj.title}
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 flex-shrink-0">
            <div className="flex items-start gap-1">
              <button
                onMouseDown={() => {
                  const a = actions.current;
                  if (isLinkOnlyTask(task)) {
                    a.longPressTriggeredRef.current = false;
                    a.longPressTimerRef.current = setTimeout(() => {
                      a.longPressTriggeredRef.current = true;
                      a.setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                    }, 500);
                  }
                }}
                onMouseUp={() => {
                  const { longPressTimerRef } = actions.current;
                  if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                }}
                onMouseLeave={() => {
                  const { longPressTimerRef } = actions.current;
                  if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  const a = actions.current;
                  if (isLinkOnlyTask(task)) {
                    if (!a.longPressTriggeredRef.current) {
                      openNoteAction(task);
                    }
                    a.longPressTriggeredRef.current = false;
                  } else {
                    a.setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                  }
                }}
                className={`hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) || wikilinks.length > 0 ? '' : 'opacity-40'}`}
                title={isLinkOnlyTask(task)
                  ? `${noteActionTarget(task)} ${t('task.holdToEditHint')}`
                  : t('sched.notesSubtasks')}
              >
                <NoteIcon task={task} size={14} />
              </button>
              <div className="deadline-picker-container relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    call('setShowDeadlinePicker')(deadlinePickerOpen ? null : task.id);
                  }}
                  className={`hover:bg-white/20 rounded p-1 transition-colors ${task.deadline ? 'bg-white/20' : 'opacity-40'}`}
                  title={task.deadline
                    ? t('task.deadlineWithDate', { date: formatDeadlineDate(task.deadline), defaultValue: 'Deadline: {{date}}' })
                    : t('task.setDeadline', { defaultValue: 'Set deadline' })}
                >
                  <Calendar size={14} />
                </button>
                {deadlinePickerOpen && (
                  <DeadlinePickerPopover
                    taskId={task.id}
                    currentDeadline={task.deadline}
                    onClose={() => call('setShowDeadlinePicker')(null)}
                  />
                )}
              </div>
              <button
                onClick={() => call('openMobileEditTask')(task, true)}
                className="hover:bg-white/20 rounded p-1 transition-colors"
                title={t('common.edit')}
              >
                <Pencil size={14} />
              </button>
              {!task.completed && (
                <button
                  onClick={(e) => { e.stopPropagation(); call('sendTaskToBucket')(task.id); }}
                  className="hover:bg-white/20 rounded p-1 transition-colors opacity-40 hover:opacity-100"
                  title={t('bucket.sendToBucket')}
                >
                  <Telescope size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center justify-between mt-1">
              {task.completed ? (
                <button
                  onClick={(e) => { e.stopPropagation(); call('archiveInboxTask')(task.id); }}
                  className="flex items-center gap-0.5 hover:bg-white/20 rounded px-1.5 py-1 transition-colors opacity-60 hover:opacity-100"
                  title={t('task.archiveTask', { defaultValue: 'Archive task' })}
                >
                  <Archive size={11} className="text-white" />
                </button>
              ) : <span />}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  call('cyclePriority')(task.id);
                }}
                className="flex gap-0.5 hover:bg-white/20 rounded px-2 py-1.5 transition-colors"
                title={priorityLabels[pendingPriority ?? task.priority ?? 0]}
              >
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className={`w-2 h-0.5 rounded-full bg-white ${i < (pendingPriority ?? task.priority ?? 0) ? 'opacity-100' : 'opacity-30'}`}
                  />
                ))}
              </button>
            </div>
          </div>
        </div>
        {notesOpen && (
          <NotesSubtasksPanel
            task={task}
            isInbox={true}
            darkMode={darkMode}
            updateTaskNotes={call('updateTaskNotes')}
            addSubtask={call('addSubtask')}
            toggleSubtask={call('toggleSubtask')}
            deleteSubtask={call('deleteSubtask')}
            updateSubtaskTitle={call('updateSubtaskTitle')}
            aiConfig={aiConfig}
            aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
            onGenerateSubtasks={call('generateAISubtasks')}
            wikilinks={wikilinks.length > 0 ? wikilinks : undefined}
            onLoadWikiNote={wikilinks.length > 0 ? call('loadWikiNote') : undefined}
            onSaveWikiNote={wikilinks.length > 0 ? call('saveWikiNote') : undefined}
            onOpenInObsidian={wikilinks.length > 0 ? call('openInObsidian') : undefined}
          />
        )}
      </div>
    </div>
  );
}

export default memo(InboxTaskRow);
