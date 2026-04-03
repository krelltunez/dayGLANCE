import React from 'react';
import { Clock, Save, Upload } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';

const BackupMenuModal = () => {
  const { cardBg, borderClass, textPrimary, textSecondary, darkMode } = useDayPlannerCtx();
  const {
    showBackupMenu, setShowBackupMenu,
    autoBackupConfig, setAutoBackupManagerTab, setShowAutoBackupManager,
    exportBackup, handleBackupFileSelect,
  } = useSyncCtx();

  if (!showBackupMenu) return null;

  return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowBackupMenu(false)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Save size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Backup & Restore</h3>
            </div>
            <p className={`${textSecondary} mb-4`}>
              Export your data to a file or restore from a previous backup.
            </p>
            <div className="space-y-3">
              <button
                onClick={() => { exportBackup(); setShowBackupMenu(false); }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium flex items-center gap-2">
                  <Upload size={16} className="rotate-180" />
                  Export Backup
                </div>
                <div className={`text-sm ${textSecondary}`}>Download all tasks and settings as JSON</div>
              </button>
              <label className={`block w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors cursor-pointer`}>
                <div className="font-medium flex items-center gap-2">
                  <Upload size={16} />
                  Restore Backup
                </div>
                <div className={`text-sm ${textSecondary}`}>Load data from a backup file</div>
                <input type="file" accept=".json" onChange={handleBackupFileSelect} className="hidden" />
              </label>
              <button
                onClick={() => { setShowBackupMenu(false); setAutoBackupManagerTab('settings'); setShowAutoBackupManager(true); }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium flex items-center gap-2">
                  <Clock size={16} />
                  Auto-Backup
                  {(autoBackupConfig.local.enabled || autoBackupConfig.remote.enabled) && (
                    <span className="ml-auto text-xs px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">Active</span>
                  )}
                </div>
                <div className={`text-sm ${textSecondary}`}>Scheduled automatic backups</div>
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => setShowBackupMenu(false)}
                className={`px-4 py-2 ${darkMode ? 'bg-gray-600 hover:bg-gray-500' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors`}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
  );
};

export default BackupMenuModal;
