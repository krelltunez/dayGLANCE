import React, { memo, useMemo } from 'react';
import { AlertCircle, Archive, Calendar, Check, Settings, Telescope } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { renderTitle, hasNotesOrSubtasks, isLinkOnlyTask, openNoteAction, NoteIcon } from '../utils/textFormatting.jsx';
import { dateToString, extractWikilinks, formatDeadlineDate } from '../utils/taskUtils.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';

/**
 * One task in the touch Inbox: the tablet's and the phone's (#2143). The same
 * pattern as the desktop row (InboxTaskRow.jsx): memoized, reading no app
 * context, so a change elsewhere in the app leaves it alone; handlers come
 * through `actions`, a ref the list refreshes every render, so a row that
 * skipped renders still calls the latest function.
 *
 * Swipe (schedule / edit) is the app's own touch gesture, which finds the
 * row's swipe strips in the DOM. `inlineNotes`: the tablet opens the task's
 * notes inside the row; the phone opens them in an overlay of its own.
 */
function TouchInboxTaskRow({
  task, actions, inlineNotes = false,
  notesOpen, deadlinePickerOpen, pendingPriority, project, projectFilterActive,
  darkMode, aiConfig, aiSubtasksLoadingForTask,
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

  return (
    // data-task-id: search finds and highlights the row (useNavigation).
    <div className="notes-panel-container" data-task-id={task.id}>
      <div className={`relative rounded-lg ${(deadlinePickerOpen || (inlineNotes && notesOpen)) ? '' : 'overflow-hidden'}`}>
        {/* Swipe action strips */}
        <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-green-900/80 text-green-300' : 'bg-green-100 text-green-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
          <Calendar size={14} className="mr-1" />{t('common.schedule')}
        </div>
        <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
          {t('common.edit')}<Settings size={14} className="ml-1" />
        </div>
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
          });
        }}
        className={`relative select-none ${task.color} rounded-lg px-3 py-4 shadow-sm ${task.completed ? 'opacity-50' : ''} ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
        onTouchStart={(e) => call('handleMobileTaskTouchStart')(e, task, 'inbox')}
        onTouchMove={(e) => call('handleMobileTaskTouchMove')(e)}
        onTouchEnd={(e) => call('handleMobileTaskTouchEnd')(e, task.id, 'inbox')}
      >
        {task.isExample && (
          <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
            {t('common.example')}
          </span>
        )}
        <div className="text-white">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <button
                onClick={() => call('toggleComplete')(task.id, true)}
                className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
              >
                {task.completed && <Check size={10} strokeWidth={3} />}
              </button>
              <div className="flex-1 min-w-0">
                {/* No double-click rename: this row draws no rename field, so it
                    left an invisible rename open (#2263). The menu's Rename and
                    a swipe left open the editor instead. */}
                <div className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}>
                  {renderTitle(task.title)}
                </div>
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
              <div className="flex items-center gap-1">
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
                  onMouseUp={() => { const { longPressTimerRef } = actions.current; if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                  onMouseLeave={() => { const { longPressTimerRef } = actions.current; if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
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
                  className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) || wikilinks.length > 0 ? '' : 'opacity-40'}`}
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
              <div className="flex items-center justify-between w-full">
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
                  className="flex gap-0.5 hover:bg-white/20 rounded px-1.5 py-1 transition-colors"
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
        </div>
      {inlineNotes && notesOpen && (
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
      </div>{/* end swipe wrapper */}
    </div>
  );
}

export default memo(TouchInboxTaskRow);
