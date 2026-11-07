import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Activity, Bell, BrainCircuit, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Cloud, Flag, Footprints, Globe, GripVertical, Info, LayoutGrid, Monitor, Moon, Palette, Pencil, Plug, Plus, RefreshCw, Save, Settings, Sparkles, Sun, Target, Trash2, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { HABIT_ICONS, HABIT_ICON_NAMES, HABIT_COLORS } from '../constants/habits.js';
import { getDeviceId } from '../native.js';
import { localizedWeekdays } from '../utils/localeFormatting.js';
import FrameEditor from './FrameEditor.jsx';
import FrameSetsList from './FrameSetsList.jsx';
import SmartSchedulePanel from './SmartSchedulePanel.jsx';
import MobileRoutinesTab from './MobileRoutinesTab.jsx';
import UserOwnerSwitcher from './UserOwnerSwitcher.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { nextThemePref, themeLabel } from '../utils/themePref.js';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { useTranslation } from 'react-i18next';
import { notBucketed } from '../utils/bucketList.js';
import SettingsTopicPage from './settings/SettingsTopicPage.jsx';
import useSettingsSections from './settings/useSettingsSections.js';
import { visibleTopics, topicAttention } from './settings/settingsTopics.js';
import { mobileViewForTopic, revealSettingsSection } from './settings/settingsLink.js';
import { keyboardOverTabLayout } from '../utils/keyboardInset.js';

// One icon per Settings topic for the mobile rows (the desktop list has none).
const TOPIC_ICONS = {
  general: Settings, appearance: Palette, features: Sparkles, ai: BrainCircuit, sync: Cloud,
  integrations: Plug, notifications: Bell, backup: Save, about: Info,
};

const MobileSettingsPanel = () => {
  const {
    isPro, isAndroidApp, isIOSApp, isElectronApp, subProductId,
    consumeTestPurchase, canConsumeTestPurchase, darkMode, themePref, setThemePref,
    mobileSettingsView, setMobileSettingsView, use24HourClock, setUse24HourClock,
    weekStartDay, setWeekStartDay, homeTimezone, soundEnabled, setSoundEnabled,
    allTags, unscheduledTasks, getTodayStr, setOnboardingProgress, cardBg,
    borderClass, textPrimary, textSecondary, hoverBg, colors, formatTime,
    settingsLink, setSettingsLink,
  } = useDayPlannerCtx();
  const {
    calSyncStatus, calSyncConfigured, isSyncing, syncAll,
  } = useSyncCtx();

  const {
    routinesEnabled, setRoutinesEnabled, todayRoutines, setDashboardSelectedChips,
    setRoutineAddingToBucket, setRoutineNewChipName, handleRoutinesDone,
    habitsEnabled, setHabitsEnabled, managedHabits: activeHabits, habits,
    editingHabit, setEditingHabit, draggedHabitIdx, setDraggedHabitIdx, addHabit,
    updateHabit, archiveHabit, deleteHabit, reorderHabits, addStepsHabit,
    addSleepHabit, healthPerms, hrViewUserSyncId, setHrViewUserSyncId,
    goalsProjectsEnabled, setGoalsProjectsEnabled, gtdFrames, myFrames,
    framesModalTab, setFramesModalTab, editingFrame, setEditingFrame, saveFrame,
    deleteFrame, smartScheduleResults, setSmartScheduleResults,
    smartScheduleLoading, smartScheduleError, setSmartScheduleError,
    smartScheduleAccepted, setSmartScheduleAccepted, runSmartSchedule,
    applySmartSchedule, aiConfig, aiSuppressed, users, multiUserEnabled,
    ownedBy, meUserSyncId,
    frameSets, frameSetsLoaded, createFrameSet, renameFrameSet, switchFrameSet, setFrameSetPeriods, deleteFrameSet,
  } = useFeaturesCtx();
  // Frame sets (#2305), scoped like the frames this page lists (myFrames), and
  // the set a new frame starts in when it was added from a set's section.
  const mySets = (frameSets ?? []).filter(s => ownedBy(s, meUserSyncId));
  const [newFrameSetId, setNewFrameSetId] = useState(null);
  // iOS uses HealthKit lazy authorization (permission requested on first read), so
  // it has no explicit permission check/request. On iOS the health-habit "Add"
  // button is always enabled and the dead "Continue" button is hidden — see the
  // matching note in HabitModal.jsx and refreshHealthPerms in useHabits.js.
  const isIOS = typeof window !== 'undefined' && !!window.DayGlanceIOS;

  // Two-step confirm for the hidden "Reset test purchase" action. The realistic
  // misuse isn't discovery (7-tap gate) — it's a paying user misreading "reset"
  // as "refresh my purchase state" while troubleshooting. The confirm converts
  // that into informed consent: it names the real consequence before acting.
  const [confirmingPurchaseReset, setConfirmingPurchaseReset] = useState(false);
  const { t } = useTranslation();

  // Commit staged routines on unmount (e.g. user switches tabs while in routines view)
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

  // The same sections the desktop dialog shows (settings/useSettingsSections.js).
  // A topic row opens `topic:<id>`; the tiles' own screens keep their names.
  const sections = useSettingsSections();
  const listedTopics = visibleTopics(sections);
  const mobileTopic = mobileSettingsView?.startsWith('topic:')
    ? listedTopics.find((topic) => `topic:${topic.id}` === mobileSettingsView) ?? null
    : null;
  const openTopic = (id) => setMobileSettingsView(mobileViewForTopic(id));
  // The list and every page share one scroll area. A page opens at its top,
  // not at the list's offset (a row far down opened its page part-way down),
  // and Back returns the list to where it was. Before paint, and before a
  // link's reveal below scrolls to its section. The list's offset is kept as
  // it scrolls: once a page replaces it, the browser has already clamped it.
  const scrollRef = useRef(null);
  const listScrollRef = useRef(0);
  const prevViewRef = useRef(mobileSettingsView);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevViewRef.current;
    prevViewRef.current = mobileSettingsView;
    if (!el || prev === mobileSettingsView) return;
    el.scrollTop = mobileSettingsView === 'main' ? listScrollRef.current : 0;
  }, [mobileSettingsView]);
  // A topic this device doesn't show (a link, or a remembered view) falls
  // back to the list rather than a blank screen.
  const strandedTopic = mobileSettingsView?.startsWith('topic:') && !mobileTopic;
  useEffect(() => { if (strandedTopic) setMobileSettingsView('main'); }, [strandedTopic, setMobileSettingsView]);
  // A link into Settings (settings/settingsLink.js) already opened its topic;
  // scroll to its section once that page is on screen, then clear it.
  useEffect(() => {
    if (!settingsLink || (mobileTopic && mobileTopic.id !== settingsLink.topic)) return undefined;
    const section = mobileTopic ? settingsLink.section : null;
    setSettingsLink(null);
    return section ? revealSettingsSection(section) : undefined;
  }, [settingsLink, mobileTopic]); // eslint-disable-line react-hooks/exhaustive-deps


  return (
<div ref={scrollRef} data-mobile-settings-scroll onScroll={(e) => { if (mobileSettingsView === 'main') listScrollRef.current = e.currentTarget.scrollTop; }} className={`relative overflow-hidden mobile-tab-fade-in flex-1 min-h-0 overflow-y-auto`} style={{ marginBottom: keyboardOverTabLayout() }}>
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
            onClick={() => openTopic('general')}
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
      {/* Theme: cycles Light → Dark → System and shows the current one
          (docs/settings-redesign.md, Mobile). The grid keeps its nine tiles. */}
      <button
        onClick={() => setThemePref(nextThemePref(themePref))}
        data-theme-tile={themePref}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {themePref === 'system'
          ? <Monitor size={24} className={textSecondary} />
          : themePref === 'dark' ? <Moon size={24} className="text-indigo-400" /> : <Sun size={24} className="text-amber-400" />}
        <span className={`text-xs font-medium ${textPrimary}`}>{themeLabel(t, themePref)}</span>
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
        onClick={() => openTopic('ai')}
        className={`${cardBg} border ${borderClass} rounded-xl p-4 flex flex-col items-center gap-2`}
      >
        {aiConfig.enabled ? <BrainCircuit size={24} className="text-purple-400" /> : <BrainCircuit size={24} className={textSecondary} />}
        <span className={`text-xs font-medium ${textPrimary}`}>{aiConfig.enabled ? t('settings.aiOn') : t('settings.aiOff')}</span>
      </button>
      )}
    </div>

    {/* The topics, as on desktop: each row opens the same page the dialog
        shows (docs/settings-redesign.md, Mobile). Syncing calendars is an
        action, not a page, so it stays a row of its own above them. */}
    <div className="space-y-2" data-mobile-settings-topics>
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
      {listedTopics.map((topic) => {
        const Icon = TOPIC_ICONS[topic.id] || Settings;
        const mark = topicAttention(topic, sections);
        return (
          <button
            key={topic.id}
            onClick={() => openTopic(topic.id)}
            data-mobile-settings-topic={topic.id}
            className={`w-full ${cardBg} border ${borderClass} rounded-xl p-4 flex items-center gap-3`}
          >
            <Icon size={20} className={textSecondary} />
            <span className={`font-medium ${textPrimary} flex-1 text-left`}>{t(topic.labelKey, topic.fallback)}</span>
            {mark && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${mark === 'red' ? 'bg-red-500' : 'bg-amber-500'}`} />}
            <ChevronRight size={18} className={textSecondary} />
          </button>
        );
      })}
    </div>

    {/* Stats */}
    {/* Sub-menu buttons */}
    <div className="space-y-2">
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

  {/* A topic's page: the same sections the desktop dialog shows. */}
  {mobileTopic && (
    <div className="px-4 py-4 space-y-4" data-mobile-settings-page={mobileTopic.id}>
      <button
        onClick={() => setMobileSettingsView('main')}
        className={`flex items-center gap-2 ${textSecondary} mb-2`}
      >
        <ChevronLeft size={18} />
        <span className="text-sm font-medium">{t('common.settings')}</span>
      </button>
      <h3 className={`text-lg font-semibold ${textPrimary}`}>{t(mobileTopic.labelKey, mobileTopic.fallback)}</h3>
      <SettingsTopicPage key={mobileTopic.id} topic={mobileTopic} sections={sections} borderClass={borderClass} />
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
              frameSets={mySets}
              defaultSetId={editingFrame === 'new' ? newFrameSetId : null}
            />
          ) : (
            <>
              {(() => {
                const todayStr = getTodayStr();
                const visibleFrames = myFrames.filter(f => !f.singleDate || f.singleDate >= todayStr);
                return visibleFrames.length === 0 && mySets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <LayoutGrid size={48} className={textSecondary} />
                    <h3 className={`text-lg font-semibold ${textPrimary}`}>{t('frames.noFramesTitle')}</h3>
                    <p className={`text-sm ${textSecondary} text-center max-w-xs`}>
                      {t('frames.noFramesDesc')}
                    </p>
                    <button
                      onClick={() => { setNewFrameSetId(null); setEditingFrame('new'); }}
                      className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors flex items-center gap-2"
                    >
                      <Plus size={16} />
                      {t('frames.createFrame')}
                    </button>
                  </div>
                ) : (
                  <FrameSetsList
                    frames={visibleFrames}
                    frameSets={mySets}
                    frameSetsLoaded={frameSetsLoaded}
                    todayStr={todayStr}
                    onEditFrame={setEditingFrame}
                    onAddFrame={(setId) => { setNewFrameSetId(setId); setEditingFrame('new'); }}
                    onSwitchSet={switchFrameSet}
                    onRenameSet={renameFrameSet}
                    onSetPeriods={setFrameSetPeriods}
                    onDeleteSet={deleteFrameSet}
                    onCreateSet={createFrameSet}
                    darkMode={darkMode}
                    textPrimary={textPrimary}
                    textSecondary={textSecondary}
                    borderClass={borderClass}
                    hoverBg={hoverBg}
                    rowBg={cardBg}
                    formatTime={formatTime}
                    dayLabels={localizedWeekdays('short')}
                    offLabel={t('common.off')}
                    isMobile
                  />
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
</div>
  );
};

export default MobileSettingsPanel;
