// Settings: the Integrations topic's sections (docs/settings-redesign.md).
// Moved verbatim from SettingsModal.jsx. Returns `{ key: { show, node, ... } }`
// for the keys this topic lists in settingsTopics.js; the dialog builds
// its topic list, search and page from them.
import React, { useState } from 'react';
import { Activity, AlertCircle, BookOpen, CheckCircle, CheckSquare, Cloud, FolderOpen, Key, LayoutGrid, Loader, Lock, Plug, RefreshCw, Server, Settings, Upload, Wifi, Zap } from 'lucide-react';
import SettingsCard from '../SettingsCard.jsx';
import LocalIntegrationsSettings from '../../LocalIntegrationsSettings.jsx';
import { useMcpStatus } from '../../McpStatusControls.jsx';
import TodoistSettings from '../../TodoistSettings.jsx';
import CalendarList from '../../CalendarList.jsx';
import DirectAccessFileRow from '../../DirectAccessFileRow.jsx';
import { isDirectAccessSupported } from '../../../sync/directAccessTransport.js';
import useDirectAccessStatus from '../../../hooks/useDirectAccessStatus.js';
import { isNativeAndroid, isNativeApp, nativePickVault, nativeGetCalendars, nativeGetAutomationIntentsEnabled, nativeSetAutomationIntentsEnabled } from '../../../native.js';
import { hasNativeCalendar, electronCalendarAvailable, electronGetCalendars, CALENDAR_FILTER_NONE, isCalendarFilterNone, isCalendarShown, toggleCalendarInFilter } from '../../../utils/nativeCalendar.js';
import { isFileSystemAccessSupported, requestVaultAccess, disconnectVault, formatDatePattern } from '../../../obsidian.js';
import { validateDailyNotePattern, validateVaultFolderSetting } from '../../../utils/obsidianFilename.js';
import { describeDailyNotePath } from '../../../utils/obsidianFolderCheck.js';
import { effectiveLaunchOnWrite } from '../../../utils/obsidianLaunchOnWrite.js';
import UnportableVaultNamesPanel from '../../UnportableVaultNamesPanel.jsx';
import BridgePairingPanel from '../../BridgePairingPanel.jsx';
import BridgeStatusPanel from '../../BridgeStatusPanel.jsx';
import { LauncherPromoEntry, useLauncherPromo } from '../../LauncherPromo.jsx';
import { INTENT_CONFIG_KEY } from '../../../intents/useIntentPoller.js';
import { isAvailable as isICloudAvailable } from '../../../intents/icloudFileTransport.js';
import { getSyncPassphrase, setSyncPassphrase } from '../../../utils/crypto.js';
import { isVaultEnabled } from '../../../sync/vaultConfig.js';
import { getDbIntentsConfig, setDbIntentsConfig, getDbIntentsConnection } from '../../../intents/dbIntentsConfig.js';
import { getIcloudIntentsEnabledFlag, setIcloudIntentsEnabled } from '../../../intents/icloudIntentsConfig.js';
import { getDirectAccessIntentsEnabledFlag, setDirectAccessIntentsEnabled } from '../../../intents/directAccessIntentsConfig.js';
import { resolveDirectAccessIntentsKey } from '../../../intents/directAccessIntentsKey.js';
import { directAccessTransport } from '../../../sync/directAccessTransport.js';
import { setupIntentsEncryption } from '../../../intents/intentsEncryptionSetup.js';
import { ensureVaultIntentsKey, setupVaultIntentsEncryption } from '../../../intents/vaultIntentsSetup.js';
import { flushOutboxNow } from '../../../intents/useOutboxFlush.js';
import { loadIntentsRootKey, clearIntentsRootKey } from '../../../intents/intentsKeyStore.js';
import { buildLocalizedTaskHeading } from '../../../utils/dailyNoteTemplate.js';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../../../context/SyncContext.jsx';
import { useFeaturesCtx } from '../../../context/FeaturesContext.jsx';

export default function useIntegrationsTopic({ intentForm, setIntentForm }) {
  const { t, i18n } = useTranslation();
  const {
    setShowSettings, darkMode, borderClass, textPrimary, textSecondary, hoverBg,
    isMobile, tasks, setTasks, setUnscheduledTasks, dailyNoteTemplate,
    setDailyNoteTemplate,
  } = useDayPlannerCtx();
  const {
    handleFileUpload, cloudSyncConfig, calSyncConfigured, calendarSourceActive,
    taskCalendarUrl, setTaskCalendarUrl, taskCalendarAuth, setTaskCalendarAuth,
    syncCalendarCreds, setSyncCalendarCreds, syncRetentionDays,
    setSyncRetentionDays, syncAll, isSyncing, calSyncLastSynced,
    availableCalendars, setAvailableCalendars, calendarFilter, setCalendarFilter,
    obsidianConfig, setObsidianConfig, obsidianSyncStatus, obsidianSyncError,
    obsidianLastSynced, setObsidianLastSynced, obsidianVaultAccess,
    obsidianLaunchOnWrite, setObsidianLaunchOnWrite, obsidianCompletionDates,
    setObsidianCompletionDates, obsidianVaultHandleRef, unportableVaultFiles,
    setUnportableVaultFiles, performObsidianSync, trmnlConfig, setTrmnlConfig,
    trmnlSyncStatus, trmnlLastSynced, performTrmnlSync, setShowIntentActivityLog,
    removeFileImportedEvents, todoist, nativeClearVault, setWikilinkCandidates,
  } = useSyncCtx();
  const {
    multiUserEnabled, meUserSyncId,
  } = useFeaturesCtx();
  const locale = i18n.resolvedLanguage || i18n.language;
  const formatUnit = (value, unit) => new Intl.NumberFormat(locale, {
    style: 'unit', unit, unitDisplay: 'long',
  }).format(value);

  const todoistConnected = !!todoist?.connected;

  const fileImportedEventCount = tasks.filter(
    t => t.imported && !t.isTaskCalendar && t.importSource === 'file'
  ).length;

  // Launch-on-write (Obsidian Phase 1) is shown only where a launch mechanism
  // exists: Electron (main-process shell.openExternal) or the Android bridge
  // intent. Plain browser has neither — a window.open fired from a debounce
  // timer is popup-blocked without a user gesture. The platform string feeds
  // the per-platform default (macOS on, everything else off).
  const launchOnWritePlatform = window.electronAPI?.obsidian?.setLaunchOnWrite
    ? window.electronAPI.platform
    : (isNativeAndroid() && window.DayGlanceObsidian?.setLaunchOnWrite) ? 'android' : null;

  const directAccessStatus = useDirectAccessStatus();

  const [intentSaved, setIntentSaved] = useState(false);
  // null | 'passphrase-needed' | 'running' | { error: string }
  const [intentSetupPhase, setIntentSetupPhase] = useState(null);
  const [intentPassphraseInput, setIntentPassphraseInput] = useState('');
  // GLANCEvault DB intents (beta). Tracks only the `enabled` flag — the rest of
  // the config (ttlMs, pollIntervalMinutes) is preserved on save, and the vault
  // connection is INHERITED from the GLANCEvault sync config (not edited here).
  const [dbIntentsEnabled, setDbIntentsEnabled] = useState(() => !!getDbIntentsConfig()?.enabled);
  const [dbIntentsSaved, setDbIntentsSaved] = useState(false);
  // Vault intents key-setup phase: null | 'passphrase-needed' | 'running' | { error }.
  const [dbIntentsSetupPhase, setDbIntentsSetupPhase] = useState(null);
  const [dbIntentsPassphraseInput, setDbIntentsPassphraseInput] = useState('');
  // iCloud intents opt-in gate. DEFAULT OFF — activation (emit + poll) only runs
  // when the user flips this on, matching WebDAV/vault gating.
  const [icloudIntentsEnabled, setIcloudIntentsEnabledState] = useState(() => getIcloudIntentsEnabledFlag());
  const [icloudIntentsSaved, setIcloudIntentsSaved] = useState(false);
  // Direct Access intents opt-in (docs/direct-access-sync.md, Phase 7).
  const [directAccessIntentsEnabled, setDirectAccessIntentsEnabledState] = useState(() => getDirectAccessIntentsEnabledFlag());
  const [directAccessIntentsSaved, setDirectAccessIntentsSaved] = useState(false);
  // With the encrypt switch on, the opt-in needs the intents key for the
  // folder's salt (intents/directAccessIntentsKey.js): derived from the sync
  // passphrase when it is in memory, asked for once when it is not.
  const [directAccessIntentsPassphrase, setDirectAccessIntentsPassphrase] = useState('');
  const [directAccessIntentsKeyWanted, setDirectAccessIntentsKeyWanted] = useState(false);
  // Android automation intents (Tasker) opt-in gate. DEFAULT OFF — the flag is
  // the single source of truth in native SharedPreferences; we mirror it here so
  // the toggle reflects the persisted value. Only shown on native Android.
  const [automationIntentsEnabled, setAutomationIntentsEnabled] = useState(
    () => isNativeAndroid() && nativeGetAutomationIntentsEnabled(),
  );

  // What each GLANCE apps protocol has SAVED (not the form being edited), for
  // the dots and for which sub-cards start open.
  const intentsSaved = {
    webdav: (() => { try { return !!JSON.parse(localStorage.getItem(INTENT_CONFIG_KEY) || 'null')?.webdavUrl; } catch { return false; } })(),
    vault: !!getDbIntentsConfig()?.enabled,
    icloud: isICloudAvailable() && getIcloudIntentsEnabledFlag(),
    directAccess: isDirectAccessSupported() && getDirectAccessIntentsEnabledFlag(),
  };
  // The Local Integrations dot: Stream Deck or MCP on, read from the main
  // process here rather than reported by the card's body, which only mounts
  // once the card is opened (so the dot used to wait for that).
  const launcherPromo = useLauncherPromo();
  const localIntegrationsConfig = useMcpStatus().snapshot?.config;
  const localIntegrationsOn = !!(localIntegrationsConfig?.streamDeck?.enabled
    || (localIntegrationsConfig?.mcp?.readTier && localIntegrationsConfig.mcp.readTier !== 'off'));

  return {
    calendarSync: {
      show: true,
      card: true,
      node: (
        <>
            {/* Calendar Sync Section - wide screens */}
            <SettingsCard
              cardId="calendars"
              collapsible
              icon={RefreshCw}
              title={t('settings.calendarSync')}
              badge={calendarSourceActive ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
            <div className="space-y-3">
              {!hasNativeCalendar() && <CalendarList />}
              {hasNativeCalendar() && (
                <p className={`text-xs ${textSecondary}`}>
                  {t('settings.deviceCalendarDescription', { defaultValue: 'Calendar events are read from your device accounts. Use the Device Calendars section below to choose which calendars to show.' })}
                </p>
              )}
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>
                  {t('settings.taskCalendarUrl')}
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
                  {t('settings.taskCalendarHint', { defaultValue: 'Tasks appear with striped pattern; completion state persists across syncs' })}
                </p>
              </div>
              {taskCalendarUrl && (
                <div className={`space-y-2 pl-3 border-l-2 ${darkMode ? 'border-gray-600' : 'border-stone-300'}`}>
                  <p className={`text-xs font-medium ${textSecondary}`}>{t('settings.taskCalendarAuth')}</p>
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className={`block text-xs ${textSecondary} mb-1`}>{t('common.username')}</label>
                      <input
                        type="text"
                        placeholder={t('common.username')}
                        value={taskCalendarAuth.username}
                        onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, username: e.target.value }))}
                        className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
                      />
                    </div>
                    <div className="flex-1">
                      <label className={`block text-xs ${textSecondary} mb-1`}>{t('settings.appPassword')}</label>
                      <input
                        type="password"
                        placeholder={t('settings.appPassword')}
                        value={taskCalendarAuth.appPassword}
                        onChange={(e) => setTaskCalendarAuth(prev => ({ ...prev, appPassword: e.target.value }))}
                        className={`w-full px-3 py-1.5 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-xs`}
                      />
                    </div>
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
                      {t('settings.calDAVSyncHint', { defaultValue: 'For syncing completions back: the CalDAV collection URL (without ?export). In Nextcloud, the calendar ID in the URL may differ from the display name.' })}
                    </p>
                  </div>
                  <p className={`text-xs ${textSecondary}`}>
                    {t('settings.taskCalendarCredentialsHint', { defaultValue: 'Username + password fetches protected task calendars. Adding a CalDAV Base URL also syncs completion status back to your server.' })}
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
                <label className={`block text-sm ${textSecondary} mb-1`}>
                  {t('settings.keepPastEvents')}
                </label>
                <select
                  value={syncRetentionDays}
                  onChange={(e) => setSyncRetentionDays(Number(e.target.value))}
                  className={`px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                >
                  <option value={7}>{formatUnit(7, 'day')}</option>
                  <option value={14}>{formatUnit(14, 'day')}</option>
                  <option value={30}>{formatUnit(30, 'day')}</option>
                  <option value={60}>{formatUnit(60, 'day')}</option>
                  <option value={90}>{formatUnit(90, 'day')}</option>
                  <option value={180}>{formatUnit(6, 'month')}</option>
                  <option value={365}>{formatUnit(1, 'year')}</option>
                  <option value={0}>{t('settings.keepPastEventsAll', { defaultValue: 'All (no limit)' })}</option>
                </select>
                <p className={`text-xs ${textSecondary} mt-1`}>
                  {t('settings.keepPastEventsHint', { defaultValue: 'Older imported events are dropped to save storage. Future events are always kept.' })}
                </p>
              </div>
              <button
                onClick={() => syncAll()}
                disabled={isSyncing || !calSyncConfigured}
                className={`px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2 text-sm ${!calSyncConfigured ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                {isSyncing ? t('common.syncing') : t('common.syncNow')}
              </button>
              {calSyncLastSynced && (
                <p className={`text-xs ${textSecondary}`}>
                  {t('common.lastSynced')}: {new Date(calSyncLastSynced).toLocaleString(locale)}
                </p>
              )}
              {hasNativeCalendar() && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between">
                    <p className={`text-sm font-medium ${textPrimary}`}>{t('settings.deviceCalendars')}</p>
                    <button onClick={async () => {
                      // force: this button is the documented recovery path for an
                      // empty list, so it must bypass the main-process cache.
                      const cals = electronCalendarAvailable() ? await electronGetCalendars({ force: true }) : nativeGetCalendars();
                      if (cals.length > 0) setAvailableCalendars(cals);
                    }} className={`text-xs ${textSecondary} underline`}>{t('common.refresh')}</button>
                  </div>
                  {availableCalendars.length === 0 ? (
                    <p className={`text-xs ${textSecondary}`}>{t('settings.noDeviceCalendars', { defaultValue: 'No calendars loaded — tap Refresh, or rebuild the app if this persists.' })}</p>
                  ) : (<>
                    <p className={`text-xs ${textSecondary}`}>{t('settings.deviceCalendarFilterHint', { defaultValue: 'Uncheck a calendar to hide its events. Uncheck all to hide every device calendar.' })}</p>
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => setCalendarFilter([])}
                        disabled={calendarFilter.length === 0}
                        className={`text-xs ${textSecondary} underline disabled:opacity-50 disabled:no-underline`}
                      >{t('settings.deviceCalendarsShowAll', { defaultValue: 'Show all' })}</button>
                      <button
                        onClick={() => setCalendarFilter([CALENDAR_FILTER_NONE])}
                        disabled={isCalendarFilterNone(calendarFilter)}
                        className={`text-xs ${textSecondary} underline disabled:opacity-50 disabled:no-underline`}
                      >{t('settings.deviceCalendarsHideAll', { defaultValue: 'Hide all' })}</button>
                    </div>
                    {availableCalendars.map(cal => {
                      const isChecked = isCalendarShown(calendarFilter, cal.id);
                      return (
                        <label key={cal.id} className={`flex items-center gap-2 text-sm ${textPrimary} cursor-pointer`}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => setCalendarFilter(prev => toggleCalendarInFilter(prev, cal.id, availableCalendars.map(c => c.id)))}
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
                <p className={`text-sm font-medium ${textPrimary}`}>{t('settings.importIcsFile')}</p>
                <label className={`cursor-pointer inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg} text-sm ${textPrimary}`}>
                  <Upload size={14} className={textSecondary} />
                  {t('settings.chooseIcsFile')}
                  <input type="file" accept=".ics" onChange={(e) => { handleFileUpload(e); setShowSettings(false); }} className="hidden" />
                </label>
                <p className={`text-xs ${textSecondary}`}>{t('settings.importIcsDesc')}</p>
                {fileImportedEventCount > 0 && (
                  <button
                    onClick={() => {
                      if (window.confirm(t('settings.removeFileImportedConfirm', 'Remove all {{n}} file-imported events? Re-importing the file brings them back.', { n: fileImportedEventCount }))) {
                        removeFileImportedEvents();
                      }
                    }}
                    className="text-xs font-medium text-red-500 hover:text-red-600 transition-colors"
                  >
                    {t('settings.removeFileImported', 'Remove file-imported events')} ({fileImportedEventCount})
                  </button>
                )}
              </div>
            </div>
            </SettingsCard>
        </>
      ),
    },
    obsidian: {
      show: !isMobile || isNativeApp(),
      card: true,
      node: (
        <>
            {/* Hidden at mobile width ONLY for browsers, where FSA is
                unavailable on phones; a NATIVE app (Android or iOS)
                has vault access at any width. The old Android-only
                exception predated the iOS native bridge. */}
            {(!isMobile || isNativeApp()) && (<>

            {/* Obsidian Integration Section — desktop (FSA) + native
                apps (Android SAF, iOS bookmark). MobileSettingsPanel
                carries the primary mobile surface; this section is the
                modal's counterpart wherever the modal is reachable. */}
            <SettingsCard
              cardId="obsidian"
              collapsible
              icon={BookOpen}
              title={t('settings.obsidianIntegration')}
              badge={obsidianConfig?.enabled ? <span className={`w-2 h-2 rounded-full flex-shrink-0 ${obsidianVaultAccess === 'lost' ? 'bg-red-500' : 'bg-green-500'}`} /> : null}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
            <div className="space-y-3">
              <p className={`${textSecondary} text-xs`}>
                {t('settings.obsidianDesc')}
              </p>
              {/* The Chromium/FSA requirement is a BROWSER constraint:
                  a native app reaches the vault through its own bridge
                  (SAF / iOS bookmark) and must not see this warning —
                  gating on Android alone showed it, wrongly, on iPad. */}
              {!isNativeApp() && !isFileSystemAccessSupported() && (
                <p className={`text-xs text-amber-500`}>
                  {t('settings.obsidianBrowserRequirement', { defaultValue: 'Obsidian integration requires a Chromium-based browser (Chrome, Edge, or Brave). Firefox and Safari do not support the File System Access API.' })}
                </p>
              )}
              {/* An Android TABLET configures the vault in the app's own
                  settings; an Android phone edits the same fields here and
                  opens those settings only to pick the vault folder. */}
              {isNativeAndroid() && !isMobile ? (
                <div className="space-y-3">
                  <p className={`text-xs ${textSecondary}`}>
                    {t('settings.obsidianNativeSettingsHint', { defaultValue: 'Vault access and daily note settings are configured in the app settings.' })}
                  </p>
                  <button
                    onClick={() => window.DayGlanceNative.openSettings()}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm"
                  >
                    <FolderOpen size={14} />
                    {t('settings.obsidianOpenVaultSettings')}
                  </button>
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
                      <p className={`text-xs ${textSecondary} mt-1`}>
                        {t('settings.obsidianLaunchOnWriteHintAndroid')}
                      </p>
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
                      <p className={`text-xs ${textSecondary} mt-1`}>
                        {t('settings.obsidianCompletionDatesHint')}
                      </p>
                    </div>
                  )}
                  {/* §6 mode indicator, native flavor: read-only bridge
                      status (three states — see BridgeStatusPanel).
                      Pairing itself stays a desktop act; this makes
                      plugin mode, and especially the SILENTLY-UNPAIRED
                      middle state, legible on this device. */}
                  {obsidianConfig?.enabled && (
                    <BridgeStatusPanel darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass} />
                  )}
                </div>
              ) : obsidianConfig?.enabled ? (
                <div className="space-y-3">
                  <div className={`flex items-center gap-2 text-sm ${textPrimary}`}>
                    <FolderOpen size={14} className={textSecondary} />
                    <span className="truncate">{obsidianConfig.vaultName || t('settings.obsidianVaultConnected')}</span>
                    {obsidianVaultAccess === 'lost'
                      ? <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                      : <CheckCircle size={14} className="text-green-500 flex-shrink-0" />}
                  </div>
                  {/* Configured is not reachable: say so here, where the
                      green check used to claim otherwise, and point at
                      the button that fixes it. */}
                  {obsidianVaultAccess === 'lost' && (
                    <p data-obsidian-vault-lost className="text-xs text-red-500">{t('settings.obsidianVaultAccessLost')}</p>
                  )}
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>
                      {t('settings.obsidianDailyNotesFolder')}
                    </label>
                    <input
                      type="text"
                      placeholder={t('settings.obsidianVaultRootPlaceholder', { defaultValue: '(vault root)' })}
                      value={obsidianConfig.dailyNotesPath || ''}
                      onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotesPath: e.target.value }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    />
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {t('settings.obsidianDailyNotesFolderHint', { defaultValue: 'Leave empty for vault root. Common: "Daily Notes" or "journals"' })}
                    </p>
                    {/* Where a daily note lands, and the nesting trap
                        (utils/obsidianFolderCheck.js): the picked folder
                        named like the setting means a second folder of
                        the same name inside it, and two copies of each
                        day's note. Said here, before the first write. */}
                    {(() => {
                      const resolved = describeDailyNotePath({
                        vaultName: obsidianConfig.vaultName, dailyNotesPath: obsidianConfig.dailyNotesPath,
                        dailyNotePattern: obsidianConfig.dailyNotePattern, formatDatePattern,
                      });
                      return (
                        <>
                          <p data-obsidian-daily-path className={`text-xs ${textSecondary} mt-1`}>
                            {t('settings.obsidianDailyNotesResolved', { path: resolved.path })}
                          </p>
                          {resolved.nested && (
                            <p data-obsidian-daily-nested className="text-xs text-amber-500 mt-1">
                              {t('settings.obsidianDailyNotesNested', { name: obsidianConfig.vaultName })}
                            </p>
                          )}
                        </>
                      );
                    })()}
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>
                      {t('settings.obsidianNewNotesFolder')}
                    </label>
                    <input
                      type="text"
                      placeholder="dayGLANCE"
                      value={obsidianConfig.newNotesFolder ?? 'dayGLANCE'}
                      onChange={(e) => setObsidianConfig(prev => ({ ...prev, newNotesFolder: e.target.value }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    />
                    {validateVaultFolderSetting(obsidianConfig.newNotesFolder) && (
                      <p className="text-xs text-red-500 mt-1">
                        {validateVaultFolderSetting(obsidianConfig.newNotesFolder)}
                      </p>
                    )}
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {t('settings.obsidianNewNotesFolderHint', { defaultValue: 'Where new notes created in dayGLANCE are saved. Leave empty for vault root.' })}
                    </p>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>
                      {t('settings.obsidianFilenamePattern')}
                    </label>
                    <input
                      type="text"
                      placeholder="yyyy-MM-dd"
                      value={obsidianConfig.dailyNotePattern ?? 'yyyy-MM-dd'}
                      onChange={(e) => setObsidianConfig(prev => ({ ...prev, dailyNotePattern: e.target.value }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    />
                    {validateDailyNotePattern(obsidianConfig.dailyNotePattern, formatDatePattern) && (
                      <p className="text-xs text-red-500 mt-1">
                        {validateDailyNotePattern(obsidianConfig.dailyNotePattern, formatDatePattern)}
                      </p>
                    )}
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {t('settings.obsidianFilenamePatternHint', { defaultValue: 'Date pattern for daily note filenames (without .md). e.g. "yyyy-MM-dd", "dd-MM-yyyy", "MMMM dd, yyyy"' })}
                    </p>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>
                      {t('settings.obsidianTaskHeading')}
                    </label>
                    <input
                      type="text"
                      placeholder={buildLocalizedTaskHeading(t)}
                      value={obsidianConfig.taskHeading || ''}
                      onChange={(e) => setObsidianConfig(prev => ({ ...prev, taskHeading: e.target.value }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    />
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {t('settings.obsidianTaskHeadingHintPrefix', { defaultValue: 'Tasks tagged' })} <code>#obsidian</code> {t('settings.obsidianTaskHeadingHintSuffix', { defaultValue: "are added under this heading in today's daily note" })}
                    </p>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>
                      {t('settings.obsidianDailyNoteTemplate')}
                    </label>
                    <textarea
                      value={dailyNoteTemplate}
                      onChange={(e) => setDailyNoteTemplate(e.target.value)}
                      placeholder={t('settings.obsidianDailyNoteTemplatePlaceholder', { defaultValue: 'Template for new daily notes...' })}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white placeholder:text-gray-500' : 'bg-white text-stone-900 placeholder:text-stone-400'} text-sm resize-y`}
                      rows={4}
                    />
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {t('settings.obsidianDailyNoteTemplateBridgeHint', { dateToken: '{{date}}', defaultValue: "Pre-filled when creating a new daily note. {{dateToken}} becomes the note's date. A template note configured in the Bridge plugin takes precedence when the plugin creates the note." })}
                    </p>
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
                      <p className={`text-xs ${textSecondary} mt-1`}>
                        {launchOnWritePlatform === 'android' ? t('settings.obsidianLaunchOnWriteHintAndroid') : t('settings.obsidianLaunchOnWriteHint')}
                      </p>
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
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {t('settings.obsidianCompletionDatesHint')}
                    </p>
                  </div>
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
                    <p className={`text-xs ${textSecondary} mt-1`}>
                      {t('settings.obsidianCompletionLogHint')}
                    </p>
                    {obsidianConfig.completionLogEnabled && (
                      <div className="mt-2">
                        <label className={`block text-sm ${textSecondary} mb-1`}>
                          {t('settings.obsidianCompletionLogHeading')}
                        </label>
                        <input
                          type="text"
                          placeholder="## Completed"
                          value={obsidianConfig.completionLogHeading || ''}
                          onChange={(e) => setObsidianConfig(prev => ({ ...prev, completionLogHeading: e.target.value }))}
                          className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => performObsidianSync()}
                      disabled={obsidianSyncStatus === 'syncing'}
                      className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2 text-sm"
                    >
                      <RefreshCw size={14} className={obsidianSyncStatus === 'syncing' ? 'animate-spin' : ''} />
                      {obsidianSyncStatus === 'syncing' ? t('common.syncing') : t('common.syncNow')}
                    </button>
                    {/* Re-pick the vault folder without disconnecting. Stored
                        access can lapse (an expired browser permission, a
                        stale macOS bookmark after the app is replaced) while
                        Settings still reads connected, and every note read
                        and vault write then fails. Disconnect is no way back:
                        it also drops the Obsidian-imported tasks. Picking
                        again stores fresh access (a new directory handle, or
                        a new bookmark on desktop) and keeps everything else. */}
                    <button
                      data-obsidian-change-vault
                      onClick={async () => {
                        // Android picks the folder in the app's own settings.
                        if (isNativeAndroid()) { window.DayGlanceNative.openSettings(); return; }
                        if (isNativeApp()) { nativePickVault(); return; }
                        try {
                          const handle = await requestVaultAccess();
                          if (!handle) return;
                          obsidianVaultHandleRef.current = handle;
                          setObsidianConfig(prev => ({ ...prev, enabled: true, vaultName: handle.name }));
                          performObsidianSync();
                        } catch (err) {
                          console.error('Obsidian: failed to change vault', err);
                        }
                      }}
                      className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors flex items-center gap-2`}
                    >
                      <FolderOpen size={14} />
                      {isNativeAndroid() ? t('settings.obsidianVaultSettings') : t('settings.obsidianChangeVault')}
                    </button>
                    <button
                      onClick={async () => {
                        // A native app holds the vault in its bridge (SAF
                        // URI, iOS bookmark), not in a browser handle.
                        if (isNativeApp()) nativeClearVault?.();
                        else await disconnectVault();
                        obsidianVaultHandleRef.current = null;
                        setObsidianConfig(null);
                        setObsidianLastSynced(null);
                        setWikilinkCandidates?.([]);
                        setUnportableVaultFiles?.([]);
                        localStorage.removeItem('day-planner-obsidian-last-synced');
                        // Remove Obsidian-imported tasks
                        setTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                        setUnscheduledTasks(prev => prev.filter(t => t.importSource !== 'obsidian'));
                      }}
                      className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
                    >
                      {t('common.disconnect')}
                    </button>
                  </div>
                  {obsidianSyncStatus === 'success' && (
                    <p className={`text-xs text-green-500`}>{t('settings.obsidianSyncComplete')}</p>
                  )}
                  {obsidianSyncStatus === 'error' && (
                    <p className={`text-xs text-red-500`}>{t('settings.obsidianSyncFailed')}{obsidianSyncError ? `: ${obsidianSyncError}` : ''}</p>
                  )}
                  {obsidianLastSynced && (
                    <p className={`text-xs ${textSecondary}`}>
                      {t('common.lastSynced')}: {new Date(obsidianLastSynced).toLocaleString(locale)}
                    </p>
                  )}
                  {/* Native app in this branch = iOS (isNativeAndroid
                      took Android above): the pairing form's minting
                      path needs direct FSA vault access the native
                      bridge doesn't have — startBridgePairing can only
                      throw pairing_no_vault_access here, and the
                      form's status probe skips native handles. The
                      read-only status block is the working equivalent;
                      pairing happens once from a desktop and covers
                      this device (per-vault granularity, spec §3.2). */}
                  {isNativeApp()
                    ? <BridgeStatusPanel darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass} />
                    : <BridgePairingPanel vaultHandleRef={obsidianVaultHandleRef} darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass} />}
                  <UnportableVaultNamesPanel entries={unportableVaultFiles} darkMode={darkMode} textSecondary={textSecondary} />
                </div>
              ) : (<>
                {isNativeApp() && (
                  <p className={`text-xs ${textSecondary}`}>
                    {t('settings.obsidianNoVaultConfigured', { defaultValue: 'No vault configured. Open settings to select your Obsidian vault folder.' })}
                  </p>
                )}
                <button
                  onClick={async () => {
                    // Native app (iOS lands here; Android took its own
                    // branch above): the vault is picked through the
                    // NATIVE folder picker (UIDocumentPickerViewController
                    // via nativePickVault, which reloads the webview
                    // once a folder is chosen) — the FSA flow below is
                    // browser-only and, gated on Android alone, used to
                    // leave iPad with a dead connect button that could
                    // only alert about Chromium.
                    if (isNativeAndroid()) {
                      window.DayGlanceNative.openSettings();
                      return;
                    }
                    if (isNativeApp()) {
                      nativePickVault();
                      return;
                    }
                    if (!isFileSystemAccessSupported()) {
                      alert(t('settings.obsidianBrowserUnsupported', { defaultValue: 'Your browser does not support the File System Access API. Please use a Chromium-based browser (e.g., Chrome, Edge, Brave) to connect an Obsidian vault.' }));
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
                  {isNativeAndroid() ? t('settings.obsidianVaultSettings') : t('settings.obsidianSelectVault')}
                </button>
              </>)}
            </div>
            </SettingsCard>
            </>)}
        </>
      ),
    },
    trmnl: {
      show: true,
      card: true,
      node: (
        <>
            {/* TRMNL E-Ink Dashboard: a collapsible card like the other
                integrations; its Enable and Disable stay inside, and the dot
                shows while it pushes. Disable keeps the webhook and key. */}
            <SettingsCard
              cardId="trmnl"
              collapsible
              icon={LayoutGrid}
              title={t('settings.trmnlDashboard')}
              badge={trmnlConfig?.enabled ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
            <div className="space-y-3">
              <p className={`${textSecondary} text-xs`}>
                {t('settings.trmnlDescriptionPrefix', { defaultValue: 'Push your daily schedule to a' })} <a href="https://trmnl.com" target="_blank" rel="noopener noreferrer" className="underline">TRMNL</a> {t('settings.trmnlDescriptionSuffix', { defaultValue: 'e-ink display via webhook. Install the DayGLANCE recipe from the TRMNL Recipe Library to get started.' })}
              </p>
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.trmnlWebhookUrl')}</label>
                <input
                  type="url"
                  placeholder="https://usetrmnl.com/api/custom_plugins/your-uuid"
                  value={trmnlConfig?.webhookUrl || ''}
                  onChange={(e) => setTrmnlConfig(prev => ({ ...prev, webhookUrl: e.target.value }))}
                  className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                />
                <p className={`text-xs ${textSecondary} mt-1`}>
                  {t('settings.trmnlWebhookHint', { defaultValue: 'Found in your DayGLANCE recipe settings on TRMNL' })}
                </p>
                <p className={`text-xs ${textSecondary} mt-1`}>
                  {t('settings.trmnlOneDeviceHint', { defaultValue: 'TRMNL accepts a limited number of updates per hour for the whole plugin, so enable this on one device that is usually running.' })}
                </p>
              </div>
              <div>
                <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.trmnlApiKey')}</label>
                  <input
                    type="password"
                    placeholder={t('settings.trmnlBearerTokenPlaceholder', { defaultValue: 'Bearer token' })}
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
                      {trmnlSyncStatus === 'syncing' ? t('common.syncing') : t('common.syncNow')}
                    </button>
                    <button
                      onClick={() => setTrmnlConfig(prev => ({ ...prev, enabled: false }))}
                      className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm transition-colors`}
                    >
                      {t('common.disable')}
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
                    {t('settings.trmnlEnableSync')}
                  </button>
                )}
              </div>
              {trmnlSyncStatus === 'success' && <p className="text-xs text-green-500">{t('settings.trmnlSyncSuccess')}</p>}
              {trmnlSyncStatus === 'error' && <p className="text-xs text-red-500">{t('settings.trmnlSyncError')}</p>}
              {trmnlLastSynced && (
                <p className={`text-xs ${textSecondary}`}>
                  {t('common.lastSynced')}: {new Date(trmnlLastSynced).toLocaleString(locale)}
                </p>
              )}

            </div>
            </SettingsCard>
        </>
      ),
    },
    todoist: {
      show: true,
      card: true,
      node: (
        <>
            <SettingsCard cardId="todoist" collapsible icon={CheckSquare} title={t('todoist.title')} badge={todoistConnected ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null} darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}>
              <TodoistSettings variant="card" />
            </SettingsCard>
        </>
      ),
    },
    localIntegrations: {
      show: !!window.electronAPI?.localIntegrations,
      card: true,
      node: (
        <>
            {/* Local Integrations (Stream Deck + MCP) — Electron only,
                renders nothing on web/mobile builds. */}
            <SettingsCard cardId="localIntegrations" collapsible icon={Plug} title={t('settings.localIntegrations')} badge={localIntegrationsOn ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null} darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}>
              <LocalIntegrationsSettings variant="card" />
            </SettingsCard>
        </>
      ),
    },
    glanceIntegrations: {
      show: true,
      card: true,
      node: (
        <>
            {/* GLANCE Integrations Section */}
            <SettingsCard
              cardId="glanceApps"
              collapsible
              icon={Activity}
              title={t('settings.glanceIntegrations')}
              badge={Object.values(intentsSaved).some(Boolean) ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
            <div className="space-y-3">
              <p className={`${textSecondary} text-xs`}>
                {t('settings.glanceIntegrationsDesc', { defaultValue: 'Connect dayGLANCE to other Glance-compatible apps via a shared WebDAV event log.' })}
              </p>
              {/* One card per protocol, each open from the start only when it is
                  on, so the page lists what is set up and folds the rest. */}
              <SettingsCard
                cardId="intentsWebdav"
                collapsible
                defaultOpen={intentsSaved.webdav}
                icon={Cloud}
                title={t('settings.glanceWebdavLog')}
                badge={intentsSaved.webdav ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null}
                darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
              >
              <div className="space-y-3">
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.glanceServerUrl')}</label>
                  <input
                    type="url"
                    placeholder="https://nextcloud.example.com/remote.php/dav/files/user"
                    value={intentForm.webdavUrl}
                    onChange={e => setIntentForm(p => ({ ...p, webdavUrl: e.target.value }))}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>{t('common.username')}</label>
                    <input
                      type="text"
                      placeholder={t('common.username')}
                      value={intentForm.username}
                      onChange={e => setIntentForm(p => ({ ...p, username: e.target.value }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    />
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.appPassword')}</label>
                    <input
                      type="password"
                      placeholder="••••••••••••"
                      value={intentForm.appPassword}
                      onChange={e => setIntentForm(p => ({ ...p, appPassword: e.target.value }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    />
                  </div>
                </div>
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.glanceEventsPath')}</label>
                  <input
                    type="text"
                    placeholder="/GLANCE/events/"
                    value={intentForm.eventsPath}
                    onChange={e => setIntentForm(p => ({ ...p, eventsPath: e.target.value }))}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                  />
                  <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.glanceEventsPathHint', { defaultValue: 'Path on the WebDAV server where event files are stored.' })}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.glanceForegroundPoll')}</label>
                    <select
                      value={intentForm.foregroundInterval}
                      onChange={e => setIntentForm(p => ({ ...p, foregroundInterval: Number(e.target.value) }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    >
                      <option value={30000}>{formatUnit(30, 'second')}</option>
                      <option value={60000}>{formatUnit(1, 'minute')}</option>
                      <option value={120000}>{formatUnit(2, 'minute')}</option>
                      <option value={300000}>{formatUnit(5, 'minute')}</option>
                      <option value={600000}>{formatUnit(10, 'minute')}</option>
                      <option value={1800000}>{formatUnit(30, 'minute')}</option>
                    </select>
                  </div>
                  <div>
                    <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.glanceBackgroundPoll')}</label>
                    <select
                      value={intentForm.backgroundInterval}
                      onChange={e => setIntentForm(p => ({ ...p, backgroundInterval: Number(e.target.value) }))}
                      className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                    >
                      <option value={300000}>{formatUnit(5, 'minute')}</option>
                      <option value={900000}>{formatUnit(15, 'minute')}</option>
                      <option value={1800000}>{formatUnit(30, 'minute')}</option>
                      <option value={3600000}>{formatUnit(1, 'hour')}</option>
                      <option value={21600000}>{formatUnit(6, 'hour')}</option>
                      <option value={86400000}>{formatUnit(24, 'hour')}</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className={`block text-sm ${textSecondary} mb-1`}>{t('settings.glanceEventRetention')}</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={intentForm.gcRetentionDays}
                    onChange={e => setIntentForm(p => ({ ...p, gcRetentionDays: e.target.value }))}
                    className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                  />
                  <p className={`text-xs ${textSecondary} mt-1`}>{t('settings.glanceRetentionHint', { defaultValue: 'Event files older than this are deleted automatically.' })}</p>
                </div>
                <div className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass} ${cloudSyncConfig?.encryptionEnabled ? '' : 'opacity-60'}`}>
                  <input
                    type="checkbox"
                    id="intent-encryption-toggle"
                    checked={intentForm.encryptionEnabled && !!cloudSyncConfig?.encryptionEnabled}
                    disabled={!cloudSyncConfig?.encryptionEnabled || intentSetupPhase !== null}
                    onChange={e => setIntentForm(p => ({ ...p, encryptionEnabled: e.target.checked }))}
                    className="mt-0.5 h-4 w-4 rounded"
                  />
                  <div>
                    <label htmlFor="intent-encryption-toggle" className={`text-sm font-medium ${textPrimary} ${cloudSyncConfig?.encryptionEnabled ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                      {t('settings.glanceEncryptEvents', { defaultValue: 'Encrypt intent events' })}
                    </label>
                    {cloudSyncConfig?.encryptionEnabled ? (
                      <p className={`text-xs ${textSecondary} mt-0.5`}>{t('settings.glanceEncryptionEnabledHint', { defaultValue: 'Uses your cloud sync passphrase. Set up once; remains active across sessions.' })}</p>
                    ) : (
                      <p className={`text-xs ${textSecondary} mt-0.5`}>{t('settings.glanceEncryptionRequiredHint', { defaultValue: 'Requires cloud sync encryption to be enabled first.' })}</p>
                    )}
                  </div>
                </div>

                {/* Intents encryption setup — inline passphrase prompt or error */}
                {intentSetupPhase === 'passphrase-needed' && (
                  <div className={`p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <Lock size={13} className="text-blue-500 flex-shrink-0" />
                      <span className={`text-sm font-medium ${textPrimary}`}>{t('settings.intentsPassphraseSetupTitle', { defaultValue: 'Enter your sync passphrase to complete setup' })}</span>
                    </div>
                    <p className={`text-xs ${textSecondary} mb-3`}>
                      {t('settings.intentsPassphraseSetupHint', { defaultValue: 'Required once to derive the intents encryption key. After this, no passphrase is needed across sessions.' })}
                    </p>
                    <input
                      type="password"
                      autoFocus
                      value={intentPassphraseInput}
                      onChange={e => setIntentPassphraseInput(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setIntentSetupPhase(null); setIntentPassphraseInput(''); } }}
                      placeholder={t('sync.passphrasePlaceholder', { defaultValue: 'Your sync passphrase' })}
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
                          const cfg = {
                            ...intentForm,
                            gcRetentionDays: Number(intentForm.gcRetentionDays) || 30,
                            encryptionEnabled: true,
                          };
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
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm"
                      >
                        {t('common.confirm')}
                      </button>
                      <button
                        onClick={() => { setIntentSetupPhase(null); setIntentPassphraseInput(''); }}
                        className={`px-3 py-1.5 ${darkMode ? 'bg-gray-600 hover:bg-gray-500' : 'bg-stone-200 hover:bg-stone-300'} ${textPrimary} rounded-lg text-sm`}
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
                {intentSetupPhase === 'running' && (
                  <div className={`flex items-center gap-2 p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                    <Loader size={14} className="animate-spin text-blue-500" />
                    <span className={`text-sm ${textSecondary}`}>{t('settings.intentsEncryptionSettingUp', { defaultValue: 'Setting up intents encryption…' })}</span>
                  </div>
                )}
                {intentSetupPhase?.error && (
                  <div className={`p-3 rounded-lg border border-red-300 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
                    <p className="text-sm text-red-500">{t('settings.intentsSetupFailed', { error: intentSetupPhase.error, defaultValue: 'Setup failed: {{error}}' })}</p>
                    <button
                      onClick={() => setIntentSetupPhase(null)}
                      className="mt-1 text-xs text-red-400 hover:text-red-300 underline"
                    >
                      {t('common.dismiss')}
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    disabled={intentSetupPhase === 'running' || intentSetupPhase === 'passphrase-needed'}
                    onClick={async () => {
                      const wantsEncryption = intentForm.encryptionEnabled && !!cloudSyncConfig?.encryptionEnabled;
                      const cfg = {
                        ...intentForm,
                        gcRetentionDays: Number(intentForm.gcRetentionDays) || 30,
                        encryptionEnabled: wantsEncryption,
                      };

                      // If encryption is being turned off, clear the cached root key.
                      if (!wantsEncryption) {
                        await clearIntentsRootKey();
                      }

                      // If encryption is on, ensure setup is complete before saving.
                      if (wantsEncryption) {
                        const rootKey = await loadIntentsRootKey();
                        if (!rootKey) {
                          const passphrase = getSyncPassphrase();
                          if (passphrase) {
                            // Passphrase already in session — run setup silently.
                            setIntentSetupPhase('running');
                            try {
                              await setupIntentsEncryption(cfg, passphrase);
                            } catch (err) {
                              setIntentSetupPhase({ error: err.message });
                              return;
                            }
                            setIntentSetupPhase(null);
                          } else {
                            // Passphrase not in session — show inline prompt.
                            setIntentSetupPhase('passphrase-needed');
                            return; // save deferred until passphrase confirmed
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
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 text-sm transition-colors flex items-center gap-1.5"
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
                  <button
                    onClick={() => setShowIntentActivityLog(true)}
                    className={`px-4 py-2 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-sm flex items-center gap-1.5 transition-colors`}
                  >
                    <Activity size={14} />
                    {t('settings.glanceActivityLog')}
                  </button>
                </div>
              </div>

              </SettingsCard>

              {/* GLANCEvault intents (beta) — DB transport. Independent of the
                  WebDAV intents config above AND of the vault sync toggle; it only
                  INHERITS the vault connection from the GLANCEvault sync config. */}
              <SettingsCard
                cardId="intentsVault"
                collapsible
                defaultOpen={intentsSaved.vault}
                icon={Server}
                title={t('settings.glanceVaultIntents', { defaultValue: 'GLANCEvault intents' })}
                badge={<><span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-600'}`}>{t('settings.beta', { defaultValue: 'Beta' })}</span>{intentsSaved.vault ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null}</>}
                darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
              >
                <div className="space-y-3">
                <p className={`${textSecondary} text-xs`}>
                  {t('settings.glanceVaultIntentsDesc', { defaultValue: 'Deliver intents over your GLANCEvault server instead of (or alongside) the WebDAV event log. Uses the same vault connection as GLANCEvault sync — no separate URL or token needed.' })}
                </p>

                {(() => {
                  const dbConn = getDbIntentsConnection();
                  return (
                    <>
                      <div className={`text-xs px-3 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/40' : 'bg-stone-50'}`}>
                        {dbConn ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                            <span className={textSecondary}>{t('settings.glanceVaultConnectionReady', { defaultValue: 'Vault connection detected — ready to enable.' })}</span>
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
                            <span className={textSecondary}>{t('settings.glanceVaultConnectionMissing', { defaultValue: 'No vault connection. Configure GLANCEvault in Cloud Sync settings first.' })}</span>
                          </span>
                        )}
                      </div>

                      <div className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass} ${dbConn ? '' : 'opacity-60'}`}>
                        <input
                          type="checkbox"
                          id="db-intents-toggle"
                          checked={dbIntentsEnabled}
                          disabled={!dbConn}
                          onChange={e => setDbIntentsEnabled(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded"
                        />
                        <div>
                          <label htmlFor="db-intents-toggle" className={`text-sm font-medium ${textPrimary} ${dbConn ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                            {t('settings.glanceVaultIntentsEnable', { defaultValue: 'Enable GLANCEvault intents' })}
                          </label>
                          <p className={`text-xs ${textSecondary} mt-0.5`}>
                            {t('settings.glanceVaultIntentsHint', { defaultValue: 'Independent of WebDAV intents and of GLANCEvault sync. Saving reloads the app so the poller restarts.' })}
                          </p>
                        </div>
                      </div>

                      {/* Vault intents are ALWAYS encrypted. Enabling derives + caches the
                          vault intents key BEFORE the reload (the passphrase is gone after).
                          Prompt only when the passphrase is actually unavailable. */}
                      {dbIntentsSetupPhase === 'passphrase-needed' && (
                        <div className={`p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                          <p className={`text-sm ${textPrimary} mb-2`}>
                            {t('settings.glanceVaultPassphrasePrompt', { defaultValue: 'GLANCEvault intents are always encrypted. Enter your sync passphrase to set up the encryption key.' })}
                          </p>
                          <input
                            type="password"
                            autoFocus
                            value={dbIntentsPassphraseInput}
                            onChange={e => setDbIntentsPassphraseInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Escape') { setDbIntentsSetupPhase(null); setDbIntentsPassphraseInput(''); setDbIntentsEnabled(false); } }}
                            placeholder={t('sync.passphrasePlaceholder', { defaultValue: 'Your sync passphrase' })}
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
                                // Key cached — now persist the toggle and reload the poller.
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
                            {t('settings.glanceVaultEncryptionRequired', { defaultValue: "Encryption setup is required — GLANCEvault intents won't be enabled until the key is set up." })}
                          </p>
                        </div>
                      )}
                      {dbIntentsSetupPhase === 'running' && (
                        <div className={`flex items-center gap-2 p-3 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'}`}>
                          <Loader size={14} className="animate-spin text-blue-500" />
                          <span className={`text-sm ${textSecondary}`}>{t('settings.glanceVaultEncryptionSettingUp', { defaultValue: 'Setting up vault intents encryption…' })}</span>
                        </div>
                      )}
                      {dbIntentsSetupPhase?.error && (
                        <div className={`p-3 rounded-lg border border-red-300 ${darkMode ? 'bg-red-900/20' : 'bg-red-50'}`}>
                          <p className="text-sm text-red-500">{t('settings.intentsSetupFailed', { error: dbIntentsSetupPhase.error, defaultValue: 'Setup failed: {{error}}' })}</p>
                          <button
                            onClick={() => { setDbIntentsSetupPhase(null); setDbIntentsEnabled(false); }}
                            className="mt-1 text-xs text-red-400 hover:text-red-300 underline"
                          >
                            {t('common.dismiss')}
                          </button>
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          disabled={dbIntentsSetupPhase === 'running' || dbIntentsSetupPhase === 'passphrase-needed'}
                          onClick={async () => {
                            // Match-by-construction: spread the EXISTING config and override
                            // only `enabled`, so ttlMs / pollIntervalMinutes are preserved
                            // (not re-seeded). Persist via the config module's own saver to
                            // the exact key the gate reads.
                            const existing = getDbIntentsConfig() || {};
                            const wasEnabled = !!existing.enabled;
                            // Vault intents are always encrypted — make sure the vault intents
                            // key is derived + cached BEFORE the reload (the passphrase is gone
                            // after). Only when enabling (or on with no key cached yet).
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
                            // Reload-on-change so useDbIntentPoller remounts and picks up the
                            // new config (mirrors the GLANCEvault sync toggle's behavior). The
                            // post-reload useOutboxFlush mount drain flushes any held intents
                            // now that the vault key exists.
                            if (wasEnabled !== dbIntentsEnabled) {
                              window.location.reload();
                              return;
                            }
                            // No reload (already enabled): the key may have just been set up,
                            // so flush held intents now.
                            await flushOutboxNow();
                            setDbIntentsSaved(true);
                            setTimeout(() => setDbIntentsSaved(false), 2000);
                          }}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 text-sm transition-colors"
                        >
                          {dbIntentsSaved ? t('common.saved') : t('common.save')}
                        </button>
                      </div>
                    </>
                  );
                })()}
                </div>
              </SettingsCard>

              {/* iCloud intents opt-in — Apple platforms only (isICloudAvailable()
                  is false on Android/web). Gates ACTIVATION of the iCloud intents
                  transport (emit + poll); default OFF so the path stays inert
                  until the user opts in. */}
              {isICloudAvailable() && (
                <SettingsCard
                cardId="intentsIcloud"
                collapsible
                defaultOpen={intentsSaved.icloud}
                icon={Cloud}
                title={t('settings.icloudIntents')}
                badge={<>{intentsSaved.icloud ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null}</>}
                darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
              >
                <div className="space-y-3">
                  <p className={`${textSecondary} text-xs`}>
                    {t('settings.icloudIntentsDesc')}
                  </p>
                  <div className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass}`}>
                    <input
                      type="checkbox"
                      id="icloud-intents-toggle"
                      checked={icloudIntentsEnabled}
                      onChange={e => setIcloudIntentsEnabledState(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded"
                    />
                    <div>
                      <label htmlFor="icloud-intents-toggle" className={`text-sm font-medium ${textPrimary} cursor-pointer`}>
                        {t('settings.icloudIntentsEnable')}
                      </label>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const wasEnabled = getIcloudIntentsEnabledFlag();
                      setIcloudIntentsEnabled(icloudIntentsEnabled);
                      // Reload so the intent poller remounts and re-reads the
                      // opt-in (mirrors the GLANCEvault intents reload-on-change).
                      if (wasEnabled !== icloudIntentsEnabled) {
                        window.location.reload();
                        return;
                      }
                      setIcloudIntentsSaved(true);
                      setTimeout(() => setIcloudIntentsSaved(false), 2000);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    {icloudIntentsSaved ? t('common.saved') : t('common.save')}
                  </button>
                </div>
              </SettingsCard>
              )}

              {/* Direct Access intents opt-in — wherever the folder bridge exists
                  (docs/direct-access-sync.md, Phase 7). Gates the event-set
                  transport (emit + poll); default OFF, and inert until a folder
                  is connected on this device. */}
              {isDirectAccessSupported() && (
                <SettingsCard
                cardId="intentsDirectAccess"
                collapsible
                defaultOpen={intentsSaved.directAccess}
                icon={FolderOpen}
                title={t('settings.directAccessIntents')}
                badge={<>{intentsSaved.directAccess ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null}</>}
                darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
              >
                <div className="space-y-3">
                  <p className={`${textSecondary} text-xs`}>
                    {t('settings.directAccessIntentsDesc')}
                  </p>
                  {!directAccessStatus.connected && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">{t('settings.directAccessIntentsNeedsFolder')}</p>
                  )}
                  <DirectAccessFileRow slot="events" darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass} />
                  <div className={`flex items-start gap-3 p-3 rounded-lg border ${borderClass}`}>
                    <input
                      type="checkbox"
                      id="direct-access-intents-toggle"
                      checked={directAccessIntentsEnabled}
                      onChange={e => setDirectAccessIntentsEnabledState(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded"
                    />
                    <div>
                      <label htmlFor="direct-access-intents-toggle" className={`text-sm font-medium ${textPrimary} cursor-pointer`}>
                        {t('settings.directAccessIntentsEnable')}
                      </label>
                    </div>
                  </div>
                  {directAccessIntentsKeyWanted && (
                    <div className={`p-3 rounded-lg border ${borderClass} space-y-2`}>
                      <p className={`text-sm ${textPrimary}`}>{t('settings.intentsPassphraseSetupTitle', { defaultValue: 'Enter your sync passphrase to complete setup' })}</p>
                      <p className={`text-xs ${textSecondary}`}>{t('settings.intentsPassphraseSetupHint', { defaultValue: 'Required once to derive the intents encryption key. After this, no passphrase is needed across sessions.' })}</p>
                      <input
                        type="password"
                        autoFocus
                        value={directAccessIntentsPassphrase}
                        onChange={e => setDirectAccessIntentsPassphrase(e.target.value)}
                        placeholder={t('sync.passphrasePlaceholder', { defaultValue: 'Your sync passphrase' })}
                        className={`w-full px-3 py-2 border ${borderClass} rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-gray-700 text-white' : 'bg-white text-stone-900'} text-sm`}
                      />
                    </div>
                  )}
                  <button
                    onClick={async () => {
                      const wasEnabled = getDirectAccessIntentsEnabledFlag();
                      if (directAccessIntentsEnabled && directAccessStatus.encrypt) {
                        const typed = directAccessIntentsPassphrase.trim();
                        if (typed) setSyncPassphrase(typed);
                        const r = await resolveDirectAccessIntentsKey({ transport: directAccessTransport });
                        if (!r.key) { setDirectAccessIntentsKeyWanted(true); return; }
                        setDirectAccessIntentsKeyWanted(false);
                        setDirectAccessIntentsPassphrase('');
                      }
                      setDirectAccessIntentsEnabled(directAccessIntentsEnabled);
                      // Reload so the poller remounts and re-reads the opt-in,
                      // as the iCloud and GLANCEvault intents switches do.
                      if (wasEnabled !== directAccessIntentsEnabled) {
                        window.location.reload();
                        return;
                      }
                      setDirectAccessIntentsSaved(true);
                      setTimeout(() => setDirectAccessIntentsSaved(false), 2000);
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    {directAccessIntentsSaved ? t('common.saved') : t('common.save')}
                  </button>
                </div>
              </SettingsCard>
              )}
            </div>
            </SettingsCard>
        </>
      ),
    },
    // GLANCElauncher (utils/launcherPromo.js): wherever this device is offered
    // it, always, so the link outlives the dismissed Settings card.
    glanceLauncher: {
      show: !!launcherPromo.url,
      card: true,
      node: (
        <LauncherPromoEntry
          url={launcherPromo.url}
          darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
        />
      ),
    },
    automationIntents: {
      show: isNativeAndroid(),
      card: true,
      node: (
        <>
            {/* Automation intents (Tasker) — Android only. Opt-in gate for the
                exported IntentReceiver + outbound RESULT/NOTIFY broadcasts.
                A collapsible card with a status dot like every integration;
                the warning sits under the switch that turns it on. */}
            {isNativeAndroid() && (
            <SettingsCard
              cardId="automationIntents"
              collapsible
              icon={Zap}
              title={t('settings.automationIntents')}
              hint={t('settings.automationIntentsDesc')}
              badge={automationIntentsEnabled ? <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" /> : null}
              darkMode={darkMode} textPrimary={textPrimary} textSecondary={textSecondary} borderClass={borderClass}
            >
              <div className="space-y-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input
                      type="checkbox"
                      id="automation-intents-toggle"
                      checked={automationIntentsEnabled}
                      onChange={(e) => {
                        const v = e.target.checked;
                        setAutomationIntentsEnabled(v);
                        nativeSetAutomationIntentsEnabled(v);
                      }}
                      className="sr-only"
                    />
                    <div className={`w-10 h-6 rounded-full transition-colors ${automationIntentsEnabled ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                      <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${automationIntentsEnabled ? 'translate-x-5' : 'translate-x-1'}`} />
                    </div>
                  </div>
                  <span className={`text-sm ${textPrimary}`}>{t('settings.automationIntentsToggle')}</span>
                </label>
                <p className={`text-xs ${textSecondary}`}>{t('settings.automationIntentsWarning')}</p>
              </div>
            </SettingsCard>
            )}
        </>
      ),
    },
  };
}

/**
 * The GLANCE apps WebDAV form, as edited. Integrations edits it; the
 * multi-user card reads it live to offer the users folder, so the dialog
 * holds it once and passes it to both.
 */
export function useIntentForm() {
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
  return [intentForm, setIntentForm];
}
