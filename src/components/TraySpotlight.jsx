import { useEffect, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

export default function TraySpotlight({ darkMode, onClose }) {
  const {
    showSpotlight, setShowSpotlight,
    spotlightQuery, setSpotlightQuery,
    spotlightResults,
    spotlightSelectedIndex, setSpotlightSelectedIndex,
    textPrimary, textSecondary, borderClass,
  } = useDayPlannerCtx();

  const inputRef = useRef(null);

  // Enable spotlight result computation (normally gated on showSpotlight).
  useEffect(() => {
    setShowSpotlight(true);
    setSpotlightQuery('');
    setSpotlightSelectedIndex(0);
    inputRef.current?.focus();
    return () => { setShowSpotlight(false); setSpotlightQuery(''); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = (result) => {
    window.electronAPI?.openMainAt({
      action: 'goto-task',
      taskId: result.task.id,
      date: result.date ?? result.task.date,
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSpotlightSelectedIndex(i => Math.min(i + 1, spotlightResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSpotlightSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && spotlightResults[spotlightSelectedIndex]) {
      handleSelect(spotlightResults[spotlightSelectedIndex]);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden px-3 pb-3">
      {/* Search input */}
      <div className={`flex items-center gap-2 py-2.5 border-b ${borderClass}`}>
        <Search size={15} className={`flex-shrink-0 ${textSecondary}`} />
        <input
          ref={inputRef}
          className={`flex-1 text-sm bg-transparent outline-none ${textPrimary}`}
          placeholder="Search tasks…"
          value={spotlightQuery}
          onChange={e => { setSpotlightQuery(e.target.value); setSpotlightSelectedIndex(0); }}
          onKeyDown={handleKeyDown}
        />
        <button onClick={onClose} className={`flex-shrink-0 ${textSecondary} hover:opacity-70 transition-opacity`}>
          <X size={15} />
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto mt-2 space-y-0.5">
        {!spotlightQuery.trim() && (
          <p className={`text-sm ${textSecondary} text-center py-10`}>Type to search…</p>
        )}
        {spotlightQuery.trim() && spotlightResults.length === 0 && (
          <p className={`text-sm ${textSecondary} text-center py-10`}>No results</p>
        )}
        {spotlightResults.map((result, i) => {
          const { task, sourceLabel, match, date } = result;
          const isSelected = i === spotlightSelectedIndex;
          return (
            <button
              key={`${task.id}-${i}`}
              className={`w-full text-left px-2 py-2 rounded-lg flex items-center gap-2 transition-colors ${
                isSelected
                  ? darkMode ? 'bg-white/15' : 'bg-black/10'
                  : darkMode ? 'hover:bg-white/8' : 'hover:bg-black/5'
              }`}
              onMouseEnter={() => setSpotlightSelectedIndex(i)}
              onClick={() => handleSelect(result)}
            >
              <div className={`w-2 h-2 rounded-full flex-shrink-0 bg-${task.color || 'gray'}-400`} />
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium truncate ${textPrimary}`}>{task.title}</div>
                <div className={`text-xs ${textSecondary} flex items-center gap-1`}>
                  {date && <span>{date}</span>}
                  {sourceLabel && <span className="opacity-60">· {sourceLabel}</span>}
                  {match.field !== 'title' && <span className="opacity-60">· in {match.field}</span>}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
