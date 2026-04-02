import React, { useState, useRef } from 'react';
import {
  Activity, AlertCircle, AlertTriangle, Archive, BarChart3, Bell, BookOpen, BrainCircuit,
  Calendar, CalendarDays, Check, CheckCircle, CheckSquare, ChevronDown,
  ChevronLeft, ChevronRight, ChevronUp, Clock, Cloud, ExternalLink,
  Eye, FileText, Filter, Flag, Flame, FolderOpen, GitBranch, GripVertical, Hash, HelpCircle,
  Inbox, Key, Layers, LayoutGrid, Link, Loader, Menu, Mic, Minus, Moon, MoreHorizontal,
  NotebookPen, Plus, RefreshCw, Save, Search, Settings, SkipForward, Sparkles,
  Sun, Target, Trash2, TrendingUp, Trophy, Undo2, Upload, Volume2, VolumeX,
  Wifi, X, Zap,
} from 'lucide-react';
import { isNativeAndroid, nativeUpdateEvent } from '../native.js';
import { renderTitle, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask, renderFormattedText } from '../utils/textFormatting.jsx';
import { dateToString, extractTags, extractWikilinks, formatDate, formatDateRange, formatDeadlineDate, formatShortDate } from '../utils/taskUtils.js';
import { HABIT_COLORS, HABIT_ICONS } from '../constants/habits.js';
import { cloudSyncProviders } from '../utils/cloudSyncProviders.js';
import { PROVIDER_MODELS, PROVIDER_LABELS } from '../ai.js';
import { HabitRing, MiniHabitRing } from './HabitRing.jsx';
import GettingStartedChecklist from './GettingStartedChecklist.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import FrameEditor from './FrameEditor.jsx';
import SmartSchedulePanel from './SmartSchedulePanel.jsx';
import DailyNotesModal from './DailyNotesModal.jsx';
import CloudSyncSettingsForm from './CloudSyncSettingsForm.jsx';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';
import FrameNudgeCard from './FrameNudgeCard.jsx';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';
import MobileTabBar from './MobileTabBar.jsx';
import MobileSettingsPanel from './MobileSettingsPanel.jsx';
import MobileRoutinesTab from './MobileRoutinesTab.jsx';
import GoalDashboard from './goals/GoalDashboard.jsx';
import MobileTimeGrid from './MobileTimeGrid.jsx';
import MobileAllDaySection from './MobileAllDaySection.jsx';
import MobileBottomSheets from './MobileBottomSheets.jsx';
import MobileGlanceSection from './MobileGlanceSection.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import InboxFilterPopover from './InboxFilterPopover.jsx';
import InboxArchivedBar from './InboxArchivedBar.jsx';

const MobileLayout = () => {
  const {
    isPhone, isMobile, isTablet, isLandscape,
    visibleDays, visibleDates,
    tabBarRef, suppressTabBarRef,
    reviewScrollRef, calendarRef, timeGridRef, currentTimeRef,
    tagFilterBtnRef, spotlightInputRef, newTaskInputRef,
    voiceTextareaRef, editingInputRef,
    stickyHeaderRef, mobileDateHeaderRef, mobileAllDaySectionRef,
    longPressTriggeredRef, longPressTimerRef,
    autoScrollInterval, frameResizingRef,
    swipeTouchStartX, swipeTouchStartY, swipeCurrentOffset, swipedTaskId,
    swipeDirection, swipeLocked, swipeIsVertical, swipeTaskElement,
    swipeSchedulingInboxTaskId,
    mobileDragActive, mobileDragTaskId, mobileDragTimer, mobileDragOriginalTask,
    mobileDragTouchStartPos, mobileDragAutoScrollInterval, mobileDragLastTouch,
    mobileDragScrollDir, mobileDragStartScrollTop, mobileDragSourceType,
    mobileDragPreventScrollRef, mobileDragPreviewTimeRef, mobileDragPreviewDateRef,
    moveToRecycleBinRef, clearDeadlineRef, expandedRecurringTasksRef,
    moveToInboxRef, openMobileEditTaskRef, openMobileEditNativeEventRef,
    enterFocusModeRef,
    hasCheckedInitialWelcome, skipOnboardingPersist,
    autoBackupInProgressRef, syncAllRef, prevAllTagsRef, prevFrameNudgeKeyRef,
    cloudSyncDebounceRef, suppressCloudUploadRef, suppressTimestampRef,
    suppressClearPendingRef, cloudSyncInProgressRef, cloudSyncInitialDoneRef,
    cloudSyncDownloadRef, cloudSyncErrorCountRef, cloudSyncBackoffUntilRef,
    obsidianVaultHandleRef, obsidianSyncInProgressRef, obsidianPrevTaskStateRef,
    obsidianTasksRef, obsidianInboxRef,
    trmnlSyncTimerRef, trmnlLastPushRef, trmnlBackoffUntilRef, trmnlBackoffCountRef,
    trmnlSyncInProgressRef, performTrmnlSyncRef,
    voiceRecorderRef, voiceAudioChunksRef, voiceAutoStartRef,
    voiceAllTagsRef, voiceBuildTaskContextRef, voiceResolveTaskMatchRef,
    lastWeeklyReviewFiredRef, weeklyReviewDismissedRef,
    focusTimerRef, handleFocusTimerEndRef, focusModeAvailableRef,
    syncHealthConnectHabitsRef, habitLongPressTimer,
    selectedDate, setSelectedDate,
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    recurringTasks, setRecurringTasks,
    recycleBin, setRecycleBin,
    completedTaskUids, setCompletedTaskUids,
    dataLoaded, setDataLoaded,
    darkMode, setDarkMode,
    currentTime, setCurrentTime,
    hours, firstHour,
    tabletActiveTab, setTabletActiveTab,
    mobileActiveTab, setMobileActiveTab,
    mobileWelcomeStep, setMobileWelcomeStep,
    desktopWelcomeStep, setDesktopWelcomeStep,
    showMonthView, setShowMonthView,
    viewedMonth, setViewedMonth,
    mobileReviewPage, setMobileReviewPage,
    showMobileDailySummary, setShowMobileDailySummary,
    mobileSettingsView, setMobileSettingsView,
    use24HourClock, setUse24HourClock,
    minimizedSections, setMinimizedSections,
    showSettings, setShowSettings,
    collapsedSettings, setCollapsedSettings,
    soundEnabled, setSoundEnabled,
    updateInfo, setUpdateInfo,
    updateDismissedVersion, setUpdateDismissedVersion,
    inboxPriorityFilter, setInboxPriorityFilter,
    hideCompletedInbox, setHideCompletedInbox,
    hideProjectTasksInbox, setHideProjectTasksInbox,
    priorityPromptDismissed, setPriorityPromptDismissed,
    sectionInfoDismissed, setSectionInfoDismissed,
    expandedSectionInfo, setExpandedSectionInfo,
    selectedTags, setSelectedTags,
    showUntagged, setShowUntagged,
    showMobileTagFilter, setShowMobileTagFilter,
    allTags,
    showAddTask, setShowAddTask,
    newTask, setNewTask,
    showNewTaskDeadlinePicker, setShowNewTaskDeadlinePicker,
    taskContextMenu, setTaskContextMenu,
    timelineContextMenu, setTimelineContextMenu,
    editingTaskId, setEditingTaskId,
    editingTaskText, setEditingTaskText,
    expandedTaskMenu, setExpandedTaskMenu,
    expandedNotesTaskId, setExpandedNotesTaskId,
    showTimePicker, setShowTimePicker,
    showColorPicker, setShowColorPicker,
    showDatePicker, setShowDatePicker,
    showDeadlinePicker, setShowDeadlinePicker,
    deadlinePickerTaskId, setDeadlinePickerTaskId,
    showRecurrencePicker, setShowRecurrencePicker,
    recurringDeleteConfirm, setRecurringDeleteConfirm,
    editingRecurrenceTaskId, setEditingRecurrenceTaskId,
    showRecurrenceEndDatePicker, setShowRecurrenceEndDatePicker,
    showIncompleteTasks, setShowIncompleteTasks,
    showShortcutHelp, setShowShortcutHelp,
    showHelpModal, setShowHelpModal,
    taskAISuggestion, setTaskAISuggestion,
    taskAISuggestionLoading, setTaskAISuggestionLoading,
    aiSubtasksLoadingForTask, setAiSubtasksLoadingForTask,
    suggestions, setSuggestions,
    selectedSuggestionIndex, setSelectedSuggestionIndex,
    showSuggestions, setShowSuggestions,
    suggestionContext, setSuggestionContext,
    syncUrl, setSyncUrl,
    taskCalendarUrl, setTaskCalendarUrl,
    taskCalendarAuth, setTaskCalendarAuth,
    syncRetentionDays, setSyncRetentionDays,
    calSyncStatus, setCalSyncStatus,
    calSyncLastSynced, setCalSyncLastSynced,
    calSyncConfigured,
    showCalendarUrlHint, setShowCalendarUrlHint,
    availableCalendars, setAvailableCalendars,
    calendarFilter, setCalendarFilter,
    calendarUrlAuth, setCalendarUrlAuth,
    isSyncing, setIsSyncing,
    syncNotification, setSyncNotification,
    pendingImportFile, setPendingImportFile,
    showImportModal, setShowImportModal,
    importColor, setImportColor,
    pendingBackupFile, setPendingBackupFile,
    showRestoreConfirm, setShowRestoreConfirm,
    showBackupMenu, setShowBackupMenu,
    showEmptyBinConfirm, setShowEmptyBinConfirm,
    showMobileRecycleBin, setShowMobileRecycleBin,
    autoBackupConfig, setAutoBackupConfig,
    autoBackupStatus, setAutoBackupStatus,
    showAutoBackupManager, setShowAutoBackupManager,
    autoBackupManagerTab, setAutoBackupManagerTab,
    autoBackupHistory, setAutoBackupHistory,
    autoBackupRestoreConfirm, setAutoBackupRestoreConfirm,
    showStorageBreakdown, setShowStorageBreakdown,
    cloudSyncConfig, setCloudSyncConfig,
    cloudSyncStatus, setCloudSyncStatus,
    cloudSyncError, setCloudSyncError,
    cloudSyncLastSynced, setCloudSyncLastSynced,
    cloudSyncConflict, setCloudSyncConflict,
    obsidianConfig, setObsidianConfig,
    obsidianSyncStatus, setObsidianSyncStatus,
    obsidianSyncError,
    obsidianLastSynced, setObsidianLastSynced,
    trmnlConfig, setTrmnlConfig,
    trmnlSyncStatus, setTrmnlSyncStatus,
    trmnlLastSynced, setTrmnlLastSynced,
    routineDefinitions, setRoutineDefinitions,
    todayRoutines, setTodayRoutines,
    routinesDate, setRoutinesDate,
    removedTodayRoutineIds, setRemovedTodayRoutineIds,
    showRoutinesDashboard, setShowRoutinesDashboard,
    dashboardSelectedChips, setDashboardSelectedChips,
    routineAddingToBucket, setRoutineAddingToBucket,
    routineNewChipName, setRoutineNewChipName,
    routineTimePickerChipId, setRoutineTimePickerChipId,
    routineDeleteConfirm, setRoutineDeleteConfirm,
    routineFocusedChipId, setRoutineFocusedChipId,
    routineDurationEditId, setRoutineDurationEditId,
    routinesEnabled, setRoutinesEnabled,
    habits, setHabits,
    habitLogs, setHabitLogs,
    habitsEnabled, setHabitsEnabled,
    showHabitModal, setShowHabitModal,
    editingHabit, setEditingHabit,
    draggedHabitIdx, setDraggedHabitIdx,
    habitOverflowOpen, setHabitOverflowOpen,
    habitLongPressId, setHabitLongPressId,
    habitEditingCountId, setHabitEditingCountId,
    habitDayPopup, setHabitDayPopup,
    activeHabits, habitStreaks,
    showFocusMode, setShowFocusMode,
    focusPhase, setFocusPhase,
    focusTimerSeconds, setFocusTimerSeconds,
    focusCycleCount, setFocusCycleCount,
    focusSessionStart, setFocusSessionStart,
    focusWorkMinutes, setFocusWorkMinutes,
    focusBreakMinutes, setFocusBreakMinutes,
    focusLongBreakMinutes, setFocusLongBreakMinutes,
    focusCompletedTasks, setFocusCompletedTasks,
    focusShowStats, setFocusShowStats,
    focusShowSettings, setFocusShowSettings,
    focusTimerRunning, setFocusTimerRunning,
    focusTaskMinutes, setFocusTaskMinutes,
    focusBlockTasks, setFocusBlockTasks,
    focusLog, setFocusLog,
    focusLogModalDate, setFocusLogModalDate,
    wakeLockSentinel, focusModeAvailable,
    aiConfig, setAiConfig,
    aiConnectionStatus, setAiConnectionStatus,
    aiConnectionMessage, setAiConnectionMessage,
    aiOllamaHelp, setAiOllamaHelp,
    showVoiceInput, setShowVoiceInput,
    voiceIsRecording, setVoiceIsRecording,
    voiceIsTranscribing, setVoiceIsTranscribing,
    voiceTranscript, setVoiceTranscript,
    voiceParsedTasks, setVoiceParsedTasks,
    voiceTaskTimePickerIdx, setVoiceTaskTimePickerIdx,
    voiceParsedEdits, setVoiceParsedEdits,
    voiceIsParsing, setVoiceIsParsing,
    voiceParseError, setVoiceParseError,
    voiceEditingParsed, setVoiceEditingParsed,
    voiceManualMode, setVoiceManualMode,
    voiceMicError, setVoiceMicError,
    voiceCanRecord,
    showWeeklyReview, setShowWeeklyReview,
    showWeeklyReviewTimePicker, setShowWeeklyReviewTimePicker,
    showWeeklyReviewReminder, setShowWeeklyReviewReminder,
    showMorningTimePicker, setShowMorningTimePicker,
    morningGlanceText, setMorningGlanceText,
    morningGlanceLoading, setMorningGlanceLoading,
    morningGlanceDismissed, setMorningGlanceDismissed,
    morningGlanceError, setMorningGlanceError,
    eveningGlanceText, setEveningGlanceText,
    eveningGlanceLoading, setEveningGlanceLoading,
    eveningGlanceDismissed, setEveningGlanceDismissed,
    eveningGlanceError, setEveningGlanceError,
    weeklyAISummary, setWeeklyAISummary,
    weeklyAILoading, setWeeklyAILoading,
    weeklyAIError, setWeeklyAIError,
    gtdFrames, setGtdFrames,
    showFramesModal, setShowFramesModal,
    framesModalTab, setFramesModalTab,
    editingFrame, setEditingFrame,
    smartScheduleResults, setSmartScheduleResults,
    smartScheduleLoading, setSmartScheduleLoading,
    smartScheduleError, setSmartScheduleError,
    smartScheduleAccepted, setSmartScheduleAccepted,
    showRescheduleModal, setShowRescheduleModal,
    rescheduleResults, setRescheduleResults,
    rescheduleLoading, setRescheduleLoading,
    rescheduleError, setRescheduleError,
    rescheduleAccepted, setRescheduleAccepted,
    frameContextMenu, setFrameContextMenu,
    quickAddFrameModal, setQuickAddFrameModal,
    frameAdjustModal, setFrameAdjustModal,
    frameAdjustTimeField, setFrameAdjustTimeField,
    frameScheduleModal, setFrameScheduleModal,
    frameNudgeSuggestion, setFrameNudgeSuggestion,
    frameNudgeLoading, setFrameNudgeLoading,
    frameNudgeError, setFrameNudgeError,
    frameNudgeDismissedKey, setFrameNudgeDismissedKey,
    reminderSettings, setReminderSettings,
    showRemindersSettings, setShowRemindersSettings,
    activeReminders, setActiveReminders,
    showSpotlight, setShowSpotlight,
    spotlightQuery, setSpotlightQuery,
    spotlightSelectedIndex, setSpotlightSelectedIndex,
    spotlightResults,
    dailyNotes, setDailyNotes,
    dailyNoteTemplate, setDailyNoteTemplate,
    dailyNotesModalDate, setDailyNotesModalDate,
    weather, setWeather,
    weatherZip, setWeatherZip,
    weatherTempUnit, setWeatherTempUnit,
    dailyContent, setDailyContent,
    contentRotation, setContentRotation,
    showWelcome, setShowWelcome,
    gettingStartedDismissed, setGettingStartedDismissed,
    onboardingComplete, setOnboardingComplete,
    onboardingProgress, setOnboardingProgress,
    showOnboarding,
    showGettingStarted,
    gettingStartedItems,
    allGettingStartedComplete,
    gettingStartedCompleteCount,
    undoToast, setUndoToast,
    mobileEditingTask, setMobileEditingTask,
    mobileEditIsInbox, setMobileEditIsInbox,
    mobileEditingNativeEvent, setMobileEditingNativeEvent,
    nativeCalendarKey, setNativeCalendarKey,
    draggedTask, setDraggedTask,
    dragSource, setDragSource,
    dragPreviewTime, setDragPreviewTime,
    dragPreviewDate, setDragPreviewDate,
    dragOverAllDay, setDragOverAllDay,
    dragOverInbox, setDragOverInbox,
    dragOverRecycleBin, setDragOverRecycleBin,
    hoverPreviewTime, setHoverPreviewTime,
    hoverPreviewDate, setHoverPreviewDate,
    isResizing, setIsResizing,
    mobileDragTaskIdState, setMobileDragTaskIdState,
    mobileDragPreviewTime, setMobileDragPreviewTime,
    mobileDragPreviewDate, setMobileDragPreviewDate,
    mobileDragOverTrash,
    trashFabRef,
    timelineScrolledAway, setTimelineScrolledAway,
    isToday, currentTimeMinutes, currentHour, currentTimeTop, showCurrentTimeLine,
    bgClass, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    colors, durationOptions,
    todayTasks, incompleteTodayTasks,
    filteredUnscheduledTasks, filteredTodayTasks,
    taskWidths,
    conflicts,
    pendingPriorities, getDeadlineTasksForDate,
    tasksByDate,
    expandedRecurringTasks,
    todayAgenda,
    agendaNowMarker,
    glanceAhead,
    activeFrameForNudge,
    activeFrameNudgeKey,
    dateIndicatorData,
    hasZeroRealTasks,
    allTimeScheduledCount, allTimeCompletedCount,
    totalCompletedMinutes, totalScheduledMinutes,
    actualTodayNonImportedTasks, actualTodayCompletedTasks,
    actualTodayCompletedMinutes, actualTodayPlannedMinutes, actualTodayFocusMinutes,
    allTimeFocusMinutes, allTimeProjectFocusMinutes,
    inboxCompletedTodayCount, inboxCompletedTodayMinutes,
    allTimeInboxCompletedCount, allTimeInboxCompletedMinutes,
    projectTasksCompletedTodayCount, projectTasksCompletedTodayMinutes,
    allTimeUnscheduledProjectDoneCount, allTimeUnscheduledProjectDoneMinutes,
    allTimeGoalsCreated, allTimeGoalsCompleted,
    allTimeProjectsCreated, allTimeProjectsCompleted,
    todayCompletedGoals, todayCompletedProjects,
    consecutiveDayStreak,
    todayIncompleteTasks, allTimeIncompleteTasks,
    playUISound, playFocusSound,
    formatTime,
    toggleSection, toggleSettingsSection,
    changeDate, goToToday, goToDate, changeViewedMonth,
    scrollToCurrentHour,
    addTask, toggleComplete,
    deleteRecurringInstance, updateRecurrencePattern,
    updateRecurrenceEndCondition, updateRecurringTemplate,
    moveToRecycleBin, moveToInbox, undeleteTask,
    setDeadline, clearDeadline, postponeTask, postponeDeadlineTask,
    cyclePriority, changeTaskColor,
    toggleSubtask, addSubtask, deleteSubtask, updateSubtaskTitle, updateTaskNotes,
    startEditingTask, saveTaskTitle, cancelEditingTask,
    applySuggestionForEdit, handleEditKeyDown, handleEditInputChange,
    handleNewTaskInputChange, handleNewTaskInputKeyDown, applySuggestionForNewTask,
    buildSuggestions,
    manuallyScheduleTask, scheduleTaskAtNextSlot,
    openNewTaskAtTime, openNewTaskForm, openNewInboxTask,
    recordDeletedTaskTombstone, parseRecurringId,
    expandMultiDayEvent,
    openRoutinesDashboard, addRoutineChip, deleteRoutineChip,
    toggleRoutineChipSelection, handleRoutinesDone,
    getTodayHabitCount, incrementHabit, setHabitCount,
    addHabit, updateHabit, archiveHabit, deleteHabit, reorderHabits,
    addStepsHabit, addSleepHabit,
    enterFocusMode, exitFocusMode, startFocusTimer, dismissFocusStats,
    handleFocusTimerEnd,
    focusCompleteTask, focusToggleSubtask, focusAddSubtask,
    focusDeleteSubtask, focusUpdateSubtaskTitle, focusUpdateTaskNotes,
    computeFocusBlockTasks,
    saveFrame, deleteFrame, skipFrameForDay,
    openFrameAdjust, openFrameSchedule, saveFrameAdjust,
    getFrameInstancesForDate,
    runSmartSchedule, applySmartSchedule,
    runReschedule, applyReschedule,
    computeAvailableSlots,
    generateFrameNudge, generateMorningSummary, generateEveningReflection,
    generateWeeklyAISummary, generateAISubtasks,
    dismissMorningGlance, dismissEveningGlance,
    voiceParseWithAI, voiceStartRecording, voiceStopRecording, voiceApplyAllChanges,
    voiceHasTranscription,
    buildTaskContextForAI, resolveTaskMatch,
    applyReminderPreset, updateCategoryReminder,
    snoozeReminder, dismissReminder, dismissAllReminders,
    syncWithCalendar, syncTaskCalendar, syncTaskCompletionToCalDAV,
    nativeEventToTask, clearNativeEventOverride, parseDatetime, parseICS, filterByDateWindow,
    loadData, saveData, applyRemoteData,
    cloudSyncDownload, cloudSyncUpload, cloudSyncTest, syncAll,
    performObsidianSync, loadWikiNote, saveWikiNote,
    performTrmnlSync,
    performLocalBackup, performRemoteBackup,
    buildAutoBackupPayload, loadAutoBackupHistory,
    deleteLocalAutoBackup, deleteRemoteAutoBackup,
    restoreFromAutoBackup, restoreFromRemoteBackup,
    exportBackup, restoreBackup,
    handleFileUpload, handleBackupFileSelect, processImportFile,
    buildSyncPayload,
    fetchAllDailyContent, fetchWeather,
    getHourHeight, minutesToPosition, positionToMinutes, durationToHeight,
    calculateTaskPosition, getTimeFromCursorPosition,
    getAdjustedTimeForImportedConflicts,
    getConflictingTasks, calculateConflictPosition, wouldExceedMaxColumns,
    filterByTags,
    getTasksForDate, getDateIndicators, hasTasksOnDate,
    getDayName, getMonthDays, getNextQuarterHour,
    getTodayStr, getOverdueTasks,
    getTaskCalendarStyle,
    timeToMinutes, minutesToTime,
    selectAllTags, clearTagFilter, toggleTag,
    handleSpotlightSelect,
    updateDailyNote,
    setTaskRef,
    handleCalendarMouseMove, handleCalendarMouseLeave,
    handleDragStart, handleDragEnd, updateDragAutoScroll,
    handleDragOver, handleDragOverInbox, handleDragOverRecycleBin,
    handleDropOnCalendar, handleDropOnDateHeader,
    handleDropOnInbox, handleDropOnRecycleBin,
    handleResizeStart, handleTouchResizeStart,
    handleRoutineResizeStart, handleTouchRoutineResizeStart,
    handleFrameResizeStart,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
    openMobileEditTask, openMobileEditNativeEvent,
    saveMobileEditTask, saveMobileEditNativeEvent,
    pushUndo, performUndo, performRedo,
    confirmEmptyBin, emptyRecycleBin,
    projectFilter, setProjectFilter,
    goals,
    projects,
    goalsProjectsEnabled,
    hideStandaloneTasksInbox, inboxTagFilter, inboxProjectFilter, setInboxProjectFilter,
    archiveInboxTask,
  } = useDayPlannerCtx();

  const [showInboxFilter, setShowInboxFilter] = useState(false);
  const inboxFilterBtnRef = useRef(null);
  const inboxFilterActive =
    hideCompletedInbox ||
    hideStandaloneTasksInbox ||
    (goalsProjectsEnabled && !hideProjectTasksInbox) ||
    inboxTagFilter.length > 0 ||
    inboxProjectFilter.length > 0;

  const [addGoalTrigger, setAddGoalTrigger] = useState(0);
  const [addProjectTrigger, setAddProjectTrigger] = useState(0);
  const [dailyStatsHabitsCollapsed, setDailyStatsHabitsCollapsed] = useState(true);
  const [dailyStatsAllTimeCollapsed, setDailyStatsAllTimeCollapsed] = useState(true);

  return (
        <>
          {/* Mobile Layout */}
          <div className="mobile-timeline-layout" style={isNativeAndroid() ? { height: 'calc(100dvh - 3.5rem - env(safe-area-inset-top, 0px))' } : undefined}>
            {/* Mobile Header */}
            {mobileActiveTab === 'timeline' && (
              <div className={`${cardBg} border-b ${borderClass} flex-shrink-0 relative ${showMonthView ? 'z-50' : 'z-30'}`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <button onClick={() => changeDate(-1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Previous day">
                    <ChevronLeft size={20} className={textSecondary} />
                  </button>
                  <div className="flex flex-col items-center gap-1">
                    <button
                      onClick={() => {
                        if (!showMonthView) setViewedMonth(new Date(selectedDate));
                        setShowMonthView(!showMonthView);
                      }}
                      className={`month-view-toggle ${textPrimary} font-bold text-lg px-2 py-1 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
                    >
                      {formatDateRange(visibleDates)}
                    </button>
                    {dateToString(selectedDate) !== dateToString(new Date()) && (
                      <button
                        onClick={goToToday}
                        className="px-3 py-0.5 text-xs bg-blue-600 text-white rounded-full hover:bg-blue-700 active:bg-blue-700 transition-colors"
                      >
                        Today
                      </button>
                    )}
                  </div>
                  <button onClick={() => changeDate(1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Next day">
                    <ChevronRight size={20} className={textSecondary} />
                  </button>
                </div>
                {/* Month View Popup for mobile */}
                {showMonthView && (
                  <div className={`month-view-container absolute left-4 right-4 top-full mt-1 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-4 z-50`}>
                    <div className="flex items-center justify-between mb-3">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); changeViewedMonth(-1); }}
                        className={`p-1 rounded ${hoverBg} transition-colors`}
                        aria-label="Previous month"
                      >
                        <ChevronLeft size={18} className={textSecondary} />
                      </button>
                      <div className={`font-bold ${textPrimary}`}>
                        {viewedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); changeViewedMonth(1); }}
                        className={`p-1 rounded ${hoverBg} transition-colors`}
                        aria-label="Next month"
                      >
                        <ChevronRight size={18} className={textSecondary} />
                      </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => (
                        <div key={day} className={`text-xs font-semibold ${textSecondary} text-center`}>
                          {day}
                        </div>
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
                            className={`
                              h-10 rounded text-sm relative
                              ${!day ? 'invisible' : ''}
                              ${isSelected ? 'bg-blue-600 text-white font-bold' : ''}
                              ${!isSelected && isDayToday ? 'bg-blue-100 dark:bg-blue-900 font-semibold' : ''}
                              ${!isSelected && !isDayToday ? `${textPrimary} hover:bg-stone-100 dark:hover:bg-gray-700` : ''}
                              ${!day ? '' : 'cursor-pointer'}
                            `}
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
            )}
            {mobileActiveTab === 'inbox' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`} data-inbox-container>
                <div className="px-4 pt-3 pb-1">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <Inbox size={20} /> Inbox
                  </h2>
                </div>
                <div className="flex items-center justify-between px-4 py-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={openNewInboxTask}
                      className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg active:bg-blue-700 transition-colors"
                      title="New Inbox Task"
                    >
                      <Plus size={14} strokeWidth={3} />
                      <span className="text-xs font-medium">New Task</span>
                    </button>
                    {aiConfig?.enabled && aiConfig.features?.smartScheduling && gtdFrames.filter(f => f.enabled).length > 0 && unscheduledTasks.filter(t => !t.completed && !t.isExample).length > 0 && (
                      <button
                        onClick={() => { setMobileActiveTab('settings'); setMobileSettingsView('frames'); setFramesModalTab('schedule'); setEditingFrame(null); }}
                        className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg active:bg-blue-700 transition-colors"
                        title="AI Smart Schedule"
                      >
                        <BrainCircuit size={14} />
                        <span className="text-xs font-medium">Schedule</span>
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      ref={inboxFilterBtnRef}
                      onClick={() => { setShowInboxFilter(v => !v); playUISound('click'); }}
                      className={`relative ${hoverBg} rounded px-1.5 py-1.5 transition-colors`}
                      title="Filter inbox"
                    >
                      <Filter size={14} className={inboxFilterActive ? (darkMode ? 'text-blue-400' : 'text-blue-500') : (darkMode ? 'text-gray-400' : 'text-stone-500')} />
                      {inboxFilterActive && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-500" />}
                    </button>
                    <button
                      onClick={() => { setInboxPriorityFilter(prev => (prev + 1) % 4); playUISound('click'); }}
                      className={`flex gap-0.5 ${hoverBg} rounded px-2 py-1.5 transition-colors`}
                      title={inboxPriorityFilter === 0 ? 'Showing all priorities' : `Showing priority ${inboxPriorityFilter}+`}
                    >
                      {[0, 1, 2].map(i => (
                        <span
                          key={i}
                          className={`w-2.5 h-1 rounded-full ${
                            inboxPriorityFilter === 0
                              ? `${darkMode ? 'bg-gray-500' : 'bg-stone-400'}`
                              : i < inboxPriorityFilter
                                ? 'bg-blue-500'
                                : `${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`
                          }`}
                        />
                      ))}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mobileActiveTab === 'routines' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <Sparkles size={20} /> Routines
                  </h2>
                </div>
              </div>
            )}
            {mobileActiveTab === 'goals' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="px-4 pt-3 pb-1">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <GitBranch size={20} className="text-blue-500" /> Goals &amp; Projects
                  </h2>
                </div>
                <div className="flex items-center gap-1 px-4 py-2">
                  <button
                    onClick={() => setAddGoalTrigger(v => v + 1)}
                    className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-blue-600 text-white rounded-lg active:bg-blue-700 transition-colors"
                  >
                    <Flag size={14} strokeWidth={2.5} />
                    <span className="text-xs font-medium">Add Goal</span>
                  </button>
                  <button
                    onClick={() => setAddProjectTrigger(v => v + 1)}
                    className="flex items-center justify-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg active:bg-emerald-700 transition-colors"
                  >
                    <Layers size={14} strokeWidth={2.5} />
                    <span className="text-xs font-medium">Add Project</span>
                  </button>
                </div>
              </div>
            )}
            {mobileActiveTab === 'settings' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <Settings size={20} /> Settings
                  </h2>
                </div>
              </div>
            )}
            {mobileActiveTab === 'dayglance' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="flex items-center justify-center px-4 py-3">
                  <img
                    src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'}
                    alt="dayGLANCE"
                    className="h-8"
                  />
                </div>
              </div>
            )}

            {/* Mobile Tab Content */}
            {mobileActiveTab === 'timeline' && (
              <div className="px-0 flex-1 min-h-0">
                {/* Reuse existing calendar grid for single day */}
                <div
                  ref={calendarRef}
                  className={`${cardBg} border ${borderClass} overflow-y-scroll overflow-x-hidden ${darkMode ? 'dark-scrollbar' : ''} relative h-full`}
                >
                  {/* Sticky header group: date header + all-day section */}
                  <div ref={mobileDateHeaderRef} className={`sticky top-0 z-40 ${cardBg}`}>
                  {/* Current task banner */}
                  {(() => {
                    const todayStr = dateToString(new Date());
                    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
                    const runningTask = [...tasks, ...expandedRecurringTasks].find(t =>
                      t.date === todayStr && !t.isAllDay && !t.completed &&
                      !(t.imported && !t.isTaskCalendar) &&
                      nowMin >= timeToMinutes(t.startTime || '0:00') &&
                      nowMin < timeToMinutes(t.startTime || '0:00') + (t.duration || 0)
                    );
                    if (!runningTask) return null;
                    return (
                      <div className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold ${darkMode ? 'bg-amber-900/40 text-amber-300 border-b border-amber-700/40' : 'bg-amber-50 text-amber-800 border-b border-amber-200'}`}>
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                        <span className="truncate">Now: {renderTitle(runningTask.title)}</span>
                      </div>
                    );
                  })()}
                  <div className={`flex border-b ${borderClass} ${mobileDragPreviewTime === 'all-day' ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
                    <div className={`w-12 flex-shrink-0 border-r ${borderClass} ${mobileDragPreviewTime === 'all-day' ? 'flex items-center justify-center' : ''}`}>
                      {mobileDragPreviewTime === 'all-day' && (
                        <span className="text-[9px] font-bold text-blue-500">ALL DAY</span>
                      )}
                    </div>
                    {visibleDates.map((date, idx) => {
                      const isDateToday = dateToString(date) === dateToString(new Date());
                      const dateStr = dateToString(date);
                      return (
                        <div
                          key={dateStr}
                          className={`flex-1 py-2 px-3 text-center ${idx > 0 ? `border-l ${borderClass}` : ''} ${mobileDragPreviewTime === 'all-day' ? (darkMode ? 'bg-blue-900/40' : 'bg-blue-100') : isDateToday ? (darkMode ? 'bg-blue-900/30' : 'bg-blue-50') : (darkMode ? 'bg-gray-700/50' : 'bg-stone-50')}`}
                          onClick={() => {
                            setNewTask({
                              title: '',
                              startTime: getNextQuarterHour(),
                              duration: 30,
                              date: dateStr,
                              isAllDay: true
                            });
                            setShowAddTask(true);
                          }}
                          title="Tap to add all-day task"
                        >
                          <div className={`font-bold text-sm flex items-center justify-center gap-1.5 ${isDateToday ? 'text-blue-600' : textPrimary}`}>
                            {formatShortDate(date)}
                            <button
                              onClick={(e) => { e.stopPropagation(); setDailyNotesModalDate(dateStr); }}
                              className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors ${dailyNotes[dateStr]?.text ? '' : 'opacity-50'}`}
                              title="Daily notes"
                            >
                              <NotebookPen size={14} />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); setFocusLogModalDate(dateStr); }}
                              className={`p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors ${focusLog[dateStr]?.totalMinutes > 0 ? '' : 'opacity-50'}`}
                              title="Focus sessions"
                            >
                              <Target size={14} />
                            </button>
                          </div>
                          {habitsEnabled && !isDateToday && dateStr < dateToString(new Date()) && habitLogs[dateStr] && activeHabits.length > 0 && (
                            <div className="flex items-center justify-center gap-0.5 mt-0.5 cursor-pointer" onClick={(e) => { e.stopPropagation(); setHabitDayPopup(dateStr); }}>
                              {activeHabits.slice(0, 6).map(habit => (
                                <MiniHabitRing key={habit.id} habit={habit} count={habitLogs[dateStr]?.[habit.id] || 0} darkMode={darkMode} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <MobileAllDaySection />
                  </div>{/* end sticky header group */}

                  {/* Time grid */}
                  <MobileTimeGrid />
                </div>

                {/* Mobile notes panel overlay for timeline tasks (including deadline tasks) */}
                {expandedNotesTaskId && (() => {
                  const scheduledTask = visibleDates.reduce((found, date) => {
                    if (found) return found;
                    return getTasksForDate(date).find(t => t.id === expandedNotesTaskId);
                  }, null);
                  const deadlineTask = !scheduledTask ? unscheduledTasks.find(t => t.id === expandedNotesTaskId && t.deadline) : null;
                  const noteTask = scheduledTask || deadlineTask;
                  if (!noteTask) return null;
                  return (
                    <div className="notes-panel-container fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setExpandedNotesTaskId(null)}>
                      <div className="bg-black/30 absolute inset-0" />
                      <div
                        className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[60vh] overflow-y-auto`}
                        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
                          <div className={`font-medium ${textPrimary} truncate flex-1`}>{noteTask.title}</div>
                          <button onClick={() => setExpandedNotesTaskId(null)} className={`p-1 rounded-lg ${hoverBg} transition-colors`} aria-label="Close notes">
                            <X size={18} className={textSecondary} />
                          </button>
                        </div>
                        <div className="p-4">
                          {noteTask.imported && !noteTask.isTaskCalendar ? (
                            <div>
                              <div className={`text-xs font-semibold ${textSecondary} mb-1`}>Description</div>
                              <textarea
                                defaultValue={noteTask.notes || ''}
                                placeholder="Add description…"
                                rows={4}
                                className={`w-full text-sm p-3 rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 ${darkMode ? 'bg-white/5 text-white placeholder:text-white/40' : 'bg-black/5 text-stone-900 placeholder:text-stone-400'}`}
                                onBlur={async (e) => {
                                  const newNotes = e.target.value;
                                  if (newNotes === (noteTask.notes || '')) return;
                                  setTasks(prev => prev.map(t => t.id === noteTask.id ? { ...t, notes: newNotes } : t));
                                  if (isNativeAndroid() && noteTask.nativeEventId) {
                                    await nativeUpdateEvent({
                                      id: noteTask.nativeEventId,
                                      title: noteTask.title,
                                      start: `${noteTask.date}T${noteTask.startTime}:00`,
                                      end: `${noteTask.date}T${minutesToTime(timeToMinutes(noteTask.startTime || '0:00') + (noteTask.duration || 0))}:00`,
                                      allDay: false,
                                      notes: newNotes,
                                      location: noteTask.location || '',
                                    });
                                  }
                                }}
                              />
                            </div>
                          ) : (
                            <div className={`${noteTask.color || ''} rounded-lg`}>
                            <NotesSubtasksPanel
                              task={noteTask}
                              isInbox={!!deadlineTask}
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
                            />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {mobileActiveTab === 'dayglance' && (
              <MobileGlanceSection />
            )}
            )}

            {mobileActiveTab === 'inbox' && (
              <div className={`px-4 py-4 mobile-tab-fade-in flex-1 min-h-0 overflow-y-auto`}>
                <div className="space-y-2">
                  {filteredUnscheduledTasks.filter(t => !t.isExample).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                      <div className={`relative w-16 h-16 rounded-2xl ${darkMode ? 'bg-emerald-500/15' : 'bg-emerald-50'} flex items-center justify-center mb-4`}>
                        <Inbox size={28} className={`${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                        {unscheduledTasks.filter(t => !t.isExample).length === 0 && (
                          <Check size={14} className={`absolute -top-1 -right-1 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                        )}
                      </div>
                      <p className={`text-base font-semibold ${textPrimary} mb-1`}>
                        {unscheduledTasks.filter(t => !t.isExample).length === 0
                          ? "Inbox zero"
                          : unscheduledTasks.filter(t => !t.isExample).length === 0
                            ? "All overdue"
                            : "No matches"}
                      </p>
                      <p className={`text-sm ${textSecondary} text-center mb-5`}>
                        {unscheduledTasks.filter(t => !t.isExample).length === 0
                          ? "Add tasks here to schedule later"
                          : unscheduledTasks.filter(t => !t.isExample).length === 0
                            ? "All inbox tasks have overdue deadlines"
                            : "No tasks match the current filter"}
                      </p>
                      {unscheduledTasks.filter(t => !t.isExample).length === 0 && (
                        <button
                          onClick={openNewInboxTask}
                          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${darkMode ? 'bg-emerald-500 text-white active:bg-emerald-600' : 'bg-emerald-500 text-white active:bg-emerald-600'} transition-colors`}
                        >
                          <Plus size={16} />
                          Add task
                        </button>
                      )}
                    </div>
                  ) : (
                    filteredUnscheduledTasks.filter(t => !t.isExample).map(task => (
                      <div key={task.id} className="notes-panel-container">
                        <div className={`relative rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'}`}>
                          {/* Swipe action strips - hidden until swipe direction determined */}
                          <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-green-900/80 text-green-300' : 'bg-green-100 text-green-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                            <Calendar size={14} className="mr-1" />Schedule
                          </div>
                          <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                            Edit<Settings size={14} className="ml-1" />
                          </div>
                        <div
                          data-ctx-menu
                          onContextMenu={(e) => {
                            e.preventDefault();
                            setTaskContextMenu({
                              x: e.clientX, y: e.clientY,
                              taskId: task.id,
                              isRecurring: false,
                              isImported: false,
                              isAllDay: false,
                              dateStr: dateToString(new Date()),
                            });
                          }}
                          className={`relative select-none ${task.color} rounded-lg px-3 py-4 shadow-sm ${task.completed ? 'opacity-50' : ''} ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                          onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'inbox')}
                          onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                          onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'inbox')}
                        >
                          {task.isExample && (
                            <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                              Example
                            </span>
                          )}
                          <div className="text-white">
                            <div className="flex items-start justify-between">
                              <div className="flex items-start gap-2 flex-1 min-w-0">
                                <button
                                  onClick={() => toggleComplete(task.id, true)}
                                  className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                >
                                  {task.completed && <Check size={10} strokeWidth={3} />}
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={`font-medium text-sm ${task.completed ? 'line-through' : ''}`}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      startEditingTask(task, true);
                                    }}
                                  >
                                    {renderTitle(task.title)}
                                  </div>
                                  <div className="text-xs opacity-90 mt-1 flex items-center gap-2 flex-wrap">
                                    <span>{task.duration} min</span>
                                    {task.deadline && (
                                      <span className="flex items-center gap-1">
                                        <AlertCircle size={10} />
                                        {formatDeadlineDate(task.deadline)}
                                      </span>
                                    )}
                                    {goalsProjectsEnabled && task.projectId && (() => {
                                      const proj = projects.find(p => p.id === task.projectId);
                                      if (!proj) return null;
                                      return (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const active = projectFilter === task.projectId;
                                            setProjectFilter(active ? null : task.projectId);
                                            setInboxProjectFilter(active ? [] : [task.projectId]);
                                          }}
                                          className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 active:bg-white/40 text-white font-medium transition-colors flex-shrink-0 ${projectFilter === task.projectId ? 'ring-1 ring-white/60' : ''}`}
                                          title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                                        >
                                          {proj.title}
                                        </button>
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0">
                                <button
                                  onMouseDown={() => {
                                    if (isLinkOnlyTask(task)) {
                                      longPressTriggeredRef.current = false;
                                      longPressTimerRef.current = setTimeout(() => {
                                        longPressTriggeredRef.current = true;
                                        setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                      }, 500);
                                    }
                                  }}
                                  onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                  onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isLinkOnlyTask(task)) {
                                      if (!longPressTriggeredRef.current) {
                                        window.open(getLinkUrl(task), '_blank', 'noopener,noreferrer');
                                      }
                                      longPressTriggeredRef.current = false;
                                    } else {
                                      setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                    }
                                  }}
                                  className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                >
                                  {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
                                </button>
                                <div className="deadline-picker-container relative">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                                    }}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${task.deadline ? 'bg-white/20' : ''}`}
                                    title={task.deadline ? `Deadline: ${formatDeadlineDate(task.deadline)}` : 'Set deadline'}
                                  >
                                    <Calendar size={14} />
                                  </button>
                                  {showDeadlinePicker === task.id && (
                                    <DeadlinePickerPopover
                                      taskId={task.id}
                                      currentDeadline={task.deadline}
                                      onClose={() => setShowDeadlinePicker(null)}
                                    />
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center justify-between mt-1.5">
                              {task.completed ? (
                                <button
                                  onClick={(e) => { e.stopPropagation(); archiveInboxTask(task.id); }}
                                  className="flex items-center gap-0.5 hover:bg-white/20 rounded px-1.5 py-1 transition-colors opacity-60 hover:opacity-100"
                                  title="Archive task"
                                >
                                  <Archive size={11} className="text-white" />
                                </button>
                              ) : <span />}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cyclePriority(task.id);
                                }}
                                className="flex gap-0.5 hover:bg-white/20 rounded px-1.5 py-1 transition-colors"
                              >
                                {[0, 1, 2].map(i => (
                                  <span
                                    key={i}
                                    className={`w-2 h-0.5 rounded-full bg-white ${i < (pendingPriorities[task.id] ?? task.priority ?? 0) ? 'opacity-100' : 'opacity-30'}`}
                                  />
                                ))}
                              </button>
                            </div>
                          </div>
                        </div>
                        </div>{/* end swipe wrapper */}
                      </div>
                    ))
                  )}
                </div>

                {/* Mobile notes panel overlay for inbox tasks */}
                {expandedNotesTaskId && (() => {
                  const noteTask = filteredUnscheduledTasks.find(t => t.id === expandedNotesTaskId);
                  if (!noteTask) return null;
                  return (
                    <div className="notes-panel-container fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setExpandedNotesTaskId(null)}>
                      <div className="bg-black/30 absolute inset-0" />
                      <div
                        className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[60vh] overflow-y-auto`}
                        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
                          <div className={`font-medium ${textPrimary} truncate flex-1`}>{noteTask.title}</div>
                          <button onClick={() => setExpandedNotesTaskId(null)} className={`p-1 rounded-lg ${hoverBg} transition-colors`} aria-label="Close notes">
                            <X size={18} className={textSecondary} />
                          </button>
                        </div>
                        <div className="p-4">
                          <div className={`${noteTask.color || ''} rounded-lg`}>
                          <NotesSubtasksPanel
                            task={noteTask}
                            isInbox={true}
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
                          />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {mobileActiveTab === 'inbox' && <InboxArchivedBar />}

            {mobileActiveTab === 'routines' && <MobileRoutinesTab />}

            {/* GoalDashboard stays mounted to avoid expensive remount on every tab switch */}
            <div className={`flex flex-col flex-1 min-h-0 overflow-hidden ${mobileActiveTab === 'goals' ? '' : 'hidden'}`}>
              <GoalDashboard embedded isActive={mobileActiveTab === 'goals'} addGoalTrigger={addGoalTrigger} addProjectTrigger={addProjectTrigger} />
            </div>


            {mobileActiveTab === 'settings' && <MobileSettingsPanel />}
          </div>

          {/* FAB - Floating Action Button (timeline only) */}
          {mobileActiveTab === 'timeline' && (
            <>
              <button
                onClick={() => openNewTaskForm()}
                className="fixed right-4 z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:bg-blue-800 flex items-center justify-center transition-colors"
                style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
              >
                <Plus size={28} />
              </button>
            </>
          )}

          {/* Glance tab FABs - stacked on right: Weekly Review (bottom), Daily Stats (above weekly), Recycle Bin (top) */}
          {mobileActiveTab === 'dayglance' && (
            <>
              {/* Daily Note FAB — bottom-left */}
              <button
                onClick={() => setDailyNotesModalDate(getTodayStr())}
                className={`fixed left-4 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-200 text-stone-600 active:bg-stone-300'}`}
                style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
                title="Today's daily note"
              >
                {obsidianConfig?.enabled ? <BookOpen size={22} /> : <NotebookPen size={22} />}
              </button>
              {/* Daily summary ring FAB */}
              {(() => {
                const pct = actualTodayNonImportedTasks.length > 0 ? Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100) : 0;
                const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
                return (
                  <button
                    onClick={() => setShowMobileDailySummary(true)}
                    className={`fixed right-4 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 active:bg-gray-600' : 'bg-stone-200 active:bg-stone-300'}`}
                    style={{ bottom: 'calc(8.5rem + env(safe-area-inset-bottom, 0px))' }}
                  >
                    <div className="relative w-11 h-11">
                      <svg viewBox="0 0 36 36" className="w-11 h-11 -rotate-90">
                        <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" className={darkMode ? 'stroke-gray-600' : 'stroke-gray-200'} />
                        <circle cx="18" cy="18" r="14" fill="none" strokeWidth="3" strokeLinecap="round" className={ringColor}
                          strokeDasharray={`${(pct / 100) * 87.96} 87.96`}
                        />
                      </svg>
                      <span className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold ${textPrimary}`}>
                        <ChevronUp size={16} />
                      </span>
                    </div>
                  </button>
                );
              })()}
              {/* Weekly review FAB */}
              <button
                onClick={() => {
                  if (showWeeklyReviewReminder) {
                    weeklyReviewDismissedRef.current = lastWeeklyReviewFiredRef.current;
                    localStorage.setItem('day-planner-weekly-review-dismissed', lastWeeklyReviewFiredRef.current);
                    setShowWeeklyReviewReminder(false);
                  }
                  setShowWeeklyReview(true);
                }}
                className={`fixed right-4 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${showWeeklyReviewReminder ? 'bg-blue-600 text-white active:bg-blue-700' : darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-200 text-stone-600 active:bg-stone-300'}`}
                style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
              >
                <BarChart3 size={22} />
              </button>
              {/* Recycle bin FAB */}
              {recycleBin.filter(t => !t.isExample).length > 0 && (
                <button
                  onClick={() => setShowMobileRecycleBin(true)}
                  className={`fixed right-4 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-200 text-stone-600 active:bg-stone-300'}`}
                  style={{ bottom: 'calc(12.5rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  <div className="relative">
                    <Trash2 size={22} />
                    <span className="absolute -top-2 -right-3 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                      {recycleBin.filter(t => !t.isExample).length > 9 ? '9+' : recycleBin.filter(t => !t.isExample).length}
                    </span>
                  </div>
                </button>
              )}
              {/* Habit management FAB */}
              {habitsEnabled && (
                <button
                  onClick={() => setShowHabitModal(true)}
                  className={`fixed right-4 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-200 text-stone-600 active:bg-stone-300'}`}
                  style={{ bottom: `calc(${recycleBin.filter(t => !t.isExample).length > 0 ? '16.5rem' : '12.5rem'} + env(safe-area-inset-bottom, 0px))` }}
                >
                  <Activity size={22} />
                </button>
              )}
            </>
          )}

          {/* Trash FAB — visible during mobile long-press drag */}
          {mobileDragTaskIdState !== null && (
            <div
              ref={trashFabRef}
              className={`fixed left-4 z-50 w-16 h-16 rounded-full shadow-xl flex items-center justify-center transition-all duration-150 ${mobileDragOverTrash ? 'bg-red-600 scale-110' : 'bg-red-500'}`}
              style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
            >
              <Trash2 size={26} className="text-white" />
            </div>
          )}

          <MobileBottomSheets />

          {/* Bottom Tab Bar */}
          <MobileTabBar />
          <InboxFilterPopover
            open={showInboxFilter}
            onClose={() => setShowInboxFilter(false)}
            buttonRef={inboxFilterBtnRef}
          />
        </>
);
};

export default MobileLayout;
