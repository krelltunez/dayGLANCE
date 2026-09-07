import React from 'react';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';

const ImportCalendarModal = () => {
  const { t } = useTranslation();
  const { colors, cardBg, borderClass, textPrimary, textSecondary, darkMode } = useDayPlannerCtx();
  const {
    showImportModal, setShowImportModal,
    pendingImportFile, setPendingImportFile,
    importColor, setImportColor,
    processImportFile,
  } = useSyncCtx();

  if (!showImportModal) return null;

  return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => { setShowImportModal(false); setPendingImportFile(null); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Upload size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('calendarImport.title')}</h3>
            </div>
            <p className={`${textSecondary} mb-4`}>
              {t('calendarImport.prompt', { file: pendingImportFile?.name })}
            </p>
            <div className="mb-4">
              <label className={`block text-sm ${textSecondary} mb-2`}>{t('calendarImport.eventColor')}</label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {[{ name: 'Gray', class: 'bg-gray-600' }, ...colors].map(c => (
                  <button
                    key={c.class}
                    onClick={() => setImportColor(c.class)}
                    className={`w-7 h-7 rounded-full ${c.class} transition-all ${importColor === c.class ? 'ring-2 ring-offset-2 ring-blue-500' + (darkMode ? ' ring-offset-gray-800' : '') : 'hover:scale-110'}`}
                    title={t(`colors.${c.name.toLowerCase()}`)}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-3">
              <button
                onClick={() => processImportFile(false)}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">{t('calendarImport.asEvents')}</div>
                <div className={`text-sm ${textSecondary}`}>{t('calendarImport.eventsDescription')}</div>
              </button>
              <button
                onClick={() => processImportFile(true)}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">{t('calendarImport.asTaskCalendar')}</div>
                <div className={`text-sm ${textSecondary}`}>{t('calendarImport.tasksDescription')}</div>
              </button>
            </div>
            <div className="flex justify-end mt-4">
              <button
                onClick={() => { setShowImportModal(false); setPendingImportFile(null); }}
                className={`px-4 py-2 ${darkMode ? 'bg-gray-600 hover:bg-gray-500' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
  );
};

export default ImportCalendarModal;
