// Settings: the General topic's sections (docs/settings-redesign.md).
// Moved verbatim from SettingsModal.jsx. Returns `{ key: { show, node, ... } }`
// for the keys this topic lists in settingsTopics.js; the dialog builds
// its topic list, search and page from them.
import React, { useState } from 'react';
import { Archive, Bell, Clock, Globe, Key, MapPin, Newspaper, Settings, Thermometer } from 'lucide-react';
import { getTzLabel, getTzOptions } from '../../../utils/timezones.js';
import DefaultDurationSetting from '../../DefaultDurationSetting.jsx';
import DesktopBackgroundSetting, { desktopBackgroundSupported } from '../../DesktopBackgroundSetting.jsx';
import FollowUpTagSetting from '../../FollowUpTagSetting.jsx';
import LanguagePicker from '../../LanguagePicker.jsx';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../../context/DayPlannerContext.jsx';
import { BIN_AUTO_EMPTY_CHOICES } from '../../../utils/recycleBinRetention.js';

export default function useGeneralTopic() {
  const { t } = useTranslation();
  const {
    darkMode, borderClass, textPrimary, textSecondary, hoverBg, use24HourClock,
    setUse24HourClock, inboxAutoArchiveDays, setInboxAutoArchiveDays, weekStartDay,
    setWeekStartDay, homeTimezone, setHomeTimezone, soundEnabled, setSoundEnabled,
    isMobile, isTablet, weatherZip, setWeatherZip, fetchWeather, weatherTempUnit,
    setWeatherTempUnit, weatherEnabled, setWeatherEnabled, dailyContentEnabled,
    setDailyContentEnabled, binAutoEmptyDays, setBinAutoEmptyDays,
  } = useDayPlannerCtx();
  const [trayHotkey, setTrayHotkey] = useState(() => localStorage.getItem('dg-tray-hotkey') || '');
  const [mainWindowHotkey, setMainWindowHotkey] = useState(() => localStorage.getItem('dg-main-window-hotkey') || '');

  const makeHotkeyRecorder = (storageKey, stateSetter, apiMethod) => (e) => {
    e.preventDefault();
    const ignored = new Set(['Meta', 'Shift', 'Alt', 'Control']);
    if (ignored.has(e.key)) return;
    const mods = [];
    // Electron's "Cmd" is the Command key on macOS only; the Windows key is "Super".
    if (e.metaKey) mods.push(window.electronAPI?.platform === 'darwin' ? 'Cmd' : 'Super');
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    const key = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const accelerator = [...mods, key].join('+');
    stateSetter(accelerator);
    localStorage.setItem(storageKey, accelerator);
    apiMethod?.(accelerator);
    e.target.blur();
  };

  const handleHotkeyRecord = makeHotkeyRecorder('dg-tray-hotkey', setTrayHotkey, (acc) => window.electronAPI?.setGlobalHotkey?.(acc));
  const handleMainWindowHotkeyRecord = makeHotkeyRecorder('dg-main-window-hotkey', setMainWindowHotkey, (acc) => window.electronAPI?.setMainWindowHotkey?.(acc));

  const clearHotkey = () => {
    setTrayHotkey('');
    localStorage.removeItem('dg-tray-hotkey');
    window.electronAPI?.setGlobalHotkey?.('');
  };

  const clearMainWindowHotkey = () => {
    setMainWindowHotkey('');
    localStorage.removeItem('dg-main-window-hotkey');
    window.electronAPI?.setMainWindowHotkey?.('');
  };

  const timezoneMismatch = Intl.DateTimeFormat().resolvedOptions().timeZone !== homeTimezone;

  return {
    // The notices that sat above every page (#2075): each now lives on the
    // page it belongs to, and marks its topic in the list while it applies.
    timezoneNotice: {
      show: timezoneMismatch,
      attention: 'amber',
      node: (
          <div className={`p-3 rounded-lg border ${darkMode ? 'bg-amber-900/20 border-amber-800' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-start gap-2">
              <Globe size={14} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>{t('settings.timezoneMismatch')}</div>
                <div className={`text-xs mt-0.5 ${darkMode ? 'text-amber-400/80' : 'text-amber-700/80'}`}>
                  {t('settings.timezoneDevice')}: <strong>{Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ')}</strong>
                  {' · '}{t('settings.timezoneHome')}: <strong>{homeTimezone.replace(/_/g, ' ')}</strong>
                </div>
                <div className={`text-xs mt-1 ${darkMode ? 'text-amber-400/70' : 'text-amber-600/70'}`}>
                  {t('settings.timezoneMismatchHint')}
                </div>
              </div>
            </div>
          </div>
      ),
    },
    localization: {
      show: true,
      node: (
        <>
            {/* Localization Section */}
            <div className="space-y-3">
              <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                <Clock size={16} className={textSecondary} />
                {t('settings.localization')}
              </h4>
              <div>
                <label htmlFor="settings-language" className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.language')}</label>
                <LanguagePicker
                  id="settings-language"
                  className={`w-full px-2 py-1.5 text-xs rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                />
              </div>
              <div>
                <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.clockFormat')}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setUse24HourClock(false)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      !use24HourClock
                        ? 'bg-blue-600 text-white'
                        : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                    }`}
                  >
                    {t('settings.clock12h')}
                  </button>
                  <button
                    onClick={() => setUse24HourClock(true)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      use24HourClock
                        ? 'bg-blue-600 text-white'
                        : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                    }`}
                  >
                    {t('settings.clock24h')}
                  </button>
                </div>
              </div>
              <div>
                <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.firstDayOfWeek')}</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setWeekStartDay(0)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      weekStartDay === 0
                        ? 'bg-blue-600 text-white'
                        : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                    }`}
                  >
                    {t('settings.firstDaySunday')}
                  </button>
                  <button
                    onClick={() => setWeekStartDay(1)}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      weekStartDay === 1
                        ? 'bg-blue-600 text-white'
                        : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                    }`}
                  >
                    {t('settings.firstDayMonday')}
                  </button>
                </div>
              </div>
              <div>
                <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.homeTimezone')}</label>
                <select
                  value={homeTimezone}
                  onChange={e => setHomeTimezone(e.target.value)}
                  className={`w-full px-2 py-1.5 text-xs rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                >
                  {getTzOptions(homeTimezone).map(tz => (
                    <option key={tz} value={tz}>{getTzLabel(tz)}</option>
                  ))}
                </select>
                <p className={`text-[10px] ${textSecondary} mt-1 opacity-70`}>
                  {t('settings.homeTimezoneHint')}
                </p>
              </div>
            </div>
        </>
      ),
    },
    // Windows desktop: keep running in the tray, open at login (electron/backgroundMode.ts).
    desktopBackground: {
      show: desktopBackgroundSupported(),
      node: <DesktopBackgroundSetting />,
    },
    globalShortcut: {
      show: ['darwin', 'win32'].includes(window.electronAPI?.platform),
      node: (
        <>
            {['darwin', 'win32'].includes(window.electronAPI?.platform) && (<>

            {/* Global Shortcut — the desktop platforms with a tray popup (macOS, Windows) */}
            <div className="space-y-3">
              <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                <Key size={16} className={textSecondary} />
                {t('settings.globalShortcuts')}
              </h4>
              <p className={`text-sm ${textSecondary}`}>
                {t('settings.globalShortcutsHint')}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  placeholder={t('settings.globalShortcutsPlaceholder')}
                  value={trayHotkey}
                  onKeyDown={handleHotkeyRecord}
                  className={`flex-1 px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'} text-sm cursor-pointer font-mono`}
                />
                {trayHotkey && (
                  <button
                    onClick={clearHotkey}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`}
                  >
                    {t('common.clear')}
                  </button>
                )}
              </div>
              <p className={`text-sm ${textSecondary} mt-3`}>
                {t('settings.globalShortcutsMainWindowHint')}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  placeholder={t('settings.globalShortcutsPlaceholder')}
                  value={mainWindowHotkey}
                  onKeyDown={handleMainWindowHotkeyRecord}
                  className={`flex-1 px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'} text-sm cursor-pointer font-mono`}
                />
                {mainWindowHotkey && (
                  <button
                    onClick={clearMainWindowHotkey}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`}
                  >
                    {t('common.clear')}
                  </button>
                )}
              </div>
            </div>
            </>)}
        </>
      ),
    },
    sound: {
      show: true,
      node: (
        <>
            {/* Sound Section */}
            <div className="space-y-3">
              <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                <Bell size={16} className={textSecondary} />
                {t('settings.sound')}
              </h4>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={soundEnabled}
                    onChange={(e) => setSoundEnabled(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${soundEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${soundEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>{t('settings.enableUISounds')}</span>
              </label>
            </div>
        </>
      ),
    },
    // New tasks' length when none is given (#2367), on this device.
    defaultDuration: {
      show: true,
      node: <DefaultDurationSetting />,
    },
    followUpTag: {
      show: true,
      node: (
        <>
            <FollowUpTagSetting />
        </>
      ),
    },
    weather: {
      show: true,
      node: (
        <>
            {!isMobile && (<>

            {/* Weather — desktop and tablet (a tablet in landscape
                already counted as desktop here; portrait now matches).
                A phone shows the Location block below instead. */}
            <div className="space-y-3">
              <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                <Thermometer size={16} className={textSecondary} />
                {t('settings.weather')}
              </h4>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input type="checkbox" checked={weatherEnabled} onChange={(e) => setWeatherEnabled(e.target.checked)} className="sr-only" />
                  <div className={`w-10 h-6 rounded-full transition-colors ${weatherEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${weatherEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>{t('settings.showWeatherInHeader')}</span>
              </label>
              {weatherEnabled && (
                <>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.weatherZipLabel')}</label>
                    <input
                      type="text"
                      placeholder={t('settings.weatherLocationPlaceholder', { defaultValue: 'e.g. 90210 or Seattle' })}
                      value={weatherZip}
                      onChange={(e) => setWeatherZip(e.target.value)}
                      onBlur={() => fetchWeather()}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                      className={`w-48 px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.weatherTempUnit')}</label>
                    <div className="flex gap-2">
                      <button onClick={() => { setWeatherTempUnit('fahrenheit'); setTimeout(fetchWeather, 100); }} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${weatherTempUnit === 'fahrenheit' ? 'bg-blue-600 text-white' : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`}`}>°F</button>
                      <button onClick={() => { setWeatherTempUnit('celsius'); setTimeout(fetchWeather, 100); }} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${weatherTempUnit === 'celsius' ? 'bg-blue-600 text-white' : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`}`}>°C</button>
                    </div>
                  </div>
                </>
              )}
            </div>
            </>)}
            {isMobile && (<>
            {/* Location. The Day Dial's sunrise, sunset, moon and hourly weather,
                in the app and on the home-screen widget, are computed for this
                place; without it the dial draws an unlit sky. The same field,
                geocode and unit as the Weather block above,
                without the header toggle: nothing on a phone renders header
                weather, and useWeather geocodes regardless of that toggle. */}
            <div className="space-y-2">
              <label htmlFor="mobile-settings-location" className={`font-medium ${textPrimary} flex items-center gap-2`}>
                <MapPin size={16} className={textSecondary} />
                {t('settings.location')}
              </label>
              <p className={`text-xs ${textSecondary}`}>{t('settings.locationHelp')}</p>
              <input
                id="mobile-settings-location"
                type="text"
                placeholder={t('settings.weatherLocationPlaceholder', { defaultValue: 'e.g. 90210 or Seattle' })}
                value={weatherZip}
                onChange={(e) => setWeatherZip(e.target.value)}
                onBlur={() => fetchWeather()}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                className={`w-full px-3 py-2 text-sm rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
              />
              <div className={`text-xs ${textSecondary}`}>{t('settings.weatherTempUnit')}</div>
              <div className="flex gap-2">
                {[{ value: 'fahrenheit', label: '°F' }, { value: 'celsius', label: '°C' }].map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => { setWeatherTempUnit(value); setTimeout(fetchWeather, 100); }}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                      weatherTempUnit === value
                        ? 'bg-blue-600 text-white border-blue-600'
                        : `${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-stone-300'} ${textPrimary}`
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            </>)}
        </>
      ),
    },
    dailyContent: {
      show: !isMobile && !isTablet,
      node: (
        <>
            {!isMobile && !isTablet && (<>

            {/* Daily Content — desktop only */}
            <div className="space-y-3">
              <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                <Newspaper size={16} className={textSecondary} />
                {t('settings.dailyContent')}
              </h4>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input type="checkbox" checked={dailyContentEnabled} onChange={(e) => setDailyContentEnabled(e.target.checked)} className="sr-only" />
                  <div className={`w-10 h-6 rounded-full transition-colors ${dailyContentEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${dailyContentEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>{t('settings.showDailyContent')}</span>
              </label>
            </div>

            </>)}
        </>
      ),
    },
    inbox: {
      show: true,
      node: (
        <>
            {/* Inbox */}
            <div className="space-y-3">
              <div className={`font-medium ${textPrimary} flex items-center gap-2`}>
                <Archive size={16} className={textSecondary} />
                {t('settings.inbox')}
              </div>
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.inboxAutoArchive')}</label>
                <select
                  value={inboxAutoArchiveDays}
                  onChange={(e) => setInboxAutoArchiveDays(Number(e.target.value))}
                  className={`px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                >
                  <option value={0}>{t('settings.inboxArchiveNever')}</option>
                  <option value={7}>{t('settings.inboxArchive7')}</option>
                  <option value={14}>{t('settings.inboxArchive14')}</option>
                  <option value={30}>{t('settings.inboxArchive30')}</option>
                  <option value={60}>{t('settings.inboxArchive60')}</option>
                </select>
              </div>
              {/* Recycle Bin auto-empty (#2141). The purge writes deletion
                  tombstones, so it reaches every synced device's bin. */}
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.binAutoEmpty')}</label>
                <select
                  value={binAutoEmptyDays}
                  onChange={(e) => setBinAutoEmptyDays(Number(e.target.value))}
                  className={`px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                >
                  {BIN_AUTO_EMPTY_CHOICES.map(days => (
                    <option key={days} value={days}>
                      {days === 0 ? t('settings.inboxArchiveNever') : t('settings.binAutoEmptyAfter', { days })}
                    </option>
                  ))}
                </select>
                <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.binAutoEmptyHint')}</p>
              </div>
            </div>
        </>
      ),
    },
  };
}
