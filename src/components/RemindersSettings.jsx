import React from 'react';
import { BarChart3, Bell, Smartphone, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import ClockTimePicker from './ClockTimePicker.jsx';
import SettingsCard from './settings/SettingsCard.jsx';
import { localizedWeekdays } from '../utils/localeFormatting.js';
import { useTranslation } from 'react-i18next';

// Settings → Notifications (#2075, docs/settings-redesign.md). The content of
// what was the header bell's dialog, as cards: reminders, the weekly review
// and hyperGLANCE sessions each have their own switch.
const RemindersSettings = () => {
  const { t } = useTranslation();
  const {
    darkMode, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    isTablet, use24HourClock, formatTime,
    isIOSApp, liveActivityEnabled, setLiveActivityEnabled,
  } = useDayPlannerCtx();
  const {
    showMorningTimePicker, setShowMorningTimePicker,
    showWeeklyReviewTimePicker, setShowWeeklyReviewTimePicker,
    reminderSettings, setReminderSettings,
    applyReminderPreset, updateCategoryReminder,
    goalsProjectsEnabled,
  } = useFeaturesCtx();

  return (
    <>
      <div className="space-y-6">
            <SettingsCard
              cardId="reminders"
              icon={Bell}
              title={t('reminders.title')}
              switchLabel={t('settings.enableReminders')}
              checked={!!reminderSettings.enabled}
              onToggle={(next) => setReminderSettings(prev => ({ ...prev, enabled: next }))}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
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
                        // Longer leads (#2249) land the day before for an
                        // early task; useReminderEngine reads tomorrow too.
                        ['ahead720', '-12h'],
                        ['ahead480', '-8h'],
                        ['ahead240', '-4h'],
                        ['ahead120', '-2h'],
                        ['ahead60', '-1h'],
                        ['ahead30', '-30m'],
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
            </SettingsCard>

            {/* Live Activity (iOS only): opt-in, default off, because the
                compact island hides the cellular and wifi status icons. Its
                own card, since it does not depend on reminders being on. */}
            {isIOSApp && (
            <SettingsCard
              cardId="liveActivity"
              icon={Smartphone}
              title={t('settings.liveActivity')}
              hint={t('settings.liveActivityDesc')}
              checked={!!liveActivityEnabled}
              onToggle={(next) => setLiveActivityEnabled(next)}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            />
            )}

            {/* Weekly Review */}
            <SettingsCard
              cardId="weeklyReview"
              icon={BarChart3}
              title={t('weeklyReview.title')}
              switchLabel={t('settings.notifyWeeklyReview')}
              checked={!!reminderSettings.weeklyReview?.enabled}
              onToggle={(next) => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, enabled: next } }))}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
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
            </SettingsCard>

            {/* hyperGLANCE Sessions — only relevant when Goals & Projects is on */}
            {goalsProjectsEnabled && (
            <SettingsCard
              cardId="hyperGlance"
              icon={Zap}
              title={t('reminders.hyperGlanceSessions')}
              switchLabel={t('settings.notifySessionStart')}
              checked={reminderSettings.hyperGlance?.enabled !== false}
              onToggle={(next) => setReminderSettings(prev => ({ ...prev, hyperGlance: { ...prev.hyperGlance, enabled: next } }))}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
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
            </SettingsCard>
            )}

      </div>

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

export default RemindersSettings;
