import React, { useEffect, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { getStorageUsage, getIndexedDbUsage, formatBytes } from '../utils/storage.js';

const StorageBreakdownModal = () => {
  const { t } = useTranslation();
  const { cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg } = useDayPlannerCtx();
  const { showStorageBreakdown, setShowStorageBreakdown } = useSyncCtx();
  // null means the browser will not separate IndexedDB from the service worker
  // precache in its estimate, NOT that IndexedDB is empty. The line is omitted
  // rather than showing a total that is mostly application bundle.
  const [databaseBytes, setDatabaseBytes] = useState(null);

  useEffect(() => {
    if (!showStorageBreakdown) return undefined;
    let live = true;
    getIndexedDbUsage().then((bytes) => { if (live) setDatabaseBytes(bytes); });
    return () => { live = false; };
  }, [showStorageBreakdown]);

  if (!showStorageBreakdown) return null;

  const { totalBytes, entries } = getStorageUsage();
  const warn = totalBytes > 4 * 1024 * 1024;
  const labels = {
    // The Todoist CACHE moved to IndexedDB; this key now holds only the pending
    // completion receipts, which are deliberately left in localStorage so a
    // command UUID is durable before its request goes out.
    'dg-todoist-state-v1': t('storage.todoistReceipts'),
    'day-planner-tasks': t('reminders.scheduledTasks'),
    'day-planner-tasks:user': t('reminders.scheduledTasks'),
    'day-planner-tasks:imported': t('storage.importedCalendarEvents', { defaultValue: 'Imported calendar events' }),
    'day-planner-unscheduled': t('settings.inbox'),
    'day-planner-recycle-bin': t('app.recycleBin'),
    'day-planner-recurring-tasks': t('reminders.recurringTasks'),
    'day-planner-daily-notes': t('common.dailyNote'),
    'day-planner-routine-definitions': t('settings.routines'),
    'day-planner-today-routines': t('routines.todaysRoutine'),
    'day-planner-cloud-sync-config': t('settings.cloudSync'),
    'day-planner-deleted-task-ids': t('storage.deletionTombstones', { defaultValue: 'Deletion tombstones' }),
    'day-planner-auto-backup-config': t('settings.backups'),
    'day-planner-habits': t('settings.habitTracking'),
    'day-planner-habit-logs': t('storage.habitLogs', { defaultValue: 'Habit logs' }),
    'day-planner-habits-enabled': t('settings.enableHabitTracking'),
  };

  return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setShowStorageBreakdown(false)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowStorageBreakdown(false); } }} tabIndex={-1} ref={(el) => el && el.focus()}>
            <div className={`${cardBg} rounded-lg shadow-xl p-5 border ${borderClass} max-w-sm w-full mx-4 max-h-[70vh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <h3 className={`text-sm font-semibold ${textPrimary}`}>{t('storage.title', { defaultValue: 'Storage Breakdown' })}</h3>
                <button onClick={() => setShowStorageBreakdown(false)} className={`p-1 rounded ${hoverBg}`} aria-label={t('common.close')}><X size={16} className={textSecondary} /></button>
              </div>
              <div className={`text-xs font-medium mb-3 ${warn ? 'text-orange-500' : textSecondary}`}>
                {warn && <AlertTriangle size={12} className="inline mr-1" />}
                {t('storage.total', {
                  used: formatBytes(totalBytes),
                  percent: (totalBytes / (5 * 1024 * 1024) * 100).toFixed(0),
                })}
              </div>
              {/* Progress bar. ~5 MiB is hardcoded because no API reports the real
                  localStorage cap; it is the lowest common denominator across the
                  targets, the tightest being the iOS and Android webviews. */}
              <div className={`w-full h-2 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} mb-4`}>
                <div className={`h-full rounded-full transition-all ${warn ? 'bg-orange-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, totalBytes / (5 * 1024 * 1024) * 100)}%` }} />
              </div>
              {databaseBytes != null && (
                <div className={`text-xs mb-4 ${textSecondary}`}>
                  {t('storage.database', { used: formatBytes(databaseBytes) })}
                </div>
              )}
              <div className="space-y-1.5">
                {entries.filter(k => k.bytes > 100).map(({ key, bytes, count }) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className={`${textSecondary} truncate flex-1 mr-2`}>{labels[key] || (key.startsWith('dg-todoist-state-v1:') ? labels['dg-todoist-state-v1'] : key)}{count != null ? ` (${count.toLocaleString()})` : ''}</span>
                    <span className={`font-mono ${textPrimary} flex-shrink-0`}>{formatBytes(bytes)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
  );
};

export default StorageBreakdownModal;
