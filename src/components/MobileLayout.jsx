import React, { useState, useRef, useMemo } from 'react';
import Wordmark from './Wordmark';
import {
  Activity, AlertCircle, AlertTriangle, Archive, BarChart3, Bell,
  BookOpen, BrainCircuit, Calendar, CalendarDays, Check, CheckCircle,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Cloud, Eye,
  Filter, Flag, Flame, FolderOpen, GitBranch, Globe, GripVertical, Hash,
  HelpCircle, Inbox, Key, Layers, LayoutGrid, Link, Loader, Menu, Mic,
  Minus, Moon, MoreHorizontal, NotebookPen, Plus, RefreshCw, Save, Search,
  Settings, SkipForward, Sparkles, Sun, Target, Telescope, Trash2,
  TrendingUp, Trophy, Undo2, Upload, Volume2, VolumeX, Wifi, X, Zap,
} from 'lucide-react';
import { isNativeAndroid } from '../native.js';
import { renderTitle, hasNotesOrSubtasks, isLinkOnlyTask, openNoteAction, NoteIcon } from '../utils/textFormatting.jsx';
import { dateToString, extractTags, extractWikilinks, formatDate, formatDateRange, formatDeadlineDate, formatShortDate } from '../utils/taskUtils.js';
import { formatLocalizedDate, localizedWeekdays } from '../utils/localeFormatting.js';
import { findRunningTask } from '../utils/runningTask.js';
import { HABIT_COLORS, HABIT_ICONS } from '../constants/habits.js';
import { cloudSyncProviders } from '../utils/cloudSyncProviders.js';
import { PROVIDER_MODELS, PROVIDER_LABELS, aiFeatureOn } from '../ai.js';
import { HabitRing, MiniHabitRing } from './HabitRing.jsx';
import GettingStartedChecklist from './GettingStartedChecklist.jsx';
import NotesSubtasksPanel from './NotesSubtasksPanel.jsx';
import EventNotesPanel, { editsDeviceCalendar } from './EventNotesPanel.jsx';
import FrameEditor from './FrameEditor.jsx';
import SmartSchedulePanel from './SmartSchedulePanel.jsx';
import DailyNotesModal from './DailyNotesModal.jsx';
import CloudSyncSettingsForm from './CloudSyncSettingsForm.jsx';
import AutoBackupSettingsForm from './AutoBackupSettingsForm.jsx';
import FrameNudgeCard from './FrameNudgeCard.jsx';
import DeadlinePickerPopover from './DeadlinePickerPopover.jsx';
import MobileTabBar from './MobileTabBar.jsx';
import MobileSettingsPanel from './MobileSettingsPanel.jsx';
import GoalDashboard from './goals/GoalDashboard.jsx';
import MobileTimeGrid from './MobileTimeGrid.jsx';
import MobileJoboView from './jobo/MobileJoboView.jsx';
import MobileJoboHeaderActions from './jobo/MobileJoboHeaderActions.jsx';
import SummaryStrip from './SummaryStrip.jsx';
import { MOBILE_HOUR_GUTTER_W } from '../constants/timeline.js';
import MobileAllDaySection from './MobileAllDaySection.jsx';
import MobileBottomSheets from './MobileBottomSheets.jsx';
import MobileGlanceSection from './MobileGlanceSection.jsx';
import MobileViewToggle from './MobileViewToggle.jsx';
import DayHeaderCell from './DayHeader.jsx';
import MonthStats from './month/MonthStats.jsx';
import DayDialIcon from './DayDialIcon.jsx';
import MobileListView from './MobileListView.jsx';
import SchedView from './sched/SchedView.jsx';
import MonthView from './month/MonthView.jsx';
import { useDayPlannerCtx } from '../context/DayPlannerContext.jsx';
import { useSyncCtx } from '../context/SyncContext.jsx';
import { useFeaturesCtx } from '../context/FeaturesContext.jsx';
import InboxFilterPopover from './InboxFilterPopover.jsx';
import InboxArchivedBar from './InboxArchivedBar.jsx';
import InboxFilterButtons from './InboxFilterButtons.jsx';
import { useTranslation } from 'react-i18next';
import { notBucketed } from '../utils/bucketList.js';
import useGlanceFabs from '../hooks/useGlanceFabs.js';
import { glanceFabStagger, glanceFabVisibilityClass } from '../utils/glanceFabs.js';
import TouchInboxTaskRow from './TouchInboxTaskRow.jsx';
import useIncrementalList from '../hooks/useIncrementalList.js';
import { keyboardOverTabLayout, keyboardSheet } from '../utils/keyboardInset.js';

// The task notes and subtasks sheet sits on the soft keyboard rather than under it.
const NOTES_SHEET = keyboardSheet('60vh');

const MobileLayout = () => {
  const [tzBannerDismissed, setTzBannerDismissed] = useState(false);
  const { collapsed: glanceFabsCollapsed, toggle: toggleGlanceFabs } = useGlanceFabs();
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
    mobileViewMode, setMobileViewMode,
    homeTimezone,
    mobileWelcomeStep, setMobileWelcomeStep,
    desktopWelcomeStep, setDesktopWelcomeStep,
    showMonthView, setShowMonthView,
    setShowDayDial,
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
    mobileDragIsRoutine,
    mobileDragPreviewTime, setMobileDragPreviewTime,
    mobileDragPreviewDate, setMobileDragPreviewDate,
    mobileDragOverTrash,
    trashFabRef,
    timelineScrolledAway, setTimelineScrolledAway,
    isToday, currentTimeMinutes, currentHour, currentTimeTop, showCurrentTimeLine,
    bgClass, cardBg, borderClass, textPrimary, textSecondary, hoverBg,
    colors,
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
    openNewTaskAtTime, openNewTaskForm, openNewAllDayTask, openNewInboxTask,
    recordDeletedTaskTombstone, parseRecurringId,
    expandMultiDayEvent,
    getHourHeight, minutesToPosition, positionToMinutes, durationToHeight,
    calculateTaskPosition, getTimeFromCursorPosition,
    getAdjustedTimeForImportedConflicts,
    getConflictingTasks, calculateConflictPosition, wouldExceedMaxColumns,
    filterByTags,
    getTasksForDate, getDateIndicators, hasTasksOnDate,
    getDayName, getMonthDays,
    weekStartDay,
    getTodayStr, getOverdueTasks,
    getTaskCalendarStyle,
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
    sendTaskToBucket,
  } = useDayPlannerCtx();
  const { t, i18n } = useTranslation();

  const {
    autoBackupInProgressRef, syncAllRef,
    cloudSyncDebounceRef, suppressCloudUploadRef, suppressTimestampRef,
    suppressClearPendingRef, cloudSyncInProgressRef, cloudSyncInitialDoneRef,
    cloudSyncDownloadRef,
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
    loadData, saveData,
    cloudSyncDownload, cloudSyncTest, syncAll,
    performObsidianSync, loadWikiNote, saveWikiNote, openInObsidian,
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
    habitsEnabled,
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
    setGtdFrames, myFrames,
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

  const [showInboxFilter, setShowInboxFilter] = useState(false);
  // The Inbox rows' handlers (TouchInboxTaskRow, #2143): one ref, refreshed
  // every render, so the memoized rows keep stable props and still call the
  // latest functions. The phone opens a task's notes in its own overlay.
  const touchRowActions = useRef(null);
  touchRowActions.current = {
    setTaskContextMenu, toggleComplete, startEditingTask,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,
    setProjectFilter, setInboxProjectFilter,
    longPressTriggeredRef, longPressTimerRef, setExpandedNotesTaskId, setShowDeadlinePicker,
    sendTaskToBucket, archiveInboxTask, cyclePriority,
  };
  const touchProjectsById = new Map((projects || []).map(p => [p.id, p]));
  // The Inbox renders a part at a time (useIncrementalList, #2143).
  const phoneInboxTasks = useMemo(() => filteredUnscheduledTasks.filter(t => !t.isExample), [filteredUnscheduledTasks]);
  const { visible: visibleInboxTasks, hasMore: moreInboxTasks, sentinelRef: moreInboxRef } = useIncrementalList(phoneInboxTasks, {
    keep: [editingTaskId, expandedNotesTaskId, showDeadlinePicker],
  });
  // The Inbox's Smart Schedule FAB: AI scheduling on, a frame to schedule
  // into, and an open inbox task to place (the desktop header's same test).
  const inboxSmartScheduleAvailable = !!(aiFeatureOn(aiConfig, 'smartScheduling')
    && myFrames.filter(f => f.enabled).length > 0
    && unscheduledTasks.filter(t => notBucketed(t) && !t.completed && !t.isExample).length > 0);
  const inboxFilterBtnRef = useRef(null);
  const inboxFilterActive =
    hideCompletedInbox ||
    hideStandaloneTasksInbox ||
    (goalsProjectsEnabled && !hideProjectTasksInbox) ||
    inboxTagFilter.length > 0 ||
    inboxProjectFilter.length > 0;

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
                  <button onClick={() => changeDate(-1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label={t('shortcuts.prevStep')}>
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
                      {mobileViewMode === 'month'
                        ? formatLocalizedDate(selectedDate, { month: 'long', year: 'numeric' }, i18n.resolvedLanguage || i18n.language)
                        : formatDateRange(visibleDates, t, i18n.resolvedLanguage || i18n.language)}
                    </button>
                    {dateToString(selectedDate) !== dateToString(new Date()) && (
                      <button
                        onClick={goToToday}
                        className="px-3 py-0.5 text-xs bg-blue-600 text-white rounded-full hover:bg-blue-700 active:bg-blue-700 transition-colors"
                      >
                        {t('common.today')}
                      </button>
                    )}
                  </div>
                  <button onClick={() => changeDate(1)} className={`p-2 rounded-lg hover:bg-black/5 active:bg-black/10 dark:hover:bg-white/5 dark:active:bg-white/10 transition-colors`} aria-label={t('shortcuts.nextStep')}>
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
                        aria-label={t('common.back')}
                      >
                        <ChevronLeft size={18} className={textSecondary} />
                      </button>
                      <div className={`font-bold ${textPrimary}`}>
                        {formatLocalizedDate(viewedMonth, { month: 'long', year: 'numeric' })}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); changeViewedMonth(1); }}
                        className={`p-1 rounded ${hoverBg} transition-colors`}
                        aria-label={t('common.next')}
                      >
                        <ChevronRight size={18} className={textSecondary} />
                      </button>
                    </div>
                    <div className="grid grid-cols-7 gap-1 mb-2">
                      {(() => { const d = localizedWeekdays('narrow'); return [...d.slice(weekStartDay), ...d.slice(0, weekStartDay)]; })().map((day, index) => (
                        <div key={`${index}-${day}`} className={`text-xs font-semibold ${textSecondary} text-center`}>
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
                {/* Title only, like the Goals tab: New Task and Schedule are the
                    tab's FABs, and the filters sit under this header. */}
                <div className="px-4 py-3">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <Inbox size={20} /> {t('settings.inbox')}
                  </h2>
                </div>
              </div>
            )}

            {mobileActiveTab === 'goals' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                {/* Title only: creating things is the tab's FAB (GoalDashboard),
                    as in the desktop space; Add Area lives in Manage Areas. */}
                <div className="px-4 py-3">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <GitBranch size={20} className="text-blue-500" /> {t('goals.dashboardTitle')}
                  </h2>
                </div>
              </div>
            )}
            {mobileActiveTab === 'settings' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="flex items-center justify-between px-4 py-3">
                  <h2 className={`font-bold text-lg ${textPrimary} flex items-center gap-2`}>
                    <Settings size={20} /> {t('common.settings')}
                  </h2>
                </div>
              </div>
            )}
            {mobileActiveTab === 'dayglance' && (
              <div className={`${cardBg} border-b ${borderClass} sticky top-0 z-30`}>
                <div className="relative flex items-center justify-center px-4 py-3">
                  <Wordmark className="text-3xl" darkMode={darkMode} />
                  {/* Touch entry to the Day Dial — mirrors the desktop header
                      button; the wordmark stays centered, the dial sits in the
                      header's empty right flank. */}
                  <button
                    onClick={() => setShowDayDial(true)}
                    className={`absolute right-3 p-2.5 rounded-lg ${hoverBg} active:bg-black/10 dark:active:bg-white/10 transition-colors`}
                    title={t('shortcuts.dayDial', { defaultValue: 'Day Dial' })}
                    aria-label={t('shortcuts.dayDial', { defaultValue: 'Day Dial' })}
                  >
                    <DayDialIcon size={22} className={textSecondary} />
                  </button>
                </div>
              </div>
            )}

            {/* Mobile Tab Content */}
            {mobileActiveTab === 'timeline' && (
              <div className="px-0 flex-1 min-h-0">
                {/* Reuse existing calendar grid for single day */}
                <div
                  ref={calendarRef}
                  className={`${cardBg} border ${borderClass} ${mobileViewMode === 'month' ? 'overflow-hidden flex flex-col' : `overflow-y-scroll overflow-x-hidden ${darkMode ? 'dark-scrollbar' : ''}`} relative h-full`}
                >
                  {/* Timezone mismatch strip */}
                  {!tzBannerDismissed && Intl.DateTimeFormat().resolvedOptions().timeZone !== homeTimezone && (
                    <div className={`flex items-center gap-2 px-3 py-2 text-xs border-b ${darkMode ? 'bg-amber-900/20 border-amber-800 text-amber-300' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                      <Globe size={12} className="flex-shrink-0" />
                      <span className="flex-1 min-w-0 truncate">
                        Device timezone differs from home ({homeTimezone.replace(/_/g, ' ')})
                      </span>
                      <button
                        onClick={() => setTzBannerDismissed(true)}
                        className="flex-shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )}

                  {/* Sticky header group: date header + all-day section */}
                  <div ref={mobileDateHeaderRef} className={`sticky top-0 z-40 ${cardBg}`}>
                  {/* Current task banner */}
                  {(() => {
                    const runningTask = findRunningTask([...tasks, ...expandedRecurringTasks]);
                    if (!runningTask) return null;
                    return (
                      <div className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold ${darkMode ? 'bg-amber-900/40 text-amber-300 border-b border-amber-700/40' : 'bg-amber-50 text-amber-800 border-b border-amber-200'}`}>
                        <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                        <span className="truncate">{t('common.now')}: {renderTitle(runningTask.title)}</span>
                      </div>
                    );
                  })()}
                  <div className={`flex border-b ${borderClass} ${mobileDragPreviewTime === 'all-day' ? 'ring-2 ring-inset ring-blue-500' : ''}`}>
                    <div className={`w-12 flex-shrink-0 border-r ${borderClass} ${mobileDragPreviewTime === 'all-day' ? 'flex items-center justify-center' : ''}`}>
                      {mobileDragPreviewTime === 'all-day'
                        ? <span className="text-[9px] font-bold text-blue-500">{t('task.allDay')}</span>
                        : <MobileViewToggle />
                      }
                    </div>
                    {/* MONTH: the selected day's header; every other mode, the day's own. */}
                    {(mobileViewMode === 'month' ? [selectedDate] : visibleDates).map((date, idx) => {
                      const dateStr = dateToString(date);
                      return (
                        <DayHeaderCell
                          key={dateStr}
                          date={date}
                          compact
                          className={`flex-1 ${idx > 0 ? `border-l ${borderClass}` : ''} ${mobileDragPreviewTime === 'all-day' ? (darkMode ? 'bg-blue-900/40' : 'bg-blue-100') : ''}`}
                        />
                      );
                    })}
                    {mobileViewMode === 'month' && <MonthStats compact />}
                    {mobileViewMode === 'jobo' && <MobileJoboHeaderActions className="pr-2" />}
                  </div>

                  {mobileViewMode === 'grid' && <MobileAllDaySection />}
                  </div>{/* end sticky header group */}

                  {mobileViewMode === 'grid' && <MobileTimeGrid />}
                  {mobileViewMode === 'list' && <MobileListView />}
                  {mobileViewMode === 'sched' && <SchedView />}
                  {mobileViewMode === 'month' && <MonthView />}
                  {mobileViewMode === 'jobo' && <MobileJoboView stickyHeaderRef={mobileDateHeaderRef} />}
                  {/* Summary strip. Compact (touch) variant plus the phone-only
                      FAB clearance. GRID floats it sticky over the timeline;
                      LIST places it statically after the day's content — a
                      sticky overlay there reads as an extension of the list's
                      spine, so it sits below the day as its own element.
                      DesktopLayout renders the tablet's pair the same way. */}
                  {mobileViewMode === 'grid' && <SummaryStrip compact fabClearance gutterInset={MOBILE_HOUR_GUTTER_W} />}
                  {mobileViewMode === 'list' && <SummaryStrip compact fabClearance staticPlacement />}
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
                    <div className="notes-panel-container fixed inset-0 z-50 flex flex-col justify-end" style={NOTES_SHEET.overlay} onClick={() => setExpandedNotesTaskId(null)}>
                      <div className="bg-black/30 absolute inset-0" />
                      <div
                        className={`relative ${cardBg} rounded-t-2xl shadow-xl overflow-y-auto`}
                        style={{ ...NOTES_SHEET.sheet, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
                          <div className={`font-medium ${textPrimary} truncate flex-1`}>{renderTitle(noteTask.title)}</div>
                           <button onClick={() => setExpandedNotesTaskId(null)} className={`p-1 rounded-lg ${hoverBg} transition-colors`} aria-label={`${t('common.close')} ${t('task.notes')}`}>
                            <X size={18} className={textSecondary} />
                          </button>
                        </div>
                        <div className="p-4">
                          {editsDeviceCalendar(noteTask) ? (
                            <EventNotesPanel task={noteTask} tone="themed" rows={4} />
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
                              wikilinks={extractWikilinks(noteTask.title).length > 0 ? extractWikilinks(noteTask.title) : undefined}
                              onLoadWikiNote={extractWikilinks(noteTask.title).length > 0 ? loadWikiNote : undefined}
                              onSaveWikiNote={extractWikilinks(noteTask.title).length > 0 ? saveWikiNote : undefined}
                              onOpenInObsidian={extractWikilinks(noteTask.title).length > 0 ? openInObsidian : undefined}
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

            {mobileActiveTab === 'inbox' && (
              <div className="relative flex-1 min-h-0 flex flex-col">
              {/* Filters under the header, the Goals tab's controls row
                  (InboxFilterButtons, shared with the tablet and desktop). */}
              <div data-inbox-controls className="px-3 pt-3 flex-shrink-0">
                <InboxFilterButtons
                  filterActive={inboxFilterActive}
                  onToggleFilter={() => setShowInboxFilter(v => !v)}
                  filterButtonRef={inboxFilterBtnRef}
                />
              </div>
              {/* pb clears the FAB stack (one or two 56px buttons) so the
                  last task can scroll out from under it. */}
              <div data-inbox-list className={`px-4 pt-3 ${inboxSmartScheduleAvailable ? 'pb-40' : 'pb-24'} mobile-tab-fade-in flex-1 min-h-0 overflow-y-auto`}>
                <div className="space-y-2">
                  {filteredUnscheduledTasks.filter(t => !t.isExample).length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 px-6">
                      <div className={`relative w-16 h-16 rounded-2xl ${darkMode ? 'bg-emerald-500/15' : 'bg-emerald-50'} flex items-center justify-center mb-4`}>
                        <Inbox size={28} className={`${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                        {unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0 && (
                          <Check size={14} className={`absolute -top-1 -right-1 ${darkMode ? 'text-emerald-400' : 'text-emerald-500'}`} />
                        )}
                      </div>
                      <p className={`text-base font-semibold ${textPrimary} mb-1`}>
                        {unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0
                          ? t('inbox.zero', { defaultValue: 'Inbox zero' })
                          : unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0
                            ? t('inbox.allOverdue', { defaultValue: 'All overdue' })
                            : t('inbox.noMatches', { defaultValue: 'No matches' })}
                      </p>
                      <p className={`text-sm ${textSecondary} text-center mb-5`}>
                        {unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0
                          ? t('inbox.addTasksForLater', { defaultValue: 'Add tasks here to schedule later' })
                          : unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0
                            ? t('inbox.allTasksOverdueHint', { defaultValue: 'All inbox tasks have overdue deadlines' })
                            : t('sched.noMatchingTasks', { defaultValue: 'No tasks match the current filters.' })}
                      </p>
                      {unscheduledTasks.filter(t => notBucketed(t) && !t.isExample).length === 0 && (
                        <button
                          onClick={openNewInboxTask}
                          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium ${darkMode ? 'bg-emerald-500 text-white active:bg-emerald-600' : 'bg-emerald-500 text-white active:bg-emerald-600'} transition-colors`}
                        >
                          <Plus size={16} />
                          {t('task.addTask', { defaultValue: 'Add task' })}
                        </button>
                      )}
                    </div>
                  ) : (
                    visibleInboxTasks.map(task => (
                      <TouchInboxTaskRow
                        key={task.id}
                        task={task}
                        actions={touchRowActions}
                        notesOpen={expandedNotesTaskId === task.id}
                        deadlinePickerOpen={showDeadlinePicker === task.id}
                        pendingPriority={pendingPriorities[task.id]}
                        project={goalsProjectsEnabled && task.projectId ? touchProjectsById.get(task.projectId) || null : null}
                        projectFilterActive={!!task.projectId && projectFilter === task.projectId}
                        darkMode={darkMode}
                      />
                    ))
                  )}
                  {moreInboxTasks && <div ref={moreInboxRef} data-inbox-more aria-hidden="true" className="h-px" />}
                </div>

                {/* Mobile notes panel overlay for inbox tasks */}
                {expandedNotesTaskId && (() => {
                  const noteTask = filteredUnscheduledTasks.find(t => t.id === expandedNotesTaskId);
                  if (!noteTask) return null;
                  return (
                    <div className="notes-panel-container fixed inset-0 z-50 flex flex-col justify-end" style={NOTES_SHEET.overlay} onClick={() => setExpandedNotesTaskId(null)}>
                      <div className="bg-black/30 absolute inset-0" />
                      <div
                        className={`relative ${cardBg} rounded-t-2xl shadow-xl overflow-y-auto`}
                        style={{ ...NOTES_SHEET.sheet, paddingBottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className={`flex items-center justify-between p-4 border-b ${borderClass}`}>
                          <div className={`font-medium ${textPrimary} truncate flex-1`}>{renderTitle(noteTask.title)}</div>
                          <button onClick={() => setExpandedNotesTaskId(null)} className={`p-1 rounded-lg ${hoverBg} transition-colors`} aria-label={t('common.close')}>
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
                            wikilinks={extractWikilinks(noteTask.title).length > 0 ? extractWikilinks(noteTask.title) : undefined}
                            onLoadWikiNote={extractWikilinks(noteTask.title).length > 0 ? loadWikiNote : undefined}
                            onSaveWikiNote={extractWikilinks(noteTask.title).length > 0 ? saveWikiNote : undefined}
                            onOpenInObsidian={extractWikilinks(noteTask.title).length > 0 ? openInObsidian : undefined}
                          />
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              {/* FABs, the GLANCE tab's stack: New Task (the blue +) at the
                  bottom, Smart Schedule above it when AI scheduling can run.
                  Absolute in this column, not fixed, so they sit above the
                  Archived bar instead of over it. */}
              <div data-inbox-fabs className="absolute bottom-4 right-4 z-40 flex flex-col items-center gap-2 pointer-events-none">
                {inboxSmartScheduleAvailable && (
                  <button
                    onClick={() => { setMobileActiveTab('settings'); setMobileSettingsView('frames'); setFramesModalTab('schedule'); setEditingFrame(null); }}
                    className={`pointer-events-auto w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${
                      darkMode ? 'bg-gray-700 text-blue-300 hover:bg-gray-600' : 'bg-stone-200 text-blue-600 hover:bg-stone-300'
                    }`}
                    aria-label={t('shortcuts.smartSchedule')}
                    title={t('shortcuts.smartSchedule')}
                    data-schedule-fab
                  >
                    <BrainCircuit size={24} />
                  </button>
                )}
                <button
                  onClick={openNewInboxTask}
                  className="pointer-events-auto w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 active:bg-blue-800 flex items-center justify-center transition-colors"
                  aria-label={t('task.newInbox')}
                  title={t('task.newInbox')}
                >
                  <Plus size={28} />
                </button>
              </div>
              </div>
            )}

            {mobileActiveTab === 'inbox' && <InboxArchivedBar />}


            {/* GoalDashboard stays mounted to avoid expensive remount on every tab switch.
                It gives the soft keyboard its height, so a card's quick-add or
                the filter field is scrolled into the room above it. */}
            <div
              className={`flex flex-col flex-1 min-h-0 overflow-hidden ${mobileActiveTab === 'goals' ? '' : 'hidden'}`}
              style={{ paddingBottom: keyboardOverTabLayout() }}
            >
              <GoalDashboard embedded isActive={mobileActiveTab === 'goals'} />
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

          {/* Glance tab FABs — Daily Note bottom-left, and a right-hand column
              of Weekly Review (bottom), Daily Stats, Recycle Bin (top) sitting
              on the collapse handle. All four fold into that one handle; see
              utils/glanceFabs.js, which the desktop/tablet panel shares. */}
          {mobileActiveTab === 'dayglance' && (() => {
            const binCount = recycleBin.filter(t => !t.isExample).length;
            // Column height drives the stagger: index 0 is the button beside the
            // handle, and the recycle bin only exists when the bin is non-empty.
            const stackCount = binCount > 0 ? 3 : 2;
            const fabClass = (extra) => `w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-300 ease-out ${extra} ${glanceFabVisibilityClass(glanceFabsCollapsed)}`;
            const delay = (index) => ({ transitionDelay: `${glanceFabStagger(glanceFabsCollapsed, index, stackCount)}ms` });
            return (
              <>
                {/* Daily Note FAB — bottom-left. Its own element rather than a
                    column member: it is the lone left-hand button, level with
                    the handle, so it animates on the handle's own beat (0). */}
                <button
                  onClick={() => setDailyNotesModalDate(getTodayStr())}
                  className={`fixed left-4 z-40 ${fabClass(darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-200 text-stone-600 active:bg-stone-300')}`}
                  style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))', ...delay(0) }}
                   title={`${t('common.today')} · ${t('common.dailyNote')}`}
                >
                  {obsidianConfig?.enabled ? <BookOpen size={22} /> : <NotebookPen size={22} />}
                </button>
                {/* Right-hand column. A flex stack rather than four separately
                    positioned FABs: it keeps the narrower handle centred under
                    the 56px buttons, and closes the gap by itself when the
                    recycle-bin button comes and goes. pointer-events-none on
                    the wrapper — it is taller than the buttons it holds. */}
                <div
                  className="fixed right-4 z-40 flex flex-col items-center gap-2 pointer-events-none"
                  style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom, 0px))' }}
                >
                  {/* Recycle bin FAB */}
                  {binCount > 0 && (
                    <button
                      onClick={() => setShowMobileRecycleBin(true)}
                      className={fabClass(darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-200 text-stone-600 active:bg-stone-300')}
                      style={delay(2)}
                    >
                      <div className="relative">
                        <Trash2 size={22} />
                        <span className="absolute -top-2 -right-3 bg-red-500 text-white text-[10px] font-bold min-w-[18px] h-[18px] flex items-center justify-center rounded-full px-1">
                          {binCount > 9 ? '9+' : binCount}
                        </span>
                      </div>
                    </button>
                  )}
                  {/* Daily summary ring FAB */}
                  {(() => {
                    const pct = actualTodayNonImportedTasks.length > 0 ? Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100) : 0;
                    const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
                    return (
                      <button
                        onClick={() => setShowMobileDailySummary(true)}
                        className={fabClass(darkMode ? 'bg-gray-700 active:bg-gray-600' : 'bg-stone-200 active:bg-stone-300')}
                        style={delay(1)}
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
                    className={fabClass(showWeeklyReviewReminder ? 'bg-blue-600 text-white active:bg-blue-700' : darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-200 text-stone-600 active:bg-stone-300')}
                    style={delay(0)}
                  >
                    <BarChart3 size={22} />
                  </button>
                  {/* The handle — always present, never collapsed: it is the
                      only way back once the rest have folded away. */}
                  <button
                    onClick={toggleGlanceFabs}
                    aria-expanded={!glanceFabsCollapsed}
                    aria-label={glanceFabsCollapsed ? t('common.showActions') : t('common.hideActions')}
                    className={`pointer-events-auto w-11 h-11 rounded-full shadow-lg flex items-center justify-center backdrop-blur-sm transition-colors ${darkMode ? 'bg-gray-700/90 text-gray-400 active:bg-gray-600' : 'bg-stone-200/90 text-stone-500 active:bg-stone-300'}`}
                  >
                    {glanceFabsCollapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                </div>
              </>
            );
          })()}

          {/* Trash FAB — visible during mobile long-press drag, hidden for routines */}
          {mobileDragTaskIdState !== null && !mobileDragIsRoutine && (
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
