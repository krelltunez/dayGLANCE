import React from 'react';
import {
  Bell, BookOpen, ChevronLeft, ChevronRight, Cloud,
  HelpCircle, Moon, RefreshCw, Save, Settings, Sun,
} from 'lucide-react';
import { dateToString, formatDateRange } from '../utils/taskUtils.js';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const DesktopHeader = () => {
  const {
    visibleDays, visibleDates,
    selectedDate,
    darkMode, setDarkMode,
    showMonthView, setShowMonthView,
    viewedMonth, setViewedMonth,
    setShowSettings,
    updateInfo,
    setShowHelpModal,
    weather, weatherTempUnit, weatherEnabled,
    dailyContent, contentRotation, dailyContentEnabled,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg, colors,
    changeDate, goToToday, goToDate, changeViewedMonth,
    getDateIndicators, getMonthDays,
  } = useDayPlannerCtx();
  const {
    calSyncStatus, calSyncLastSynced, calSyncConfigured,
    isSyncing,
    setShowBackupMenu,
    cloudSyncConfig, cloudSyncStatus, cloudSyncLastSynced,
    obsidianConfig, obsidianSyncStatus, obsidianSyncError, obsidianLastSynced,
    cloudSyncUpload, syncAll, performObsidianSync,
  } = useSyncCtx();
  const { setShowRemindersSettings, activeReminders } = useFeaturesCtx();

  return (
      <div className={`${cardBg} border-b ${borderClass} px-4 py-2 flex items-center justify-between relative`} style={{ height: '80px' }}>
        {/* Left: Weather + Daily Content */}
        <div className="flex items-center gap-4 min-w-0">
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
                <div className="flex items-center gap-1.5 flex-shrink-0">
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
              <div className={`flex-1 max-w-md px-3 py-1.5 ${darkMode ? 'bg-gray-700' : 'bg-stone-100'} rounded-lg overflow-hidden min-w-0 transition-opacity duration-500`}>
                <div className={`text-[10px] font-semibold ${textSecondary} mb-0.5`}>{item.icon} {item.label}</div>
                <div className={`text-xs ${textPrimary} leading-snug line-clamp-2`}>{item.content}</div>
              </div>
            );
          })()}
        </div>

        {/* Center: Logo + Date Nav */}
        {/* Narrow (<1080px): shift up + stack Today below. Wide: original 3-col grid centered. */}
        <div className="absolute inset-0 flex items-start pt-2 min-[1080px]:items-center min-[1080px]:pt-0 justify-center pointer-events-none">
        <div className="flex flex-col items-center gap-1 min-[1080px]:grid min-[1080px]:grid-cols-[1fr_auto_1fr] min-[1080px]:gap-0 pointer-events-auto">
          <div className="hidden min-[1080px]:flex justify-end pr-2">
            <img src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'} alt="dayGLANCE" className="h-10" />
          </div>
          <div className="flex items-center gap-1 relative">
            <button onClick={() => changeDate(-1)} className={`p-1.5 rounded-lg ${hoverBg} transition-colors`} aria-label="Previous day">
              <ChevronLeft size={20} className={textSecondary} />
            </button>
            <button
              onClick={() => {
                if (!showMonthView) setViewedMonth(new Date(selectedDate));
                setShowMonthView(!showMonthView);
              }}
              className={`month-view-toggle ${textPrimary} font-semibold text-base px-2 py-1 rounded-lg ${hoverBg} transition-colors cursor-pointer text-center min-w-[13rem]`}
            >
              {formatDateRange(visibleDates)}
            </button>
            <button onClick={() => changeDate(1)} className={`p-1.5 rounded-lg ${hoverBg} transition-colors`} aria-label="Next day">
              <ChevronRight size={20} className={textSecondary} />
            </button>
            {/* Month View Popup */}
            {showMonthView && (
              <div className={`month-view-container absolute top-full left-1/2 -translate-x-1/2 mt-2 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-4 z-50 min-w-[300px]`}>
                <div className="flex items-center justify-between mb-3">
                  <button type="button" onClick={(e) => { e.stopPropagation(); changeViewedMonth(-1); }} className={`p-1 rounded ${hoverBg}`}>
                    <ChevronLeft size={18} className={textSecondary} />
                  </button>
                  <div className={`font-bold ${textPrimary}`}>
                    {viewedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                  </div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); changeViewedMonth(1); }} className={`p-1 rounded ${hoverBg}`}>
                    <ChevronRight size={18} className={textSecondary} />
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 mb-2">
                  {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                    <div key={day} className={`text-xs font-semibold ${textSecondary} text-center`}>{day}</div>
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
          <div className="flex min-[1080px]:justify-start min-[1080px]:pl-5">
            <button
              onClick={goToToday}
              className={`px-3 py-1 text-xs bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors${dateToString(selectedDate) === dateToString(new Date()) ? ' invisible' : ''}`}
            >
              Today
            </button>
          </div>
        </div>
        </div>

        {/* Right: Action buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => {
              if (isSyncing) return;
              if (calSyncConfigured) {
                syncAll();
              } else {
                setShowSettings(true);
              }
            }}
            disabled={isSyncing}
            className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg} ${isSyncing ? 'opacity-70 cursor-not-allowed' : ''}`}
            title={isSyncing ? "Syncing..." : (calSyncConfigured ? `Sync calendars${calSyncLastSynced ? ` — last: ${new Date(calSyncLastSynced).toLocaleTimeString()}` : ''}` : "Configure calendar sync")}
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
          </button>
          <button
            onClick={() => {
              if (cloudSyncConfig?.enabled) {
                cloudSyncUpload();
              } else {
                setShowSettings(true);
              }
            }}
            className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title={cloudSyncConfig?.enabled
              ? (cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading' ? 'Syncing...' : `Cloud sync — last: ${cloudSyncLastSynced ? new Date(cloudSyncLastSynced).toLocaleTimeString() : 'never'}`)
              : 'Set up cloud sync'}
          >
            <Cloud size={18} className={`${textSecondary} ${(cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'animate-pulse' : ''}`} />
            {cloudSyncConfig?.enabled && (
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                (cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading') ? 'bg-blue-500 animate-pulse' :
                cloudSyncStatus === 'error' ? 'bg-red-500' :
                'bg-green-500'
              }`} />
            )}
          </button>
          {obsidianConfig?.enabled && (
            <button
              onClick={() => performObsidianSync()}
              disabled={obsidianSyncStatus === 'syncing'}
              className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg} ${obsidianSyncStatus === 'syncing' ? 'opacity-70 cursor-not-allowed' : ''}`}
              title={obsidianSyncStatus === 'syncing' ? 'Syncing...' : obsidianSyncStatus === 'error' && obsidianSyncError ? `Obsidian sync error: ${obsidianSyncError}` : `Obsidian sync — last: ${obsidianLastSynced ? new Date(obsidianLastSynced).toLocaleTimeString() : 'never'}`}
            >
              <BookOpen size={18} className={`${textSecondary} ${obsidianSyncStatus === 'syncing' ? 'animate-pulse' : ''}`} />
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} ${
                obsidianSyncStatus === 'syncing' ? 'bg-blue-500 animate-pulse' :
                obsidianSyncStatus === 'error' ? 'bg-red-500' :
                'bg-green-500'
              }`} />
            </button>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title="Settings"
          >
            <Settings size={18} className={textSecondary} />
            {updateInfo && (
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-red-500`} />
            )}
          </button>
          <button
            onClick={() => setShowRemindersSettings(true)}
            className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title="Reminders"
          >
            <Bell size={18} className={textSecondary} />
            {activeReminders.length > 0 && (
              <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-amber-500 animate-pulse`} />
            )}
          </button>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {darkMode ? <Sun size={18} className={textSecondary} /> : <Moon size={18} className={textSecondary} />}
          </button>
          <button
            onClick={() => setShowBackupMenu(true)}
            className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title="Backup or restore data"
          >
            <Save size={18} className={textSecondary} />
          </button>
          <button
            onClick={() => setShowHelpModal(true)}
            className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg ${hoverBg}`}
            title="Help & Feedback"
          >
            <HelpCircle size={18} className={textSecondary} />
          </button>
        </div>
      </div>
  );
};

export default DesktopHeader;
