import React from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { cyclerStates, VIEW_LABEL_KEYS, VIEW_SHORTCUT_KEYS } from '../constants/views.js';

const ShortcutHelpModal = () => {
  const { t } = useTranslation();
  const {
    setShowShortcutHelp,
    cardBg, borderClass, textPrimary, textSecondary, darkMode,
    canShowViewCycler, schedOnlyCycler, hiddenViews,
  } = useDayPlannerCtx();
  // The view keys this width offers, minus views turned off on this device:
  // the same list the cycler and the number keys work from.
  const views = cyclerStates(canShowViewCycler, false, hiddenViews?.desktop);
  // Named the way the cycler button names them, from one shared map, so the two
  // cannot drift — and localised, since a German build's button reads TAGE.
  const viewRows = canShowViewCycler || schedOnlyCycler
    ? [
      ...views.map((v) => [VIEW_SHORTCUT_KEYS[v], t('shortcuts.viewNamed', { view: t(VIEW_LABEL_KEYS[v]) })]),
      ['C', t('shortcuts.cycleViews')],
    ]
    : [];
  // MONTH is the only view with navigation of its own, so its three rows are
  // listed only where MONTH is actually reachable.
  const monthRows = views.includes('month')
    ? [
      ['M', t('shortcuts.toggleMonthNav')],
      ['Space', t('shortcuts.monthStepDay')],
      ['\u2191 / \u2193', t('shortcuts.monthStepWeek')],
      ['Enter', t('shortcuts.monthOpenDay')],
    ]
    : [];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowShortcutHelp(false)}>
      <div
        className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4 overflow-y-auto max-h-[85vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-lg font-bold ${textPrimary}`}>{t('shortcuts.title')}</h2>
          <button onClick={() => setShowShortcutHelp(false)} className={`${textSecondary} hover:${textPrimary}`} aria-label={t('common.close')}>
            <X size={20} />
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-0.5">
          <div>
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mb-2`}>{t('shortcuts.sectionNavigation')}</h3>
            {[
              ['T', t('shortcuts.goToToday')],
              ['\u2190 / \u2192', t('shortcuts.prevNext')],
              ...monthRows,
              ...viewRows,
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
                ['#', t('shortcuts.manageTags')],
                ['F', t('shortcuts.focusMode')],
                ['G', t('shortcuts.goalsProjects')],
                ['H', t('shortcuts.habitsShortcut')],
                ['U', t('bucket.title')],
                ['O', t('shortcuts.dayDial', { defaultValue: 'Day Dial' })],
                ['L', t('shortcuts.intentLog')],
                ['D', t('shortcuts.toggleDarkMode')],
                ['S', t('common.settings')],
                ['B', t('shortcuts.backupMenu')],
                [',', t('shortcuts.sidePanelGlance')],
                ['.', t('shortcuts.sidePanelInbox')],
                [isMac ? '⌘B' : 'Ctrl+B', t('shortcuts.sidePanelToggle')],
                ['?', t('shortcuts.thisHelp')],
              ];
            })().map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
          </div>
          <div>
            {/* EDIT opens the second column so the two columns run to similar lengths. */}
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mb-2`}>{t('shortcuts.sectionEdit')}</h3>
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
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>{t('shortcuts.sectionCreate')}</h3>
            {[
              ['N', t('shortcuts.newScheduledTask')],
              ['I', t('shortcuts.newInboxTask')],
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
            <p className={`text-xs ${textSecondary} mb-2`}>{t('shortcuts.taskTitleFieldHint', { defaultValue: 'Type in the task title field:' })}</p>
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
            <p className={`text-xs ${textSecondary} mb-2`}>{t('shortcuts.suggestionsHint', { defaultValue: 'Interacting with suggestions:' })}</p>
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
          <span className={`text-xs ${textSecondary}`}>{t('shortcuts.pressToClose')}</span>
        </div>
      </div>
    </div>
  );
};

export default ShortcutHelpModal;
