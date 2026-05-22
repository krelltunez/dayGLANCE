import React, { useState } from 'react';
import { X, ArrowDownLeft, ArrowUpRight, Trash2 } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { getActivityLog, clearActivityLog } from '../intents/intentLog.js';

const EVENT_COLORS = {
  completed:   'bg-green-100 text-green-700',
  uncompleted: 'bg-yellow-100 text-yellow-700',
  deleted:     'bg-red-100 text-red-700',
  rescheduled: 'bg-blue-100 text-blue-700',
  updated:     'bg-stone-100 text-stone-600',
  create:      'bg-green-100 text-green-700',
  complete:    'bg-green-100 text-green-700',
  open:        'bg-blue-100 text-blue-700',
  query:       'bg-stone-100 text-stone-600',
  notify:      'bg-purple-100 text-purple-700',
  error:       'bg-red-100 text-red-700',
};

const EVENT_COLORS_DARK = {
  completed:   'bg-green-900/40 text-green-400',
  uncompleted: 'bg-yellow-900/40 text-yellow-400',
  deleted:     'bg-red-900/40 text-red-400',
  rescheduled: 'bg-blue-900/40 text-blue-400',
  updated:     'bg-gray-700 text-gray-400',
  create:      'bg-green-900/40 text-green-400',
  complete:    'bg-green-900/40 text-green-400',
  open:        'bg-blue-900/40 text-blue-400',
  query:       'bg-gray-700 text-gray-400',
  notify:      'bg-purple-900/40 text-purple-400',
  error:       'bg-red-900/40 text-red-400',
};

function badgeClass(entry, darkMode) {
  const key = entry.status === 'error' ? 'error' : (entry.event ?? entry.action);
  return darkMode ? (EVENT_COLORS_DARK[key] ?? EVENT_COLORS_DARK.updated) : (EVENT_COLORS[key] ?? EVENT_COLORS.updated);
}

function badgeLabel(entry) {
  if (entry.status === 'error') return 'error';
  if (entry.event) return entry.event;
  return entry.action;
}

function shortApp(source_app) {
  if (!source_app) return null;
  // 'app.lastglance' → 'lastglance'
  return source_app.replace(/^app\./, '');
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

const IntentActivityLogModal = () => {
  const { cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg } = useDayPlannerCtx();
  const { showIntentActivityLog, setShowIntentActivityLog } = useSyncCtx();
  const [entries, setEntries] = useState(() => getActivityLog());

  if (!showIntentActivityLog) return null;

  const handleClear = () => {
    clearActivityLog();
    setEntries([]);
  };

  const dividerBg = darkMode ? 'bg-gray-700' : 'bg-stone-200';

  // Group by date for display
  let lastDate = null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-[60]"
      onClick={() => setShowIntentActivityLog(false)}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setShowIntentActivityLog(false); } }}
      tabIndex={-1}
      ref={el => el && el.focus()}
    >
      <div
        className={`${cardBg} rounded-t-2xl sm:rounded-2xl shadow-xl border ${borderClass} w-full sm:max-w-md mx-0 sm:mx-4 flex flex-col`}
        style={{ maxHeight: '80vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-4 pt-4 pb-3 border-b ${borderClass} flex-shrink-0`}>
          <h3 className={`text-sm font-semibold ${textPrimary}`}>Intent Activity</h3>
          <div className="flex items-center gap-1">
            {entries.length > 0 && (
              <button
                onClick={handleClear}
                className={`p-1.5 rounded-lg ${hoverBg} flex items-center gap-1`}
                title="Clear log"
              >
                <Trash2 size={14} className={textSecondary} />
              </button>
            )}
            <button onClick={() => setShowIntentActivityLog(false)} className={`p-1.5 rounded-lg ${hoverBg}`}>
              <X size={16} className={textSecondary} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1">
          {entries.length === 0 ? (
            <div className={`text-sm ${textSecondary} text-center py-10 px-4`}>
              No activity yet.<br />
              <span className="text-xs">Events appear here once the intent WebDAV endpoint is configured.</span>
            </div>
          ) : (
            <div className="py-1">
              {entries.map(entry => {
                const dateLabel = formatDate(entry.timestamp);
                const showDateDivider = dateLabel !== lastDate;
                lastDate = dateLabel;
                return (
                  <React.Fragment key={entry.id}>
                    {showDateDivider && (
                      <div className={`px-4 py-1.5 flex items-center gap-2`}>
                        <div className={`flex-1 h-px ${dividerBg}`} />
                        <span className={`text-xs ${textSecondary} flex-shrink-0`}>{dateLabel}</span>
                        <div className={`flex-1 h-px ${dividerBg}`} />
                      </div>
                    )}
                    <div className={`px-4 py-2.5 flex items-start gap-2.5`}>
                      {/* Direction icon */}
                      <div className="mt-0.5 flex-shrink-0">
                        {entry.direction === 'in'
                          ? <ArrowDownLeft size={13} className="text-blue-500" />
                          : <ArrowUpRight size={13} className="text-purple-500" />
                        }
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${badgeClass(entry, darkMode)}`}>
                            {badgeLabel(entry)}
                          </span>
                          {shortApp(entry.source_app) && (
                            <span className={`text-xs ${textSecondary}`}>{shortApp(entry.source_app)}</span>
                          )}
                        </div>
                        {entry.title && (
                          <p className={`text-xs ${textPrimary} mt-0.5 truncate`}>{entry.title}</p>
                        )}
                        {entry.error && (
                          <p className="text-xs text-red-500 mt-0.5 truncate">{entry.error}</p>
                        )}
                      </div>

                      {/* Time */}
                      <span className={`text-xs ${textSecondary} flex-shrink-0 mt-0.5`}>{formatTime(entry.timestamp)}</span>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IntentActivityLogModal;
