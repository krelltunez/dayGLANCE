import React, { useState, useRef } from 'react';
import {
  Bell, BookOpen, ChevronLeft, ChevronRight, Cloud,
  Eye, GitBranch, HelpCircle, Inbox, Moon, NotebookPen,
  RefreshCw, Save, Settings, Sun, Trash2,
} from 'lucide-react';
import { dateToString, formatDateRange } from '../utils/taskUtils.js';
import DesktopHeader from './DesktopHeader.jsx';
import CalendarHeader from './CalendarHeader.jsx';
import TimeGrid from './TimeGrid.jsx';
import DayView from './DayView.jsx';
import WeekView from './WeekView.jsx';
import InboxArchivedBar from './InboxArchivedBar.jsx';
import GlanceSidebar from './GlanceSidebar.jsx';
import InboxSidebar from './InboxSidebar.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';

const DesktopLayout = () => {
  const {
    isPhone, isMobile, isTablet, isLandscape,
    visibleDays, visibleDates,
    effectiveViewMode,
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
    prevAllTagsRef, prevFrameNudgeKeyRef,
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
    suggestions, setSuggestions,
    selectedSuggestionIndex, setSelectedSuggestionIndex,
    showSuggestions, setShowSuggestions,
    suggestionContext, setSuggestionContext,
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
    getHourHeight, minutesToPosition, positionToMinutes, durationToHeight,
    calculateTaskPosition, getTimeFromCursorPosition,
    getAdjustedTimeForImportedConflicts,
    getConflictingTasks, calculateConflictPosition, wouldExceedMaxColumns,
    filterByTags,
    getTasksForDate, getDateIndicators, hasTasksOnDate,
    getDayName, getMonthDays, getNextQuarterHour,
    weekStartDay,
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
    hideStandaloneTasksInbox, inboxTagFilter, inboxProjectFilter, setInboxProjectFilter,
    archiveInboxTask,
  } = useDayPlannerCtx();

  const {
    autoBackupInProgressRef, syncAllRef,
    cloudSyncDebounceRef, suppressCloudUploadRef, suppressTimestampRef,
    suppressClearPendingRef, cloudSyncInProgressRef, cloudSyncInitialDoneRef,
    cloudSyncDownloadRef, cloudSyncErrorCountRef, cloudSyncBackoffUntilRef,
    obsidianVaultHandleRef, obsidianSyncInProgressRef, obsidianPrevTaskStateRef,
    obsidianTasksRef, obsidianInboxRef,
    trmnlSyncTimerRef, trmnlLastPushRef, trmnlBackoffUntilRef, trmnlBackoffCountRef,
    trmnlSyncInProgressRef, performTrmnlSyncRef,
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
  } = useSyncCtx();

  const {
    voiceRecorderRef, voiceAudioChunksRef, voiceAutoStartRef,
    voiceAllTagsRef, voiceBuildTaskContextRef, voiceResolveTaskMatchRef,
    lastWeeklyReviewFiredRef, weeklyReviewDismissedRef,
    focusTimerRef, handleFocusTimerEndRef, focusModeAvailableRef,
    syncHealthConnectHabitsRef, habitLongPressTimer,
    taskAISuggestion, setTaskAISuggestion,
    taskAISuggestionLoading, setTaskAISuggestionLoading,
    aiSubtasksLoadingForTask, setAiSubtasksLoadingForTask,
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
    goals, projects, goalsProjectsEnabled,
    setShowGoalsDashboard,
    projectFilter, setProjectFilter,
    reminderSettings, setReminderSettings,
    showRemindersSettings, setShowRemindersSettings,
    activeReminders, setActiveReminders,
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
  } = useFeaturesCtx();


  return (
      <>
      {/* Desktop & Tablet Layout */}
      {!isTablet && <DesktopHeader />}

      {/* Tablet header strip */}
      {isTablet && (
        <div className={`${cardBg} border-b ${borderClass} px-4 flex items-center justify-between relative`} style={{ height: '56px' }}>
          <div className="flex items-center">
            <img src={darkMode ? '/dayglance-dark.svg' : '/dayglance-light.svg'} alt="dayGLANCE" className="h-10" />
          </div>
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex items-center gap-1 pointer-events-auto">
              <button onClick={() => changeDate(-1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Previous day">
                <ChevronLeft size={20} className={textSecondary} />
              </button>
              <button
                onClick={() => {
                  if (!showMonthView) setViewedMonth(new Date(selectedDate));
                  setShowMonthView(!showMonthView);
                }}
                className={`month-view-toggle ${textPrimary} font-semibold text-base px-2 py-1 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              >
                {formatDateRange(visibleDates)}
              </button>
              <button onClick={() => changeDate(1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Next day">
                <ChevronRight size={20} className={textSecondary} />
              </button>
              {dateToString(selectedDate) !== dateToString(new Date()) && (
                <button
                  onClick={goToToday}
                  className="px-3 py-1 text-xs bg-blue-600 text-white rounded-full hover:bg-blue-700 active:bg-blue-700 transition-colors"
                >
                  Today
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
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
              className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors ${isSyncing ? 'opacity-70' : ''}`}
              title={isSyncing ? "Syncing..." : (calSyncConfigured ? `Sync calendars${calSyncLastSynced ? ` — last: ${new Date(calSyncLastSynced).toLocaleTimeString()}` : ''}` : "Configure calendar sync")}
              aria-label={isSyncing ? "Syncing" : "Sync calendars"}
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
              className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title={cloudSyncConfig?.enabled
                ? (cloudSyncStatus === 'uploading' || cloudSyncStatus === 'downloading' ? 'Syncing...' : `Cloud sync — last: ${cloudSyncLastSynced ? new Date(cloudSyncLastSynced).toLocaleTimeString() : 'never'}`)
                : 'Set up cloud sync'}
              aria-label="Cloud sync"
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
                className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors ${obsidianSyncStatus === 'syncing' ? 'opacity-70 cursor-not-allowed' : ''}`}
                title={obsidianSyncStatus === 'syncing' ? 'Syncing...' : obsidianSyncStatus === 'error' && obsidianSyncError ? `Obsidian sync error: ${obsidianSyncError}` : `Obsidian sync — last: ${obsidianLastSynced ? new Date(obsidianLastSynced).toLocaleTimeString() : 'never'}`}
                aria-label="Obsidian sync"
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
              className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title="Settings"
              aria-label="Settings"
            >
              <Settings size={18} className={textSecondary} />
              {updateInfo && (
                <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-red-500`} />
              )}
            </button>
            <button
              onClick={() => setShowRemindersSettings(true)}
              className={`relative p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title="Reminders"
              aria-label="Reminders"
            >
              <Bell size={18} className={textSecondary} />
              {activeReminders.length > 0 && (
                <span className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 ${darkMode ? 'border-gray-800' : 'border-white'} bg-amber-500 animate-pulse`} />
              )}
            </button>
            <button
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            >
              {darkMode ? <Sun size={18} className={textSecondary} /> : <Moon size={18} className={textSecondary} />}
            </button>
            <button
              onClick={() => setShowBackupMenu(true)}
              className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title="Backup or restore data"
              aria-label="Backup or restore data"
            >
              <Save size={18} className={textSecondary} />
            </button>
            <button
              onClick={() => setShowHelpModal(true)}
              className={`p-2 ${darkMode ? 'bg-gray-700' : 'bg-stone-200'} rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`}
              title="Help & Feedback"
              aria-label="Help & Feedback"
            >
              <HelpCircle size={18} className={textSecondary} />
            </button>
          </div>
          {/* Tablet month view popup */}
          {showMonthView && (
            <div className={`month-view-container absolute left-1/2 -translate-x-1/2 top-full mt-1 ${cardBg} rounded-lg shadow-xl border ${borderClass} p-4 z-50 min-w-[300px]`}>
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={(e) => { e.stopPropagation(); changeViewedMonth(-1); }} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Previous month">
                  <ChevronLeft size={18} className={textSecondary} />
                </button>
                <div className={`font-bold ${textPrimary}`}>
                  {viewedMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </div>
                <button type="button" onClick={(e) => { e.stopPropagation(); changeViewedMonth(1); }} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label="Next month">
                  <ChevronRight size={18} className={textSecondary} />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {(() => { const d = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; return [...d.slice(weekStartDay), ...d.slice(0, weekStartDay)]; })().map(day => (
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
                      className={`h-10 rounded text-sm relative ${!day ? 'invisible' : ''} ${isSelected ? 'bg-blue-600 text-white font-bold' : ''} ${!isSelected && isDayToday ? 'bg-blue-100 dark:bg-blue-900 font-semibold' : ''} ${!isSelected && !isDayToday ? `${textPrimary} active:bg-stone-100 dark:active:bg-gray-700` : ''} ${!day ? '' : 'cursor-pointer'}`}
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

      {/* Content area: side panel + calendar */}
      <div className="flex" style={{ height: isTablet ? 'calc(100vh - 56px - env(safe-area-inset-top, 0px))' : 'calc(100vh - 80px - env(safe-area-inset-top, 0px))' }}>

        <div className="contents">

          {/* Tablet static side panel */}
          {isTablet && (
            <div
              className={`${cardBg} border-r ${borderClass} flex flex-col flex-shrink-0 relative`}
              style={{ width: '340px', height: '100%' }}
            >
              {/* Tabbed header — both portrait and landscape */}
              <div className={`flex border-b ${borderClass} flex-shrink-0`}>
                <button
                  onClick={() => setTabletActiveTab('glance')}
                  className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${tabletActiveTab === 'glance' ? 'text-blue-500 border-b-2 border-blue-500' : `${textSecondary} border-b-2 border-transparent`}`}
                >
                  <span className="flex items-center justify-center gap-1.5"><Eye size={16} /> GLANCE</span>
                </button>
                <button
                  onClick={() => setTabletActiveTab('inbox')}
                  className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${tabletActiveTab === 'inbox' ? 'text-blue-500 border-b-2 border-blue-500' : `${textSecondary} border-b-2 border-transparent`}`}
                >
                  <span className="flex items-center justify-center gap-1.5">
                    <Inbox size={16} /> Inbox
                    {filteredUnscheduledTasks.filter(t => !t.isExample).length > 0 && (
                      <span className="bg-blue-600 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1">
                        {filteredUnscheduledTasks.filter(t => !t.isExample).length}
                      </span>
                    )}
                  </span>
                </button>
              </div>

              {/* Scrollable content */}
              <div className={`flex-1 overflow-y-auto ${darkMode ? 'dark-scrollbar' : ''}`}>
                {/* Glance section — shown when glance tab active */}
                {tabletActiveTab === 'glance' && (
                  <div className="p-4">
                    <GlanceSidebar variant="tablet" />
                  </div>
                )}

                {/* Inbox section — shown when inbox tab active */}
                {tabletActiveTab === 'inbox' && (
                  <div className="p-4" data-inbox-container>
                    <InboxSidebar variant="tablet" />
                  </div>
                )}
              </div>
              {tabletActiveTab === 'inbox' && <InboxArchivedBar />}
              {/* Daily Note FAB — above Goals & Projects FAB */}
              {tabletActiveTab === 'glance' && (
                <button
                  onClick={() => setDailyNotesModalDate(getTodayStr())}
                  className={`absolute left-4 z-10 h-9 px-3 rounded-full shadow-lg flex items-center gap-1.5 transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                  style={{ bottom: goalsProjectsEnabled ? '68px' : '24px' }}
                  title="Today's daily note"
                >
                  {obsidianConfig?.enabled ? <BookOpen size={15} /> : <NotebookPen size={15} />}
                  <span className="text-xs font-medium whitespace-nowrap">Daily Note</span>
                </button>
              )}
              {/* Goals & Projects FAB — bottom-left of GLANCE panel */}
              {goalsProjectsEnabled && tabletActiveTab === 'glance' && (
                <button
                  onClick={() => setShowGoalsDashboard(true)}
                  className={`absolute bottom-6 left-4 z-10 h-9 px-3 rounded-full shadow-lg flex items-center gap-1.5 transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                >
                  <GitBranch size={15} />
                  <span className="text-xs font-medium whitespace-nowrap">Goals &amp; Projects</span>
                </button>
              )}
            </div>
          )}

          {/* Desktop side panel — Glance + Inbox (matching tablet landscape design) */}
          {!isTablet && (
          <div
            className={`${cardBg} border-r ${borderClass} flex flex-col flex-shrink-0 relative`}
            style={{ width: '340px', height: '100%' }}
          >
            {/* Tab bar — matching tablet */}
            <div className={`flex border-b ${borderClass} flex-shrink-0`}>
              <button
                onClick={() => setTabletActiveTab('glance')}
                className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${tabletActiveTab === 'glance' ? 'text-blue-500 border-b-2 border-blue-500' : `${textSecondary} border-b-2 border-transparent`}`}
              >
                <span className="flex items-center justify-center gap-1.5"><Eye size={16} /> GLANCE</span>
              </button>
              <button
                onClick={() => setTabletActiveTab('inbox')}
                className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${tabletActiveTab === 'inbox' ? 'text-blue-500 border-b-2 border-blue-500' : `${textSecondary} border-b-2 border-transparent`}`}
              >
                <span className="flex items-center justify-center gap-1.5">
                  <Inbox size={16} /> Inbox
                  {filteredUnscheduledTasks.filter(t => !t.isExample).length > 0 && (
                    <span className="bg-blue-600 text-white text-[9px] font-bold min-w-[16px] h-4 flex items-center justify-center rounded-full px-1">
                      {filteredUnscheduledTasks.filter(t => !t.isExample).length}
                    </span>
                  )}
                </span>
              </button>
            </div>
            {/* Scrollable content */}
            <div className={`flex-1 overflow-y-auto ${darkMode ? 'dark-scrollbar' : ''}`}>
              {/* Glance section — shown when glance tab active */}
              {tabletActiveTab === 'glance' && (
              <div className="p-4">
                <GlanceSidebar variant="desktop" />
              </div>
              )}

              {/* Inbox section — shown when inbox tab active */}
              {tabletActiveTab === 'inbox' && (
              <div className="p-4" data-inbox-container>
                <InboxSidebar variant="desktop" />
              </div>
              )}
            </div>
            {tabletActiveTab === 'inbox' && <InboxArchivedBar />}
            {/* Daily Note FAB — above Goals & Projects FAB */}
            {tabletActiveTab === 'glance' && (
              <button
                onClick={() => setDailyNotesModalDate(getTodayStr())}
                className={`absolute left-4 z-10 h-9 px-3 rounded-full shadow-lg flex items-center gap-1.5 transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                style={{ bottom: goalsProjectsEnabled ? '68px' : '24px' }}
                title="Today's daily note"
              >
                {obsidianConfig?.enabled ? <BookOpen size={15} /> : <NotebookPen size={15} />}
                <span className="text-xs font-medium whitespace-nowrap">Daily Note</span>
              </button>
            )}
            {/* Goals & Projects FAB — bottom-left of GLANCE panel */}
            {goalsProjectsEnabled && tabletActiveTab === 'glance' && (
              <button
                onClick={() => setShowGoalsDashboard(true)}
                className={`absolute bottom-6 left-4 z-10 h-9 px-3 rounded-full shadow-lg flex items-center gap-1.5 transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
                title="Goals & Projects"
              >
                <GitBranch size={15} />
                <span className="text-xs font-medium whitespace-nowrap">Goals &amp; Projects</span>
              </button>
            )}
          </div>
          )}

          {/* Calendar area — shared between desktop and tablet */}
          <div className="flex-1 min-w-0 relative">
            <div
              ref={calendarRef}
              className={`${cardBg} border ${borderClass} ${effectiveViewMode === 'multi' ? `overflow-y-scroll overflow-x-hidden ${darkMode ? 'dark-scrollbar' : ''}` : 'overflow-hidden'} relative`}
              style={{ height: '100%' }}
            >
              {/* Combined sticky header — date headers + all-day section */}
              <div ref={(el) => { stickyHeaderRef.current = el; }} className={`sticky top-0 z-20 ${cardBg}`}>
              <CalendarHeader />
              </div>

              {/* Main calendar grid — switches between multi/day/week views */}
              {effectiveViewMode === 'multi' && <TimeGrid />}
              {effectiveViewMode === 'day' && <DayView />}
              {effectiveViewMode === 'week' && <WeekView />}
            </div>
          </div>
        </div>
      </div>

      {/* Trash FAB — visible during desktop drag */}
      {draggedTask && dragSource !== 'routine' && (
        <div
          onDragOver={handleDragOverRecycleBin}
          onDragLeave={() => setDragOverRecycleBin(false)}
          onDrop={handleDropOnRecycleBin}
          className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-16 h-16 rounded-full shadow-xl flex items-center justify-center transition-all duration-150 pointer-events-auto ${dragOverRecycleBin ? 'bg-red-600 scale-110' : 'bg-red-500'}`}
        >
          <Trash2 size={26} className="text-white" />
        </div>
      )}
      {/* Trash FAB — visible during tablet touch drag */}
      {isTablet && mobileDragTaskIdState !== null && (
        <div
          ref={trashFabRef}
          className={`fixed z-50 w-16 h-16 rounded-full shadow-xl flex items-center justify-center transition-all duration-150 ${mobileDragOverTrash ? 'bg-red-600 scale-110' : 'bg-red-500'}`}
          style={{ left: 'calc(340px + 1rem)', bottom: 'calc(1.5rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <Trash2 size={26} className="text-white" />
        </div>
      )}
      </>
);
};

export default DesktopLayout;
