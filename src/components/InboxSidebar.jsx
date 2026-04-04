import React, { useState, useRef } from 'react';
import {
  AlertCircle, Archive, BookOpen, BrainCircuit,
  Calendar, Check, CheckSquare, ExternalLink,
  FileText, Filter, Inbox, Pencil, Plus, Settings,
} from 'lucide-react';
import { renderTitle, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { dateToString, extractWikilinks, formatDeadlineDate } from '../utils/taskUtils.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';
import InboxFilterPopover from './InboxFilterPopover.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const InboxSidebar = ({ variant = 'desktop' }) => {
  const {
    longPressTriggeredRef, longPressTimerRef,
    editingInputRef,
    darkMode,
    unscheduledTasks,
    editingTaskId, editingTaskText,
    expandedNotesTaskId, setExpandedNotesTaskId,
    showDeadlinePicker, setShowDeadlinePicker,
    taskContextMenu, setTaskContextMenu,
    inboxPriorityFilter, setInboxPriorityFilter,
    showSuggestions,
    suggestions,
    selectedSuggestionIndex,
    suggestionContext,
    pendingPriorities,
    filteredUnscheduledTasks,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    playUISound,
    toggleComplete,
    openNewInboxTask,
    startEditingTask, saveTaskTitle,
    handleEditInputChange, handleEditKeyDown,
    applySuggestionForEdit,
    cyclePriority,
    archiveInboxTask,
    openMobileEditTask,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    handleDragStart, handleDragEnd,
    handleDragOverInbox, handleDropOnInbox,
    dragOverInbox, setDragOverInbox,
    hideCompletedInbox, hideStandaloneTasksInbox, hideProjectTasksInbox,
    inboxTagFilter, inboxProjectFilter, setInboxProjectFilter,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
  } = useDayPlannerCtx();
  const { loadWikiNote, saveWikiNote } = useSyncCtx();
  const {
    aiConfig,
    gtdFrames,
    showFramesModal, setShowFramesModal,
    framesModalTab, setFramesModalTab,
    editingFrame, setEditingFrame,
    goalsProjectsEnabled, projects, projectFilter, setProjectFilter,
    aiSubtasksLoadingForTask, generateAISubtasks,
  } = useFeaturesCtx();

  const [showInboxFilter, setShowInboxFilter] = useState(false);
  const inboxFilterBtnRef = useRef(null);
  const inboxFilterActive =
    hideCompletedInbox ||
    hideStandaloneTasksInbox ||
    (goalsProjectsEnabled && !hideProjectTasksInbox) ||
    inboxTagFilter.length > 0 ||
    inboxProjectFilter.length > 0;
  const isDesktop = variant === 'desktop';

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
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <button
          onClick={openNewInboxTask}
          className="px-2.5 flex items-center justify-center gap-1 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          title="New Inbox Task"
        >
          <Plus size={14} strokeWidth={3} />
          <span className="text-xs font-medium">New Task</span>
        </button>
        {aiConfig?.enabled && aiConfig.features?.smartScheduling && gtdFrames.filter(f => f.enabled).length > 0 && unscheduledTasks.filter(t => !t.completed && !t.isExample).length > 0 && (
          <button
            onClick={() => { setShowFramesModal(true); setFramesModalTab('schedule'); setEditingFrame(null); }}
            className="px-2.5 flex items-center justify-center gap-1 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            title="AI Smart Schedule"
          >
            <BrainCircuit size={14} />
            <span className="text-xs font-medium">Schedule</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        {unscheduledTasks.filter(t => !t.deadline).length > 0 && (
          <>
            <button
              ref={node => { if (node) inboxFilterBtnRef.current = node; }}
              onClick={() => { setShowInboxFilter(v => !v); playUISound('click'); }}
              className={`relative ${hoverBg} rounded px-1.5 py-1.5 transition-colors`}
              title="Filter inbox"
            >
              <Filter size={14} className={inboxFilterActive ? (darkMode ? 'text-blue-400' : 'text-blue-500') : (darkMode ? 'text-gray-400' : 'text-stone-500')} />
              {inboxFilterActive && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-500" />}
            </button>
            <button
              onClick={() => { setInboxPriorityFilter(prev => (prev + 1) % 4); playUISound('click'); }}
              className={`flex gap-0.5 ${hoverBg} rounded pl-1 pr-2 py-1.5 transition-colors`}
              title={inboxPriorityFilter === 0 ? 'Showing all priorities (click to filter)' : `Showing priority ${inboxPriorityFilter}+ (click to change)`}
            >
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className={`w-2.5 h-1 rounded-full ${
                    inboxPriorityFilter === 0
                      ? `${darkMode ? 'bg-gray-500' : 'bg-stone-400'}`
                      : i < inboxPriorityFilter
                        ? 'bg-blue-500'
                        : `${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`
                  }`}
                />
              ))}
            </button>
          </>
        )}
      </div>
    </div>

    <div className="space-y-2">
      {filteredUnscheduledTasks.length === 0 ? (
        <p className={`text-sm ${textSecondary} text-center py-4`}>
          {unscheduledTasks.length === 0
            ? "Drag tasks here to unschedule them"
            : unscheduledTasks.length === 0
              ? "All tasks have overdue deadlines"
              : "No tasks match current filter"}
        </p>
      ) : (
        filteredUnscheduledTasks.map(task => (
        <div
          key={task.id}
          data-task-id={task.id}
          className="notes-panel-container"
        >
          <div
            data-ctx-menu
            onContextMenu={(e) => {
              e.preventDefault();
              setTaskContextMenu({
                x: e.clientX, y: e.clientY,
                taskId: task.id,
                isRecurring: false,
                isImported: false,
                isAllDay: false,
                dateStr: dateToString(new Date()),
              });
            }}
            draggable
            onDragStart={(e) => handleDragStart(task, 'inbox', e)}
            onDragEnd={handleDragEnd}
            className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
          >
            {task.isExample && (
              <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                Example
              </span>
            )}
            <div className="flex items-start justify-between text-white">
              <div className="flex items-start gap-2 flex-1 min-w-0">
                <button
                  onClick={() => toggleComplete(task.id, true)}
                  className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                >
                  {task.completed && <Check size={10} strokeWidth={3} />}
                </button>
                <div className="flex-1 min-w-0">
                  {editingTaskId === task.id ? (
                    <div className="relative tag-autocomplete-container">
                      <input
                        type="text"
                        value={editingTaskText}
                        onChange={(e) => handleEditInputChange(e, true)}
                        onKeyDown={(e) => handleEditKeyDown(e, true)}
                        onBlur={() => {
                          setTimeout(() => {
                            if (!showSuggestions) {
                              saveTaskTitle(true);
                            }
                          }, 100);
                        }}
                        autoFocus
                        className="w-full bg-white/20 text-white font-medium text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                        onClick={(e) => e.stopPropagation()}
                      />
                      {showSuggestions && suggestionContext === 'editing' && (
                        <SuggestionAutocomplete
                          suggestions={suggestions}
                          selectedIndex={selectedSuggestionIndex}
                          onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, true)}
                          cardBg={cardBg}
                          borderClass={borderClass}
                          textPrimary={textPrimary}
                          hoverBg={hoverBg}
                        />
                      )}
                    </div>
                  ) : (
                    <div
                      className={`font-medium text-sm ${task.completed ? 'line-through' : ''} cursor-text`}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditingTask(task, true);
                      }}
                      title="Double-click to edit"
                    >
                      {renderTitle(task.title)}
                    </div>
                  )}
                  <div className="text-xs opacity-90 mt-1 flex items-center gap-2 flex-wrap">
                    <span>{task.duration} min</span>
                    {task.deadline && (
                      <span className="flex items-center gap-1">
                        <AlertCircle size={10} />
                        {formatDeadlineDate(task.deadline)}
                      </span>
                    )}
                    {goalsProjectsEnabled && task.projectId && (() => {
                      const proj = projects.find(p => p.id === task.projectId);
                      if (!proj) return null;
                      return (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const active = projectFilter === task.projectId;
                            setProjectFilter(active ? null : task.projectId);
                            setInboxProjectFilter(active ? [] : [task.projectId]);
                          }}
                          className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors flex-shrink-0 ${projectFilter === task.projectId ? 'ring-1 ring-white/60' : ''}`}
                          title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
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
                      if (isLinkOnlyTask(task)) {
                        longPressTriggeredRef.current = false;
                        longPressTimerRef.current = setTimeout(() => {
                          longPressTriggeredRef.current = true;
                          setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                        }, 500);
                      }
                    }}
                    onMouseUp={() => {
                      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                    }}
                    onMouseLeave={() => {
                      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isLinkOnlyTask(task)) {
                        if (!longPressTriggeredRef.current) {
                          window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                        }
                        longPressTriggeredRef.current = false;
                      } else {
                        setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                      }
                    }}
                    className={`hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) || (task.importSource === 'obsidian' && extractWikilinks(task.title).length > 0) ? '' : 'opacity-40'}`}
                    title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                  >
                    {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                  </button>
                  <div className="deadline-picker-container relative">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                      }}
                      className={`hover:bg-white/20 rounded p-1 transition-colors ${task.deadline ? 'bg-white/20' : 'opacity-40'}`}
                      title={task.deadline ? `Deadline: ${formatDeadlineDate(task.deadline)}` : 'Set deadline'}
                    >
                      <Calendar size={14} />
                    </button>
                    {showDeadlinePicker === task.id && (
                      <DeadlinePickerPopover
                        taskId={task.id}
                        currentDeadline={task.deadline}
                        onClose={() => setShowDeadlinePicker(null)}
                      />
                    )}
                  </div>
                  <button
                    onClick={() => openMobileEditTask(task, true)}
                    className="hover:bg-white/20 rounded p-1 transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  {task.completed ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); archiveInboxTask(task.id); }}
                      className="flex items-center gap-0.5 hover:bg-white/20 rounded px-1.5 py-1 transition-colors opacity-60 hover:opacity-100"
                      title="Archive task"
                    >
                      <Archive size={11} className="text-white" />
                    </button>
                  ) : <span />}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      cyclePriority(task.id);
                    }}
                    className="flex gap-0.5 hover:bg-white/20 rounded px-2 py-1.5 transition-colors"
                    title={['No priority', 'Low priority', 'Medium priority', 'High priority'][pendingPriorities[task.id] ?? task.priority ?? 0]}
                  >
                    {[0, 1, 2].map(i => (
                      <span
                        key={i}
                        className={`w-2 h-0.5 rounded-full bg-white ${i < (pendingPriorities[task.id] ?? task.priority ?? 0) ? 'opacity-100' : 'opacity-30'}`}
                      />
                    ))}
                  </button>
                </div>
              </div>
            </div>
            {expandedNotesTaskId === task.id && (
              <NotesSubtasksPanel
                task={task}
                isInbox={true}
                darkMode={darkMode}
                updateTaskNotes={updateTaskNotes}
                addSubtask={addSubtask}
                toggleSubtask={toggleSubtask}
                deleteSubtask={deleteSubtask}
                updateSubtaskTitle={updateSubtaskTitle}
                aiConfig={aiConfig}
                aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                onGenerateSubtasks={generateAISubtasks}
                wikilinks={task.importSource === 'obsidian' ? extractWikilinks(task.title) : undefined}
                onLoadWikiNote={task.importSource === 'obsidian' ? loadWikiNote : undefined}
                onSaveWikiNote={task.importSource === 'obsidian' ? saveWikiNote : undefined}
              />
            )}
          </div>
        </div>
      ))
    )}
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
  return (
    <>
<div className="p-4" data-inbox-container>
  {/* Inbox header with priority filter */}
  <div className="flex items-center justify-between mb-4">
    <div className="flex items-center gap-2">
      <button
        onClick={openNewInboxTask}
        className="p-2 flex items-center justify-center bg-blue-600 text-white rounded-lg active:bg-blue-700 transition-colors"
        title="New Inbox Task"
      >
        <Plus size={16} strokeWidth={3} />
      </button>
      {aiConfig?.enabled && aiConfig.features?.smartScheduling && gtdFrames.filter(f => f.enabled).length > 0 && unscheduledTasks.filter(t => !t.completed && !t.isExample).length > 0 && (
        <button
          onClick={() => { setShowFramesModal(true); setFramesModalTab('schedule'); setEditingFrame(null); }}
          className="p-2 flex items-center justify-center bg-blue-600 text-white rounded-lg active:bg-blue-700 transition-colors"
          title="AI Smart Schedule"
        >
          <BrainCircuit size={16} />
        </button>
      )}
    </div>
    <div className="flex items-center gap-2">
      <button
        ref={node => { inboxFilterBtnRef.current = node; }}
        onClick={() => { inboxFilterBtnRef.current = document.activeElement; setShowInboxFilter(v => !v); playUISound('click'); }}
        className={`relative ${hoverBg} rounded px-2 py-1.5 transition-colors`}
        title="Filter inbox"
      >
        <Filter size={14} className={inboxFilterActive ? (darkMode ? 'text-blue-400' : 'text-blue-500') : (darkMode ? 'text-gray-400' : 'text-stone-500')} />
        {inboxFilterActive && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-500" />}
      </button>
      <button
        onClick={() => { setInboxPriorityFilter(prev => (prev + 1) % 4); playUISound('click'); }}
        className={`flex gap-0.5 ${hoverBg} rounded px-2 py-1.5 transition-colors`}
        title={inboxPriorityFilter === 0 ? 'Showing all priorities' : `Showing priority ${inboxPriorityFilter}+`}
      >
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className={`w-2.5 h-1 rounded-full ${
              inboxPriorityFilter === 0
                ? `${darkMode ? 'bg-gray-500' : 'bg-stone-400'}`
                : i < inboxPriorityFilter
                  ? 'bg-blue-500'
                  : `${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`
            }`}
          />
        ))}
      </button>
    </div>
  </div>
  <div className="space-y-2">
    {filteredUnscheduledTasks.filter(t => !t.isExample).length === 0 ? (
      <div className="flex flex-col items-center justify-center py-12 px-6">
        <div className={`relative w-16 h-16 rounded-2xl ${darkMode ? 'bg-emerald-500/15' : 'bg-emerald-50'} flex items-center justify-center mb-4`}>
          <Inbox size={28} className={`${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
          {unscheduledTasks.filter(t => !t.isExample).length === 0 && (
            <Check size={14} className={`absolute -top-1 -right-1 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
          )}
        </div>
        <p className={`text-base font-semibold ${textPrimary} mb-1`}>
          {unscheduledTasks.filter(t => !t.isExample).length === 0
            ? "Inbox zero"
            : unscheduledTasks.filter(t => !t.isExample).length === 0
              ? "All overdue"
              : "No matches"}
        </p>
        <p className={`text-sm ${textSecondary} text-center mb-5`}>
          {unscheduledTasks.filter(t => !t.isExample).length === 0
            ? "Add tasks here to schedule later"
            : unscheduledTasks.filter(t => !t.isExample).length === 0
              ? "All inbox tasks have overdue deadlines"
              : "No tasks match the current filter"}
        </p>
        {unscheduledTasks.filter(t => !t.isExample).length === 0 && (
          <button
            onClick={openNewInboxTask}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${darkMode ? 'bg-emerald-500 text-white active:bg-emerald-600' : 'bg-emerald-500 text-white active:bg-emerald-600'} transition-colors`}
          >
            <Plus size={16} />
            Add task
          </button>
        )}
      </div>
    ) : (
      filteredUnscheduledTasks.filter(t => !t.isExample).map(task => (
        <div key={task.id} className="notes-panel-container">
          <div className={`relative rounded-lg ${(showDeadlinePicker === task.id || expandedNotesTaskId === task.id) ? '' : 'overflow-hidden'}`}>
            {/* Swipe action strips */}
            <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-green-900/80 text-green-300' : 'bg-green-100 text-green-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
              <Calendar size={14} className="mr-1" />Schedule
            </div>
            <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
              Edit<Settings size={14} className="ml-1" />
            </div>
          <div
            data-ctx-menu
            onContextMenu={(e) => {
              e.preventDefault();
              setTaskContextMenu({
                x: e.clientX, y: e.clientY,
                taskId: task.id,
                isRecurring: false,
                isImported: false,
                isAllDay: false,
                dateStr: dateToString(new Date()),
              });
            }}
            className={`relative select-none ${task.color} rounded-lg px-3 py-4 shadow-sm ${task.completed ? 'opacity-50' : ''} ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
            onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'inbox')}
            onTouchMove={(e) => handleMobileTaskTouchMove(e)}
            onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'inbox')}
          >
            {task.isExample && (
              <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                Example
              </span>
            )}
            <div className="text-white">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <button
                    onClick={() => toggleComplete(task.id, true)}
                    className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                  >
                    {task.completed && <Check size={10} strokeWidth={3} />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div
                      className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditingTask(task, true);
                      }}
                    >
                      {renderTitle(task.title)}
                    </div>
                    <div className="text-xs opacity-90 mt-1 flex items-center gap-2 flex-wrap">
                      <span>{task.duration} min</span>
                      {task.deadline && (
                        <span className="flex items-center gap-1">
                          <AlertCircle size={10} />
                          {formatDeadlineDate(task.deadline)}
                        </span>
                      )}
                      {goalsProjectsEnabled && task.projectId && (() => {
                        const proj = projects.find(p => p.id === task.projectId);
                        if (!proj) return null;
                        return (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const active = projectFilter === task.projectId;
                              setProjectFilter(active ? null : task.projectId);
                              setInboxProjectFilter(active ? [] : [task.projectId]);
                            }}
                            className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors flex-shrink-0 ${projectFilter === task.projectId ? 'ring-1 ring-white/60' : ''}`}
                            title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
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
                            window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                          }
                          longPressTriggeredRef.current = false;
                        } else {
                          setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                        }
                      }}
                      className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) || (task.importSource === 'obsidian' && extractWikilinks(task.title).length > 0) ? '' : 'opacity-40'}`}
                    >
                      {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                    </button>
                    <div className="deadline-picker-container relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                        }}
                        className={`hover:bg-white/20 rounded p-1 transition-colors ${task.deadline ? 'bg-white/20' : 'opacity-40'}`}
                        title={task.deadline ? `Deadline: ${formatDeadlineDate(task.deadline)}` : 'Set deadline'}
                      >
                        <Calendar size={14} />
                      </button>
                      {showDeadlinePicker === task.id && (
                        <DeadlinePickerPopover
                          taskId={task.id}
                          currentDeadline={task.deadline}
                          onClose={() => setShowDeadlinePicker(null)}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between w-full">
                    {task.completed ? (
                      <button
                        onClick={(e) => { e.stopPropagation(); archiveInboxTask(task.id); }}
                        className="flex items-center gap-0.5 hover:bg-white/20 rounded px-1.5 py-1 transition-colors opacity-60 hover:opacity-100"
                        title="Archive task"
                      >
                        <Archive size={11} className="text-white" />
                      </button>
                    ) : <span />}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        cyclePriority(task.id);
                      }}
                      className="flex gap-0.5 hover:bg-white/20 rounded px-1.5 py-1 transition-colors"
                    >
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          className={`w-2 h-0.5 rounded-full bg-white ${i < (pendingPriorities[task.id] ?? task.priority ?? 0) ? 'opacity-100' : 'opacity-30'}`}
                        />
                      ))}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          {expandedNotesTaskId === task.id && (
            <NotesSubtasksPanel
              task={task}
              isInbox={true}
              darkMode={darkMode}
              updateTaskNotes={updateTaskNotes}
              addSubtask={addSubtask}
              toggleSubtask={toggleSubtask}
              deleteSubtask={deleteSubtask}
              updateSubtaskTitle={updateSubtaskTitle}
              aiConfig={aiConfig}
              aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
              onGenerateSubtasks={generateAISubtasks}
              wikilinks={task.importSource === 'obsidian' ? extractWikilinks(task.title) : undefined}
              onLoadWikiNote={task.importSource === 'obsidian' ? loadWikiNote : undefined}
              onSaveWikiNote={task.importSource === 'obsidian' ? saveWikiNote : undefined}
            />
          )}
          </div>
          </div>{/* end swipe wrapper */}
        </div>
      ))
    )}
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
