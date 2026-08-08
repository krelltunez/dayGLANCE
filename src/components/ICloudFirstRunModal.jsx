import React from 'react';
import { Cloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Offered once, on a launch that finds cloud data and no local data.
 *
 * The situation it exists for: deleting the iOS app does not delete
 * dayglance-sync.json (it lives in the ubiquity container, outside the sandbox,
 * and any Mac running dayGLANCE keeps writing to it), and reinstalling re-grants
 * the iCloud entitlement, so the per-app toggle comes back ON. The app then found
 * the surviving copy and restored everything with no prompt and no way to decline
 * — which reads as "deleting the app did nothing".
 *
 * The toggle resetting is OS state we cannot control, and the preference cannot be
 * remembered because localStorage goes with the app. Restoring *silently* is the
 * part that was ours to fix.
 *
 * Mirrors the WebDAV first-sync dialog (app.existingDataFound) in shape, with two
 * choices rather than three: at first run local is empty, so "merge" and "use the
 * cloud copy" are the same act.
 */
const ICloudFirstRunModal = ({
  info, onRestore, onStartFresh,
  cardBg, borderClass, textPrimary, textSecondary, darkMode,
}) => {
  const { t } = useTranslation();
  if (!info) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
            <Cloud size={20} className="text-blue-600 dark:text-blue-400" />
          </div>
          <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('icloudFirstRun.title')}</h3>
        </div>

        <p className={`${textSecondary} mb-2`}>
          {t('icloudFirstRun.body', { tasks: info.taskCount, inbox: info.inboxCount })}
        </p>
        {info.lastModified && (
          <p className={`text-xs ${textSecondary} mb-4`}>
            {t('icloudFirstRun.lastModified', { when: new Date(info.lastModified).toLocaleString() })}
          </p>
        )}

        <div className="space-y-3">
          <button
            onClick={onRestore}
            className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-left transition-colors"
          >
            <div className="font-medium">{t('icloudFirstRun.restore')}</div>
            <div className="text-sm text-blue-100">{t('icloudFirstRun.restoreHint')}</div>
          </button>
          <button
            onClick={onStartFresh}
            className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
          >
            <div className="font-medium">{t('icloudFirstRun.startFresh')}</div>
            <div className={`text-sm ${textSecondary}`}>{t('icloudFirstRun.startFreshHint')}</div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default ICloudFirstRunModal;
