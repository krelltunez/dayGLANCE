// Settings: the Appearance topic's sections (docs/settings-redesign.md).
// Moved verbatim from SettingsModal.jsx. Returns `{ key: { show, node, ... } }`
// for the keys this topic lists in settingsTopics.js; the dialog builds
// its topic list, search and page from them.
import React from 'react';
import { LayoutGrid, ListChecks, Moon, Sun } from 'lucide-react';
import { DESKTOP_VIEW_MODES, NARROW_DESKTOP_VIEW_MODES, MOBILE_VIEW_MODES, VIEW_LABEL_KEYS, enabledViews, offeredViews } from '../../../constants/views.js';
import ViewToggles from '../../ViewToggles.jsx';
import { THEME_PREFS, themeLabel } from '../../../utils/themePref.js';
import TimelineSizeSettings from '../../TimelineSizeSettings.jsx';
import CardSizeSettings from '../../CardSizeSettings.jsx';
import { useTranslation } from 'react-i18next';
import { useDayPlannerCtx } from '../../../context/DayPlannerContext.jsx';
import { useFeaturesCtx } from '../../../context/FeaturesContext.jsx';

export default function useAppearanceTopic() {
  const { t, i18n } = useTranslation();
  const {
    darkMode, themePref, setThemePref, textPrimary, textSecondary, hoverBg,
    use24HourClock, weekTimelineStartHour, setWeekTimelineStartHour,
    weekTimelineEndHour, setWeekTimelineEndHour, isMobile, isTablet, defaultView,
    setDefaultView, hiddenViews, dayViewMode, setDayViewMode, weekViewMode,
    setWeekViewMode, canShowViewCycler, schedOnlyCycler, setViewMode, glancePage,
    setGlancePage, mobileViewMode, setMobileViewMode, mobileDefaultView,
    setMobileDefaultView, listEndOfDayTime, setListEndOfDayTime, formatTime,
    showCardSubtasks, setShowCardSubtasks,
  } = useDayPlannerCtx();
  const {
    habitsEnabled, joboEnabled, goalsProjectsEnabled,
  } = useFeaturesCtx();
  const locale = i18n.resolvedLanguage || i18n.language;

  // The pickers name the views the way the cycler does, from the one shared map.
  const desktopViewLabel = (v) => t(VIEW_LABEL_KEYS[v]);
  const mobileViewLabel = (mode) => mode === 'grid' ? t('settings.viewGrid') : mode === 'list' ? t('settings.viewList') : mode === 'month' ? t('sched.viewMonthShort') : mode === 'jobo' ? t('sched.viewJoboShort') : t('settings.viewSched', { defaultValue: 'SCHED' });
  const formatHour = (hour) => new Intl.DateTimeFormat(locale, {
    hour: 'numeric', hour12: !use24HourClock, timeZone: 'UTC',
  }).format(new Date(Date.UTC(2020, 0, 1, hour)));

  return {
    // Light, Dark or System (#2075). The header button keeps its one-click
    // switch; this is where System lives (utils/themePref.js).
    theme: {
      show: true,
      node: (
        <div className="space-y-3">
          <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
            {darkMode ? <Moon size={16} className={textSecondary} /> : <Sun size={16} className={textSecondary} />}
            {t('settings.theme', 'Theme')}
          </h4>
          <div className="flex gap-2" role="radiogroup" aria-label={t('settings.theme', 'Theme')} data-theme-choice>
            {THEME_PREFS.map((pref) => (
              <button
                key={pref}
                type="button"
                role="radio"
                aria-checked={themePref === pref}
                data-theme-pref={pref}
                onClick={() => setThemePref(pref)}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${themePref === pref ? 'bg-blue-600 text-white' : `${darkMode ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-stone-200 text-stone-700 hover:bg-stone-300'}`}`}
              >
                {themeLabel(t, pref)}
              </button>
            ))}
          </div>
        </div>
      ),
    },
    viewDefaults: {
      show: (canShowViewCycler || schedOnlyCycler) && !isTablet && !isMobile,
      node: (
        <>
            {/* View Defaults Section — desktop only (tablet has its own
                section below). Wide desktop offers all four views;
                narrow desktop offers MULTI/SCHED, matching the cycler. */}
            {(canShowViewCycler || schedOnlyCycler) && !isTablet && (
              <div className="space-y-3">
                <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                  <LayoutGrid size={16} className={textSecondary} />
                  {t('settings.viewDefaults')}
                </h4>
                <div>
                  <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.defaultViewOnLoad')}</label>
                  <div className="flex flex-wrap gap-2">
                    {enabledViews(canShowViewCycler ? DESKTOP_VIEW_MODES : NARROW_DESKTOP_VIEW_MODES, hiddenViews?.desktop).map(v => (
                      <button
                        key={v}
                        onClick={() => setDefaultView(v)}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-colors uppercase ${
                          defaultView === v
                            ? 'bg-blue-600 text-white'
                            : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                        }`}
                      >
                        {desktopViewLabel(v)}
                      </button>
                    ))}
                  </div>
                </div>
                <ViewToggles scope="desktop" views={offeredViews(canShowViewCycler ? DESKTOP_VIEW_MODES : NARROW_DESKTOP_VIEW_MODES, { joboEnabled })} label={desktopViewLabel} />
                {canShowViewCycler && (<>
                <div>
                  <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.dayViewMode')}</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setDayViewMode('calendar-day')}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        dayViewMode === 'calendar-day'
                          ? 'bg-blue-600 text-white'
                          : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                      }`}
                    >
                      {t('settings.viewCalendarDay')}
                    </button>
                    <button
                      onClick={() => setDayViewMode('rolling-24')}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        dayViewMode === 'rolling-24'
                          ? 'bg-blue-600 text-white'
                          : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                      }`}
                    >
                      {t('settings.viewRolling24')}
                    </button>
                  </div>
                </div>
                <div>
                  <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.weekViewMode')}</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setWeekViewMode('strict')}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        weekViewMode === 'strict'
                          ? 'bg-blue-600 text-white'
                          : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                      }`}
                    >
                      {t('settings.viewStrictWeek')}
                    </button>
                    <button
                      onClick={() => setWeekViewMode('rolling')}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        weekViewMode === 'rolling'
                          ? 'bg-blue-600 text-white'
                          : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                      }`}
                    >
                      {t('settings.viewRolling7')}
                    </button>
                  </div>
                </div>
                <div>
                  <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.weekTimelineStart')}</label>
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
                        {formatHour(h)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.weekTimelineEnd')}</label>
                  <div className="flex flex-wrap gap-2">
                    {/* A stored end that is no longer offered still keeps its
                        button, so the picker cannot show nothing selected
                        while the grid is visibly trimmed. 18 was offered
                        before this list was; another device may send any
                        value at all. */}
                    {[...new Set([20, 21, 22, 23, 24, weekTimelineEndHour])]
                      .filter(h => h > 0 && h <= 24)
                      .sort((a, b) => a - b)
                      .map(h => (
                      <button
                        key={h}
                        onClick={() => setWeekTimelineEndHour(h)}
                        className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                          weekTimelineEndHour === h
                            ? 'bg-blue-600 text-white'
                            : `${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-700'} ${hoverBg}`
                        }`}
                      >
                        {formatHour(h)}
                      </button>
                    ))}
                  </div>
                </div>
                {habitsEnabled && goalsProjectsEnabled && (
                  <div>
                    <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.glanceDefault')}</label>
                    <div className="flex gap-2">
                      {[{ value: 0, label: t('settings.glanceDefaultHabits') }, { value: 1, label: t('settings.glanceDefaultGoals') }].map(({ value, label }) => (
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
                </>)}
              </div>
            )}
        </>
      ),
    },
    // The phone's view defaults: which view opens, which views the cycler
    // offers, LIST's end of day and the GLANCE page. Desktop and tablet have
    // their own blocks above (docs/settings-redesign.md, Mobile).
    mobileViewDefaults: {
      show: isMobile,
      node: (
        <div className="space-y-4">
          {/* View default */}
          <div className="space-y-2">
            <div className={`font-medium ${textPrimary} flex items-center gap-2`}>
              <LayoutGrid size={16} className={textSecondary} />
              {t('settings.viewDefault')}
            </div>
            <p className={`text-xs ${textSecondary}`}>{t('settings.viewDefaultDesc')}</p>
            <div className="flex flex-wrap gap-2">
              {enabledViews(MOBILE_VIEW_MODES, hiddenViews?.mobile).map((value) => ({ value, label: mobileViewLabel(value) })).map(({ value, label }) => (
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
            <div className="pt-2">
              <ViewToggles scope="mobile" views={offeredViews(MOBILE_VIEW_MODES, { joboEnabled })} label={mobileViewLabel} />
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
          {/* GLANCE default */}
          {habitsEnabled && goalsProjectsEnabled && (
            <>
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
        </div>
      ),
    },
    tabletViewDefaults: {
      show: isTablet,
      node: (
        <>
            {/* Tablet view defaults — portrait (GRID/LIST/SCHED, shared
                with the phone toggle) and landscape (MULTI/SCHED via
                the desktop cycler) are independent view states */}
            {isTablet && (
              <>
                <div className="space-y-3">
                  <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
                    <LayoutGrid size={16} className={textSecondary} />
                    {t('settings.viewDefaults')}
                  </h4>
                  <div>
                    <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.portraitViewDefault', 'Portrait view')}</label>
                    <div className="flex flex-wrap gap-2">
                      {enabledViews(MOBILE_VIEW_MODES, hiddenViews?.mobile).map(mode => (
                        <button
                          key={mode}
                          onClick={() => { setMobileDefaultView(mode); setMobileViewMode(mode); }}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            mobileDefaultView === mode
                              ? 'bg-blue-600 text-white border-blue-600'
                              : `${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-stone-300'} ${textPrimary}`
                          }`}
                        >
                          {mobileViewLabel(mode)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className={`block text-xs ${textSecondary} mb-1.5`}>{t('settings.landscapeViewDefault', 'Landscape view')}</label>
                    <div className="flex flex-wrap gap-2">
                      {enabledViews(NARROW_DESKTOP_VIEW_MODES, hiddenViews?.desktop).map(v => (
                        <button
                          key={v}
                          onClick={() => { setDefaultView(v); setViewMode(v); }}
                          className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                            defaultView === v
                              ? 'bg-blue-600 text-white border-blue-600'
                              : `${darkMode ? 'bg-gray-700 border-gray-600' : 'bg-white border-stone-300'} ${textPrimary}`
                          }`}
                        >
                          {desktopViewLabel(v)}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* One group per orientation, as with the defaults above: the phone
                      toggle's views for portrait, the narrow cycler's for landscape. */}
                  <ViewToggles scope="mobile" views={offeredViews(MOBILE_VIEW_MODES, { joboEnabled })} label={mobileViewLabel} heading={t('settings.viewsInPortrait')} />
                  <ViewToggles scope="desktop" views={NARROW_DESKTOP_VIEW_MODES} label={desktopViewLabel} heading={t('settings.viewsInLandscape')} hint={false} />
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
              </>
            )}
        </>
      ),
    },
    timelineSize: {
      show: !isMobile,
      node: (
        <>
            {/* Timeline size (utils/timelineZoom.js), desktop and tablet */}
            {!isMobile && (
              <>
                <TimelineSizeSettings joboEnabled={joboEnabled} />
              </>
            )}
        </>
      ),
    },
    // Subtasks on timeline cards (utils/cardSubtasks.js), every device: the
    // phone's GRID shows them too.
    cardSubtasks: {
      show: typeof setShowCardSubtasks === 'function',
      node: (
        <div className="space-y-3" data-card-subtasks-setting>
          <h4 className={`font-medium ${textPrimary} flex items-center gap-2`}>
            <ListChecks size={16} className={textSecondary} />
            {t('settings.taskCards')}
          </h4>
          <label className="flex items-center gap-3 cursor-pointer">
            <div className="relative">
              <input type="checkbox" checked={showCardSubtasks !== false} onChange={(e) => setShowCardSubtasks(e.target.checked)} className="sr-only" data-card-subtasks-toggle />
              <div className={`w-10 h-6 rounded-full transition-colors ${showCardSubtasks !== false ? 'bg-blue-600' : darkMode ? 'bg-gray-600' : 'bg-stone-300'}`}>
                <div className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${showCardSubtasks !== false ? 'translate-x-5' : 'translate-x-1'}`} />
              </div>
            </div>
            <span className={`text-sm ${textPrimary}`}>{t('settings.showCardSubtasks')}</span>
          </label>
          <p className={`text-[10px] ${textSecondary} opacity-70`}>{t('settings.showCardSubtasksHint')}</p>
        </div>
      ),
    },
    cardSize: {
      show: !isMobile && goalsProjectsEnabled,
      node: (
        <>
            {/* Goals & Projects card size (utils/cardSize.js), desktop and tablet */}
            {!isMobile && goalsProjectsEnabled && (
              <>
                <CardSizeSettings />
              </>
            )}
        </>
      ),
    },
  };
}
