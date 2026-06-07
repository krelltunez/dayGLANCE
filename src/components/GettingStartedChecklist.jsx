import React from 'react';
import { Sparkles, X, CheckCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

const GettingStartedChecklist = ({ items, completedCount, darkMode, textPrimary, textSecondary, onDismiss, onComplete }) => {
  const { t } = useTranslation();
  const totalCount = items.length;
  const progressPct = Math.round((completedCount / totalCount) * 100);

  return (
    <div className={`mb-4 rounded-lg border ${darkMode ? 'border-blue-500/30 bg-blue-500/10' : 'border-blue-200 bg-blue-50'} overflow-hidden`}>
      <div className="px-3 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-blue-500" />
          <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">{t('gettingStarted.title')}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-blue-500/30 text-blue-300' : 'bg-blue-200 text-blue-700'}`}>
            {completedCount}/{totalCount}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className={`${textSecondary} hover:${textPrimary} p-0.5`}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      {/* Progress bar */}
      <div className={`mx-3 mb-2 h-1.5 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-blue-100'}`}>
        <div className="h-full rounded-full bg-blue-500 transition-all duration-300" style={{ width: `${progressPct}%` }} />
      </div>
      <div className="px-3 pb-3 space-y-1">
        {items.map(item => (
          <div key={item.id} className={`flex items-center gap-2 py-0.5 text-sm ${item.completed ? (darkMode ? 'text-gray-500' : 'text-stone-400') : textSecondary}`}>
            {item.completed
              ? <CheckCircle size={14} className="text-blue-500 flex-shrink-0" />
              : <div className={`w-3.5 h-3.5 rounded-full border ${darkMode ? 'border-gray-600' : 'border-stone-300'} flex-shrink-0`} />
            }
            <span className={item.completed ? 'line-through' : ''}>{item.label}</span>
          </div>
        ))}
      </div>
      <div className="px-3 pb-3">
        <button
          onClick={onComplete}
          className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${darkMode ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'}`}
        >
          {t('gettingStarted.imGoodToGo')}
        </button>
      </div>
    </div>
  );
};

export default GettingStartedChecklist;
