import React from 'react';
import { BarChart3, Bell, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import ClockTimePicker from './ClockTimePicker.jsx';
import { localizedWeekdays } from '../utils/localeFormatting.js';
import { useTranslation } from 'react-i18next';

const RemindersSettingsModal = () => {
  const { t } = useTranslation();
  const {
    darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    isTablet, use24HourClock, formatTime,
  } = useDayPlannerCtx();
  const {
    showRemindersSettings, setShowRemindersSettings,
    showMorningTimePicker, setShowMorningTimePicker,
    showWeeklyReviewTimePicker, setShowWeeklyReviewTimePicker,
    reminderSettings, setReminderSettings,
    applyReminderPreset, updateCategoryReminder,
    goalsProjectsEnabled,
  } = useFeaturesCtx();

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
              <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('settings.notifications')}</h3>
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
              <span className={`text-sm ${textPrimary}`}>{t('settings.enableReminders')}</span>
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
                  <span className={`text-sm ${textPrimary}`}>{t('settings.inAppToasts')}</span>
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
                    <span className={`text-sm ${textPrimary}`}>{t('settings.browserNotifications')}</span>
                    <p className={`text-xs ${textSecondary}`}>
                      {typeof Notification !== 'undefined'
                        ? Notification.permission === 'granted' ? t('reminders.permissionGranted')
                        : Notification.permission === 'denied' ? t('reminders.permissionDenied')
                        : t('reminders.permissionRequest')
                        : t('reminders.notSupported')}
                    </p>
                  </div>
                </label>

                {/* Presets */}
                <div>
                  <p className={`text-xs font-medium ${textSecondary} mb-2`}>{t('settings.presets')}</p>
                  <div className="flex gap-2">
                    {[['standard', t('reminders.presetStandard')], ['aggressive', t('reminders.presetAggressive')], ['minimal', t('reminders.presetMinimal')]].map(([key, label]) => (
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
                      <span className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white">{t('reminders.presetCustom')}</span>
                    )}
                  </div>
                </div>

                {/* Per-category grids */}
                {[
                  ['calendarEvents', t('reminders.calendarEvents')],
                  ['calendarTasks', t('reminders.calendarTasks')],
                  ['scheduledTasks', t('reminders.scheduledTasks')],
                  ['recurringTasks', t('reminders.recurringTasks')],
                ].map(([catKey, catLabel]) => (
                  <div key={catKey}>
                    <p className={`text-xs font-medium ${textSecondary} mb-1.5`}>{catLabel}</p>
                    <div className="flex gap-1.5 flex-wrap">
                      {[
                        ['before15', '-15m'],
                        ['before10', '-10m'],
                        ['before5', '-5m'],
                        ['atStart', t('common.start')],
                        ['atEnd', t('common.end')],
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
                  <p className={`text-xs font-medium ${textSecondary} mb-1.5`}>{t('reminders.allDayTasks')}</p>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reminderSettings.categories.allDayTasks?.morningReminder ?? true}
                        onChange={(e) => updateCategoryReminder('allDayTasks', 'morningReminder', e.target.checked)}
                        className="rounded border-stone-300"
                      />
                      <span className={`text-xs ${textPrimary}`}>{t('reminders.morningReminderAt')}</span>
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
                <span className={`text-sm font-semibold ${textPrimary}`}>{t('weeklyReview.title')}</span>
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
                <span className={`text-sm ${textPrimary}`}>{t('settings.notifyWeeklyReview')}</span>
              </label>
              {reminderSettings.weeklyReview?.enabled && (
                <div className="space-y-3 ml-1">
                  <div>
                    <p className={`text-xs ${textSecondary} mb-1.5`}>{t('task.date')}</p>
                    <div className="flex gap-1">
                      {localizedWeekdays('short').map((label, i) => (
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
                    <p className={`text-xs ${textSecondary} mb-1.5`}>{t('task.time')}</p>
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

            {/* hyperGLANCE Sessions — only relevant when Goals & Projects is on */}
            {goalsProjectsEnabled && (
            <div className={`border-t ${borderClass} mt-4 pt-4`}>
              <div className="flex items-center gap-2 mb-3">
                <Zap size={16} className="text-indigo-500" />
                <span className={`text-sm font-semibold ${textPrimary}`}>{t('reminders.hyperGlanceSessions')}</span>
              </div>
              <label className="flex items-center gap-3 cursor-pointer mb-3">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={reminderSettings.hyperGlance?.enabled !== false}
                    onChange={(e) => setReminderSettings(prev => ({ ...prev, hyperGlance: { ...prev.hyperGlance, enabled: e.target.checked } }))}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.hyperGlance?.enabled !== false ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.hyperGlance?.enabled !== false ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>{t('settings.notifySessionStart')}</span>
              </label>
              {reminderSettings.hyperGlance?.enabled !== false && (
                <div>
                  <p className={`text-xs ${textSecondary} mb-1.5`}>{t('reminders.sessionReminder')}</p>
                  <div className="flex gap-1.5 flex-wrap">
                    {[[0, t('common.off')], [5, t('reminders.beforeMinutes', { count: 5 })], [10, t('reminders.beforeMinutes', { count: 10 })], [15, t('reminders.beforeMinutes', { count: 15 })], [30, t('reminders.beforeMinutes', { count: 30 })]].map(([mins, label]) => (
                      <button
                        key={mins}
                        onClick={() => setReminderSettings(prev => ({ ...prev, hyperGlance: { ...prev.hyperGlance, upNextMinutes: mins } }))}
                        className={`px-2.5 py-1 text-xs rounded transition-colors ${
                          (reminderSettings.hyperGlance?.upNextMinutes ?? 10) === mins
                            ? 'bg-blue-600 text-white'
                            : `${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-stone-200 text-stone-500'} ${hoverBg}`
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            )}

            <button
              onClick={() => setShowRemindersSettings(false)}
              className={`w-full mt-6 px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors text-sm`}
            >
              {t('common.close')}
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
