import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const ShortcutHelpModal = () => {
  const { t } = useTranslation();
  const {
    setShowShortcutHelp,
    cardBg, borderClass, textPrimary, textSecondary, darkMode,
    canShowViewCycler,
  } = useDayPlannerCtx();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowShortcutHelp(false)}>
      <div
        className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4 overflow-y-auto max-h-[85vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-lg font-bold ${textPrimary}`}>{t('shortcuts.title')}</h2>
          <button onClick={() => setShowShortcutHelp(false)} className={`${textSecondary} hover:${textPrimary}`}>
            <X size={20} />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0.5">
          <div>
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mb-2`}>{t('shortcuts.sectionNavigation')}</h3>
            {[
              ['T', t('shortcuts.goToToday')],
              ['\u2190 / \u2192', t('shortcuts.prevNextDay')],
              ['M', t('shortcuts.toggleMonthView')],
              ...(canShowViewCycler ? [
                ['1', t('shortcuts.viewDay')],
                ['2', t('shortcuts.view3Day')],
                ['3', t('shortcuts.viewWeek')],
              ] : []),
            ].map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>{t('shortcuts.sectionApp')}</h3>
            {(() => {
              const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
              return [
                [isMac ? '⌘K' : 'Ctrl+K', t('shortcuts.searchTasks')],
                ['/', t('shortcuts.filterByTag')],
                ['F', t('shortcuts.focusMode')],
                ['G', t('shortcuts.goalsProjects')],
                ['H', t('shortcuts.habitsShortcut')],
                ['L', t('shortcuts.intentLog')],
                ['D', t('shortcuts.toggleDarkMode')],
                ['B', t('shortcuts.backupMenu')],
                [',', t('shortcuts.sidePanelGlance')],
                ['.', t('shortcuts.sidePanelInbox')],
                ['?', t('shortcuts.thisHelp')],
              ];
            })().map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>{t('shortcuts.sectionEdit')}</h3>
            {(() => {
              const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
              return [
                [isMac ? '\u2318Z' : 'Ctrl+Z', t('shortcuts.undoAction')],
                [isMac ? '\u2318\u21E7Z' : 'Ctrl+Y', t('shortcuts.redoAction')],
              ];
            })().map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
          </div>
          <div>
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mb-2`}>{t('shortcuts.sectionCreate')}</h3>
            {[
              ['N', t('shortcuts.newScheduledTask')],
              ['I', t('shortcuts.newInboxTask')],
              ['S', t('shortcuts.smartSchedule')],
              ['E', t('shortcuts.rescheduleTasks')],
              ['V', t('shortcuts.voiceTaskInput')],
              ['R', t('shortcuts.routinesDashboard')],
            ].map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>{t('shortcuts.sectionTaskEntry')}</h3>
            <p className={`text-xs ${textSecondary} mb-2`}>Type in the task title field:</p>
            {[
              ['#', t('shortcuts.addTag')],
              ['@', t('shortcuts.setDate')],
              ['~', t('shortcuts.setTime')],
              ['%', t('shortcuts.durationMins')],
              ['!', t('shortcuts.priorityLevels')],
              ['^', t('shortcuts.toggleAllDay')],
              ['$', t('shortcuts.deadlineInbox')],
            ].map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>{t('shortcuts.sectionTaskEntrySuggestions')}</h3>
            <p className={`text-xs ${textSecondary} mb-2`}>Interacting with suggestions:</p>
            {[
              ['Tab / Space', t('shortcuts.suggestionAccept')],
              ['\u2191 / \u2193', t('shortcuts.suggestionNavigate')],
              ['Enter', t('shortcuts.suggestionSubmit')],
              ['Esc', t('shortcuts.suggestionClose')],
            ].map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
          </div>
        </div>
        <div className={`mt-4 pt-3 border-t ${borderClass} text-center`}>
          <span className={`text-xs ${textSecondary}`}>Press <kbd className={`px-1 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>?</kbd> or <kbd className={`px-1 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
};

export default ShortcutHelpModal;
