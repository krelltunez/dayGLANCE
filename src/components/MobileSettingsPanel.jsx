import React from 'react';
import {
  Activity, BarChart3, Bell, BookOpen, BrainCircuit,
  CalendarDays, CheckCircle, CheckSquare, ChevronDown,
  ChevronLeft, ChevronRight, Clock, Cloud, ExternalLink,
  FolderOpen, HelpCircle, Key, Loader, Mic, Moon,
  RefreshCw, Save, Settings, Sparkles, Sun, Trash2,
  Undo2, Upload, Volume2, VolumeX, Wifi, Zap,
} from 'lucide-react';
import { isNativeAndroid, nativeGetCalendars } from '../native.js';
import { cloudSyncProviders } from '../utils/cloudSyncProviders.js';
import { testConnection, PROVIDER_MODELS, PROVIDER_LABELS } from '../ai.js';
import { isFileSystemAccessSupported, requestVaultAccess, disconnectVault } from '../obsidian.js';
import CloudSyncSettingsForm from './CloudSyncSettingsForm.jsx';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const MobileSettingsPanel = () => {
  const {
    obsidianVaultHandleRef,
    setTasks, setUnscheduledTasks,
    darkMode, setDarkMode,
    mobileSettingsView, setMobileSettingsView,
    use24HourClock, setUse24HourClock,
    collapsedSettings,
    soundEnabled, setSoundEnabled,
    setShowHelpModal,
    syncUrl, setSyncUrl,
    taskCalendarUrl, setTaskCalendarUrl,
    taskCalendarAuth, setTaskCalendarAuth,
    syncRetentionDays, setSyncRetentionDays,
    calSyncStatus, calSyncLastSynced, calSyncConfigured,
    availableCalendars, setAvailableCalendars,
    calendarFilter, setCalendarFilter,
    calendarUrlAuth, setCalendarUrlAuth,
    isSyncing,
    autoBackupConfig, setAutoBackupConfig,
    autoBackupStatus, autoBackupHistory,
    setAutoBackupRestoreConfirm,
    cloudSyncConfig, setCloudSyncConfig,
    cloudSyncStatus, cloudSyncLastSynced,
    obsidianConfig, setObsidianConfig,
    obsidianSyncStatus, obsidianLastSynced, setObsidianLastSynced,
    routinesEnabled, setRoutinesEnabled,
    habitsEnabled, setHabitsEnabled,
    aiConfig, setAiConfig,
    aiConnectionStatus, setAiConnectionStatus,
    aiConnectionMessage, setAiConnectionMessage,
    aiOllamaHelp, setAiOllamaHelp,
    setShowWeeklyReviewTimePicker, setShowMorningTimePicker,
    reminderSettings, setReminderSettings,
    dailyNoteTemplate, setDailyNoteTemplate,
    setOnboardingProgress,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg, colors,
    formatTime,
    toggleSettingsSection,
    applyReminderPreset, updateCategoryReminder,
    cloudSyncUpload, cloudSyncTest,
    syncAll, performObsidianSync, performRemoteBackup,
    loadAutoBackupHistory,
    deleteLocalAutoBackup, deleteRemoteAutoBackup,
    exportBackup, handleFileUpload, handleBackupFileSelect,
  } = useDayPlannerCtx();

  return (
<div className={`relative overflow-hidden mobile-tab-fade-in flex-1 min-h-0 overflow-y-auto`}>
  {/* Main settings view */}
  <div
    className={`px-4 py-4 space-y-4 transition-transform duration-200 ${mobileSettingsView !== 'main' ? '-translate-x-full' : 'translate-x-0'}`}
    style={{ display: mobileSettingsView !== 'main' ? 'none' : undefined }}
  >
    {/* Quick toggles */}
    <div className="grid grid-cols-3 gap-3">
      <button
        onClick={() => setDarkMode(!darkMode)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {darkMode ? <Sun size={24} className="text-amber-400" /> : <Moon size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>{darkMode ? 'Light' : 'Dark'}</span>
      </button>
      <button
        onClick={() => setSoundEnabled(!soundEnabled)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {soundEnabled ? <Volume2 size={24} className="text-green-500" /> : <VolumeX size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>Sound {soundEnabled ? 'On' : 'Off'}</span>
      </button>
      <button
        onClick={() => setUse24HourClock(!use24HourClock)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        <Clock size={24} className={textSecondary} />
        <span className={`text-xs font-medium ${textPrimary}`}>{use24HourClock ? '24h' : '12h'}</span>
      </button>
      <button
        onClick={() => { if (!habitsEnabled) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setHabitsEnabled(!habitsEnabled); }}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {habitsEnabled ? <Activity size={24} className="text-green-500" /> : <Activity size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>Habits {habitsEnabled ? 'On' : 'Off'}</span>
      </button>
      <button
        onClick={() => { if (!routinesEnabled) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setRoutinesEnabled(!routinesEnabled); }}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {routinesEnabled ? <Sparkles size={24} className="text-teal-500" /> : <Sparkles size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>Routines {routinesEnabled ? 'On' : 'Off'}</span>
      </button>
      <button
        onClick={() => setMobileSettingsView('ai')}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {aiConfig.enabled ? <BrainCircuit size={24} className="text-purple-400" /> : <BrainCircuit size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>AI {aiConfig.enabled ? 'On' : 'Off'}</span>
      </button>
    </div>

    {/* Sync buttons */}
    {(calSyncConfigured || cloudSyncConfig?.enabled || obsidianConfig?.enabled) && (
      <div className="space-y-2">
        <h3 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} px-1`}>Sync</h3>
        {calSyncConfigured && (
          <button
            onClick={() => { if (!isSyncing) syncAll(); }}
            disabled={isSyncing}
            className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3 ${isSyncing ? 'opacity-70' : ''}`}
          >
            <div className="relative">
              <RefreshCw size={20} className={`${textSecondary} ${isSyncing ? 'animate-spin' : ''}`} />
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                isSyncing ? 'bg-blue-500 animate-pulse' : calSyncStatus === 'error' ? 'bg-red-500' : 'bg-green-500'
              }`} />
            </div>
            <span className={`font-medium ${textPrimary}`}>Sync Calendars</span>
          </button>
        )}
        {cloudSyncConfig?.enabled && (
          <button
            onClick={() => cloudSyncUpload()}
            className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
          >
            <div className="relative">
              <Cloud size={20} className={`${textSecondary} ${(cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'animate-pulse' : ''}`} />
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                (cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'bg-blue-500 animate-pulse' : cloudSyncStatus === 'error' ? 'bg-red-500' : 'bg-green-500'
              }`} />
            </div>
            <span className={`font-medium ${textPrimary}`}>Cloud Sync</span>
          </button>
        )}
        {isNativeAndroid() && (
          <button
            onClick={() => setMobileSettingsView('obsidian')}
            className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
          >
            <div className="relative">
              <BookOpen size={20} className={obsidianConfig?.enabled ? 'text-purple-400' : textSecondary} />
              {obsidianConfig?.enabled && (
                <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                  obsidianSyncStatus === 'syncing' ? 'bg-blue-500 animate-pulse' : obsidianSyncStatus === 'error' ? 'bg-red-500' : 'bg-green-500'
                }`} />
              )}
            </div>
            <span className={`font-medium ${textPrimary} flex-1 text-left`}>Obsidian</span>
            <ChevronRight size={18} className={textSecondary} />
          </button>
        )}
      </div>
    )}

    {/* Stats */}
    {/* Sub-menu buttons */}
    <div className="space-y-2">
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} px-1`}>More</h3>
      <button
        onClick={() => setMobileSettingsView('app')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <Settings size={20} className={textSecondary} />
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>App Settings</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
      <button
        onClick={() => setMobileSettingsView('notifications')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <Bell size={20} className={textSecondary} />
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>Notifications</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
      <button
        onClick={() => setMobileSettingsView('backups')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <Save size={20} className={textSecondary} />
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>Backups</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
      <button
        onClick={() => setShowHelpModal(true)}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <HelpCircle size={20} className={textSecondary} />
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>Help & Feedback</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
    </div>
  </div>

  {/* App Settings sub-view */}
  {mobileSettingsView === 'app' && (() => {
    const currentProvider = cloudSyncConfig?.provider || 'nextcloud';
    const provider = cloudSyncProviders[currentProvider];
    return (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">Settings</span>
      </button>

      {/* Calendar Sync */}
      <div className="space-y-3">
        <button onClick={() => toggleSettingsSection('calSync')} className={`font-medium ${textPrimary} flex items-center gap-2 w-full text-left`}>
          <RefreshCw size={16} className={textSecondary} />
          Calendar Sync
          {calSyncConfigured && <span className="mr-1 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
          <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsedSettings.calSync ? '' : 'rotate-180'}`} />
        </button>
        {!collapsedSettings.calSync && (<>
        {!isNativeAndroid() && (
        <div>
          <label className={`block text-sm ${textSecondary} mb-1`}>Calendar URL (iCal/CalDAV)</label>
          <input
            type="url"
            placeholder="https://..."
            value={syncUrl}
            onChange={(e) => setSyncUrl(e.target.value)}
            className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
          />
        </div>
        )}
        {!isNativeAndroid() && syncUrl && (
          <div className={`space-y-2 pl-3 border-l-2 ${darkMode ? 'border-gray-600' : 'border-stone-300'}`}>
            <p className={`text-xs font-medium ${textSecondary}`}>Basic auth (optional — for private calendars)</p>
            <div>
              <label className={`block text-xs ${textSecondary} mb-1`}>Username</label>
              <input
                type="text"
                placeholder="username"
                value={calendarUrlAuth.username}
                onChange={(e) => setCalendarUrlAuth(prev => ({ ...prev, username: e.target.value }))}
                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
              />
            </div>
            <div>
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
        )}
        {isNativeAndroid() && (
          <p className={`text-xs ${textSecondary}`}>
            Calendar events are read from your device accounts. Use the Device Calendars section below to choose which calendars to show.
          </p>
        )}
        <div>
          <label className={`block text-sm ${textSecondary} mb-1`}>Task Calendar URL</label>
          <input
            type="url"
            placeholder="https://..."
            value={taskCalendarUrl}
            onChange={(e) => setTaskCalendarUrl(e.target.value)}
            className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
          />
        </div>
        {taskCalendarUrl && (
          <div className={`space-y-2 pl-3 border-l-2 ${darkMode ? 'border-gray-600' : 'border-stone-300'}`}>
            <p className={`text-xs font-medium ${textSecondary}`}>Basic auth / sync completions back (optional)</p>
            <div>
              <label className={`block text-xs ${textSecondary} mb-1`}>Username</label>
              <input
                type="text"
                placeholder="username"
                value={taskCalendarAuth.username}
                onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, username: e.target.value }))}
                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
              />
            </div>
            <div>
              <label className={`block text-xs ${textSecondary} mb-1`}>App Password</label>
              <input
                type="password"
                placeholder="app-password"
                value={taskCalendarAuth.appPassword}
                onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, appPassword: e.target.value }))}
                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
              />
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
                For syncing completions back: the CalDAV collection URL (without ?export). In Nextcloud, find the internal calendar ID via CalDAV settings — it may differ from the display name.
              </p>
            </div>
            <p className={`text-xs ${textSecondary}`}>
              Username + password fetches protected task calendars. Adding a CalDAV Base URL also syncs completion status back to your server.
            </p>
          </div>
        )}
        <div>
          <label className={`block text-sm ${textSecondary} mb-1`}>Keep past events</label>
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
            Older imported events are dropped to save storage
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
          <p className={`text-xs ${textSecondary}`}>Last synced: {new Date(calSyncLastSynced).toLocaleString()}</p>
        )}
        {isNativeAndroid() && (
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
        </>)}
      </div>

      <hr className={borderClass} />

      {/* Cloud Sync */}
      <div className="space-y-3">
        <button onClick={() => toggleSettingsSection('cloudSync')} className={`font-medium ${textPrimary} flex items-center gap-2 w-full text-left`}>
          <Cloud size={16} className={textSecondary} />
          Cloud Sync
          {cloudSyncConfig?.enabled && <span className="mr-1 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
          <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsedSettings.cloudSync ? '' : 'rotate-180'}`} />
        </button>
        {!collapsedSettings.cloudSync && (<>
        <p className={`${textSecondary} text-xs`}>Sync all your data as a JSON file to your cloud storage.</p>
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
          onClose={() => setMobileSettingsView('main')}
          cloudSyncLastSynced={cloudSyncLastSynced}
        />
        </>)}
      </div>

      <hr className={borderClass} />

      {/* iCal Import */}
      <div className="space-y-3">
        <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <Upload size={16} className={textSecondary} />
          iCal Import
        </h4>
        <label className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors text-sm`}>
          <Upload size={14} className={textSecondary} />
          Choose .ics file
          <input type="file" accept=".ics" onChange={(e) => { handleFileUpload(e); setMobileSettingsView('main'); }} className="hidden" />
        </label>
      </div>

    </div>
    );
  })()}

  {/* Notifications sub-view */}
  {mobileSettingsView === 'notifications' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">Settings</span>
      </button>

      {/* Master toggle */}
      <label className="flex items-center gap-3 cursor-pointer">
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
          {/* In-app toasts */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input type="checkbox" checked={reminderSettings.inAppToasts !== false} onChange={(e) => setReminderSettings(prev => ({ ...prev, inAppToasts: e.target.checked }))} className="sr-only" />
              <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.inAppToasts !== false ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.inAppToasts !== false ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
            </div>
            <span className={`text-sm ${textPrimary}`}>In-app toasts</span>
          </label>

          {/* Browser notifications */}
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input type="checkbox" checked={reminderSettings.browserNotifications} onChange={(e) => {
                const val = e.target.checked;
                if (val && typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
                setReminderSettings(prev => ({ ...prev, browserNotifications: val }));
              }} className="sr-only" />
              <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.browserNotifications ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.browserNotifications ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
            </div>
            <div>
              <span className={`text-sm ${textPrimary}`}>Browser notifications</span>
              <p className={`text-xs ${textSecondary}`}>
                {typeof Notification !== 'undefined'
                  ? Notification.permission === 'granted' ? 'Permission granted'
                  : Notification.permission === 'denied' ? 'Permission denied'
                  : 'Will request permission when enabled'
                  : 'Not supported'}
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
                    reminderSettings.preset === key ? 'bg-blue-600 text-white' : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
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
                {[['before15', '-15m'], ['before10', '-10m'], ['before5', '-5m'], ['atStart', 'Start'], ['atEnd', 'End']].map(([field, label]) => (
                  <button
                    key={field}
                    onClick={() => updateCategoryReminder(catKey, field, !reminderSettings.categories[catKey]?.[field])}
                    className={`px-2.5 py-1 text-xs rounded transition-colors ${
                      reminderSettings.categories[catKey]?.[field] ? 'bg-blue-600 text-white' : `${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-stone-200 text-stone-500'} ${hoverBg}`
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

          {/* Weekly Review */}
          <div className={`border-t ${borderClass} pt-4`}>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-purple-500" />
              <span className={`text-sm font-semibold ${textPrimary}`}>Weekly Review</span>
            </div>
            <label className="flex items-center gap-3 cursor-pointer mb-3">
              <div className="relative">
                <input type="checkbox" checked={reminderSettings.weeklyReview?.enabled ?? true} onChange={(e) => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, enabled: e.target.checked } }))} className="sr-only" />
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
                  <div className="flex gap-1 flex-wrap">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, i) => (
                      <button
                        key={label}
                        onClick={() => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, day: i } }))}
                        className={`px-2 py-1 text-xs rounded-full transition-colors ${
                          reminderSettings.weeklyReview.day === i ? 'bg-blue-600 text-white' : darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'
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
        </div>
      )}
    </div>
  )}

  {/* Backups sub-view */}
  {mobileSettingsView === 'backups' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">Settings</span>
      </button>

      {/* Export / Restore */}
      <div className="space-y-3">
        <button
          onClick={() => exportBackup()}
          className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
        >
          <div className="font-medium flex items-center gap-2">
            <Upload size={16} className="rotate-180" />
            Export Backup
          </div>
          <div className={`text-sm ${textSecondary}`}>Download all tasks and settings as JSON</div>
        </button>
        <label className={`block w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors cursor-pointer`}>
          <div className="font-medium flex items-center gap-2">
            <Upload size={16} />
            Restore Backup
          </div>
          <div className={`text-sm ${textSecondary}`}>Load data from a backup file</div>
          <input type="file" accept=".json" onChange={handleBackupFileSelect} className="hidden" />
        </label>
      </div>

      <hr className={borderClass} />

      {/* Auto-Backup settings inline */}
      <div className="space-y-3">
        <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <Clock size={16} className={textSecondary} />
          Auto-Backup
          {(autoBackupConfig.local.enabled || autoBackupConfig.remote.enabled) && (
            <span className="ml-auto text-xs px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">Active</span>
          )}
        </h4>
        <AutoBackupSettingsForm
          config={autoBackupConfig}
          setConfig={setAutoBackupConfig}
          status={autoBackupStatus}
          darkMode={darkMode}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
          borderClass={borderClass}
          hoverBg={hoverBg}
          onRemoteBackupNow={performRemoteBackup}
        />
      </div>

      <hr className={borderClass} />

      {/* Backup history */}
      <div className="space-y-3">
        <button
          onClick={() => { loadAutoBackupHistory(); }}
          className={`px-4 py-2 text-sm ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors`}
        >
          Load Backup History
        </button>
        {autoBackupHistory.local.length > 0 && (
          <div>
            <h4 className={`text-xs font-semibold ${textSecondary} uppercase mb-2`}>Local ({autoBackupHistory.local.length})</h4>
            <div className="space-y-1">
              {autoBackupHistory.local.map(b => (
                <div key={b.id} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${textPrimary} truncate`}>{new Date(b.timestamp).toLocaleString()}</p>
                    <p className={`text-xs ${textSecondary}`}>{b.frequency}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <button onClick={() => setAutoBackupRestoreConfirm({ type: 'local', id: b.id, timestamp: b.timestamp })} className={`p-1.5 rounded ${hoverBg}`}><Undo2 size={14} className={textSecondary} /></button>
                    <button onClick={() => deleteLocalAutoBackup(b.id)} className={`p-1.5 rounded ${hoverBg}`}><Trash2 size={14} className={textSecondary} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {autoBackupConfig.remote.enabled && autoBackupHistory.remote.length > 0 && (
          <div>
            <h4 className={`text-xs font-semibold ${textSecondary} uppercase mb-2`}>Remote ({autoBackupHistory.remote.length})</h4>
            <div className="space-y-1">
              {autoBackupHistory.remote.map(b => (
                <div key={b.filename} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${textPrimary} truncate`}>{b.lastModified ? new Date(b.lastModified).toLocaleString() : b.filename}</p>
                  </div>
                  <div className="flex items-center gap-1 ml-2 shrink-0">
                    <button onClick={() => setAutoBackupRestoreConfirm({ type: 'remote', filename: b.filename, timestamp: b.lastModified })} className={`p-1.5 rounded ${hoverBg}`}><Undo2 size={14} className={textSecondary} /></button>
                    <button onClick={() => deleteRemoteAutoBackup(b.filename)} className={`p-1.5 rounded ${hoverBg}`}><Trash2 size={14} className={textSecondary} /></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )}

  {/* AI settings sub-view */}
  {mobileSettingsView === 'ai' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">Settings</span>
      </button>

      <div className="space-y-4">
        <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <BrainCircuit size={18} className={aiConfig.enabled ? 'text-purple-400' : textSecondary} />
          AI Features
        </h4>
        <p className={`${textSecondary} text-xs`}>
          BYO API key — all calls go directly from your browser to your provider.
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
          <div className="space-y-4">
            {/* Provider */}
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
                <label className={`block text-sm ${textSecondary} mb-1`}>API Key</label>
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

            {/* Base URL */}
            {(aiConfig.provider === 'ollama' || aiConfig.provider === 'custom') && (
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>
                  {aiConfig.provider === 'ollama' ? 'Ollama URL' : 'Base URL'}
                </label>
                <input
                  type="url"
                  placeholder={aiConfig.provider === 'ollama' ? 'http://localhost:11434' : 'https://your-endpoint.com/v1'}
                  value={aiConfig.baseUrl}
                  onChange={(e) => setAiConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                />
              </div>
            )}

            {/* Model */}
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
              <div className="flex items-center gap-2 flex-wrap">
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
                  ) : (
                    <Wifi size={14} />
                  )}
                  {aiConnectionStatus === 'testing' ? 'Testing...' : 'Test Connection'}
                </button>
                {aiConnectionStatus === 'success' && (
                  <span className="text-xs text-green-500">Connected</span>
                )}
                {aiConnectionStatus === 'error' && !aiOllamaHelp && (
                  <span className="text-xs text-red-500">{aiConnectionMessage}</span>
                )}
              </div>
              {aiOllamaHelp && (
                <div className={`text-xs p-3 rounded-lg ${darkMode ? 'bg-red-900/30 border border-red-800/50' : 'bg-red-50 border border-red-200'}`}>
                  <p className="text-red-500 font-medium mb-1.5">{aiOllamaHelp}</p>
                  <ul className={`${textSecondary} space-y-1 ml-3 list-disc mb-2`}>
                    <li>Ollama must be running on your computer</li>
                    <li>CORS must be enabled for this site&apos;s origin</li>
                    <li>Set the environment variable: <code className={`text-xs px-1 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>OLLAMA_ORIGINS={window.location.origin}</code></li>
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

            <hr className={borderClass} />

            {/* Per-feature toggles */}
            <div className="space-y-3">
              <p className={`text-xs font-medium uppercase ${textSecondary}`}>Features</p>
              {[
                { key: 'voiceTaskInput', label: 'Voice task input', icon: <Mic size={14} /> },
                { key: 'morningSummary', label: 'Morning summary', icon: <Sun size={14} /> },
                { key: 'eveningReflection', label: 'Evening reflection', icon: <Moon size={14} /> },
                { key: 'durationEstimate', label: 'Duration estimates', icon: <Sparkles size={14} /> },
                { key: 'frameNudge', label: 'Frame nudges', icon: <Zap size={14} /> },
                { key: 'aiReschedule', label: 'End-of-day reschedule', icon: <CalendarDays size={14} /> },
                { key: 'aiSubtasks', label: 'AI subtask generation', icon: <CheckSquare size={14} /> },
                { key: 'weeklySummary', label: 'Weekly summary', icon: <BarChart3 size={14} /> },
                { key: 'smartScheduling', label: 'Smart scheduling', icon: <CalendarDays size={14} /> },
              ].map(f => (
                <label key={f.key} className={`flex items-center gap-3 ${f.comingSoon ? 'opacity-50 cursor-default' : 'cursor-pointer'}`}>
                  <div className="relative">
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
                    <div className={`w-9 h-5 rounded-full transition-colors ${!f.comingSoon && aiConfig.features[f.key] ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${!f.comingSoon && aiConfig.features[f.key] ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </div>
                  </div>
                  <span className={`text-sm ${textPrimary} flex items-center gap-1.5`}>
                    {f.icon} {f.label}
                    {f.comingSoon && <span className={`text-xs ${textSecondary} italic`}>Coming soon</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )}

  {/* Obsidian sub-view */}
  {mobileSettingsView === 'obsidian' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">Settings</span>
      </button>
      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
        <BookOpen size={18} className={obsidianConfig?.enabled ? 'text-purple-400' : textSecondary} />
        Obsidian Integration
      </h4>
      <p className={`text-xs ${textSecondary}`}>
        Import tasks and sync daily notes with your Obsidian vault.
      </p>
      {!isNativeAndroid() && !isFileSystemAccessSupported() && (
        <p className={`text-xs text-amber-500`}>
          Obsidian integration requires a Chromium-based browser (Chrome, Edge, or Brave). Firefox and Safari do not support the File System Access API.
        </p>
      )}
      {isNativeAndroid() ? (
        <div className="space-y-3">
          {obsidianConfig?.enabled ? (
            <div className={`flex items-center gap-2 text-sm ${textPrimary}`}>
              <FolderOpen size={14} className={textSecondary} />
              <span className="truncate">Vault connected</span>
              <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
            </div>
          ) : (
            <p className={`text-xs ${textSecondary}`}>
              No vault configured. Open settings to select your Obsidian vault folder.
            </p>
          )}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => window.DayGlanceNative.openSettings()}
              className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-stone-100 text-stone-700'}`}
            >
              <FolderOpen size={14} />
              Vault Settings
            </button>
            {obsidianConfig?.enabled && (
              <button
                onClick={() => performObsidianSync()}
                disabled={obsidianSyncStatus === 'syncing'}
                className="px-3 py-2 bg-purple-600 text-white rounded-lg flex items-center gap-2 text-sm disabled:opacity-50"
              >
                <RefreshCw size={14} className={obsidianSyncStatus === 'syncing' ? 'animate-spin' : ''} />
                {obsidianSyncStatus === 'syncing' ? 'Syncing…' : 'Sync Now'}
              </button>
            )}
          </div>
          {obsidianSyncStatus === 'success' && <p className="text-xs text-green-500">Sync complete</p>}
          {obsidianSyncStatus === 'error' && <p className="text-xs text-red-500">Sync failed — check that vault is configured</p>}
          {obsidianLastSynced && obsidianConfig?.enabled && (
            <p className={`text-xs ${textSecondary}`}>Last synced: {new Date(obsidianLastSynced).toLocaleString()}</p>
          )}
        </div>
      ) : obsidianConfig?.enabled ? (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 text-sm ${textPrimary}`}>
            <FolderOpen size={14} className={textSecondary} />
            <span className="truncate">{obsidianConfig.vaultName || 'Vault connected'}</span>
            <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
          </div>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>Daily notes folder</label>
            <input
              type="text"
              placeholder="(vault root)"
              value={obsidianConfig.dailyNotesPath || ''}
              onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotesPath: e.target.value }))}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
            />
            <p className={`text-xs ${textSecondary} mt-1`}>Leave empty for vault root. Common: "Daily Notes" or "journals"</p>
          </div>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>Daily note template</label>
            <textarea
              value={dailyNoteTemplate}
              onChange={(e) => setDailyNoteTemplate(e.target.value)}
              placeholder="Template for new daily notes..."
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white placeholder:text-gray-500' : 'bg-white text-stone-900 placeholder:text-stone-400'} text-sm resize-y`}
              rows={4}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => performObsidianSync()}
              disabled={obsidianSyncStatus === 'syncing'}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <RefreshCw size={14} className={obsidianSyncStatus === 'syncing' ? 'animate-spin' : ''} />
              {obsidianSyncStatus === 'syncing' ? 'Syncing…' : 'Sync Now'}
            </button>
            <button
              onClick={async () => {
                await disconnectVault();
                obsidianVaultHandleRef.current = null;
                setObsidianConfig(null);
                setObsidianLastSynced(null);
                localStorage.removeItem('day-planner-obsidian-last-synced');
                setTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                setUnscheduledTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
              }}
              className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
            >
              Disconnect
            </button>
          </div>
          {obsidianSyncStatus === 'success' && <p className="text-xs text-green-500">Sync complete</p>}
          {obsidianSyncStatus === 'error' && <p className="text-xs text-red-500">Sync failed — check console for details</p>}
          {obsidianLastSynced && (
            <p className={`text-xs ${textSecondary}`}>Last synced: {new Date(obsidianLastSynced).toLocaleString()}</p>
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
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm"
        >
          <FolderOpen size={14} />
          Select Vault Folder
        </button>
      )}
    </div>
  )}
</div>
  );
};

export default MobileSettingsPanel;
