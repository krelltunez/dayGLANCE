import React from 'react';
import {
  Activity, AlertCircle, AlertTriangle, BarChart3, Bell, BookOpen, BrainCircuit,
  Calendar, CalendarDays, Check, CheckCircle, CheckSquare, ChevronDown,
  ChevronLeft, ChevronRight, ChevronUp, Clock, Cloud, ExternalLink,
  Eye, FileText, Filter, Flame, FolderOpen, GripVertical, Hash, HelpCircle,
  Inbox, Key, LayoutGrid, Link, Loader, Menu, Mic, Minus, Moon, MoreHorizontal,
  NotebookPen, Plus, RefreshCw, Save, Search, Settings, SkipForward, Sparkles,
  Sun, Target, Trash2, TrendingUp, Trophy, Undo2, Upload, Volume2, VolumeX,
  Wifi, X, Zap,
} from 'lucide-react';
import { isNativeAndroid, nativeUpdateEvent } from '../native.js';
import { renderTitle, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, renderFormattedText } from '../utils/textFormatting.jsx';
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
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

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
    allTimeFocusMinutes,
    inboxCompletedTodayCount, inboxCompletedTodayMinutes,
    allTimeInboxCompletedCount, allTimeInboxCompletedMinutes,
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
  } = useDayPlannerCtx();

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
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
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
                        onClick={() => { setMobileActiveTab('frames'); setFramesModalTab('schedule'); setEditingFrame(null); }}
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
                      onClick={() => { setHideCompletedInbox(prev => !prev); playUISound('click'); }}
                      className={`${hoverBg} rounded px-1.5 py-1.5 transition-colors`}
                      title={hideCompletedInbox ? 'Completed tasks hidden (click to show)' : 'Showing completed tasks (click to hide)'}
                    >
                      <CheckCircle size={14} className={hideCompletedInbox ? (darkMode ? 'text-gray-500' : 'text-stone-400') : (darkMode ? 'text-blue-400' : 'text-blue-500')} />
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
            {mobileActiveTab === 'frames' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <LayoutGrid size={20} /> Frames
                  </h2>
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
                              <Activity size={14} />
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

                  {/* All-day tasks - inside sticky header group */}
                  {(visibleDates.some(date => getTasksForDate(date).some(t => t.isAllDay && !t.isExample) || getDeadlineTasksForDate(dateToString(date)).some(t => !t.isExample)) || (routinesEnabled && todayRoutines.some(r => r.isAllDay && !String(r.id).startsWith('example-')))) && (
                    <div ref={mobileAllDaySectionRef} className={`border-b ${borderClass} ${cardBg} ${mobileDragPreviewTime === 'all-day' ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
                      <div className="flex">
                        <div className={`w-12 flex-shrink-0 px-2 py-2 text-[10px] font-semibold ${textSecondary} border-r ${borderClass} flex items-start justify-center`}>
                          ALL DAY
                        </div>
                        <div className="flex-1 min-w-0 p-2 space-y-1.5">
                          {visibleDates.map((date) => {
                            const dayTasks = getTasksForDate(date).filter(t => t.isAllDay && !t.isExample).sort((a, b) => {
                              const order = (t) => {
                                if (t.importSource === 'file') return 0;             // ICS downloads
                                if (t.imported && !t.isTaskCalendar) return 1;       // Imported calendar events
                                if (t.isTaskCalendar) return 2;                      // Imported task calendar items
                                if (typeof t.id === 'string' && t.id.startsWith('recurring-')) return 4; // Recurring
                                return 3;                                            // Regular all-day tasks
                              };
                              return order(a) - order(b);
                            });
                            const dateStr = dateToString(date);
                            const deadlineTasks = getDeadlineTasksForDate(dateStr).filter(t => !t.isExample);
                            return (
                              <React.Fragment key={dateStr}>
                                {dayTasks.map((task) => {
                                  const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
                                  const isImported = task.imported;
                                  return (
                                    <div key={task.id} className={`relative ${task.completed && (!isImported || task.isTaskCalendar) ? 'opacity-50' : ''}`} style={(!isImported || !!task.nativeEventId) ? { marginLeft: '12px' } : {}}
                                      data-ctx-menu
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        setTaskContextMenu({
                                          x: e.clientX, y: e.clientY,
                                          taskId: task.id,
                                          isRecurring: !!(typeof task.id === 'string' && task.id.startsWith('recurring-')),
                                          isImported: !!isImported,
                                          isAllDay: true,
                                          dateStr,
                                        });
                                      }}
                                    >
                                      {/* Swipe action strips — outside data-swipe-container so they stay put as content slides */}
                                      {!isImported && (
                                        <>
                                          <div data-swipe-strip="right" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${typeof task.id === 'string' && task.id.startsWith('recurring-') ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                            {typeof task.id === 'string' && task.id.startsWith('recurring-') ? (
                                              <><Trash2 size={14} className="mr-1" />Delete</>
                                            ) : (
                                              <><Inbox size={14} className="mr-1" />Inbox</>
                                            )}
                                          </div>
                                          <div data-swipe-strip="left" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                            Edit<Settings size={14} className="ml-1" />
                                          </div>
                                        </>
                                      )}
                                      {/* Swipe container: drag tab + task card slide together on swipe */}
                                      <div data-swipe-container className="flex items-start">
                                      {/* Protruding drag tab */}
                                      {(!isImported || !!task.nativeEventId) && (
                                        <div
                                          data-drag-handle
                                          className={`relative flex-shrink-0 ${task.nativeCalendarColor ? '' : task.color} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70`}
                                          style={{ marginLeft: '-12px', marginRight: '-8px', marginTop: '3px', width: '20px', height: '24px', touchAction: 'none', zIndex: 10, ...(task.nativeCalendarColor ? { backgroundColor: task.nativeCalendarColor } : {}) }}
                                          onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'allday')}
                                          onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                          onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'allday')}
                                          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        >
                                          <div className="absolute top-0 left-0 h-full rounded-l-lg border-l border-t border-b border-white/20 pointer-events-none" style={{ width: '12px' }} />
                                          <div className="absolute top-0 border-t border-white/20 pointer-events-none" style={{ left: '12px', width: '2px' }} />
                                          <GripVertical size={14} />
                                        </div>
                                      )}
                                      <div className="relative flex-1 min-w-0 rounded-lg overflow-hidden">
                                    <div
                                      data-task-id={task.id}
                                      className={`relative ${task.isTaskCalendar ? '' : task.color} rounded-lg p-2.5 text-white text-sm select-none ${mobileDragTaskIdState === task.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                                      style={{ touchAction: 'pan-y', ...(taskCalendarStyle || {}) }}
                                      onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'allday')}
                                      onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                      onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'allday')}
                                    >
                                      <div className="flex items-center gap-2">
                                        {(!isImported || task.isTaskCalendar) && (
                                          <button
                                            onClick={() => toggleComplete(task.id)}
                                            className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                                          >
                                            {task.completed && <Check size={10} strokeWidth={3} />}
                                          </button>
                                        )}
                                        <Calendar size={14} className="flex-shrink-0" />
                                        <span className={`truncate flex-1 ${task.isTaskCalendar ? 'font-bold' : 'font-medium'} ${task.completed && !isImported ? 'line-through' : ''}`}>
                                          {renderTitle(task.title)}
                                        </span>
                                        {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                          <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                        ))}
                                        {!isImported && (
                                          <>
                                            {typeof task.id === 'string' && task.id.startsWith('recurring-') && (
                                              <RefreshCw size={10} className="flex-shrink-0 opacity-60" />
                                            )}
                                            <button
                                              onMouseDown={() => {
                                                if (isLinkOnlyTask(task)) {
                                                  if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                                  longPressTriggeredRef.current = false;
                                                  longPressTimerRef.current = setTimeout(() => {
                                                    longPressTriggeredRef.current = true;
                                                    setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                                  }, 500);
                                                }
                                              }}
                                              onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                              onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                              onTouchStart={(e) => {
                                                e.stopPropagation();
                                                if (isLinkOnlyTask(task)) {
                                                  if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                                  longPressTriggeredRef.current = false;
                                                  longPressTimerRef.current = setTimeout(() => {
                                                    longPressTriggeredRef.current = true;
                                                    setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                                  }, 500);
                                                }
                                              }}
                                              onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
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
                                              className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0 ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                            >
                                              {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); postponeTask(task.id); }}
                                              className="hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                                            >
                                              <SkipForward size={14} />
                                            </button>
                                          </>
                                        )}
                                        {isImported && !task.isTaskCalendar && task.notes && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                            }}
                                            className="notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                                            title="View description"
                                          >
                                            <FileText size={14} />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    </div>
                                    </div>{/* end data-swipe-container */}
                                    </div>
                                  );
                                })}
                                {deadlineTasks.map((task) => (
                                  <div key={`deadline-${task.id}`} className="relative" style={{ marginLeft: '12px' }}>
                                    {/* Swipe action strips — outside data-swipe-container so they stay put as content slides */}
                                    <div data-swipe-strip="right" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                      <Inbox size={14} className="mr-1" />Inbox
                                    </div>
                                    <div data-swipe-strip="left" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                      Edit<Settings size={14} className="ml-1" />
                                    </div>
                                    {/* Swipe container: drag tab + task card slide together on swipe */}
                                    <div data-swipe-container className={`flex items-start ${task.completed ? 'opacity-50' : 'opacity-90'}`}>
                                    {/* Protruding drag tab */}
                                    <div
                                      data-drag-handle
                                      className={`relative flex-shrink-0 ${task.color} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70`}
                                      style={{ marginLeft: '-12px', marginRight: '-8px', marginTop: '3px', width: '20px', height: '24px', touchAction: 'none', zIndex: 10 }}
                                      onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...task, isDeadlineDrag: true }, 'deadline')}
                                      onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                      onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'deadline')}
                                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    >
                                      <div className="absolute top-0 left-0 h-full rounded-l-lg border-l-2 border-t-2 border-b-2 border-dashed border-white/60 pointer-events-none" style={{ width: '12px' }} />
                                      <div className="absolute top-0 border-t-2 border-dashed border-white/60 pointer-events-none" style={{ left: '12px', width: '2px' }} />
                                      <GripVertical size={14} />
                                    </div>
                                    <div className={`relative flex-1 min-w-0 rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'}`}>
                                  <div
                                    data-task-id={task.id}
                                    data-ctx-menu
                                    className={`relative ${task.color} rounded-lg p-2.5 text-white text-sm select-none border-2 border-dashed border-white/60 ${mobileDragTaskIdState === task.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                                    style={{ touchAction: 'pan-y' }}
                                    onContextMenu={(e) => {
                                      e.preventDefault();
                                      setTaskContextMenu({
                                        x: e.clientX, y: e.clientY,
                                        taskId: task.id,
                                        isRecurring: false,
                                        isImported: false,
                                        isAllDay: true,
                                        dateStr,
                                      });
                                    }}
                                    onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...task, isDeadlineDrag: true }, 'deadline')}
                                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'deadline')}
                                  >
                                    <div className="flex items-center gap-2">
                                      <button
                                        onClick={() => toggleComplete(task.id, true)}
                                        className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                                      >
                                        {task.completed && <Check size={10} strokeWidth={3} />}
                                      </button>
                                      <AlertCircle size={14} className="flex-shrink-0" />
                                      <span className={`truncate flex-1 font-medium ${task.completed ? 'line-through' : ''}`}>{renderTitle(task.title)}</span>
                                      {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                        <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                      ))}
                                      <button
                                        onMouseDown={() => {
                                          if (isLinkOnlyTask(task)) {
                                            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                            longPressTriggeredRef.current = false;
                                            longPressTimerRef.current = setTimeout(() => {
                                              longPressTriggeredRef.current = true;
                                              setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                            }, 500);
                                          }
                                        }}
                                        onMouseUp={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                        onMouseLeave={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
                                        onTouchStart={(e) => {
                                          e.stopPropagation();
                                          if (isLinkOnlyTask(task)) {
                                            if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                            longPressTriggeredRef.current = false;
                                            longPressTimerRef.current = setTimeout(() => {
                                              longPressTriggeredRef.current = true;
                                              setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                            }, 500);
                                          }
                                        }}
                                        onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
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
                                        className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0 ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                      >
                                        {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                      </button>
                                      <button
                                        onClick={(e) => { e.stopPropagation(); postponeDeadlineTask(task.id); }}
                                        className="hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                                        title="Postpone to tomorrow"
                                      >
                                        <SkipForward size={14} />
                                      </button>
                                      <div className="deadline-picker-container relative">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setShowDeadlinePicker(showDeadlinePicker === task.id ? null : task.id);
                                          }}
                                          className="hover:bg-white/20 rounded p-1 transition-colors bg-white/20 flex-shrink-0"
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
                                  </div>{/* end flex-1 content */}
                                  </div>{/* end data-swipe-container */}
                                  </div>
                                ))}
                                {/* Routine pills in all-day (today only) */}
                                {routinesEnabled && dateToString(date) === dateToString(new Date()) && todayRoutines.filter(r => r.isAllDay && !String(r.id).startsWith('example-')).map((routine) => (
                                  <div
                                    key={`routine-${routine.id}`}
                                    className={`rounded-full px-3 py-1 text-xs font-medium inline-block mr-1 mb-1 select-none ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'} ${mobileDragTaskIdState === routine.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                                    style={{ touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' }}
                                    onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true, duration: routine.duration || 15 }, 'allday')}
                                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, routine.id, 'allday')}
                                  >
                                    {routine.name}
                                  </div>
                                ))}
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                  </div>{/* end sticky header group */}

                  {/* Time grid */}
                  <div ref={timeGridRef} className="relative">
                    {hours.map((hour, index) => (
                      <div key={hour} className="relative">
                        <div className={`flex border-b ${index === 0 ? `border-t` : ''} ${borderClass} ${index % 2 === 1 ? (darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50') : ''}`}>
                          <div className={`w-12 flex-shrink-0 px-1 py-1 text-xs ${textSecondary} border-r ${borderClass} text-center ${!darkMode ? 'bg-stone-100/80' : ''}`}>
                            {use24HourClock
                              ? `${hour.toString().padStart(2, '0')}:00`
                              : <>{hour === 0 ? 12 : hour > 12 ? hour - 12 : hour}<span className="text-[9px] ml-0.5">{hour >= 12 ? 'PM' : 'AM'}</span></>
                            }
                          </div>
                          {visibleDates.map((date, idx) => (
                            <div
                              key={dateToString(date)}
                              data-ctx-menu
                              className={`flex-1 relative h-40 calendar-slot ${idx > 0 ? `border-l ${borderClass}` : ''}`}
                              data-date={dateToString(date)}
                              onClick={(e) => {
                                if (e.target.classList.contains('calendar-slot')) {
                                  const time = getTimeFromCursorPosition(e);
                                  setHoverPreviewTime(time);
                                  setHoverPreviewDate(date);
                                }
                              }}
                              onContextMenu={(e) => {
                                if (!e.target.classList.contains('calendar-slot')) return;
                                e.preventDefault();
                                if (!calendarRef.current || !timeGridRef.current) return;
                                const rect = calendarRef.current.getBoundingClientRect();
                                const scrollTop = calendarRef.current.scrollTop;
                                const headerHeight = timeGridRef.current.offsetTop;
                                const y = Math.max(0, e.clientY - rect.top + scrollTop - headerHeight);
                                const minutes = Math.round(positionToMinutes(y) / 15) * 15;
                                setTimelineContextMenu({ x: e.clientX, y: e.clientY, dateStr: dateToString(date), timeMinutes: minutes });
                              }}
                            ></div>
                          ))}
                        </div>
                        {/* Half-hour dashed line */}
                        <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '80px' }}>
                          <div className={`flex border-b border-dashed ${borderClass} opacity-50`}>
                            <div className="w-12 flex-shrink-0"></div>
                            {visibleDates.map((date, idx) => (
                              <div key={dateToString(date)} className={`flex-1 ${idx > 0 ? `border-l ${borderClass}` : ''}`}></div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Task overlays */}
                    <div className="absolute top-0 left-12 right-0 bottom-0 pointer-events-none flex">
                      {visibleDates.map((date, dayIndex) => {
                        const dateStr = dateToString(date);
                        const isDateToday = dateStr === dateToString(new Date());
                        const dayTasks = getTasksForDate(date).filter(t => !t.isAllDay && !t.isExample);
                        const frameInstances = getFrameInstancesForDate(date);

                        return (
                          <div
                            key={dateStr}
                            data-date-column={dateStr}
                            className={`flex-1 relative ${dayIndex > 0 ? `border-l ${borderClass}` : ''}`}
                          >
                            {/* GTD Frame background zones */}
                            {frameInstances.map(frame => {
                              const frameStartMin = timeToMinutes(frame.start);
                              const frameEndMin = timeToMinutes(frame.end);
                              const top = Math.round(minutesToPosition(frameStartMin));
                              const bottom = Math.round(minutesToPosition(frameEndMin));
                              const height = bottom - top;
                              const colorMap = darkMode ? {
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
                              const borderColorMap = darkMode ? {
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
                              const availableSlots = computeAvailableSlots(frame, date);
                              return (
                                <div key={frame.frameId}>
                                  <div
                                    data-ctx-menu
                                    className="absolute left-0 right-0 rounded-sm pointer-events-auto select-none"
                                    style={{
                                      top: `${top}px`,
                                      height: `${height}px`,
                                      background: colorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.08)' : 'rgba(165,180,252,0.18)'),
                                      borderLeft: `2px solid ${borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)')}`,
                                    }}
                                    onContextMenu={(e) => { e.preventDefault(); setFrameContextMenu({ x: e.clientX, y: e.clientY, frameId: frame.frameId, dateStr }); }}
                                    onDragOver={(e) => handleDragOver(e, date)}
                                    onDrop={(e) => handleDropOnCalendar(e, date)}
                                    onMouseMove={(e) => handleCalendarMouseMove(e, date, true)}
                                    onMouseLeave={handleCalendarMouseLeave}
                                    onClick={(e) => openNewTaskAtTime(e, date, true)}
                                  >
                                    <span className="absolute top-0.5 left-1 text-[9px] font-medium pointer-events-none select-none" style={{ color: borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)') }}>
                                      {frame.label}
                                    </span>
                                  </div>
                                  {/* Dashed outlines for available slots */}
                                  {availableSlots.map((slot, si) => {
                                    const slotTop = Math.round(minutesToPosition(timeToMinutes(slot.start)));
                                    const slotBottom = Math.round(minutesToPosition(timeToMinutes(slot.end)));
                                    const slotHeight = slotBottom - slotTop;
                                    if (slotHeight < 4) return null;
                                    return (
                                      <div
                                        key={`avail-${frame.frameId}-${si}`}
                                        className="absolute left-0.5 right-0.5 rounded pointer-events-none"
                                        style={{
                                          top: `${slotTop}px`,
                                          height: `${slotHeight}px`,
                                          border: `1.5px dashed ${borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)')}`,
                                          opacity: 0.5,
                                        }}
                                      />
                                    );
                                  })}
                                </div>
                              );
                            })}

                            {/* Current time line */}
                            {isDateToday && (
                              <div
                                className="absolute left-0 right-0 pointer-events-none z-10"
                                style={{ top: `${currentTimeTop}px` }}
                              >
                                <div className="flex items-center">
                                  <div className="w-2 h-2 bg-red-500 rounded-full -ml-1"></div>
                                  <div className="flex-1 h-0.5 bg-red-500"></div>
                                </div>
                              </div>
                            )}

                            {/* Mobile drag time preview */}
                            {mobileDragPreviewTime && mobileDragPreviewTime !== 'all-day' && (!mobileDragPreviewDate || mobileDragPreviewDate === dateStr) && (() => {
                              const dragMinutes = timeToMinutes(mobileDragPreviewTime);
                              const dragTop = Math.round(minutesToPosition(dragMinutes));
                              return (
                                <div
                                  className="absolute left-0 right-0 pointer-events-none z-20"
                                  style={{ top: `${dragTop}px` }}
                                >
                                  <div className="relative">
                                    <div className={`absolute bottom-0.5 right-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${darkMode ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white'}`}>
                                      {formatTime(mobileDragPreviewTime)}
                                    </div>
                                    <div className="h-0.5 bg-blue-500"></div>
                                  </div>
                                </div>
                              );
                            })()}

                            {/* Hover preview line - shows selected time for new task via FAB */}
                            {hoverPreviewTime && !draggedTask && hoverPreviewDate && dateToString(hoverPreviewDate) === dateStr && (
                              <div
                                className="absolute left-0 right-0 pointer-events-none z-30"
                                style={{
                                  top: `${minutesToPosition(timeToMinutes(hoverPreviewTime))}px`
                                }}
                              >
                                <div className="absolute left-0 right-12 h-0.5 bg-blue-400/60"></div>
                                <div className="absolute right-1 bg-blue-500/80 text-white text-xs px-1.5 py-0.5 rounded -translate-y-1/2">
                                  {formatTime(hoverPreviewTime)}
                                </div>
                              </div>
                            )}

                            {/* Task blocks */}
                            {dayTasks.map(task => {
                              const { top, height } = calculateTaskPosition(task);
                              const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
                              const mobileCalendarStyle = taskCalendarStyle;
                              const isRecurring = typeof task.id === 'string' && task.id.startsWith('recurring-');
                              const isImported = task.imported;
                              const isCalendarEvent = task.imported && !task.isTaskCalendar;
                              const isPastEvent = isCalendarEvent && isDateToday && (timeToMinutes(task.startTime) + task.duration) <= (new Date().getHours() * 60 + new Date().getMinutes());
                              const _nowMin = new Date().getHours() * 60 + new Date().getMinutes();
                              const _taskStart = timeToMinutes(task.startTime || '0:00');
                              const isCurrentTask = isDateToday && !task.isAllDay && !task.completed && !isCalendarEvent && _nowMin >= _taskStart && _nowMin < _taskStart + (task.duration || 0);
                              const isConflicted = !task.isAllDay && dayTasks.some(other => {
                                if (other.id === task.id || other.isAllDay || other.completed) return false;
                                const s1 = timeToMinutes(task.startTime), e1 = s1 + task.duration;
                                const s2 = timeToMinutes(other.startTime), e2 = s2 + other.duration;
                                return s1 < e2 && e1 > s2;
                              });
                              const conflictPos = calculateConflictPosition(task, dayTasks);

                              // Layout tiers (matching desktop logic)
                              const isMicroHeight = height <= 40;
                              const taskWidth = taskWidths[task.id];
                              const isMeasured = taskWidth !== undefined;
                              const isNarrowWidth = taskWidth < 180;

                              // Mobile action buttons component
                              const MobileActionButtons = ({ inMenu = false }) => (
                                <>
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
                                    onTouchStart={(e) => {
                                      e.stopPropagation();
                                      if (isLinkOnlyTask(task)) {
                                        longPressTriggeredRef.current = false;
                                        longPressTimerRef.current = setTimeout(() => {
                                          longPressTriggeredRef.current = true;
                                          setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                        }, 500);
                                      }
                                    }}
                                    onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
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
                                    className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) ? '' : 'opacity-40'}`}
                                  >
                                    {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                    {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                                  </button>
                                  {!(typeof task.id === 'string' && task.id.startsWith('recurring-')) && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); postponeTask(task.id); }}
                                      className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    >
                                      <SkipForward size={14} />
                                      {inMenu && <span className="text-xs">Postpone</span>}
                                    </button>
                                  )}
                                </>
                              );

                              return (
                                <div
                                  key={task.id}
                                  ref={setTaskRef(task.id)}
                                  data-task-id={task.id}
                                  data-ctx-menu
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    setTaskContextMenu({
                                      x: e.clientX, y: e.clientY,
                                      taskId: task.id,
                                      isRecurring: !!isRecurring,
                                      isImported: !!isImported,
                                      isAllDay: !!task.isAllDay,
                                      dateStr,
                                    });
                                  }}
                                  className={`absolute pointer-events-auto ${(task.completed && (!isImported || task.isTaskCalendar)) || isPastEvent ? 'opacity-50' : ''} ${mobileDragTaskIdState === task.id ? 'scale-105 shadow-2xl z-40' : ''} ${isCurrentTask ? 'current-task-pulse' : ''}`}
                                  style={{
                                    top: `${top}px`,
                                    height: `${height}px`,
                                    minHeight: isMicroHeight ? '27px' : '39px',
                                    left: conflictPos.left,
                                    right: conflictPos.right,
                                    width: conflictPos.width,
                                    visibility: isMeasured ? 'visible' : 'hidden',
                                    transition: mobileDragTaskIdState === task.id ? 'transform 0.15s, box-shadow 0.15s' : undefined,
                                  }}
                                >
                                  {/* Swipe action strips - outside flex wrapper so they stay stationary */}
                                  {(!task.imported || !!task.nativeEventId) && (
                                    <>
                                      {!task.imported && (
                                        <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${typeof task.id === 'string' && task.id.startsWith('recurring-') ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                          {typeof task.id === 'string' && task.id.startsWith('recurring-') ? (
                                            <><Trash2 size={14} className="mr-1" />Delete</>
                                          ) : (
                                            <><Inbox size={14} className="mr-1" />Inbox</>
                                          )}
                                        </div>
                                      )}
                                      <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                        Edit<Settings size={14} className="ml-1" />
                                      </div>
                                    </>
                                  )}
                                  <div data-swipe-container className="flex h-full items-start">
                                  {/* Protruding drag tab — shown for own tasks, task-calendar items, and native calendar events */}
                                  {(!isImported || task.isTaskCalendar || !!task.nativeEventId) && (
                                    <div
                                      data-drag-handle
                                      className={`${task.isTaskCalendar ? '' : task.color || ''} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70 flex-shrink-0 relative`}
                                      style={{ width: '20px', height: '24px', marginTop: '3px', marginRight: '-8px', touchAction: 'none', zIndex: 10, ...(task.isTaskCalendar ? { backgroundColor: darkMode ? '#4b5563' : '#6b7280' } : !task.color && task.nativeCalendarColor ? { backgroundColor: task.nativeCalendarColor } : {}) }}
                                      onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'timeline')}
                                      onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                      onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'timeline')}
                                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    >
                                      <div className="absolute top-0 left-0 h-full rounded-l-lg border-l border-t border-b border-white/20 pointer-events-none" style={{ width: '12px' }} />
                                      <div className="absolute top-0 border-t border-white/20 pointer-events-none" style={{ left: '12px', width: '2px' }} />
                                      <GripVertical size={14} />
                                    </div>
                                  )}
                                  <div className={`flex-1 min-w-0 h-full rounded-lg ${expandedTaskMenu === task.id ? 'overflow-visible z-30' : 'overflow-hidden'}`}>
                                  {/* Task content with swipe + drag touch handlers */}
                                  <div
                                    className={`relative h-full select-none ${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-sm ${task.isTaskCalendar ? '' : 'border border-white/20'}`}
                                    style={{ touchAction: 'pan-y', ...mobileCalendarStyle }}
                                    onTouchStart={(e) => handleMobileTaskTouchStart(e, task, 'timeline')}
                                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'timeline')}
                                  >
                                  {/* Flex wrapper: content fills full width */}
                                  <div className="flex h-full">
                                  <div className="flex-1 min-w-0 h-full">
                                  {isCalendarEvent ? (
                                    <div className="h-full px-2 py-1 flex flex-col justify-start text-white overflow-hidden">
                                      <div className="flex items-start gap-1 min-w-0">
                                        <span className="text-sm font-semibold truncate flex-1 min-w-0 leading-tight">
                                          {renderTitle(task.title)}
                                        </span>
                                        <div className="flex items-center gap-0.5 flex-shrink-0 mt-0.5">
                                          {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                            <button key={i} className="text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                          ))}
                                          {(task.notes) && (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                              }}
                                              className="notes-toggle-button hover:bg-white/20 rounded p-0.5 transition-colors"
                                              title="View/edit description"
                                            >
                                              <FileText size={11} />
                                            </button>
                                          )}
                                          {!isNarrowWidth && (
                                            <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1 ml-1">
                                              <Clock size={10} />
                                              {formatTime(task.startTime)} • {task.duration}m
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      {height > 42 && (task.calendarName || task.location) && (
                                        <div className="flex flex-col mt-0.5 text-white/75 text-[10px]">
                                          {task.calendarName && <span className="truncate">{task.calendarName}</span>}
                                          {task.location && <span className="truncate">{task.location}</span>}
                                        </div>
                                      )}
                                    </div>
                                  ) : isImported ? (
                                    <div className="h-full px-2 py-1.5 flex items-start gap-1.5 text-white">
                                      <button
                                        onClick={() => toggleComplete(task.id)}
                                        className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-3.5 h-3.5 flex items-center justify-center`}
                                      >
                                        {task.completed && <Check size={8} strokeWidth={3} />}
                                      </button>
                                      <span className={`text-sm font-bold truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''}`}>
                                        {renderTitle(task.title)}
                                      </span>
                                      {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                        <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                      ))}
                                      {!isNarrowWidth && (
                                        <div className="text-xs opacity-90 whitespace-nowrap flex-shrink-0 flex items-center gap-1">
                                          <Clock size={10} />
                                          {formatTime(task.startTime)} • {task.duration}m
                                        </div>
                                      )}
                                    </div>
                                  ) : isNarrowWidth ? (
                                    /* NARROW: overflow menu + checkbox + title */
                                    <div className="h-full px-2 py-1 flex flex-col text-white">
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container absolute top-0.5 right-0.5 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-stone-300 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <MobileActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                      <div className="flex items-center gap-1 pr-6">
                                        <button
                                          onClick={() => toggleComplete(task.id)}
                                          className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                                        >
                                          {task.completed && <Check size={10} strokeWidth={3} />}
                                        </button>
                                        {isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-60" />}
                                        <span className={`text-sm font-medium truncate ${task.completed ? 'line-through' : ''}`}>
                                          {renderTitle(task.title)}
                                        </span>
                                        {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                          <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                        ))}
                                      </div>
                                      {height >= 55 && (
                                        <div className="text-xs text-white/70 mt-0.5">
                                          {formatTime(task.startTime)} · {task.duration}m
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    /* WIDE: checkbox + title + action buttons + time row */
                                    <div className="h-full px-2 py-1 flex flex-col text-white">
                                      <div className="flex items-center justify-between gap-1">
                                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                          <button
                                            onClick={() => toggleComplete(task.id)}
                                            className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center`}
                                          >
                                            {task.completed && <Check size={10} strokeWidth={3} />}
                                          </button>
                                          {isRecurring && <RefreshCw size={10} className="flex-shrink-0 opacity-60" />}
                                          <span className={`text-sm font-medium truncate ${task.completed ? 'line-through' : ''}`}>
                                            {renderTitle(task.title)}
                                          </span>
                                          {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                            <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                          ))}
                                        </div>
                                        <div className="flex items-center gap-0.5 flex-shrink-0">
                                          <MobileActionButtons />
                                        </div>
                                      </div>
                                      {height >= 55 && (
                                        <div className="text-xs text-white/70 mt-0.5">
                                          {formatTime(task.startTime)} · {task.duration}m
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  </div>{/* end content */}
                                  </div>{/* end flex wrapper */}
                                  </div>{/* end swipe content */}
                                  </div>{/* end inner overflow container */}
                                  </div>{/* end data-swipe-container flex */}
                                  {/* Touch resize handle at bottom */}
                                  {(!isImported || (isCalendarEvent && task.nativeEventId)) && (
                                    <div
                                      onTouchStart={(e) => handleTouchResizeStart(task, e)}
                                      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                      className="absolute bottom-0 left-1/3 right-1/3 h-3 hover:bg-white/20 active:bg-white/20 flex items-center justify-center select-none"
                                      style={{ marginBottom: '-4px', touchAction: 'none', zIndex: 10, WebkitTouchCallout: 'none' }}
                                    >
                                      <div className="w-12 h-1 bg-white rounded-full"></div>
                                    </div>
                                  )}
                                  {/* Editable notes panel for mobile timeline imported events (not calendar events — they use the bottom sheet) */}
                                  {expandedNotesTaskId === task.id && isImported && !isCalendarEvent && (() => {
                                    const startMin = timeToMinutes(task.startTime || '0:00');
                                    const endMin = startMin + (task.duration || 0);
                                    const showAbove = endMin >= 22 * 60;
                                    return (
                                      <div
                                        className="notes-panel-container absolute left-0 right-0 z-40"
                                        style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
                                          <div className={`p-3 rounded-lg ${darkMode ? 'bg-black/30' : 'bg-white/30'} text-white`}>
                                            <div className="text-xs font-semibold opacity-75 mb-1">Description</div>
                                            <textarea
                                              defaultValue={task.notes || ''}
                                              placeholder="Add description…"
                                              rows={3}
                                              className="w-full text-sm p-2 rounded bg-white/10 text-white placeholder:text-white/40 resize-y focus:outline-none focus:bg-white/20"
                                              onBlur={async (e) => {
                                                const newNotes = e.target.value;
                                                if (newNotes === (task.notes || '')) return;
                                                setTasks(prev => prev.map(t => t.id === task.id ? { ...t, notes: newNotes } : t));
                                                if (isNativeAndroid() && task.nativeEventId) {
                                                  await nativeUpdateEvent({
                                                    id: task.nativeEventId,
                                                    title: task.title,
                                                    start: `${task.date}T${task.startTime}:00`,
                                                    end: `${task.date}T${minutesToTime(timeToMinutes(task.startTime || '0:00') + (task.duration || 0))}:00`,
                                                    allDay: false,
                                                    notes: newNotes,
                                                    location: task.location || '',
                                                  });
                                                }
                                              }}
                                            />
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })()}
                                </div>
                                );
                              })}

                            {/* Timeline routine pills (today only) */}
                            {routinesEnabled && dateStr === dateToString(new Date()) && (() => {
                              const timelineRoutines = todayRoutines.filter(r => !r.isAllDay && r.startTime && !String(r.id).startsWith('example-'));
                              if (timelineRoutines.length === 0) return null;

                              // Compute side-by-side columns for overlapping routine chips
                              const routineColumns = [];
                              const sorted = [...timelineRoutines].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
                              sorted.forEach(r => {
                                const rStart = timeToMinutes(r.startTime);
                                let placed = false;
                                for (let c = 0; c < routineColumns.length; c++) {
                                  const lastInCol = routineColumns[c][routineColumns[c].length - 1];
                                  if (timeToMinutes(lastInCol.startTime) + lastInCol.duration <= rStart) {
                                    routineColumns[c].push(r);
                                    placed = true;
                                    break;
                                  }
                                }
                                if (!placed) routineColumns.push([r]);
                              });
                              const colMap = {};
                              routineColumns.forEach((col, ci) => col.forEach(r => { colMap[r.id] = ci; }));
                              const overlapCount = {};
                              timelineRoutines.forEach(r => {
                                const rStart = timeToMinutes(r.startTime);
                                const rEnd = rStart + r.duration;
                                // Collect event points: r's own start + starts of any routine beginning within r's span
                                const eventPoints = new Set([rStart]);
                                timelineRoutines.forEach(other => {
                                  const oStart = timeToMinutes(other.startTime);
                                  if (oStart > rStart && oStart < rEnd) eventPoints.add(oStart);
                                });
                                // Max simultaneous active routines at any event point
                                let maxCols = 0;
                                eventPoints.forEach(t => {
                                  let count = 0;
                                  timelineRoutines.forEach(other => {
                                    const oStart = timeToMinutes(other.startTime);
                                    const oEnd = oStart + other.duration;
                                    if (oStart <= t && oEnd > t) count++;
                                  });
                                  maxCols = Math.max(maxCols, count);
                                });
                                overlapCount[r.id] = maxCols;
                              });

                              const now = new Date();
                              const nowMinutes = now.getHours() * 60 + now.getMinutes();

                              return timelineRoutines.map(routine => {
                                const { top: rTop, height: rHeight } = calculateTaskPosition(routine);
                                const colIdx = colMap[routine.id];
                                const cols = overlapCount[routine.id];
                                const widthPercent = cols > 1 ? `${100 / cols}%` : '100%';
                                const leftPercent = cols > 1 ? `${(colIdx * 100) / cols}%` : '0%';
                                const endMinutes = timeToMinutes(routine.startTime) + routine.duration;
                                const isPast = endMinutes <= nowMinutes;

                                return (
                                  <div
                                    key={`routine-tl-${routine.id}`}
                                    className={`absolute pointer-events-auto select-none flex items-center justify-center ${isPast ? 'opacity-50' : ''} ${mobileDragTaskIdState === routine.id ? 'scale-105 shadow-2xl z-40' : ''}`}
                                    style={{
                                      touchAction: 'none',
                                      WebkitTouchCallout: 'none',
                                      WebkitUserSelect: 'none',
                                      top: `${rTop}px`,
                                      height: `${Math.max(rHeight, 27)}px`,
                                      left: `calc(${leftPercent} + 4px)`,
                                      width: `calc(${widthPercent} - 8px)`,
                                    }}
                                    onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true }, 'timeline')}
                                    onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                    onTouchEnd={(e) => handleMobileTaskTouchEnd(e, routine.id, 'timeline')}
                                  >
                                    <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                                    <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                                    <span className={`relative rounded-full px-3 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'}`}>{routine.name}</span>
                                    {/* Touch resize handle at bottom */}
                                    <div
                                      onTouchStart={(e) => handleTouchRoutineResizeStart(routine, e)}
                                      className="absolute bottom-0 left-1/3 right-1/3 h-3 hover:bg-white/20 active:bg-white/20 flex items-center justify-center select-none"
                                      style={{ marginBottom: '-4px', touchAction: 'none', zIndex: 10, WebkitTouchCallout: 'none' }}
                                    >
                                      <div className="w-12 h-1 bg-white rounded-full"></div>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        );
                      })}
                    </div>
                  </div>
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
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {mobileActiveTab === 'dayglance' && (
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
                          onClick={generateMorningSummary}
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
                          onClick={() => { setMobileActiveTab('frames'); setFramesModalTab('schedule'); }}
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
                        <button onClick={generateEveningReflection} className={`p-1 rounded transition-colors ${darkMode ? 'hover:bg-white/10' : 'hover:bg-black/5'}`} title="Regenerate">
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
                {/* Habit rings row */}
                {habitsEnabled && activeHabits.length > 0 && (
                  <div className="mb-4 relative">
                    <div className="flex items-start gap-1 justify-center">
                      {activeHabits.slice(0, 5).map((habit, habitIdx) => (
                        <div key={habit.id} className="relative">
                          <HabitRing
                            size={44}
                            habit={habit}
                            count={getTodayHabitCount(habit.id)}
                            darkMode={darkMode}
                            autoSynced={!!habit.source}
                            onClick={habit.source ? undefined : () => incrementHabit(habit.id)}
                            onContextMenu={habit.source ? undefined : (e) => { e.preventDefault(); setHabitLongPressId(prev => prev === habit.id ? null : habit.id); setHabitEditingCountId(null); }}
                            onMouseDown={habit.source ? undefined : () => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); habitLongPressTimer.current = setTimeout(() => { setHabitLongPressId(prev => prev === habit.id ? null : habit.id); setHabitEditingCountId(null); }, 500); }}
                            onMouseUp={habit.source ? undefined : () => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
                            onMouseLeave={habit.source ? undefined : () => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
                            onTouchStart={habit.source ? undefined : () => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); habitLongPressTimer.current = setTimeout(() => { setHabitLongPressId(prev => prev === habit.id ? null : habit.id); setHabitEditingCountId(null); }, 500); }}
                            onTouchEnd={habit.source ? undefined : () => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
                          />
                          {habitLongPressId === habit.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => { setHabitLongPressId(null); setHabitEditingCountId(null); }} />
                              <div className={`absolute top-full mt-1 z-50 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'} border rounded-xl shadow-xl p-3 min-w-[140px] ${habitIdx === 0 ? 'left-0' : habitIdx === Math.min(activeHabits.length, 5) - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'}`}>
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
                      {activeHabits.length > 5 && (
                        <div className="relative">
                          <button
                            onClick={() => setHabitOverflowOpen(prev => !prev)}
                            className={`w-[52px] h-[44px] flex items-center justify-center rounded-lg text-xs font-bold ${darkMode ? 'bg-gray-700 text-gray-400 active:bg-gray-600' : 'bg-stone-100 text-stone-500 active:bg-stone-200'} transition-colors`}
                          >
                            +{activeHabits.length - 5}
                          </button>
                          {habitOverflowOpen && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setHabitOverflowOpen(false)} />
                              <div className={`absolute top-full right-0 mt-1 z-50 ${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-stone-200'} border rounded-xl shadow-xl p-2 min-w-[180px]`}>
                                {activeHabits.slice(5).map(habit => {
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
                                  <button
                                    onClick={() => toggleComplete(task.id, false)}
                                    className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} active:scale-95 transition-transform`}
                                    title="Mark complete"
                                  >
                                    <CheckCircle size={14} />
                                  </button>
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
                            {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                              <button key={i} className="flex-shrink-0 text-purple-400 active:text-purple-300"
                                onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }}
                                title={`Open "${note}" in Obsidian`}>
                                <NotebookPen size={14} />
                              </button>
                            ))}
                            {hasNotesOrSubtasks(task) && (
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
                                onTouchStart={(e) => {
                                  e.stopPropagation();
                                  if (isLinkOnlyTask(task)) {
                                    longPressTriggeredRef.current = false;
                                    longPressTimerRef.current = setTimeout(() => {
                                      longPressTriggeredRef.current = true;
                                      setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                    }, 500);
                                  }
                                }}
                                onTouchEnd={() => { if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current); }}
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
                                className={`notes-toggle-button flex-shrink-0 rounded p-1.5 transition-colors ${darkMode ? 'hover:bg-white/20 text-gray-400' : 'hover:bg-black/10 text-stone-500'}`}
                                title={isLinkOnlyTask(task) ? getLinkUrl(task) : "Notes & subtasks"}
                              >
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                              </button>
                            )}
                          </div>
                          <div className={`text-sm ${textSecondary} flex items-center gap-1 whitespace-nowrap`}>
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
                        </div>
                        {(relativeLabel === 'Overdue' || (task._agendaType === 'allday' && !task.imported)) && !task.completed && (
                          <div className="flex items-center gap-1 flex-shrink-0 mr-5">
                            {!task.isRecurring && (
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
                  return (
                    <div className={`mt-3 pt-3 border-t ${borderClass}`}>
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
                {routinesEnabled && todayRoutines.length > 0 && (() => {
                  const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
                  const visibleRoutines = todayRoutines.filter(r => {
                    if (String(r.id).startsWith('example-')) return false;
                    if (!r.startTime || r.isAllDay) return true;
                    return (timeToMinutes(r.startTime) + r.duration + 60) > nowMin;
                  });
                  if (visibleRoutines.length === 0) return null;
                  return (
                    <div className={`mt-3 pt-3 border-t ${borderClass} cursor-pointer`} onClick={() => {
                      setMobileActiveTab('routines');
                      setMobileSettingsView('main');
                      setDashboardSelectedChips(todayRoutines.map(r => ({ id: r.id, name: r.name, bucket: r.bucket, startTime: r.startTime || null })));
                      setRoutineAddingToBucket(null);
                      setRoutineNewChipName('');
                    }}>
                      <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textSecondary}`}>Routines</div>
                      <div className="flex flex-wrap gap-1.5">
                        {[...visibleRoutines].sort((a, b) => {
                          if (a.isAllDay && !b.isAllDay) return -1;
                          if (!a.isAllDay && b.isAllDay) return 1;
                          if (a.startTime && b.startTime) return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
                          return 0;
                        }).map(r => {
                          let timeLabel = '';
                          if (!r.isAllDay && r.startTime) {
                            if (use24HourClock) {
                              timeLabel = r.startTime;
                            } else {
                              const [h, m] = r.startTime.split(':').map(Number);
                              const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                              const ampm = h < 12 ? 'a' : 'p';
                              timeLabel = m === 0 ? `${hour12}${ampm}` : `${hour12}:${String(m).padStart(2, '0')}${ampm}`;
                            }
                          }
                          return (
                            <span key={r.id} className={`rounded-full px-2.5 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}>
                              {timeLabel && <span className="opacity-70 mr-1">{timeLabel}</span>}{r.name}
                            </span>
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
                          <div className={`font-medium ${textPrimary} truncate flex-1`}>{agendaTask.title}</div>
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
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
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
                                  <div className="text-xs opacity-90 mt-1 flex items-center gap-2">
                                    <span>{task.duration} min</span>
                                    {task.deadline && (
                                      <span className="flex items-center gap-1">
                                        <AlertCircle size={10} />
                                        {formatDeadlineDate(task.deadline)}
                                      </span>
                                    )}
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
                                  {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
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
                            <div className="flex justify-end mt-1.5">
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
                  );
                })()}
              </div>
            )}

            {mobileActiveTab === 'routines' && <MobileRoutinesTab />}

            {mobileActiveTab === 'frames' && (
              <div className={`px-4 py-4 mobile-tab-fade-in flex-1 min-h-0 overflow-y-auto`}>
                {/* Tab switcher — only show when AI scheduling is enabled */}
                {aiConfig?.enabled && aiConfig.features?.smartScheduling && (
                <div className={`flex rounded-lg ${darkMode ? 'bg-gray-800' : 'bg-stone-200'} p-0.5 mb-4`}>
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
                        isTablet={isTablet}
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

          {/* Mobile Recycle Bin Bottom Sheet */}
          {showMobileRecycleBin && (
            <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileRecycleBin(false)}>
              <div className="bg-black/30 absolute inset-0" />
              <div
                className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[70vh] flex flex-col`}
                style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`} />
                </div>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Trash2 size={18} className={textSecondary} />
                    <span className={`font-semibold ${textPrimary}`}>Recycle Bin</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-stone-200 text-stone-500'}`}>
                      {recycleBin.filter(t => !t.isExample).length}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {recycleBin.filter(t => !t.isExample).length > 0 && (
                      <button
                        onClick={emptyRecycleBin}
                        className="text-xs text-red-500 font-medium px-2 py-1 rounded-lg hover:bg-red-500/5 active:bg-red-500/10 dark:hover:bg-red-500/10 dark:active:bg-red-500/20 transition-colors"
                      >
                        Empty All
                      </button>
                    )}
                    <button
                      onClick={() => setShowMobileRecycleBin(false)}
                      className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`}
                      aria-label="Close recycle bin"
                    >
                      <X size={16} className={textSecondary} />
                    </button>
                  </div>
                </div>
                {/* Task list */}
                <div className="overflow-y-auto px-4 pb-2 space-y-2">
                  {recycleBin.filter(t => !t.isExample).length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center py-8`}>Recycle bin is empty</p>
                  ) : (
                    recycleBin.filter(t => !t.isExample).map(task => (
                      <div
                        key={`mobile-bin-${task.id}`}
                        className={`${task.color} rounded-lg p-3 opacity-60`}
                      >
                        <div className="flex items-start justify-between text-white">
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{renderTitle(task.title)}</div>
                            <div className="text-xs opacity-75 mt-1">
                              {task._deletedFrom === 'inbox' ? (
                                <>Inbox • {task.duration}min</>
                              ) : task.startTime ? (
                                <>{formatTime(task.startTime)} • {task.duration}min</>
                              ) : (
                                <>{task.duration}min</>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => { undeleteTask(task.id); if (recycleBin.filter(t => !t.isExample).length <= 1) setShowMobileRecycleBin(false); }}
                              className="bg-white/20 rounded-lg p-1.5 hover:bg-white/25 active:bg-white/30 transition-colors"
                              title="Restore"
                            >
                              <Undo2 size={14} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Tag Filter Bottom Sheet */}
          {showMobileTagFilter && (
            <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileTagFilter(false)}>
              <div className="bg-black/30 absolute inset-0" />
              <div
                className={`relative ${cardBg} rounded-t-2xl shadow-xl`}
                style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`} />
                </div>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Filter size={18} className={textSecondary} />
                    <span className={`font-semibold ${textPrimary}`}>Filter by Tag</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {allTags.every(tag => selectedTags.includes(tag)) ? (
                      <button
                        onClick={clearTagFilter}
                        className="text-sm text-blue-500 hover:text-blue-600 active:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 font-medium transition-colors"
                      >
                        Clear
                      </button>
                    ) : (
                      <button
                        onClick={selectAllTags}
                        className="text-sm text-blue-500 hover:text-blue-600 active:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 dark:active:text-blue-200 font-medium transition-colors"
                      >
                        Select All
                      </button>
                    )}
                    <button
                      onClick={() => setShowMobileTagFilter(false)}
                      className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`}
                      aria-label="Close tag filter"
                    >
                      <X size={16} className={textSecondary} />
                    </button>
                  </div>
                </div>
                {/* Tag list */}
                <div className="px-4 pb-4 space-y-1 max-h-[50vh] overflow-y-auto">
                  {(() => {
                    const visibleDateStrs = new Set(visibleDates.map(d => dateToString(d)));
                    const tagCounts = {};
                    for (const t of tasks) {
                      if (t.imported || !visibleDateStrs.has(t.date)) continue;
                      for (const tag of extractTags(t.title)) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                    }
                    for (const t of expandedRecurringTasks) {
                      if (!visibleDateStrs.has(t.date)) continue;
                      for (const tag of extractTags(t.title)) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
                    }
                    return allTags.map(tag => {
                    const tagCount = tagCounts[tag] || 0;
                    return (
                      <button
                        key={tag}
                        onClick={() => toggleTag(tag)}
                        className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors ${
                          tagCount === 0 ? 'opacity-40' : ''
                        } ${
                          selectedTags.includes(tag)
                            ? darkMode ? 'bg-blue-500/20' : 'bg-blue-50'
                            : darkMode ? 'active:bg-white/5' : 'active:bg-stone-50'
                        }`}
                      >
                        <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                          selectedTags.includes(tag)
                            ? 'bg-blue-500 border-blue-500'
                            : darkMode ? 'border-gray-600' : 'border-stone-300'
                        }`}>
                          {selectedTags.includes(tag) && <Check size={14} className="text-white" />}
                        </div>
                        <Hash size={14} className={textSecondary} />
                        <span className={`flex-1 text-left text-sm ${textPrimary}`}>{tag}</span>
                        {tagCount > 0 && <span className={`text-xs ${textSecondary} tabular-nums`}>{tagCount}</span>}
                      </button>
                    );
                  });
                  })()}
                </div>
              </div>
            </div>
          )}

          {/* Mobile Daily Summary Bottom Sheet */}
          {showMobileDailySummary && (
            <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={() => setShowMobileDailySummary(false)}>
              <div className="bg-black/30 absolute inset-0" />
              <div
                className={`relative ${cardBg} rounded-t-2xl shadow-xl`}
                style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`} />
                </div>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={18} className={textSecondary} />
                    <span className={`font-semibold ${textPrimary}`}>Daily Summary</span>
                  </div>
                  <button
                    onClick={() => setShowMobileDailySummary(false)}
                    className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`}
                    aria-label="Close daily summary"
                  >
                    <X size={16} className={textSecondary} />
                  </button>
                </div>
                {/* Stats */}
                <div className="px-4 pb-4">
                  {actualTodayNonImportedTasks.length === 0 ? (
                    <p className={`text-sm ${textSecondary} text-center py-4`}>No tasks scheduled for today</p>
                  ) : (() => {
                    const pct = Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100);
                    const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
                    return (
                    <>
                      {/* Progress ring + headline */}
                      <div className="flex items-center gap-4 mb-4">
                        <div className="relative w-16 h-16 flex-shrink-0">
                          <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className={darkMode ? 'stroke-gray-700' : 'stroke-gray-200'} />
                            <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round" className={ringColor}
                              strokeDasharray={`${(pct / 100) * 97.4} 97.4`}
                            />
                          </svg>
                          <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${textPrimary}`}>
                            {pct}%
                          </span>
                        </div>
                        <div>
                          <div className={`text-lg font-bold ${textPrimary}`}>{actualTodayCompletedTasks.length} of {actualTodayNonImportedTasks.length} done</div>
                          {todayIncompleteTasks.length > 0 && (
                            <button
                              onClick={() => { setShowIncompleteTasks('today'); setShowMobileDailySummary(false); }}
                              className="text-sm text-blue-500 active:text-blue-600"
                            >
                              {todayIncompleteTasks.length} incomplete
                            </button>
                          )}
                          {inboxCompletedTodayCount > 0 && (
                            <div className={`text-sm ${textSecondary}`}>+ {inboxCompletedTodayCount} inbox {inboxCompletedTodayCount === 1 ? 'task' : 'tasks'} done</div>
                          )}
                        </div>
                      </div>
                      {/* Stat rows */}
                      <div className={`space-y-3 ${textSecondary}`}>
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2"><Clock size={14} className="text-orange-400" /> Time spent</div>
                          <span className={`font-medium ${textPrimary}`}>{Math.floor((actualTodayCompletedMinutes + inboxCompletedTodayMinutes) / 60)}h {(actualTodayCompletedMinutes + inboxCompletedTodayMinutes) % 60}m</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2"><Clock size={14} className="text-blue-400" /> Time planned</div>
                          <span className={`font-medium ${textPrimary}`}>{Math.floor(actualTodayPlannedMinutes / 60)}h {actualTodayPlannedMinutes % 60}m</span>
                        </div>
                        {actualTodayFocusMinutes > 0 && (
                          <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2"><Target size={14} className="text-purple-400" /> Focus time</div>
                            <span className={`font-medium ${textPrimary}`}>{Math.floor(actualTodayFocusMinutes / 60)}h {Math.round(actualTodayFocusMinutes % 60)}m</span>
                          </div>
                        )}
                      </div>
                    </>
                    );
                  })()}

                  {/* Habit Streaks — always shown */}
                  {habitsEnabled && activeHabits.length > 0 && (
                    <div className={`mt-4 pt-4 border-t ${borderClass}`}>
                      <div className="flex items-center gap-2 mb-3">
                        <Flame size={18} className="text-orange-500" />
                        <span className={`font-semibold ${textPrimary}`}>Habit Streaks</span>
                      </div>
                      <div className="space-y-2">
                        {(() => {
                          const overflow = activeHabits.length > 5;
                          const visible = overflow ? activeHabits.slice(0, 5) : activeHabits;
                          const remaining = activeHabits.length - 5;
                          return (
                            <>
                              {visible.map(habit => {
                                const s = habitStreaks[habit.id] || { current: 0, best: 0 };
                                const IconComp = HABIT_ICONS[habit.icon] || Target;
                                const colorObj = HABIT_COLORS.find(c => c.name === habit.color) || HABIT_COLORS[0];
                                return (
                                  <div key={habit.id} className="flex items-center gap-2">
                                    <IconComp size={16} style={{ color: colorObj.ring }} className="flex-shrink-0" />
                                    <span className={`text-sm flex-1 min-w-0 truncate ${textPrimary}`}>{habit.name}</span>
                                    <div className="flex items-center gap-3 flex-shrink-0">
                                      <span className={`text-sm font-semibold ${s.current > 0 ? 'text-orange-500' : textSecondary}`}>
                                        {s.current}d
                                      </span>
                                      <span className={`text-xs ${textSecondary}`}>
                                        best {s.best}d
                                      </span>
                                    </div>
                                  </div>
                                );
                              })}
                              {overflow && (
                                <div className={`flex items-center gap-2 text-sm ${textSecondary}`}>
                                  <MoreHorizontal size={16} className="flex-shrink-0" />
                                  <span>+{remaining} more habits</span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* All-Time Summary — always shown */}
                  <div className={`mt-4 pt-4 border-t ${borderClass}`}>
                    <div className="flex items-center gap-2 mb-3">
                      <TrendingUp size={18} className={textSecondary} />
                      <span className={`font-semibold ${textPrimary}`}>All-Time Summary</span>
                    </div>
                    <div className={`space-y-2 text-sm ${textSecondary}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><CalendarDays size={14} className="text-blue-400" /> Tasks scheduled</div>
                        <span className={`font-medium ${textPrimary}`}>{allTimeScheduledCount}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><CheckCircle size={14} className="text-green-400" /> Tasks completed</div>
                        <span className={`font-medium ${textPrimary}`}>
                          {allTimeCompletedCount}
                          {allTimeIncompleteTasks.length > 0 && (
                            <button
                              onClick={() => { setShowIncompleteTasks('allTime'); setShowMobileDailySummary(false); }}
                              className="ml-1 text-blue-500 active:text-blue-400"
                            >
                              ({allTimeIncompleteTasks.length} incomplete)
                            </button>
                          )}
                        </span>
                      </div>
                      {allTimeInboxCompletedCount > 0 && (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2"><Inbox size={14} className="text-amber-400" /> Inbox done</div>
                          <span className={`font-medium ${textPrimary}`}>{allTimeInboxCompletedCount}</span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><Clock size={14} className="text-orange-400" /> Time spent</div>
                        <span className={`font-medium ${textPrimary}`}>{Math.floor((totalCompletedMinutes + allTimeInboxCompletedMinutes) / 60)}h {(totalCompletedMinutes + allTimeInboxCompletedMinutes) % 60}m</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><Clock size={14} className="text-blue-400" /> Time planned</div>
                        <span className={`font-medium ${textPrimary}`}>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m</span>
                      </div>
                      {allTimeFocusMinutes > 0 && (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2"><Target size={14} className="text-purple-400" /> Focus time</div>
                          <span className={`font-medium ${textPrimary}`}>{Math.floor(allTimeFocusMinutes / 60)}h {Math.round(allTimeFocusMinutes % 60)}m</span>
                        </div>
                      )}
                      {allTimeScheduledCount > 0 && (
                        <div className="flex items-center justify-between pt-1">
                          <div className="flex items-center gap-2"><Trophy size={14} className="text-amber-400" /> <span className={`font-semibold ${textPrimary}`}>Completion rate</span></div>
                          <span className={`font-semibold ${textPrimary}`}>{Math.round((allTimeCompletedCount / allTimeScheduledCount) * 100)}%</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Tab Bar */}
          <MobileTabBar />
        </>
);
};

export default MobileLayout;
