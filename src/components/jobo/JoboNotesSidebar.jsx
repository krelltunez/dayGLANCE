import React from 'react';
import { X } from 'lucide-react';
import NotesSubtasksPanel from '../NotesSubtasksPanel.jsx';
import { useDayPlannerCtx } from '../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../context/FeaturesContext.jsx';
import { useSyncCtx } from '../../context/SyncContext.jsx';
import { renderFormattedText, renderTitleWithoutTags } from '../../utils/textFormatting.jsx';
import { extractWikilinks } from '../../utils/taskUtils.js';

// JOBO's notes sidebar on wide screens: the day's Daily Note above, the
// selected task's notes and subtasks below.
//
// The Daily Note is shown as the Daily Notes modal shows it when not
// editing, and a click opens that modal. The modal owns editing because it
// owns the vault rules: it reads the note fresh from Obsidian and writes back
// only a change to what it loaded, so an always-open editor here could not
// save without going around them. The task's notes are the same panel a
// timeline card opens, which saves through the app's own actions.
export const SIDEBAR_WIDTH = 'w-[calc((100%-4rem)/3)] min-w-80';

export default function JoboNotesSidebar({ date, task, onClearTask, t, headerAction = null, headerInset = 0 }) {
  const {
    darkMode, borderClass, textPrimary, textSecondary, unscheduledTasks,
    dailyNotes, setDailyNotesModalDate,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
  } = useDayPlannerCtx();
  const { aiConfig, aiSubtasksLoadingForTask, generateAISubtasks } = useFeaturesCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx() || {};
  const noteText = dailyNotes?.[date]?.text || '';
  const wikilinks = task ? extractWikilinks(task.title) : [];
  const hasWiki = wikilinks.length > 0;
  const heading = `text-xs font-semibold uppercase tracking-wide ${textSecondary}`;

  return (
    // A third of the view, the same width as Plan and as Do. The view is the
    // 4rem hour gutter plus three equal columns, and JoboView's grid gives
    // Plan (with the gutter) 50% + 2rem of what is left: so this is exactly
    // one column. Never narrower than the old fixed 20rem.
    <aside data-jobo-notes-sidebar className={`${SIDEBAR_WIDTH} flex-shrink-0 border-l ${borderClass} flex flex-col min-h-0`} aria-label={t('task.notes')}>
      {/* The same height as the Plan and Do header row (py-1 around the h-7
          button, then the border), and inset by the Do side's scrollbar
          width (headerInset), so the sidebar button lands exactly where it
          sat in the Do header before the sidebar opened. */}
      <div data-jobo-sidebar-header className={`px-3 py-1 border-b ${borderClass} flex items-center justify-end flex-shrink-0`}
        style={headerInset ? { paddingRight: `calc(0.75rem + ${headerInset}px)` } : undefined}>
        {headerAction}
      </div>
      <section className={`flex flex-col min-h-0 max-h-[50%] border-b ${borderClass} p-3`}>
        {/* The note itself opens the Daily Notes modal, as does the date
            header, so it needs no button of its own here. */}
        <h3 className={`${heading} mb-2`}>{t('common.dailyNote')}</h3>
        <div
          data-jobo-daily-note
          role="button"
          tabIndex={0}
          onClick={() => setDailyNotesModalDate?.(date)}
          onKeyDown={(event) => { if (event.key === 'Enter') setDailyNotesModalDate?.(date); }}
          className={`text-sm whitespace-pre-wrap cursor-text overflow-y-auto p-3 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-50 hover:bg-stone-100'} ${noteText ? textPrimary : textSecondary}`}
        >
          {noteText ? renderFormattedText(noteText) : t('jobo.view.dailyNoteEmpty')}
        </div>
      </section>
      <section className="flex-1 min-h-0 overflow-y-auto p-3">
        <div className="flex items-center justify-between mb-2 gap-2">
          <h3 className={heading}>{t('task.notes')}</h3>
          {task && (
            <button type="button" onClick={onClearTask}
              className={`p-1 rounded-lg ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'} ${textSecondary}`}
              aria-label={t('common.close')} title={t('common.close')}>
              <X size={14} />
            </button>
          )}
        </div>
        {task ? (
          <div data-jobo-sidebar-task={task.id}>
            <div className={`flex items-center gap-2 mb-2 text-sm font-semibold ${textPrimary} min-w-0`}>
              <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${task.color || 'bg-blue-500'}`} aria-hidden="true" />
              <span className="truncate">{renderTitleWithoutTags(task.title)}</span>
            </div>
            <div className={`${task.color || 'bg-blue-500'} rounded-lg`}>
              <NotesSubtasksPanel
                key={task.id}
                task={task}
                isInbox={(unscheduledTasks || []).some((candidate) => candidate.id === task.id)}
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
                wikilinks={hasWiki ? wikilinks : undefined}
                onLoadWikiNote={hasWiki ? loadWikiNote : undefined}
                onSaveWikiNote={hasWiki ? saveWikiNote : undefined}
                onOpenInObsidian={hasWiki ? openInObsidian : undefined}
              />
            </div>
          </div>
        ) : (
          <p className={`text-sm ${textSecondary}`}>{t('jobo.view.selectForNotes')}</p>
        )}
      </section>
    </aside>
  );
}
