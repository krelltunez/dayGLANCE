import React, { useState, useRef, useMemo } from 'react';
import {
  AlertCircle, Archive, BrainCircuit, Calendar, Check, Filter, Inbox,
  Pencil, Plus, Settings, Telescope,
} from 'lucide-react';
import { renderTitle, hasNotesOrSubtasks, isLinkOnlyTask, openNoteAction, NoteIcon, noteActionTarget } from '../utils/textFormatting.jsx';
import { dateToString, extractWikilinks, formatDeadlineDate } from '../utils/taskUtils.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import InboxTaskRow from './InboxTaskRow.jsx';
import useIncrementalList from '../hooks/useIncrementalList.js';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';
import InboxFilterPopover from './InboxFilterPopover.jsx';
import InboxFilterButtons from './InboxFilterButtons.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useTranslation } from 'react-i18next';
import { notBucketed } from '../utils/bucketList.js';
import { aiFeatureOn } from '../ai.js';
import TouchInboxTaskRow from './TouchInboxTaskRow.jsx';

const InboxSidebar = ({ variant = 'desktop' }) => {
  const {
    longPressTriggeredRef, longPressTimerRef,
    editingInputRef,
    darkMode,
    unscheduledTasks,
    editingTaskId,
    expandedNotesTaskId, setExpandedNotesTaskId,
    showDeadlinePicker, setShowDeadlinePicker,
    taskContextMenu, setTaskContextMenu,
    inboxPriorityFilter, setInboxPriorityFilter,
    pendingPriorities,
    filteredUnscheduledTasks,
    textPrimary, textSecondary,
    playUISound,
    toggleComplete,
    openNewInboxTask,
    startEditingTask, saveTaskTitle,
    handleEditInputChange, handleEditKeyDown,
    applySuggestionForEdit,
    cyclePriority,
    archiveInboxTask,
    sendTaskToBucket,
    openMobileEditTask,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    handleDragStart, handleDragEnd,
    handleDragOverInbox, handleDropOnInbox,
    dragOverInbox, setDragOverInbox,
    hideCompletedInbox, setHideCompletedInbox,
    hideStandaloneTasksInbox, setHideStandaloneTasksInbox,
    hideProjectTasksInbox, setHideProjectTasksInbox,
    inboxTagFilter, inboxProjectFilter, setInboxProjectFilter,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
  } = useDayPlannerCtx();
  const { t } = useTranslation();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx();
  const {
    aiConfig,
    myFrames,
    showFramesModal, setShowFramesModal,
    framesModalTab, setFramesModalTab,
    editingFrame, setEditingFrame,
    goalsProjectsEnabled, projects, projectFilter, setProjectFilter,
    aiSubtasksLoadingForTask, generateAISubtasks,
  } = useFeaturesCtx();

  // The desktop rows' handlers (InboxTaskRow, #2143): one ref, refreshed on
  // every render, so the memoized rows keep stable props and still call the
  // latest functions.
  const rowActions = useRef(null);
  rowActions.current = {
    setTaskContextMenu, handleDragStart, handleDragEnd, toggleComplete,
    handleEditInputChange, handleEditKeyDown, saveTaskTitle, applySuggestionForEdit, editingInputRef,
    startEditingTask, setProjectFilter, setInboxProjectFilter, setInboxPriorityFilter,
    setHideCompletedInbox, setHideProjectTasksInbox, setHideStandaloneTasksInbox,
    longPressTriggeredRef, longPressTimerRef, setExpandedNotesTaskId, setShowDeadlinePicker,
    openMobileEditTask, sendTaskToBucket, archiveInboxTask, cyclePriority,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle, generateAISubtasks,
    loadWikiNote, saveWikiNote, openInObsidian,
  };
  const projectsById = useMemo(() => new Map((projects || []).map(p => [p.id, p])), [projects]);

  const [showInboxFilter, setShowInboxFilter] = useState(false);
  const inboxFilterBtnRef = useRef(null);
  const inboxFilterActive =
    hideCompletedInbox ||
    hideStandaloneTasksInbox ||
    (goalsProjectsEnabled && !hideProjectTasksInbox) ||
    inboxTagFilter.length > 0 ||
    inboxProjectFilter.length > 0;
  const isDesktop = variant === 'desktop';
  const priorityLabels = [
    t('task.noPriority'),
    t('task.lowPriority'),
    t('task.mediumPriority'),
    t('task.highPriority'),
  ];

  // The touch rows' handlers (TouchInboxTaskRow, #2143), as the desktop
  // rows take theirs: one ref, refreshed every render.
  const touchRowActions = useRef(null);
  touchRowActions.current = {
    setTaskContextMenu, toggleComplete, startEditingTask,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
    setProjectFilter, setInboxProjectFilter,
    longPressTriggeredRef, longPressTimerRef, setExpandedNotesTaskId, setShowDeadlinePicker,
    sendTaskToBucket, archiveInboxTask, cyclePriority,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle, generateAISubtasks,
    loadWikiNote, saveWikiNote, openInObsidian,
  };

  // Rows render a part at a time (useIncrementalList, #2143): building every
  // row on open froze a large Inbox. The tablet list leaves out examples.
  const listTasks = useMemo(
    () => (isDesktop ? filteredUnscheduledTasks : filteredUnscheduledTasks.filter(t => !t.isExample)),
    [isDesktop, filteredUnscheduledTasks],
  );
  const { visible: visibleTasks, hasMore: moreTasks, sentinelRef: moreTasksRef } = useIncrementalList(listTasks, {
    keep: [editingTaskId, expandedNotesTaskId, showDeadlinePicker],
  });

  if (isDesktop) {
    return (
    <>
  <div
    onDragOver={handleDragOverInbox}
    onDragLeave={(e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        setDragOverInbox(false);
      }
    }}
    onDrop={handleDropOnInbox}
    className={`transition-colors ${dragOverInbox ? (darkMode ? 'bg-green-900/20 rounded-lg ring-2 ring-inset ring-green-400' : 'bg-green-50 rounded-lg ring-2 ring-inset ring-green-500') : ''}`}
  >
    {/* Actions left, filters right (InboxFilterButtons, shared with the
        phone and tablet). Where Smart Schedule's button leaves no room, the
        filters wrap onto their own line rather than squeezing. */}
    <div data-inbox-header className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div className="flex items-center gap-2">
        <button
          onClick={openNewInboxTask}
          className="h-8 px-2.5 flex items-center justify-center gap-1 whitespace-nowrap bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          title={t('task.newInbox')}
        >
          <Plus size={14} strokeWidth={3} />
          <span className="text-xs font-medium">{t('common.newTask')}</span>
        </button>
        {aiFeatureOn(aiConfig, 'smartScheduling') && myFrames.filter(f => f.enabled).length > 0 && unscheduledTasks.filter(t => notBucketed(t) && !t.completed && !t.isExample).length > 0 && (
          <button
            onClick={() => { setShowFramesModal(true); setFramesModalTab('schedule'); setEditingFrame(null); }}
            className="h-8 px-2.5 flex items-center justify-center gap-1 whitespace-nowrap bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            title={t('inbox.aiSmartSchedule', { defaultValue: 'AI Smart Schedule' })}
          >
            <BrainCircuit size={14} />
            <span className="text-xs font-medium">{t('common.schedule')}</span>
          </button>
        )}
      </div>
      {unscheduledTasks.filter(t => notBucketed(t) && !t.deadline).length > 0 && (
        <InboxFilterButtons
          filterActive={inboxFilterActive}
          onToggleFilter={() => setShowInboxFilter(v => !v)}
          filterButtonRef={inboxFilterBtnRef}
        />
      )}
    </div>

    <div className="space-y-2">
      {filteredUnscheduledTasks.length === 0 ? (
        <p className={`text-sm ${textSecondary} text-center py-4`}>
          {unscheduledTasks.length === 0
            ? t('inbox.dragToUnschedule', { defaultValue: 'Drag tasks here to unschedule them' })
            : unscheduledTasks.length === 0
              ? t('inbox.allTasksOverdueHint', { defaultValue: 'All inbox tasks have overdue deadlines' })
              : t('sched.noMatchingTasks')}
        </p>
      ) : (
        visibleTasks.map(task => (
        <InboxTaskRow
          key={task.id}
          task={task}
          actions={rowActions}
          // The rename field reads its text and suggestions from context
          // (TaskTitleRenameField), so only the row being renamed re-renders.
          isEditing={editingTaskId === task.id}
          notesOpen={expandedNotesTaskId === task.id}
          deadlinePickerOpen={showDeadlinePicker === task.id}
          pendingPriority={pendingPriorities[task.id]}
          project={goalsProjectsEnabled && task.projectId ? projectsById.get(task.projectId) || null : null}
          projectFilterActive={!!task.projectId && projectFilter === task.projectId}
          darkMode={darkMode}
          aiConfig={aiConfig}
          aiSubtasksLoadingForTask={expandedNotesTaskId === task.id ? aiSubtasksLoadingForTask : null}
        />
      ))
    )}
    {moreTasks && <div ref={moreTasksRef} data-inbox-more aria-hidden="true" className="h-px" />}
    </div>
  </div>
  <InboxFilterPopover
    open={showInboxFilter}
    onClose={() => setShowInboxFilter(false)}
    buttonRef={inboxFilterBtnRef}
  />
    </>
    );
  }

  // Tablet variant
  const touchProjectsById = new Map((projects || []).map(p => [p.id, p]));
  return (
    <>
<div className="p-4" data-inbox-container>
  {/* Inbox header: actions left, filters right (InboxFilterButtons) */}
  <div data-inbox-header className="flex flex-wrap items-center justify-between gap-2 mb-4">
    <div className="flex items-center gap-2">
      <button
        onClick={openNewInboxTask}
        className="p-2 flex items-center justify-center bg-blue-600 text-white rounded-lg active:bg-blue-700 transition-colors"
        title={t('task.newInbox')}
      >
        <Plus size={16} strokeWidth={3} />
      </button>
      {aiFeatureOn(aiConfig, 'smartScheduling') && myFrames.filter(f => f.enabled).length > 0 && unscheduledTasks.filter(t => notBucketed(t) && !t.completed && !t.isExample).length > 0 && (
        <button
          onClick={() => { setShowFramesModal(true); setFramesModalTab('schedule'); setEditingFrame(null); }}
          className="p-2 flex items-center justify-center bg-blue-600 text-white rounded-lg active:bg-blue-700 transition-colors"
          title={t('inbox.aiSmartSchedule', { defaultValue: 'AI Smart Schedule' })}
        >
          <BrainCircuit size={16} />
        </button>
      )}
    </div>
    <InboxFilterButtons
      filterActive={inboxFilterActive}
      onToggleFilter={() => setShowInboxFilter(v => !v)}
      filterButtonRef={inboxFilterBtnRef}
    />
  </div>
  <div className="space-y-2">
    {filteredUnscheduledTasks.filter(t => !t.isExample).length === 0 ? (
      <div className="flex flex-col items-center justify-center py-12 px-6">
        <div className={`relative w-16 h-16 rounded-2xl ${darkMode ? 'bg-emerald-500/15' : 'bg-emerald-50'} flex items-center justify-center mb-4`}>
          <Inbox size={28} className={`${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
          {unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0 && (
            <Check size={14} className={`absolute -top-1 -right-1 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
          )}
        </div>
        <p className={`text-base font-semibold ${textPrimary} mb-1`}>
          {unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0
            ? t('inbox.zero', { defaultValue: 'Inbox zero' })
            : unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0
              ? t('inbox.allOverdue', { defaultValue: 'All overdue' })
              : t('inbox.noMatches', { defaultValue: 'No matches' })}
        </p>
        <p className={`text-sm ${textSecondary} text-center mb-5`}>
          {unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0
            ? t('inbox.addTasksForLater', { defaultValue: 'Add tasks here to schedule later' })
            : unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0
              ? t('inbox.allTasksOverdueHint', { defaultValue: 'All inbox tasks have overdue deadlines' })
              : t('sched.noMatchingTasks')}
        </p>
        {unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0 && (
          <button
            onClick={openNewInboxTask}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${darkMode ? 'bg-emerald-500 text-white active:bg-emerald-600' : 'bg-emerald-500 text-white active:bg-emerald-600'} transition-colors`}
          >
            <Plus size={16} />
            {t('task.addTask')}
          </button>
        )}
      </div>
    ) : (
      visibleTasks.map(task => (
        <TouchInboxTaskRow
          key={task.id}
          task={task}
          actions={touchRowActions}
          inlineNotes
          notesOpen={expandedNotesTaskId === task.id}
          deadlinePickerOpen={showDeadlinePicker === task.id}
          pendingPriority={pendingPriorities[task.id]}
          project={goalsProjectsEnabled && task.projectId ? touchProjectsById.get(task.projectId) || null : null}
          projectFilterActive={!!task.projectId && projectFilter === task.projectId}
          darkMode={darkMode}
          aiConfig={aiConfig}
          aiSubtasksLoadingForTask={expandedNotesTaskId === task.id ? aiSubtasksLoadingForTask : null}
        />
      ))
    )}
    {moreTasks && <div ref={moreTasksRef} data-inbox-more aria-hidden="true" className="h-px" />}
  </div>
</div>
  <InboxFilterPopover
    open={showInboxFilter}
    onClose={() => setShowInboxFilter(false)}
    buttonRef={inboxFilterBtnRef}
  />
    </>
  );
};

export default InboxSidebar;
