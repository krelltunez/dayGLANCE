import React from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { highlightMatch, renderTitle } from '../utils/textFormatting.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const SpotlightModal = () => {
  const { t } = useTranslation();
  const {
    setShowSpotlight,
    isMobile,
    cardBg, borderClass, textPrimary, textSecondary, darkMode,
    spotlightQuery, setSpotlightQuery,
    spotlightSelectedIndex, setSpotlightSelectedIndex,
    spotlightResults,
    spotlightInputRef,
    handleSpotlightSelect,
  } = useDayPlannerCtx();

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex justify-center" style={{ paddingTop: isMobile ? '2rem' : '15vh' }} onClick={() => setShowSpotlight(false)}>
      <div
        className={`${cardBg} rounded-lg shadow-xl border ${borderClass} max-w-xl w-full mx-4 h-fit`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${borderClass}`}>
          <Search size={18} className={textSecondary} />
          <input
            ref={spotlightInputRef}
            type="text"
            value={spotlightQuery}
            onChange={(e) => { setSpotlightQuery(e.target.value); setSpotlightSelectedIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSpotlightSelectedIndex(prev => Math.min(prev + 1, spotlightResults.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSpotlightSelectedIndex(prev => Math.max(prev - 1, 0));
              } else if (e.key === 'Enter' && spotlightResults.length > 0) {
                e.preventDefault();
                handleSpotlightSelect(spotlightResults[spotlightSelectedIndex]);
              }
            }}
            placeholder={t('spotlight.placeholder')}
            className={`flex-1 bg-transparent outline-none ${textPrimary} text-sm placeholder:${textSecondary}`}
            autoFocus
          />
          {spotlightQuery && (
            <button onClick={() => { setSpotlightQuery(''); setSpotlightSelectedIndex(0); spotlightInputRef.current?.focus(); }} className={`${textSecondary} hover:${textPrimary}`}>
              <X size={16} />
            </button>
          )}
          {!isMobile && <kbd className={`px-1.5 py-0.5 rounded text-xs font-mono ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-stone-200 text-stone-500'}`}>Esc</kbd>}
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {!spotlightQuery.trim() ? (
            <div className={`px-4 py-8 text-center text-sm ${textSecondary}`}>{t('spotlight.typeToSearch')}</div>
          ) : spotlightResults.length === 0 ? (
            <div className={`px-4 py-8 text-center text-sm ${textSecondary}`}>{t('spotlight.noResults')}</div>
          ) : (() => {
            const sourceBadgeColors = darkMode ? {
              scheduled: 'bg-blue-900/40 text-blue-300',
              inbox: 'bg-green-900/40 text-green-300',
              project: 'bg-green-900/40 text-green-300',
              recurring: 'bg-purple-900/40 text-purple-300',
              deleted: 'bg-red-900/40 text-red-300',
              archived: 'bg-gray-700/60 text-gray-400',
            } : {
              scheduled: 'bg-blue-100 text-blue-700',
              inbox: 'bg-green-100 text-green-700',
              project: 'bg-green-100 text-green-700',
              recurring: 'bg-purple-100 text-purple-700',
              deleted: 'bg-red-100 text-red-700',
              archived: 'bg-stone-200 text-stone-500',
            };
            const groupLabels = { today: t('spotlight.groupToday'), thisweek: t('spotlight.groupThisWeek'), future: t('spotlight.groupFuture'), nodate: t('spotlight.groupNoDate'), past: t('spotlight.groupPast'), deleted: t('spotlight.groupDeleted'), archived: t('spotlight.groupArchived') };
            let lastGroup = null;
            return spotlightResults.map((result, idx) => {
              const isSelected = idx === spotlightSelectedIndex;
              const showHeader = result.group !== lastGroup;
              lastGroup = result.group;
              return (
                <div key={`${result.source}-${result.task.id}-${idx}`}>
                  {showHeader && (
                    <div className={`px-4 py-1 text-[10px] font-semibold uppercase tracking-wider ${textSecondary} ${darkMode ? 'bg-gray-800/60' : 'bg-stone-100/80'} ${idx > 0 ? `border-t ${borderClass}` : ''}`}>
                      {groupLabels[result.group] || result.group}
                    </div>
                  )}
                  <div
                    className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${isSelected ? (darkMode ? 'bg-gray-700' : 'bg-blue-50') : (darkMode ? 'hover:bg-gray-700/50' : 'hover:bg-stone-50')}`}
                    onClick={() => handleSpotlightSelect(result)}
                    onMouseEnter={() => setSpotlightSelectedIndex(idx)}
                    ref={el => {
                      if (isSelected && el) el.scrollIntoView({ block: 'nearest' });
                    }}
                  >
                    {/* Color dot */}
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${result.task.color || 'bg-blue-500'}`} />
                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium truncate ${textPrimary}`}>
                        {result.match.field === 'title'
                          ? highlightMatch(result.task.title.replace(/\[\[[^\]]+\]\]/g, ''), spotlightQuery)
                          : renderTitle(result.task.title)}
                      </div>
                      {result.match.field !== 'title' && (
                        <div className={`text-xs ${textSecondary} truncate mt-0.5`}>
                          <span className="opacity-60">{result.match.field === 'notes' ? 'Notes: ' : result.match.field === 'subtask' ? 'Subtask: ' : result.match.field === 'tag' ? 'Tag: ' : ''}</span>
                          {highlightMatch(result.match.text, spotlightQuery)}
                        </div>
                      )}
                    </div>
                    {/* Date */}
                    {result.date && (
                      <span className={`text-xs ${textSecondary} flex-shrink-0`}>{result.date}</span>
                    )}
                    {/* Source badge */}
                    {(() => {
                      const isProjectTask = result.source === 'inbox' && result.task.projectId;
                      const badgeKey = isProjectTask ? 'project' : result.source;
                      const label = isProjectTask ? 'Project' : result.sourceLabel;
                      return (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${sourceBadgeColors[badgeKey]}`}>
                          {label}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              );
            });
          })()}
        </div>

        {/* Footer */}
        {spotlightResults.length > 0 && (
          <div className={`flex items-center justify-between px-4 py-2 border-t ${borderClass} text-xs ${textSecondary}`}>
            {!isMobile ? (
              <div className="flex items-center gap-3">
                <span><kbd className={`px-1 py-0.5 rounded font-mono ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`}>↑↓</kbd> navigate</span>
                <span><kbd className={`px-1 py-0.5 rounded font-mono ${darkMode ? 'bg-gray-700' : 'bg-stone-200'}`}>↵</kbd> open</span>
              </div>
            ) : <div />}
            <span>{spotlightResults.length} result{spotlightResults.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpotlightModal;
