import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, CheckSquare, Circle, ExternalLink, FileText, GripVertical, Repeat } from 'lucide-react';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { taskColorToHex, hexToRgba } from '../../utils/colorUtils.js';
import { renderTitleWithoutTags, URL_REGEX } from '../../utils/textFormatting.jsx';
import { extractTags, extractWikilinks } from '../../utils/taskUtils.js';
import NotesSubtasksPanel from '../NotesSubtasksPanel.jsx';

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
 */
const SchedTaskCard = ({ task, isInbox = false, showProject = false, onEdit = null, dnd = null }) => {
  const {
    darkMode, cardBg, borderClass, textPrimary, textSecondary,
    formatTime, toggleComplete, openMobileEditTask,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
  } = useDayPlannerCtx();
  const { projects, goalsProjectsEnabled, generateAISubtasks, aiSubtasksLoadingForTask, aiConfig } = useFeaturesCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx();

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
  const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');

  const timeLabel = task.isAllDay
    ? 'All day'
    : task.startTime
      ? `${formatTime(task.startTime)}${task.duration ? ` · ${task.duration}m` : ''}`
      : '';

  const subtasks = task.subtasks || [];
  const subtasksDone = subtasks.filter(s => s.completed).length;
  const linkUrl = (task.title?.match(URL_REGEX) || task.notes?.match(URL_REGEX) || [])[0] || null;
  const tags = extractTags(task.title || '');
  const project = showProject && goalsProjectsEnabled && task.projectId
    ? projects.find(p => p.id === task.projectId)
    : null;
  const wikilinks = extractWikilinks(task.title || '');
  const hasNotesContent = !!(task.notes || subtasks.length > 0);

  const handleTap = () => {
    if (isEvent) return;
    if (onEdit) onEdit(task);
    else openMobileEditTask(task, isInbox);
  };

  const openNotesPanel = (e) => {
    e.stopPropagation();
    if (!isEvent) setShowNotes(true);
  };

  return (
    <div
      onClick={handleTap}
      data-drag-idx={dnd ? dnd.idx : undefined}
      draggable={!!dnd?.rowDraggable}
      onDragStart={dnd?.rowDraggable ? e => dnd.onDragStart(e, dnd.idx) : undefined}
      onDragEnd={dnd?.rowDraggable ? dnd.onDragEnd : undefined}
      onDragOver={dnd ? e => dnd.onDragOver(e, dnd.idx) : undefined}
      onDrop={dnd ? e => dnd.onDrop(e, dnd.idx) : undefined}
      className={`flex items-center gap-2 rounded-xl border ${borderClass} ${cardBg} px-3 py-2 ${
        isEvent ? '' : 'cursor-pointer active:opacity-70'
      } ${task.completed ? 'opacity-55' : ''} ${dnd ? 'select-none dnd-no-select' : ''} ${
        dnd?.isSource ? 'opacity-40' : ''
      } ${dnd?.isTarget ? (darkMode ? 'border-t-2 border-t-blue-400' : 'border-t-2 border-t-blue-500') : ''}`}
      style={{ borderLeft: `4px solid ${hex}` }}
    >
      {dnd && (
        <div
          onTouchStart={dnd.onGripTouchStart ? e => dnd.onGripTouchStart(e, dnd.idx) : undefined}
          className={`flex-shrink-0 p-1.5 -m-1 cursor-grab active:cursor-grabbing touch-none select-none ${textSecondary} opacity-30`}
          aria-label="Drag to reorder"
        >
          <GripVertical size={13} />
        </div>
      )}
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
          {renderTitleWithoutTags(task.title || '') || task.title}
        </span>
        {/* Meta row — always rendered on editable tasks so cards stay uniform */}
        {(!isEvent || timeLabel) && (
          <span className={`text-xs ${textSecondary} flex items-center gap-1.5 min-w-0`} style={{ minHeight: '1rem' }}>
            {timeLabel && <span className="flex-shrink-0">{timeLabel}</span>}
            {isRecurring && <Repeat size={10} className="opacity-60 flex-shrink-0" />}
            {!isEvent && (
              <button
                onClick={openNotesPanel}
                className={`flex items-center gap-0.5 flex-shrink-0 p-0.5 -m-0.5 hover:opacity-100 hover:text-blue-500 ${
                  hasNotesContent ? 'opacity-70' : 'opacity-35'
                }`}
                title={hasNotesContent ? 'Notes & subtasks' : 'Add notes or subtasks'}
                aria-label={hasNotesContent ? 'View notes and subtasks' : 'Add notes or subtasks'}
              >
                <FileText size={10} />
                {subtasks.length > 0 && (
                  <span className="flex items-center gap-0.5">
                    <CheckSquare size={10} />
                    {subtasksDone}/{subtasks.length}
                  </span>
                )}
              </button>
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
            {tags.length > 0 && (
              <span className="italic opacity-75 truncate min-w-0" title={tags.map(t => `#${t}`).join(' ')}>
                {tags.map(t => `#${t}`).join(' ')}
              </span>
            )}
            {project && (
              <span
                className="px-1.5 py-px rounded-full text-[10px] font-medium truncate flex-shrink-0 max-w-[10rem] ml-auto"
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
