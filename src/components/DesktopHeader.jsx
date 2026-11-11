import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BookOpen, ChevronLeft, ChevronRight, Cloud,
  HelpCircle, Moon, RefreshCw, Settings, Sun,
} from 'lucide-react';
import { dateToString, formatDateRange } from '../utils/taskUtils.js';
import { formatLocalizedDate, localizedWeekdays } from '../utils/localeFormatting.js';
import { hasNativeCalendar } from '../utils/nativeCalendar.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useMcpStatus, McpBoltButton, McpStatusModal } from './McpStatusControls.jsx';
import DayDialIcon from './DayDialIcon.jsx';
import SpaceSwitcher, { GoalsSpaceTitle } from './SpaceSwitcher.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { runSyncNow } from '../utils/syncNowAction.js';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const DesktopHeader = () => {
  const {
    visibleDays, visibleDates,
    effectiveViewMode, dayViewColumns, dayViewRollingPaused,
    weekViewDates,
    selectedDate,
    darkMode, setDarkMode,
    use24HourClock,
    showMonthView, setShowMonthView,
    monthViewActive,
    setShowDayDial,
    viewedMonth, setViewedMonth,
    setShowSettings, openSettings,
    updateInfo,
    setShowHelpModal,
    weather, weatherTempUnit, weatherEnabled,
    dailyContent, contentRotation, dailyContentEnabled,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg, colors,
    changeDate, goToToday, goToDate, changeViewedMonth,
    getDateIndicators, getMonthDays,
    weekStartDay,
  } = useDayPlannerCtx();
  const {
    calSyncStatus, calSyncLastSynced, calSyncConfigured,
    isSyncing,
    cloudSyncConfig, cloudSyncStatus, cloudSyncLastSynced,
    vaultEnabled, vaultStatus, vaultLastSynced, vaultSyncNow,
    obsidianConfig, obsidianSyncStatus, obsidianSyncError, obsidianLastSynced, obsidianVaultAccess,
    cloudSyncDownload, syncAll, performObsidianSync,
  } = useSyncCtx();
  const { desktopSpace = 'calendar' } = useFeaturesCtx();
  const { t, i18n } = useTranslation();
  // The header is the same in both spaces (height, left widgets, right icon
  // cluster); only the centre swaps: date navigation in the Calendar space,
  // the space's title and counts in the Goals & Projects space.
  const goalsSpace = desktopSpace === 'goals';

  // Cloud-sync button: only meaningful once WebDAV and/or GLANCEvault is set up.
  // (Single-device or zero-config iCloud users get no button — Settings still has
  // the full config.) When only the vault is enabled, the button drives a vault
  // sync and reflects vault status. The file tier runs the full cycle
  // (read → merge → write) — see utils/syncNowAction.js for why it must never be
  // a bare upload.
  const webdavOn = !!cloudSyncConfig?.enabled;
  const syncConfigured = webdavOn || vaultEnabled;
  const effSyncStatus = webdavOn ? cloudSyncStatus : vaultStatus;
  const effSyncLastSynced = webdavOn ? cloudSyncLastSynced : vaultLastSynced;
  const effSyncing = effSyncStatus === 'uploading' || effSyncStatus === 'downloading';
  const triggerSync = () => runSyncNow({ webdavOn, vaultEnabled, cloudSyncDownload, vaultSyncNow });
  const locale = i18n.resolvedLanguage || i18n.language;
  const formatSyncTime = (timestamp) => new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: !use24HourClock,
  }).format(new Date(timestamp));
  const lastSynced = (timestamp) => (timestamp
    ? ` — ${t('common.lastSynced')}: ${formatSyncTime(timestamp)}`
    : '');

  // §6.5 canonical MCP surface: createTray() runs on macOS and Windows only, so
  // this cluster button is the only ambient bound-listener signal (and
  // reachable kill switch / bulk undo outside Settings) on Linux, and the
  // in-app one everywhere.
  const mcp = useMcpStatus();
  const [mcpOpen, setMcpOpen] = useState(false);

  const dateLabel = monthViewActive
    ? formatLocalizedDate(selectedDate, { month: 'long', year: 'numeric' }, locale)
    : effectiveViewMode === 'day'
    ? formatDateRange([...new Map(dayViewColumns.map(c => [c.dateStr, c.date])).values()], t, locale)
    : effectiveViewMode === 'jobo'
    ? formatDateRange([selectedDate], t, locale)
    : effectiveViewMode === 'week' && weekViewDates.length > 0
    ? formatDateRange(weekViewDates, t, locale)
    : formatDateRange(visibleDates, t, locale);

  return (
    <>
      <div className={`${cardBg} border-b ${borderClass} px-4 py-2 grid grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center gap-3 relative`} style={{ height: '80px' }}>
        {/* Left: space switcher, then Weather + Daily Content */}
        <div className="flex items-center gap-4 min-w-0">
          <SpaceSwitcher />
          {weather && weatherEnabled && (
            <>
              {/* Current weather */}
              <div className={`flex items-center gap-2 px-3 py-1.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-100'} rounded-lg flex-shrink-0`}>
                <div className="text-xl">{weather.icon}</div>
                <div>
                  <div className={`text-sm font-bold ${textPrimary}`}>{weather.temp}°{weatherTempUnit === 'celsius' ? 'C' : 'F'}</div>
                  <div className={`text-[10px] ${textSecondary}`}>H: {weather.high}° L: {weather.low}°</div>
                </div>
              </div>

              {/* Forecast — proportional to visible day columns */}
              {visibleDays >= 2 && weather.forecast && weather.forecast.length > 0 && (
                <div className="hidden min-[1230px]:flex items-center gap-1.5 flex-shrink-0">
                  {weather.forecast.slice(0, visibleDays === 3 ? 5 : 3).map((day, index) => (
                    <div key={index} className={`px-2 py-1.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-100'} rounded-lg text-center`}>
                      <div className={`text-[10px] font-semibold ${textSecondary}`}>{day.day}</div>
                      <div className="text-base">{day.icon}</div>
                      <div className={`text-[10px] ${textPrimary}`}>
                        <span className="font-semibold">{day.high}°</span>
                        <span className={`${textSecondary} ml-0.5`}>{day.low}°</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Rotating Daily Content - 1 item at a time (3-col only to avoid header overlap) */}
          {dailyContentEnabled && visibleDays >= 3 && (() => {
            const contentItems = [
              { key: 'dadJoke', icon: '😄', label: 'Dad Joke', content: dailyContent.dadJoke },
              { key: 'funFact', icon: '💡', label: 'Fun Fact', content: dailyContent.funFact },
              { key: 'quote', icon: '💬', label: 'Quote', content: dailyContent.quote ? `"${dailyContent.quote.text}" — ${dailyContent.quote.author}` : null },
              { key: 'history', icon: '📜', label: 'This Day in History', content: dailyContent.history ? `${dailyContent.history.year}: ${dailyContent.history.text}` : null }
            ].filter(item => item.content);

            if (contentItems.length === 0) return null;

            const idx1 = contentRotation % contentItems.length;
            const item = contentItems[idx1];

            return (
              <div className={`flex-1 max-w-md px-3 py-1.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-100'} rounded-lg overflow-hidden min-w-0 transition-opacity duration-500 hidden min-[2300px]:block`}>
                <div className={`text-[10px] font-semibold ${textSecondary} mb-0.5`}>{item.icon} {item.label}</div>
                <div className={`text-xs ${textPrimary} leading-snug line-clamp-2`}>{item.content}</div>
              </div>
            );
          })()}
        </div>

        {/* Keep date navigation in flow: side content must reserve its own space. */}
        <div className="min-w-0">
        {goalsSpace ? (
          <GoalsSpaceTitle />
        ) : (
        <div className="min-w-0">
          <div className="flex items-center gap-1 relative min-w-0">
            <button onClick={() => changeDate(-1)} className={`p-1.5 rounded-lg ${hoverBg} transition-colors flex-shrink-0`} aria-label={t('common.back')}>
              <ChevronLeft size={20} className={textSecondary} />
            </button>
            <button
              onClick={() => {
                if (!showMonthView) setViewedMonth(new Date(selectedDate));
                setShowMonthView(!showMonthView);
              }}
              className={`month-view-toggle ${textPrimary} font-semibold text-base px-2 py-1 rounded-lg ${hoverBg} transition-colors cursor-pointer text-center w-52 basis-52 shrink min-w-0 truncate`}
              title={dateLabel}
            >
              {dateLabel}
            </button>
            <button onClick={() => changeDate(1)} className={`p-1.5 rounded-lg ${hoverBg} transition-colors flex-shrink-0`} aria-label={t('common.next')}>
              <ChevronRight size={20} className={textSecondary} />
            </button>
            <button
              onClick={goToToday}
              className={`ml-1 px-3 py-1 flex-shrink-0 text-xs bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors${dateToString(selectedDate) === dateToString(new Date()) && !dayViewRollingPaused ? ' invisible' : ''}`}
            >
              {t('common.today')}
            </button>
            {/* Month View Popup */}
            {showMonthView && (
              <div className={`month-view-container absolute top-full left-1/2 -translate-x-1/2 mt-2 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-4 z-50 min-w-[300px]`}>
                <div className="flex items-center justify-between mb-3">
                  <button type="button" onClick={(e) => { e.stopPropagation(); changeViewedMonth(-1); }} className={`p-1 rounded ${hoverBg}`}>
                    <ChevronLeft size={18} className={textSecondary} />
                  </button>
                  <div className={`font-bold ${textPrimary}`}>
                    {formatLocalizedDate(viewedMonth, { month: 'long', year: 'numeric' })}
                  </div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); changeViewedMonth(1); }} className={`p-1 rounded ${hoverBg}`}>
                    <ChevronRight size={18} className={textSecondary} />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {(() => { const d = localizedWeekdays('narrow'); return [...d.slice(weekStartDay), ...d.slice(0, weekStartDay)]; })().map((day, index) => (
                    <div key={`${index}-${day}`} className={`text-xs font-semibold ${textSecondary} text-center`}>{day}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {getMonthDays().map((day, index) => {
                    const isDayToday = day && day.toDateString() === new Date().toDateString();
                    const isSelected = day && day.toDateString() === selectedDate.toDateString();
                    const { hasNote, hasImported, hasAppTask } = getDateIndicators(day);
                    const hasDots = hasNote || hasImported || hasAppTask;
                    return (
                      <button
                        key={index}
                        onClick={() => day && goToDate(day)}
                        disabled={!day}
                        className={`h-10 rounded text-sm relative ${!day ? 'invisible' : ''} ${isSelected ? 'bg-blue-600 text-white font-bold' : ''} ${!isSelected && isDayToday ? 'bg-blue-100 dark:bg-blue-900 font-semibold' : ''} ${!isSelected && !isDayToday ? `${textPrimary} hover:bg-stone-100 dark:hover:bg-gray-700` : ''} ${!day ? '' : 'cursor-pointer'}`}
                      >
                        {day && day.getDate()}
                        {hasDots && (
                          <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 flex gap-0.5">
                            {hasNote && <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-yellow-500'}`} />}
                            {hasImported && <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-stone-400'}`} />}
                            {hasAppTask && <div className={`w-1 h-1 rounded-full ${isSelected ? 'bg-white' : 'bg-blue-600'}`} />}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
        </div>

        {/* Right: Action buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0 justify-self-end">
          {!hasNativeCalendar() && <button
            onClick={() => {
              if (isSyncing) return;
              if (calSyncConfigured) {
                syncAll();
              } else {
                openSettings('integrations', 'calendarSync');
              }
            }}
            disabled={isSyncing}
            className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg} ${isSyncing ? 'opacity-70 cursor-not-allowed' : ''}`}
            title={isSyncing
              ? t('common.syncing')
              : (calSyncConfigured
                ? `${t('settings.syncCalendars')}${lastSynced(calSyncLastSynced)}`
                : t('settings.calendarSync'))}
          >
            <RefreshCw size={18} className={`${textSecondary} ${isSyncing ? 'animate-spin' : ''}`} />
            {calSyncConfigured && (
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                isSyncing ? 'bg-blue-500 animate-pulse' :
                calSyncStatus === 'success' ? 'bg-green-500' :
                calSyncStatus === 'error' ? 'bg-red-500' :
                'bg-green-500'
              }`} />
            )}
          </button>}
          {syncConfigured && (
          <button
            // Red means the last sync failed: open Sync, where the error and
            // Sync now are, rather than retrying blind.
            onClick={() => (effSyncStatus === 'error' ? openSettings('sync', 'cloudSync') : triggerSync())}
            className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title={effSyncing
              ? t('common.syncing')
              : `${webdavOn ? t('settings.cloudSync') : t('sync.form.vaultTitle')}${lastSynced(effSyncLastSynced) || ` — ${t('common.lastSynced')}: ${t('common.never')}`}`}
          >
            <Cloud size={18} className={`${textSecondary} ${effSyncing ? 'animate-pulse' : ''}`} />
            <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
              effSyncing ? 'bg-blue-500 animate-pulse' :
              effSyncStatus === 'error' ? 'bg-red-500' :
              'bg-green-500'
            }`} />
          </button>
          )}
          {obsidianConfig?.enabled && (
            <button
              // Red (a failed sync or a lost vault) opens Obsidian's settings,
              // where the reason and the fix are; otherwise it syncs.
              onClick={() => (obsidianSyncStatus === 'error' || obsidianVaultAccess === 'lost'
                ? openSettings('integrations', 'obsidian')
                : performObsidianSync())}
              disabled={obsidianSyncStatus === 'syncing'}
              className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg} ${obsidianSyncStatus === 'syncing' ? 'opacity-70 cursor-not-allowed' : ''}`}
              title={obsidianSyncStatus === 'syncing'
                ? t('common.syncing')
                : obsidianVaultAccess === 'lost'
                  ? `${t('settings.obsidian')}: ${t('settings.obsidianVaultAccessLost')}`
                  : obsidianSyncStatus === 'error' && obsidianSyncError
                  ? `${t('settings.obsidian')}: ${t('settings.obsidianSyncFailed')} (${obsidianSyncError})`
                  : `${t('settings.obsidian')}${lastSynced(obsidianLastSynced) || ` — ${t('common.lastSynced')}: ${t('common.never')}`}`}
            >
              <BookOpen size={18} className={`${textSecondary} ${obsidianSyncStatus === 'syncing' ? 'animate-pulse' : ''}`} />
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                obsidianSyncStatus === 'syncing' ? 'bg-blue-500 animate-pulse' :
                obsidianSyncStatus === 'error' || obsidianVaultAccess === 'lost' ? 'bg-red-500' :
                'bg-green-500'
              }`} />
            </button>
          )}
          <McpBoltButton mcp={mcp} darkMode={darkMode} open={mcpOpen} onToggle={() => setMcpOpen(v => !v)} variant="cluster" />
          <button
            onClick={() => setShowDayDial(true)}
            className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title={`${t('settings.viewCalendarDay')} (O)`}
          >
            <DayDialIcon className={textSecondary} />
          </button>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title={darkMode ? t('settings.lightMode') : t('settings.darkMode')}
          >
            {darkMode ? <Sun size={18} className={textSecondary} /> : <Moon size={18} className={textSecondary} />}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title={t('common.settings')}
          >
            <Settings size={18} className={textSecondary} />
            {updateInfo && (
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-red-500`} />
            )}
          </button>
          <button
            onClick={() => setShowHelpModal(true)}
            className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title={t('app.helpFeedback')}
          >
            <HelpCircle size={18} className={textSecondary} />
          </button>
        </div>
      </div>
      {/* Desktop uses the app's standard modal chrome (backup/help pattern) —
          the earlier inline expansion pushed the whole calendar down. */}
      <McpStatusModal mcp={mcp} darkMode={darkMode} open={mcpOpen} onClose={() => setMcpOpen(false)} onOpenSettings={() => { setMcpOpen(false); openSettings('integrations', 'localIntegrations'); }} borderClass={borderClass} cardBg={cardBg} />
    </>
  );
};

export default DesktopHeader;
