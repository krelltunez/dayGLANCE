import React from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { getStorageUsage, formatBytes } from '../utils/storage.js';

const StorageBreakdownModal = () => {
  const {
    showStorageBreakdown, setShowStorageBreakdown,
    cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg,
  } = useDayPlannerCtx();

  if (!showStorageBreakdown) return null;

  const { totalBytes, entries } = getStorageUsage();
  const warn = totalBytes > 4 * 1024 * 1024;
  const labels = {
    'day-planner-tasks': 'Scheduled tasks',
    'day-planner-tasks:user': 'Scheduled tasks',
    'day-planner-tasks:imported': 'Imported calendar events',
    'day-planner-unscheduled': 'Inbox tasks',
    'day-planner-recycle-bin': 'Recycle bin',
    'day-planner-recurring-tasks': 'Recurring tasks',
    'day-planner-daily-notes': 'Daily notes',
    'day-planner-routine-definitions': 'Routines',
    'day-planner-today-routines': 'Today routines',
    'day-planner-cloud-sync-config': 'Cloud sync config',
    'day-planner-deleted-task-ids': 'Deletion tombstones',
    'day-planner-auto-backup-config': 'Backup config',
    'day-planner-habits': 'Habit definitions',
    'day-planner-habit-logs': 'Habit logs',
    'day-planner-habits-enabled': 'Habits toggle',
  };

  return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setShowStorageBreakdown(false)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowStorageBreakdown(false); } }} tabIndex={-1} ref={(el) => el && el.focus()}>
            <div className={`${cardBg} rounded-lg shadow-xl p-5 border ${borderClass} max-w-sm w-full mx-4 max-h-[70vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-sm font-semibold ${textPrimary}`}>Storage Breakdown</h3>
                <button onClick={() => setShowStorageBreakdown(false)} className={`p-1 rounded ${hoverBg}`}><X size={16} className={textSecondary} /></button>
              </div>
              <div className={`text-xs font-medium mb-3 ${warn ? 'text-orange-500' : textSecondary}`}>
                {warn && <AlertTriangle size={12} className="inline mr-1" />}
                Total: {formatBytes(totalBytes)} / ~5 MB ({(totalBytes / (5 * 1024 * 1024) * 100).toFixed(0)}%)
              </div>
              {/* Progress bar */}
              <div className={`w-full h-2 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} mb-4`}>
                <div className={`h-full rounded-full transition-all ${warn ? 'bg-orange-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, totalBytes / (5 * 1024 * 1024) * 100)}%` }} />
              </div>
              <div className="space-y-1.5">
                {entries.filter(k => k.bytes > 100).map(({ key, bytes, count }) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className={`${textSecondary} truncate flex-1 mr-2`}>{labels[key] || key}{count != null ? ` (${count.toLocaleString()})` : ''}</span>
                    <span className={`font-mono ${textPrimary} flex-shrink-0`}>{formatBytes(bytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
  );
};

export default StorageBreakdownModal;
