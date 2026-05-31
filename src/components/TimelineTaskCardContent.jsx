import React from 'react';
import {
  BookOpen, Check, CheckSquare, Clock, ExternalLink,
  FileText, Inbox, MapPin, MoreHorizontal,
  Pencil, RefreshCw, SkipForward, Trash2,
} from 'lucide-react';
import { isNativeAndroid, isNativeApp, nativeUpdateEvent, SOURCE_APPS } from '../native.js';
import { renderTitleWithoutTags, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { extractTags, extractWikilinks, stripWikilinks } from '../utils/taskUtils.js';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';
import LastGlanceBadge from './LastGlanceBadge.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const TimelineTaskCardContent = ({ task, height, isNarrowWidth, flipNotesPanel }) => {
  const {
    isTablet,
    darkMode,
    cardBg, borderClass, textPrimary, hoverBg,
    editingTaskId, editingTaskText,
    showSuggestions, suggestions, selectedSuggestionIndex, suggestionContext,
    editingInputRef,
    expandedNotesTaskId, setExpandedNotesTaskId,
    expandedTaskMenu, setExpandedTaskMenu,
    longPressTimerRef, longPressTriggeredRef,
    setEditingRecurrenceTaskId,
    handleEditInputChange, handleEditKeyDown,
    openMobileEditTask,
    toggleComplete,
    startEditingTask, saveTaskTitle,
    applySuggestionForEdit,
    moveToInbox, moveToRecycleBin, postponeTask,
    formatTime, timeToMinutes, minutesToTime,
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
            window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
          }
          longPressTriggeredRef.current = false;
        } else {
          setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
        }
      }}
      className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) || extractWikilinks(task.title).length > 0 ? '' : 'opacity-40'}`}
      title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
    >
      {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
      {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
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
            title="Postpone to tomorrow"
          >
            <SkipForward size={14} />
            {inMenu && <span className="text-xs">Postpone</span>}
          </button>
          )}
          {!isTablet && (
          <button
            onClick={() => openMobileEditTask(task, false)}
            className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
            title="Edit"
          >
            <Pencil size={14} />
            {inMenu && <span className="text-xs">Edit</span>}
          </button>
          )}
          {!isTablet && (
          <button
            onClick={() => moveToRecycleBin(task.id)}
            className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
            title="Delete"
          >
            <Trash2 size={14} />
            {inMenu && <span className="text-xs">Delete</span>}
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
          title="Postpone to tomorrow"
        >
          <SkipForward size={14} />
          {inMenu && <span className="text-xs">Postpone</span>}
        </button>
        {!isTablet && (
        <button
          onClick={() => openMobileEditTask(task, false)}
          className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
          title="Edit"
        >
          <Pencil size={14} />
          {inMenu && <span className="text-xs">Edit</span>}
        </button>
        )}
        {!isTablet && (
        <button
          onClick={() => moveToInbox(task.id)}
          className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
          title="Move to Inbox"
        >
          <Inbox size={14} />
          {inMenu && <span className="text-xs">To Inbox</span>}
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
          <div className="flex flex-col h-full justify-between gap-0.5">
            <div className="flex items-center justify-between gap-2">
              <div
                className="font-semibold text-sm leading-tight truncate flex-1 min-w-0"
                title={task.title}
              >
                {stripWikilinks(task.title)}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {task.notes && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                    }}
                    className="notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors"
                    title="View description"
                  >
                    <FileText size={12} />
                  </button>
                )}
                <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1">
                  <Clock size={10} />
                  {formatTime(task.startTime)} • {task.duration}m
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
                {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                {task.importSource === 'obsidian' && <BookOpen size={12} className="flex-shrink-0 opacity-75" title="From Obsidian" />}
                {task.source_app === SOURCE_APPS.LASTGLANCE && <LastGlanceBadge size={12} className="flex-shrink-0" title="From lastGLANCE" />}
                <div className="flex-1 min-w-0">
                  {!isTablet && editingTaskId === task.id ? (
                    <div className="relative tag-autocomplete-container">
                      <input
                        type="text"
                        value={editingTaskText}
                        onChange={(e) => handleEditInputChange(e, false)}
                        onKeyDown={(e) => handleEditKeyDown(e, false)}
                        onBlur={() => {
                          setTimeout(() => {
                            if (!showSuggestions) {
                              saveTaskTitle(false);
                            }
                          }, 100);
                        }}
                        autoFocus
                        className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                        onClick={(e) => e.stopPropagation()}
                      />
                      {showSuggestions && suggestionContext === 'editing' && (
                        <SuggestionAutocomplete
                          suggestions={suggestions}
                          selectedIndex={selectedSuggestionIndex}
                          onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                          cardBg={cardBg}
                          borderClass={borderClass}
                          textPrimary={textPrimary}
                          hoverBg={hoverBg}
                        />
                      )}
                    </div>
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
                        title={task.title}
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
                            title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
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
                {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                {task.importSource === 'obsidian' && <BookOpen size={12} className="flex-shrink-0 opacity-75" title="From Obsidian" />}
                {task.source_app === SOURCE_APPS.LASTGLANCE && <LastGlanceBadge size={12} className="flex-shrink-0" title="From lastGLANCE" />}
                <div className="flex-1 min-w-0">
                  {!isTablet && editingTaskId === task.id ? (
                    <div className="relative tag-autocomplete-container">
                      <input
                        type="text"
                        value={editingTaskText}
                        onChange={(e) => handleEditInputChange(e, false)}
                        onKeyDown={(e) => handleEditKeyDown(e, false)}
                        onBlur={() => {
                          setTimeout(() => {
                            if (!showSuggestions) {
                              saveTaskTitle(false);
                            }
                          }, 100);
                        }}
                        autoFocus
                        className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                        onClick={(e) => e.stopPropagation()}
                      />
                      {showSuggestions && suggestionContext === 'editing' && (
                        <SuggestionAutocomplete
                          suggestions={suggestions}
                          selectedIndex={selectedSuggestionIndex}
                          onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                          cardBg={cardBg}
                          borderClass={borderClass}
                          textPrimary={textPrimary}
                          hoverBg={hoverBg}
                        />
                      )}
                    </div>
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
                        title={!isImported && !isTablet ? "Double-click to edit" : undefined}
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
                            title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
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
                {formatTime(task.startTime)} • {task.duration}min
              </div>
            )}
          </>
        )}
      </div>
      {/* Notes panel - floating below task (or above if task ends after 22:00) */}
      {expandedNotesTaskId === task.id && !isImported && (() => {
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
      {/* Editable notes panel for imported calendar events */}
      {expandedNotesTaskId === task.id && isImported && (() => {
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
                <div className="text-xs font-semibold opacity-75 mb-1">Description</div>
                <textarea
                  defaultValue={task.notes || ''}
                  placeholder="Add description…"
                  rows={3}
                  className="w-full text-sm p-2 rounded bg-white/10 text-white placeholder:text-white/40 resize-y focus:outline-none focus:bg-white/20"
                  onBlur={async (e) => {
                    const newNotes = e.target.value;
                    if (newNotes === (task.notes || '')) return;
                    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, notes: newNotes } : t));
                    if (isNativeApp() && task.nativeEventId) {
                      await nativeUpdateEvent({
                        id: task.nativeEventId,
                        title: task.title,
                        start: `${task.date}T${task.startTime}:00`,
                        end: `${task.date}T${minutesToTime(timeToMinutes(task.startTime || '0:00') + (task.duration || 0))}:00`,
                        allDay: false,
                        notes: newNotes,
                        location: task.location || '',
                      });
                    }
                  }}
                />
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
};

export default TimelineTaskCardContent;
