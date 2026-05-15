import React, { useEffect, useRef } from 'react';
import {
  Activity, Archive, BarChart3, Bell, BookOpen, BrainCircuit,
  CalendarDays, CheckCircle, CheckSquare, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Clock, Cloud, ExternalLink,
  Footprints, FolderOpen, Globe, GripVertical, HelpCircle, Key, LayoutGrid,
  Loader, Mic, Moon, Pencil, Plus,
  Flag, RefreshCw, Save, Settings, Sparkles, Sun, Target, Trash2,
  Undo2, Upload, Volume2, VolumeX, Wifi, Zap,
} from 'lucide-react';
import { getTzLabel, getTzOptions } from '../utils/timezones.js';
import { HABIT_ICONS, HABIT_ICON_NAMES, HABIT_COLORS } from '../constants/habits.js';
import { isNativeAndroid, isNativeApp, nativeGetCalendars, nativePickVault } from '../native.js';
import { cloudSyncProviders } from '../utils/cloudSyncProviders.js';
import { testConnection, PROVIDER_MODELS, PROVIDER_LABELS } from '../ai.js';
import { isFileSystemAccessSupported, requestVaultAccess, disconnectVault, listVaultNotes } from '../obsidian.js';
import CloudSyncSettingsForm from './CloudSyncSettingsForm.jsx';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';
import FrameEditor from './FrameEditor.jsx';
import SmartSchedulePanel from './SmartSchedulePanel.jsx';
import MobileRoutinesTab from './MobileRoutinesTab.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const MobileSettingsPanel = () => {
  const {
    consumeTestPurchase, canConsumeTestPurchase,
    setTasks, setUnscheduledTasks,
    darkMode, setDarkMode,
    mobileSettingsView, setMobileSettingsView,
    use24HourClock, setUse24HourClock,
    inboxAutoArchiveDays, setInboxAutoArchiveDays,
    weekStartDay, setWeekStartDay,
    homeTimezone, setHomeTimezone,
    collapsedSettings,
    soundEnabled, setSoundEnabled,
    setShowHelpModal,
    mobileActiveTab, setMobileActiveTab,
    allTags,
    unscheduledTasks,
    getTodayStr,
    dailyNoteTemplate, setDailyNoteTemplate,
    setOnboardingProgress,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg, colors,
    formatTime,
    toggleSettingsSection,
    mobileViewMode, setMobileViewMode,
    listEndOfDayTime, setListEndOfDayTime,
    glancePage, setGlancePage,
  } = useDayPlannerCtx();
  const {
    obsidianVaultHandleRef,
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
    cloudSyncStatus, cloudSyncLastSynced, cloudSyncError,
    syncKeyReady, setSyncKeyReady,
    obsidianConfig, setObsidianConfig,
    obsidianSyncStatus, obsidianSyncError, obsidianLastSynced, setObsidianLastSynced,
    wikilinkCandidates, setWikilinkCandidates,
    cloudSyncUpload, cloudSyncTest,
    syncAll, performObsidianSync, performRemoteBackup, nativeClearVault,
    loadAutoBackupHistory,
    deleteLocalAutoBackup, deleteRemoteAutoBackup,
    exportBackup, handleFileUpload, handleBackupFileSelect,
  } = useSyncCtx();
  const {
    routinesEnabled, setRoutinesEnabled,
    todayRoutines, setDashboardSelectedChips,
    setRoutineAddingToBucket, setRoutineNewChipName,
    handleRoutinesDone,
    habitsEnabled, setHabitsEnabled,
    activeHabits, habits,
    editingHabit, setEditingHabit,
    draggedHabitIdx, setDraggedHabitIdx,
    addHabit, updateHabit, archiveHabit, deleteHabit, reorderHabits,
    addStepsHabit, addSleepHabit,
    goalsProjectsEnabled, setGoalsProjectsEnabled,
    gtdFrames,
    framesModalTab, setFramesModalTab,
    editingFrame, setEditingFrame,
    saveFrame, deleteFrame,
    smartScheduleResults, setSmartScheduleResults,
    smartScheduleLoading,
    smartScheduleError, setSmartScheduleError,
    smartScheduleAccepted, setSmartScheduleAccepted,
    runSmartSchedule, applySmartSchedule,
    aiConfig, setAiConfig,
    aiConnectionStatus, setAiConnectionStatus,
    aiConnectionMessage, setAiConnectionMessage,
    aiOllamaHelp, setAiOllamaHelp,
    setShowWeeklyReviewTimePicker, setShowMorningTimePicker,
    reminderSettings, setReminderSettings,
    applyReminderPreset, updateCategoryReminder,
  } = useFeaturesCtx();

  // Commit staged routines on unmount (e.g. user switches tabs while in routines view)
  const mobileSettingsViewRef = useRef(mobileSettingsView);
  const handleRoutinesDoneRef = useRef(handleRoutinesDone);
  useEffect(() => { mobileSettingsViewRef.current = mobileSettingsView; }, [mobileSettingsView]);
  useEffect(() => { handleRoutinesDoneRef.current = handleRoutinesDone; });
  useEffect(() => {
    return () => {
      if (mobileSettingsViewRef.current === 'routines') {
        handleRoutinesDoneRef.current();
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
<div className={`relative overflow-hidden mobile-tab-fade-in flex-1 min-h-0 overflow-y-auto`}>
  {/* Main settings view */}
  <div
    className={`px-4 py-4 space-y-4 transition-transform duration-200 ${mobileSettingsView !== 'main' ? '-translate-x-full' : 'translate-x-0'}`}
    style={{ display: mobileSettingsView !== 'main' ? 'none' : undefined }}
  >
    {/* Timezone mismatch warning */}
    {Intl.DateTimeFormat().resolvedOptions().timeZone !== homeTimezone && (
      <div className={`p-3 rounded-xl border ${darkMode ? 'bg-amber-900/20 border-amber-800' : 'bg-amber-50 border-amber-200'} flex items-start gap-2`}>
        <Globe size={14} className={`flex-shrink-0 mt-0.5 ${darkMode ? 'text-amber-400' : 'text-amber-600'}`} />
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>Timezone mismatch</div>
          <div className={`text-xs mt-0.5 ${darkMode ? 'text-amber-400/80' : 'text-amber-700/80'}`}>
            Device: <strong>{Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ')}</strong>
          </div>
          <div className={`text-xs ${darkMode ? 'text-amber-400/80' : 'text-amber-700/80'}`}>
            Home: <strong>{homeTimezone.replace(/_/g, ' ')}</strong>
          </div>
          <button
            onClick={() => setMobileSettingsView('app')}
            className={`mt-1.5 text-[10px] font-medium underline ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}
          >
            Fix in App Settings →
          </button>
        </div>
      </div>
    )}

    {/* Quick toggles */}
    <div className="grid grid-cols-3 gap-3">
      {/* Row 1: 12h/24h | First Day | Sound */}
      <button
        onClick={() => setUse24HourClock(!use24HourClock)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        <Clock size={24} className={textSecondary} />
        <span className={`text-xs font-medium ${textPrimary}`}>{use24HourClock ? '24h' : '12h'}</span>
      </button>
      <button
        onClick={() => setWeekStartDay(weekStartDay === 0 ? 1 : 0)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        <CalendarDays size={24} className={textSecondary} />
        <span className={`text-xs font-medium ${textPrimary}`}>Week: {weekStartDay === 0 ? 'Sun' : 'Mon'}</span>
      </button>
      <button
        onClick={() => setSoundEnabled(!soundEnabled)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {soundEnabled ? <Volume2 size={24} className="text-green-500" /> : <VolumeX size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>Sound {soundEnabled ? 'On' : 'Off'}</span>
      </button>
      {/* Row 2: Dark/Light | Frames | Goals */}
      <button
        onClick={() => setDarkMode(!darkMode)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {darkMode ? <Sun size={24} className="text-amber-400" /> : <Moon size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>{darkMode ? 'Light' : 'Dark'}</span>
      </button>
      <button
        onClick={() => setMobileSettingsView('frames')}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        <LayoutGrid size={24} className={mobileSettingsView === 'frames' ? 'text-blue-500' : textSecondary} />
        <span className={`text-xs font-medium ${textPrimary}`}>Frames</span>
      </button>
      <button
        onClick={() => { if (!goalsProjectsEnabled) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setGoalsProjectsEnabled(!goalsProjectsEnabled); }}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {goalsProjectsEnabled ? <Flag size={24} className="text-blue-500" /> : <Flag size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>Goals {goalsProjectsEnabled ? 'On' : 'Off'}</span>
      </button>
      {/* Row 3: Routines | Habits | AI */}
      <button
        onClick={() => {
          setDashboardSelectedChips(todayRoutines.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, startTime: r.startTime || null })));
          setRoutineAddingToBucket(null);
          setRoutineNewChipName('');
          setMobileSettingsView('routines');
        }}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        <Sparkles size={24} className={mobileSettingsView === 'routines' ? 'text-teal-500' : routinesEnabled ? 'text-teal-500' : textSecondary} />
        <span className={`text-xs font-medium ${textPrimary}`}>Routines {routinesEnabled ? 'On' : 'Off'}</span>
      </button>
      <button
        onClick={() => setMobileSettingsView('habits')}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        <Activity size={24} className={mobileSettingsView === 'habits' ? 'text-green-500' : habitsEnabled ? 'text-green-500' : textSecondary} />
        <span className={`text-xs font-medium ${textPrimary}`}>Habits {habitsEnabled ? 'On' : 'Off'}</span>
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
    {(calSyncConfigured || cloudSyncConfig?.enabled || obsidianConfig?.enabled || isNativeApp()) && (
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
            <div className="flex-1 text-left">
              <span className={`font-medium ${textPrimary}`}>Cloud Sync</span>
              {cloudSyncStatus === 'error' && cloudSyncError && (
                <p className="text-xs text-red-500 mt-0.5 leading-tight">{cloudSyncError}</p>
              )}
              {cloudSyncStatus === 'success' && cloudSyncLastSynced && (
                <p className={`text-xs ${textSecondary} mt-0.5`}>Last synced {new Date(cloudSyncLastSynced).toLocaleTimeString()}</p>
              )}
            </div>
          </button>
        )}
        {isNativeApp() && (
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
      {canConsumeTestPurchase && (
        <button
          onClick={consumeTestPurchase}
          className={`w-full ${cardBg} border ${borderClass} rounded-xl p-3 flex items-center gap-3 opacity-50`}
        >
          <RefreshCw size={16} className={textSecondary} />
          <span className={`text-sm ${textSecondary} flex-1 text-left`}>Reset test purchase</span>
        </button>
      )}
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

      {/* View default */}
      <div className="space-y-2">
        <div className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <LayoutGrid size={16} className={textSecondary} />
          View default
        </div>
        <p className={`text-xs ${textSecondary}`}>Default view for the Timeline tab</p>
        <div className="flex gap-2">
          {['grid', 'list'].map(mode => (
            <button
              key={mode}
              onClick={() => setMobileViewMode(mode)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mobileViewMode === mode
                  ? 'bg-blue-600 text-white border-blue-600'
                  : `${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-stone-300'} ${textPrimary}`
              }`}
            >
              {mode === 'grid' ? 'GRID' : 'LIST'}
            </button>
          ))}
        </div>

        {/* End of day (LIST view only) */}
        {mobileViewMode === 'list' && (
          <div className="mt-3 space-y-1.5">
            <label className={`block text-xs font-medium ${textSecondary}`}>End of day (LIST view)</label>
            <p className={`text-xs ${textSecondary} opacity-70`}>Extends the spine to this time so you can drag items there</p>
            <div className="flex flex-wrap gap-1.5">
              {[{ label: 'Off', value: null }, ...Array.from({ length: 13 }, (_, i) => {
                const totalMin = 18 * 60 + i * 30;
                const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0');
                const mm = String(totalMin % 60).padStart(2, '0');
                const val = `${hh}:${mm}`;
                return { label: formatTime(val), value: val };
              })].map(({ label, value }) => {
                const active = (listEndOfDayTime ?? null) === value;
                return (
                  <button
                    key={label}
                    onClick={() => setListEndOfDayTime(value)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-blue-600 text-white border-blue-600'
                        : `${darkMode ? 'bg-gray-700 border-gray-600 text-gray-300' : 'bg-white border-stone-300 text-stone-700'}`
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Home timezone */}
      <hr className={borderClass} />
      <div className="space-y-2">
        <div className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <Globe size={16} className={textSecondary} />
          Home timezone
        </div>
        <p className={`text-xs ${textSecondary}`}>Used to detect when your device is in a different timezone.</p>
        <select
          value={homeTimezone}
          onChange={e => setHomeTimezone(e.target.value)}
          className={`w-full px-3 py-2 text-sm rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
        >
          {getTzOptions(homeTimezone).map(tz => (
            <option key={tz} value={tz}>{getTzLabel(tz)}</option>
          ))}
        </select>
      </div>

      {/* GLANCE default */}
      {habitsEnabled && goalsProjectsEnabled && (
        <>
          <hr className={borderClass} />
          <div className="space-y-2">
            <div className={`font-medium ${textPrimary} flex items-center gap-2`}>
              <LayoutGrid size={16} className={textSecondary} />
              GLANCE default
            </div>
            <p className={`text-xs ${textSecondary}`}>Starting page of the GLANCE habits/goals carousel</p>
            <div className="flex gap-2">
              {[{ value: 0, label: 'HABITS' }, { value: 1, label: 'GOALS' }].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setGlancePage(value)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    glancePage === value
                      ? 'bg-blue-600 text-white border-blue-600'
                      : `${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-stone-300'} ${textPrimary}`
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <hr className={borderClass} />

      {/* Calendar Sync */}
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
        {!isNativeApp() && syncUrl && (
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
        {isNativeApp() && (
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
          onSyncKeyReady={(ready) => setSyncKeyReady(ready)}
        />
        </>)}
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

      {/* hyperGLANCE Sessions — independent of global enabled toggle */}
      <div className={`border-t ${borderClass} pt-4`}>
        <div className="flex items-center gap-2 mb-3">
          <Zap size={16} className="text-indigo-500" />
          <span className={`text-sm font-semibold ${textPrimary}`}>hyperGLANCE Sessions</span>
        </div>
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <div className="relative">
            <input type="checkbox" checked={reminderSettings.hyperGlance?.enabled !== false} onChange={(e) => setReminderSettings(prev => ({ ...prev, hyperGlance: { ...prev.hyperGlance, enabled: e.target.checked } }))} className="sr-only" />
            <div className={`w-10 h-6 rounded-full transition-colors ${reminderSettings.hyperGlance?.enabled !== false ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${reminderSettings.hyperGlance?.enabled !== false ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
          </div>
          <span className={`text-sm ${textPrimary}`}>Notify me at session start</span>
        </label>
        {reminderSettings.hyperGlance?.enabled !== false && (
          <div>
            <p className={`text-xs ${textSecondary} mb-1.5`}>Session reminder</p>
            <div className="flex gap-1.5 flex-wrap">
              {[[0, 'Off'], [5, '5m'], [10, '10m'], [15, '15m'], [30, '30m']].map(([mins, label]) => (
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
                {aiConfig.provider === 'custom' && (
                  <p className={`text-xs ${textSecondary} mt-1`}>
                    Common providers: OpenRouter → <code className="font-mono">https://openrouter.ai/api/v1</code> · Groq → <code className="font-mono">https://api.groq.com/openai/v1</code> · Together AI → <code className="font-mono">https://api.together.xyz/v1</code> · LM Studio → <code className="font-mono">http://localhost:1234/v1</code>
                  </p>
                )}
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
                    <li>Set the environment variable: <code className={`text-xs px-1 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>OLLAMA_ORIGINS={window.electronAPI?.isElectron ? '*' : window.location.origin}</code></li>
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
      {!isNativeApp() && !isFileSystemAccessSupported() && (
        <p className={`text-xs text-amber-500`}>
          Obsidian integration requires a Chromium-based browser (Chrome, Edge, or Brave). Firefox and Safari do not support the File System Access API.
        </p>
      )}
      {isNativeApp() ? (
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
          {/* Vault path + new notes folder — configured in native SettingsActivity */}
          <div className="flex gap-2 flex-wrap">
            {isNativeAndroid() ? (
              <button
                onClick={() => window.DayGlanceNative.openSettings()}
                className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-stone-100 text-stone-700'}`}
              >
                <FolderOpen size={14} />
                Vault Settings
              </button>
            ) : (
              <button
                onClick={() => nativePickVault()}
                className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-stone-100 text-stone-700'}`}
              >
                <FolderOpen size={14} />
                {obsidianConfig?.enabled ? 'Change Vault' : 'Connect Vault'}
              </button>
            )}
            {obsidianConfig?.enabled && (
              <>
                <button
                  onClick={() => performObsidianSync()}
                  disabled={obsidianSyncStatus === 'syncing'}
                  className="px-3 py-2 bg-purple-600 text-white rounded-lg flex items-center gap-2 text-sm disabled:opacity-50"
                >
                  <RefreshCw size={14} className={obsidianSyncStatus === 'syncing' ? 'animate-spin' : ''} />
                  {obsidianSyncStatus === 'syncing' ? 'Syncing…' : 'Sync Now'}
                </button>
                <button
                  onClick={() => {
                    nativeClearVault();
                    obsidianVaultHandleRef.current = null;
                    setObsidianConfig(null);
                    setObsidianLastSynced(null);
                    setWikilinkCandidates([]);
                    localStorage.removeItem('day-planner-obsidian-last-synced');
                    setTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                    setUnscheduledTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                  }}
                  className={`px-3 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
                >
                  Disconnect
                </button>
              </>
            )}
          </div>
          {/* Daily notes folder */}
          {obsidianConfig?.enabled && (
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
          )}
          {/* New notes folder */}
          {obsidianConfig?.enabled && (
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>New notes folder</label>
              <input
                type="text"
                placeholder="dayGLANCE"
                value={obsidianConfig.newNotesFolder ?? 'dayGLANCE'}
                onChange={(e) => setObsidianConfig(prev => ({ ...prev, newNotesFolder: e.target.value }))}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
              />
              <p className={`text-xs ${textSecondary} mt-1`}>Where new notes created in dayGLANCE are saved. Leave empty for vault root.</p>
            </div>
          )}
          {/* Filename pattern */}
          {obsidianConfig?.enabled && (
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>Filename pattern</label>
              <input
                type="text"
                placeholder="yyyy-MM-dd"
                value={obsidianConfig.dailyNotePattern ?? 'yyyy-MM-dd'}
                onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotePattern: e.target.value }))}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
              />
              <p className={`text-xs ${textSecondary} mt-1`}>Date pattern for daily note filenames (without .md). e.g. "yyyy-MM-dd", "dd-MM-yyyy", "MMMM dd, yyyy"</p>
            </div>
          )}
          {/* Task heading — same as web */}
          {obsidianConfig?.enabled && (
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>Task heading</label>
              <input
                type="text"
                placeholder="## Tasks"
                value={obsidianConfig.taskHeading ?? '## Tasks'}
                onChange={(e) => setObsidianConfig(prev => ({ ...prev, taskHeading: e.target.value }))}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
              />
              <p className={`text-xs ${textSecondary} mt-1`}>Markdown heading under which new tasks are appended in daily notes.</p>
            </div>
          )}
          {/* Daily note template — same as web */}
          {obsidianConfig?.enabled && (
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
          )}
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
            <label className={`block text-sm ${textSecondary} mb-1`}>New notes folder</label>
            <input
              type="text"
              placeholder="dayGLANCE"
              value={obsidianConfig.newNotesFolder ?? 'dayGLANCE'}
              onChange={(e) => setObsidianConfig(prev => ({ ...prev, newNotesFolder: e.target.value }))}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
            />
            <p className={`text-xs ${textSecondary} mt-1`}>Where new notes created in dayGLANCE are saved. Leave empty for vault root.</p>
          </div>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>Filename pattern</label>
            <input
              type="text"
              placeholder="yyyy-MM-dd"
              value={obsidianConfig.dailyNotePattern ?? 'yyyy-MM-dd'}
              onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotePattern: e.target.value }))}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
            />
            <p className={`text-xs ${textSecondary} mt-1`}>Date pattern for daily note filenames (without .md). e.g. "yyyy-MM-dd", "dd-MM-yyyy", "MMMM dd, yyyy"</p>
          </div>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>Task heading</label>
            <input
              type="text"
              placeholder="## Tasks"
              value={obsidianConfig.taskHeading ?? '## Tasks'}
              onChange={(e) => setObsidianConfig(prev => ({ ...prev, taskHeading: e.target.value }))}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
            />
            <p className={`text-xs ${textSecondary} mt-1`}>Markdown heading under which new tasks are appended in daily notes.</p>
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
          {obsidianSyncStatus === 'error' && <p className="text-xs text-red-500">Sync failed{obsidianSyncError ? `: ${obsidianSyncError}` : ''}</p>}
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
              listVaultNotes(handle).then(names => setWikilinkCandidates(names)).catch(() => {});
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

  {/* Frames sub-view */}
  {mobileSettingsView === 'frames' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">Settings</span>
      </button>

      {/* Tab switcher — only show when AI scheduling is enabled */}
      {aiConfig?.enabled && aiConfig.features?.smartScheduling && (
        <div className={`flex rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-stone-200'} p-0.5`}>
          <button
            onClick={() => setFramesModalTab('frames')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${framesModalTab === 'frames' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900 shadow-sm') : textSecondary}`}
          >
            My Frames
          </button>
          <button
            onClick={() => setFramesModalTab('schedule')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${framesModalTab === 'schedule' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900 shadow-sm') : textSecondary}`}
          >
            Smart Schedule
          </button>
        </div>
      )}

      {framesModalTab === 'frames' && (
        <>
          {editingFrame ? (
            <FrameEditor
              frame={editingFrame === 'new' ? null : editingFrame}
              onSave={saveFrame}
              onDelete={deleteFrame}
              onCancel={() => setEditingFrame(null)}
              allTags={allTags}
              darkMode={darkMode}
              textPrimary={textPrimary}
              textSecondary={textSecondary}
              borderClass={borderClass}
              cardBg={cardBg}
              hoverBg={hoverBg}
              existingFrames={gtdFrames}
              use24HourClock={use24HourClock}
            />
          ) : (
            <>
              {(() => {
                const todayStr = getTodayStr();
                const visibleFrames = gtdFrames.filter(f => !f.singleDate || f.singleDate >= todayStr);
                return visibleFrames.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <LayoutGrid size={48} className={textSecondary} />
                    <h3 className={`text-lg font-semibold ${textPrimary}`}>No Frames Yet</h3>
                    <p className={`text-sm ${textSecondary} text-center max-w-xs`}>
                      Frames are time blocks on your calendar where the AI scheduler can place tasks. Create your first frame to get started.
                    </p>
                    <button
                      onClick={() => setEditingFrame('new')}
                      className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                    >
                      <Plus size={16} />
                      Create Frame
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {visibleFrames.map(frame => (
                      <div
                        key={frame.id}
                        onClick={() => setEditingFrame(frame)}
                        className={`p-3 rounded-lg border ${borderClass} ${cardBg} cursor-pointer ${hoverBg} transition-colors`}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`w-3 h-3 rounded-full ${frame.color}`} />
                          <span className={`font-medium text-sm ${textPrimary}`}>{frame.label}</span>
                          {frame.singleDate && <span className={`text-[10px] px-1.5 py-0.5 rounded ${darkMode ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>one-time</span>}
                          {!frame.enabled && <span className={`text-[10px] px-1.5 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textSecondary}`}>Off</span>}
                        </div>
                        <div className={`text-xs ${textSecondary} mt-1`}>
                          {formatTime(frame.start)} – {formatTime(frame.end)} · {frame.singleDate
                            ? new Date(frame.singleDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : frame.days.map(d => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]).join(', ')}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => setEditingFrame('new')}
                      className={`w-full p-3 rounded-lg border border-dashed ${borderClass} text-sm ${textSecondary} flex items-center justify-center gap-2 ${hoverBg} transition-colors`}
                    >
                      <Plus size={16} />
                      Add Frame
                    </button>
                  </div>
                );
              })()}
            </>
          )}
        </>
      )}

      {aiConfig?.enabled && aiConfig.features?.smartScheduling && framesModalTab === 'schedule' && (
        <SmartSchedulePanel
          aiConfig={aiConfig}
          inboxTasks={unscheduledTasks.filter(t => !t.completed && !t.isExample)}
          smartScheduleResults={smartScheduleResults}
          smartScheduleLoading={smartScheduleLoading}
          smartScheduleError={smartScheduleError}
          smartScheduleAccepted={smartScheduleAccepted}
          setSmartScheduleAccepted={setSmartScheduleAccepted}
          onRun={runSmartSchedule}
          onApply={applySmartSchedule}
          onCancel={() => { setSmartScheduleResults(null); setSmartScheduleError(''); }}
          darkMode={darkMode}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
          borderClass={borderClass}
          cardBg={cardBg}
          hoverBg={hoverBg}
          gtdFrames={gtdFrames}
          formatTime={formatTime}
        />
      )}
    </div>
  )}

  {/* Habits sub-view */}
  {mobileSettingsView === 'habits' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => { setMobileSettingsView('main'); setEditingHabit(null); }}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">Settings</span>
      </button>

      {/* Enable/disable toggle */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${borderClass} ${cardBg}`}>
        <div className="flex items-center gap-3">
          <Activity size={20} className={habitsEnabled ? 'text-green-500' : textSecondary} />
          <span className={`text-sm font-medium ${textPrimary}`}>Habits</span>
        </div>
        <button
          onClick={() => { if (!habitsEnabled) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setHabitsEnabled(!habitsEnabled); }}
          className={`w-11 h-6 rounded-full transition-colors ${habitsEnabled ? 'bg-green-500' : (darkMode ? 'bg-gray-600' : 'bg-stone-300')}`}
        >
          <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform mx-0.5 ${habitsEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      {habitsEnabled && (
        <>
          {editingHabit ? (
            /* Edit/Add form */
            (() => {
              const isNew = !editingHabit.id;
              return (
                <div className="space-y-4">
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>Name</label>
                    <input
                      type="text"
                      placeholder="e.g., Drink water"
                      value={editingHabit.name || ''}
                      onChange={(e) => setEditingHabit(prev => ({ ...prev, name: e.target.value }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>Type</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingHabit(prev => ({ ...prev, type: 'doMore' }))}
                        className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${editingHabit.type === 'doMore' ? 'bg-blue-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-100 text-stone-700')}`}
                      >Do More</button>
                      <button
                        onClick={() => setEditingHabit(prev => ({ ...prev, type: 'limit' }))}
                        className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${editingHabit.type === 'limit' ? 'bg-red-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-100 text-stone-700')}`}
                      >Limit</button>
                    </div>
                    <p className={`text-xs ${textSecondary} mt-1`}>{editingHabit.type === 'doMore' ? 'Track progress toward a daily goal' : 'Track consumption against a daily ceiling'}</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{editingHabit.type === 'doMore' ? 'Daily Goal' : 'Daily Limit'}</label>
                      <input
                        type="number"
                        min="1"
                        value={editingHabit.target || ''}
                        onChange={(e) => setEditingHabit(prev => ({ ...prev, target: parseInt(e.target.value) || 0 }))}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      />
                    </div>
                    <div className="flex-1">
                      <label className={`block text-sm font-medium ${textSecondary} mb-1`}>Unit</label>
                      <input
                        type="text"
                        placeholder="e.g., glasses"
                        value={editingHabit.unit || ''}
                        onChange={(e) => setEditingHabit(prev => ({ ...prev, unit: e.target.value }))}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      />
                    </div>
                  </div>
                  {/* Scheduled days -- hidden for auto-synced habits */}
                  {editingHabit.source !== 'healthConnect' && (() => {
                    const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
                    const days = editingHabit.scheduledDays ?? [0, 1, 2, 3, 4, 5, 6];
                    return (
                      <div>
                        <label className={`block text-sm font-medium ${textSecondary} mb-1`}>Active days</label>
                        <div className="flex gap-1.5">
                          {DOW_LABELS.map((label, idx) => {
                            const active = days.includes(idx);
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => {
                                  if (active && days.length === 1) return;
                                  setEditingHabit(prev => ({
                                    ...prev,
                                    scheduledDays: active
                                      ? days.filter(d => d !== idx)
                                      : [...days, idx].sort((a, b) => a - b),
                                  }));
                                }}
                                className="w-9 h-9 rounded-lg text-sm font-semibold transition-colors flex-shrink-0"
                                style={active
                                  ? { backgroundColor: '#fe8b00', color: '#fff' }
                                  : { backgroundColor: darkMode ? '#374151' : '#f1f0ef', color: darkMode ? '#9ca3af' : '#78716c' }
                                }
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>Icon</label>
                    <div className="flex flex-wrap gap-2">
                      {HABIT_ICON_NAMES.map(name => {
                        const Icon = HABIT_ICONS[name];
                        return (
                          <button
                            key={name}
                            onClick={() => setEditingHabit(prev => ({ ...prev, icon: name }))}
                            className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${editingHabit.icon === name ? 'bg-blue-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-400 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200')}`}
                          >
                            <Icon size={18} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>Color</label>
                    <div className="flex flex-wrap gap-2">
                      {HABIT_COLORS.map(c => (
                        <button
                          key={c.name}
                          onClick={() => setEditingHabit(prev => ({ ...prev, color: c.name }))}
                          className={`w-9 h-9 rounded-full ${c.bg} transition-all ${editingHabit.color === c.name ? 'ring-2 ring-offset-2 ring-blue-500' : 'opacity-70 hover:opacity-100'}`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={() => setEditingHabit(null)}
                      className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'} transition-colors`}
                    >Cancel</button>
                    <button
                      onClick={() => {
                        if (!editingHabit.name?.trim()) return;
                        if (isNew) { addHabit(editingHabit); } else { updateHabit(editingHabit.id, editingHabit); }
                        setEditingHabit(null);
                      }}
                      disabled={!editingHabit.name?.trim() || !editingHabit.target}
                      className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >{isNew ? 'Add Habit' : 'Save'}</button>
                  </div>
                </div>
              );
            })()
          ) : (
            /* Habit list */
            <>
              {activeHabits.length === 0 ? (
                <div className={`text-center py-8 ${textSecondary}`}>
                  <Activity size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No habits yet</p>
                  <p className="text-xs mt-1">Add a habit to start tracking</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {activeHabits.map((habit, idx) => {
                    const IconComp = HABIT_ICONS[habit.icon] || Target;
                    const colorObj = HABIT_COLORS.find(c => c.name === habit.color) || HABIT_COLORS[0];
                    return (
                      <div
                        key={habit.id}
                        draggable
                        onDragStart={(e) => { setDraggedHabitIdx(idx); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                        onDrop={(e) => { e.preventDefault(); if (draggedHabitIdx !== null && draggedHabitIdx !== idx) reorderHabits(draggedHabitIdx, idx); setDraggedHabitIdx(null); }}
                        onDragEnd={() => setDraggedHabitIdx(null)}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800' : 'bg-white'} ${draggedHabitIdx === idx ? 'opacity-40' : ''} transition-opacity`}
                      >
                        <div className={`cursor-grab active:cursor-grabbing ${textSecondary}`}><GripVertical size={16} /></div>
                        <IconComp size={20} style={{ color: colorObj.ring }} className="flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className={`text-sm font-medium ${textPrimary} truncate flex items-center gap-1.5`}>
                            {habit.name}
                            {habit.source === 'healthConnect' && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 flex-shrink-0">
                                <RefreshCw size={9} />Auto-synced
                              </span>
                            )}
                          </div>
                          <div className={`text-xs ${textSecondary}`}>{habit.type === 'doMore' ? 'Goal' : 'Limit'}: {habit.target} {habit.unit}</div>
                          {(() => {
                            const days = habit.scheduledDays ?? [0, 1, 2, 3, 4, 5, 6];
                            if (days.length === 7) return null;
                            const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                            return (
                              <div className={`text-xs ${textSecondary} opacity-70`}>
                                {days.map(d => names[d]).join(', ')}
                              </div>
                            );
                          })()}
                        </div>
                        <div className="flex items-center gap-1">
                          {idx > 0 && (
                            <button onClick={() => reorderHabits(idx, idx - 1)} className={`p-1 rounded ${hoverBg}`}><ChevronUp size={14} className={textSecondary} /></button>
                          )}
                          {idx < activeHabits.length - 1 && (
                            <button onClick={() => reorderHabits(idx, idx + 1)} className={`p-1 rounded ${hoverBg}`}><ChevronDown size={14} className={textSecondary} /></button>
                          )}
                          <button onClick={() => setEditingHabit({ ...habit })} className={`p-1 rounded ${hoverBg}`}><Pencil size={14} className={textSecondary} /></button>
                          <button onClick={() => archiveHabit(habit.id)} className={`p-1 rounded ${hoverBg}`}><Trash2 size={14} className="text-red-500" /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {activeHabits.length < 8 && (
                <button
                  onClick={() => setEditingHabit({ name: '', icon: 'Droplets', color: 'blue', type: 'doMore', target: 8, unit: '', scheduledDays: [0, 1, 2, 3, 4, 5, 6] })}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 border-dashed border-blue-500/30 text-blue-500 text-sm font-medium hover:bg-blue-500/5 transition-colors"
                >
                  <Plus size={16} />
                  Add Habit
                </button>
              )}
              {window.DayGlanceNative && !activeHabits.some(h => h.source === 'healthConnect' && h.unit === 'steps') && activeHabits.length < 8 && (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${darkMode ? 'border-green-800 bg-green-950/40' : 'border-green-200 bg-green-50'}`}>
                  <Footprints size={22} className="text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${darkMode ? 'text-green-300' : 'text-green-800'}`}>Track steps automatically</div>
                    <div className={`text-xs ${darkMode ? 'text-green-500' : 'text-green-600'} mt-0.5`}>Pulls from Health Connect — no manual tapping</div>
                  </div>
                  <button onClick={addStepsHabit} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600 active:bg-green-700 transition-colors flex-shrink-0">Add</button>
                </div>
              )}
              {window.DayGlanceNative && !activeHabits.some(h => h.source === 'healthConnect' && h.unit === 'min') && activeHabits.length < 8 && (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${darkMode ? 'border-indigo-800 bg-indigo-950/40' : 'border-indigo-200 bg-indigo-50'}`}>
                  <Moon size={22} className="text-indigo-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${darkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>Track sleep automatically</div>
                    <div className={`text-xs ${darkMode ? 'text-indigo-500' : 'text-indigo-600'} mt-0.5`}>Pulls from Health Connect — no manual tapping</div>
                  </div>
                  <button onClick={addSleepHabit} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 active:bg-indigo-700 transition-colors flex-shrink-0">Add</button>
                </div>
              )}
              {habits.filter(h => h.archived).length > 0 && (
                <div className="pt-2">
                  <h4 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} mb-2`}>Archived</h4>
                  <div className="space-y-1">
                    {habits.filter(h => h.archived).map(habit => {
                      const IconComp = HABIT_ICONS[habit.icon] || Target;
                      const colorObj = HABIT_COLORS.find(c => c.name === habit.color) || HABIT_COLORS[0];
                      return (
                        <div key={habit.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-800/50' : 'bg-stone-50'} opacity-60`}>
                          <IconComp size={16} style={{ color: colorObj.ring }} />
                          <span className={`text-sm flex-1 ${textPrimary}`}>{habit.name}</span>
                          <button onClick={() => updateHabit(habit.id, { archived: false })} className="text-xs text-blue-500 font-medium px-2 py-1 rounded hover:bg-blue-500/10">Restore</button>
                          <button onClick={() => deleteHabit(habit.id)} className="text-xs text-red-500 font-medium px-2 py-1 rounded hover:bg-red-500/10">Delete</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )}

  {/* Routines sub-view */}
  {mobileSettingsView === 'routines' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => { handleRoutinesDone(); setMobileSettingsView('main'); }}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">Settings</span>
      </button>

      {/* Enable/disable toggle */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${borderClass} ${cardBg}`}>
        <div className="flex items-center gap-3">
          <Sparkles size={20} className={routinesEnabled ? 'text-teal-500' : textSecondary} />
          <span className={`text-sm font-medium ${textPrimary}`}>Routines</span>
        </div>
        <button
          onClick={() => { if (!routinesEnabled) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setRoutinesEnabled(!routinesEnabled); }}
          className={`w-11 h-6 rounded-full transition-colors ${routinesEnabled ? 'bg-teal-500' : (darkMode ? 'bg-gray-600' : 'bg-stone-300')}`}
        >
          <div className={`w-5 h-5 rounded-full bg-white shadow transition-transform mx-0.5 ${routinesEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>

      {routinesEnabled && <MobileRoutinesTab />}
    </div>
  )}
</div>
  );
};

export default MobileSettingsPanel;
