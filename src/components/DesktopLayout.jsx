import React from 'react';
import {
  AlertCircle, AlertTriangle, Bell, BookOpen, BrainCircuit,
  Calendar, CalendarDays, Check, CheckCircle, CheckSquare, ChevronDown,
  ChevronLeft, ChevronRight, ChevronUp, Clock, Cloud, ExternalLink,
  Eye, FileText, Filter, GitBranch, GripVertical, Hash, HelpCircle, Inbox, Key,
  LayoutGrid, Link, Loader, MapPin, Menu, Mic, Minus, Moon, MoreHorizontal,
  NotebookPen, Pencil, Pin, Plus, RefreshCw, Save, Search, Settings,
  SkipForward, Sparkles, Sun, Target, Trash2, Upload, X,
} from 'lucide-react';
import { isNativeAndroid, nativeUpdateEvent } from '../native.js';
import { renderTitle, renderTitleWithoutTags, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks } from '../utils/textFormatting.jsx';
import { dateToString, extractTags, extractWikilinks, formatDate, formatDateRange, formatDeadlineDate, formatShortDate, stripWikilinks } from '../utils/taskUtils.js';
import { HABIT_COLORS, HABIT_ICONS } from '../constants/habits.js';
import { HabitRing, MiniHabitRing } from './HabitRing.jsx';
import GettingStartedChecklist from './GettingStartedChecklist.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';
import DailyNotesModal from './DailyNotesModal.jsx';
import FrameNudgeCard from './FrameNudgeCard.jsx';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';
import DesktopHeader from './DesktopHeader.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';

const DesktopLayout = () => {
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
    goals, projects, goalsProjectsEnabled,
    setShowGoalsDashboard,
    projectFilter, setProjectFilter,
  } = useDayPlannerCtx();

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
                  className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${tabletActiveTab === 'glance' ? 'text-blue-500 border-b-2 border-blue-500' : textSecondary}`}
                >
                  <span className="flex items-center justify-center gap-1.5"><Eye size={16} /> GLANCE</span>
                </button>
                <button
                  onClick={() => setTabletActiveTab('inbox')}
                  className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${tabletActiveTab === 'inbox' ? 'text-blue-500 border-b-2 border-blue-500' : textSecondary}`}
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
                    <div className="space-y-4">
                      {/* Search bar + filter */}
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setShowSpotlight(true); playUISound('spotlight'); }}
                          className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-400'} transition-colors active:opacity-70`}
                        >
                          <Search size={16} />
                          <span className="text-sm">Search tasks...</span>
                        </button>
                        {allTags.length > 0 && (
                          <div className="flex-shrink-0 self-stretch flex items-center">
                            <button
                              ref={tagFilterBtnRef}
                              onClick={() => setShowMobileTagFilter(v => !v)}
                              className={`px-2.5 h-full flex items-center rounded-lg transition-colors ${
                                !allTags.every(tag => selectedTags.includes(tag))
                                  ? 'bg-blue-500 text-white'
                                  : darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-400'
                              } active:opacity-80`}
                            >
                              <Filter size={16} />
                            </button>
                            {/* Tag filter popover — matching desktop */}
                            {showMobileTagFilter && (() => {
                              const rect = tagFilterBtnRef.current?.getBoundingClientRect();
                              return (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowMobileTagFilter(false)} />
                                <div
                                  className={`fixed z-50 ${cardBg} border ${borderClass} rounded-xl shadow-xl`}
                                  style={{ width: '280px', top: rect ? rect.bottom + 4 : 0, left: rect ? Math.max(8, rect.right - 280) : 0 }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'inherit' }}>
                                    <div className="flex items-center gap-1.5">
                                      <Filter size={14} className={textSecondary} />
                                      <span className={`text-sm font-semibold ${textPrimary}`}>Filter by Tag</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      {allTags.every(tag => selectedTags.includes(tag)) ? (
                                        <button onClick={clearTagFilter} className="text-xs text-blue-500 hover:text-blue-600 font-medium">Clear</button>
                                      ) : (
                                        <button onClick={selectAllTags} className="text-xs text-blue-500 hover:text-blue-600 font-medium">Select All</button>
                                      )}
                                    </div>
                                  </div>
                                  <div className="py-1 max-h-[300px] overflow-y-auto">
                                    {allTags.map(tag => {
                                      const visibleDateStrs = new Set(visibleDates.map(d => dateToString(d)));
                                      const regularCount = tasks.filter(t => !t.imported && visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                                      const recurringCount = expandedRecurringTasks.filter(t => visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                                      const tagCount = regularCount + recurringCount;
                                      return (
                                        <button
                                          key={tag}
                                          onClick={() => toggleTag(tag)}
                                          className={`w-full flex items-center gap-2 px-3 py-2 transition-colors ${
                                            tagCount === 0 ? 'opacity-40' : ''
                                          } ${
                                            selectedTags.includes(tag)
                                              ? darkMode ? 'bg-blue-500/20' : 'bg-blue-50'
                                              : darkMode ? 'hover:bg-white/5' : 'hover:bg-stone-50'
                                          }`}
                                        >
                                          <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                                            selectedTags.includes(tag) ? 'bg-blue-500 border-blue-500' : darkMode ? 'border-gray-600' : 'border-stone-300'
                                          }`}>
                                            {selectedTags.includes(tag) && <Check size={12} className="text-white" />}
                                          </div>
                                          <Hash size={12} className={textSecondary} />
                                          <span className={`flex-1 text-left text-sm ${textPrimary}`}>{tag}</span>
                                          {tagCount > 0 && <span className={`text-xs ${textSecondary} tabular-nums`}>{tagCount}</span>}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              </>
                              );
                            })()}
                          </div>
                        )}
                        {aiConfig.enabled && aiConfig.features.voiceTaskInput && (
                          <button
                            onClick={() => setShowVoiceInput(true)}
                            className={`flex-shrink-0 self-stretch flex items-center px-2.5 rounded-lg transition-colors ${darkMode ? 'bg-white/10 text-purple-400' : 'bg-black/5 text-purple-600'} active:opacity-80`}
                            title="Voice Task Input"
                          >
                            <Mic size={16} />
                          </button>
                        )}
                      </div>

                      {/* Morning dayGLANCE — AI morning summary card */}
                      {aiConfig.enabled && aiConfig.features.morningSummary && !morningGlanceDismissed && (
                        (morningGlanceText || morningGlanceLoading || morningGlanceError) ? (
                        <div className={`rounded-lg border p-3 ${darkMode ? 'border-amber-800/50 bg-amber-900/20' : 'border-amber-200 bg-amber-50'}`}>
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
                                onClick={() => { setShowFramesModal(true); setFramesModalTab('schedule'); setEditingFrame(null); }}
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
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${darkMode ? 'border-amber-800/50 bg-amber-900/20 hover:bg-amber-900/30' : 'border-amber-200 bg-amber-50 hover:bg-amber-100'}`}
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

                      {/* Evening Reflection — AI end-of-day card */}
                      {aiConfig.enabled && aiConfig.features.eveningReflection && !eveningGlanceDismissed && currentTime.getHours() >= 19 && (
                        (eveningGlanceText || eveningGlanceLoading || eveningGlanceError) ? (
                        <div className={`rounded-lg border p-3 ${darkMode ? 'border-indigo-800/50 bg-indigo-900/20' : 'border-indigo-200 bg-indigo-50'}`}>
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
                          className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${darkMode ? 'border-indigo-800/50 bg-indigo-900/20 hover:bg-indigo-900/30' : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100'}`}
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

                      {/* Frame Nudge card (tablet) */}
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
                        <div className="relative">
                          <div className="flex items-start gap-1 justify-center">
                            {activeHabits.slice(0, 5).map((habit, habitIdx) => (
                              <div key={habit.id} className="relative">
                                <HabitRing
                                  size={44}
                                  habit={habit}
                                  count={getTodayHabitCount(habit.id)}
                                  darkMode={darkMode}
                                  onClick={() => incrementHabit(habit.id)}
                                  onContextMenu={(e) => { e.preventDefault(); setHabitLongPressId(prev => prev === habit.id ? null : habit.id); setHabitEditingCountId(null); }}
                                  onMouseDown={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); habitLongPressTimer.current = setTimeout(() => { setHabitLongPressId(prev => prev === habit.id ? null : habit.id); setHabitEditingCountId(null); }, 500); }}
                                  onMouseUp={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
                                  onMouseLeave={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
                                  onTouchStart={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); habitLongPressTimer.current = setTimeout(() => { setHabitLongPressId(prev => prev === habit.id ? null : habit.id); setHabitEditingCountId(null); }, 500); }}
                                  onTouchEnd={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
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
                                            onClick={() => { incrementHabit(habit.id); }}
                                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg ${darkMode ? 'hover:bg-gray-700 active:bg-gray-600' : 'hover:bg-stone-50 active:bg-stone-100'} transition-colors`}
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
                          return true;
                        });
                        if (pastOverdue.length === 0) return null;
                        return (
                          <div className={`rounded-lg border ${darkMode ? 'border-orange-500/40 bg-orange-500/10' : 'border-orange-400/50 bg-orange-50'} overflow-hidden`}>
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
                                    key={`tablet-overdue-${task.id}`}
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
                                          <><CalendarDays size={10} /> {formatDeadlineDate(task.date)}</>
                                        ) : (
                                          <><AlertCircle size={10} /> Due: {formatDeadlineDate(task.deadline)}</>
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

                      {/* Today's agenda — grouped by frames */}
                      {(() => {
                        const filteredAgenda = filterByTags(projectFilter ? todayAgenda.filter(t => t.projectId === projectFilter) : todayAgenda);
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

                        // Classify each agenda task into a frame or "unframed"
                        const taskFrameMap = new Map(); // taskId -> frameId
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

                        // Build ordered sections: non-scheduled tasks first, then chronological frame/unframed groups
                        const nonScheduled = filteredAgenda.filter(t => t._agendaType !== 'scheduled');
                        const scheduled = filteredAgenda.filter(t => t._agendaType === 'scheduled');

                        // Group scheduled tasks into sections in time order
                        const sections = []; // { type: 'frame' | 'unframed', frame?, tasks[] }
                        const framedIds = new Set(taskFrameMap.values());
                        // Sort frames by start time
                        const sortedFrames = [...todayFrames].filter(f => framedIds.has(f.frameId) || true).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
                        const assignedTaskIds = new Set();

                        // Interleave frames and unframed tasks in time order
                        let scheduledIdx = 0;
                        for (const frame of sortedFrames) {
                          const fStart = timeToMinutes(frame.start);
                          // Add unframed tasks before this frame
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

                          // Add this frame's tasks
                          const frameTasks = scheduled.filter(t => taskFrameMap.get(String(t.id)) === frame.frameId);
                          const availSlots = computeAvailableSlots(frame, today);
                          const totalAvail = availSlots.reduce((sum, s) => sum + s.minutes, 0);
                          // Hide frames with no availability and no tasks (fully blocked by calendar events)
                          if (totalAvail > 0 || frameTasks.length > 0) {
                            sections.push({ type: 'frame', frame, tasks: frameTasks, totalAvail });
                          }
                          frameTasks.forEach(t => assignedTaskIds.add(String(t.id)));
                          // Advance scheduledIdx past frame tasks
                          while (scheduledIdx < scheduled.length && assignedTaskIds.has(String(scheduled[scheduledIdx].id))) scheduledIdx++;
                        }
                        // Remaining unframed tasks after all frames
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

                        const renderTabletNowMarker = (key) => {
                          const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
                          const gapM = agendaNowMarker.gapMinutes % 60;
                          const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
                          return (
                            <div key={key} className="flex gap-2.5 py-2">
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

                        const renderTaskItem = (task, keyPrefix) => {
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
                              className={`flex gap-2.5 py-2 ${task.completed ? 'opacity-50' : ''} cursor-pointer active:bg-white/5 rounded-lg transition-colors`}
                              onClick={() => {
                                const el = document.querySelector(`[data-task-id="${task.id}"]`);
                                if (el && calendarRef.current) {
                                  const container = calendarRef.current;
                                  const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
                                  const scrollTarget = Math.max(0, elTop - container.clientHeight / 2 + el.offsetHeight / 2);
                                  container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                                  el.classList.add('ring-2', 'ring-blue-400');
                                  setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
                                }
                              }}
                            >
                              <div className={`w-1.5 rounded-full flex-shrink-0 ${colorClass} ${relativeLabel === 'In Progress' ? 'animate-pulse' : ''}`} style={task.isTaskCalendar ? getTaskCalendarStyle(task, darkMode) : task.nativeCalendarColor ? { backgroundColor: task.nativeCalendarColor } : {}}></div>
                              <div className="min-w-0 flex-1">
                                <div className={`text-sm font-semibold ${textPrimary} ${task.completed ? 'line-through' : ''} flex items-center gap-1.5`}>
                                  {task.isRecurring && <RefreshCw size={13} className="flex-shrink-0 opacity-60" />}
                                  {task.importSource === 'obsidian' && <BookOpen size={13} className="flex-shrink-0 opacity-60" title="From Obsidian" />}
                                  <span className="truncate">{renderTitle(task.title)}</span>
                                  {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                    <button key={i} className="flex-shrink-0 text-purple-400 active:text-purple-300" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={13} /></button>
                                  ))}
                                </div>
                                <div className={`text-sm ${textSecondary} flex items-center gap-1 flex-wrap`}>
                                  <span className="whitespace-nowrap">{timeLabel}{relativeLabel ? ',' : ''}</span>{relativeLabel ? <span className={relativeLabel === 'Overdue' ? 'text-orange-500 font-medium' : relativeLabel === 'In Progress' ? 'text-blue-500 font-medium' : ''}>{relativeLabel}</span> : ''}
                                  {relativeLabel === 'In Progress' && focusModeAvailable && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); enterFocusMode(); }}
                                      className="ml-1 p-1.5 rounded text-purple-500 active:text-purple-400 active:bg-purple-500/20 transition-colors"
                                      title="Enter Focus Mode"
                                    >
                                      <Target size={16} className="animate-pulse" />
                                    </button>
                                  )}
                                  {goalsProjectsEnabled && task.projectId && (() => {
                                    const proj = projects.find(p => p.id === task.projectId);
                                    if (!proj) return null;
                                    return (
                                      <button
                                        onClick={(e) => { e.stopPropagation(); setProjectFilter(prev => prev === task.projectId ? null : task.projectId); }}
                                        className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium transition-colors ${darkMode ? 'bg-blue-900/50 text-blue-300 hover:bg-blue-800/70' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'} ${projectFilter === task.projectId ? 'ring-1 ring-blue-400' : ''}`}
                                        title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                                      >
                                        {proj.title}
                                      </button>
                                    );
                                  })()}
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
                          {filteredAgenda.length === 0 && (
                            <p className={`text-sm ${textSecondary} text-center py-4`}>No tasks scheduled for today</p>
                          )}
                          {/* Now marker before first task (only when no frame sections handle positioning) */}
                          {filteredAgenda.length > 0 && sections.length === 0 && !agendaNowMarker.insideTask && agendaNowMarker.insertAfterIndex < 0 && (() => {
                            const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
                            const gapM = agendaNowMarker.gapMinutes % 60;
                            const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
                            return (
                              <div key="tablet-now-marker" className="flex gap-2.5 py-2.5">
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
                          {nonScheduled.map(task => renderTaskItem(task, 'tablet-glance'))}
                          {/* Frame-grouped and unframed sections */}
                          {sections.map((section, si) => {
                            const elements = [];
                            // Now marker between sections (before this section)
                            if (nowMarkerSectionInfo && !nowMarkerSectionInfo.inSection && nowMarkerSectionInfo.si === si) {
                              elements.push(renderTabletNowMarker(`tablet-now-mid-${si}`));
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
                                  key={`tablet-frame-section-${section.frame.frameId}`}
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
                                        items.push(renderTabletNowMarker(`tablet-now-frame-${si}`));
                                      }
                                      section.tasks.forEach((task, ti) => {
                                        items.push(renderTaskItem(task, 'tablet-frame'));
                                        if (markerInThisFrame && nowMarkerSectionInfo.afterTaskIdx === ti) {
                                          items.push(renderTabletNowMarker(`tablet-now-frame-${si}-${ti}`));
                                        }
                                      });
                                      return items;
                                    })()}
                                  </div>
                                </div>
                              );
                            } else {
                              // Unframed tasks
                              const markerInThisSection = nowMarkerSectionInfo && nowMarkerSectionInfo.inSection && nowMarkerSectionInfo.si === si;
                              if (markerInThisSection && nowMarkerSectionInfo.afterTaskIdx < 0) {
                                elements.push(renderTabletNowMarker(`tablet-now-unframed-${si}`));
                              }
                              section.tasks.forEach((task, ti) => {
                                elements.push(renderTaskItem(task, 'tablet-glance'));
                                if (markerInThisSection && nowMarkerSectionInfo.afterTaskIdx === ti) {
                                  elements.push(renderTabletNowMarker(`tablet-now-unframed-${si}-${ti}`));
                                }
                              });
                            }
                            return <React.Fragment key={`tablet-section-${si}`}>{elements}</React.Fragment>;
                          })}
                          {/* Now marker after all tasks/frames */}
                          {filteredAgenda.length > 0 && !agendaNowMarker.insideTask && (sections.length > 0 ? nowIsAfterAllSections : agendaNowMarker.insertAfterIndex >= todayAgenda.length - 1) && (() => {
                            const hr = currentTime.getHours();
                            const barColor = hr >= 22 ? 'bg-blue-500' : hr >= 19 ? 'bg-green-500' : 'bg-yellow-500';
                            const textColor = hr >= 22 ? 'text-blue-500' : hr >= 19 ? 'text-green-500' : 'text-yellow-600';
                            const subtitle = hr >= 22 ? "Get some rest so you're ready for tomorrow!" : hr >= 19 ? 'Enjoy the evening!' : 'Time to relax or tackle more tasks?';
                            return (
                              <div key="tablet-now-marker-end" className="flex gap-2.5 py-2.5">
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
                          <div className={`mt-3 pt-3 border-t ${borderClass} cursor-pointer active:opacity-70 transition-opacity`} onClick={() => openRoutinesDashboard()}>
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

                    </div>
                  </div>
                )}

                {/* Inbox section — shown when inbox tab active */}
                {tabletActiveTab === 'inbox' && (
                  <div className="p-4">
                    {/* Inbox header with priority filter */}
                    <div className="flex items-center mb-4">
                        <button
                          onClick={openNewInboxTask}
                          className="w-24 flex items-center justify-center gap-1 py-1.5 bg-blue-600 text-white rounded-lg active:bg-blue-700 transition-colors"
                          title="New Inbox Task"
                        >
                          <Plus size={14} strokeWidth={3} />
                          <span className="text-xs font-medium">New Task</span>
                        </button>
                        {aiConfig?.enabled && aiConfig.features?.smartScheduling && gtdFrames.filter(f => f.enabled).length > 0 && unscheduledTasks.filter(t => !t.completed && !t.isExample).length > 0 && (
                          <button
                            onClick={() => { setShowFramesModal(true); setFramesModalTab('schedule'); setEditingFrame(null); }}
                            className="ml-3 w-24 flex items-center justify-center gap-1 py-1.5 bg-blue-600 text-white rounded-lg active:bg-blue-700 transition-colors"
                            title="AI Smart Schedule"
                          >
                            <BrainCircuit size={14} />
                            <span className="text-xs font-medium">Schedule</span>
                          </button>
                        )}
                        <button
                          onClick={() => { setHideCompletedInbox(prev => !prev); playUISound('click'); }}
                          className={`ml-4 ${hoverBg} rounded px-2 py-1.5 transition-colors`}
                          title={hideCompletedInbox ? 'Completed tasks hidden (click to show)' : 'Showing completed tasks (click to hide)'}
                        >
                          <CheckCircle size={14} className={hideCompletedInbox ? (darkMode ? 'text-gray-500' : 'text-stone-400') : (darkMode ? 'text-blue-400' : 'text-blue-500')} />
                        </button>
                        <button
                          onClick={() => { setInboxPriorityFilter(prev => (prev + 1) % 4); playUISound('click'); }}
                          className={`ml-2 flex gap-0.5 ${hoverBg} rounded px-2 py-1.5 transition-colors`}
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
                              {/* Swipe action strips */}
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
                                        className={`hover:bg-white/20 rounded p-1 transition-colors ${task.deadline ? 'bg-white/20' : 'opacity-40'}`}
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
                  </div>
                )}
              </div>
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
                className={`flex-1 py-3 text-sm font-semibold text-center transition-colors ${tabletActiveTab === 'glance' ? 'text-blue-500 border-b-2 border-blue-500' : textSecondary}`}
              >
                <span className="flex items-center justify-center gap-1.5"><Eye size={16} /> GLANCE</span>
              </button>
              <button
                onClick={() => setTabletActiveTab('inbox')}
                className={`flex-1 py-3 text-sm font-semibold text-center transition-colors relative ${tabletActiveTab === 'inbox' ? 'text-blue-500 border-b-2 border-blue-500' : textSecondary}`}
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
                <div className="space-y-4">
                  {/* Search bar + filter */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setShowSpotlight(true); playUISound('spotlight'); }}
                      className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-400'} transition-colors hover:opacity-80`}
                    >
                      <Search size={16} />
                      <span className="text-sm">Search tasks...</span>
                      <span className={`ml-auto text-xs ${textSecondary}`}>Ctrl+K</span>
                    </button>
                    {allTags.length > 0 && (
                      <div className="flex-shrink-0 self-stretch flex items-center">
                        <button
                          ref={tagFilterBtnRef}
                          onClick={() => setShowMobileTagFilter(v => !v)}
                          className={`px-2.5 h-full flex items-center rounded-lg transition-colors ${
                            !allTags.every(tag => selectedTags.includes(tag))
                              ? 'bg-blue-500 text-white'
                              : darkMode ? 'bg-white/10 text-gray-400' : 'bg-black/5 text-stone-400'
                          } hover:opacity-80`}
                        >
                          <Filter size={16} />
                        </button>
                        {/* Desktop tag filter popover */}
                        {showMobileTagFilter && (() => {
                          const rect = tagFilterBtnRef.current?.getBoundingClientRect();
                          return (
                          <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowMobileTagFilter(false)} />
                            <div
                              className={`fixed z-50 ${cardBg} border ${borderClass} rounded-xl shadow-xl`}
                              style={{ width: '280px', top: rect ? rect.bottom + 4 : 0, left: rect ? Math.max(8, rect.right - 280) : 0 }}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'inherit' }}>
                                <div className="flex items-center gap-1.5">
                                  <Filter size={14} className={textSecondary} />
                                  <span className={`text-sm font-semibold ${textPrimary}`}>Filter by Tag</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {allTags.every(tag => selectedTags.includes(tag)) ? (
                                    <button onClick={clearTagFilter} className="text-xs text-blue-500 hover:text-blue-600 font-medium">Clear</button>
                                  ) : (
                                    <button onClick={selectAllTags} className="text-xs text-blue-500 hover:text-blue-600 font-medium">Select All</button>
                                  )}
                                </div>
                              </div>
                              <div className="py-1 max-h-[300px] overflow-y-auto">
                                {allTags.map(tag => {
                                  const visibleDateStrs = new Set(visibleDates.map(d => dateToString(d)));
                                  const regularCount = tasks.filter(t => !t.imported && visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                                  const recurringCount = expandedRecurringTasks.filter(t => visibleDateStrs.has(t.date) && extractTags(t.title).includes(tag)).length;
                                  const tagCount = regularCount + recurringCount;
                                  return (
                                    <button
                                      key={tag}
                                      onClick={() => toggleTag(tag)}
                                      className={`w-full flex items-center gap-2 px-3 py-2 transition-colors ${
                                        tagCount === 0 ? 'opacity-40' : ''
                                      } ${
                                        selectedTags.includes(tag)
                                          ? darkMode ? 'bg-blue-500/20' : 'bg-blue-50'
                                          : darkMode ? 'hover:bg-white/5' : 'hover:bg-stone-50'
                                      }`}
                                    >
                                      <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors ${
                                        selectedTags.includes(tag) ? 'bg-blue-500 border-blue-500' : darkMode ? 'border-gray-600' : 'border-stone-300'
                                      }`}>
                                        {selectedTags.includes(tag) && <Check size={12} className="text-white" />}
                                      </div>
                                      <Hash size={12} className={textSecondary} />
                                      <span className={`flex-1 text-left text-sm ${textPrimary}`}>{tag}</span>
                                      {tagCount > 0 && <span className={`text-xs ${textSecondary} tabular-nums`}>{tagCount}</span>}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </>
                          );
                        })()}
                      </div>
                    )}
                    {aiConfig.enabled && aiConfig.features.voiceTaskInput && (
                      <button
                        onClick={() => setShowVoiceInput(true)}
                        className={`flex-shrink-0 self-stretch flex items-center px-2.5 rounded-lg transition-colors ${darkMode ? 'bg-white/10 text-purple-400' : 'bg-black/5 text-purple-600'} hover:opacity-80`}
                        title="Voice Task Input (V)"
                      >
                        <Mic size={16} />
                      </button>
                    )}
                  </div>

                  {/* Morning dayGLANCE — AI morning summary card (desktop) */}
                  {aiConfig.enabled && aiConfig.features.morningSummary && !morningGlanceDismissed && (
                    (morningGlanceText || morningGlanceLoading || morningGlanceError) ? (
                    <div className={`rounded-lg border p-3 ${darkMode ? 'border-amber-800/50 bg-amber-900/20' : 'border-amber-200 bg-amber-50'}`}>
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
                            onClick={() => { setShowFramesModal(true); setFramesModalTab('schedule'); setEditingFrame(null); }}
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
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${darkMode ? 'border-amber-800/50 bg-amber-900/20 hover:bg-amber-900/30' : 'border-amber-200 bg-amber-50 hover:bg-amber-100'}`}
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

                  {/* Evening Reflection — AI end-of-day card (desktop) */}
                  {aiConfig.enabled && aiConfig.features.eveningReflection && !eveningGlanceDismissed && currentTime.getHours() >= 19 && (
                    (eveningGlanceText || eveningGlanceLoading || eveningGlanceError) ? (
                    <div className={`rounded-lg border p-3 ${darkMode ? 'border-indigo-800/50 bg-indigo-900/20' : 'border-indigo-200 bg-indigo-50'}`}>
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
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${darkMode ? 'border-indigo-800/50 bg-indigo-900/20 hover:bg-indigo-900/30' : 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100'}`}
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

                  {/* Frame Nudge card (desktop) */}
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
                    <div className="relative">
                      <div className="flex items-start gap-1 justify-center">
                        {activeHabits.slice(0, 5).map((habit, habitIdx) => (
                          <div key={habit.id} className="relative">
                            <HabitRing
                              size={44}
                              habit={habit}
                              count={getTodayHabitCount(habit.id)}
                              darkMode={darkMode}
                              onClick={() => incrementHabit(habit.id)}
                              onContextMenu={(e) => { e.preventDefault(); setHabitLongPressId(prev => prev === habit.id ? null : habit.id); setHabitEditingCountId(null); }}
                              onMouseDown={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); habitLongPressTimer.current = setTimeout(() => { setHabitLongPressId(prev => prev === habit.id ? null : habit.id); setHabitEditingCountId(null); }, 500); }}
                              onMouseUp={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
                              onMouseLeave={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
                              onTouchStart={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); habitLongPressTimer.current = setTimeout(() => { setHabitLongPressId(prev => prev === habit.id ? null : habit.id); setHabitEditingCountId(null); }, 500); }}
                              onTouchEnd={() => { if (habitLongPressTimer.current) clearTimeout(habitLongPressTimer.current); }}
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
                                        onClick={() => { incrementHabit(habit.id); }}
                                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg ${darkMode ? 'hover:bg-gray-700 active:bg-gray-600' : 'hover:bg-stone-50 active:bg-stone-100'} transition-colors`}
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
                  {/* Overdue tasks from past days — matching tablet landscape */}
                  {(() => {
                    const todayStr = getTodayStr();
                    const pastOverdue = getOverdueTasks().filter(t => {
                      if (t._overdueType === 'scheduled') return t.date < todayStr;
                      return true;
                    });
                    if (pastOverdue.length === 0) return null;
                    return (
                      <div className={`rounded-lg border ${darkMode ? 'border-orange-500/40 bg-orange-500/10' : 'border-orange-400/50 bg-orange-50'} overflow-hidden`}>
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
                                key={`desktop-overdue-${task.id}`}
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
                                      <><CalendarDays size={10} /> {formatDeadlineDate(task.date)}</>
                                    ) : (
                                      <><AlertCircle size={10} /> Due: {formatDeadlineDate(task.deadline)}</>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {task.isRecurring ? (
                                    <button
                                      onClick={() => toggleComplete(task.id, false)}
                                      className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} hover:scale-95 transition-transform`}
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
                                    className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} hover:scale-95 transition-transform`}
                                    title="Move to inbox"
                                  >
                                    <Inbox size={14} />
                                  </button>
                                  )}
                                  <button
                                    onClick={() => moveToRecycleBin(task.id, task._overdueType === 'deadline')}
                                    className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} hover:scale-95 transition-transform`}
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

                  {/* Today's agenda — grouped by frames, matching tablet landscape */}
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

                    // Classify each agenda task into a frame or "unframed"
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
                    const framedIds = new Set(taskFrameMap.values());
                    const sortedFrames = [...todayFrames].filter(f => framedIds.has(f.frameId) || true).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
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

                    const renderDesktopNowMarker = (key) => {
                      const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
                      const gapM = agendaNowMarker.gapMinutes % 60;
                      const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
                      return (
                        <div key={key} className="flex gap-2.5 py-2">
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

                    const renderTaskItem = (task, keyPrefix) => {
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
                          className={`flex gap-2.5 py-2 ${task.completed ? 'opacity-50' : ''} cursor-pointer hover:bg-white/5 rounded-lg transition-colors`}
                          onClick={() => {
                            const el = document.querySelector(`[data-task-id="${task.id}"]`);
                            if (el && calendarRef.current) {
                              const container = calendarRef.current;
                              const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
                              const scrollTarget = Math.max(0, elTop - container.clientHeight / 2 + el.offsetHeight / 2);
                              container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                              el.classList.add('ring-2', 'ring-blue-400');
                              setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
                            }
                          }}
                        >
                          <div className={`w-1.5 rounded-full flex-shrink-0 ${colorClass} ${relativeLabel === 'In Progress' ? 'animate-pulse' : ''}`} style={task.isTaskCalendar ? getTaskCalendarStyle(task, darkMode) : task.nativeCalendarColor ? { backgroundColor: task.nativeCalendarColor } : {}}></div>
                          <div className="min-w-0 flex-1">
                            <div className={`text-sm font-semibold ${textPrimary} ${task.completed ? 'line-through' : ''} flex items-center gap-1.5`}>
                              {task.isRecurring && <RefreshCw size={13} className="flex-shrink-0 opacity-60" />}
                              {task.importSource === 'obsidian' && <BookOpen size={13} className="flex-shrink-0 opacity-60" title="From Obsidian" />}
                              <span className="truncate">{renderTitle(task.title)}</span>
                              {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                <button key={i} className="flex-shrink-0 text-purple-400 active:text-purple-300" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={13} /></button>
                              ))}
                            </div>
                            <div className={`text-sm ${textSecondary} flex items-center gap-1 flex-wrap`}>
                              <span className="whitespace-nowrap">{timeLabel}{relativeLabel ? ',' : ''}</span>{relativeLabel ? <span className={relativeLabel === 'Overdue' ? 'text-orange-500 font-medium' : relativeLabel === 'In Progress' ? 'text-blue-500 font-medium' : ''}>{relativeLabel}</span> : ''}
                              {relativeLabel === 'In Progress' && focusModeAvailable && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); enterFocusMode(); }}
                                  className="ml-1 p-1.5 rounded text-purple-500 hover:text-purple-400 hover:bg-purple-500/20 transition-colors"
                                  title="Enter Focus Mode"
                                >
                                  <Target size={16} className="animate-pulse" />
                                </button>
                              )}
                              {goalsProjectsEnabled && task.projectId && (() => {
                                const proj = projects.find(p => p.id === task.projectId);
                                if (!proj) return null;
                                return (
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setProjectFilter(prev => prev === task.projectId ? null : task.projectId); }}
                                    className={`inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full font-medium transition-colors ${darkMode ? 'bg-blue-900/50 text-blue-300 hover:bg-blue-800/70' : 'bg-blue-100 text-blue-700 hover:bg-blue-200'} ${projectFilter === task.projectId ? 'ring-1 ring-blue-400' : ''}`}
                                    title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                                  >
                                    {proj.title}
                                  </button>
                                );
                              })()}
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
                                  className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} hover:scale-95 transition-transform`}
                                  title="Move to Inbox"
                                >
                                  <Inbox size={14} />
                                </button>
                              )}
                              <button
                                onClick={(e) => { e.stopPropagation(); toggleComplete(task.id, false); }}
                                className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 text-gray-400' : 'bg-stone-100 text-stone-500'} hover:scale-95 transition-transform`}
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
                      {filteredAgenda.length === 0 && (
                        <p className={`text-sm ${textSecondary} text-center py-4`}>No tasks scheduled for today</p>
                      )}
                      {/* Now marker before first task (only when no frame sections handle positioning) */}
                      {filteredAgenda.length > 0 && sections.length === 0 && !agendaNowMarker.insideTask && agendaNowMarker.insertAfterIndex < 0 && (() => {
                        const gapH = Math.floor(agendaNowMarker.gapMinutes / 60);
                        const gapM = agendaNowMarker.gapMinutes % 60;
                        const gapStr = gapH > 0 ? `${gapH}h${gapM > 0 ? ` ${gapM}m` : ''}` : `${gapM}m`;
                        return (
                          <div key="desktop-now-marker" className="flex gap-2.5 py-2.5">
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
                      {nonScheduled.map(task => renderTaskItem(task, 'desktop-glance'))}
                      {/* Frame-grouped and unframed sections */}
                      {sections.map((section, si) => {
                        const elements = [];
                        // Now marker between sections (before this section)
                        if (nowMarkerSectionInfo && !nowMarkerSectionInfo.inSection && nowMarkerSectionInfo.si === si) {
                          elements.push(renderDesktopNowMarker(`desktop-now-mid-${si}`));
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
                              key={`desktop-frame-section-${section.frame.frameId}`}
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
                                    items.push(renderDesktopNowMarker(`desktop-now-frame-${si}`));
                                  }
                                  section.tasks.forEach((task, ti) => {
                                    items.push(renderTaskItem(task, 'desktop-frame'));
                                    if (markerInThisFrame && nowMarkerSectionInfo.afterTaskIdx === ti) {
                                      items.push(renderDesktopNowMarker(`desktop-now-frame-${si}-${ti}`));
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
                            elements.push(renderDesktopNowMarker(`desktop-now-unframed-${si}`));
                          }
                          section.tasks.forEach((task, ti) => {
                            elements.push(renderTaskItem(task, 'desktop-glance'));
                            if (markerInThisSection && nowMarkerSectionInfo.afterTaskIdx === ti) {
                              elements.push(renderDesktopNowMarker(`desktop-now-unframed-${si}-${ti}`));
                            }
                          });
                        }
                        return <React.Fragment key={`desktop-section-${si}`}>{elements}</React.Fragment>;
                      })}
                      {/* Now marker after all tasks/frames */}
                      {filteredAgenda.length > 0 && !agendaNowMarker.insideTask && (sections.length > 0 ? nowIsAfterAllSections : agendaNowMarker.insertAfterIndex >= todayAgenda.length - 1) && (() => {
                        const hr = currentTime.getHours();
                        const barColor = hr >= 22 ? 'bg-blue-500' : hr >= 19 ? 'bg-green-500' : 'bg-yellow-500';
                        const textColor = hr >= 22 ? 'text-blue-500' : hr >= 19 ? 'text-green-500' : 'text-yellow-600';
                        const subtitle = hr >= 22 ? "Get some rest so you're ready for tomorrow!" : hr >= 19 ? 'Enjoy the evening!' : 'Time to relax or tackle more tasks?';
                        return (
                          <div key="desktop-now-marker-end" className="flex gap-2.5 py-2.5">
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
                      <div className={`rounded-lg border ${borderClass} p-3`}>
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
                      <div className={`rounded-lg border ${borderClass} p-3 cursor-pointer hover:opacity-80 transition-opacity`} onClick={() => openRoutinesDashboard()}>
                        <div className={`text-xs font-semibold uppercase tracking-wide mb-2 ${textSecondary}`}>Routines</div>
                        <div className="flex flex-wrap gap-1">
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
                              <span key={r.id} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}>
                                {timeLabel && <span className="opacity-70 mr-1">{timeLabel}</span>}{r.name}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              </div>

              )}

              {/* Inbox section — shown when inbox tab active */}
              {tabletActiveTab === 'inbox' && (
              <div className="p-4">
                <div
                  onDragOver={handleDragOverInbox}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                      setDragOverInbox(false);
                    }
                  }}
                  onDrop={handleDropOnInbox}
                  className={`transition-colors ${dragOverInbox ? (darkMode ? 'bg-green-900/20 rounded-lg ring-2 ring-inset ring-green-400' : 'bg-green-50 rounded-lg ring-2 ring-inset ring-green-500') : ''}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={openNewInboxTask}
                        className="w-24 flex items-center justify-center gap-1 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        title="New Inbox Task"
                      >
                        <Plus size={14} strokeWidth={3} />
                        <span className="text-xs font-medium">New Task</span>
                      </button>
                      {aiConfig?.enabled && aiConfig.features?.smartScheduling && gtdFrames.filter(f => f.enabled).length > 0 && unscheduledTasks.filter(t => !t.completed && !t.isExample).length > 0 && (
                        <button
                          onClick={() => { setShowFramesModal(true); setFramesModalTab('schedule'); setEditingFrame(null); }}
                          className="w-24 flex items-center justify-center gap-1 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                          title="AI Smart Schedule"
                        >
                          <BrainCircuit size={14} />
                          <span className="text-xs font-medium">Schedule</span>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5">
                      {unscheduledTasks.filter(t => !t.deadline).length > 0 && (
                        <>
                          <button
                            onClick={() => { setHideCompletedInbox(prev => !prev); playUISound('click'); }}
                            className={`${hoverBg} rounded px-1.5 py-1.5 transition-colors`}
                            title={hideCompletedInbox ? 'Completed tasks hidden (click to show)' : 'Showing completed tasks (click to hide)'}
                          >
                            <CheckCircle size={14} className={hideCompletedInbox ? (darkMode ? 'text-gray-500' : 'text-stone-400') : (darkMode ? 'text-blue-400' : 'text-blue-500')} />
                          </button>
                          <button
                            onClick={() => { setInboxPriorityFilter(prev => (prev + 1) % 4); playUISound('click'); }}
                            className={`flex gap-0.5 ${hoverBg} rounded pl-1 pr-2 py-1.5 transition-colors`}
                            title={inboxPriorityFilter === 0 ? 'Showing all priorities (click to filter)' : `Showing priority ${inboxPriorityFilter}+ (click to change)`}
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
                        </>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2">
                    {filteredUnscheduledTasks.length === 0 ? (
                      <p className={`text-sm ${textSecondary} text-center py-4`}>
                        {unscheduledTasks.length === 0
                          ? "Drag tasks here to unschedule them"
                          : unscheduledTasks.length === 0
                            ? "All tasks have overdue deadlines"
                            : "No tasks match current filter"}
                      </p>
                    ) : (
                      filteredUnscheduledTasks.map(task => (
                      <div
                        key={task.id}
                        data-task-id={task.id}
                        className="notes-panel-container"
                      >
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
                          draggable
                          onDragStart={(e) => handleDragStart(task, 'inbox', e)}
                          onDragEnd={handleDragEnd}
                          className={`${task.color} rounded-lg p-3 cursor-move shadow-sm ${task.completed ? 'opacity-50' : ''} relative ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                        >
                          {task.isExample && (
                            <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm">
                              Example
                            </span>
                          )}
                          <div className="flex items-start justify-between text-white">
                            <div className="flex items-start gap-2 flex-1 min-w-0">
                              <button
                                onClick={() => toggleComplete(task.id, true)}
                                className={`mt-0.5 rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                              >
                                {task.completed && <Check size={10} strokeWidth={3} />}
                              </button>
                              <div className="flex-1 min-w-0">
                                {editingTaskId === task.id ? (
                                  <div className="relative tag-autocomplete-container">
                                    <input
                                      type="text"
                                      value={editingTaskText}
                                      onChange={(e) => handleEditInputChange(e, true)}
                                      onKeyDown={(e) => handleEditKeyDown(e, true)}
                                      onBlur={() => {
                                        setTimeout(() => {
                                          if (!showSuggestions) {
                                            saveTaskTitle(true);
                                          }
                                        }, 100);
                                      }}
                                      autoFocus
                                      className="w-full bg-white/20 text-white font-medium text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    {showSuggestions && suggestionContext === 'editing' && (
                                      <SuggestionAutocomplete
                                        suggestions={suggestions}
                                        selectedIndex={selectedSuggestionIndex}
                                        onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, true)}
                                        cardBg={cardBg}
                                        borderClass={borderClass}
                                        textPrimary={textPrimary}
                                        hoverBg={hoverBg}
                                      />
                                    )}
                                  </div>
                                ) : (
                                  <div
                                    className={`font-medium text-sm ${task.completed ? 'line-through' : ''} cursor-text`}
                                    onDoubleClick={(e) => {
                                      e.stopPropagation();
                                      startEditingTask(task, true);
                                    }}
                                    title="Double-click to edit"
                                  >
                                    {renderTitle(task.title)}
                                  </div>
                                )}
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
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                              <div className="flex items-start gap-1">
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
                                  onMouseUp={() => {
                                    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                  }}
                                  onMouseLeave={() => {
                                    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
                                  }}
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
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) || (task.importSource === 'obsidian' && extractWikilinks(task.title).length > 0) ? '' : 'opacity-40'}`}
                                  title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
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
                                <button
                                  onClick={() => openMobileEditTask(task, true)}
                                  className="hover:bg-white/20 rounded p-1 transition-colors"
                                  title="Edit"
                                >
                                  <Pencil size={14} />
                                </button>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  cyclePriority(task.id);
                                }}
                                className="flex gap-0.5 hover:bg-white/20 rounded px-2 py-1.5 mt-1 transition-colors"
                                title={['No priority', 'Low priority', 'Medium priority', 'High priority'][pendingPriorities[task.id] ?? task.priority ?? 0]}
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
                          {expandedNotesTaskId === task.id && (
                            <NotesSubtasksPanel
                              task={task}
                              isInbox={true}
                              darkMode={darkMode}
                              updateTaskNotes={updateTaskNotes}
                              addSubtask={addSubtask}
                              toggleSubtask={toggleSubtask}
                              deleteSubtask={deleteSubtask}
                              updateSubtaskTitle={updateSubtaskTitle}
                              aiConfig={aiConfig}
                              aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                              onGenerateSubtasks={generateAISubtasks}
                              wikilinks={task.importSource === 'obsidian' ? extractWikilinks(task.title) : undefined}
                              onLoadWikiNote={task.importSource === 'obsidian' ? loadWikiNote : undefined}
                              onSaveWikiNote={task.importSource === 'obsidian' ? saveWikiNote : undefined}
                            />
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  </div>
                </div>
              </div>
              )}
            </div>
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
              className={`${cardBg} border ${borderClass} overflow-y-scroll overflow-x-hidden ${darkMode ? 'dark-scrollbar' : ''} relative`}
              style={{ height: '100%', touchAction: isTablet ? 'manipulation' : undefined }}
            >
              {/* Combined sticky header — date headers + all-day section */}
              <div ref={(el) => { stickyHeaderRef.current = el; }} className={`sticky top-0 z-20 ${cardBg}`}>
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
                  <div className={`flex items-center gap-2 px-4 py-1.5 text-xs font-semibold ${darkMode ? 'bg-amber-900/40 text-amber-300 border-b border-amber-700/40' : 'bg-amber-50 text-amber-800 border-b border-amber-200'}`}>
                    <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                    <span className="truncate">Now: {renderTitle(runningTask.title)}</span>
                  </div>
                );
              })()}
              {/* Date headers row */}
              <div ref={(el) => { if (isTablet) mobileDateHeaderRef.current = el; }} className={`flex border-b ${borderClass} ${cardBg}`}>
                <div className={`w-16 flex-shrink-0 border-r ${borderClass}`}></div>
                {visibleDates.map((date, idx) => {
                  const isDateToday = dateToString(date) === dateToString(new Date());
                  const dateStr = dateToString(date);
                  const isDragOverThis = dragOverAllDay === dateStr;
                  return (
                    <div
                      key={dateStr}
                      className={`flex-1 py-2 px-3 text-center cursor-pointer hover:bg-opacity-80 transition-colors ${idx > 0 ? `border-l ${borderClass}` : ''} ${isDateToday ? (darkMode ? 'bg-blue-900/30 hover:bg-blue-900/50' : 'bg-blue-50 hover:bg-blue-100') : `${cardBg} ${darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100'}`} ${isDragOverThis ? (darkMode ? 'bg-green-700 ring-2 ring-inset ring-green-400' : 'bg-green-200 ring-2 ring-inset ring-green-500') : ''}`}
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
                      onDragOver={(e) => { e.preventDefault(); if (autoScrollInterval.current) { clearInterval(autoScrollInterval.current); autoScrollInterval.current = null; } }}
                      onDragEnter={(e) => {
                        e.preventDefault();
                        setDragOverAllDay(dateStr);
                        setDragPreviewTime(null);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget)) {
                          setDragOverAllDay(null);
                        }
                      }}
                      onDrop={(e) => handleDropOnDateHeader(e, date)}
                      title={draggedTask ? "Drop to make all-day task" : "Click to add all-day task"}
                    >
                      <div className={`font-bold flex items-center justify-center gap-1.5 ${isDateToday ? 'text-blue-600' : textPrimary}`}>
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

              {/* All-day tasks section - inside combined sticky header */}
              {(visibleDates.some(date => getTasksForDate(date).some(t => t.isAllDay) || getDeadlineTasksForDate(dateToString(date)).length > 0) || (routinesEnabled && todayRoutines.some(r => r.isAllDay))) && (
                <div ref={(el) => { if (isTablet) mobileAllDaySectionRef.current = el; }} className={`flex border-b ${borderClass} ${cardBg}`}>
                  <div className={`w-16 flex-shrink-0 px-3 py-2 text-xs font-semibold ${textSecondary} border-r ${borderClass}`}>
                    ALL DAY
                  </div>
                  {visibleDates.map((date, idx) => {
                    const dayTasks = getTasksForDate(date).filter(t => t.isAllDay).sort((a, b) => {
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
                    const deadlineTasks = getDeadlineTasksForDate(dateStr);
                    const isDragOverThis = dragOverAllDay === dateStr;
                    return (
                      <div
                        key={dateStr}
                        className={`flex-1 p-2 space-y-1 ${idx > 0 ? `border-l ${borderClass}` : ''} ${isDragOverThis || (isTablet && mobileDragPreviewTime === 'all-day') ? (darkMode ? 'bg-green-700/50' : 'bg-green-100') : ''}`}
                        onDragOver={(e) => { e.preventDefault(); if (autoScrollInterval.current) { clearInterval(autoScrollInterval.current); autoScrollInterval.current = null; } }}
                        onDragEnter={(e) => {
                          e.preventDefault();
                          setDragOverAllDay(dateStr);
                          setDragPreviewTime(null);
                        }}
                        onDragLeave={(e) => {
                          if (!e.currentTarget.contains(e.relatedTarget)) {
                            setDragOverAllDay(null);
                          }
                        }}
                        onDrop={(e) => handleDropOnDateHeader(e, date)}
                      >
                        {dayTasks.map((task) => {
                          const isImported = task.imported;
                          const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);

                          // Action buttons for all-day tasks
                          const isRecurringAllDay = typeof task.id === 'string' && task.id.startsWith('recurring-');

                          // Notes button for all-day tasks (render function, not component, to avoid remount)
                          const renderAllDayNotesButton = (inMenu = false) => (
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
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) || (task.importSource === 'obsidian' && extractWikilinks(task.title).length > 0) ? '' : 'opacity-40'}`}
                                title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                              >
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                              </button>
                          );

                          const renderAllDayActionButtons = (inMenu = false) => {
                            if (isRecurringAllDay) {
                              // Recurring all-day: Notes, Edit + Delete (desktop only)
                              return (
                                <>
                                  {renderAllDayNotesButton(inMenu)}
                                  {!isTablet && (
                                  <button
                                    onClick={() => openMobileEditTask(task, false)}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    title="Edit"
                                  >
                                    <Pencil size={14} />
                                    {inMenu && <span className="text-xs">Edit</span>}
                                  </button>
                                  )}
                                  {!isTablet && (
                                  <button
                                    onClick={() => moveToRecycleBin(task.id)}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    title="Delete"
                                  >
                                    <Trash2 size={14} />
                                    {inMenu && <span className="text-xs">Delete</span>}
                                  </button>
                                  )}
                                </>
                              );
                            }
                            // Non-recurring all-day: Notes, Postpone (all), Edit + Inbox (desktop only)
                            return (
                              <>
                                {renderAllDayNotesButton(inMenu)}
                                <button
                                  onClick={() => postponeTask(task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Postpone to tomorrow"
                                >
                                  <SkipForward size={14} />
                                  {inMenu && <span className="text-xs">Postpone</span>}
                                </button>
                                {!isTablet && (
                                <button
                                  onClick={() => openMobileEditTask(task, false)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Edit"
                                >
                                  <Pencil size={14} />
                                  {inMenu && <span className="text-xs">Edit</span>}
                                </button>
                                )}
                                {!isTablet && (
                                <button
                                  onClick={() => moveToInbox(task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Move to Inbox"
                                >
                                  <Inbox size={14} />
                                  {inMenu && <span className="text-xs">To Inbox</span>}
                                </button>
                                )}
                              </>
                            );
                          };

                          // Width-based layout for all-day tasks (no height concern)
                          const allDayTaskWidth = taskWidths[task.id];
                          const useFullLayout = allDayTaskWidth >= 200;

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
                                  isRecurring: !!isRecurringAllDay,
                                  isImported: !!isImported,
                                  isAllDay: true,
                                  dateStr,
                                });
                              }}
                              draggable={(!isImported || !!task.nativeEventId) && !isTablet}
                              onDragStart={(e) => (!isImported || !!task.nativeEventId) && handleDragStart(task, 'calendar', e)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => { e.preventDefault(); updateDragAutoScroll(e); }}
                              onDragEnter={(e) => {
                                e.preventDefault();
                                setDragOverAllDay(dateStr);
                                setDragPreviewTime(null);
                              }}
                              onDrop={(e) => handleDropOnDateHeader(e, date)}
                              className={`notes-panel-container relative ${task.completed && (!isImported || task.isTaskCalendar) ? 'opacity-50' : ''}`}
                              style={isTablet && !isImported ? { marginLeft: '12px' } : {}}
                            >
                              {/* Protruding drag tab (tablet only) */}
                              {isTablet && !isImported && (
                                <div
                                  data-drag-handle
                                  className={`absolute ${task.color} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70`}
                                  style={{ left: '-12px', top: '3px', width: '20px', height: '24px', touchAction: 'none', zIndex: 10 }}
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
                              <div className={`${isTablet ? 'rounded-lg overflow-hidden' : ''} relative`}>
                              {/* Tablet swipe strips */}
                              {isTablet && !isImported && (
                                <>
                                  <div data-swipe-strip="right" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${isRecurringAllDay ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                    {isRecurringAllDay ? (
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
                              <div
                              {...(isTablet && !isImported ? {
                                onTouchStart: (e) => handleMobileTaskTouchStart(e, task, 'allday'),
                                onTouchMove: (e) => handleMobileTaskTouchMove(e),
                                onTouchEnd: (e) => handleMobileTaskTouchEnd(e, task.id, 'allday'),
                              } : {})}
                              className={`${!isTablet ? 'notes-panel-container' : 'select-none'} ${task.isTaskCalendar ? '' : task.color} rounded-lg shadow-sm ${isImported && !task.isTaskCalendar || isTablet ? 'cursor-default' : 'cursor-move'} relative ${task.isExample ? 'border-2 border-dashed border-white/50' : ''}`}
                              style={{ ...(taskCalendarStyle || {}), ...(isTablet ? { touchAction: 'pan-y' } : {}) }}
                            >
                              {task.isExample && (
                                <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                  Example
                                </span>
                              )}
                              <div className="p-2 text-white">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    {(!isImported || task.isTaskCalendar) && (
                                      <button
                                        onClick={() => toggleComplete(task.id)}
                                        className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                      >
                                        {task.completed && <Check size={10} strokeWidth={3} />}
                                      </button>
                                    )}
                                    <Calendar size={14} className="flex-shrink-0" />
                                    {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                                    <div
                                      className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm truncate ${task.completed ? 'line-through' : ''} ${!isImported && !isTablet ? 'cursor-text' : ''} flex-1 min-w-0`}
                                      onDoubleClick={!isTablet ? (e) => {
                                        if (!isImported) {
                                          e.stopPropagation();
                                          startEditingTask(task, false);
                                        }
                                      } : undefined}
                                      title={task.title}
                                    >
                                      {!isTablet && editingTaskId === task.id ? (
                                        <div className="relative tag-autocomplete-container">
                                          <input
                                            type="text"
                                            value={editingTaskText}
                                            onChange={(e) => handleEditInputChange(e, false)}
                                            onKeyDown={(e) => handleEditKeyDown(e, false)}
                                            onBlur={() => {
                                              setTimeout(() => {
                                                if (!showSuggestions) {
                                                  saveTaskTitle(false);
                                                }
                                              }, 100);
                                            }}
                                            autoFocus
                                            className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                            onClick={(e) => e.stopPropagation()}
                                          />
                                          {showSuggestions && suggestionContext === 'editing' && (
                                            <SuggestionAutocomplete
                                              suggestions={suggestions}
                                              selectedIndex={selectedSuggestionIndex}
                                              onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                              cardBg={cardBg}
                                              borderClass={borderClass}
                                              textPrimary={textPrimary}
                                              hoverBg={hoverBg}
                                            />
                                          )}
                                        </div>
                                      ) : (
                                        renderTitle(task.title)
                                      )}
                                    </div>
                                  </div>
                                  {!isImported ? (
                                    useFullLayout ? (
                                      // Full layout: show action buttons inline
                                      <div className="flex items-center gap-0.5 flex-shrink-0">
                                        {renderAllDayActionButtons()}
                                      </div>
                                    ) : (
                                      // Compact layout: show overflow menu
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container hover:bg-white/20 rounded p-1 transition-colors flex-shrink-0"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-2 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-stone-300 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            {renderAllDayActionButtons(true)}
                                          </div>
                                        )}
                                      </button>
                                    )
                                  ) : task.notes ? (
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
                                  ) : null}
                                </div>
                              </div>
                              {/* Notes panel for all-day tasks */}
                              {expandedNotesTaskId === task.id && !isImported && (
                                <div className="notes-panel-container">
                                  <NotesSubtasksPanel
                                    task={task}
                                    isInbox={false}
                                    darkMode={darkMode}
                                    updateTaskNotes={updateTaskNotes}
                                    addSubtask={addSubtask}
                                    toggleSubtask={toggleSubtask}
                                    deleteSubtask={deleteSubtask}
                                    updateSubtaskTitle={updateSubtaskTitle}
                                    compact={false}
                                    aiConfig={aiConfig}
                                    aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                                    onGenerateSubtasks={generateAISubtasks}
                                    wikilinks={task.importSource === 'obsidian' ? extractWikilinks(task.title) : undefined}
                                    onLoadWikiNote={task.importSource === 'obsidian' ? loadWikiNote : undefined}
                                    onSaveWikiNote={task.importSource === 'obsidian' ? saveWikiNote : undefined}
                                  />
                                </div>
                              )}
                              {/* Editable notes panel for imported calendar events */}
                              {expandedNotesTaskId === task.id && isImported && (
                                <div className="notes-panel-container p-2">
                                  <div className={`p-3 rounded-lg ${darkMode ? 'bg-black/30' : 'bg-white/30'} text-white`} onClick={(e) => e.stopPropagation()}>
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
                              )}
                            </div>
                            </div>
                            </div>
                          );
                        })}

                        {/* Deadline tasks from inbox */}
                        {deadlineTasks.map((task) => (
                          <div
                            key={`deadline-${task.id}`}
                            className="notes-panel-container relative"
                            style={isTablet ? { marginLeft: '12px' } : {}}
                          >
                            {/* Protruding drag tab (tablet only) */}
                            {isTablet && (
                              <div
                                data-drag-handle
                                className={`absolute ${task.color} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70`}
                                style={{ left: '-12px', top: '3px', width: '20px', height: '24px', touchAction: 'none', zIndex: 10 }}
                                onTouchStart={(e) => handleMobileTaskTouchStart(e, { ...task, isDeadlineDrag: true }, 'deadline')}
                                onTouchMove={(e) => handleMobileTaskTouchMove(e)}
                                onTouchEnd={(e) => handleMobileTaskTouchEnd(e, task.id, 'deadline')}
                                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                              >
                                <div className="absolute top-0 left-0 h-full rounded-l-lg border-l-2 border-t-2 border-b-2 border-dashed border-white/60 pointer-events-none" style={{ width: '12px' }} />
                                <div className="absolute top-0 border-t-2 border-dashed border-white/60 pointer-events-none" style={{ left: '12px', width: '2px' }} />
                                <GripVertical size={14} />
                              </div>
                            )}
                            <div className={`relative rounded-lg ${showDeadlinePicker === task.id ? '' : 'overflow-hidden'}`}>
                            {/* Swipe action strips */}
                            <div data-swipe-strip="right" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600'} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                              <Inbox size={14} className="mr-1" />Inbox
                            </div>
                            <div data-swipe-strip="left" style={{ display: 'none', left: '8px' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                              Edit<Settings size={14} className="ml-1" />
                            </div>
                          <div
                            data-task-id={task.id}
                            data-ctx-menu
                            draggable
                            onDragStart={(e) => handleDragStart(task, 'inbox', e)}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => { e.preventDefault(); updateDragAutoScroll(e); }}
                            onDragEnter={(e) => {
                              e.preventDefault();
                              setDragOverAllDay(dateStr);
                              setDragPreviewTime(null);
                            }}
                            onDrop={(e) => handleDropOnDateHeader(e, date)}
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
                            className={`${task.color} rounded-lg shadow-sm cursor-move ${task.completed ? 'opacity-50' : 'opacity-90'} relative border-2 border-dashed border-white/60`}
                            style={{ touchAction: 'pan-y' }}
                          >
                            {task.isExample && (
                              <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                Example
                              </span>
                            )}
                            <div className="p-2 text-white">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                  <button
                                    onClick={() => toggleComplete(task.id, true)}
                                    className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                  >
                                    {task.completed && <Check size={10} strokeWidth={3} />}
                                  </button>
                                  <AlertCircle size={14} className="flex-shrink-0" />
                                  <div
                                    className={`font-semibold text-sm truncate ${task.completed ? 'line-through' : ''}`}
                                    title={task.title}
                                  >
                                    {renderTitle(task.title)}
                                  </div>
                                </div>
                                <div className="flex items-center gap-0.5 flex-shrink-0">
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
                                    className={`notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors ${hasNotesOrSubtasks(task) || (task.importSource === 'obsidian' && extractWikilinks(task.title).length > 0) ? '' : 'opacity-40'}`}
                                    title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                                  >
                                    {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); postponeDeadlineTask(task.id); }}
                                    className="hover:bg-white/20 rounded p-1 transition-colors"
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
                                      className="hover:bg-white/20 rounded p-1 transition-colors bg-white/20"
                                      title={`Deadline: ${formatDeadlineDate(task.deadline)}`}
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
                                  {!isTablet && (
                                    <button
                                      onClick={() => openMobileEditTask(task, true)}
                                      className="hover:bg-white/20 rounded p-1 transition-colors"
                                      title="Edit"
                                    >
                                      <Pencil size={14} />
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                            {/* Notes panel for deadline tasks */}
                            {expandedNotesTaskId === task.id && (
                              <div className="notes-panel-container">
                                <NotesSubtasksPanel
                                  task={task}
                                  isInbox={true}
                                  darkMode={darkMode}
                                  updateTaskNotes={updateTaskNotes}
                                  addSubtask={addSubtask}
                                  toggleSubtask={toggleSubtask}
                                  deleteSubtask={deleteSubtask}
                                  updateSubtaskTitle={updateSubtaskTitle}
                                  aiConfig={aiConfig}
                                  aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                                  onGenerateSubtasks={generateAISubtasks}
                                  wikilinks={task.importSource === 'obsidian' ? extractWikilinks(task.title) : undefined}
                                  onLoadWikiNote={task.importSource === 'obsidian' ? loadWikiNote : undefined}
                                  onSaveWikiNote={task.importSource === 'obsidian' ? saveWikiNote : undefined}
                                />
                              </div>
                            )}
                          </div>
                          </div>
                          </div>
                        ))}

                        {/* Routine pills in all-day (today only) */}
                        {routinesEnabled && dateToString(date) === dateToString(new Date()) && todayRoutines.filter(r => r.isAllDay).map((routine) => (
                          <div
                            key={`routine-${routine.id}`}
                            draggable={!isTablet}
                            onDragStart={!isTablet ? (e) => {
                              handleDragStart({ ...routine, duration: routine.duration || 15 }, 'routine', e);
                            } : undefined}
                            onDragEnd={!isTablet ? handleDragEnd : undefined}
                            {...(isTablet ? {
                              onTouchStart: (e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true, duration: routine.duration || 15 }, 'allday'),
                              onTouchMove: (e) => handleMobileTaskTouchMove(e),
                              onTouchEnd: (e) => handleMobileTaskTouchEnd(e, routine.id, 'allday'),
                            } : {})}
                            className={`rounded-full px-3 py-1 text-xs font-medium ${isTablet ? 'cursor-default select-none' : 'cursor-move'} inline-block mr-1 mb-1 ${darkMode ? 'bg-teal-700/80 text-teal-100' : 'bg-teal-600/80 text-white'}`}
                            style={isTablet ? { touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } : {}}
                          >
                            {routine.name}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
              </div>

              {/* Main calendar grid */}
              <div
                ref={timeGridRef}
                className="relative"
                onDragLeave={(e) => {
                  // Clear preview when leaving the calendar grid entirely
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDragPreviewTime(null);
                    setDragPreviewDate(null);
                  }
                }}
              >
                {hours.map((hour, index) => (
                  <div key={hour} className="relative">
                    {/* Main hour row with solid border */}
                    <div className={`flex border-b ${index === 0 ? `border-t` : ''} ${borderClass} ${index % 2 === 1 ? (darkMode ? 'bg-white/[0.04]' : 'bg-stone-100/50') : ''}`}>
                      <div className={`w-16 flex-shrink-0 px-3 py-1 text-sm ${textSecondary} border-r ${borderClass}`}>
                        {use24HourClock
                          ? `${hour.toString().padStart(2, '0')}:00`
                          : <>{hour === 0 ? 12 : hour > 12 ? hour - 12 : hour}<span className="text-[10px] ml-0.5">{hour >= 12 ? 'PM' : 'AM'}</span></>
                        }
                      </div>
                      {visibleDates.map((date, idx) => (
                        <div
                          key={dateToString(date)}
                          data-ctx-menu
                          className={`flex-1 relative h-40 calendar-slot ${idx > 0 ? `border-l ${borderClass}` : ''}`}
                          data-date={dateToString(date)}
                          onDragOver={(e) => handleDragOver(e, date)}
                          onDrop={(e) => handleDropOnCalendar(e, date)}
                          onClick={(e) => openNewTaskAtTime(e, date)}
                          onMouseMove={(e) => handleCalendarMouseMove(e, date)}
                          onMouseLeave={handleCalendarMouseLeave}
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
                    {/* Half-hour dashed line (no label) */}
                    <div className="absolute left-0 right-0 pointer-events-none" style={{ top: '80px' }}>
                      <div className={`flex border-b border-dashed ${borderClass} opacity-50`}>
                        <div className="w-16 flex-shrink-0"></div>
                        {visibleDates.map((date, idx) => (
                          <div key={dateToString(date)} className={`flex-1 ${idx > 0 ? `border-l ${borderClass}` : ''}`}></div>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Task overlay for each day column */}
                <div className="absolute top-0 left-16 right-0 bottom-0 pointer-events-none flex">
                  {visibleDates.map((date, dayIndex) => {
                    const dateStr = dateToString(date);
                    const isDateToday = dateStr === dateToString(new Date());
                    const dayTasks = getTasksForDate(date).filter(t => !t.isAllDay && (!projectFilter || t.projectId === projectFilter));
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
                                  borderLeft: `3px solid ${borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)')}`,
                                }}
                                onContextMenu={(e) => { e.preventDefault(); setFrameContextMenu({ x: e.clientX, y: e.clientY, frameId: frame.frameId, dateStr }); }}
                                onDragOver={(e) => handleDragOver(e, date)}
                                onDrop={(e) => handleDropOnCalendar(e, date)}
                                onMouseMove={(e) => handleCalendarMouseMove(e, date, true)}
                                onMouseLeave={handleCalendarMouseLeave}
                                onClick={(e) => openNewTaskAtTime(e, date, true)}
                              >
                                <span className="absolute top-1 left-1.5 text-[10px] font-medium pointer-events-none select-none" style={{ color: borderColorMap[frame.color] || (darkMode ? 'rgba(165,180,252,0.4)' : 'rgba(79,70,229,0.75)') }}>
                                  {frame.label}
                                </span>
                                {/* Resize handles */}
                                <div
                                  className="absolute top-0 left-0 right-0 h-2 cursor-n-resize"
                                  onMouseDown={(e) => handleFrameResizeStart(frame.frameId, dateStr, 'top', e)}
                                />
                                <div
                                  className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize"
                                  onMouseDown={(e) => handleFrameResizeStart(frame.frameId, dateStr, 'bottom', e)}
                                />
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
                                    className="absolute left-1 right-1 rounded pointer-events-none"
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

                        {/* Current time line - only on today */}
                        {isDateToday && (
                          <div
                            ref={currentTimeRef}
                            className="absolute left-0 right-0 pointer-events-none z-10"
                            style={{ top: `${currentTimeTop}px` }}
                          >
                            <div className="flex items-center">
                              <div className="w-2 h-2 bg-red-500 rounded-full -ml-1"></div>
                              <div className="flex-1 h-0.5 bg-red-500"></div>
                            </div>
                          </div>
                        )}

                        {/* Tasks for this day */}
                        {dayTasks.map((task) => {
                          const { top, height } = calculateTaskPosition(task);
                          const isConflicted = conflicts.some(c => c.includes(task.id));
                          const conflictPos = calculateConflictPosition(task, dayTasks);
                          const isImported = task.imported;
                          const isCalendarEvent = isImported && !task.isTaskCalendar;
                          const taskCalendarStyle = getTaskCalendarStyle(task, darkMode);
                          const isPastEvent = isCalendarEvent && isDateToday && (timeToMinutes(task.startTime) + task.duration) <= (new Date().getHours() * 60 + new Date().getMinutes());
                          const _nowMinT = new Date().getHours() * 60 + new Date().getMinutes();
                          const _taskStartT = timeToMinutes(task.startTime || '0:00');
                          const isCurrentTask = isDateToday && !task.isAllDay && !task.completed && !isCalendarEvent && _nowMinT >= _taskStartT && _nowMinT < _taskStartT + (task.duration || 0);

                          // Layout tiers for timeline tasks
                          const isMicroHeight = height <= 40;  // 15min tasks
                          const taskWidth = taskWidths[task.id];
                          const isMeasured = taskWidth !== undefined;
                          const isNarrowWidth = taskWidth < 300;

                          // Layout: narrow (< 300px) or wide (>= 300px), same for all heights
                          // Default: wide layout (30+ min, >= 200px)

                          // Action buttons component (reused in different layouts)
                          const isRecurringTask = typeof task.id === 'string' && task.id.startsWith('recurring-');

                          // Notes button (shared across all variants)
                          const NotesButton = ({ inMenu = false }) => (
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
                                className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''} ${hasNotesOrSubtasks(task) || (task.importSource === 'obsidian' && extractWikilinks(task.title).length > 0) ? '' : 'opacity-40'}`}
                                title={isLinkOnlyTask(task) ? `${getLinkUrl(task)} (hold to edit)` : "Notes & subtasks"}
                              >
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : <FileText size={14} />}
                                {inMenu && <span className="text-xs">{isLinkOnlyTask(task) ? 'Open Link' : 'Notes'}</span>}
                              </button>
                          );

                          const ActionButtons = ({ inMenu = false }) => {
                            if (isRecurringTask) {
                              // Recurring: Notes (tablet+desktop), Edit + Delete (desktop only)
                              return (
                                <>
                                  <NotesButton inMenu={inMenu} />
                                  {!isTablet && (
                                  <button
                                    onClick={() => openMobileEditTask(task, false)}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    title="Edit"
                                  >
                                    <Pencil size={14} />
                                    {inMenu && <span className="text-xs">Edit</span>}
                                  </button>
                                  )}
                                  {!isTablet && (
                                  <button
                                    onClick={() => moveToRecycleBin(task.id)}
                                    className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                    title="Delete"
                                  >
                                    <Trash2 size={14} />
                                    {inMenu && <span className="text-xs">Delete</span>}
                                  </button>
                                  )}
                                </>
                              );
                            }
                            // Non-recurring: Notes, Postpone (all), Edit + Inbox (desktop only)
                            return (
                              <>
                                <NotesButton inMenu={inMenu} />
                                <button
                                  onClick={() => postponeTask(task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Postpone to tomorrow"
                                >
                                  <SkipForward size={14} />
                                  {inMenu && <span className="text-xs">Postpone</span>}
                                </button>
                                {!isTablet && (
                                <button
                                  onClick={() => openMobileEditTask(task, false)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Edit"
                                >
                                  <Pencil size={14} />
                                  {inMenu && <span className="text-xs">Edit</span>}
                                </button>
                                )}
                                {!isTablet && (
                                <button
                                  onClick={() => moveToInbox(task.id)}
                                  className={`hover:bg-white/20 rounded p-1 transition-colors ${inMenu ? 'flex items-center gap-2 w-full' : ''}`}
                                  title="Move to Inbox"
                                >
                                  <Inbox size={14} />
                                  {inMenu && <span className="text-xs">To Inbox</span>}
                                </button>
                                )}
                              </>
                            );
                          };

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
                                  isRecurring: !!isRecurringTask,
                                  isImported: !!isImported,
                                  isAllDay: !!task.isAllDay,
                                  dateStr,
                                });
                              }}
                              draggable={(!isImported || task.isTaskCalendar || !!task.nativeEventId) && !isTablet}
                              onDragStart={(e) => (!isImported || task.isTaskCalendar || !!task.nativeEventId) && handleDragStart(task, 'calendar', e)}
                              onDragEnd={handleDragEnd}
                              onDragOver={(e) => handleDragOver(e, date)}
                              onDrop={(e) => handleDropOnCalendar(e, date)}
                              className={`absolute notes-panel-container ${task.isTaskCalendar || isTablet ? '' : task.color} ${isTablet ? '' : 'rounded-lg shadow-md'} pointer-events-auto ${isImported && !task.isTaskCalendar || isTablet ? 'cursor-default' : 'cursor-move'} ${(task.completed && (!isImported || task.isTaskCalendar)) || isPastEvent ? 'opacity-50' : ''} ${isTablet ? '' : expandedNotesTaskId === task.id ? 'overflow-visible z-30' : ''} ${task.isExample ? 'border-2 border-dashed border-white/50' : ''} ${isCurrentTask ? 'current-task-pulse' : ''}`}
                              style={{
                                top: `${top}px`,
                                height: `${height}px`,
                                minHeight: isMicroHeight ? '27px' : '39px',
                                left: conflictPos.left,
                                right: conflictPos.right,
                                width: conflictPos.width,
                                visibility: isMeasured ? 'visible' : 'hidden',
                                ...(isTablet ? { touchAction: 'pan-y' } : {}),
                                ...(isTablet ? {} : taskCalendarStyle)
                              }}
                            >
                              {task.isExample && !isTablet && (
                                <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                  Example
                                </span>
                              )}
                              {/* Tablet swipe strips - outside flex wrapper so they stay stationary */}
                              {isTablet && !isImported && (
                                <>
                                  <div data-swipe-strip="right" style={{ display: 'none' }} className={`absolute inset-0 ${isRecurringTask ? (darkMode ? 'bg-red-900/80 text-red-300' : 'bg-red-100 text-red-600') : (darkMode ? 'bg-blue-900/80 text-blue-300' : 'bg-blue-100 text-blue-600')} rounded-lg flex items-center pl-3 text-xs font-medium`}>
                                    {isRecurringTask ? (
                                      <><Trash2 size={14} className="mr-1" />Delete</>
                                    ) : (
                                      <><Inbox size={14} className="mr-1" />Inbox</>
                                    )}
                                  </div>
                                  <div data-swipe-strip="left" style={{ display: 'none' }} className={`absolute inset-0 ${darkMode ? 'bg-amber-900/80 text-amber-300' : 'bg-amber-100 text-amber-600'} rounded-lg flex items-center justify-end pr-3 text-xs font-medium`}>
                                    Edit<Settings size={14} className="ml-1" />
                                  </div>
                                </>
                              )}
                              <div className={`${isTablet ? 'flex h-full items-start' : 'h-full'}`} {...(isTablet ? { 'data-swipe-container': true } : {})}>
                              {/* Protruding drag tab (tablet only) */}
                              {isTablet && (!isImported || task.isTaskCalendar || !!task.nativeEventId) && (
                                <div
                                  data-drag-handle
                                  className={`${task.isTaskCalendar || task.nativeCalendarColor ? '' : task.color} rounded-l-lg flex items-center pl-px cursor-grab active:opacity-70 text-white/70 flex-shrink-0 relative`}
                                  style={{ width: '20px', height: '24px', marginTop: '3px', marginRight: '-8px', touchAction: 'none', zIndex: 10, ...(task.isTaskCalendar ? { backgroundColor: darkMode ? '#4b5563' : '#6b7280' } : task.nativeCalendarColor ? { backgroundColor: task.nativeCalendarColor } : {}) }}
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
                              <div className={`${isTablet ? 'flex-1 min-w-0 rounded-lg shadow-md' : ''} h-full ${isTablet ? (expandedNotesTaskId === task.id ? 'overflow-visible z-30' : 'overflow-hidden') : ''}`}>
                              {task.isExample && isTablet && (
                                <span className="absolute -top-2 -right-2 bg-yellow-400 text-yellow-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow-sm z-10">
                                  Example
                                </span>
                              )}
                              <div
                              {...(isTablet && (!isImported || task.isTaskCalendar || !!task.nativeEventId) ? {
                                onTouchStart: (e) => handleMobileTaskTouchStart(e, task, 'timeline'),
                                onTouchMove: (e) => handleMobileTaskTouchMove(e),
                                onTouchEnd: (e) => handleMobileTaskTouchEnd(e, task.id, 'timeline'),
                              } : {})}
                              className={`h-full flex text-white rounded-lg relative ${isTablet && !task.isTaskCalendar && !task.nativeCalendarColor ? task.color : ''} ${isTablet ? 'select-none' : ''}`}
                              style={{ ...(isTablet ? { touchAction: 'pan-y', ...taskCalendarStyle } : {}) }}
                              >
                                <div className="px-2 py-1 flex-1 min-w-0 h-full flex flex-col">
                                {/* IMPORTED EVENT LAYOUT: Always show time on right with truncated title */}
                                {isImported && !task.isTaskCalendar ? (
                                  <div className="flex flex-col h-full justify-between gap-0.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <div
                                        className="font-semibold text-sm leading-tight truncate flex-1 min-w-0"
                                        title={task.title}
                                      >
                                        {stripWikilinks(task.title)}
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        {task.notes && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedNotesTaskId(prev => prev === task.id ? null : task.id);
                                            }}
                                            className="notes-toggle-button hover:bg-white/20 rounded p-1 transition-colors"
                                            title="View description"
                                          >
                                            <FileText size={12} />
                                          </button>
                                        )}
                                        <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1">
                                          <Clock size={10} />
                                          {formatTime(task.startTime)} • {task.duration}m
                                        </div>
                                      </div>
                                    </div>
                                    {!isMicroHeight && (task.calendarName || task.location) && (
                                      <div className="text-xs opacity-75 truncate flex items-center gap-1">
                                        {task.calendarName && <span className="truncate max-w-[50%]">{task.calendarName}</span>}
                                        {task.calendarName && task.location && <span className="opacity-50">·</span>}
                                        {task.location && <><MapPin size={9} /><span className="truncate">{task.location}</span></>}
                                      </div>
                                    )}
                                  </div>
                                ) : isNarrowWidth ? (
                                  /* NARROW LAYOUT: overflow menu + checkbox + title + tags */
                                  <>
                                    {!isImported && (
                                      <button
                                        onClick={() => setExpandedTaskMenu(expandedTaskMenu === task.id ? null : task.id)}
                                        className="task-menu-container absolute top-0.5 right-0.5 hover:bg-white/20 rounded p-0.5 transition-colors z-10"
                                      >
                                        <MoreHorizontal size={14} />
                                        {expandedTaskMenu === task.id && (
                                          <div className="task-menu-container absolute top-full right-0 mt-1 bg-white dark:bg-gray-800 rounded-lg p-1 z-30 shadow-xl border border-stone-300 dark:border-gray-700 min-w-[100px] text-gray-800 dark:text-white">
                                            <ActionButtons inMenu={true} />
                                          </div>
                                        )}
                                      </button>
                                    )}
                                    <div className="pr-6">
                                      <div className="flex items-center gap-1">
                                        {(!isImported || task.isTaskCalendar) && (
                                          <button
                                            onClick={() => toggleComplete(task.id)}
                                            className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                          >
                                            {task.completed && <Check size={10} strokeWidth={3} />}
                                          </button>
                                        )}
                                        {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                                        {task.importSource === 'obsidian' && <BookOpen size={12} className="flex-shrink-0 opacity-75" title="From Obsidian" />}
                                        <div className="flex-1 min-w-0">
                                          {!isTablet && editingTaskId === task.id ? (
                                            <div className="relative tag-autocomplete-container">
                                              <input
                                                type="text"
                                                value={editingTaskText}
                                                onChange={(e) => handleEditInputChange(e, false)}
                                                onKeyDown={(e) => handleEditKeyDown(e, false)}
                                                onBlur={() => {
                                                  setTimeout(() => {
                                                    if (!showSuggestions) {
                                                      saveTaskTitle(false);
                                                    }
                                                  }, 100);
                                                }}
                                                autoFocus
                                                className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                                onClick={(e) => e.stopPropagation()}
                                              />
                                              {showSuggestions && suggestionContext === 'editing' && (
                                                <SuggestionAutocomplete
                                                  suggestions={suggestions}
                                                  selectedIndex={selectedSuggestionIndex}
                                                  onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                                  cardBg={cardBg}
                                                  borderClass={borderClass}
                                                  textPrimary={textPrimary}
                                                  hoverBg={hoverBg}
                                                />
                                              )}
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-0.5">
                                              <div
                                                className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''} ${!isImported && !isTablet ? 'cursor-text' : ''}`}
                                                onDoubleClick={!isTablet ? (e) => {
                                                  if (!isImported) {
                                                    e.stopPropagation();
                                                    startEditingTask(task, false);
                                                  }
                                                } : undefined}
                                                title={task.title}
                                              >
                                                {renderTitleWithoutTags(task.title)}
                                              </div>
                                              {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                                <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                              ))}
                                            </div>
                                          )}
                                          {(extractTags(task.title).length > 0 || (goalsProjectsEnabled && task.projectId)) && (
                                            <div className="flex items-center gap-1 flex-wrap text-xs italic opacity-75">
                                              {extractTags(task.title).length > 0 && (
                                                <span className="truncate">{extractTags(task.title).map(tag => `#${tag}`).join(' ')}</span>
                                              )}
                                              {goalsProjectsEnabled && task.projectId && (() => {
                                                const proj = projects.find(p => p.id === task.projectId);
                                                if (!proj) return null;
                                                return (
                                                  <button
                                                    onClick={(e) => { e.stopPropagation(); setProjectFilter(prev => prev === task.projectId ? null : task.projectId); }}
                                                    className={`not-italic inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors flex-shrink-0`}
                                                    title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                                                  >
                                                    {proj.title}
                                                  </button>
                                                );
                                              })()}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  /* WIDE LAYOUT: Title+tags row 1 with action buttons, time row 2 */
                                  <>
                                    <div className="flex items-center justify-between gap-1">
                                      <div className="flex items-center gap-1 flex-1 min-w-0">
                                        {(!isImported || task.isTaskCalendar) && (
                                          <button
                                            onClick={() => toggleComplete(task.id)}
                                            className={`rounded flex-shrink-0 ${task.completed ? 'bg-white/40' : 'bg-white/20'} border-2 border-white w-4 h-4 flex items-center justify-center hover:bg-white/30 transition-colors`}
                                          >
                                            {task.completed && <Check size={10} strokeWidth={3} />}
                                          </button>
                                        )}
                                        {task.isRecurring && <RefreshCw size={12} className="flex-shrink-0 opacity-75 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); setEditingRecurrenceTaskId(task.id); }} />}
                                        {task.importSource === 'obsidian' && <BookOpen size={12} className="flex-shrink-0 opacity-75" title="From Obsidian" />}
                                        <div className="flex-1 min-w-0">
                                          {!isTablet && editingTaskId === task.id ? (
                                            <div className="relative tag-autocomplete-container">
                                              <input
                                                type="text"
                                                value={editingTaskText}
                                                onChange={(e) => handleEditInputChange(e, false)}
                                                onKeyDown={(e) => handleEditKeyDown(e, false)}
                                                onBlur={() => {
                                                  setTimeout(() => {
                                                    if (!showSuggestions) {
                                                      saveTaskTitle(false);
                                                    }
                                                  }, 100);
                                                }}
                                                autoFocus
                                                className="w-full bg-white/20 text-white font-semibold text-sm px-1 py-0.5 rounded border border-white/30 outline-none focus:bg-white/30"
                                                onClick={(e) => e.stopPropagation()}
                                              />
                                              {showSuggestions && suggestionContext === 'editing' && (
                                                <SuggestionAutocomplete
                                                  suggestions={suggestions}
                                                  selectedIndex={selectedSuggestionIndex}
                                                  onSelect={(suggestion) => applySuggestionForEdit(suggestion, editingInputRef.current, false)}
                                                  cardBg={cardBg}
                                                  borderClass={borderClass}
                                                  textPrimary={textPrimary}
                                                  hoverBg={hoverBg}
                                                />
                                              )}
                                            </div>
                                          ) : (
                                            <div className="flex items-center gap-0.5">
                                              <div
                                                className={`${task.isTaskCalendar ? 'font-bold' : 'font-semibold'} text-sm leading-tight truncate flex-1 min-w-0 ${task.completed ? 'line-through' : ''} ${!isImported && !isTablet ? 'cursor-text' : ''}`}
                                                onDoubleClick={!isTablet ? (e) => {
                                                  if (!isImported) {
                                                    e.stopPropagation();
                                                    startEditingTask(task, false);
                                                  }
                                                } : undefined}
                                                title={!isImported && !isTablet ? "Double-click to edit" : undefined}
                                              >
                                                {renderTitleWithoutTags(task.title)}
                                              </div>
                                              {isNativeAndroid() && extractWikilinks(task.title).map((note, i) => (
                                                <button key={i} className="flex-shrink-0 text-purple-200 active:text-purple-100" onClick={(e) => { e.stopPropagation(); window.DayGlanceObsidian?.openNote(note); }} title={`Open "${note}" in Obsidian`}><NotebookPen size={14} /></button>
                                              ))}
                                            </div>
                                          )}
                                          {(extractTags(task.title).length > 0 || (goalsProjectsEnabled && task.projectId)) && (
                                            <div className="flex items-center gap-1 flex-wrap text-xs italic opacity-75">
                                              {extractTags(task.title).length > 0 && (
                                                <span className="truncate">{extractTags(task.title).map(tag => `#${tag}`).join(' ')}</span>
                                              )}
                                              {goalsProjectsEnabled && task.projectId && (() => {
                                                const proj = projects.find(p => p.id === task.projectId);
                                                if (!proj) return null;
                                                return (
                                                  <button
                                                    onClick={(e) => { e.stopPropagation(); setProjectFilter(prev => prev === task.projectId ? null : task.projectId); }}
                                                    className={`not-italic inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-white/25 hover:bg-white/40 text-white font-medium transition-colors flex-shrink-0`}
                                                    title={projectFilter === task.projectId ? 'Clear project filter' : `Filter: ${proj.title}`}
                                                  >
                                                    {proj.title}
                                                  </button>
                                                );
                                              })()}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      {!isImported && (
                                        <div className="flex items-center gap-0.5 flex-shrink-0">
                                          <ActionButtons />
                                        </div>
                                      )}
                                    </div>
                                    {!isImported && height >= 55 && (
                                      <div className="text-xs opacity-90 whitespace-nowrap flex items-center gap-1 mt-0.5">
                                        <Clock size={10} />
                                        {formatTime(task.startTime)} • {task.duration}min
                                      </div>
                                    )}
                                  </>
                                )}
                                </div>{/* end content wrapper */}
                                {/* Resize handle at bottom - solid white for visibility */}
                                {(!isImported || !!task.nativeEventId) && (
                                  <div
                                    onMouseDown={(e) => handleResizeStart(task, e)}
                                    onTouchStart={(e) => handleTouchResizeStart(task, e)}
                                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    className="absolute bottom-0 left-1/3 right-1/3 h-3 cursor-ns-resize hover:bg-white/20 flex items-center justify-center select-none"
                                    style={{ marginBottom: '-4px', touchAction: 'none', WebkitTouchCallout: 'none' }}
                                  >
                                    <div className="w-12 h-1 bg-white rounded-full"></div>
                                  </div>
                                )}
                                {/* Notes panel - floating below task (or above if task ends after 22:00) */}
                                {expandedNotesTaskId === task.id && !isImported && (() => {
                                  const startMin = timeToMinutes(task.startTime || '0:00');
                                  const endMin = startMin + (task.duration || 0);
                                  const showAbove = endMin >= 22 * 60;
                                  return (
                                    <div
                                      className="notes-panel-container absolute left-0 right-0 z-40"
                                      style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
                                    >
                                      <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
                                        <NotesSubtasksPanel
                                          task={task}
                                          isInbox={false}
                                          darkMode={darkMode}
                                          updateTaskNotes={updateTaskNotes}
                                          addSubtask={addSubtask}
                                          toggleSubtask={toggleSubtask}
                                          deleteSubtask={deleteSubtask}
                                          updateSubtaskTitle={updateSubtaskTitle}
                                          compact={false}
                                          aiConfig={aiConfig}
                                          aiSubtasksLoadingForTask={aiSubtasksLoadingForTask}
                                          onGenerateSubtasks={generateAISubtasks}
                                          wikilinks={task.importSource === 'obsidian' ? extractWikilinks(task.title) : undefined}
                                          onLoadWikiNote={task.importSource === 'obsidian' ? loadWikiNote : undefined}
                                          onSaveWikiNote={task.importSource === 'obsidian' ? saveWikiNote : undefined}
                                        />
                                      </div>
                                    </div>
                                  );
                                })()}
                                {/* Editable notes panel for imported calendar events */}
                                {expandedNotesTaskId === task.id && isImported && (() => {
                                  const startMin = timeToMinutes(task.startTime || '0:00');
                                  const endMin = startMin + (task.duration || 0);
                                  const showAbove = endMin >= 22 * 60;
                                  return (
                                    <div
                                      className="notes-panel-container absolute left-0 right-0 z-40"
                                      style={showAbove ? { bottom: `${height}px` } : { top: `${height}px` }}
                                    >
                                      <div className={`${task.color} rounded-lg shadow-lg ${showAbove ? 'mb-1' : 'mt-1'}`}>
                                        <div className={`p-3 rounded-lg ${darkMode ? 'bg-black/30' : 'bg-white/30'} text-white`} onClick={(e) => e.stopPropagation()}>
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
                              </div>{/* end inner overflow (tablet) */}
                              </div>{/* end flex items-start (tablet) */}
                            </div>
                          );
                        })}

                        {/* Timeline routine pills (today only) */}
                        {routinesEnabled && dateStr === dateToString(new Date()) && (() => {
                          const timelineRoutines = todayRoutines.filter(r => !r.isAllDay && r.startTime);
                          if (timelineRoutines.length === 0) return null;

                          // Compute side-by-side columns for overlapping routine chips
                          const routineColumns = [];
                          const sorted = [...timelineRoutines].sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
                          sorted.forEach(r => {
                            const rStart = timeToMinutes(r.startTime);
                            const rEnd = rStart + r.duration;
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

                          // Build a map from routine id to its column index
                          const colMap = {};
                          routineColumns.forEach((col, ci) => col.forEach(r => { colMap[r.id] = ci; }));

                          // For each routine, compute max simultaneously active routines at any point in its span
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
                            const { top, height } = calculateTaskPosition(routine);
                            const colIdx = colMap[routine.id];
                            const cols = overlapCount[routine.id];
                            const widthPercent = cols > 1 ? `${100 / cols}%` : '100%';
                            const leftPercent = cols > 1 ? `${(colIdx * 100) / cols}%` : '0%';
                            const endMinutes = timeToMinutes(routine.startTime) + routine.duration;
                            const isPast = endMinutes <= nowMinutes;

                            return (
                              <div
                                key={`routine-tl-${routine.id}`}
                                draggable={!isTablet}
                                onDragStart={!isTablet ? (e) => handleDragStart({ ...routine }, 'routine', e) : undefined}
                                onDragEnd={!isTablet ? handleDragEnd : undefined}
                                onDragOver={(e) => handleDragOver(e, date)}
                                onDrop={(e) => handleDropOnCalendar(e, date)}
                                {...(isTablet ? {
                                  onTouchStart: (e) => handleMobileTaskTouchStart(e, { ...routine, isRoutineDrag: true }, 'timeline'),
                                  onTouchMove: (e) => handleMobileTaskTouchMove(e),
                                  onTouchEnd: (e) => handleMobileTaskTouchEnd(e, routine.id, 'timeline'),
                                } : {})}
                                className={`absolute pointer-events-auto ${isTablet ? 'cursor-default select-none' : 'cursor-move'} flex items-center justify-center ${isPast ? 'opacity-50' : ''}`}
                                style={{
                                  top: `${top}px`,
                                  height: `${Math.max(height, 27)}px`,
                                  left: `calc(${leftPercent} + 4px)`,
                                  width: `calc(${widthPercent} - 8px)`,
                                  ...(isTablet ? { touchAction: 'none', WebkitTouchCallout: 'none', WebkitUserSelect: 'none' } : {}),
                                }}
                              >
                                {/* Teal cross lines — horizontal + vertical */}
                                <div className={`absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                                <div className={`absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-1.5 rounded-full ${darkMode ? 'bg-teal-700/80' : 'bg-teal-600/80'}`}></div>
                                {/* Compact pill label centered */}
                                <span className={`relative rounded-full px-3 py-1 text-xs font-medium ${darkMode ? 'bg-teal-700 text-teal-100' : 'bg-teal-600 text-white'}`}>{routine.name}</span>
                                {/* Desktop: Resize handle (drag) */}
                                {!isTablet && (
                                  <div
                                    className="absolute bottom-0 left-0 right-0 h-3 cursor-ns-resize flex justify-center items-center"
                                    onMouseDown={(e) => handleRoutineResizeStart(routine, e)}
                                    style={{ marginBottom: '-4px' }}
                                  >
                                    <div className="w-8 h-1 rounded-full bg-white"></div>
                                  </div>
                                )}
                                {/* Tablet: Touch resize handle */}
                                {isTablet && (
                                  <div
                                    onTouchStart={(e) => handleTouchRoutineResizeStart(routine, e)}
                                    className="absolute bottom-0 left-1/3 right-1/3 h-3 hover:bg-white/20 active:bg-white/20 flex items-center justify-center select-none"
                                    style={{ marginBottom: '-4px', touchAction: 'none', WebkitTouchCallout: 'none' }}
                                  >
                                    <div className="w-12 h-1 bg-white rounded-full"></div>
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}

                        {/* Hover preview line - shows where a new task would start */}
                        {hoverPreviewTime && !draggedTask && !isResizing && hoverPreviewDate && dateToString(hoverPreviewDate) === dateStr && (
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

                        {/* Drag preview - hover bar style */}
                        {dragPreviewTime && draggedTask && dragPreviewDate && dateToString(dragPreviewDate) === dateStr && (() => {
                          const dragMinutes = timeToMinutes(dragPreviewTime);
                          const dragTop = Math.round(minutesToPosition(dragMinutes));
                          return (
                            <div
                              className="absolute left-0 right-0 pointer-events-none z-20"
                              style={{ top: `${dragTop}px` }}
                            >
                              <div className="relative">
                                <div className={`absolute bottom-0.5 right-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${darkMode ? 'bg-blue-500 text-white' : 'bg-blue-600 text-white'}`}>
                                  {formatTime(dragPreviewTime)}
                                </div>
                                <div className="h-0.5 bg-blue-500"></div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* Tablet touch drag preview - hover bar style */}
                        {isTablet && mobileDragPreviewTime && mobileDragPreviewTime !== 'all-day' && mobileDragTaskIdState && mobileDragPreviewDate === dateStr && (() => {
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
                      </div>
                    );
                  })}
                </div>
              </div>
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
      </>
);
};

export default DesktopLayout;
