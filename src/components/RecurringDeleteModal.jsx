import React from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const RecurringDeleteModal = () => {
  const {
    recurringDeleteConfirm, setRecurringDeleteConfirm,
    cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg,
    deleteRecurringInstance,
  } = useDayPlannerCtx();

  const { t } = useTranslation();

  if (!recurringDeleteConfirm) return null;

  return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setRecurringDeleteConfirm(null)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRecurringDeleteConfirm(null); } }} tabIndex={-1} ref={(el) => el && el.focus()}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <RefreshCw size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('modal.confirmDeleteRecurring')}</h3>
            </div>
            <p className={`${textSecondary} mb-2`}>
              {t('modal.confirmDeleteRecurringMessage')}
            </p>
            <p className={`text-xs ${textSecondary} mb-4`}>
              {t('modal.confirmDeleteRecurringNote')}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => deleteRecurringInstance('this')}
                className={`w-full text-left px-4 py-2.5 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary}`}
              >
                <div className="font-medium">{t('modal.deleteThisOccurrence')}</div>
                <div className={`text-xs ${textSecondary}`}>{t('modal.deleteThisOccurrenceHint', { date: recurringDeleteConfirm.dateStr })}</div>
              </button>
              <button
                onClick={() => deleteRecurringInstance('future')}
                className={`w-full text-left px-4 py-2.5 rounded-lg ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary}`}
              >
                <div className="font-medium">{t('modal.deleteThisAndFuture')}</div>
                <div className={`text-xs ${textSecondary}`}>{t('modal.deleteThisAndFutureHint', { date: recurringDeleteConfirm.dateStr })}</div>
              </button>
              <button
                onClick={() => deleteRecurringInstance('series')}
                className="w-full text-left px-4 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                <div className="font-medium">{t('modal.deleteEntireSeries')}</div>
                <div className="text-xs opacity-75">{t('modal.deleteEntireSeriesHint')}</div>
              </button>
              <button
                onClick={() => setRecurringDeleteConfirm(null)}
                className={`w-full px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary} ${hoverBg} mt-1`}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
  );
};

export default RecurringDeleteModal;
