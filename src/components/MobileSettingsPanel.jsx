import React, { useEffect, useRef, useState } from 'react';
import {
  Activity, Archive, BarChart3, Bell, BookOpen, BrainCircuit,
  CalendarDays, CheckCircle, CheckSquare, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Clock, Cloud, ExternalLink, Plug,
  Footprints, FolderOpen, Globe, GripVertical, HelpCircle, Key, LayoutGrid,
  Loader, Lock, Mic, Moon, Pencil, Plus,
  Flag, RefreshCw, Save, Server, Settings, Sparkles, Sun, Target, Trash2,
  Undo2, Upload, Users, Volume2, VolumeX, Wifi, WifiOff, Zap,
} from 'lucide-react';
import { getTzLabel, getTzOptions } from '../utils/timezones.js';
import { HABIT_ICONS, HABIT_ICON_NAMES, HABIT_COLORS } from '../constants/habits.js';
import { getDeviceId, isNativeAndroid, isNativeApp, nativeGetCalendars, nativePickVault, nativeGetAutomationIntentsEnabled, nativeSetAutomationIntentsEnabled } from '../native.js';
import { cloudSyncProviders } from '../utils/cloudSyncProviders.js';
import { testConnection, PROVIDER_MODELS, PROVIDER_LABELS } from '../ai.js';
import { isFileSystemAccessSupported, requestVaultAccess, disconnectVault, scanVaultNotes, formatDatePattern } from '../obsidian.js';
import UnportableVaultNamesPanel from './UnportableVaultNamesPanel.jsx';
import BridgeStatusPanel from './BridgeStatusPanel.jsx';
import { validateDailyNotePattern, validateVaultFolderSetting } from '../utils/obsidianFilename.js';
import { effectiveLaunchOnWrite } from '../utils/obsidianLaunchOnWrite.js';
import { formatLocalizedDate, localizedWeekdays } from '../utils/localeFormatting.js';
import CloudSyncSettingsForm from './CloudSyncSettingsForm.jsx';
import ICloudDiagnostics from './ICloudDiagnostics.jsx';
import ICloudSyncToggle from './ICloudSyncToggle.jsx';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';
import ResetAppDataSection from './ResetAppDataSection.jsx';
import FrameEditor from './FrameEditor.jsx';
import SmartSchedulePanel from './SmartSchedulePanel.jsx';
import MobileRoutinesTab from './MobileRoutinesTab.jsx';
import UserOwnerSwitcher from './UserOwnerSwitcher.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import LocalIntegrationsSettings from './LocalIntegrationsSettings.jsx';
import TodoistSettings from './TodoistSettings.jsx';
import { useMcpStatus } from './McpStatusControls.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { isVaultEnabled } from '../sync/vaultConfig.js';
import { multiUserToggleLocked, multiUserUnavailableReason, canSyncUserRoster } from '../utils/multiUserGate.js';
import { getDbIntentsConfig, setDbIntentsConfig, getDbIntentsConnection } from '../intents/dbIntentsConfig.js';
import { getIcloudIntentsEnabledFlag, setIcloudIntentsEnabled } from '../intents/icloudIntentsConfig.js';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { INTENT_CONFIG_KEY, MULTI_USER_CONFIG_KEY } from '../intents/useIntentPoller.js';
import { syncSharedUsers, syncSharedUsersViaICloud } from '../intents/sharedUsers.js';
import { isAvailable as isICloudAvailable } from '../intents/icloudFileTransport.js';
import { getSyncPassphrase, setSyncPassphrase } from '../utils/crypto.js';
import { setupIntentsEncryption } from '../intents/intentsEncryptionSetup.js';
import { ensureVaultIntentsKey, setupVaultIntentsEncryption } from '../intents/vaultIntentsSetup.js';
import { flushOutboxNow } from '../intents/useOutboxFlush.js';
import { loadIntentsRootKey, clearIntentsRootKey } from '../intents/intentsKeyStore.js';
import { useTranslation } from 'react-i18next';
import { buildLocalizedTaskHeading } from '../utils/dailyNoteTemplate.js';
import LanguagePicker from './LanguagePicker.jsx';
import { notBucketed } from '../utils/bucketList.js';
import CalendarList from './CalendarList.jsx';

const MobileSettingsPanel = () => {
  const { t: todoistText } = useTranslation('todoist');
  const {
    isPro, isAndroidApp, isIOSApp, isElectronApp, subProductId,
    consumeTestPurchase, canConsumeTestPurchase,
    tasks, setTasks, setUnscheduledTasks,
    darkMode, setDarkMode,
    mobileSettingsView, setMobileSettingsView,
    use24HourClock, setUse24HourClock,
    liveActivityEnabled, setLiveActivityEnabled,
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
    mobileDefaultView, setMobileDefaultView,
    listEndOfDayTime, setListEndOfDayTime,
    glancePage, setGlancePage,
  } = useDayPlannerCtx();
  const {
    obsidianVaultHandleRef,
    syncUrl, setSyncUrl,
    taskCalendarUrl, setTaskCalendarUrl,
    taskCalendarAuth, setTaskCalendarAuth,
    syncCalendarCreds, setSyncCalendarCreds,
    syncRetentionDays, setSyncRetentionDays,
    calSyncStatus, calSyncLastSynced, calSyncConfigured, calendarSourceActive,
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
    obsidianLaunchOnWrite, setObsidianLaunchOnWrite,
    obsidianCompletionDates, setObsidianCompletionDates,
    obsidianSyncStatus, obsidianSyncError, obsidianLastSynced, setObsidianLastSynced,
    wikilinkCandidates, setWikilinkCandidates,
    unportableVaultFiles, setUnportableVaultFiles,
    cloudSyncTest, cloudSyncNow,
    vaultSyncNow, vaultBootstrapSync, vaultStatus, vaultError, vaultLastSynced, vaultSkipped, vaultEnabled,
    syncAll, performObsidianSync, performRemoteBackup, nativeClearVault,
    loadAutoBackupHistory,
    deleteLocalAutoBackup, deleteRemoteAutoBackup,
    exportBackup, handleFileUpload, handleBackupFileSelect,
    setShowIntentActivityLog,
    removeFileImportedEvents,
  } = useSyncCtx();

  // Launch-on-write (Obsidian Phase 1) is shown only where a launch mechanism
  // exists: Electron (main-process shell.openExternal) or the Android bridge
  // intent. Plain browser has neither — a window.open fired from a debounce
  // timer is popup-blocked without a user gesture. The platform string feeds
  // the per-platform default (macOS on, everything else off).
  const launchOnWritePlatform = window.electronAPI?.obsidian?.setLaunchOnWrite
    ? window.electronAPI.platform
    : (isNativeAndroid() && window.DayGlanceObsidian?.setLaunchOnWrite) ? 'android' : null;
  const {
    routinesEnabled, setRoutinesEnabled,
    todayRoutines, setDashboardSelectedChips,
    setRoutineAddingToBucket, setRoutineNewChipName,
    handleRoutinesDone,
    habitsEnabled, setHabitsEnabled,
    managedHabits: activeHabits, habits,
    editingHabit, setEditingHabit,
    draggedHabitIdx, setDraggedHabitIdx,
    addHabit, updateHabit, archiveHabit, deleteHabit, reorderHabits,
    addStepsHabit, addSleepHabit, healthPerms,
    hrViewUserSyncId, setHrViewUserSyncId,
    goalsProjectsEnabled, setGoalsProjectsEnabled,
    gtdFrames, myFrames,
    framesModalTab, setFramesModalTab,
    editingFrame, setEditingFrame,
    saveFrame, deleteFrame,
    smartScheduleResults, setSmartScheduleResults,
    smartScheduleLoading,
    smartScheduleError, setSmartScheduleError,
    smartScheduleAccepted, setSmartScheduleAccepted,
    runSmartSchedule, applySmartSchedule,
    aiConfig, setAiConfig, aiSuppressed,
    aiConnectionStatus, setAiConnectionStatus,
    aiConnectionMessage, setAiConnectionMessage,
    aiOllamaHelp, setAiOllamaHelp,
    setShowWeeklyReviewTimePicker, setShowMorningTimePicker,
    reminderSettings, setReminderSettings,
    applyReminderPreset, updateCategoryReminder,
    users, setUsers, meUserSyncId, setMeUserSyncId,
    multiUserEnabled, setMultiUserEnabled,
    cloudSyncConfigured,
  } = useFeaturesCtx();
  // Gate multi-user when sync is unconfigured; never trap an already-on toggle.
  const multiUserLocked = multiUserToggleLocked({ cloudSyncConfigured, multiUserEnabled });
  // "Requires cloud sync" is wrong on an iCloud-only device — that user IS
  // syncing, just to a destination only they can reach. Pick the sentence that
  // matches their situation instead of the generic one.
  const multiUserReason = multiUserUnavailableReason({
    cloudSyncConfigured,
    icloudAvailable: isICloudAvailable(),
  });
  const multiUserRosterSyncable = canSyncUserRoster({
    multiUserEnabled,
    cloudSyncEnabled: cloudSyncConfig?.enabled,
    icloudAvailable: isICloudAvailable(),
  });
  // iOS uses HealthKit lazy authorization (permission requested on first read), so
  // it has no explicit permission check/request. On iOS the health-habit "Add"
  // button is always enabled and the dead "Continue" button is hidden — see the
  // matching note in HabitModal.jsx and refreshHealthPerms in useHabits.js.
  const isIOS = typeof window !== 'undefined' && !!window.DayGlanceIOS;

  const [intentForm, setIntentForm] = useState(() => {
    const raw = localStorage.getItem(INTENT_CONFIG_KEY);
    const saved = raw ? JSON.parse(raw) : {};
    return {
      webdavUrl: saved.webdavUrl ?? '',
      username: saved.username ?? '',
      appPassword: saved.appPassword ?? '',
      eventsPath: saved.eventsPath ?? '/GLANCE/events/',
      foregroundInterval: saved.foregroundInterval ?? 120000,
      backgroundInterval: saved.backgroundInterval ?? 900000,
      gcRetentionDays: saved.gcRetentionDays ?? 30,
      encryptionEnabled: saved.encryptionEnabled ?? false,
    };
  });
  const [intentSaved, setIntentSaved] = useState(false);
  const [intentSetupPhase, setIntentSetupPhase] = useState(null);
  const [intentPassphraseInput, setIntentPassphraseInput] = useState('');
  // GLANCEvault DB intents (beta). Tracks only `enabled`; the rest of the config
  // (ttlMs, pollIntervalMinutes) is preserved on save, and the vault connection is
  // INHERITED from the GLANCEvault sync config (not edited here).
  const [dbIntentsEnabled, setDbIntentsEnabled] = useState(() => !!getDbIntentsConfig()?.enabled);
  const [dbIntentsSaved, setDbIntentsSaved] = useState(false);
  // Vault intents key-setup phase: null | 'passphrase-needed' | 'running' | { error }.
  const [dbIntentsSetupPhase, setDbIntentsSetupPhase] = useState(null);
  const [dbIntentsPassphraseInput, setDbIntentsPassphraseInput] = useState('');
  // iCloud intents opt-in gate. DEFAULT OFF — activation (emit + poll) only runs
  // when the user flips this on, matching WebDAV/vault gating.
  const [icloudIntentsEnabled, setIcloudIntentsEnabledState] = useState(() => getIcloudIntentsEnabledFlag());
  const [icloudIntentsSaved, setIcloudIntentsSaved] = useState(false);
  // Android automation intents (Tasker) opt-in gate. DEFAULT OFF — the native
  // SharedPreferences flag is the source of truth; mirror it for the toggle.
  const [automationIntentsEnabled, setAutomationIntentsEnabled] = useState(
    () => isNativeAndroid() && nativeGetAutomationIntentsEnabled(),
  );
  const [muAddingUser, setMuAddingUser] = useState(false);
  const [muNewUserName, setMuNewUserName] = useState('');
  const [muEditingUserId, setMuEditingUserId] = useState(null);

  // Two-step confirm for the hidden "Reset test purchase" action. The realistic
  // misuse isn't discovery (7-tap gate) — it's a paying user misreading "reset"
  // as "refresh my purchase state" while troubleshooting. The confirm converts
  // that into informed consent: it names the real consequence before acting.
  const [confirmingPurchaseReset, setConfirmingPurchaseReset] = useState(false);
  const [muEditingUserName, setMuEditingUserName] = useState('');
  const [muUsersPath, setMuUsersPath] = useState(() => {
    const raw = localStorage.getItem(MULTI_USER_CONFIG_KEY);
    return raw ? (JSON.parse(raw).usersPath ?? '/GLANCE/users/') : '/GLANCE/users/';
  });
  const [muSyncStatus, setMuSyncStatus] = useState(null);
  const { t } = useTranslation(); // null | 'syncing' | 'ok' | 'error'

  // Commit staged routines on unmount (e.g. user switches tabs while in routines view)
  // For the Local Integrations row card only: Electron presence + on/off dot.
  // The status/undo surface lives in the GLANCE tab's top row, not here.
  const mcpStatus = useMcpStatus();
  const integrationsConfig = mcpStatus.snapshot?.config;
  const localIntegrationsOn = !!(integrationsConfig?.streamDeck?.enabled || (integrationsConfig?.mcp?.readTier && integrationsConfig.mcp.readTier !== 'off'));
  const mobileSettingsViewRef = useRef(mobileSettingsView);
  const handleRoutinesDoneRef = useRef(handleRoutinesDone);
  const [devTapCount, setDevTapCount] = useState(0);
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
          <div className={`text-xs font-semibold ${darkMode ? 'text-amber-300' : 'text-amber-800'}`}>{t('settings.timezoneMismatch')}</div>
          <div className={`text-xs mt-0.5 ${darkMode ? 'text-amber-400/80' : 'text-amber-700/80'}`}>
            {t('settings.timezoneDevice')}: <strong>{Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ')}</strong>
          </div>
          <div className={`text-xs ${darkMode ? 'text-amber-400/80' : 'text-amber-700/80'}`}>
            {t('settings.timezoneHome')}: <strong>{homeTimezone.replace(/_/g, ' ')}</strong>
          </div>
          <button
            onClick={() => setMobileSettingsView('app')}
            className={`mt-1.5 text-[10px] font-medium underline ${darkMode ? 'text-amber-400' : 'text-amber-700'}`}
          >
            {t('settings.fixInAppSettings')}
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
        <span className={`text-xs font-medium ${textPrimary}`}>{use24HourClock ? t('settings.clock24h') : t('settings.clock12h')}</span>
      </button>
      <button
        onClick={() => setWeekStartDay(weekStartDay === 0 ? 1 : 0)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        <CalendarDays size={24} className={textSecondary} />
        <span className={`text-xs font-medium ${textPrimary}`}>{weekStartDay === 0 ? t('settings.weekStartSun') : t('settings.weekStartMon')}</span>
      </button>
      <button
        onClick={() => setSoundEnabled(!soundEnabled)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {soundEnabled ? <Volume2 size={24} className="text-green-500" /> : <VolumeX size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>{soundEnabled ? t('settings.soundOn') : t('settings.soundOff')}</span>
      </button>
      {/* Row 2: Dark/Light | Frames | Goals */}
      <button
        onClick={() => setDarkMode(!darkMode)}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {darkMode ? <Sun size={24} className="text-amber-400" /> : <Moon size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>{darkMode ? t('settings.lightMode') : t('settings.darkMode')}</span>
      </button>
      <button
        onClick={() => setMobileSettingsView('frames')}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        <LayoutGrid size={24} className={mobileSettingsView === 'frames' ? 'text-blue-500' : textSecondary} />
        <span className={`text-xs font-medium ${textPrimary}`}>{t('settings.frames')}</span>
      </button>
      <button
        onClick={() => { if (!goalsProjectsEnabled) setOnboardingProgress(prev => ({ ...prev, hasEnabledOptionalFeature: true })); setGoalsProjectsEnabled(!goalsProjectsEnabled); }}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {goalsProjectsEnabled ? <Flag size={24} className="text-blue-500" /> : <Flag size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>{goalsProjectsEnabled ? t('settings.goalsOn') : t('settings.goalsOff')}</span>
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
        <span className={`text-xs font-medium ${textPrimary}`}>{routinesEnabled ? t('settings.routinesOn') : t('settings.routinesOff')}</span>
      </button>
      <button
        onClick={() => setMobileSettingsView('habits')}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        <Activity size={24} className={mobileSettingsView === 'habits' ? 'text-green-500' : habitsEnabled ? 'text-green-500' : textSecondary} />
        <span className={`text-xs font-medium ${textPrimary}`}>{habitsEnabled ? t('settings.habitsOn') : t('settings.habitsOff')}</span>
      </button>
      {/* AI tile hidden on the China App Store storefront (Guideline 5 / MIIT). */}
      {!aiSuppressed && (
      <button
        onClick={() => setMobileSettingsView('ai')}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {aiConfig.enabled ? <BrainCircuit size={24} className="text-purple-400" /> : <BrainCircuit size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>{aiConfig.enabled ? t('settings.aiOn') : t('settings.aiOff')}</span>
      </button>
      )}
    </div>

    {/* Sync buttons */}
    <div className="space-y-2">
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} px-1`}>{t('settings.sync')}</h3>
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
          <span className={`font-medium ${textPrimary}`}>{t('settings.syncCalendars')}</span>
        </button>
      )}
      <button
        onClick={() => setMobileSettingsView('todoist')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <CheckSquare size={20} className={textSecondary} />
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>{todoistText('title')}</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
      <button
        onClick={() => setMobileSettingsView('cloudsync')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        {/* Dot reflects WebDAV OR GLANCEvault; vault-only uses vault status. */}
        {(() => {
          const webdavOn = !!cloudSyncConfig?.enabled;
          const syncOn = webdavOn || vaultEnabled;
          const st = webdavOn ? cloudSyncStatus : vaultStatus;
          const syncing = st === 'uploading' || st === 'downloading';
          return (
            <div className="relative">
              <Cloud size={20} className={`${syncOn ? 'text-blue-500' : textSecondary} ${syncing ? 'animate-pulse' : ''}`} />
              {syncOn && (
                <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                  syncing ? 'bg-blue-500 animate-pulse' : st === 'error' ? 'bg-red-500' : 'bg-green-500'
                }`} />
              )}
            </div>
          );
        })()}
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('settings.cloudSync')}</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
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
          <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('settings.obsidian')}</span>
          <ChevronRight size={18} className={textSecondary} />
        </button>
      )}
      <button
        onClick={() => setMobileSettingsView('intent')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <div className="relative">
          <Activity size={20} className={(intentForm.webdavUrl || dbIntentsEnabled) ? 'text-blue-500' : textSecondary} />
          {(intentForm.webdavUrl || dbIntentsEnabled) && (
            <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-green-500`} />
          )}
        </div>
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('settings.glanceIntegrations')}</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
      {!!mcpStatus.api?.localIntegrations && (
        <button
          onClick={() => setMobileSettingsView('localIntegrations')}
          className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
        >
          <div className="relative">
            <Plug size={20} className={localIntegrationsOn ? 'text-amber-500' : textSecondary} />
            {localIntegrationsOn && (
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-green-500`} />
            )}
          </div>
          <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('settings.localIntegrations', { defaultValue: 'Local Integrations' })}</span>
          <ChevronRight size={18} className={textSecondary} />
        </button>
      )}
      <button
        onClick={() => setMobileSettingsView('multiUser')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <div className="relative">
          <Users size={20} className={multiUserEnabled && users.filter(u => !u.deleted).length > 0 ? 'text-green-500' : textSecondary} />
          {multiUserEnabled && users.filter(u => !u.deleted).length > 0 && (
            <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-green-500`} />
          )}
        </div>
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('settings.multiUser')}</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
    </div>

    {/* Stats */}
    {/* Sub-menu buttons */}
    <div className="space-y-2">
      <h3 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} px-1`}>{t('settings.more')}</h3>
      <button
        onClick={() => setMobileSettingsView('app')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <Settings size={20} className={textSecondary} />
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('settings.appSettings')}</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
      <button
        onClick={() => setMobileSettingsView('notifications')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <Bell size={20} className={textSecondary} />
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('settings.notifications')}</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
      <button
        onClick={() => setMobileSettingsView('backups')}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <Save size={20} className={textSecondary} />
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('settings.backups')}</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
      <button
        onClick={() => setShowHelpModal(true)}
        className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
      >
        <HelpCircle size={20} className={textSecondary} />
        <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('app.helpFeedback')}</span>
        <ChevronRight size={18} className={textSecondary} />
      </button>
      {canConsumeTestPurchase && devTapCount >= 7 && (
        confirmingPurchaseReset ? (
          <div className={`w-full ${cardBg} border border-red-500/40 rounded-xl p-3 space-y-2`}>
            <p className={`text-xs ${textSecondary} leading-relaxed`}>
              {t('settings.resetTestPurchaseWarning', { defaultValue: "This permanently revokes this account's lifetime purchase from Google Play. It is not a refresh and cannot be undone. It has no effect on subscriptions: cancel in Google Play and let the subscription expire instead. For internal testing only." })}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingPurchaseReset(false)}
                className={`flex-1 py-2 rounded-lg text-sm font-medium border ${borderClass} ${textPrimary}`}
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => { setConfirmingPurchaseReset(false); consumeTestPurchase(); }}
                className="flex-1 py-2 rounded-lg text-sm font-medium bg-red-600 text-white"
              >
                {t('settings.revokePurchase', { defaultValue: 'Revoke purchase' })}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingPurchaseReset(true)}
            className={`w-full ${cardBg} border ${borderClass} rounded-xl p-3 flex items-center gap-3 opacity-50`}
          >
            <RefreshCw size={16} className={textSecondary} />
            <span className={`text-sm ${textSecondary} flex-1 text-left`}>{t('settings.resetTestPurchase', { defaultValue: 'Reset test purchase' })}</span>
          </button>
        )
      )}
      {(isAndroidApp || isIOSApp || isElectronApp) && isPro && (
        <p onClick={() => setDevTapCount(c => c + 1)} className={`text-xs ${textSecondary} text-center pt-1`}>
          {/* Only two plans exist on every platform: annual and lifetime
              (dayglance_pro_lifetime / com.dayglance.pro.lifetime). */}
          dayGLANCE Pro · {subProductId?.includes('lifetime') ? t('subscription.lifetime') : t('subscription.annual')}
        </p>
      )}
    </div>
  </div>

  {/* App Settings sub-view */}
  {mobileSettingsView === 'app' && (() => {
    return (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>

      {/* View default */}
      <div className="space-y-2">
        <div className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <LayoutGrid size={16} className={textSecondary} />
          {t('settings.viewDefault')}
        </div>
        <p className={`text-xs ${textSecondary}`}>{t('settings.viewDefaultDesc')}</p>
        <div className="flex gap-2">
          {[
            { value: 'grid', label: t('settings.viewGrid') },
            { value: 'list', label: t('settings.viewList') },
            { value: 'sched', label: t('settings.viewSched') },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => { setMobileDefaultView(value); setMobileViewMode(value); }}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                mobileDefaultView === value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : `${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-stone-300'} ${textPrimary}`
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* End of day (LIST view only) */}
        {mobileViewMode === 'list' && (
          <div className="mt-3 space-y-1.5">
            <label className={`block text-xs font-medium ${textSecondary}`}>{t('settings.endOfDay')}</label>
            <p className={`text-xs ${textSecondary} opacity-70`}>{t('settings.endOfDayHint')}</p>
            <div className="flex flex-wrap gap-1.5">
              {[{ label: t('common.off'), value: null }, ...Array.from({ length: 13 }, (_, i) => {
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

      {/* Language */}
      <hr className={borderClass} />
      <div className="space-y-2">
        <label htmlFor="mobile-settings-language" className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <Globe size={16} className={textSecondary} />
          {t('settings.language')}
        </label>
        <LanguagePicker
          id="mobile-settings-language"
          className={`w-full px-3 py-2 text-sm rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} focus:outline-none focus:ring-2 focus:ring-blue-500`}
        />
      </div>

      {/* Home timezone */}
      <hr className={borderClass} />
      <div className="space-y-2">
        <div className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <Globe size={16} className={textSecondary} />
          {t('settings.homeTimezone')}
        </div>
        <p className={`text-xs ${textSecondary}`}>{t('settings.homeTimezoneDesc')}</p>
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
              {t('settings.glanceDefault')}
            </div>
            <p className={`text-xs ${textSecondary}`}>{t('settings.glanceDefaultDesc')}</p>
            <div className="flex gap-2">
              {[{ value: 0, label: t('settings.glanceDefaultHabits') }, { value: 1, label: t('settings.glanceDefaultGoals') }].map(({ value, label }) => (
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
          {t('settings.calendarSync')}
          {calendarSourceActive && <span className="mr-1 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
          <ChevronDown size={16} className={`ml-auto flex-shrink-0 ${textSecondary} transition-transform ${collapsedSettings.calSync ? '' : 'rotate-180'}`} />
        </button>
        {!collapsedSettings.calSync && (<>
        {!isNativeApp() && <CalendarList />}
        {isNativeApp() && (
          <p className={`text-xs ${textSecondary}`}>
            {t('settings.deviceCalendarDescription')}
          </p>
        )}
        <div>
          <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.taskCalendarUrl')}</label>
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
            <p className={`text-xs font-medium ${textSecondary}`}>{t('settings.taskCalendarAuth')}</p>
            <div>
              <label className={`block text-xs ${textSecondary} mb-1`}>{t('common.username')}</label>
              <input
                type="text"
                placeholder={t('common.username')}
                value={taskCalendarAuth.username}
                onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, username: e.target.value }))}
                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
              />
            </div>
            <div>
              <label className={`block text-xs ${textSecondary} mb-1`}>{t('settings.appPassword')}</label>
              <input
                type="password"
                placeholder={t('settings.appPassword')}
                value={taskCalendarAuth.appPassword}
                onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, appPassword: e.target.value }))}
                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
              />
            </div>
            <div>
              <label className={`block text-xs ${textSecondary} mb-1`}>{t('settings.calDAVBaseUrl')}</label>
              <input
                type="url"
                placeholder="https://cloud.example.com/remote.php/dav/calendars/user/personal/"
                value={taskCalendarAuth.caldavBaseUrl}
                onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, caldavBaseUrl: e.target.value }))}
                className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
              />
              <p className={`text-xs ${textSecondary} mt-0.5`}>
                {t('settings.calDAVSyncHint')}
              </p>
            </div>
            <p className={`text-xs ${textSecondary}`}>
              {t('settings.taskCalendarCredentialsHint')}
            </p>
          </div>
        )}
        {multiUserEnabled && meUserSyncId && (
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={syncCalendarCreds}
              onChange={(e) => setSyncCalendarCreds(e.target.checked)}
              className="mt-0.5 flex-shrink-0"
            />
            <span className={`text-xs ${textSecondary}`}>
              {t('settings.syncCalendarCreds')}
              {!(cloudSyncConfig?.encryptionEnabled || isVaultEnabled()) && (
                <span className="block mt-0.5 italic">{t('settings.syncCalendarCredsNeedsEncryption')}</span>
              )}
            </span>
          </label>
        )}
        <div>
          <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.keepPastEvents')}</label>
          <select
            value={syncRetentionDays}
            onChange={(e) => setSyncRetentionDays(Number(e.target.value))}
            className={`px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
          >
            <option value={7}>{t('settings.keepPastEventsDays', { count: 7, defaultValue: '{{count}} days' })}</option>
            <option value={14}>{t('settings.keepPastEventsDays', { count: 14, defaultValue: '{{count}} days' })}</option>
            <option value={30}>{t('settings.keepPastEventsDays', { count: 30, defaultValue: '{{count}} days' })}</option>
            <option value={60}>{t('settings.keepPastEventsDays', { count: 60, defaultValue: '{{count}} days' })}</option>
            <option value={90}>{t('settings.keepPastEventsDays', { count: 90, defaultValue: '{{count}} days' })}</option>
            <option value={180}>{t('settings.keepPastEventsMonths', { count: 6, defaultValue: '{{count}} months' })}</option>
            <option value={365}>{t('settings.keepPastEventsYears', { count: 1, defaultValue: '{{count}} year' })}</option>
            <option value={0}>{t('settings.keepPastEventsAll')}</option>
          </select>
          <p className={`text-xs ${textSecondary} mt-1`}>
            {t('settings.keepPastEventsHint')}
          </p>
        </div>
        <button
          onClick={() => syncAll()}
          disabled={isSyncing || !calSyncConfigured}
          className={`px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm ${!calSyncConfigured ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing ? t('settings.syncing') : t('settings.syncNow')}
        </button>
        {calSyncLastSynced && (
          <p className={`text-xs ${textSecondary}`}>{t('common.lastSynced')}: {new Date(calSyncLastSynced).toLocaleString()}</p>
        )}
        {isNativeApp() && (
          <div className="space-y-2 pt-1">
            <div className="flex items-center justify-between">
              <p className={`text-sm font-medium ${textPrimary}`}>{t('settings.deviceCalendars')}</p>
              <button onClick={() => { const cals = nativeGetCalendars(); if (cals.length > 0) setAvailableCalendars(cals); }} className={`text-xs ${textSecondary} underline`}>{t('common.refresh')}</button>
            </div>
            {availableCalendars.length === 0 ? (
              <p className={`text-xs ${textSecondary}`}>{t('settings.noDeviceCalendars')}</p>
            ) : (<>
              <p className={`text-xs ${textSecondary}`}>{t('settings.deviceCalendarFilterHint')}</p>
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
      </div>

      <hr className={borderClass} />

      {/* iCal Import */}
      <div className="space-y-3">
        <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <Upload size={16} className={textSecondary} />
          {t('settings.importIcs')}
        </h4>
        <label className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg transition-colors text-sm`}>
          <Upload size={14} className={textSecondary} />
          {t('settings.chooseIcsFile')}
          <input type="file" accept=".ics" onChange={(e) => { handleFileUpload(e); setMobileSettingsView('main'); }} className="hidden" />
        </label>
        {(() => {
          const count = tasks.filter(t2 => t2.imported && !t2.isTaskCalendar && t2.importSource === 'file').length;
          return count > 0 && (
            <button
              onClick={() => {
                if (window.confirm(t('settings.removeFileImportedConfirm', 'Remove all {{n}} file-imported events? Re-importing the file brings them back.', { n: count }))) {
                  removeFileImportedEvents();
                }
              }}
              className="block text-xs font-medium text-red-500"
            >
              {t('settings.removeFileImported', 'Remove file-imported events')} ({count})
            </button>
          );
        })()}
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
        <span className="text-sm font-medium">{t('common.settings')}</span>
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
        <span className={`text-sm ${textPrimary}`}>{t('settings.enableReminders')}</span>
      </label>

      {/* Live Activity (iOS only) — opt-in, default off: the compact island
          hides the cellular/wifi status icons, so it has to be a choice. */}
      {isIOSApp && (
        <label className="flex items-center gap-3 cursor-pointer">
          <div className="relative">
            <input
              type="checkbox"
              checked={liveActivityEnabled}
              onChange={(e) => setLiveActivityEnabled(e.target.checked)}
              className="sr-only"
            />
            <div className={`w-10 h-6 rounded-full transition-colors ${liveActivityEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
              <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${liveActivityEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
            </div>
          </div>
          <div>
            <span className={`text-sm ${textPrimary}`}>{t('settings.liveActivity')}</span>
            <p className={`text-xs ${textSecondary}`}>{t('settings.liveActivityDesc')}</p>
          </div>
        </label>
      )}

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
            <span className={`text-sm ${textPrimary}`}>{t('settings.inAppToasts')}</span>
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
              {[
                ['standard', t('reminders.presetStandard')],
                ['aggressive', t('reminders.presetAggressive')],
                ['minimal', t('reminders.presetMinimal')],
              ].map(([key, label]) => (
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
                  ['before15', t('reminders.beforeMinutes', { count: 15 })],
                  ['before10', t('reminders.beforeMinutes', { count: 10 })],
                  ['before5', t('reminders.beforeMinutes', { count: 5 })],
                  ['atStart', t('common.start')],
                  ['atEnd', t('common.end')],
                ].map(([field, label]) => (
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

          {/* Weekly Review */}
          <div className={`border-t ${borderClass} pt-4`}>
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 size={16} className="text-purple-500" />
              <span className={`text-sm font-semibold ${textPrimary}`}>{t('weeklyReview.title')}</span>
            </div>
            <label className="flex items-center gap-3 cursor-pointer mb-3">
              <div className="relative">
                <input type="checkbox" checked={reminderSettings.weeklyReview?.enabled ?? true} onChange={(e) => setReminderSettings(prev => ({ ...prev, weeklyReview: { ...prev.weeklyReview, enabled: e.target.checked } }))} className="sr-only" />
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
                  <div className="flex gap-1 flex-wrap">
                    {localizedWeekdays('short').map((label, i) => (
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
        </div>
      )}

      {/* hyperGLANCE Sessions — only relevant when Goals & Projects is on */}
      {goalsProjectsEnabled && (
      <div className={`border-t ${borderClass} pt-4`}>
        <div className="flex items-center gap-2 mb-3">
          <Zap size={16} className="text-indigo-500" />
          <span className={`text-sm font-semibold ${textPrimary}`}>{t('reminders.hyperGlanceSessions')}</span>
        </div>
        <label className="flex items-center gap-3 cursor-pointer mb-3">
          <div className="relative">
            <input type="checkbox" checked={reminderSettings.hyperGlance?.enabled !== false} onChange={(e) => setReminderSettings(prev => ({ ...prev, hyperGlance: { ...prev.hyperGlance, enabled: e.target.checked } }))} className="sr-only" />
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
              {[
                [0, t('common.off')],
                [5, t('common.minutesShort', { count: 5 })],
                [10, t('common.minutesShort', { count: 10 })],
                [15, t('common.minutesShort', { count: 15 })],
                [30, t('common.minutesShort', { count: 30 })],
              ].map(([mins, label]) => (
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
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>

      {/* Export / Restore */}
      <div className="space-y-3">
        <button
          onClick={() => exportBackup()}
          className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
        >
          <div className="font-medium flex items-center gap-2">
            <Upload size={16} className="rotate-180" />
            {t('settings.exportBackup')}
          </div>
          <div className={`text-sm ${textSecondary}`}>{t('settings.exportBackupDesc')}</div>
        </button>
        <label className={`block w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors cursor-pointer`}>
          <div className="font-medium flex items-center gap-2">
            <Upload size={16} />
            {t('settings.restoreBackup')}
          </div>
          <div className={`text-sm ${textSecondary}`}>{t('settings.restoreBackupDesc')}</div>
          <input type="file" accept=".json" onChange={handleBackupFileSelect} className="hidden" />
        </label>
      </div>

      <hr className={borderClass} />

      {/* Auto-Backup settings inline */}
      <div className="space-y-3">
        <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <Clock size={16} className={textSecondary} />
          {t('settings.autoBackup')}
          {(autoBackupConfig.local.enabled || autoBackupConfig.remote.enabled) && (
            <span className="ml-auto text-xs px-1.5 py-0.5 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded">{t('common.active')}</span>
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
          {t('settings.loadBackupHistory')}
        </button>
        {autoBackupHistory.local.length > 0 && (
          <div>
            <h4 className={`text-xs font-semibold ${textSecondary} uppercase mb-2`}>{t('backup.localBackups')} ({autoBackupHistory.local.length})</h4>
            <div className="space-y-1">
              {autoBackupHistory.local.map(b => (
                <div key={b.id} className={`flex items-center justify-between py-2 px-3 rounded-lg ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${textPrimary} truncate`}>{new Date(b.timestamp).toLocaleString()}</p>
                    <p className={`text-xs ${textSecondary}`}>{t(`backup.${b.frequency}`, { defaultValue: b.frequency })}</p>
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
            <h4 className={`text-xs font-semibold ${textSecondary} uppercase mb-2`}>{t('backup.remoteBackups')} ({autoBackupHistory.remote.length})</h4>
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

      <hr className={borderClass} />

      {/* Reset — lives next to Export/Restore so a backup is one tap away first. */}
      <ResetAppDataSection
        darkMode={darkMode}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
        onExportBackup={exportBackup}
      />
    </div>
  )}

  {/* AI settings sub-view — suppressed on the China App Store storefront (Guideline 5 / MIIT). */}
  {mobileSettingsView === 'ai' && !aiSuppressed && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>

      <div className="space-y-4">
        <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <BrainCircuit size={18} className={aiConfig.enabled ? 'text-purple-400' : textSecondary} />
          {t('settings.aiFeatures')}
        </h4>
        <p className={`${textSecondary} text-xs`}>{t('settings.aiByoApiKey')}</p>

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
          <span className={`text-sm ${textPrimary}`}>{t('settings.enableAIFeatures')}</span>
        </label>

        {aiConfig.enabled && (
          <div className="space-y-4">
            {/* Provider */}
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.aiProvider')}</label>
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
                  <option key={key} value={key}>
                    {key === 'ollama' ? t('settings.aiProviderOllama') : key === 'custom' ? t('settings.aiProviderCustom') : label}
                  </option>
                ))}
              </select>
            </div>

            {/* API Key */}
            {aiConfig.provider !== 'ollama' && (
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.aiApiKey')}</label>
                <input
                  type="password"
                  placeholder={aiConfig.provider === 'openai' ? 'sk-...' : aiConfig.provider === 'anthropic' ? 'sk-ant-...' : t('settings.aiApiKey')}
                  value={aiConfig.apiKey}
                  onChange={(e) => {
                    setAiConfig(prev => ({ ...prev, apiKey: e.target.value }));
                    setAiConnectionStatus(null);
                  setAiOllamaHelp(null);
                  }}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm font-mono`}
                />
                <p className={`text-xs ${textSecondary} mt-0.5`}>{t('settings.aiApiKeyHint')}</p>
              </div>
            )}

            {/* Base URL */}
            {(aiConfig.provider === 'ollama' || aiConfig.provider === 'custom') && (
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>
                  {aiConfig.provider === 'ollama' ? t('settings.aiOllamaUrl') : t('settings.aiBaseUrl')}
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
                    {t('settings.aiCommonProviders')} Groq → <code className="font-mono">https://api.groq.com/openai/v1</code> · Together AI → <code className="font-mono">https://api.together.xyz/v1</code> · LM Studio → <code className="font-mono">http://localhost:1234/v1</code>
                  </p>
                )}
              </div>
            )}

            {/* Model */}
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.aiModel')}</label>
              {(PROVIDER_MODELS[aiConfig.provider] || []).length > 0 ? (
                <select
                  value={aiConfig.model}
                  onChange={(e) => setAiConfig(prev => ({ ...prev, model: e.target.value }))}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                >
                  {(PROVIDER_MODELS[aiConfig.provider] || []).map(m => (
                    <option key={m.id} value={m.id}>{m.label}{m.recommended ? ` (${t('settings.aiRecommended')})` : ''}</option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  placeholder={t('settings.aiModelPlaceholder')}
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
                  {aiConnectionStatus === 'testing' ? t('settings.aiTesting') : t('settings.aiTestConnection')}
                </button>
                {aiConnectionStatus === 'success' && (
                  <span className="text-xs text-green-500">{t('settings.aiConnected')}</span>
                )}
                {aiConnectionStatus === 'error' && !aiOllamaHelp && (
                  <span className="text-xs text-red-500">{aiConnectionMessage}</span>
                )}
              </div>
              {aiOllamaHelp && (
                <div className={`text-xs p-3 rounded-lg ${darkMode ? 'bg-red-900/30 border border-red-800/50' : 'bg-red-50 border border-red-200'}`}>
                  <p className="text-red-500 font-medium mb-1.5">{aiOllamaHelp}</p>
                  <ul className={`${textSecondary} space-y-1 ml-3 list-disc mb-2`}>
                    <li>{t('settings.aiOllamaRunning')}</li>
                    <li>{t('settings.aiOllamaCors')}</li>
                    <li>{t('settings.aiOllamaSetEnv')} <code className={`text-xs px-1 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>OLLAMA_ORIGINS={window.electronAPI?.isElectron ? '*' : window.location.origin}</code></li>
                  </ul>
                  <a
                    href="https://github.com/ollama/ollama/blob/main/docs/faq.md#how-do-i-configure-ollama-server"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-purple-500 hover:text-purple-400 underline flex items-center gap-1 w-fit"
                  >
                    {t('settings.aiOllamaSetupGuide')} <ExternalLink size={11} />
                  </a>
                </div>
              )}
            </div>

            <hr className={borderClass} />

            {/* Per-feature toggles */}
            <div className="space-y-3">
              <p className={`text-xs font-medium uppercase ${textSecondary}`}>{t('settings.aiFeaturesList')}</p>
              {[
                { key: 'voiceTaskInput', label: t('settings.aiVoiceTaskInput'), icon: <Mic size={14} /> },
                { key: 'morningSummary', label: t('settings.aiMorningSummary'), icon: <Sun size={14} /> },
                { key: 'eveningReflection', label: t('settings.aiEveningReflection'), icon: <Moon size={14} /> },
                { key: 'durationEstimate', label: t('settings.aiDurationEstimates'), icon: <Sparkles size={14} /> },
                { key: 'frameNudge', label: t('settings.aiFrameNudges'), icon: <Zap size={14} /> },
                { key: 'aiReschedule', label: t('settings.aiReschedule'), icon: <CalendarDays size={14} /> },
                { key: 'aiSubtasks', label: t('settings.aiSubtasks'), icon: <CheckSquare size={14} /> },
                { key: 'weeklySummary', label: t('settings.aiWeeklySummary'), icon: <BarChart3 size={14} /> },
                { key: 'smartScheduling', label: t('settings.aiSmartScheduling'), icon: <CalendarDays size={14} /> },
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
                    {f.comingSoon && <span className={`text-xs ${textSecondary} italic`}>{t('common.comingSoon')}</span>}
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
  {/* Cloud Sync sub-view */}
  {mobileSettingsView === 'cloudsync' && (() => {
    const currentProvider = cloudSyncConfig?.provider || 'nextcloud';
    const provider = cloudSyncProviders[currentProvider];
    return (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>
      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
        <Cloud size={18} className={cloudSyncConfig?.enabled ? 'text-blue-500' : textSecondary} />
        {t('settings.cloudSync')}
      </h4>
      <p className={`text-xs ${textSecondary}`}>{t('settings.cloudSyncDesc')}</p>
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
        cloudSyncStatus={cloudSyncStatus}
        cloudSyncError={cloudSyncError}
        cloudSyncNow={cloudSyncNow}
        vaultSyncNow={vaultSyncNow}
        vaultBootstrapSync={vaultBootstrapSync}
        vaultStatus={vaultStatus}
        vaultError={vaultError}
        vaultLastSynced={vaultLastSynced}
        vaultSkipped={vaultSkipped}
        onSyncKeyReady={(ready) => setSyncKeyReady(ready)}
      />
      {/* Apple platforms only — on Android/web every probe reports unsupported,
          so the panel would be an empty box. */}
      {isICloudAvailable() && (
        <>
          <ICloudSyncToggle
            darkMode={darkMode}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
            borderClass={borderClass}
          />
          <ICloudDiagnostics
            darkMode={darkMode}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
            borderClass={borderClass}
          />
        </>
      )}
    </div>
    );
  })()}

  {mobileSettingsView === 'obsidian' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>
      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
        <BookOpen size={18} className={obsidianConfig?.enabled ? 'text-purple-400' : textSecondary} />
        {t('settings.obsidianIntegration')}
      </h4>
      <p className={`text-xs ${textSecondary}`}>{t('settings.obsidianDesc')}</p>
      {!isNativeApp() && !isFileSystemAccessSupported() && (
        <p className={`text-xs text-amber-500`}>
          {t('settings.obsidianBrowserRequirement')}
        </p>
      )}
      {isNativeApp() ? (
        <div className="space-y-3">
          {obsidianConfig?.enabled ? (
            <div className={`flex items-center gap-2 text-sm ${textPrimary}`}>
              <FolderOpen size={14} className={textSecondary} />
              <span className="truncate">{t('settings.obsidianVaultConnected')}</span>
              <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
            </div>
          ) : (
            <p className={`text-xs ${textSecondary}`}>
              {t('settings.obsidianNoVaultConfigured', { defaultValue: 'No vault configured. Open settings to select your Obsidian vault folder.' })}
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
                {t('settings.obsidianVaultSettings')}
              </button>
            ) : (
              <button
                onClick={() => nativePickVault()}
                className={`px-3 py-2 rounded-lg flex items-center gap-2 text-sm ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-stone-100 text-stone-700'}`}
              >
                <FolderOpen size={14} />
                {obsidianConfig?.enabled ? t('settings.obsidianChangeVault') : t('settings.obsidianConnectVault')}
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
                  {obsidianSyncStatus === 'syncing' ? t('settings.syncing') : t('settings.syncNow')}
                </button>
                <button
                  onClick={() => {
                    nativeClearVault();
                    obsidianVaultHandleRef.current = null;
                    setObsidianConfig(null);
                    setObsidianLastSynced(null);
                    setWikilinkCandidates([]);
                    setUnportableVaultFiles?.([]);
                    localStorage.removeItem('day-planner-obsidian-last-synced');
                    setTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                    setUnscheduledTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                  }}
                  className={`px-3 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
                >
                  {t('common.disconnect')}
                </button>
              </>
            )}
          </div>
          {/* Daily notes folder */}
          {obsidianConfig?.enabled && (
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianDailyNotesFolder')}</label>
              <input
                type="text"
                placeholder={t('settings.obsidianVaultRootPlaceholder')}
                value={obsidianConfig.dailyNotesPath || ''}
                onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotesPath: e.target.value }))}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
              />
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianDailyNotesFolderHint')}</p>
            </div>
          )}
          {/* New notes folder */}
          {obsidianConfig?.enabled && (
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianNewNotesFolder')}</label>
              <input
                type="text"
                placeholder="dayGLANCE"
                value={obsidianConfig.newNotesFolder ?? 'dayGLANCE'}
                onChange={(e) => setObsidianConfig(prev => ({ ...prev, newNotesFolder: e.target.value }))}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
              />
                            {validateVaultFolderSetting(obsidianConfig.newNotesFolder) && (
                <p className="text-xs text-red-500 mt-1">{validateVaultFolderSetting(obsidianConfig.newNotesFolder)}</p>
              )}
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianNewNotesFolderHint')}</p>
            </div>
          )}
          {/* Filename pattern */}
          {obsidianConfig?.enabled && (
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianFilenamePattern')}</label>
              <input
                type="text"
                placeholder="yyyy-MM-dd"
                value={obsidianConfig.dailyNotePattern ?? 'yyyy-MM-dd'}
                onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotePattern: e.target.value }))}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
              />
                            {validateDailyNotePattern(obsidianConfig.dailyNotePattern, formatDatePattern) && (
                <p className="text-xs text-red-500 mt-1">{validateDailyNotePattern(obsidianConfig.dailyNotePattern, formatDatePattern)}</p>
              )}
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianFilenamePatternHint')}</p>
            </div>
          )}
          {/* Task heading — same as web */}
          {obsidianConfig?.enabled && (
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianTaskHeading')}</label>
              <input
                type="text"
                placeholder={buildLocalizedTaskHeading(t)}
                value={obsidianConfig.taskHeading ?? ''}
                onChange={(e) => setObsidianConfig(prev => ({ ...prev, taskHeading: e.target.value }))}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
              />
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianTaskHeadingHint', { defaultValue: 'Markdown heading under which new tasks are appended in daily notes.' })}</p>
            </div>
          )}
          {/* Daily note template — same as web */}
          {obsidianConfig?.enabled && (
            <div>
              <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianDailyNoteTemplate')}</label>
              <textarea
                value={dailyNoteTemplate}
                onChange={(e) => setDailyNoteTemplate(e.target.value)}
                placeholder={t('settings.obsidianDailyNoteTemplatePlaceholder')}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white placeholder:text-gray-500' : 'bg-white text-stone-900 placeholder:text-stone-400'} text-sm resize-y`}
                rows={4}
              />
            </div>
          )}
          {launchOnWritePlatform && obsidianConfig?.enabled && (
            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={effectiveLaunchOnWrite(obsidianLaunchOnWrite, launchOnWritePlatform)}
                    onChange={(e) => setObsidianLaunchOnWrite(e.target.checked ? 'on' : 'off')}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${effectiveLaunchOnWrite(obsidianLaunchOnWrite, launchOnWritePlatform) ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${effectiveLaunchOnWrite(obsidianLaunchOnWrite, launchOnWritePlatform) ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>{t('settings.obsidianLaunchOnWrite')}</span>
              </label>
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianLaunchOnWriteHintAndroid')}</p>
            </div>
          )}
          {obsidianConfig?.enabled && (
            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={obsidianCompletionDates}
                    onChange={(e) => setObsidianCompletionDates(e.target.checked)}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${obsidianCompletionDates ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${obsidianCompletionDates ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>{t('settings.obsidianCompletionDates')}</span>
              </label>
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianCompletionDatesHint')}</p>
            </div>
          )}
          {obsidianConfig?.enabled && (
            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={!!obsidianConfig.completionLogEnabled}
                    onChange={(e) => setObsidianConfig(prev => ({ ...prev, completionLogEnabled: e.target.checked }))}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${obsidianConfig.completionLogEnabled ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${obsidianConfig.completionLogEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>{t('settings.obsidianCompletionLog')}</span>
              </label>
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianCompletionLogHint')}</p>
              {obsidianConfig.completionLogEnabled && (
                <input
                  type="text"
                  placeholder="## Completed"
                  value={obsidianConfig.completionLogHeading || ''}
                  onChange={(e) => setObsidianConfig(prev => ({ ...prev, completionLogHeading: e.target.value }))}
                  className={`mt-2 w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                />
              )}
            </div>
          )}
          {obsidianSyncStatus === 'success' && <p className="text-xs text-green-500">{t('settings.obsidianSyncComplete')}</p>}
          {obsidianSyncStatus === 'error' && <p className="text-xs text-red-500">{t('settings.obsidianSyncFailed')}</p>}
          {obsidianLastSynced && obsidianConfig?.enabled && (
            <p className={`text-xs ${textSecondary}`}>{t('common.lastSynced')}: {new Date(obsidianLastSynced).toLocaleString()}</p>
          )}
          {/* §6 mode indicator, native flavor (three states — see
              BridgeStatusPanel): this panel is THE settings surface on
              phones, so without it a phone that silently fell back to
              direct mode (the 2026-08-31 plugin-settings-sync incident)
              had no UI saying so anywhere it could see. */}
          {obsidianConfig?.enabled && (
            <BridgeStatusPanel darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass} />
          )}
        </div>
      ) : obsidianConfig?.enabled ? (
        <div className="space-y-3">
          <div className={`flex items-center gap-2 text-sm ${textPrimary}`}>
            <FolderOpen size={14} className={textSecondary} />
            <span className="truncate">{obsidianConfig.vaultName || t('settings.obsidianVaultConnected')}</span>
            <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
          </div>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianDailyNotesFolder')}</label>
            <input
              type="text"
              placeholder={t('settings.obsidianVaultRootPlaceholder')}
              value={obsidianConfig.dailyNotesPath || ''}
              onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotesPath: e.target.value }))}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
            />
            <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianDailyNotesFolderHint')}</p>
          </div>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianNewNotesFolder')}</label>
            <input
              type="text"
              placeholder="dayGLANCE"
              value={obsidianConfig.newNotesFolder ?? 'dayGLANCE'}
              onChange={(e) => setObsidianConfig(prev => ({ ...prev, newNotesFolder: e.target.value }))}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
            />
                          {validateVaultFolderSetting(obsidianConfig.newNotesFolder) && (
                <p className="text-xs text-red-500 mt-1">{validateVaultFolderSetting(obsidianConfig.newNotesFolder)}</p>
              )}
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianNewNotesFolderHint')}</p>
          </div>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianFilenamePattern')}</label>
            <input
              type="text"
              placeholder="yyyy-MM-dd"
              value={obsidianConfig.dailyNotePattern ?? 'yyyy-MM-dd'}
              onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotePattern: e.target.value }))}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
            />
                          {validateDailyNotePattern(obsidianConfig.dailyNotePattern, formatDatePattern) && (
                <p className="text-xs text-red-500 mt-1">{validateDailyNotePattern(obsidianConfig.dailyNotePattern, formatDatePattern)}</p>
              )}
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianFilenamePatternHint')}</p>
          </div>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianTaskHeading')}</label>
            <input
              type="text"
              placeholder={buildLocalizedTaskHeading(t)}
              value={obsidianConfig.taskHeading ?? ''}
              onChange={(e) => setObsidianConfig(prev => ({ ...prev, taskHeading: e.target.value }))}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
            />
            <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianTaskHeadingHint', { defaultValue: 'Markdown heading under which new tasks are appended in daily notes.' })}</p>
          </div>
          <div>
            <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.obsidianDailyNoteTemplate')}</label>
            <textarea
              value={dailyNoteTemplate}
              onChange={(e) => setDailyNoteTemplate(e.target.value)}
              placeholder={t('settings.obsidianDailyNoteTemplatePlaceholder')}
              className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 ${darkMode ? 'bg-gray-700 text-white placeholder:text-gray-500' : 'bg-white text-stone-900 placeholder:text-stone-400'} text-sm resize-y`}
              rows={4}
            />
          </div>
          {launchOnWritePlatform && (
            <div>
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input
                    type="checkbox"
                    checked={effectiveLaunchOnWrite(obsidianLaunchOnWrite, launchOnWritePlatform)}
                    onChange={(e) => setObsidianLaunchOnWrite(e.target.checked ? 'on' : 'off')}
                    className="sr-only"
                  />
                  <div className={`w-10 h-6 rounded-full transition-colors ${effectiveLaunchOnWrite(obsidianLaunchOnWrite, launchOnWritePlatform) ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${effectiveLaunchOnWrite(obsidianLaunchOnWrite, launchOnWritePlatform) ? 'translate-x-5' : 'translate-x-1'}`} />
                  </div>
                </div>
                <span className={`text-sm ${textPrimary}`}>{t('settings.obsidianLaunchOnWrite')}</span>
              </label>
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianLaunchOnWriteHint')}</p>
            </div>
          )}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={obsidianCompletionDates}
                  onChange={(e) => setObsidianCompletionDates(e.target.checked)}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${obsidianCompletionDates ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${obsidianCompletionDates ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
              </div>
              <span className={`text-sm ${textPrimary}`}>{t('settings.obsidianCompletionDates')}</span>
            </label>
            <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianCompletionDatesHint')}</p>
          </div>
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={!!obsidianConfig?.completionLogEnabled}
                  onChange={(e) => setObsidianConfig(prev => ({ ...prev, completionLogEnabled: e.target.checked }))}
                  className="sr-only"
                />
                <div className={`w-10 h-6 rounded-full transition-colors ${obsidianConfig?.completionLogEnabled ? 'bg-purple-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                  <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${obsidianConfig?.completionLogEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                </div>
              </div>
              <span className={`text-sm ${textPrimary}`}>{t('settings.obsidianCompletionLog')}</span>
            </label>
            <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.obsidianCompletionLogHint')}</p>
            {obsidianConfig?.completionLogEnabled && (
              <input
                type="text"
                placeholder="## Completed"
                value={obsidianConfig.completionLogHeading || ''}
                onChange={(e) => setObsidianConfig(prev => ({ ...prev, completionLogHeading: e.target.value }))}
                className={`mt-2 w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
              />
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => performObsidianSync()}
              disabled={obsidianSyncStatus === 'syncing'}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <RefreshCw size={14} className={obsidianSyncStatus === 'syncing' ? 'animate-spin' : ''} />
              {obsidianSyncStatus === 'syncing' ? t('common.syncing') : t('common.syncNow')}
            </button>
            <button
              onClick={async () => {
                await disconnectVault();
                obsidianVaultHandleRef.current = null;
                setObsidianConfig(null);
                setObsidianLastSynced(null);
                setUnportableVaultFiles?.([]);
                localStorage.removeItem('day-planner-obsidian-last-synced');
                setTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                setUnscheduledTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
              }}
              className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
            >
              {t('common.disconnect')}
            </button>
          </div>
          {obsidianSyncStatus === 'success' && <p className="text-xs text-green-500">{t('settings.obsidianSyncComplete')}</p>}
          {obsidianSyncStatus === 'error' && (
            <p className="text-xs text-red-500">
              {obsidianSyncError
                ? t('settings.obsidianSyncFailedWithError', { error: obsidianSyncError, defaultValue: 'Sync failed: {{error}}' })
                : t('settings.obsidianSyncFailed')}
            </p>
          )}
          {obsidianLastSynced && (
            <p className={`text-xs ${textSecondary}`}>{t('common.lastSynced')}: {new Date(obsidianLastSynced).toLocaleString()}</p>
          )}
          <UnportableVaultNamesPanel entries={unportableVaultFiles} darkMode={darkMode} textSecondary={textSecondary} />
        </div>
      ) : (
        <button
          onClick={async () => {
            if (!isFileSystemAccessSupported()) {
              alert(t('settings.obsidianBrowserUnsupported'));
              return;
            }
            const handle = await requestVaultAccess();
            if (handle) {
              obsidianVaultHandleRef.current = handle;
              setObsidianConfig({ enabled: true, dailyNotesPath: '', vaultName: handle.name });
              scanVaultNotes(handle).then(({ names, unportable }) => { setWikilinkCandidates(names); setUnportableVaultFiles?.(unportable); }).catch(() => {});
            }
          }}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm"
        >
          <FolderOpen size={14} />
          {t('settings.obsidianSelectVault')}
        </button>
      )}
    </div>
  )}

  {/* GLANCE Integrations sub-view */}
  {mobileSettingsView === 'intent' && (() => {
    const inputCls = `w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder:text-gray-400' : 'bg-white text-stone-900 placeholder:text-stone-400'} text-sm`;
    const labelCls = `block text-sm ${textSecondary} mb-1`;
    const sectionCls = `text-xs font-semibold uppercase tracking-wide ${textSecondary} px-1 mb-2`;

    const fgOptions = [
      { label: t('focus.secondsShort', { count: 30 }), value: 30000 },
      { label: t('common.minutesShort', { count: 1 }), value: 60000 },
      { label: t('common.minutesShort', { count: 2 }), value: 120000 },
      { label: t('common.minutesShort', { count: 5 }), value: 300000 },
      { label: t('common.minutesShort', { count: 10 }), value: 600000 },
      { label: t('common.minutesShort', { count: 30 }), value: 1800000 },
    ];
    const bgOptions = [
      { label: t('common.minutesShort', { count: 5 }), value: 300000 },
      { label: t('common.minutesShort', { count: 15 }), value: 900000 },
      { label: t('common.minutesShort', { count: 30 }), value: 1800000 },
      { label: t('common.hoursShort', { count: 1, defaultValue: '{{count}} hr' }), value: 3600000 },
      { label: t('common.hoursShort', { count: 6, defaultValue: '{{count}} hr' }), value: 21600000 },
      { label: t('common.hoursShort', { count: 24, defaultValue: '{{count}} hr' }), value: 86400000 },
    ];

    return (
      <div className="px-4 py-4 space-y-5">
        <button
          onClick={() => setMobileSettingsView('main')}
          className={`flex items-center gap-2 ${textSecondary} mb-2`}
        >
          <ChevronLeft size={18} />
          <span className="text-sm font-medium">{t('common.settings')}</span>
        </button>
        <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
          <Activity size={18} className={intentForm.webdavUrl ? 'text-blue-500' : textSecondary} />
          {t('settings.glanceIntegrations')}
        </h4>
        <p className={`text-xs ${textSecondary} -mt-3`}>
          {t('settings.glanceIntegrationsDesc')}
        </p>

        {/* Automation intents (Tasker) — Android only. Opt-in gate for the
            exported IntentReceiver + outbound RESULT/NOTIFY broadcasts. */}
        {isNativeAndroid() && (
          <div>
            <h5 className={sectionCls}>{t('settings.automationIntents')}</h5>
            <p className={`text-xs ${textSecondary} mb-2`}>{t('settings.automationIntentsDesc')}</p>
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass}`}>
              <input
                type="checkbox"
                id="automation-intents-toggle-mobile"
                checked={automationIntentsEnabled}
                onChange={e => {
                  const v = e.target.checked;
                  setAutomationIntentsEnabled(v);
                  nativeSetAutomationIntentsEnabled(v);
                }}
                className="mt-0.5 h-4 w-4 rounded"
              />
              <div>
                <label htmlFor="automation-intents-toggle-mobile" className={`text-sm font-medium ${textPrimary} cursor-pointer`}>
                  {t('settings.automationIntentsToggle')}
                </label>
                <p className={`text-xs ${textSecondary} mt-0.5`}>{t('settings.automationIntentsWarning')}</p>
              </div>
            </div>
          </div>
        )}

        {/* WebDAV endpoint */}
        <div>
          <h5 className={sectionCls}>{t('settings.glanceWebdavEndpoint')}</h5>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t('settings.glanceServerUrl')}</label>
              <input
                type="url"
                placeholder="https://nextcloud.example.com/remote.php/dav/files/user"
                value={intentForm.webdavUrl}
                onChange={e => setIntentForm(p => ({ ...p, webdavUrl: e.target.value }))}
                className={inputCls}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
            <div>
              <label className={labelCls}>{t('common.username')}</label>
              <input
                type="text"
                placeholder={t('common.username')}
                value={intentForm.username}
                onChange={e => setIntentForm(p => ({ ...p, username: e.target.value }))}
                className={inputCls}
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>
            <div>
              <label className={labelCls}>{t('settings.appPassword')}</label>
              <input
                type="password"
                placeholder="••••••••••••"
                value={intentForm.appPassword}
                onChange={e => setIntentForm(p => ({ ...p, appPassword: e.target.value }))}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>{t('settings.glanceEventsPath')}</label>
              <input
                type="text"
                placeholder="/GLANCE/events/"
                value={intentForm.eventsPath}
                onChange={e => setIntentForm(p => ({ ...p, eventsPath: e.target.value }))}
                className={inputCls}
                autoCapitalize="none"
                autoCorrect="off"
              />
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.glanceEventsPathHint')}</p>
            </div>
          </div>
        </div>

        {/* Poll cadence */}
        <div>
          <h5 className={sectionCls}>{t('settings.glancePollCadence')}</h5>
          <div className="space-y-3">
            <div>
              <label className={labelCls}>{t('settings.glanceForegroundPoll')}</label>
              <select
                value={intentForm.foregroundInterval}
                onChange={e => setIntentForm(p => ({ ...p, foregroundInterval: Number(e.target.value) }))}
                className={inputCls}
              >
                {fgOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.glanceForegroundPollHint', { defaultValue: 'How often to check for new events while the app is in the foreground.' })}</p>
            </div>
            <div>
              <label className={labelCls}>{t('settings.glanceBackgroundPoll')}</label>
              <select
                value={intentForm.backgroundInterval}
                onChange={e => setIntentForm(p => ({ ...p, backgroundInterval: Number(e.target.value) }))}
                className={inputCls}
              >
                {bgOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.glanceBackgroundPollHint', { defaultValue: 'How often to check while the browser tab is hidden.' })}</p>
            </div>
          </div>
        </div>

        {/* Retention */}
        <div>
          <h5 className={sectionCls}>{t('settings.glanceMaintenance')}</h5>
          <div>
            <label className={labelCls}>{t('settings.glanceRetentionDays')}</label>
            <input
              type="number"
              min={1}
              max={365}
              value={intentForm.gcRetentionDays}
              onChange={e => setIntentForm(p => ({ ...p, gcRetentionDays: e.target.value }))}
              className={inputCls}
            />
            <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.glanceRetentionHint')}</p>
          </div>
        </div>

        {/* Encryption */}
        <div>
          <h5 className={sectionCls}>{t('settings.glanceEncryption')}</h5>
          <div className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass} ${cloudSyncConfig?.encryptionEnabled ? '' : 'opacity-60'}`}>
            <input
              type="checkbox"
              id="intent-encryption-toggle-mobile"
              checked={intentForm.encryptionEnabled && !!cloudSyncConfig?.encryptionEnabled}
              disabled={!cloudSyncConfig?.encryptionEnabled || intentSetupPhase !== null}
              onChange={e => setIntentForm(p => ({ ...p, encryptionEnabled: e.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded"
            />
            <div>
              <label htmlFor="intent-encryption-toggle-mobile" className={`text-sm font-medium ${textPrimary} ${cloudSyncConfig?.encryptionEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                {t('settings.glanceEncryptEvents')}
              </label>
              {cloudSyncConfig?.encryptionEnabled ? (
                <p className={`text-xs ${textSecondary} mt-0.5`}>{t('settings.glanceEncryptionEnabledHint')}</p>
              ) : (
                <p className={`text-xs ${textSecondary} mt-0.5`}>{t('settings.glanceEncryptionRequiredHint')}</p>
              )}
            </div>
          </div>
          {intentSetupPhase === 'passphrase-needed' && (
            <div className={`mt-2 p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
              <div className="flex items-center gap-2 mb-2">
                <Lock size={13} className="text-blue-500 flex-shrink-0" />
                <span className={`text-sm font-medium ${textPrimary}`}>{t('settings.intentsPassphraseSetupTitle')}</span>
              </div>
              <p className={`text-xs ${textSecondary} mb-3`}>{t('settings.intentsPassphraseSetupHint')}</p>
              <input
                type="password"
                autoFocus
                value={intentPassphraseInput}
                onChange={e => setIntentPassphraseInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Escape') { setIntentSetupPhase(null); setIntentPassphraseInput(''); } }}
                placeholder={t('sync.passphrasePlaceholder')}
                className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm mb-2`}
              />
              <div className="flex gap-2">
                <button
                  disabled={!intentPassphraseInput.trim()}
                  onClick={async () => {
                    const passphrase = intentPassphraseInput.trim();
                    setSyncPassphrase(passphrase);
                    setIntentPassphraseInput('');
                    setIntentSetupPhase('running');
                    const cfg = { ...intentForm, gcRetentionDays: Number(intentForm.gcRetentionDays) || 30, encryptionEnabled: true };
                    try {
                      await setupIntentsEncryption(cfg, passphrase);
                      if (cfg.webdavUrl || cfg.username || cfg.appPassword) {
                        localStorage.setItem(INTENT_CONFIG_KEY, JSON.stringify(cfg));
                      }
                      setIntentSetupPhase(null);
                      setIntentSaved(true);
                      setTimeout(() => setIntentSaved(false), 2000);
                    } catch (err) {
                      setIntentSetupPhase({ error: err.message });
                    }
                  }}
                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {t('common.confirm')}
                </button>
                <button
                  onClick={() => { setIntentSetupPhase(null); setIntentPassphraseInput(''); }}
                  className={`px-3 py-1.5 ${darkMode ? 'bg-gray-600 hover:bg-gray-500' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
                >
                  {t('common.cancel')}
                </button>
              </div>
            </div>
          )}
          {intentSetupPhase === 'running' && (
            <div className={`mt-2 flex items-center gap-2 p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
              <Loader size={14} className="animate-spin text-blue-500" />
              <span className={`text-sm ${textSecondary}`}>{t('settings.intentsEncryptionSettingUp')}</span>
            </div>
          )}
          {intentSetupPhase?.error && (
            <div className={`mt-2 p-3 rounded-lg border border-red-300 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
              <p className="text-sm text-red-500">{t('settings.intentsSetupFailed', { error: intentSetupPhase.error })}</p>
              <button onClick={() => setIntentSetupPhase(null)} className="mt-1 text-xs text-red-400 hover:text-red-300 underline">{t('common.dismiss')}</button>
            </div>
          )}
        </div>

        {/* Save */}
        <div className="flex items-center gap-3">
          <button
            disabled={intentSetupPhase === 'running' || intentSetupPhase === 'passphrase-needed'}
            onClick={async () => {
              const wantsEncryption = intentForm.encryptionEnabled && !!cloudSyncConfig?.encryptionEnabled;
              const cfg = { ...intentForm, gcRetentionDays: Number(intentForm.gcRetentionDays) || 30, encryptionEnabled: wantsEncryption };
              if (!wantsEncryption) {
                await clearIntentsRootKey();
              }
              if (wantsEncryption) {
                const rootKey = await loadIntentsRootKey();
                if (!rootKey) {
                  const passphrase = getSyncPassphrase();
                  if (passphrase) {
                    setIntentSetupPhase('running');
                    try {
                      await setupIntentsEncryption(cfg, passphrase);
                    } catch (err) {
                      setIntentSetupPhase({ error: err.message });
                      return;
                    }
                    setIntentSetupPhase(null);
                  } else {
                    setIntentSetupPhase('passphrase-needed');
                    return;
                  }
                }
              }
              if (cfg.webdavUrl || cfg.username || cfg.appPassword) {
                localStorage.setItem(INTENT_CONFIG_KEY, JSON.stringify(cfg));
              } else {
                localStorage.removeItem(INTENT_CONFIG_KEY);
              }
              setIntentSaved(true);
              setTimeout(() => setIntentSaved(false), 2000);
            }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-1.5"
          >
            {intentSetupPhase === 'running' && <Loader size={13} className="animate-spin" />}
            {intentSaved ? t('common.saved') : t('common.save')}
          </button>
          {intentForm.webdavUrl && (
            <button
              onClick={() => {
                setIntentForm({ webdavUrl: '', username: '', appPassword: '', eventsPath: '/GLANCE/events/', foregroundInterval: 120000, backgroundInterval: 900000, gcRetentionDays: 30, encryptionEnabled: false });
                localStorage.removeItem(INTENT_CONFIG_KEY);
                clearIntentsRootKey();
              }}
              className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
            >
              {t('common.disconnect')}
            </button>
          )}
        </div>

        {/* Activity log shortcut */}
        <div>
          <h5 className={sectionCls}>{t('settings.glanceActivity')}</h5>
          <button
            onClick={() => setShowIntentActivityLog(true)}
            className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
          >
            <Activity size={20} className={textSecondary} />
            <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t('settings.glanceActivityLog')}</span>
            <ChevronRight size={18} className={textSecondary} />
          </button>
        </div>

        {/* GLANCEvault intents (beta) — DB transport. Independent of the WebDAV
            intents config above AND of the vault sync toggle; it only INHERITS the
            vault connection from the GLANCEvault sync config. */}
        <div>
          <h5 className={sectionCls}>
            <span className="flex items-center gap-2">
              <Server size={14} className={textSecondary} />
              {t('settings.glanceVaultIntents')}
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-600'}`}>{t('settings.beta')}</span>
            </span>
          </h5>
          <p className={`${textSecondary} text-xs mb-3`}>
            {t('settings.glanceVaultIntentsDesc')}
          </p>
          {(() => {
            const dbConn = getDbIntentsConnection();
            return (
              <div className="space-y-3">
                <div className={`text-xs px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/40' : 'bg-stone-50'}`}>
                  {dbConn ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                      <span className={textSecondary}>{t('settings.glanceVaultConnectionReady')}</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                      <span className={textSecondary}>{t('settings.glanceVaultConnectionMissing')}</span>
                    </span>
                  )}
                </div>

                <div className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass} ${dbConn ? '' : 'opacity-60'}`}>
                  <input
                    type="checkbox"
                    id="db-intents-toggle-mobile"
                    checked={dbIntentsEnabled}
                    disabled={!dbConn}
                    onChange={e => setDbIntentsEnabled(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded"
                  />
                  <div>
                    <label htmlFor="db-intents-toggle-mobile" className={`text-sm font-medium ${textPrimary} ${dbConn ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                      {t('settings.glanceVaultIntentsEnable')}
                    </label>
                    <p className={`text-xs ${textSecondary} mt-0.5`}>
                      {t('settings.glanceVaultIntentsHint')}
                    </p>
                  </div>
                </div>

                {/* Vault intents are ALWAYS encrypted. Enabling derives + caches the
                    vault intents key BEFORE the reload; prompt only when the passphrase
                    is actually unavailable. */}
                {dbIntentsSetupPhase === 'passphrase-needed' && (
                  <div className={`p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                    <p className={`text-sm ${textPrimary} mb-2`}>
                      {t('settings.glanceVaultPassphrasePrompt')}
                    </p>
                    <input
                      type="password"
                      autoFocus
                      value={dbIntentsPassphraseInput}
                      onChange={e => setDbIntentsPassphraseInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setDbIntentsSetupPhase(null); setDbIntentsPassphraseInput(''); setDbIntentsEnabled(false); } }}
                      placeholder={t('sync.passphrasePlaceholder')}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm mb-2`}
                    />
                    <div className="flex gap-2">
                      <button
                        disabled={!dbIntentsPassphraseInput.trim()}
                        onClick={async () => {
                          const passphrase = dbIntentsPassphraseInput.trim();
                          setSyncPassphrase(passphrase);
                          setDbIntentsPassphraseInput('');
                          setDbIntentsSetupPhase('running');
                          try {
                            await setupVaultIntentsEncryption(passphrase);
                          } catch (err) {
                            setDbIntentsSetupPhase({ error: err.message });
                            return;
                          }
                          const existing = getDbIntentsConfig() || {};
                          setDbIntentsConfig({ ...existing, enabled: true });
                          window.location.reload();
                        }}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                      >
                        {t('common.confirm')}
                      </button>
                      <button
                        onClick={() => { setDbIntentsSetupPhase(null); setDbIntentsPassphraseInput(''); setDbIntentsEnabled(false); }}
                        className={`px-3 py-1.5 ${darkMode ? 'bg-gray-600 hover:bg-gray-500' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm`}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                    <p className="text-xs text-amber-500 mt-2">
                      {t('settings.glanceVaultEncryptionRequired')}
                    </p>
                  </div>
                )}
                {dbIntentsSetupPhase === 'running' && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                    <Loader size={14} className="animate-spin text-blue-500" />
                    <span className={`text-sm ${textSecondary}`}>{t('settings.glanceVaultEncryptionSettingUp')}</span>
                  </div>
                )}
                {dbIntentsSetupPhase?.error && (
                  <div className={`p-3 rounded-lg border border-red-300 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
                    <p className="text-sm text-red-500">{t('settings.intentsSetupFailed', { error: dbIntentsSetupPhase.error })}</p>
                    <button
                      onClick={() => { setDbIntentsSetupPhase(null); setDbIntentsEnabled(false); }}
                      className="mt-1 text-xs text-red-400 hover:text-red-300 underline"
                    >
                      {t('common.dismiss')}
                    </button>
                  </div>
                )}

                <button
                  disabled={dbIntentsSetupPhase === 'running' || dbIntentsSetupPhase === 'passphrase-needed'}
                  onClick={async () => {
                    // Match-by-construction: spread the EXISTING config and override
                    // only `enabled`, so ttlMs / pollIntervalMinutes are preserved.
                    // Persist via the config module's saver to the key the gate reads.
                    const existing = getDbIntentsConfig() || {};
                    const wasEnabled = !!existing.enabled;
                    // Vault intents are always encrypted — derive + cache the vault
                    // intents key BEFORE the reload (the passphrase is gone after).
                    if (dbIntentsEnabled) {
                      let res;
                      try {
                        res = await ensureVaultIntentsKey();
                      } catch (err) {
                        setDbIntentsSetupPhase({ error: err.message });
                        return; // do NOT enable without a key
                      }
                      if (res.needsPassphrase) {
                        setDbIntentsSetupPhase('passphrase-needed');
                        return; // prompt; its confirm finishes save + reload
                      }
                    }
                    setDbIntentsConfig({ ...existing, enabled: dbIntentsEnabled });
                    // Reload-on-change so useDbIntentPoller remounts (mirrors the
                    // GLANCEvault sync toggle's behavior). The post-reload
                    // useOutboxFlush mount drain flushes held intents now the key exists.
                    if (wasEnabled !== dbIntentsEnabled) {
                      window.location.reload();
                      return;
                    }
                    // No reload (already enabled): key may have just been set up — flush now.
                    await flushOutboxNow();
                    setDbIntentsSaved(true);
                    setTimeout(() => setDbIntentsSaved(false), 2000);
                  }}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {dbIntentsSaved ? t('common.saved') : t('common.save')}
                </button>
              </div>
            );
          })()}
        </div>

        {/* iCloud intents opt-in — Apple platforms only (isICloudAvailable() is
            false on Android/web). Gates ACTIVATION of the iCloud intents transport
            (emit + poll); default OFF so the path stays inert until the user opts in. */}
        {isICloudAvailable() && (
          <div>
            <h5 className={sectionCls}>
              <span className="flex items-center gap-2">
                <Cloud size={14} className={textSecondary} />
                {t('settings.icloudIntents')}
              </span>
            </h5>
            <p className={`${textSecondary} text-xs mb-3`}>
              {t('settings.icloudIntentsDesc')}
            </p>
            <div className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass}`}>
              <input
                type="checkbox"
                id="icloud-intents-toggle-mobile"
                checked={icloudIntentsEnabled}
                onChange={e => setIcloudIntentsEnabledState(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded"
              />
              <div>
                <label htmlFor="icloud-intents-toggle-mobile" className={`text-sm font-medium ${textPrimary} cursor-pointer`}>
                  {t('settings.icloudIntentsEnable')}
                </label>
              </div>
            </div>
            <button
              onClick={() => {
                const wasEnabled = getIcloudIntentsEnabledFlag();
                setIcloudIntentsEnabled(icloudIntentsEnabled);
                // Reload so the intent poller remounts and re-reads the opt-in
                // (mirrors the GLANCEvault intents toggle's reload-on-change).
                if (wasEnabled !== icloudIntentsEnabled) {
                  window.location.reload();
                  return;
                }
                setIcloudIntentsSaved(true);
                setTimeout(() => setIcloudIntentsSaved(false), 2000);
              }}
              className="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
            >
              {icloudIntentsSaved ? t('common.saved') : t('common.save')}
            </button>
          </div>
        )}
      </div>
    );
  })()}

  {/* Frames sub-view */}
  {mobileSettingsView === 'frames' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>

      {/* Tab switcher — only show when AI scheduling is enabled */}
      {aiConfig?.enabled && aiConfig.features?.smartScheduling && (
        <div className={`flex rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-stone-200'} p-0.5`}>
          <button
            onClick={() => setFramesModalTab('frames')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${framesModalTab === 'frames' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900 shadow-sm') : textSecondary}`}
          >
            {t('frames.tabMyFrames')}
          </button>
          <button
            onClick={() => setFramesModalTab('schedule')}
            className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${framesModalTab === 'schedule' ? (darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900 shadow-sm') : textSecondary}`}
          >
            {t('frames.tabSmartSchedule')}
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
                const visibleFrames = myFrames.filter(f => !f.singleDate || f.singleDate >= todayStr);
                return visibleFrames.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <LayoutGrid size={48} className={textSecondary} />
                    <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('frames.noFramesTitle')}</h3>
                    <p className={`text-sm ${textSecondary} text-center max-w-xs`}>
                      {t('frames.noFramesDesc')}
                    </p>
                    <button
                      onClick={() => setEditingFrame('new')}
                      className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                    >
                      <Plus size={16} />
                      {t('frames.createFrame')}
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
                          {frame.singleDate && <span className={`text-[10px] px-1.5 py-0.5 rounded ${darkMode ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>{t('frames.oneTime')}</span>}
                          {!frame.enabled && <span className={`text-[10px] px-1.5 py-0.5 rounded ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} ${textSecondary}`}>{t('common.off')}</span>}
                        </div>
                        <div className={`text-xs ${textSecondary} mt-1`}>
                          {formatTime(frame.start)} – {formatTime(frame.end)} · {frame.singleDate
                            ? formatLocalizedDate(new Date(frame.singleDate + 'T12:00:00'), { month: 'short', day: 'numeric' })
                            : frame.days.map(d => localizedWeekdays('short')[d]).join(', ')}
                        </div>
                      </div>
                    ))}
                    <button
                      onClick={() => setEditingFrame('new')}
                      className={`w-full p-3 rounded-lg border border-dashed ${borderClass} text-sm ${textSecondary} flex items-center justify-center gap-2 ${hoverBg} transition-colors`}
                    >
                      <Plus size={16} />
                      {t('frames.addFrame')}
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
          inboxTasks={unscheduledTasks.filter(t => notBucketed(t) && !t.completed && !t.isExample)}
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
          gtdFrames={myFrames}
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
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>

      {/* Enable/disable toggle */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${borderClass} ${cardBg}`}>
        <div className="flex items-center gap-3">
          <Activity size={20} className={habitsEnabled ? 'text-green-500' : textSecondary} />
          <span className={`text-sm font-medium ${textPrimary}`}>{t('settings.habitTracking')}</span>
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
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('common.name')}</label>
                    <input
                      type="text"
                      placeholder={t('habit.habitNamePlaceholder')}
                      value={editingHabit.name || ''}
                      onChange={(e) => setEditingHabit(prev => ({ ...prev, name: e.target.value }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('common.type')}</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingHabit(prev => ({ ...prev, type: 'doMore' }))}
                        className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${editingHabit.type === 'doMore' ? 'bg-blue-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-100 text-stone-700')}`}
                      >{t('habit.doMore')}</button>
                      <button
                        onClick={() => setEditingHabit(prev => ({ ...prev, type: 'limit' }))}
                        className={`flex-1 px-3 py-2 text-sm rounded-lg transition-colors ${editingHabit.type === 'limit' ? 'bg-red-600 text-white' : (darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-100 text-stone-700')}`}
                      >{t('habit.limit')}</button>
                    </div>
                    <p className={`text-xs ${textSecondary} mt-1`}>{editingHabit.type === 'doMore' ? t('habit.habitDoMoreHint') : t('habit.habitLimitHint')}</p>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{editingHabit.type === 'doMore' ? t('habit.habitDailyGoal') : t('habit.habitDailyLimit')}</label>
                      <input
                        type="number"
                        min="1"
                        value={editingHabit.target || ''}
                        onChange={(e) => setEditingHabit(prev => ({ ...prev, target: parseInt(e.target.value) || 0 }))}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      />
                    </div>
                    <div className="flex-1">
                      <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('common.unit')}</label>
                      <input
                        type="text"
                        placeholder={t('habit.habitUnitPlaceholder')}
                        value={editingHabit.unit || ''}
                        onChange={(e) => setEditingHabit(prev => ({ ...prev, unit: e.target.value }))}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      />
                    </div>
                  </div>
                  {/* Scheduled days -- hidden for auto-synced habits */}
                  {editingHabit.source !== 'healthConnect' && (() => {
                    const DOW_LABELS = localizedWeekdays('narrow');
                    const days = editingHabit.scheduledDays ?? [0, 1, 2, 3, 4, 5, 6];
                    return (
                      <div>
                        <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('habit.activeDays')}</label>
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
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('common.icon')}</label>
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
                    <label className={`block text-sm font-medium ${textSecondary} mb-1`}>{t('common.color')}</label>
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
                    >{t('common.cancel')}</button>
                    <button
                      onClick={() => {
                        if (!editingHabit.name?.trim()) return;
                        if (isNew) { addHabit(editingHabit); } else { updateHabit(editingHabit.id, editingHabit); }
                        setEditingHabit(null);
                      }}
                      disabled={!editingHabit.name?.trim() || !editingHabit.target}
                      className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >{isNew ? t('habit.addHabit') : t('common.save')}</button>
                  </div>
                </div>
              );
            })()
          ) : (
            /* Habit list */
            <>
              <div className="mb-3">
                <UserOwnerSwitcher
                  enabled={multiUserEnabled}
                  users={users}
                  value={hrViewUserSyncId}
                  onChange={setHrViewUserSyncId}
                  darkMode={darkMode}
                  borderClass={borderClass}
                  textSecondary={textSecondary}
                  label={t('habit.habitsFor', { defaultValue: 'Habits for' })}
                />
              </div>
              {activeHabits.length === 0 ? (
                <div className={`text-center py-8 ${textSecondary}`}>
                  <Activity size={40} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">{t('habit.noHabitsYet')}</p>
                  <p className="text-xs mt-1">{t('habit.addHabitHint')}</p>
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
                            {(() => {
                              const { lastAutoSync } = habit;
                              const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
                              const isRecent = lastAutoSync?.timestamp &&
                                Date.now() - new Date(lastAutoSync.timestamp).getTime() < SEVEN_DAYS_MS;
                              if (!isRecent) return null;
                              const isThisDevice = lastAutoSync.deviceId === getDeviceId();
                              if (isThisDevice) {
                                const paused = habit.unit === 'steps' ? healthPerms?.steps === false : healthPerms?.sleep === false;
                                if (paused) return <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-400/10 text-orange-500 flex-shrink-0"><WifiOff size={9} />{t('habit.habitNotSyncing')}</span>;
                                return <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 flex-shrink-0"><RefreshCw size={9} />{t('habit.habitAutoSyncedThisDevice')}</span>;
                              }
                              const platform = lastAutoSync.platform ?? t('habit.anotherDevice', { defaultValue: 'another device' });
                              return <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 dark:text-green-400 flex-shrink-0"><RefreshCw size={9} />{t('habit.habitAutoSyncedOtherDevice', { platform })}</span>;
                            })()}
                          </div>
                          <div className={`text-xs ${textSecondary}`}>{habit.type === 'doMore' ? t('habit.habitGoalPrefix') : t('habit.habitLimitPrefix')}: {habit.target} {habit.unit}</div>
                          {(() => {
                            const days = habit.scheduledDays ?? [0, 1, 2, 3, 4, 5, 6];
                            if (days.length === 7) return null;
                            const names = localizedWeekdays('short');
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
                  {t('habit.addHabit')}
                </button>
              )}
              {window.DayGlanceNative && !activeHabits.some(h => (h.source === 'healthKit' || h.source === 'healthConnect') && h.unit === 'steps') && activeHabits.length < 8 && (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${darkMode ? 'border-green-800 bg-green-950/40' : 'border-green-200 bg-green-50'}`}>
                  <Footprints size={22} className="text-green-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${darkMode ? 'text-green-300' : 'text-green-800'}`}>{t('habit.trackStepsTitle')}</div>
                    <div className={`text-xs ${darkMode ? 'text-green-500' : 'text-green-600'} mt-0.5`}>{t('habit.trackHealthHint', { provider: isIOS ? 'Apple Health' : 'Health Connect', defaultValue: 'Pulls from {{provider}} — no manual tapping' })}</div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {!healthPerms?.steps && (
                      <button
                        onClick={() => { try { window.DayGlanceNative.requestHealthPermission(); } catch (e) {} }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600 active:bg-green-700 transition-colors"
                      >
                        {t('common.continue')}
                      </button>
                    )}
                    <button
                      onClick={healthPerms?.steps ? addStepsHabit : undefined}
                      disabled={!healthPerms?.steps}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${healthPerms?.steps ? 'bg-green-500 text-white hover:bg-green-600 active:bg-green-700' : 'bg-green-500/30 text-white/50 cursor-not-allowed'}`}
                    >
                      {t('common.add')}
                    </button>
                  </div>
                </div>
              )}
              {window.DayGlanceNative && !activeHabits.some(h => (h.source === 'healthKit' || h.source === 'healthConnect') && h.unit === 'min') && activeHabits.length < 8 && (
                <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${darkMode ? 'border-indigo-800 bg-indigo-950/40' : 'border-indigo-200 bg-indigo-50'}`}>
                  <Moon size={22} className="text-indigo-500 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${darkMode ? 'text-indigo-300' : 'text-indigo-800'}`}>{t('habit.trackSleepTitle')}</div>
                    <div className={`text-xs ${darkMode ? 'text-indigo-500' : 'text-indigo-600'} mt-0.5`}>{t('habit.trackHealthHint', { provider: isIOS ? 'Apple Health' : 'Health Connect', defaultValue: 'Pulls from {{provider}} — no manual tapping' })}</div>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    {!healthPerms?.sleep && (
                      <button
                        onClick={() => { try { window.DayGlanceNative.requestHealthPermission(); } catch (e) {} }}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 active:bg-indigo-700 transition-colors"
                      >
                        {t('common.continue')}
                      </button>
                    )}
                    <button
                      onClick={healthPerms?.sleep ? addSleepHabit : undefined}
                      disabled={!healthPerms?.sleep}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${healthPerms?.sleep ? 'bg-indigo-500 text-white hover:bg-indigo-600 active:bg-indigo-700' : 'bg-indigo-500/30 text-white/50 cursor-not-allowed'}`}
                    >
                      {t('common.add')}
                    </button>
                  </div>
                </div>
              )}
              {habits.filter(h => h.archived).length > 0 && (
                <div className="pt-2">
                  <h4 className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} mb-2`}>{t('common.archived')}</h4>
                  <div className="space-y-1">
                    {habits.filter(h => h.archived).map(habit => {
                      const IconComp = HABIT_ICONS[habit.icon] || Target;
                      const colorObj = HABIT_COLORS.find(c => c.name === habit.color) || HABIT_COLORS[0];
                      return (
                        <div key={habit.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${darkMode ? 'bg-gray-800/50' : 'bg-stone-50'} opacity-60`}>
                          <IconComp size={16} style={{ color: colorObj.ring }} />
                          <span className={`text-sm flex-1 ${textPrimary}`}>{habit.name}</span>
                          <button onClick={() => updateHabit(habit.id, { archived: false })} className="text-xs text-blue-500 font-medium px-2 py-1 rounded hover:bg-blue-500/10">{t('common.restore')}</button>
                          <button onClick={() => deleteHabit(habit.id)} className="text-xs text-red-500 font-medium px-2 py-1 rounded hover:bg-red-500/10">{t('common.delete')}</button>
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
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>

      {/* Enable/disable toggle */}
      <div className={`flex items-center justify-between p-4 rounded-xl border ${borderClass} ${cardBg}`}>
        <div className="flex items-center gap-3">
          <Sparkles size={20} className={routinesEnabled ? 'text-teal-500' : textSecondary} />
          <span className={`text-sm font-medium ${textPrimary}`}>{t('settings.routines')}</span>
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

  {mobileSettingsView === 'multiUser' && (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={() => setMobileSettingsView('main')} className={`p-1 rounded-lg ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}`}>
          <ChevronLeft size={20} className={textSecondary} />
        </button>
        <h2 className={`text-lg font-semibold ${textPrimary}`}>{t('settings.multiUser')}</h2>
      </div>
      {/* Enable toggle */}
      <div className="flex items-center justify-between gap-3 py-1">
        <div>
          <p className={`text-sm font-medium ${textPrimary}`}>{t('settings.multiUserMode')}</p>
          <p className={`text-xs ${textSecondary}`}>{t('settings.multiUserModeHint')}</p>
        </div>
        <button
          type="button"
          disabled={multiUserLocked}
          onClick={() => {
            const next = !multiUserEnabled;
            setMultiUserEnabled(next);
            localStorage.setItem('dayglance-multi-user-enabled', JSON.stringify(next));
          }}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${multiUserEnabled ? 'bg-green-500' : darkMode ? 'bg-gray-600' : 'bg-stone-300'} ${multiUserLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
          role="switch"
          aria-checked={multiUserEnabled}
        >
          <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${multiUserEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
      </div>
      {multiUserReason !== 'none' && (
        <p className={`text-xs ${textSecondary} -mt-2`}>
          {t(multiUserReason === 'icloud-only' ? 'settings.multiUserICloudOnly' : 'settings.multiUserRequiresSync')}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <p className={`text-xs ${textSecondary}`}>{t('settings.multiUserModeHint')}</p>
        {multiUserRosterSyncable && (
          <button
            type="button"
            disabled={muSyncStatus === 'syncing'}
            onClick={async () => {
              setMuSyncStatus('syncing');
              try {
                const raw = localStorage.getItem(MULTI_USER_CONFIG_KEY);
                const uPath = raw ? (JSON.parse(raw).usersPath ?? undefined) : undefined;
                // Prefer WebDAV when configured; otherwise fetch the roster from
                // iCloud Drive (zero-config sync across same-Apple-ID devices).
                const merged = cloudSyncConfig?.enabled
                  ? await syncSharedUsers(cloudSyncConfig, uPath, users)
                  : await syncSharedUsersViaICloud(uPath, users);
                if (merged) {
                  localStorage.setItem('dayglance-users', JSON.stringify(merged));
                  setUsers(merged);
                }
                setMuSyncStatus('ok');
                setTimeout(() => setMuSyncStatus(null), 2000);
              } catch {
                setMuSyncStatus('error');
                setTimeout(() => setMuSyncStatus(null), 3000);
              }
            }}
            className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium flex items-center gap-1.5 ${
              muSyncStatus === 'ok' ? 'bg-green-500/20 text-green-500' :
              muSyncStatus === 'error' ? 'bg-red-500/20 text-red-500' :
              darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-100 text-stone-600'
            }`}
          >
            <RefreshCw size={13} className={muSyncStatus === 'syncing' ? 'animate-spin' : ''} />
            {muSyncStatus === 'ok'
              ? t('settings.multiUserSynced', { defaultValue: 'Synced!' })
              : muSyncStatus === 'error'
                ? t('settings.multiUserSyncFailed', { defaultValue: 'Failed' })
                : t('common.syncNow')}
          </button>
        )}
      </div>

      {/* People */}
      <div>
        <p className={`text-xs font-medium ${textSecondary} mb-2`}>{t('settings.multiUserPeople')}</p>
        <div className="space-y-2">
          {users.filter(u => !u.deleted).map(u => (
            <div key={u.id} className={`${cardBg} border ${borderClass} rounded-xl p-3 flex items-center gap-3`}>
              <span style={{ width: 28, height: 28, fontSize: 14 }} className="rounded-full bg-gray-500 text-white flex items-center justify-center font-semibold leading-none flex-shrink-0">
                {u.name[0].toUpperCase()}
              </span>
              {muEditingUserId === u.id ? (
                <>
                  <input
                    type="text"
                    value={muEditingUserName}
                    onChange={e => setMuEditingUserName(e.target.value)}
                    className={`flex-1 px-2 py-1 border ${borderClass} rounded-lg text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const trimmed = muEditingUserName.trim();
                      if (!trimmed) return;
                      const updated = users.map(usr => usr.id === u.id ? { ...usr, name: trimmed, updatedAt: new Date().toISOString() } : usr);
                      setUsers(updated);
                      localStorage.setItem('dayglance-users', JSON.stringify(updated));
                      setMuEditingUserId(null);
                    }}
                    className="px-2 py-1 bg-blue-600 text-white rounded-lg text-xs"
                  >{t('common.save')}</button>
                  <button type="button" onClick={() => setMuEditingUserId(null)} className={`px-2 py-1 rounded-lg text-xs ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-stone-200 text-stone-700'}`}>{t('common.cancel')}</button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${textPrimary}`}>{u.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const key = u.syncId ?? u.id;
                      const next = meUserSyncId === key ? null : key;
                      setMeUserSyncId(next);
                      localStorage.setItem(MULTI_USER_CONFIG_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(MULTI_USER_CONFIG_KEY) || '{}'), meUserSyncId: next }));
                    }}
                    className={`px-2 py-1 rounded-lg text-xs border transition-colors ${meUserSyncId === (u.syncId ?? u.id)
                      ? 'border-green-500 bg-green-500/20 text-green-400'
                      : `${borderClass} ${darkMode ? 'bg-transparent text-gray-400' : 'bg-transparent text-stone-500'}`}`}
                  >{meUserSyncId === (u.syncId ?? u.id) ? `✓ ${t('settings.multiUserMe')}` : t('settings.multiUserMe')}</button>
                  <button type="button" onClick={() => { setMuEditingUserId(u.id); setMuEditingUserName(u.name); }} className={`px-2 py-1 rounded-lg text-xs ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-stone-200 text-stone-700'}`}>{t('common.edit')}</button>
                  <button
                    type="button"
                    onClick={() => {
                      const updated = users.map(usr => usr.id === u.id ? { ...usr, deleted: true, updatedAt: new Date().toISOString() } : usr);
                      setUsers(updated);
                      localStorage.setItem('dayglance-users', JSON.stringify(updated));
                      if (meUserSyncId === (u.syncId ?? u.id)) {
                        setMeUserSyncId(null);
                        localStorage.setItem(MULTI_USER_CONFIG_KEY, JSON.stringify({ ...JSON.parse(localStorage.getItem(MULTI_USER_CONFIG_KEY) || '{}'), meUserSyncId: null }));
                      }
                    }}
                    className="px-2 py-1 rounded-lg text-xs bg-red-500/20 text-red-500"
                  >{t('common.remove')}</button>
                </>
              )}
            </div>
          ))}
        </div>
        {muAddingUser ? (
          <div className={`mt-2 ${cardBg} border ${borderClass} rounded-xl p-3 flex items-center gap-2`}>
            <input
              type="text"
              placeholder={t('common.name')}
              value={muNewUserName}
              onChange={e => setMuNewUserName(e.target.value)}
              className={`flex-1 px-2 py-1 border ${borderClass} rounded-lg text-sm ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'}`}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const trimmed = muNewUserName.trim();
                  if (!trimmed) return;
                  const newUser = { id: crypto.randomUUID(), name: trimmed, syncId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
                  const updated = [...users, newUser];
                  setUsers(updated);
                  localStorage.setItem('dayglance-users', JSON.stringify(updated));
                  setMuNewUserName('');
                  setMuAddingUser(false);
                } else if (e.key === 'Escape') {
                  setMuAddingUser(false);
                  setMuNewUserName('');
                }
              }}
            />
            <button
              type="button"
              onClick={() => {
                const trimmed = muNewUserName.trim();
                if (!trimmed) return;
                const newUser = { id: crypto.randomUUID(), name: trimmed, syncId: crypto.randomUUID(), updatedAt: new Date().toISOString() };
                const updated = [...users, newUser];
                setUsers(updated);
                localStorage.setItem('dayglance-users', JSON.stringify(updated));
                setMuNewUserName('');
                setMuAddingUser(false);
              }}
              className="px-3 py-1 bg-blue-600 text-white rounded-lg text-sm"
            >{t('common.add')}</button>
            <button type="button" onClick={() => { setMuAddingUser(false); setMuNewUserName(''); }} className={`px-2 py-1 rounded-lg text-sm ${darkMode ? 'bg-gray-600 text-gray-200' : 'bg-stone-200 text-stone-700'}`}>{t('common.cancel')}</button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setMuAddingUser(true)}
            className={`mt-3 w-full ${cardBg} border ${borderClass} rounded-xl p-3 flex items-center justify-center gap-2 ${darkMode ? 'text-blue-400' : 'text-blue-600'} text-sm font-medium`}
          >
            {t('common.addPerson')}
          </button>
        )}
      </div>


      {/* Users sync path (only shown when cloud sync is configured) */}
      {cloudSyncConfig?.enabled && (
        <div>
          <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.usersSyncPath')}</label>
          <input
            type="text"
            placeholder="/GLANCE/users/"
            value={muUsersPath}
            onChange={e => {
              const val = e.target.value;
              setMuUsersPath(val);
              const existing = localStorage.getItem(MULTI_USER_CONFIG_KEY);
              const prev = existing ? JSON.parse(existing) : {};
              localStorage.setItem(MULTI_USER_CONFIG_KEY, JSON.stringify({ ...prev, usersPath: val }));
            }}
            className={`w-full px-3 py-2 border ${borderClass} rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
          />
          <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.usersSyncPathHint')}</p>
        </div>
      )}
    </div>
  )}

  {mobileSettingsView === 'todoist' && (
    <div className="px-4 py-4 space-y-4">
      <button onClick={() => setMobileSettingsView('main')} className={`flex items-center gap-2 ${textSecondary}`}>
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>
      <TodoistSettings />
    </div>
  )}

  {/* Local Integrations sub-view — row card above opens it; the content is
      the same component the desktop SettingsModal embeds, in page form. */}
  {mobileSettingsView === 'localIntegrations' && (
    <div className="px-4 py-4 space-y-4">
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>
      <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
        <Plug size={18} className={localIntegrationsOn ? 'text-amber-500' : textSecondary} />
        {t('settings.localIntegrations', { defaultValue: 'Local Integrations' })}
      </h4>
      <LocalIntegrationsSettings variant="page" />
    </div>
  )}
</div>
  );
};

export default MobileSettingsPanel;
