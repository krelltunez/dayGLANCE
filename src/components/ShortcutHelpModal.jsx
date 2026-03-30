import React from 'react';
import { X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const ShortcutHelpModal = () => {
  const {
    setShowShortcutHelp,
    cardBg, borderClass, textPrimary, textSecondary, darkMode,
  } = useDayPlannerCtx();

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowShortcutHelp(false)}>
      <div
        className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className={`text-lg font-bold ${textPrimary}`}>Keyboard Shortcuts</h2>
          <button onClick={() => setShowShortcutHelp(false)} className={`${textSecondary} hover:${textPrimary}`}>
            <X size={20} />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-0.5">
          <div>
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mb-2`}>Navigation</h3>
            {[
              ['T', 'Go to today'],
              ['\u2190 / \u2192', 'Previous / next day'],
              ['M', 'Toggle month view'],
            ].map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>App</h3>
            {(() => {
              const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
              return [
                [isMac ? '⌘K' : 'Ctrl+K', 'Search tasks'],
                ['/', 'Filter by tag'],
                ['F', 'Focus mode'],
                ['G', 'Goals & Projects'],
                ['H', 'Habits'],
                ['D', 'Toggle dark mode'],
                ['B', 'Backup menu'],
                [',', 'Side panel: Glance'],
                ['.', 'Side panel: Inbox'],
                ['?', 'This help'],
              ];
            })().map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>Edit</h3>
            {(() => {
              const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
              return [
                [isMac ? '\u2318Z' : 'Ctrl+Z', 'Undo'],
                [isMac ? '\u2318\u21E7Z' : 'Ctrl+Y', 'Redo'],
              ];
            })().map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
          </div>
          <div>
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mb-2`}>Create</h3>
            {[
              ['N', 'New scheduled task'],
              ['I', 'New inbox task'],
              ['S', 'Smart schedule'],
              ['E', 'Reschedule tasks'],
              ['V', 'Voice task input'],
              ['R', 'Routines dashboard'],
            ].map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>Task Entry</h3>
            <p className={`text-xs ${textSecondary} mb-2`}>Type in the task title field:</p>
            {[
              ['#', 'Add tag'],
              ['@', 'Set date'],
              ['~', 'Set time'],
              ['%', 'Duration (mins)'],
              ['!', 'Priority (! !! !!!)'],
              ['^', 'Toggle all-day'],
              ['$', 'Deadline (inbox)'],
            ].map(([key, desc]) => (
              <div key={key} className={`flex items-center gap-3 py-1 ${textSecondary}`}>
                <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono min-w-[2rem] text-center ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'}`}>{key}</kbd>
                <span className="text-sm flex-1">{desc}</span>
              </div>
            ))}
            <h3 className={`text-xs font-semibold uppercase ${textSecondary} mt-3 mb-2`}>Task Entry Suggestions</h3>
            <p className={`text-xs ${textSecondary} mb-2`}>Interacting with suggestions:</p>
            {[
              ['Tab / Space', 'Accept'],
              ['\u2191 / \u2193', 'Navigate suggestions'],
              ['Enter', 'Submit task'],
              ['Esc', 'Close / cancel'],
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
