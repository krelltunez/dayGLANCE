import React from 'react';
import { AlertCircle } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const RestoreConfirmModal = () => {
  const {
    showRestoreConfirm, setShowRestoreConfirm,
    pendingBackupFile, setPendingBackupFile,
    cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg,
    restoreBackup,
  } = useDayPlannerCtx();

  if (!showRestoreConfirm) return null;

  return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowRestoreConfirm(false); setPendingBackupFile(null); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900/30">
                <AlertCircle size={20} className="text-amber-600 dark:text-amber-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Restore Backup</h3>
            </div>
            <p className={`${textSecondary} mb-2`}>
              Restore from "{pendingBackupFile?.name}"?
            </p>
            <p className={`${textSecondary} mb-6 text-sm`}>
              This will replace all your current tasks, inbox items, recycle bin, and settings with the data from this backup. The page will reload after restoration.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowRestoreConfirm(false); setPendingBackupFile(null); }}
                className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary} ${hoverBg}`}
              >
                Cancel
              </button>
              <button
                onClick={restoreBackup}
                className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
  );
};

export default RestoreConfirmModal;
