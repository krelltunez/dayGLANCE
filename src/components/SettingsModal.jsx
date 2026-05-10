import React, { useState } from 'react';
import { Activity, Archive, BarChart3, Bell, BookOpen, BrainCircuit, CalendarDays, CheckCircle, CheckSquare, ChevronDown, Clock, Cloud, ExternalLink, Flag, FolderOpen, Key, LayoutGrid, Loader, MapPin, Mic, Moon, Newspaper, RefreshCw, Server, Settings, Sparkles, Sun, Target, Thermometer, Upload, Wifi, WifiOff, X, Zap } from 'lucide-react';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import CloudSyncSettingsForm from './CloudSyncSettingsForm.jsx';
import { cloudSyncProviders } from '../utils/cloudSyncProviders.js';
import { getStorageUsage } from '../utils/storage.js';
import { testConnection, PROVIDER_MODELS, PROVIDER_LABELS } from '../ai.js';
import { isNativeAndroid, isNativeApp, nativeGetCalendars } from '../native.js';
import { isFileSystemAccessSupported, requestVaultAccess, disconnectVault } from '../obsidian.js';

const SettingsModal = () => {
  const {
    showSettings, setShowSettings,
    collapsedSettings, toggleSettingsSection,
    updateInfo, setUpdateInfo, updateDismissedVersion, setUpdateDismissedVersion,
    darkMode,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    use24HourClock, setUse24HourClock,
    inboxAutoArchiveDays, setInboxAutoArchiveDays,
    weekStartDay, setWeekStartDay,
    weekTimelineStartHour, setWeekTimelineStartHour,
    soundEnabled, setSoundEnabled,
    setOnboardingProgress,
    isMobile, isTablet,
    weatherZip, setWeatherZip, fetchWeather, weatherTempUnit, setWeatherTempUnit,
    weatherEnabled, setWeatherEnabled,
    dailyContentEnabled, setDailyContentEnabled,
    setTasks, setUnscheduledTasks,
    dailyNoteTemplate, setDailyNoteTemplate,
    defaultView, setDefaultView,
    dayViewMode, setDayViewMode,
    weekViewMode, setWeekViewMode,
    canShowViewCycler,
    glancePage, setGlancePage,
  } = useDayPlannerCtx();
  const {
    handleFileUpload,
    cloudSyncConfig, setCloudSyncConfig, cloudSyncTest, cloudSyncLastSynced,
    cloudSyncStatus, cloudSyncError,
    syncKeyReady, setSyncKeyReady,
    calSyncConfigured, syncUrl, setSyncUrl,
    showCalendarUrlHint, setShowCalendarUrlHint,
    calendarUrlAuth, setCalendarUrlAuth,
    taskCalendarUrl, setTaskCalendarUrl, taskCalendarAuth, setTaskCalendarAuth,
    syncRetentionDays, setSyncRetentionDays,
    syncAll, isSyncing, calSyncLastSynced,
    availableCalendars, setAvailableCalendars, calendarFilter, setCalendarFilter,
    obsidianConfig, setObsidianConfig, obsidianSyncStatus, obsidianLastSynced, setObsidianLastSynced,
    obsidianVaultHandleRef,
    performObsidianSync,
    trmnlConfig, setTrmnlConfig, trmnlSyncStatus, trmnlLastSynced, performTrmnlSync,
  } = useSyncCtx();
  const {
    habitsEnabled, setHabitsEnabled,
    routinesEnabled, setRoutinesEnabled,
    goalsProjectsEnabled, setGoalsProjectsEnabled,
    aiConfig, setAiConfig,
    aiConnectionStatus, setAiConnectionStatus, aiConnectionMessage, setAiConnectionMessage,
    aiOllamaHelp, setAiOllamaHelp,
  } = useFeaturesCtx();

  const currentProvider = cloudSyncConfig?.provider || 'nextcloud';
  const provider = cloudSyncProviders[currentProvider];
  const storageUsage = getStorageUsage();
  const storageWarning = storageUsage.totalBytes > 4 * 1024 * 1024;

  const [trayHotkey, setTrayHotkey] = useState(() => localStorage.getItem('dg-tray-hotkey') || '');
  const [mainWindowHotkey, setMainWindowHotkey] = useState(() => localStorage.getItem('dg-main-window-hotkey') || '');

  const makeHotkeyRecorder = (storageKey, stateSetter, apiMethod) => (e) => {
    e.preventDefault();
    const ignored = new Set(['Meta', 'Shift', 'Alt', 'Control']);
    if (ignored.has(e.key)) return;
    const mods = [];
    if (e.metaKey) mods.push('Cmd');
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

  return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
            <div
              className={`${cardBg} rounded-lg shadow-xl ${borderClass} border max-w-md lg:max-w-3xl w-full mx-4 max-h-[85vh] overflow-y-auto`}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <Settings size={20} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className={`text-lg font-semibold ${textPrimary}`}>Settings</h3>
                </div>

                {updateInfo && (
                  <div className={`mb-4 p-3 rounded-lg border ${darkMode ? 'bg-blue-900/20 border-blue-800' : 'bg-blue-50 border-blue-200'}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className={`text-sm font-medium ${darkMode ? 'text-blue-300' : 'text-blue-800'}`}>
                          Update available: v{updateInfo.latestVersion}
                        </div>
                        <div className={`text-xs mt-1 ${darkMode ? 'text-blue-400/70' : 'text-blue-600/70'}`}>
                          You're on v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '?'}
                        </div>
                        <div className={`text-xs mt-2 space-y-1 ${darkMode ? 'text-blue-300/80' : 'text-blue-700/80'}`}>
                          <div><strong>Vercel / Web:</strong> Refresh the page to update</div>
                          <div><strong>Docker:</strong> <code className={`text-[11px] px-1 py-0.5 rounded ${darkMode ? 'bg-blue-900/50' : 'bg-blue-100'}`}>docker compose pull && docker compose up -d</code></div>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          <a
                            href={updateInfo.releaseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`text-xs font-medium ${darkMode ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} flex items-center gap-1`}
                          >
                            <ExternalLink size={12} />
                            Release notes
                          </a>
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          setUpdateDismissedVersion(updateInfo.latestVersion);
                          localStorage.setItem('dayglance-update-dismissed', updateInfo.latestVersion);
                          setUpdateInfo(null);
                        }}
                        className={`p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 flex-shrink-0`}
                        title="Dismiss"
                      >
                        <X size={14} className={darkMode ? 'text-blue-400' : 'text-blue-600'} />
                      </button>
                    </div>
                  </div>
                )}

                <div className="lg:grid lg:grid-cols-2 lg:gap-6 space-y-6 lg:space-y-0">
                  {/* Left column */}
                  <div className="space-y-6">

                    {/* View Defaults Section (only when the cycler is available) */}
                    {canShowViewCycler && (
                      <div className="space-y-3">
                        <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                          <LayoutGrid size={16} className={textSecondary} />
                          View defaults
                        </h4>
                        <div>
                          <label className={`block text-xs ${textSecondary} mb-1.5`}>Default view on load</label>
                          <div className="flex gap-2">
                            {['multi', 'day', 'week'].map(v => (
                              <button
                                key={v}
                                onClick={() => setDefaultView(v)}
                                className={`px-3 py-1.5 text-xs rounded-lg transition-colors capitalize ${
                                  defaultView === v
                                    ? 'bg-blue-600 text-white'
                                    : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                                }`}
                              >
                                {v === 'multi' ? 'Multi-day' : v === 'day' ? 'Day' : 'Week'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className={`block text-xs ${textSecondary} mb-1.5`}>Day view mode</label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setDayViewMode('calendar-day')}
                              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                                dayViewMode === 'calendar-day'
                                  ? 'bg-blue-600 text-white'
                                  : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                              }`}
                            >
                              Calendar day
                            </button>
                            <button
                              onClick={() => setDayViewMode('rolling-24')}
                              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                                dayViewMode === 'rolling-24'
                                  ? 'bg-blue-600 text-white'
                                  : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                              }`}
                            >
                              Rolling 24h
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className={`block text-xs ${textSecondary} mb-1.5`}>Week view mode</label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => setWeekViewMode('strict')}
                              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                                weekViewMode === 'strict'
                                  ? 'bg-blue-600 text-white'
                                  : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                              }`}
                            >
                              Strict week
                            </button>
                            <button
                              onClick={() => setWeekViewMode('rolling')}
                              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                                weekViewMode === 'rolling'
                                  ? 'bg-blue-600 text-white'
                                  : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                              }`}
                            >
                              Rolling 7 days
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className={`block text-xs ${textSecondary} mb-1.5`}>Week timeline start</label>
                          <div className="flex flex-wrap gap-2">
                            {[0, 4, 5, 6, 7].map(h => (
                              <button
                                key={h}
                                onClick={() => setWeekTimelineStartHour(h)}
                                className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                                  weekTimelineStartHour === h
                                    ? 'bg-blue-600 text-white'
                                    : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                                }`}
                              >
                                {h === 0 ? '12am' : `${h}am`}
                              </button>
                            ))}
                          </div>
                        </div>
                        {habitsEnabled && goalsProjectsEnabled && (
                          <div>
                            <label className={`block text-xs ${textSecondary} mb-1.5`}>GLANCE default</label>
                            <div className="flex gap-2">
                              {[{ value: 0, label: 'Habits' }, { value: 1, label: 'Goals' }].map(({ value, label }) => (
                                <button
                                  key={value}
                                  onClick={() => setGlancePage(value)}
                                  className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                                    glancePage === value
                                      ? 'bg-blue-600 text-white'
                                      : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
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

                    {canShowViewCycler && <hr className={borderClass} />}

                    {/* Localization Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Clock size={16} className={textSecondary} />
                        Localization
                      </h4>
                      <div>
                        <label className={`block text-xs ${textSecondary} mb-1.5`}>Clock format</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setUse24HourClock(false)}
                            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                              !use24HourClock
                                ? 'bg-blue-600 text-white'
                                : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                            }`}
                          >
                            12-hour
                          </button>
                          <button
                            onClick={() => setUse24HourClock(true)}
                            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                              use24HourClock
                                ? 'bg-blue-600 text-white'
                                : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                            }`}
                          >
                            24-hour
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className={`block text-xs ${textSecondary} mb-1.5`}>First day of week</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setWeekStartDay(0)}
                            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                              weekStartDay === 0
                                ? 'bg-blue-600 text-white'
                                : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                            }`}
                          >
                            Sunday
                          </button>
                          <button
                            onClick={() => setWeekStartDay(1)}
                            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                              weekStartDay === 1
                                ? 'bg-blue-600 text-white'
                                : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                            }`}
                          >
                            Monday
                          </button>
                        </div>
                      </div>
                    </div>

                    {window.electronAPI?.platform === 'darwin' && (<>
                    <hr className={borderClass} />

                    {/* Global Shortcut — macOS only */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Key size={16} className={textSecondary} />
                        Global Shortcuts
                      </h4>
                      <p className={`text-sm ${textSecondary}`}>
                        Open the quick-add popup from anywhere on your Mac.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          placeholder="Click, then press shortcut…"
                          value={trayHotkey}
                          onKeyDown={handleHotkeyRecord}
                          className={`flex-1 px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'} text-sm cursor-pointer font-mono`}
                        />
                        {trayHotkey && (
                          <button
                            onClick={clearHotkey}
                            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <p className={`text-sm ${textSecondary} mt-3`}>
                        Show the main app window from anywhere on your Mac.
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          placeholder="Click, then press shortcut…"
                          value={mainWindowHotkey}
                          onKeyDown={handleMainWindowHotkeyRecord}
                          className={`flex-1 px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder-gray-500' : 'bg-white text-stone-900 placeholder-stone-400'} text-sm cursor-pointer font-mono`}
                        />
                        {mainWindowHotkey && (
                          <button
                            onClick={clearMainWindowHotkey}
                            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`}
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    </>)}

                    <hr className={borderClass} />

                    {/* Sound Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Bell size={16} className={textSecondary} />
                        Sound
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
                        <span className={`text-sm ${textPrimary}`}>Enable UI sounds</span>
                      </label>
                    </div>

                    {!isMobile && !isTablet && (<>
                    <hr className={borderClass} />

                    {/* Weather — desktop only */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Thermometer size={16} className={textSecondary} />
                        Weather
                      </h4>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input type="checkbox" checked={weatherEnabled} onChange={(e) => setWeatherEnabled(e.target.checked)} className="sr-only" />
                          <div className={`w-10 h-6 rounded-full transition-colors ${weatherEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${weatherEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                          </div>
                        </div>
                        <span className={`text-sm ${textPrimary}`}>Show weather in header</span>
                      </label>
                      {weatherEnabled && (
                        <>
                          <div>
                            <label className={`block text-sm ${textSecondary} mb-1`}>ZIP code or city name</label>
                            <input
                              type="text"
                              placeholder="e.g. 90210 or Seattle"
                              value={weatherZip}
                              onChange={(e) => setWeatherZip(e.target.value)}
                              onBlur={() => fetchWeather()}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
                              className={`w-48 px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                            />
                          </div>
                          <div>
                            <label className={`block text-sm ${textSecondary} mb-1`}>Temperature unit</label>
                            <div className="flex gap-2">
                              <button onClick={() => { setWeatherTempUnit('fahrenheit'); setTimeout(fetchWeather, 100); }} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${weatherTempUnit === 'fahrenheit' ? 'bg-blue-600 text-white' : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`}`}>°F</button>
                              <button onClick={() => { setWeatherTempUnit('celsius'); setTimeout(fetchWeather, 100); }} className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${weatherTempUnit === 'celsius' ? 'bg-blue-600 text-white' : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`}`}>°C</button>
                            </div>
                          </div>
                        </>
                      )}
                    </div>

                    <hr className={borderClass} />

                    {/* Daily Content — desktop only */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Newspaper size={16} className={textSecondary} />
                        Daily Content
                      </h4>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input type="checkbox" checked={dailyContentEnabled} onChange={(e) => setDailyContentEnabled(e.target.checked)} className="sr-only" />
                          <div className={`w-10 h-6 rounded-full transition-colors ${dailyContentEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${dailyContentEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                          </div>
                        </div>
                        <span className={`text-sm ${textPrimary}`}>Show daily tips &amp; quotes in header</span>
                      </label>
                    </div>

                    </>)}

                    <hr className={borderClass} />

                    {/* Goals & Projects Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Flag size={16} className={textSecondary} />
                        Goals &amp; Projects
                      </h4>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={goalsProjectsEnabled}
                            onChange={(e) => { if (e.target.checked) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setGoalsProjectsEnabled(e.target.checked); }}
                            className="sr-only"
                          />
                          <div className={`w-10 h-6 rounded-full transition-colors ${goalsProjectsEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${goalsProjectsEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                          </div>
                        </div>
                        <span className={`text-sm ${textPrimary}`}>Enable goals &amp; projects</span>
                      </label>
                    </div>

                    <hr className={borderClass} />

                    {/* Routines Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Sparkles size={16} className={textSecondary} />
                        Routines
                      </h4>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={routinesEnabled}
                            onChange={(e) => { if (e.target.checked) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setRoutinesEnabled(e.target.checked); }}
                            className="sr-only"
                          />
                          <div className={`w-10 h-6 rounded-full transition-colors ${routinesEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${routinesEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                          </div>
                        </div>
                        <span className={`text-sm ${textPrimary}`}>Enable routines</span>
                      </label>
                    </div>

                    <hr className={borderClass} />

                    {/* Habit Tracking Section */}
                    <div className="space-y-3">
                      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Activity size={16} className={textSecondary} />
                        Habit Tracking
                      </h4>
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={habitsEnabled}
                            onChange={(e) => { if (e.target.checked) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setHabitsEnabled(e.target.checked); }}
                            className="sr-only"
                          />
                          <div className={`w-10 h-6 rounded-full transition-colors ${habitsEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${habitsEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                          </div>
                        </div>
                        <span className={`text-sm ${textPrimary}`}>Enable habit tracking</span>
                      </label>
                    </div>

                    <hr className={borderClass} />

                    {/* Inbox */}
                    <div className="space-y-3">
                      <div className={`font-medium ${textPrimary} flex items-center gap-2`}>
                        <Archive size={16} className={textSecondary} />
                        Inbox
                      </div>
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>Auto-archive completed Inbox tasks</label>
                        <select
                          value={inboxAutoArchiveDays}
                          onChange={(e) => setInboxAutoArchiveDays(Number(e.target.value))}
                          className={`px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                        >
                          <option value={0}>Never</option>
                          <option value={7}>After 7 days</option>
                          <option value={14}>After 14 days</option>
                          <option value={30}>After 30 days</option>
                          <option value={60}>After 60 days</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Right column — integrations (side-by-side on desktop, stacked below on tablet) */}
                  <div className={`space-y-6 lg:border-l lg:pl-6 ${borderClass}`}>
                    <hr className={`${borderClass} lg:hidden`} />
                    {/* Cloud Sync Section */}
                    <div className="space-y-3">
                      <button onClick={() => toggleSettingsSection('cloudSync')} className={`font-medium ${textPrimary} flex items-center gap-2 w-full text-left`}>
                        <Cloud size={16} className={textSecondary} />
                        Cloud Sync
                        {cloudSyncConfig?.enabled && <span className="mr-1 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
                        <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsedSettings.cloudSync ? '' : 'rotate-180'}`} />
                      </button>
                      {!collapsedSettings.cloudSync && (<>
                      <p className={`${textSecondary} text-xs`}>
                        Sync all your data (tasks, inbox, routines, settings) as a JSON file to your cloud storage.
                      </p>
                      <CloudSyncSettingsForm
                        darkMode={darkMode}
                        textPrimary={textPrimary}
                        textSecondary={textSecondary}
                        borderClass={borderClass}
                        hoverBg={hoverBg}
                        cloudSyncConfig={cloudSyncConfig}
                        setCloudSyncConfig={setCloudSyncConfig}
                        cloudSyncTest={cloudSyncTest}
                        provider={provider}
                        currentProvider={currentProvider}
                        onClose={() => setShowSettings(false)}
                        cloudSyncLastSynced={cloudSyncLastSynced}
                        cloudSyncStatus={cloudSyncStatus}
                        cloudSyncError={cloudSyncError}
                        onSyncKeyReady={(ready) => setSyncKeyReady(ready)}
                      />
                      </>)}
                    </div>

                    <hr className={borderClass} />

                    {/* Calendar Sync Section - wide screens */}
                    <div className="space-y-3">
                      <button onClick={() => toggleSettingsSection('calSync')} className={`font-medium ${textPrimary} flex items-center gap-2 w-full text-left`}>
                        <RefreshCw size={16} className={textSecondary} />
                        Calendar Sync
                        {calSyncConfigured && <span className="mr-1 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
                        <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsedSettings.calSync ? '' : 'rotate-180'}`} />
                      </button>
                      {!collapsedSettings.calSync && (<>
                      {!isNativeApp() && (
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>
                          Calendar URL (iCal/CalDAV)
                        </label>
                        <input
                          type="url"
                          placeholder="https://nextcloud.example.com/remote.php/dav/calendars/user/calendar-name/?export"
                          value={syncUrl}
                          onChange={(e) => setSyncUrl(e.target.value.replace(/^webcal:\/\//i, 'https://'))}
                          onPaste={(e) => { const text = e.clipboardData.getData('text'); if (/^webcal:\/\//i.test(text)) { e.preventDefault(); setSyncUrl(text.replace(/^webcal:\/\//i, 'https://')); } }}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                        />
                        <p className={`text-xs ${textSecondary} mt-1`}>
                          {showCalendarUrlHint
                            ? <>Paste any public ICS/iCal URL here. <strong>Google Calendar:</strong> Settings → [your calendar] → "Secret address in iCal format". <strong>Outlook:</strong> Settings → View all → Calendar → Shared calendars → Publish → ICS link. <strong>Nextcloud (public):</strong> Calendar → Settings → Copy the public link. <strong>Nextcloud (private):</strong> use the internal CalDAV URL with ?export appended (e.g. …/remote.php/dav/calendars/user/personal/?export) and enter credentials below. <button onClick={() => setShowCalendarUrlHint(false)} className="underline">Show less</button></>
                            : <>Where do I find this URL? <button onClick={() => setShowCalendarUrlHint(true)} className="underline">Show more</button></>
                          }
                        </p>
                      </div>
                      )}
                      {!isNativeApp() && syncUrl && (
                        <div className={`space-y-2 pl-3 border-l-2 ${darkMode ? 'border-gray-600' : 'border-stone-300'}`}>
                          <p className={`text-xs font-medium ${textSecondary}`}>Basic auth (optional — for private calendars)</p>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className={`block text-xs ${textSecondary} mb-1`}>Username</label>
                              <input
                                type="text"
                                placeholder="username"
                                value={calendarUrlAuth.username}
                                onChange={(e) => setCalendarUrlAuth(prev => ({ ...prev, username: e.target.value }))}
                                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
                              />
                            </div>
                            <div className="flex-1">
                              <label className={`block text-xs ${textSecondary} mb-1`}>Password</label>
                              <input
                                type="password"
                                placeholder="password"
                                value={calendarUrlAuth.password}
                                onChange={(e) => setCalendarUrlAuth(prev => ({ ...prev, password: e.target.value }))}
                                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                      {isNativeApp() && (
                        <p className={`text-xs ${textSecondary}`}>
                          Calendar events are read from your device accounts. Use the Device Calendars section below to choose which calendars to show.
                        </p>
                      )}
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>
                          Task Calendar URL (iCal/CalDAV)
                        </label>
                        <input
                          type="url"
                          placeholder="https://nextcloud.example.com/remote.php/dav/calendars/user/tasks/?export"
                          value={taskCalendarUrl}
                          onChange={(e) => setTaskCalendarUrl(e.target.value.replace(/^webcal:\/\//i, 'https://'))}
                          onPaste={(e) => { const text = e.clipboardData.getData('text'); if (/^webcal:\/\//i.test(text)) { e.preventDefault(); setTaskCalendarUrl(text.replace(/^webcal:\/\//i, 'https://')); } }}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                        />
                        <p className={`text-xs ${textSecondary} mt-1`}>
                          Tasks appear with striped pattern; completion state persists across syncs
                        </p>
                      </div>
                      {taskCalendarUrl && (
                        <div className={`space-y-2 pl-3 border-l-2 ${darkMode ? 'border-gray-600' : 'border-stone-300'}`}>
                          <p className={`text-xs font-medium ${textSecondary}`}>Basic auth / sync completions back (optional)</p>
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <label className={`block text-xs ${textSecondary} mb-1`}>Username</label>
                              <input
                                type="text"
                                placeholder="username"
                                value={taskCalendarAuth.username}
                                onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, username: e.target.value }))}
                                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
                              />
                            </div>
                            <div className="flex-1">
                              <label className={`block text-xs ${textSecondary} mb-1`}>App Password</label>
                              <input
                                type="password"
                                placeholder="app-password"
                                value={taskCalendarAuth.appPassword}
                                onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, appPassword: e.target.value }))}
                                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
                              />
                            </div>
                          </div>
                          <div>
                            <label className={`block text-xs ${textSecondary} mb-1`}>CalDAV Base URL</label>
                            <input
                              type="url"
                              placeholder="https://cloud.example.com/remote.php/dav/calendars/user/personal/"
                              value={taskCalendarAuth.caldavBaseUrl}
                              onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, caldavBaseUrl: e.target.value }))}
                              className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
                            />
                            <p className={`text-xs ${textSecondary} mt-0.5`}>
                              For syncing completions back: the CalDAV collection URL (without ?export). In Nextcloud, the calendar ID in the URL may differ from the display name.
                            </p>
                          </div>
                          <p className={`text-xs ${textSecondary}`}>
                            Username + password fetches protected task calendars. Adding a CalDAV Base URL also syncs completion status back to your server.
                          </p>
                        </div>
                      )}
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>
                          Keep past events
                        </label>
                        <select
                          value={syncRetentionDays}
                          onChange={(e) => setSyncRetentionDays(Number(e.target.value))}
                          className={`px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                        >
                          <option value={7}>7 days</option>
                          <option value={14}>14 days</option>
                          <option value={30}>30 days</option>
                          <option value={60}>60 days</option>
                          <option value={90}>90 days</option>
                          <option value={180}>6 months</option>
                          <option value={365}>1 year</option>
                          <option value={0}>All (no limit)</option>
                        </select>
                        <p className={`text-xs ${textSecondary} mt-1`}>
                          Older imported events are dropped to save storage. Future events are always kept.
                        </p>
                      </div>
                      <button
                        onClick={() => syncAll()}
                        disabled={isSyncing || !calSyncConfigured}
                        className={`px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm ${!calSyncConfigured ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                        {isSyncing ? 'Syncing...' : 'Sync Now'}
                      </button>
                      {calSyncLastSynced && (
                        <p className={`text-xs ${textSecondary}`}>
                          Last synced: {new Date(calSyncLastSynced).toLocaleString()}
                        </p>
                      )}
                      {isNativeApp() && (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between">
                            <p className={`text-sm font-medium ${textPrimary}`}>Device Calendars</p>
                            <button onClick={() => { const cals = nativeGetCalendars(); if (cals.length > 0) setAvailableCalendars(cals); }} className={`text-xs ${textSecondary} underline`}>Refresh</button>
                          </div>
                          {availableCalendars.length === 0 ? (
                            <p className={`text-xs ${textSecondary}`}>No calendars loaded — tap Refresh, or rebuild the app if this persists.</p>
                          ) : (<>
                            <p className={`text-xs ${textSecondary}`}>Uncheck to hide calendars. Leave all checked to show everything.</p>
                            {availableCalendars.map(cal => {
                              const isChecked = calendarFilter.length === 0 || calendarFilter.includes(cal.id);
                              return (
                                <label key={cal.id} className={`flex items-center gap-2 text-sm ${textPrimary} cursor-pointer`}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => setCalendarFilter(prev => {
                                      if (prev.length === 0) return availableCalendars.map(c => c.id).filter(id => id !== cal.id);
                                      if (prev.includes(cal.id)) return prev.filter(id => id !== cal.id);
                                      const next = [...prev, cal.id];
                                      return next.length === availableCalendars.length ? [] : next;
                                    })}
                                    className="rounded accent-blue-500"
                                  />
                                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cal.color }} />
                                  <span className="flex-1 truncate">{cal.name}</span>
                                  <span className={`text-xs ${textSecondary} truncate max-w-[8rem]`}>{cal.accountName}</span>
                                </label>
                              );
                            })}
                          </>)}
                        </div>
                      )}
                      {/* iCal Import — one-time .ics file import, lives inside Calendar Sync */}
                      <div className={`pt-2 border-t ${borderClass} space-y-2`}>
                        <p className={`text-sm font-medium ${textPrimary}`}>Import .ics file</p>
                        <label className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg} text-sm ${textPrimary}`}>
                          <Upload size={14} className={textSecondary} />
                          Choose .ics file
                          <input type="file" accept=".ics" onChange={(e) => { handleFileUpload(e); setShowSettings(false); }} className="hidden" />
                        </label>
                        <p className={`text-xs ${textSecondary}`}>Import events from an iCal (.ics) file</p>
                      </div>
                      </>)}
                    </div>

                    <hr className={borderClass} />

                    {/* AI Features Section */}
                    <div className="space-y-3">
                      <button onClick={() => toggleSettingsSection('ai')} className={`font-medium ${textPrimary} flex items-center gap-2 w-full text-left`}>
                        <BrainCircuit size={16} className={aiConfig.enabled ? 'text-purple-400' : textSecondary} />
                        AI Features
                        {aiConfig.enabled && <span className="mr-1 w-2 h-2 rounded-full bg-purple-500 flex-shrink-0" />}
                        <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsedSettings.ai ? '' : 'rotate-180'}`} />
                      </button>
                      {!collapsedSettings.ai && (<>
                      <p className={`${textSecondary} text-xs`}>
                        BYO API key — all calls go directly from your browser to your provider. No data leaves your device unless you enable AI.
                      </p>

                      {/* Master toggle */}
                      <label className="flex items-center gap-3 cursor-pointer">
                        <div className="relative">
                          <input
                            type="checkbox"
                            checked={aiConfig.enabled}
                            onChange={(e) => { if (e.target.checked) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setAiConfig(prev => ({ ...prev, enabled: e.target.checked })); }}
                            className="sr-only"
                          />
                          <div className={`w-10 h-6 rounded-full transition-colors ${aiConfig.enabled ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                            <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${aiConfig.enabled ? 'translate-x-5' : 'translate-x-1'}`} />
                          </div>
                        </div>
                        <span className={`text-sm ${textPrimary}`}>Enable AI features</span>
                      </label>

                      {aiConfig.enabled && (
                        <div className="space-y-3 mt-2">
                          {/* Provider selector */}
                          <div>
                            <label className={`block text-sm ${textSecondary} mb-1`}>Provider</label>
                            <select
                              value={aiConfig.provider}
                              onChange={(e) => {
                                const provider = e.target.value;
                                const models = PROVIDER_MODELS[provider] || [];
                                setAiConfig(prev => ({
                                  ...prev,
                                  provider,
                                  model: models[0]?.id || prev.model,
                                  baseUrl: provider === 'ollama' ? (prev.baseUrl || 'http://localhost:11434') : provider === 'custom' ? prev.baseUrl : '',
                                }));
                                setAiConnectionStatus(null);
                                setAiOllamaHelp(null);
                              }}
                              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                            >
                              {Object.entries(PROVIDER_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                              ))}
                            </select>
                          </div>

                          {/* API Key */}
                          {aiConfig.provider !== 'ollama' && (
                            <div>
                              <label className={`block text-sm ${textSecondary} mb-1`}>
                                <Key size={12} className="inline mr-1" />
                                API Key
                              </label>
                              <input
                                type="password"
                                placeholder={aiConfig.provider === 'openai' ? 'sk-...' : aiConfig.provider === 'anthropic' ? 'sk-ant-...' : 'API key'}
                                value={aiConfig.apiKey}
                                onChange={(e) => {
                                  setAiConfig(prev => ({ ...prev, apiKey: e.target.value }));
                                  setAiConnectionStatus(null);
                                setAiOllamaHelp(null);
                                }}
                                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm font-mono`}
                              />
                              <p className={`text-xs ${textSecondary} mt-0.5`}>Stored in browser localStorage — keep your device secure.</p>
                            </div>
                          )}

                          {/* Base URL for Ollama/Custom */}
                          {(aiConfig.provider === 'ollama' || aiConfig.provider === 'custom') && (
                            <div>
                              <label className={`block text-sm ${textSecondary} mb-1`}>
                                <Server size={12} className="inline mr-1" />
                                {aiConfig.provider === 'ollama' ? 'Ollama URL' : 'Base URL'}
                              </label>
                              <input
                                type="url"
                                placeholder={aiConfig.provider === 'ollama' ? 'http://localhost:11434' : 'https://your-endpoint.com/v1'}
                                value={aiConfig.baseUrl}
                                onChange={(e) => setAiConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                              />
                              {aiConfig.provider === 'custom' && (
                                <p className={`text-xs ${textSecondary} mt-1`}>
                                  Common providers: OpenRouter → <code className="font-mono">https://openrouter.ai/api/v1</code> · Groq → <code className="font-mono">https://api.groq.com/openai/v1</code> · Together AI → <code className="font-mono">https://api.together.xyz/v1</code> · LM Studio → <code className="font-mono">http://localhost:1234/v1</code>
                                </p>
                              )}
                            </div>
                          )}

                          {/* Model selector */}
                          <div>
                            <label className={`block text-sm ${textSecondary} mb-1`}>Model</label>
                            {(PROVIDER_MODELS[aiConfig.provider] || []).length > 0 ? (
                              <select
                                value={aiConfig.model}
                                onChange={(e) => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                              >
                                {(PROVIDER_MODELS[aiConfig.provider] || []).map(m => (
                                  <option key={m.id} value={m.id}>{m.label}{m.recommended ? ' (Recommended)' : ''}</option>
                                ))}
                              </select>
                            ) : (
                              <input
                                type="text"
                                placeholder="Model name"
                                value={aiConfig.model}
                                onChange={(e) => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                              />
                            )}
                          </div>

                          {/* Test Connection */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={async () => {
                                  setAiConnectionStatus('testing');
                                  setAiConnectionMessage('');
                                  setAiOllamaHelp(null);
                                  const result = await testConnection(aiConfig);
                                  setAiConnectionStatus(result.success ? 'success' : 'error');
                                  setAiConnectionMessage(result.message);
                                  setAiOllamaHelp(result.ollamaHelp || null);
                                }}
                                disabled={aiConnectionStatus === 'testing'}
                                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm disabled:opacity-50"
                              >
                                {aiConnectionStatus === 'testing' ? (
                                  <Loader size={14} className="animate-spin" />
                                ) : aiConnectionStatus === 'success' ? (
                                  <Wifi size={14} />
                                ) : aiConnectionStatus === 'error' ? (
                                  <WifiOff size={14} />
                                ) : (
                                  <Wifi size={14} />
                                )}
                                {aiConnectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                              </button>
                              {aiConnectionStatus === 'success' && (
                                <span className="text-xs text-green-500">Connected</span>
                              )}
                              {aiConnectionStatus === 'error' && !aiOllamaHelp && (
                                <span className="text-xs text-red-500 truncate max-w-[180px]" title={aiConnectionMessage}>{aiConnectionMessage}</span>
                              )}
                            </div>
                            {aiOllamaHelp && (
                              <div className={`text-xs p-3 rounded-lg ${darkMode ? 'bg-red-900/30 border border-red-800/50' : 'bg-red-50 border border-red-200'}`}>
                                <p className="text-red-500 font-medium mb-1.5">{aiOllamaHelp}</p>
                                <ul className={`${textSecondary} space-y-1 ml-3 list-disc mb-2`}>
                                  <li>Ollama must be running on your computer</li>
                                  <li>CORS must be enabled for this site&apos;s origin</li>
                                  <li>Set: <code className={`text-xs px-1 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>OLLAMA_ORIGINS={window.electronAPI?.isElectron ? '*' : window.location.origin}</code></li>
                                </ul>
                                <a
                                  href="https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-purple-500 hover:text-purple-400 underline flex items-center gap-1 w-fit"
                                >
                                  Ollama setup guide <ExternalLink size={11} />
                                </a>
                              </div>
                            )}
                          </div>

                          {/* Per-feature toggles */}
                          <div className="space-y-2 mt-2">
                            <p className={`text-xs font-medium ${textSecondary}`}>Features</p>
                            {[
                              { key: 'voiceTaskInput', label: 'Voice task input', icon: <Mic size={12} /> },
                              { key: 'morningSummary', label: 'Morning summary', icon: <Sun size={12} /> },
                              { key: 'eveningReflection', label: 'Evening reflection', icon: <Moon size={12} /> },
                              { key: 'durationEstimate', label: 'Duration estimates', icon: <Sparkles size={12} /> },
                              { key: 'frameNudge', label: 'Frame nudges', icon: <Zap size={12} /> },
                              { key: 'aiReschedule', label: 'End-of-day reschedule', icon: <CalendarDays size={12} /> },
                              { key: 'aiSubtasks', label: 'AI subtask generation', icon: <CheckSquare size={12} /> },
                              { key: 'weeklySummary', label: 'Weekly summary', icon: <BarChart3 size={12} /> },
                              { key: 'smartScheduling', label: 'Smart scheduling', icon: <CalendarDays size={12} /> },
                            ].map(f => (
                              <label key={f.key} className={`flex items-center gap-2 ${f.comingSoon ? 'opacity-50 cursor-default' : 'cursor-pointer'}`}>
                                <div className="relative flex-shrink-0">
                                  <input
                                    type="checkbox"
                                    checked={f.comingSoon ? false : aiConfig.features[f.key]}
                                    onChange={(e) => {
                                      if (f.comingSoon) return;
                                      setAiConfig(prev => ({
                                        ...prev,
                                        features: { ...prev.features, [f.key]: e.target.checked }
                                      }));
                                    }}
                                    disabled={f.comingSoon}
                                    className="sr-only"
                                  />
                                  <div className={`w-8 h-4 rounded-full transition-colors ${!f.comingSoon && aiConfig.features[f.key] ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                                    <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${!f.comingSoon && aiConfig.features[f.key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                  </div>
                                </div>
                                <span className={`text-xs ${textPrimary} flex items-center gap-1.5`}>
                                  {f.icon} {f.label}
                                  {f.comingSoon && <span className={`${textSecondary} italic`}>Coming soon</span>}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                      </>)}
                    </div>

                    {(!isMobile || isNativeAndroid()) && (<>
                    <hr className={borderClass} />

                    {/* Obsidian Integration Section — desktop + Android native */}
                    <div className="space-y-3">
                      <button onClick={() => toggleSettingsSection('obsidian')} className={`font-medium ${textPrimary} flex items-center gap-2 w-full text-left`}>
                        <BookOpen size={16} className={textSecondary} />
                        Obsidian Integration
                        {obsidianConfig?.enabled && <span className="mr-1 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
                        <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsedSettings.obsidian ? '' : 'rotate-180'}`} />
                      </button>
                      {!collapsedSettings.obsidian && (<>
                      <p className={`${textSecondary} text-xs`}>
                        Import tasks and sync daily notes with your Obsidian vault.
                      </p>
                      {!isNativeAndroid() && !isFileSystemAccessSupported() && (
                        <p className={`text-xs text-amber-500`}>
                          Obsidian integration requires a Chromium-based browser (Chrome, Edge, or Brave). Firefox and Safari do not support the File System Access API.
                        </p>
                      )}
                      {isNativeAndroid() ? (
                        <div className="space-y-3">
                          <p className={`text-xs ${textSecondary}`}>
                            Vault access and daily note settings are configured in the app settings.
                          </p>
                          <button
                            onClick={() => window.DayGlanceNative.openSettings()}
                            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm"
                          >
                            <FolderOpen size={14} />
                            Open Vault Settings
                          </button>
                        </div>
                      ) : obsidianConfig?.enabled ? (
                        <div className="space-y-3">
                          <div className={`flex items-center gap-2 text-sm ${textPrimary}`}>
                            <FolderOpen size={14} className={textSecondary} />
                            <span className="truncate">{obsidianConfig.vaultName || 'Vault connected'}</span>
                            <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
                          </div>
                          <div>
                            <label className={`block text-sm ${textSecondary} mb-1`}>
                              Daily notes folder
                            </label>
                            <input
                              type="text"
                              placeholder="(vault root)"
                              value={obsidianConfig.dailyNotesPath || ''}
                              onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotesPath: e.target.value }))}
                              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                            />
                            <p className={`text-xs ${textSecondary} mt-1`}>
                              Leave empty for vault root. Common: "Daily Notes" or "journals"
                            </p>
                          </div>
                          <div>
                            <label className={`block text-sm ${textSecondary} mb-1`}>
                              New notes folder
                            </label>
                            <input
                              type="text"
                              placeholder="dayGLANCE"
                              value={obsidianConfig.newNotesFolder ?? 'dayGLANCE'}
                              onChange={(e) => setObsidianConfig(prev => ({ ...prev, newNotesFolder: e.target.value }))}
                              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                            />
                            <p className={`text-xs ${textSecondary} mt-1`}>
                              Where new notes created in dayGLANCE are saved. Leave empty for vault root.
                            </p>
                          </div>
                          <div>
                            <label className={`block text-sm ${textSecondary} mb-1`}>
                              Filename pattern
                            </label>
                            <input
                              type="text"
                              placeholder="yyyy-MM-dd"
                              value={obsidianConfig.dailyNotePattern ?? 'yyyy-MM-dd'}
                              onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotePattern: e.target.value }))}
                              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                            />
                            <p className={`text-xs ${textSecondary} mt-1`}>
                              Date pattern for daily note filenames (without .md). e.g. "yyyy-MM-dd", "dd-MM-yyyy", "MMMM dd, yyyy"
                            </p>
                          </div>
                          <div>
                            <label className={`block text-sm ${textSecondary} mb-1`}>
                              Task heading
                            </label>
                            <input
                              type="text"
                              placeholder="## Tasks"
                              value={obsidianConfig.taskHeading || ''}
                              onChange={(e) => setObsidianConfig(prev => ({ ...prev, taskHeading: e.target.value }))}
                              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                            />
                            <p className={`text-xs ${textSecondary} mt-1`}>
                              Tasks tagged <code>#obsidian</code> are added under this heading in today's daily note
                            </p>
                          </div>
                          <div>
                            <label className={`block text-sm ${textSecondary} mb-1`}>
                              Daily note template
                            </label>
                            <textarea
                              value={dailyNoteTemplate}
                              onChange={(e) => setDailyNoteTemplate(e.target.value)}
                              placeholder="Template for new daily notes..."
                              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder:text-gray-500' : 'bg-white text-stone-900 placeholder:text-stone-400'} text-sm resize-y`}
                              rows={4}
                            />
                            <p className={`text-xs ${textSecondary} mt-1`}>
                              Pre-filled when creating a new daily note
                            </p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => performObsidianSync()}
                              disabled={obsidianSyncStatus === 'syncing'}
                              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm"
                            >
                              <RefreshCw size={14} className={obsidianSyncStatus === 'syncing' ? 'animate-spin' : ''} />
                              {obsidianSyncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
                            </button>
                            <button
                              onClick={async () => {
                                await disconnectVault();
                                obsidianVaultHandleRef.current = null;
                                setObsidianConfig(null);
                                setObsidianLastSynced(null);
                                localStorage.removeItem('day-planner-obsidian-last-synced');
                                // Remove Obsidian-imported tasks
                                setTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                                setUnscheduledTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                              }}
                              className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
                            >
                              Disconnect
                            </button>
                          </div>
                          {obsidianSyncStatus === 'success' && (
                            <p className={`text-xs text-green-500`}>Sync complete</p>
                          )}
                          {obsidianSyncStatus === 'error' && (
                            <p className={`text-xs text-red-500`}>Sync failed — check console for details</p>
                          )}
                          {obsidianLastSynced && (
                            <p className={`text-xs ${textSecondary}`}>
                              Last synced: {new Date(obsidianLastSynced).toLocaleString()}
                            </p>
                          )}
                        </div>
                      ) : (
                        <button
                          onClick={async () => {
                            if (!isFileSystemAccessSupported()) {
                              alert('Your browser does not support the File System Access API. Please use a Chromium-based browser (e.g., Chrome, Edge, Brave) to connect an Obsidian vault.');
                              return;
                            }
                            const handle = await requestVaultAccess();
                            if (handle) {
                              obsidianVaultHandleRef.current = handle;
                              setObsidianConfig({ enabled: true, dailyNotesPath: '', vaultName: handle.name });
                            }
                          }}
                          className={`px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm`}
                        >
                          <FolderOpen size={14} />
                          Select Vault Folder
                        </button>
                      )}
                      </>)}
                    </div>
                    </>)}

                    <hr className={borderClass} />

                    {/* TRMNL E-Ink Dashboard Section */}
                    <div className="space-y-3">
                      <button onClick={() => toggleSettingsSection('trmnl')} className={`font-medium ${textPrimary} flex items-center gap-2 w-full text-left`}>
                        <LayoutGrid size={16} className={textSecondary} />
                        TRMNL Dashboard
                        {trmnlConfig?.enabled && <span className="mr-1 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
                        <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsedSettings.trmnl ? '' : 'rotate-180'}`} />
                      </button>
                      {!collapsedSettings.trmnl && (<>
                      <p className={`${textSecondary} text-xs`}>
                        Push your daily schedule to a <a href="https://trmnl.com" target="_blank" rel="noopener noreferrer" className="underline">TRMNL</a> e-ink display via webhook. Install the <strong>DayGLANCE</strong> recipe from the TRMNL Recipe Library to get started.
                      </p>
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>Webhook URL</label>
                        <input
                          type="url"
                          placeholder="https://usetrmnl.com/api/custom_plugins/your-uuid"
                          value={trmnlConfig?.webhookUrl || ''}
                          onChange={(e) => setTrmnlConfig(prev => ({ ...prev, webhookUrl: e.target.value }))}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                        />
                        <p className={`text-xs ${textSecondary} mt-1`}>
                          Found in your DayGLANCE recipe settings on TRMNL
                        </p>
                      </div>
                      <div>
                        <label className={`block text-sm ${textSecondary} mb-1`}>API Key (optional)</label>
                        <input
                          type="password"
                          placeholder="Bearer token"
                          value={trmnlConfig?.apiKey || ''}
                          onChange={(e) => setTrmnlConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        {trmnlConfig?.enabled ? (
                          <>
                            <button
                              onClick={() => performTrmnlSync()}
                              disabled={trmnlSyncStatus === 'syncing'}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm"
                            >
                              <RefreshCw size={14} className={trmnlSyncStatus === 'syncing' ? 'animate-spin' : ''} />
                              {trmnlSyncStatus === 'syncing' ? 'Syncing...' : 'Sync Now'}
                            </button>
                            <button
                              onClick={() => setTrmnlConfig(prev => ({ ...prev, enabled: false }))}
                              className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
                            >
                              Disable
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => {
                              if (!trmnlConfig?.webhookUrl) return;
                              setTrmnlConfig(prev => ({ ...prev, enabled: true }));
                              setTimeout(() => performTrmnlSync(), 100);
                            }}
                            disabled={!trmnlConfig?.webhookUrl}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm disabled:opacity-50"
                          >
                            <Wifi size={14} />
                            Enable & Sync
                          </button>
                        )}
                      </div>
                      {trmnlSyncStatus === 'success' && <p className="text-xs text-green-500">Data sent to TRMNL</p>}
                      {trmnlSyncStatus === 'error' && <p className="text-xs text-red-500">Sync failed — check console</p>}
                      {trmnlLastSynced && (
                        <p className={`text-xs ${textSecondary}`}>
                          Last synced: {new Date(trmnlLastSynced).toLocaleString()}
                        </p>
                      )}

                      </>)}
                    </div>

                  </div>
                </div>

                <button
                  onClick={() => setShowSettings(false)}
                  className={`w-full mt-2 px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
};

export default SettingsModal;
