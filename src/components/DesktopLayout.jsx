import React, { useState, useRef } from 'react';
import {
  AlertCircle, AlertTriangle, Archive, Bell, BookOpen, BrainCircuit,
  Calendar, CalendarDays, Check, CheckCircle, CheckSquare, ChevronDown,
  ChevronLeft, ChevronRight, ChevronUp, Clock, Cloud, ExternalLink,
  Eye, FileText, Filter, GitBranch, GripVertical, Hash, HelpCircle, Inbox, Key,
  Layers, LayoutGrid, Link, Loader, MapPin, Menu, Mic, Minus, Moon, MoreHorizontal,
  NotebookPen, Pencil, Pin, Plus, RefreshCw, Save, Search, Settings,
  SkipForward, Sparkles, Sun, Target, Trash2, Upload, X,
} from 'lucide-react';
import { isNativeAndroid, nativeUpdateEvent } from '../native.js';
import { renderTitle, renderTitleWithoutTags, getLinkUrl, hasNotesOrSubtasks, isLinkOnlyTask, hasOnlySubtasks, isObsidianNoteOnlyTask } from '../utils/textFormatting.jsx';
import { dateToString, extractTags, extractWikilinks, formatDate, formatDateRange, formatDeadlineDate, stripWikilinks } from '../utils/taskUtils.js';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import SuggestionAutocomplete from './SuggestionAutocomplete.jsx';
import DesktopHeader from './DesktopHeader.jsx';
import CalendarHeader from './CalendarHeader.jsx';
import InboxArchivedBar from './InboxArchivedBar.jsx';
import GlanceSidebar from './GlanceSidebar.jsx';
import InboxSidebar from './InboxSidebar.jsx';
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
    hideStandaloneTasksInbox, inboxTagFilter, inboxProjectFilter, setInboxProjectFilter,
    archiveInboxTask,
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
              className={`${cardBg} border ${borderClass} overflow-y-scroll overflow-x-hidden ${darkMode ? 'dark-scrollbar' : ''} relative`}
              style={{ height: '100%', touchAction: isTablet ? 'manipulation' : undefined }}
            >
              {/* Combined sticky header — date headers + all-day section */}
              <div ref={(el) => { stickyHeaderRef.current = el; }} className={`sticky top-0 z-20 ${cardBg}`}>
              <CalendarHeader />
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
                                {isLinkOnlyTask(task) ? <ExternalLink size={14} /> : hasOnlySubtasks(task) ? <CheckSquare size={14} /> : isObsidianNoteOnlyTask(task) ? <BookOpen size={14} /> : <FileText size={14} />}
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
