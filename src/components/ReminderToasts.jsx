import React from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { isAheadReminder } from '../hooks/useReminderEngine.js';

const ReminderToasts = () => {
  const { t } = useTranslation();
  const { cardBg, borderClass, textPrimary, textSecondary, darkMode, toggleComplete } = useDayPlannerCtx();
  const {
    activeReminders,
    showWeeklyReviewReminder, showWeeklyReview,
    dismissReminder, snoozeReminder, dismissAllReminders,
  } = useFeaturesCtx();

  if (activeReminders.length === 0) return null;

  return (
        <div className={`fixed right-6 z-50 flex flex-col-reverse gap-2 w-64 ${showWeeklyReviewReminder && !showWeeklyReview ? 'bottom-36' : 'bottom-6'}`}>
          {activeReminders.slice(0, 5).map((reminder) => (
            <div
              key={reminder.id}
              className={`w-full ${cardBg} rounded-lg shadow-xl ${borderClass} border p-3 animate-in slide-in-from-right`}
            >
              <div className="flex items-start gap-2">
                <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${reminder.taskColor || 'bg-blue-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${textPrimary}`}>{reminder.taskTitle}</p>
                  <div className="flex items-center gap-2">
                    <p className={`text-xs ${textSecondary}`}>{reminder.message}</p>
                    {reminder.startTime && reminder.type !== 'morning' && (
                      <span className={`text-xs ${textSecondary}`}>{reminder.startTime}</span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => dismissReminder(reminder.id)}
                  aria-label={t('common.dismiss')}
                  className={`${textSecondary} hover:${textPrimary} flex-shrink-0`}
                >
                  <X size={14} />
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                {reminder.type === 'end' && !reminder.isCalendarEvent && (
                  <button
                    onClick={() => { toggleComplete(reminder.taskId); dismissReminder(reminder.id); }}
                    className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    {t('focus.complete')}
                  </button>
                )}
                {/* Snooze pushes the task 15 minutes later: not for an end, a
                    morning reminder, or early notice hours ahead (#2249). */}
                {reminder.type !== 'end' && reminder.type !== 'morning' && !isAheadReminder(reminder.type) && reminder.startTime && (
                  <button
                    onClick={() => snoozeReminder(reminder)}
                    className="px-2.5 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  >
                    {t('reminders.snoozeMinutes', { count: 15 })}
                  </button>
                )}
                <button
                  onClick={() => dismissReminder(reminder.id)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'}`}
                >
                  {t('common.dismiss')}
                </button>
              </div>
            </div>
          ))}
          {activeReminders.length > 5 && (
            <p className={`text-xs ${textSecondary} text-right`}>{t('reminders.more', { count: activeReminders.length - 5 })}</p>
          )}
          {activeReminders.length > 1 && (
            <button
              onClick={dismissAllReminders}
              className={`text-xs ${textSecondary} hover:underline text-right`}
            >
              {t('reminders.dismissAll')}
            </button>
          )}
        </div>
  );
};

export default ReminderToasts;
