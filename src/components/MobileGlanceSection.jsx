import React from 'react';
import {
  AlertCircle, AlertTriangle, BookOpen, BrainCircuit,
  Calendar, CalendarDays, Check, CheckCircle, CheckSquare, ChevronDown,
  ChevronUp, Clock, ExternalLink, FileText, Filter, Flag, Inbox, LayoutGrid,
  Loader, Mic, Minus, Moon, Plus, RefreshCw,
  Search, Settings, Sparkles, Sun, Target, Trash2, X, Zap,
} from 'lucide-react';
import { renderTitle, renderFormattedText, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { dateToString, extractTags, extractWikilinks, formatDeadlineDate } from '../utils/taskUtils.js';
import { calculateGoalProgress } from '../utils/goalProgress.js';
import { HABIT_COLORS, HABIT_ICONS } from '../constants/habits.js';
import { HabitRing } from './HabitRing.jsx';
import GettingStartedChecklist from './GettingStartedChecklist.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import FrameNudgeCard from './FrameNudgeCard.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import { getGlanceHGInstances, isHGSessionReachable } from '../hooks/useHyperGlance.js';

const MobileGlanceSection = () => {
  const {
    visibleDates,
    calendarRef,
    longPressTimerRef, longPressTriggeredRef,
    darkMode,
    currentTime, use24HourClock,
    selectedDate, setSelectedDate,
    mobileActiveTab, setMobileActiveTab,
    mobileSettingsView, setMobileSettingsView,
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    recycleBin, setRecycleBin,
    recurringTasks, setRecurringTasks,
    selectedTags,
    showMobileTagFilter, setShowMobileTagFilter,
    allTags,
    taskContextMenu, setTaskContextMenu,
    expandedNotesTaskId, setExpandedNotesTaskId,
    showDeadlinePicker, setShowDeadlinePicker,
    minimizedSections,
    activeFrameForNudge, activeFrameNudgeKey,
    showGettingStarted,
    gettingStartedItems,
    gettingStartedCompleteCount,
    setGettingStartedDismissed,
    setOnboardingComplete,
    todayAgenda,
    agendaNowMarker,
    glanceAhead,
    incompleteTodayTasks,
    undoToast, setUndoToast,
    cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    playUISound,
    formatTime,
    toggleSection,
    toggleComplete,
    clearDeadline,
    pushUndo,
    scheduleTaskAtNextSlot,
    setShowSpotlight,
    filterByTags,
    getTodayStr, getOverdueTasks,
    getTaskCalendarStyle,
    getTasksForDate,
    timeToMinutes,
    selectAllTags, clearTagFilter, toggleTag,
    moveToRecycleBin,
    updateTaskNotes, addSubtask, toggleSubtask, deleteSubtask, updateSubtaskTitle,
    tagFilterBtnRef,
    goToDate, scrollToHour,
  } = useDayPlannerCtx();
  const { loadWikiNote, saveWikiNote, openInObsidian } = useSyncCtx();
  const {
    habitLongPressTimer,
    habitLongPressOpenedAt,
    dashboardSelectedChips, setDashboardSelectedChips,
    routineAddingToBucket, setRoutineAddingToBucket,
    routineNewChipName, setRoutineNewChipName,
    showRescheduleModal, setShowRescheduleModal,
    rescheduleResults, setRescheduleResults,
    rescheduleError, setRescheduleError,
    morningGlanceText, morningGlanceLoading, morningGlanceDismissed, morningGlanceError,
    eveningGlanceText, eveningGlanceLoading, eveningGlanceDismissed, eveningGlanceError,
    frameNudgeSuggestion, frameNudgeLoading, frameNudgeError,
    frameNudgeDismissedKey, setFrameNudgeDismissedKey,
    routinesEnabled, todayRoutines, routineCompletions, toggleRoutineCompletion,
    habitsEnabled,
    activeHabits, habitStreaks,
    habitLongPressId, setHabitLongPressId,
    habitEditingCountId, setHabitEditingCountId,
    habitOverflowOpen, setHabitOverflowOpen,
    aiConfig, aiSubtasksLoadingForTask, generateAISubtasks,
    gtdFrames,
    showFramesModal, setShowFramesModal,
    framesModalTab, setFramesModalTab,
    editingFrame, setEditingFrame,
    goals, goalsProjectsEnabled, projects,
    projectFilter, setProjectFilter,
    focusModeAvailable, enterFocusMode,
    getTodayHabitCount, incrementHabit, setHabitCount,
    generateFrameNudge, generateMorningSummary, generateEveningReflection,
    dismissMorningGlance, dismissEveningGlance,
    openRoutinesDashboard,
    enterHyperGlanceMode,
    getFrameInstancesForDate, computeAvailableSlots,
    showVoiceInput, setShowVoiceInput,
    voiceCanRecord,
  } = useFeaturesCtx();

  return (
<div className={`px-4 py-4 mobile-tab-fade-in flex-1 min-h-0 overflow-y-auto`}>
  <div className="flex items-center gap-2 mb-4">
    <button
      onClick={() => { setShowSpotlight(true); playUISound('spotlight'); }}
      className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-400'} transition-colors`}
    >
      <Search size={16} />
      <span className="text-sm">Search tasks...</span>
    </button>
    {allTags.length > 0 && (
      <button
        onClick={() => setShowMobileTagFilter(true)}
        className={`relative flex-shrink-0 px-2.5 self-stretch flex items-center rounded-lg transition-colors ${
          !allTags.every(tag => selectedTags.includes(tag))
            ? 'bg-blue-500 text-white'
            : darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-400'
        }`}
      >
        <Filter size={16} />
      </button>
    )}
    {aiConfig.enabled && aiConfig.features.voiceTaskInput && (
      <button
        onClick={() => setShowVoiceInput(true)}
        className={`flex-shrink-0 px-2.5 self-stretch flex items-center rounded-lg transition-colors ${darkMode ? 'bg-white/10 text-purple-400' : 'bg-black/5 text-purple-600'}`}
      >
        <Mic size={16} />
      </button>
    )}
  </div>
  {/* Habit rings row — pinned to top */}
  {habitsEnabled && (() => {
    const todayDow = new Date().getDay();
    const todayHabits = activeHabits.filter(h => (h.scheduledDays ?? [0, 1, 2, 3, 4, 5, 6]).includes(todayDow));
    if (activeHabits.length === 0) return (
      <div className={`mb-4 rounded-lg border ${borderClass} p-3 cursor-pointer active:opacity-70 transition-opacity`} onClick={() => { setMobileActiveTab('settings'); setMobileSettingsView('habits'); }}>
        <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textSecondary}`}>Habits</div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${textSecondary} italic`}>None added</span>
          <span className="text-xs text-teal-500 font-medium">+ Add</span>
        </div>
      </div>
    );
    if (todayHabits.length === 0) return null;
    return (
      <div className="mb-4 relative">
        <button
          onClick={() => { setMobileActiveTab('settings'); setMobileSettingsView('habits'); }}
          className={`absolute -bottom-0.5 -right-0.5 p-1 rounded ${hoverBg} ${darkMode ? 'text-gray-700' : 'text-stone-300'} transition-colors z-10`}
          title="Manage habits"
        >
          <Settings size={11} />
        </button>
        <div className="flex items-start gap-1 justify-center">
        {todayHabits.slice(0, 5).map((habit, habitIdx) => (
          <div key={habit.id} className="relative">
            <HabitRing
              size={44}
              habit={habit}
              count={getTodayHabitCount(habit.id)}
              darkMode={darkMode}
              autoSynced={!!habit.source}
              onClick={habit.source ? undefined : () => incrementHabit(habit.id)}
              onContextMenu={habit.source ? undefined : (e) => { e.preventDefault(); clearTimeout(habitLongPressTimer.current); setHabitLongPressId(habit.id); habitLongPressOpenedAt.current = Date.now(); setHabitEditingCountId(null); }}
              onMouseDown={habit.source ? undefined : () => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); habitLongPressTimer.current = setTimeout(() => { setHabitLongPressId(habit.id); habitLongPressOpenedAt.current = Date.now(); setHabitEditingCountId(null); }, 500); }}
              onMouseUp={habit.source ? undefined : () => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
              onMouseLeave={habit.source ? undefined : () => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
              onTouchStart={habit.source ? undefined : () => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); habitLongPressTimer.current = setTimeout(() => { setHabitLongPressId(habit.id); habitLongPressOpenedAt.current = Date.now(); setHabitEditingCountId(null); }, 500); }}
              onTouchEnd={habit.source ? undefined : (e) => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); if (habitLongPressOpenedAt.current && Date.now() - habitLongPressOpenedAt.current < 300) e.preventDefault(); }}
            />
            {habitLongPressId === habit.id && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => { if (habitLongPressOpenedAt.current && Date.now() - habitLongPressOpenedAt.current < 300) return; setHabitLongPressId(null); setHabitEditingCountId(null); }} />
                <div className={`absolute top-full mt-1 z-50 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'} border rounded-xl shadow-xl p-3 min-w-[140px] ${habitIdx === 0 ? 'left-0' : habitIdx === Math.min(todayHabits.length, 5) - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>
                  <div className={`text-xs font-semibold mb-2 text-center ${darkMode ? 'text-gray-300' : 'text-stone-700'}`}>{habit.name}</div>
                  <div className="flex items-center justify-center gap-3">
                    <button onClick={() => { setHabitCount(habit.id, getTodayHabitCount(habit.id) - 1); }} className={`w-8 h-8 rounded-full flex items-center justify-center ${darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-100 text-stone-600 active:bg-stone-200'}`}><Minus size={16} /></button>
                    {habitEditingCountId === habit.id ? (
                      <input
                        type="number"
                        autoFocus
                        defaultValue={getTodayHabitCount(habit.id)}
                        onBlur={(e) => { setHabitCount(habit.id, parseInt(e.target.value) || 0); setHabitEditingCountId(null); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
                        onClick={(e) => e.stopPropagation()}
                        className={`w-16 text-lg font-bold text-center rounded-lg border ${darkMode ? 'bg-gray-700 text-white border-gray-600' : 'bg-stone-50 text-stone-900 border-stone-300'} outline-none focus:ring-2 focus:ring-blue-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
                        onFocus={(e) => e.target.select()}
                      />
                    ) : (
                      <span onClick={(e) => { e.stopPropagation(); setHabitEditingCountId(habit.id); }} className={`text-lg font-bold min-w-[2ch] text-center cursor-pointer hover:opacity-70 ${darkMode ? 'text-white' : 'text-stone-900'}`}>{getTodayHabitCount(habit.id)}</span>
                    )}
                    <button onClick={() => { incrementHabit(habit.id); }} className={`w-8 h-8 rounded-full flex items-center justify-center ${darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-100 text-stone-600 active:bg-stone-200'}`}><Plus size={16} /></button>
                  </div>
                  <button onClick={() => { setHabitCount(habit.id, 0); setHabitLongPressId(null); setHabitEditingCountId(null); }} className="mt-2 w-full text-xs text-red-500 font-medium py-1 rounded hover:bg-red-500/10 transition-colors">Reset</button>
                </div>
              </>
            )}
          </div>
        ))}
        {todayHabits.length > 5 && (
          <div className="relative">
            <button
              onClick={() => setHabitOverflowOpen(prev => !prev)}
              className={`w-[52px] h-[44px] flex items-center justify-center rounded-lg text-xs font-bold ${darkMode ? 'bg-gray-700 text-gray-400 active:bg-gray-600' : 'bg-stone-100 text-stone-500 active:bg-stone-200'} transition-colors`}
            >
              +{todayHabits.length - 5}
            </button>
            {habitOverflowOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setHabitOverflowOpen(false)} />
                <div className={`absolute top-full right-0 mt-1 z-50 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'} border rounded-xl shadow-xl p-2 min-w-[180px]`}>
                  {todayHabits.slice(5).map(habit => {
                    const count = getTodayHabitCount(habit.id);
                    const IconComp = HABIT_ICONS[habit.icon] || Target;
                    const colorObj = HABIT_COLORS.find(c => c.name === habit.color) || HABIT_COLORS[0];
                    return (
                      <button
                        key={habit.id}
                        onClick={habit.source ? undefined : () => { incrementHabit(habit.id); }}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg ${habit.source ? 'cursor-default' : `${darkMode ? 'hover:bg-gray-700 active:bg-gray-600' : 'hover:bg-stone-50 active:bg-stone-100'}`} transition-colors`}
                      >
                        <IconComp size={16} style={{ color: colorObj.ring }} />
                        <span className={`text-sm flex-1 text-left ${darkMode ? 'text-gray-300' : 'text-stone-700'}`}>{habit.name}</span>
                        <span className={`text-xs font-semibold ${darkMode ? 'text-gray-400' : 'text-stone-500'}`}>{count}/{habit.target}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
        </div>
      </div>
    );
  })()}

  {/* Goals due today */}
  {goalsProjectsEnabled && (() => {
    const todayStr = getTodayStr();
    const allTasksCombined = [...tasks, ...unscheduledTasks];
    const todayDueGoals = goals
      .filter(g => g.status === 'active' && g.targetDate === todayStr)
      .map(g => {
        const progress = calculateGoalProgress(g.id, projects, allTasksCombined);
        const childProjects = projects.filter(p => p.goalId === g.id && p.status !== 'archived');
        const totalTasks = allTasksCombined.filter(t => childProjects.some(p => p.id === t.projectId) && !t.archived).length;
        const completedTasks = allTasksCombined.filter(t => childProjects.some(p => p.id === t.projectId) && !t.archived && t.completed).length;
        return { id: g.id, title: g.title, progressPct: Math.round(progress * 100), totalTasks, completedTasks };
      });
    if (todayDueGoals.length === 0) return null;
    return (
      <div className="mb-4 space-y-2">
        {todayDueGoals.map(g => (
          <div key={g.id} className={`rounded-lg border p-3 ${darkMode ? 'border-gray-600 bg-gray-700/40' : 'border-stone-200 bg-stone-50'}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Flag size={13} className="text-amber-400 flex-shrink-0" />
                <span className={`text-sm font-medium ${textPrimary} truncate`}>{g.title}</span>
              </div>
              <span className={`text-xs flex-shrink-0 font-medium px-1.5 py-0.5 rounded ${darkMode ? 'bg-amber-900/40 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>Due today</span>
            </div>
            <div className="flex items-center gap-2">
              <div className={`flex-1 h-1.5 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-200'}`}>
                <div className="h-full rounded-full" style={{ width: `${g.progressPct}%`, backgroundColor: g.progressPct >= 80 ? '#22c55e' : g.progressPct >= 40 ? '#f59e0b' : '#ef4444' }} />
              </div>
              <span className={`text-xs ${textSecondary} flex-shrink-0`}>{g.progressPct}%</span>
              {g.totalTasks > 0 && <span className={`text-xs ${textSecondary} flex-shrink-0`}>{g.completedTasks}/{g.totalTasks}</span>}
            </div>
          </div>
        ))}
      </div>
    );
  })()}

  {/* Morning dayGLANCE — AI morning summary card (mobile) */}
  {aiConfig.enabled && aiConfig.features.morningSummary && !morningGlanceDismissed && (
    (morningGlanceText || morningGlanceLoading || morningGlanceError) ? (
    <div className={`mb-4 rounded-lg border p-3 ${darkMode ? 'border-amber-800/50 bg-amber-900/20' : 'border-amber-200 bg-amber-50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Sun size={16} className="text-amber-500" />
          <span className={`text-xs font-semibold uppercase tracking-wider ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>Morning Briefing</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => generateMorningSummary(true)}
            className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            title="Regenerate"
          >
            <RefreshCw size={12} className={`${morningGlanceLoading ? 'animate-spin' : ''} ${textSecondary}`} />
          </button>
          <button
            onClick={dismissMorningGlance}
            className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`}
            title="Dismiss for today"
          >
            <X size={12} className={textSecondary} />
          </button>
        </div>
      </div>
      <div className="mt-2">
        {morningGlanceLoading && (
          <div className="flex items-center gap-2">
            <Loader size={14} className={`animate-spin ${textSecondary}`} />
            <span className={`text-xs ${textSecondary}`}>Generating your briefing...</span>
          </div>
        )}
        {morningGlanceError && (
          <p className={`text-xs ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{morningGlanceError}</p>
        )}
        {morningGlanceText && !morningGlanceLoading && (
          <p className={`text-sm leading-relaxed ${textPrimary}`}>{morningGlanceText}</p>
        )}
        {morningGlanceText && !morningGlanceLoading && aiConfig?.enabled && aiConfig.features?.smartScheduling && gtdFrames.filter(f => f.enabled).length > 0 && unscheduledTasks.filter(t => !t.completed && !t.isExample).length > 0 && (
          <button
            onClick={() => { setMobileActiveTab('settings'); setMobileSettingsView('frames'); setFramesModalTab('schedule'); }}
            className={`mt-2 flex items-center gap-1.5 text-xs font-medium transition-colors ${darkMode ? 'text-purple-400 hover:text-purple-300' : 'text-purple-600 hover:text-purple-700'}`}
          >
            <BrainCircuit size={12} />
            Schedule inbox items?
          </button>
        )}
      </div>
    </div>
    ) : (
    <div
      className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${darkMode ? 'border-amber-800/50 bg-amber-900/20 hover:bg-amber-900/30' : 'border-amber-200 bg-amber-50 hover:bg-amber-100'}`}
      onClick={generateMorningSummary}
    >
      <Sun size={14} className="text-amber-500 flex-shrink-0" />
      <span className={`text-sm ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>Click here to see AI briefing</span>
      <button
        onClick={(e) => { e.stopPropagation(); dismissMorningGlance(); }}
        className={`ml-auto p-0.5 rounded flex-shrink-0 transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'}`}
        title="Dismiss for today"
      >
        <X size={12} className={textSecondary} />
      </button>
    </div>
    )
  )}
  {/* Evening Reflection — AI end-of-day card (mobile) */}
  {aiConfig.enabled && aiConfig.features.eveningReflection && !eveningGlanceDismissed && currentTime.getHours() >= 19 && (
    (eveningGlanceText || eveningGlanceLoading || eveningGlanceError) ? (
    <div className={`mb-4 rounded-lg border p-3 ${darkMode ? 'border-indigo-800/50 bg-indigo-900/20' : 'border-indigo-200 bg-indigo-50'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <Moon size={16} className="text-indigo-400" />
          <span className={`text-xs font-semibold uppercase tracking-wider ${darkMode ? 'text-indigo-300' : 'text-indigo-700'}`}>Evening Reflection</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => generateEveningReflection(true)} className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="Regenerate">
            <RefreshCw size={12} className={`${eveningGlanceLoading ? 'animate-spin' : ''} ${textSecondary}`} />
          </button>
          <button onClick={dismissEveningGlance} className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="Dismiss for today">
            <X size={12} className={textSecondary} />
          </button>
        </div>
      </div>
      <div className="mt-2">
        {eveningGlanceLoading && (
          <div className="flex items-center gap-2">
            <Loader size={14} className={`animate-spin ${textSecondary}`} />
            <span className={`text-xs ${textSecondary}`}>Reflecting on your day...</span>
          </div>
        )}
        {eveningGlanceError && <p className={`text-xs ${darkMode ? 'text-red-400' : 'text-red-600'}`}>{eveningGlanceError}</p>}
        {eveningGlanceText && !eveningGlanceLoading && <p className={`text-sm leading-relaxed ${textPrimary}`}>{eveningGlanceText}</p>}
        {eveningGlanceText && !eveningGlanceLoading && incompleteTodayTasks.length > 0 && gtdFrames.filter(f => f.enabled).length > 0 && aiConfig.features?.aiReschedule && (
          <button
            onClick={() => { setShowRescheduleModal(true); setRescheduleResults(null); setRescheduleError(''); }}
            className={`mt-2 flex items-center gap-1.5 text-xs font-medium transition-colors ${darkMode ? 'text-orange-400 hover:text-orange-300' : 'text-orange-600 hover:text-orange-700'}`}
          >
            <CalendarDays size={12} />
            Reschedule {incompleteTodayTasks.length} incomplete task{incompleteTodayTasks.length !== 1 ? 's' : ''} →
          </button>
        )}
      </div>
    </div>
    ) : (
    <div
      className={`mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${darkMode ? 'border-indigo-800/50 bg-indigo-900/20 hover:bg-indigo-900/30' : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100'}`}
      onClick={generateEveningReflection}
    >
      <Moon size={14} className="text-indigo-400 flex-shrink-0" />
      <span className={`text-sm ${darkMode ? 'text-indigo-300' : 'text-indigo-700'}`}>Click here for evening reflection</span>
      <button onClick={(e) => { e.stopPropagation(); dismissEveningGlance(); }} className={`ml-auto p-0.5 rounded flex-shrink-0 transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/10'}`} title="Dismiss for today">
        <X size={12} className={textSecondary} />
      </button>
    </div>
    )
  )}
  {/* Frame Nudge card (mobile) */}
  {aiConfig.enabled && aiConfig.features?.frameNudge && activeFrameForNudge && activeFrameForNudge.minutesRemaining > 30 && agendaNowMarker.gapMinutes >= 15 && frameNudgeDismissedKey !== activeFrameNudgeKey && (frameNudgeSuggestion || frameNudgeLoading || frameNudgeError) && (
    <FrameNudgeCard
      suggestion={frameNudgeSuggestion}
      loading={frameNudgeLoading}
      error={frameNudgeError}
      activeFrame={activeFrameForNudge}
      darkMode={darkMode}
      textPrimary={textPrimary}
      textSecondary={textSecondary}
      onRefresh={generateFrameNudge}
      onDismiss={() => setFrameNudgeDismissedKey(activeFrameNudgeKey)}
      onStartTask={scheduleTaskAtNextSlot}
    />
  )}
  {/* Getting Started checklist */}
  {showGettingStarted && <GettingStartedChecklist
    items={gettingStartedItems}
    completedCount={gettingStartedCompleteCount}
    darkMode={darkMode}
    textPrimary={textPrimary}
    textSecondary={textSecondary}
    onDismiss={() => setGettingStartedDismissed(true)}
    onComplete={() => {
      setTasks(prev => prev.filter(t => !t.isExample));
      setUnscheduledTasks(prev => prev.filter(t => !t.isExample));
      setRecycleBin(prev => prev.filter(t => !t.isExample));
      setRecurringTasks(prev => prev.filter(t => !t.isExample));
      setOnboardingComplete(true);
      setGettingStartedDismissed(true);
    }}
  />}
  {/* Reschedule Tasks — shown when overdue past-day tasks exist, or incomplete today tasks after 7pm */}
  {aiConfig?.enabled && aiConfig.features?.aiReschedule && gtdFrames.filter(f => f.enabled).length > 0 && (() => {
    const _todayStr = getTodayStr();
    const _pastOverdue = getOverdueTasks().filter(t => t._overdueType === 'scheduled' ? t.date < _todayStr : true);
    if (!(_pastOverdue.length > 0 || (incompleteTodayTasks.length > 0 && currentTime.getHours() >= 19))) return null;
    return (
      <button
        onClick={() => { setShowRescheduleModal(true); setRescheduleResults(null); setRescheduleError(''); }}
        className={`w-full mb-3 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-colors ${darkMode ? 'bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 border border-violet-500/30' : 'bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200'}`}
      >
        <Sparkles size={15} />
        Reschedule Tasks
      </button>
    );
  })()}
  {/* Overdue tasks from past days */}
  {(() => {
    const todayStr = getTodayStr();
    const pastOverdue = getOverdueTasks().filter(t => {
      if (t._overdueType === 'scheduled') return t.date < todayStr;
      return true; // deadline overdue are always from past dates
    });
    if (pastOverdue.length === 0) return null;
    return (
      <div className={`mb-4 rounded-lg border ${darkMode ? 'border-orange-500/40 bg-orange-500/10' : 'border-orange-400/50 bg-orange-50'} overflow-hidden`}>
        <button
          onClick={() => toggleSection('overdue')}
          className="w-full flex items-center justify-between px-3 py-2.5"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle size={15} className="text-orange-500" />
            <span className="text-sm font-semibold text-orange-500">Overdue</span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-orange-500/30 text-orange-300' : 'bg-orange-200 text-orange-700'}`}>
              {pastOverdue.length}
            </span>
          </div>
          {minimizedSections.overdue ? <ChevronDown size={16} className="text-orange-500" /> : <ChevronUp size={16} className="text-orange-500" />}
        </button>
        {!minimizedSections.overdue && (
          <div className="px-3 pb-2.5 space-y-1">
            {pastOverdue.map(task => (
              <div
                key={`mobile-overdue-${task.id}`}
                className={`flex items-center gap-2.5 py-2 px-2 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-white/80'}`}
              >
                <button
                  onClick={() => toggleComplete(task.id, task._overdueType === 'deadline')}
                  className={`w-5 h-5 rounded flex-shrink-0 border-2 ${task.completed
                    ? 'border-orange-400 bg-orange-400'
                    : darkMode ? 'border-orange-400/60 bg-white/10' : 'border-orange-400/60 bg-white'
                  } flex items-center justify-center`}
                >
                  {task.completed && <Check size={12} strokeWidth={3} className="text-white" />}
                </button>
                <div
                  className={`flex-1 min-w-0 ${task._overdueType === 'scheduled' ? 'cursor-pointer' : ''}`}
                  onClick={() => {
                    if (task._overdueType !== 'scheduled') return;
                    if (task.date) setSelectedDate(new Date(task.date + 'T12:00:00'));
                    setMobileActiveTab('timeline');
                    setTimeout(() => {
                      const el = document.querySelector(`[data-task-id="${task.id}"]`);
                      if (el && calendarRef.current) {
                        const container = calendarRef.current;
                        const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
                        const scrollTarget = Math.max(0, elTop - container.clientHeight / 2 + el.offsetHeight / 2);
                        container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                        el.classList.add('ring-2', 'ring-blue-400');
                        setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
                      }
                    }, 200);
                  }}
                >
                  <div className={`text-sm font-medium truncate ${task.completed ? 'line-through opacity-50' : textPrimary}`}>
                    {renderTitle(task.title)}
                  </div>
                  <div className={`text-xs ${textSecondary} flex items-center gap-1 mt-0.5`}>
                    {task._overdueType === 'scheduled' ? (
                      <>
                        <CalendarDays size={10} />
                        {formatDeadlineDate(task.date)}
                      </>
                    ) : (
                      <>
                        <AlertCircle size={10} />
                        Due: {formatDeadlineDate(task.deadline)}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {task.isRecurring ? (
                    <>
                      <span
                        className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} opacity-50 cursor-default`}
                        title="Recurring task"
                      >
                        <RefreshCw size={14} />
                      </span>
                      <button
                        onClick={() => toggleComplete(task.id, false)}
                        className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} active:scale-95 transition-transform`}
                        title="Mark complete"
                      >
                        <CheckCircle size={14} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        if (task._overdueType === 'scheduled') {
                          pushUndo();
                          setTasks(prev => prev.filter(t => t.id !== task.id));
                          const { startTime, date, duration, _overdueType, ...rest } = task;
                          setUnscheduledTasks(prev => [...prev, { ...rest, priority: rest.priority || 0 }]);
                          playUISound('slide');
                          setUndoToast({ message: 'Moved to inbox', actionable: true });
                        } else {
                          clearDeadline(task.id);
                          playUISound('slide');
                          setUndoToast({ message: 'Deadline cleared', actionable: true });
                        }
                      }}
                      className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} active:scale-95 transition-transform`}
                      title="Move to inbox"
                    >
                      <Inbox size={14} />
                    </button>
                  )}
                  <button
                    onClick={() => moveToRecycleBin(task.id, task._overdueType === 'deadline')}
                    className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} active:scale-95 transition-transform`}
                    title="Move to Recycle Bin"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  })()}
  {(() => {
    const filteredAgenda = filterByTags(todayAgenda);
    const today = new Date(getTodayStr() + 'T12:00:00');
    const nowMinGlance = currentTime.getHours() * 60 + currentTime.getMinutes();
    const todayFrames = getFrameInstancesForDate(today).filter(f => timeToMinutes(f.end) > nowMinGlance);
    const glanceBorderColorMap = darkMode ? {
      'bg-indigo-200': 'rgba(165,180,252,0.4)',
      'bg-amber-200': 'rgba(253,230,138,0.4)',
      'bg-green-200': 'rgba(167,243,208,0.4)',
      'bg-blue-200': 'rgba(191,219,254,0.4)',
      'bg-rose-200': 'rgba(254,205,211,0.4)',
      'bg-purple-200': 'rgba(221,214,254,0.4)',
      'bg-teal-200': 'rgba(153,246,228,0.4)',
      'bg-orange-200': 'rgba(254,215,170,0.4)',
    } : {
      'bg-indigo-200': 'rgba(79,70,229,0.75)',
      'bg-amber-200': 'rgba(217,119,6,0.75)',
      'bg-green-200': 'rgba(22,163,74,0.75)',
      'bg-blue-200': 'rgba(37,99,235,0.75)',
      'bg-rose-200': 'rgba(225,29,72,0.75)',
      'bg-purple-200': 'rgba(147,51,234,0.75)',
      'bg-teal-200': 'rgba(13,148,136,0.75)',
      'bg-orange-200': 'rgba(234,88,12,0.75)',
    };
    const glanceColorMap = darkMode ? {
      'bg-indigo-200': 'rgba(165,180,252,0.08)',
      'bg-amber-200': 'rgba(253,230,138,0.08)',
      'bg-green-200': 'rgba(167,243,208,0.08)',
      'bg-blue-200': 'rgba(191,219,254,0.08)',
      'bg-rose-200': 'rgba(254,205,211,0.08)',
      'bg-purple-200': 'rgba(221,214,254,0.08)',
      'bg-teal-200': 'rgba(153,246,228,0.08)',
      'bg-orange-200': 'rgba(254,215,170,0.08)',
    } : {
      'bg-indigo-200': 'rgba(165,180,252,0.18)',
      'bg-amber-200': 'rgba(253,230,138,0.18)',
      'bg-green-200': 'rgba(167,243,208,0.18)',
      'bg-blue-200': 'rgba(191,219,254,0.18)',
      'bg-rose-200': 'rgba(254,205,211,0.18)',
      'bg-purple-200': 'rgba(221,214,254,0.18)',
      'bg-teal-200': 'rgba(153,246,228,0.18)',
      'bg-orange-200': 'rgba(254,215,170,0.18)',
    };

    const taskFrameMap = new Map();
    for (const task of filteredAgenda) {
      if (task._agendaType !== 'scheduled' || !task.startTime) continue;
      const tStart = timeToMinutes(task.startTime);
      const tEnd = tStart + (task.duration || 30);
      for (const frame of todayFrames) {
        const fStart = timeToMinutes(frame.start);
        const fEnd = timeToMinutes(frame.end);
        if (tStart >= fStart && tEnd <= fEnd) {
          taskFrameMap.set(String(task.id), frame.frameId);
          break;
        }
      }
    }

    const nonScheduled = filteredAgenda.filter(t => t._agendaType !== 'scheduled');
    const scheduled = filteredAgenda.filter(t => t._agendaType === 'scheduled');

    const sections = [];
    const sortedFrames = [...todayFrames].sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    const assignedTaskIds = new Set();

    let scheduledIdx = 0;
    for (const frame of sortedFrames) {
      const fStart = timeToMinutes(frame.start);
      const beforeTasks = [];
      while (scheduledIdx < scheduled.length) {
        const t = scheduled[scheduledIdx];
        const tStart = timeToMinutes(t.startTime || '00:00');
        if (tStart < fStart && !taskFrameMap.has(String(t.id))) {
          beforeTasks.push(t);
          assignedTaskIds.add(String(t.id));
          scheduledIdx++;
        } else break;
      }
      if (beforeTasks.length > 0) sections.push({ type: 'unframed', tasks: beforeTasks });

      const frameTasks = scheduled.filter(t => taskFrameMap.get(String(t.id)) === frame.frameId);
      const availSlots = computeAvailableSlots(frame, today);
      const totalAvail = availSlots.reduce((sum, s) => sum + s.minutes, 0);
      // Hide frames with no availability and no tasks (fully blocked by calendar events)
      if (totalAvail > 0 || frameTasks.length > 0) {
        sections.push({ type: 'frame', frame, tasks: frameTasks, totalAvail });
      }
      frameTasks.forEach(t => assignedTaskIds.add(String(t.id)));
      while (scheduledIdx < scheduled.length && assignedTaskIds.has(String(scheduled[scheduledIdx].id))) scheduledIdx++;
    }
    const remaining = scheduled.filter(t => !assignedTaskIds.has(String(t.id)));
    if (remaining.length > 0) sections.push({ type: 'unframed', tasks: remaining });

    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();

    // Compute now marker position within sections (frame-aware)
    let nowMarkerSectionInfo = null;
    let nowIsAfterAllSections = false;
    if (sections.length > 0 && !agendaNowMarker.insideTask) {
      for (let si = 0; si < sections.length; si++) {
        const section = sections[si];
        let sStart, sEnd;
        if (section.type === 'frame') {
          sStart = timeToMinutes(section.frame.start);
          sEnd = timeToMinutes(section.frame.end);
        } else {
          if (section.tasks.length === 0) continue;
          sStart = Math.min(...section.tasks.map(t => timeToMinutes(t.startTime || '00:00')));
          sEnd = Math.max(...section.tasks.map(t => timeToMinutes(t.startTime || '00:00') + (t.duration || 0)));
        }
        if (nowMin >= sStart && nowMin < sEnd) {
          let afterTaskIdx = -1;
          for (let ti = 0; ti < section.tasks.length; ti++) {
            const taskEnd = timeToMinutes(section.tasks[ti].startTime || '00:00') + (section.tasks[ti].duration || 0);
            if (nowMin >= taskEnd) afterTaskIdx = ti;
          }
          nowMarkerSectionInfo = { si, inSection: true, afterTaskIdx };
          break;
        } else if (nowMin < sStart) {
          nowMarkerSectionInfo = { si, inSection: false };
          break;
        }
      }
      if (!nowMarkerSectionInfo) {
        nowIsAfterAllSections = true;
      }
    }

    const renderMobileNowMarker = (key) => {
      const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
      const gapM = agendaNowMarker.gapMinutes % 60;
      const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
      return (
        <div key={key} className="flex gap-2.5 py-2.5">
          <div className="w-1.5 rounded-full flex-shrink-0 bg-red-500" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-red-500">{formatTime(agendaNowMarker.nowTimeStr)}, {gapStr} of free time</div>
            {agendaNowMarker.gapMinutes < 30 ? (
              <div className="text-xs italic text-red-500 mt-0.5">Get ready to be productive!</div>
            ) : agendaNowMarker.inboxCount > 0 ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-xs italic text-red-500">Maybe tackle an inbox task?</span>
                {agendaNowMarker.showNudge && aiConfig.enabled && aiConfig.features?.frameNudge && activeFrameForNudge && (
                  <button onClick={() => { setFrameNudgeDismissedKey(''); generateFrameNudge(); }} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/20 hover:bg-teal-500/30 text-teal-600 dark:text-teal-400 transition-colors">
                    <Sparkles size={9} />AI
                  </button>
                )}
              </div>
            ) : null}
          </div>
        </div>
      );
    };

    const renderMobileTaskItem = (task, keyPrefix) => {
      const colorClass = task.color === 'task-calendar' ? '' : task.color;
      let timeLabel = '';
      let relativeLabel = '';
      if (task._agendaType === 'allday') {
        timeLabel = 'ALL DAY';
      } else if (task._agendaType === 'deadline') {
        timeLabel = 'DUE TODAY';
      } else {
        const [h, m] = (task.startTime || '0:0').split(':').map(Number);
        const startMin = h * 60 + m;
        const endMin = startMin + (task.duration || 0);
        const endH = String(Math.floor(endMin / 60)).padStart(2, '0');
        const endM = String(endMin % 60).padStart(2, '0');
        timeLabel = `${formatTime(task.startTime)}\u00A0–\u00A0${formatTime(endH + ':' + endM)}`;
        const diff = startMin - nowMin;
        if (diff > 0) {
          relativeLabel = diff >= 60 ? `in ${Math.floor(diff / 60)}h ${diff % 60 > 0 ? `${diff % 60}m` : ''}` : `in ${diff}m`;
        } else if (diff === 0) {
          relativeLabel = 'now';
        } else if (nowMin < endMin && !task.completed) {
          relativeLabel = 'In Progress';
        } else if (nowMin >= endMin && !task.completed) {
          relativeLabel = 'Overdue';
        }
      }
      return (
        <div
          key={`${keyPrefix}-${task._agendaType}-${task.id}`}
          data-ctx-menu
          onContextMenu={(e) => {
            e.preventDefault();
            setTaskContextMenu({
              x: e.clientX, y: e.clientY,
              taskId: task.id,
              isRecurring: !!task.isRecurring,
              isImported: !!task.imported,
              isAllDay: !!task.isAllDay || task._agendaType === 'allday',
              dateStr: dateToString(new Date()),
            });
          }}
          className={`flex gap-2.5 py-2.5 ${task.completed ? 'opacity-50' : ''} cursor-pointer active:bg-white/5 rounded-lg transition-colors`}
          onClick={() => {
            setMobileActiveTab('timeline');
            setTimeout(() => {
              const el = document.querySelector(`[data-task-id="${task.id}"]`);
              if (el && calendarRef.current) {
                const container = calendarRef.current;
                const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
                const scrollTarget = Math.max(0, elTop - container.clientHeight / 2 + el.offsetHeight / 2);
                container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                el.classList.add('ring-2', 'ring-blue-400');
                setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
              }
            }, 150);
          }}
        >
          <div className={`w-1.5 rounded-full flex-shrink-0 ${colorClass} ${relativeLabel === 'In Progress' ? 'animate-pulse' : ''}`} style={task.isTaskCalendar ? getTaskCalendarStyle(task, darkMode) : task.nativeCalendarColor ? { backgroundColor: task.nativeCalendarColor } : {}}></div>
          <div className="min-w-0 flex-1">
            <div className={`text-base font-semibold ${textPrimary} ${task.completed ? 'line-through' : ''} flex items-center gap-1.5`}>
              {task.isRecurring && <RefreshCw size={13} className="flex-shrink-0 opacity-60" />}
              {task.importSource === 'obsidian' && <BookOpen size={13} className="flex-shrink-0 opacity-60" title="From Obsidian" />}
              <span className="truncate">{renderTitle(task.title)}</span>
            </div>
            <div className={`text-sm ${textSecondary} flex items-center gap-1`}>
              {timeLabel}{relativeLabel ? <>{`, `}<span className={relativeLabel === 'Overdue' ? 'text-orange-500 font-medium' : relativeLabel === 'In Progress' ? 'text-blue-500 font-medium' : ''}>{relativeLabel}</span></> : ''}
              {relativeLabel === 'In Progress' && focusModeAvailable && (
                <button
                  onClick={(e) => { e.stopPropagation(); enterFocusMode(); }}
                  className="ml-1 p-1.5 rounded text-purple-500 hover:text-purple-400 hover:bg-purple-500/20 transition-colors"
                  title="Enter Focus Mode"
                >
                  <Target size={16} className="animate-pulse" />
                </button>
              )}
            </div>
            {goalsProjectsEnabled && task.projectId && (() => {
              const proj = projects.find(p => p.id === task.projectId);
              if (!proj) return null;
              return (
                <button
                  onClick={(e) => { e.stopPropagation(); setProjectFilter(prev => prev === task.projectId ? null : task.projectId); }}
                  className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium transition-colors ${darkMode ? 'bg-blue-900/50 text-blue-300 active:bg-blue-800/70' : 'bg-blue-100 text-blue-700 active:bg-blue-200'} ${projectFilter === task.projectId ? 'ring-1 ring-blue-400' : ''}`}
                  title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                >
                  {proj.title}
                </button>
              );
            })()}
          </div>
          {(relativeLabel === 'Overdue' || (task._agendaType === 'allday' && !task.imported)) && !task.completed && (
            <div className="flex items-center gap-1 flex-shrink-0 mr-5">
              {task.isRecurring ? (
                <span
                  className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} opacity-50 cursor-default`}
                  title="Recurring task"
                >
                  <RefreshCw size={14} />
                </span>
              ) : (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    pushUndo();
                    setTasks(prev => prev.filter(t => t.id !== task.id));
                    const { startTime, date, _agendaType, ...rest } = task;
                    setUnscheduledTasks(prev => [...prev, { ...rest, priority: rest.priority || 0 }]);
                    playUISound('slide');
                    setUndoToast({ message: 'Moved to inbox', actionable: true });
                  }}
                  className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} active:scale-95 transition-transform`}
                  title="Move to Inbox"
                >
                  <Inbox size={14} />
                </button>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); toggleComplete(task.id, false); }}
                className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} active:scale-95 transition-transform`}
                title="Mark complete"
              >
                <CheckCircle size={14} />
              </button>
            </div>
          )}
        </div>
      );
    };

    return (
    <div className="space-y-1.5">
      {/* Now marker before first task (only when no frame sections handle positioning) */}
      {filteredAgenda.length > 0 && sections.length === 0 && !agendaNowMarker.insideTask && agendaNowMarker.insertAfterIndex < 0 && (() => {
        const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
        const gapM = agendaNowMarker.gapMinutes % 60;
        const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
        return (
          <div key="mobile-now-marker" className="flex gap-2.5 py-2.5">
            <div className="w-1.5 rounded-full flex-shrink-0 bg-red-500" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-red-500">{formatTime(agendaNowMarker.nowTimeStr)}, {gapStr} of free time</div>
              {agendaNowMarker.gapMinutes < 30 ? (
                <div className="text-xs italic text-red-500 mt-0.5">Get ready to be productive!</div>
              ) : agendaNowMarker.inboxCount > 0 ? (
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs italic text-red-500">Maybe tackle an inbox task?</span>
                  {agendaNowMarker.showNudge && aiConfig.enabled && aiConfig.features?.frameNudge && activeFrameForNudge && (
                    <button onClick={() => { setFrameNudgeDismissedKey(''); generateFrameNudge(); }} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/20 hover:bg-teal-500/30 text-teal-600 dark:text-teal-400 transition-colors">
                      <Sparkles size={9} />AI
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        );
      })()}
      {/* Non-scheduled items (all-day, deadlines) */}
      {nonScheduled.map(task => renderMobileTaskItem(task, 'mobile-glance'))}
      {/* Frame-grouped and unframed sections */}
      {sections.map((section, si) => {
        const elements = [];
        // Now marker between sections (before this section)
        if (nowMarkerSectionInfo && !nowMarkerSectionInfo.inSection && nowMarkerSectionInfo.si === si) {
          elements.push(renderMobileNowMarker(`mobile-now-mid-${si}`));
        }
        if (section.type === 'frame') {
          const borderColor = glanceBorderColorMap[section.frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)');
          const bgColor = glanceColorMap[section.frame.color] || (darkMode ? 'rgba(165,180,252,0.08)' : 'rgba(165,180,252,0.18)');
          const availH = Math.floor(section.totalAvail / 60);
          const availM = section.totalAvail % 60;
          const availStr = availH > 0 ? `${availH}h${availM > 0 ? ` ${availM}m` : ''}` : `${availM}m`;
          const markerInThisFrame = nowMarkerSectionInfo && nowMarkerSectionInfo.inSection && nowMarkerSectionInfo.si === si;
          elements.push(
            <div
              key={`mobile-frame-section-${section.frame.frameId}`}
              className="rounded-md overflow-hidden"
              style={{
                borderLeft: `3px solid ${borderColor}`,
                background: bgColor,
              }}
            >
              <div className="px-3 pt-2 pb-1">
                <div className="flex items-center gap-1.5">
                  <LayoutGrid size={12} style={{ color: borderColor }} />
                  <span className="text-xs font-semibold" style={{ color: borderColor }}>{section.frame.label}</span>
                  <span className={`text-xs ${textSecondary}`}>{formatTime(section.frame.start)} – {formatTime(section.frame.end)}</span>
                </div>
                {section.totalAvail > 0 && (
                  <p className="mt-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>
                      {availStr} available
                    </span>
                  </p>
                )}
              </div>
              <div className="px-2 pb-1.5">
                {section.tasks.length === 0 && !markerInThisFrame ? (
                  <p className={`text-xs ${textSecondary} py-2 px-1 italic`}>No tasks scheduled</p>
                ) : (() => {
                  const items = [];
                  if (markerInThisFrame && nowMarkerSectionInfo.afterTaskIdx < 0) {
                    items.push(renderMobileNowMarker(`mobile-now-frame-${si}`));
                  }
                  section.tasks.forEach((task, ti) => {
                    items.push(renderMobileTaskItem(task, 'mobile-frame'));
                    if (markerInThisFrame && nowMarkerSectionInfo.afterTaskIdx === ti) {
                      items.push(renderMobileNowMarker(`mobile-now-frame-${si}-${ti}`));
                    }
                  });
                  return items;
                })()}
              </div>
            </div>
          );
        } else {
          const markerInThisSection = nowMarkerSectionInfo && nowMarkerSectionInfo.inSection && nowMarkerSectionInfo.si === si;
          if (markerInThisSection && nowMarkerSectionInfo.afterTaskIdx < 0) {
            elements.push(renderMobileNowMarker(`mobile-now-unframed-${si}`));
          }
          section.tasks.forEach((task, ti) => {
            elements.push(renderMobileTaskItem(task, 'mobile-glance'));
            if (markerInThisSection && nowMarkerSectionInfo.afterTaskIdx === ti) {
              elements.push(renderMobileNowMarker(`mobile-now-unframed-${si}-${ti}`));
            }
          });
        }
        return <React.Fragment key={`mobile-section-${si}`}>{elements}</React.Fragment>;
      })}
      {/* Now marker after all tasks (when "now" is past the last scheduled task/frame) */}
      {filteredAgenda.length > 0 && !agendaNowMarker.insideTask && (sections.length > 0 ? nowIsAfterAllSections : agendaNowMarker.insertAfterIndex >= todayAgenda.length - 1) && (() => {
        const hr = currentTime.getHours();
        const barColor = hr >= 22 ? 'bg-blue-500' : hr >= 19 ? 'bg-green-500' : 'bg-yellow-500';
        const textColor = hr >= 22 ? 'text-blue-500' : hr >= 19 ? 'text-green-500' : 'text-yellow-600';
        const subtitle = hr >= 22 ? "Get some rest so you're ready for tomorrow!" : hr >= 19 ? 'Enjoy the evening!' : 'Time to relax or tackle more tasks?';
        return (
          <div key="mobile-now-marker-end" className="flex gap-2.5 py-2.5">
            <div className={`w-1.5 rounded-full flex-shrink-0 ${barColor}`} />
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium ${textColor}`}>{formatTime(agendaNowMarker.nowTimeStr)}, all done!</div>
              <div className={`text-xs italic ${textColor} mt-0.5`}>{subtitle}</div>
            </div>
          </div>
        );
      })()}
    </div>
  ); })()}
  {/* GLANCEahead — tomorrow preview */}
  {(() => {
    const isDayDone = (todayAgenda.length > 0 && !agendaNowMarker.insideTask && agendaNowMarker.insertAfterIndex >= todayAgenda.length - 1) || todayAgenda.length === 0;
    const isEvening = currentTime.getHours() >= 19;
    if (!isDayDone && !isEvening) return null;
    const { dayLabel, taskCount, eventCount, deadlineCount, firstStartTime, committedMinutes, isEmpty } = glanceAhead;
    const committedH = Math.floor(committedMinutes / 60);
    const committedM = committedMinutes % 60;
    const committedStr = committedH > 0 ? `${committedH}h${committedM > 0 ? ` ${committedM}m` : ''}` : committedM > 0 ? `${committedM}m` : null;
    const handleGlanceAheadClick = () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      setMobileActiveTab('timeline');
      goToDate(tomorrow);
      if (firstStartTime) {
        setTimeout(() => scrollToHour(firstStartTime), 150);
      }
    };
    return (
      <div className={`mt-3 pt-3 border-t ${borderClass} cursor-pointer active:opacity-70 transition-opacity`} onClick={handleGlanceAheadClick}>
        <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textSecondary}`}>
          <span className="flex items-center gap-1.5">
            <span><span className="italic">GLANCE</span><span className="normal-case not-italic">ahead</span></span>
            <span className="font-normal normal-case">— {dayLabel}</span>
          </span>
        </div>
        {isEmpty ? (
          <p className={`text-sm ${textSecondary} italic`}>Tomorrow is wide open</p>
        ) : (
          <div className="space-y-1">
            {firstStartTime && (
              <div className="flex items-center gap-2">
                <Clock size={13} className={textSecondary} />
                <span className={`text-sm ${textPrimary}`}>Day starts at <span className="font-medium">{formatTime(firstStartTime)}</span></span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {taskCount > 0 && (
                <span className={`text-sm ${textPrimary} flex items-center gap-1`}><CheckSquare size={12} className={textSecondary} />{taskCount} task{taskCount !== 1 ? 's' : ''}</span>
              )}
              {eventCount > 0 && (
                <span className={`text-sm ${textPrimary} flex items-center gap-1`}><Calendar size={12} className={textSecondary} />{eventCount} event{eventCount !== 1 ? 's' : ''}</span>
              )}
              {deadlineCount > 0 && (
                <span className={`text-sm font-medium ${darkMode ? 'text-orange-400' : 'text-orange-600'} flex items-center gap-1`}><AlertTriangle size={12} />{deadlineCount} deadline{deadlineCount !== 1 ? 's' : ''}</span>
              )}
              {committedStr && (
                <span className={`text-xs px-2 py-0.5 rounded-full ${darkMode ? 'bg-blue-900/40 text-blue-300' : 'bg-blue-100 text-blue-700'}`}>{committedStr} committed</span>
              )}
            </div>
          </div>
        )}
      </div>
    );
  })()}
  {/* Routines row */}
  {routinesEnabled && (() => {
    const realRoutines = todayRoutines.filter(r => !String(r.id).startsWith('example-'));
    const visibleRoutines = realRoutines.filter(r => !routineCompletions[r.id]);
    if (realRoutines.length > 0 && visibleRoutines.length === 0) return null;
    const openRoutinesSettings = () => {
      setDashboardSelectedChips(todayRoutines.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, startTime: r.startTime || null })));
      setRoutineAddingToBucket(null);
      setRoutineNewChipName('');
      setMobileActiveTab('settings');
      setMobileSettingsView('routines');
    };
    if (visibleRoutines.length === 0) {
      return (
        <div className={`mt-3 pt-3 border-t ${borderClass} cursor-pointer active:opacity-70 transition-opacity`} onClick={openRoutinesSettings}>
          <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textSecondary}`}>Routines</div>
          <div className="flex items-center gap-2">
            <span className={`text-xs ${textSecondary} italic`}>None scheduled</span>
            <span className="text-xs text-teal-500 font-medium">+ Add</span>
          </div>
        </div>
      );
    }
    return (
      <div className={`mt-3 pt-3 border-t ${borderClass}`}>
        <div className="flex items-center justify-between mb-2">
          <div className={`text-xs font-semibold uppercase tracking-wide ${textSecondary}`}>Routines</div>
          <button onClick={openRoutinesSettings} className="text-xs text-teal-500 font-medium active:opacity-70 transition-opacity">+ Add</button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {[...visibleRoutines].sort((a, b) => {
            if (a.isAllDay && !b.isAllDay) return -1;
            if (!a.isAllDay && b.isAllDay) return 1;
            if (a.startTime && b.startTime) return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
            return 0;
          }).map(r => {
            const done = !!routineCompletions[r.id];
            let timeLabel = '';
            if (!r.isAllDay && r.startTime) {
              if (use24HourClock) {
                timeLabel = r.startTime;
              } else {
                const [h, m] = r.startTime.split(':').map(Number);
                const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                const ampm = h < 12 ? 'AM' : 'PM';
                timeLabel = `${hour12}:${String(m).padStart(2, '0')} ${ampm}`;
              }
            }
            return (
              <button
                key={r.id}
                onClick={() => toggleRoutineCompletion(r.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'} ${done ? 'line-through opacity-50' : 'active:opacity-70'} transition-opacity`}
              >
                {timeLabel && <span className="opacity-70 mr-1">{timeLabel}</span>}{r.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  })()}

  {/* hyperGLANCE sessions — today + overdue */}
  {goalsProjectsEnabled && (() => {
    const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
    const hgItems = getGlanceHGInstances(projects, nowMinutes);
    if (hgItems.length === 0) return null;
    return (
      <div className={`mt-3 pt-3 border-t ${borderClass}`}>
        <div className="text-xs font-semibold tracking-wide mb-2" style={{ color: '#4f46e5' }}>hyperGLANCE</div>
        <div className="space-y-1.5">
          {hgItems.map(({ project, instance }) => {
            const hg = project.hyperglance || {};
            const barColor = hg.color || '#4f46e5';
            const effectiveTime = hg.scheduledTimeOverrides?.[instance.date] || hg.scheduledTime || '0:0';
            const [sh, sm] = effectiveTime.split(':').map(Number);
            const canEnter = isHGSessionReachable(instance, hg, currentTime);
            const timeLabel = (() => {
              if (!hg.scheduledTime && !hg.scheduledTimeOverrides?.[instance.date]) return '';
              if (use24HourClock) return effectiveTime;
              const h12 = sh === 0 ? 12 : sh > 12 ? sh - 12 : sh;
              const ampm = sh < 12 ? 'AM' : 'PM';
              return `${h12}:${String(sm).padStart(2, '0')} ${ampm}`;
            })();
            const isFuture = !canEnter && !instance.isOverdue;
            return (
              <button
                key={project.id}
                onClick={() => isFuture ? setMobileActiveTab('goals') : enterHyperGlanceMode(project.id, instance.date)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left active:opacity-70 transition-opacity ${darkMode ? 'bg-white/5' : 'bg-stone-50'}`}
              >
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: barColor }}></div>
                <span className={`text-sm font-medium min-w-0 truncate ${darkMode ? 'text-gray-200' : 'text-stone-800'}`}>{project.title}</span>
                {canEnter && <span className="text-xs font-medium text-green-500 flex-shrink-0">In progress</span>}
                {instance.isOverdue && !canEnter && <span className="text-xs font-semibold text-amber-500 flex-shrink-0">{instance.date === getTodayStr() ? 'Today' : new Date(instance.date + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · Overdue</span>}
                {isFuture && timeLabel && <span className={`text-xs flex-shrink-0 ${darkMode ? 'text-gray-400' : 'text-stone-500'}`}>{timeLabel}</span>}
                {!isFuture && <span className="ml-auto flex items-center gap-0.5 px-2 py-0.5 rounded-full text-white text-[9px] font-bold animate-pulse flex-shrink-0" style={{ backgroundColor: barColor }}><Zap size={9} />hyperGLANCE</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  })()}

  {/* Mobile notes panel overlay for dayglance tasks */}
  {expandedNotesTaskId && (() => {
    const agendaTask = todayAgenda.find(t => t.id === expandedNotesTaskId);
    if (!agendaTask) return null;
    const isInbox = agendaTask._agendaType === 'deadline';
    return (
      <div className="notes-panel-container fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setExpandedNotesTaskId(null)}>
        <div className="bg-black/30 absolute inset-0" />
        <div
          className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[60vh] overflow-y-auto`}
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
            <div className={`font-medium ${textPrimary} truncate flex-1`}>{renderTitle(agendaTask.title)}</div>
            <button onClick={() => setExpandedNotesTaskId(null)} className={`p-1 rounded-lg ${hoverBg} transition-colors`} aria-label="Close notes">
              <X size={18} className={textSecondary} />
            </button>
          </div>
          <div className="p-4">
            {agendaTask.imported && !agendaTask.isTaskCalendar ? (
              <div>
                <div className={`text-xs font-semibold ${textSecondary} mb-1`}>Description</div>
                <div className={`text-sm whitespace-pre-wrap p-3 rounded-lg ${darkMode ? 'bg-white/5' : 'bg-black/5'} ${textPrimary}`}>
                  {renderFormattedText(agendaTask.notes)}
                </div>
              </div>
            ) : (
              <div className={`${agendaTask.color || ''} rounded-lg`}>
              <NotesSubtasksPanel
                task={agendaTask}
                isInbox={isInbox}
                darkMode={darkMode}
                updateTaskNotes={updateTaskNotes}
                addSubtask={addSubtask}
                toggleSubtask={toggleSubtask}
                deleteSubtask={deleteSubtask}
                updateSubtaskTitle={updateSubtaskTitle}
                noAutoFocus
                aiConfig={aiConfig}
                aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                onGenerateSubtasks={generateAISubtasks}
                wikilinks={extractWikilinks(agendaTask.title).length > 0 ? extractWikilinks(agendaTask.title) : undefined}
                onLoadWikiNote={extractWikilinks(agendaTask.title).length > 0 ? loadWikiNote : undefined}
                onSaveWikiNote={extractWikilinks(agendaTask.title).length > 0 ? saveWikiNote : undefined}
                onOpenInObsidian={extractWikilinks(agendaTask.title).length > 0 ? openInObsidian : undefined}
              />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  })()}
</div>
  );
};

export default MobileGlanceSection;
