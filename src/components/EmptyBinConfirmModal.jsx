import React from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';

const EmptyBinConfirmModal = () => {
  const {
    recycleBin,
    cardBg, borderClass, textPrimary, textSecondary, darkMode, hoverBg,
    confirmEmptyBin,
  } = useDayPlannerCtx();
  const { showEmptyBinConfirm, setShowEmptyBinConfirm, setShowMobileRecycleBin } = useSyncCtx();

  const { t } = useTranslation();

  if (!showEmptyBinConfirm) return null;

  return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => { setShowEmptyBinConfirm(false); setShowMobileRecycleBin(false); }}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-red-100 dark:bg-red-900/30">
                <Trash2 size={20} className="text-red-600 dark:text-red-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('modal.emptyBinTitle')}</h3>
            </div>
            <p className={`${textSecondary} mb-6`}>
              {t('modal.emptyBinMessage', { count: recycleBin.length, plural: recycleBin.length !== 1 ? 's' : '' })}
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowEmptyBinConfirm(false); setShowMobileRecycleBin(false); }}
                className={`px-4 py-2 rounded-lg ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textPrimary} ${hoverBg}`}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={confirmEmptyBin}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                {t('common.deleteAll')}
              </button>
            </div>
          </div>
        </div>
  );
};

export default EmptyBinConfirmModal;
