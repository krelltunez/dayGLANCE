import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

/**
 * A reusable in-app confirmation dialog (replaces window.confirm).
 *
 * Props:
 *   title        — short heading, e.g. "Delete Goal"
 *   message      — explanatory sentence shown below the title
 *   confirmLabel — label for the destructive button (default "Delete")
 *   onConfirm    — called when the user confirms
 *   onCancel     — called when the user cancels or clicks the backdrop
 */
const ConfirmDialog = ({ title, message, confirmLabel, onConfirm, onCancel, hideCancelButton = false }) => {
  const { t } = useTranslation();
  const resolvedConfirmLabel = confirmLabel ?? t('common.delete');
  const { darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg } =
    useDayPlannerCtx();

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className={`${cardBg} rounded-2xl shadow-2xl p-5 w-full max-w-sm flex flex-col gap-4`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <h3 className={`text-base font-semibold ${textPrimary}`}>{title}</h3>
            {message && <p className={`text-sm ${textSecondary} leading-snug`}>{message}</p>}
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          {!hideCancelButton && (
            <button
              onClick={onCancel}
              className={`px-3 py-2 text-base rounded-lg ${hoverBg} ${textSecondary} transition-colors`}
            >
              {t('common.cancel')}
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-base rounded-lg font-medium transition-colors ${hideCancelButton ? `${hoverBg} ${textPrimary}` : 'bg-red-600 hover:bg-red-700 text-white'}`}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
