import React from 'react';
import { Bell, BarChart3 } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import ClockTimePicker from './ClockTimePicker.jsx';

const RemindersSettingsModal = () => {
  const {
    showRemindersSettings, setShowRemindersSettings,
    showMorningTimePicker, setShowMorningTimePicker,
    showWeeklyReviewTimePicker, setShowWeeklyReviewTimePicker,
    reminderSettings, setReminderSettings,
    applyReminderPreset, updateCategoryReminder,
    darkMode,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    isTablet,
    use24HourClock,
    formatTime,
  } = useDayPlannerCtx();

  return (
    <>
      {showRemindersSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowRemindersSettings(false)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Bell size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Reminders</h3>
            </div>

            {/* Master toggle */}
            <label className="flex items-center gap-3 cursor-pointer mb-4">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={reminderSettings.enabled}
                  onChange={(e) => setReminderSettings(prev => ({ ...prev, enabled: e.target.checked }))}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.enabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
              </div>
              <span className={`text-sm ${textPrimary}`}>Enable reminders</span>
            </label>

            {reminderSettings.enabled && (
              <div className="space-y-4">
                {/* In-app toasts toggle */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={reminderSettings.inAppToasts !== false}
                      onChange={(e) => setReminderSettings(prev => ({ ...prev, inAppToasts: e.target.checked }))}
                      className="sr-only"
                    />
                    <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.inAppToasts !== false ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.inAppToasts !== false ? 'translate-x-5' : 'translate-x-1'}`} />
                    </div>
                  </div>
                  <span className={`text-sm ${textPrimary}`}>In-app toasts</span>
                </label>

                {/* Browser notifications toggle */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={reminderSettings.browserNotifications}
                      onChange={(e) => {
                        const val = e.target.checked;
                        if (val && typeof Notification !== 'undefined' && Notification.permission === 'default') {
                          Notification.requestPermission();
                        }
                        setReminderSettings(prev => ({ ...prev, browserNotifications: val }));
                      }}
                      className="sr-only"
                    />
                    <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.browserNotifications ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.browserNotifications ? 'translate-x-5' : 'translate-x-1'}`} />
                    </div>
                  </div>
                  <div>
                    <span className={`text-sm ${textPrimary}`}>Browser notifications</span>
                    <p className={`text-xs ${textSecondary}`}>
                      {typeof Notification !== 'undefined'
                        ? Notification.permission === 'granted' ? 'Permission granted'
                        : Notification.permission === 'denied' ? 'Permission denied — enable in browser settings'
                        : 'Will request permission when enabled'
                        : 'Not supported in this browser'}
                    </p>
                  </div>
                </label>

                {/* Presets */}
                <div>
                  <p className={`text-xs font-medium ${textSecondary} mb-2`}>Presets</p>
                  <div className="flex gap-2">
                    {[['standard', 'Standard'], ['aggressive', 'Aggressive'], ['minimal', 'Minimal']].map(([key, label]) => (
                      <button
                        key={key}
                        onClick={() => applyReminderPreset(key)}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                          reminderSettings.preset === key
                            ? 'bg-blue-600 text-white'
                            : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                    {reminderSettings.preset === 'custom' && (
                      <span className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white">Custom</span>
                    )}
                  </div>
                </div>

                {/* Per-category grids */}
                {[
                  ['calendarEvents', 'Calendar Events'],
                  ['calendarTasks', 'Calendar Tasks'],
                  ['scheduledTasks', 'Scheduled Tasks'],
                  ['recurringTasks', 'Recurring Tasks'],
                ].map(([catKey, catLabel]) => (
                  <div key={catKey}>
                    <p className={`text-xs font-medium ${textSecondary} mb-1.5`}>{catLabel}</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {[
                        ['before15', '-15m'],
                        ['before10', '-10m'],
                        ['before5', '-5m'],
                        ['atStart', 'Start'],
                        ['atEnd', 'End'],
                      ].map(([field, label]) => (
                        <button
                          key={field}
                          onClick={() => updateCategoryReminder(catKey, field, !reminderSettings.categories[catKey]?.[field])}
                          className={`px-2.5 py-1 text-xs rounded transition-colors ${
                            reminderSettings.categories[catKey]?.[field]
                              ? 'bg-blue-600 text-white'
                              : `${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-stone-200 text-stone-500'} ${hoverBg}`
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* All-day tasks */}
                <div>
                  <p className={`text-xs font-medium ${textSecondary} mb-1.5`}>All-Day Tasks</p>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reminderSettings.categories.allDayTasks?.morningReminder ?? true}
                        onChange={(e) => updateCategoryReminder('allDayTasks', 'morningReminder', e.target.checked)}
                        className="rounded border-stone-300"
                      />
                      <span className={`text-xs ${textPrimary}`}>Morning reminder at</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowMorningTimePicker(true)}
                      className={`text-xs px-2 py-1 rounded border ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-stone-300 text-stone-700'}`}
                    >
                      {formatTime(reminderSettings.morningReminderTime)}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Weekly Review */}
            <div className={`border-t ${borderClass} mt-4 pt-4`}>
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 size={16} className="text-purple-500" />
                <span className={`text-sm font-semibold ${textPrimary}`}>Weekly Review</span>
              </div>
              <label className="flex items-center gap-3 cursor-pointer mb-3">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={reminderSettings.weeklyReview?.enabled ?? true}
                    onChange={(e) => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, enabled: e.target.checked } }))}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.weeklyReview?.enabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.weeklyReview?.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>Notify me for weekly review</span>
              </label>
              {reminderSettings.weeklyReview?.enabled && (
                <div className="space-y-3 ml-1">
                  <div>
                    <p className={`text-xs ${textSecondary} mb-1.5`}>Day</p>
                    <div className="flex gap-1">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => (
                        <button
                          key={label}
                          onClick={() => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, day: i } }))}
                          className={`px-2 py-1 text-xs rounded-full transition-colors ${
                            reminderSettings.weeklyReview.day === i
                              ? 'bg-blue-600 text-white'
                              : darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className={`text-xs ${textSecondary} mb-1.5`}>Time</p>
                    <button
                      type="button"
                      onClick={() => setShowWeeklyReviewTimePicker(true)}
                      className={`text-xs px-2 py-1 rounded border ${darkMode ? 'bg-gray-700 border-gray-600 text-gray-200' : 'bg-white border-stone-300 text-stone-700'}`}
                    >
                      {formatTime(reminderSettings.weeklyReview.time)}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={() => setShowRemindersSettings(false)}
              className={`w-full mt-6 px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors text-sm`}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {showMorningTimePicker && (
        <ClockTimePicker
          value={reminderSettings.morningReminderTime}
          onChange={(time) => setReminderSettings(prev => ({ ...prev, morningReminderTime: time }))}
          onClose={() => setShowMorningTimePicker(false)}
          darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
        />
      )}

      {showWeeklyReviewTimePicker && (
        <ClockTimePicker
          value={reminderSettings.weeklyReview?.time || '19:00'}
          onChange={(time) => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, time } }))}
          onClose={() => setShowWeeklyReviewTimePicker(false)}
          darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
        />
      )}
    </>
  );
};

export default RemindersSettingsModal;
