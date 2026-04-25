import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { Plus, Clock, X, GripVertical, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Moon, Sun, Upload, Inbox, AlertCircle, Calendar, Check, RefreshCw, Palette, Trash2, Undo2, BarChart3, SkipForward, Hash, MoreHorizontal, Save, Menu, BrainCircuit, AlertTriangle, FileText, ExternalLink, CheckSquare, HelpCircle, Sparkles, Link, GripHorizontal, Play, Pause, Trophy, Cloud, Settings, Search, Bell, Target, TrendingUp, Zap, CalendarDays, Ban, Volume2, VolumeX, Pencil, Eye, Filter, Smartphone, CheckCircle, Pin, PinOff, NotebookPen, MapPin, BookOpen, Flag, FolderOpen, Droplets, Footprints, Dumbbell, Apple, Cigarette, Coffee, Flame, Heart, ListChecks, Minus, Wine, Candy, Pill, Activity, CupSoda, Mic, MicOff, Loader, Key, Server, Wifi, WifiOff, LayoutGrid, RotateCcw } from 'lucide-react';
import { mergeTaskArrays, mergeSyncData } from './mergeSync.js';
import { isNativeAndroid, nativeShareFile, nativeShowTaskNotification, nativeGetPendingAction, nativeSyncReminders, nativeGetEvents, nativeUpdateEvent, nativeGetCalendars, nativeHttpRequest, nativeGetVaultConfig, nativeIsVaultConfigured, nativeWriteDailyNote, nativeGetNote, nativeWriteNote, nativeOpenNote, nativeListNotes, nativeClearVault, nativeEnterFocusMode, nativeExitFocusMode, nativeIsDndPermissionGranted, nativeRequestDndPermission, nativeStartRecording, nativeStopRecording } from './native.js';
import { isFileSystemAccessSupported, requestVaultAccess, getVaultAccess, tryRestoreVaultAccess, disconnectVault, syncObsidianVault, syncObsidianVaultNative, writeDailyNoteFile, writeDailyNoteNative, readDailyNoteFresh, readDailyNoteNative, writeTaskStateToFile, writeTaskStateNative, simpleHash as obsidianSimpleHash, readWikiNote, writeWikiNote, listVaultNotes, appendTaskToDailyNote, appendTaskToDailyNoteNative } from './obsidian.js';
import { loadAIConfig, saveAIConfig, aiComplete, aiJSON, aiTranscribe, supportsTranscription, testConnection, DEFAULT_CONFIG, PROVIDER_MODELS, PROVIDER_LABELS } from './ai.js';
import { voiceParseSystemPrompt, voiceParseUserPrompt, taskSuggestSystemPrompt, taskSuggestUserPrompt, frameNudgeSystemPrompt, frameNudgeUserPrompt, rescheduleSystemPrompt, rescheduleUserPrompt, aiSubtasksSystemPrompt, aiSubtasksUserPrompt, morningSummarySystemPrompt, morningSummaryUserPrompt, eveningReflectionSystemPrompt, eveningReflectionUserPrompt, weeklySummarySystemPrompt, weeklySummaryUserPrompt, smartScheduleSystemPrompt, smartScheduleUserPrompt } from './ai-prompts.js';
import { gatherTrmnlData, pushToTrmnl, TRMNL_MARKUP_FULL, TRMNL_MARKUP_HALF_HORIZONTAL, TRMNL_MARKUP_HALF_VERTICAL, TRMNL_MARKUP_QUADRANT } from './trmnl.js';
import { checkForUpdate } from './versionCheck.js';
import { getStorageUsage, formatBytes } from './utils/storage.js';
import { cloudSyncProviders } from './utils/cloudSyncProviders.js';
import { autoBackupDB, autoBackupProviders, AUTO_BACKUP_RETENTION, AUTO_BACKUP_INTERVALS } from './utils/autoBackup.js';
import { URL_REGEX, isOnlyUrl, renderFormattedText, hasNotesOrSubtasks, isLinkOnlyTask, getLinkUrl, hasOnlySubtasks, renderTitle, highlightMatch, renderTitleWithoutTags, extractShareTitle } from './utils/textFormatting.jsx';
import { dateToString, localDateStr, extractTags, extractWikilinks, stripWikilinks, getRecurrenceLabel, formatDate, formatDateRange, formatShortDate, formatDeadlineDate } from './utils/taskUtils.js';
import { TASK_COLORS, TAILWIND_TO_HEX, taskColorToHex } from './utils/colorUtils.js';
import { calculateGoalProgress } from './utils/goalProgress.js';
import { HABIT_ICONS, HABIT_ICON_NAMES, HABIT_COLORS } from './constants/habits.js';
import { FRAME_COLORS, DAY_LABELS } from './constants/frames.js';
import { getOccurrencesInRange, getRecurrencePresets } from './utils/recurrenceEngine.js';
import { getPartialTag, getFilteredTags, applyTagCompletion, getPartialDate, getPartialTime, getPartialDeadline, getPartialPriority, getPartialDuration, getDateCandidates, parseFlexibleDate, getTimeCandidates, parseFlexibleTime, completeShortcutText, cleanTitle, removeFromTitle } from './utils/suggestionParser.js';
import ClockTimePicker from './components/ClockTimePicker.jsx';
import { HabitRing, MiniHabitRing } from './components/HabitRing.jsx';
import FrameEditor from './components/FrameEditor.jsx';
import QuickAddFrameForm from './components/QuickAddFrameForm.jsx';
import SmartSchedulePanel from './components/SmartSchedulePanel.jsx';
import SuggestionAutocomplete from './components/SuggestionAutocomplete.jsx';
import GettingStartedChecklist from './components/GettingStartedChecklist.jsx';
import NotesSubtasksPanel from './components/NotesSubtasksPanel.jsx';
import DailyNotesModal from './components/DailyNotesModal.jsx';
import CloudSyncSettingsForm from './components/CloudSyncSettingsForm.jsx';
import SyncPassphraseModal from './components/SyncPassphraseModal.jsx';
import AutoBackupSettingsForm from './components/AutoBackupSettingsForm.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import RemindersSettingsModal from './components/RemindersSettingsModal.jsx';
import VoiceInputModal from './components/VoiceInputModal.jsx';
import WeeklyReviewModal from './components/WeeklyReviewModal.jsx';
import GoalDashboard from './components/goals/GoalDashboard.jsx';
import WeeklyReviewReminderCard from './components/WeeklyReviewReminderCard.jsx';
import IncompleteTasksModal from './components/IncompleteTasksModal.jsx';
import BackupMenuModal from './components/BackupMenuModal.jsx';
import RestoreConfirmModal from './components/RestoreConfirmModal.jsx';
import AutoBackupManagerModal from './components/AutoBackupManagerModal.jsx';
import ImportCalendarModal from './components/ImportCalendarModal.jsx';
import StorageBreakdownModal from './components/StorageBreakdownModal.jsx';
import EmptyBinConfirmModal from './components/EmptyBinConfirmModal.jsx';
import RecurringDeleteModal from './components/RecurringDeleteModal.jsx';
import EditRecurrenceModal from './components/EditRecurrenceModal.jsx';
import ReminderToasts from './components/ReminderToasts.jsx';
import ObsidianSyncToast from './components/ObsidianSyncToast.jsx';
import MobileNewTaskModal from './components/MobileNewTaskModal.jsx';
import DesktopNewTaskModal from './components/DesktopNewTaskModal.jsx';
import useVisibleDays from './hooks/useVisibleDays.js';
import useDeviceType from './hooks/useDeviceType.js';
import useIsLandscape from './hooks/useIsLandscape.js';
import useAudio from './hooks/useAudio.js';
import useUndo from './hooks/useUndo.js';
import useWeather from './hooks/useWeather.js';
import useTagFilter from './hooks/useTagFilter.js';
import useOnboarding from './hooks/useOnboarding.js';
import useDailyContent from './hooks/useDailyContent.js';
import useHabits from './hooks/useHabits.js';
import useRoutines from './hooks/useRoutines.js';
import useGoalsProjects from './hooks/useGoalsProjects.js';
import useFocusMode from './hooks/useFocusMode.js';
import useTrmnlSync from './hooks/useTrmnlSync.js';
import useObsidian from './hooks/useObsidian.js';
import useCloudSync from './hooks/useCloudSync.js';
import useCalendarSync from './hooks/useCalendarSync.js';
import useBackup from './hooks/useBackup.js';
import useGTDFrames from './hooks/useGTDFrames.js';
import { getGlanceHGInstances } from './hooks/useHyperGlance.js';
import useVoiceAI from './hooks/useVoiceAI.js';
import useNavigation from './hooks/useNavigation.js';
import useStats from './hooks/useStats.js';
import useComputedViews from './hooks/useComputedViews.js';
import useTaskDerived from './hooks/useTaskDerived.js';
import useDeadlinePriority from './hooks/useDeadlinePriority.js';
import useConflictDetection from './hooks/useConflictDetection.js';
import useNewTaskInput from './hooks/useNewTaskInput.js';
import useTaskFormHelpers from './hooks/useTaskFormHelpers.js';
import useTaskActions from './hooks/useTaskActions.js';
import useElectronBridge from './hooks/useElectronBridge.js';
import useRecycleBin from './hooks/useRecycleBin.js';
import useReminderEngine from './hooks/useReminderEngine.js';
import useReminders from './hooks/useReminders.js';
import useMobileEdit from './hooks/useMobileEdit.js';
import useDragDrop from './hooks/useDragDrop.js';
import useDataPersistence from './hooks/useDataPersistence.js';
import useLocalStoragePersist from './hooks/useLocalStoragePersist.js';
import useAppInit from './hooks/useAppInit.js';
import useSaveOnChange from './hooks/useSaveOnChange.js';
import useTimelineScroll from './hooks/useTimelineScroll.js';
import useModalClose from './hooks/useModalClose.js';
import useMobileInteractions from './hooks/useMobileInteractions.js';
import useKeyboardShortcuts from './hooks/useKeyboardShortcuts.js';
import { DayPlannerContext } from './context/DayPlannerContext.jsx';
import { SyncContext } from './context/SyncContext.jsx';
import { FeaturesContext } from './context/FeaturesContext.jsx';
import FrameNudgeCard from './components/FrameNudgeCard.jsx';
import DeadlinePickerPopover from './components/DeadlinePickerPopover.jsx';
import DatePicker from './components/DatePicker.jsx';
import DesktopLayout from './components/DesktopLayout.jsx';
import MobileLayout from './components/MobileLayout.jsx';
import ShortcutHelpModal from './components/ShortcutHelpModal.jsx';
import FocusModeModal from './components/FocusModeModal.jsx';
import HyperGlanceModeModal from './components/HyperGlanceModeModal.jsx';
import HGAdjustModal from './components/HGAdjustModal.jsx';
import RoutinesDashboardModal from './components/RoutinesDashboardModal.jsx';
import FrameAdjustModal from './components/FrameAdjustModal.jsx';
import { ProjectForm, FormOverlay } from './components/goals/GoalDashboard.jsx';
import FrameScheduleModal from './components/FrameScheduleModal.jsx';
import FramesModal from './components/FramesModal.jsx';
import MobileWelcomeModal from './components/MobileWelcomeModal.jsx';
import DesktopWelcomeModal from './components/DesktopWelcomeModal.jsx';
import SpotlightModal from './components/SpotlightModal.jsx';
import HabitModal from './components/HabitModal.jsx';

// Encode a string that may contain non-ASCII characters as Base64.
// btoa() throws InvalidCharacterError for codepoints > 255 (CJK, emoji, etc.).
const toBase64 = (str) => btoa(unescape(encodeURIComponent(str)));



// Cloud sync provider abstraction
// Routes a WebDAV HTTP request through the native Android HTTP bridge when
// running inside the app (no CORS, no proxy server needed), or through the


// HabitRing — SVG circular progress ring component
// autoSynced: true when the count comes from Health Connect — disables tap interactions

// 12/24hr-aware time picker used inside FrameEditor
const TimePicker = ({ value, onChange, use24HourClock, borderClass, darkMode }) => {
  const cls = `px-2 py-2 rounded-lg border ${borderClass} ${darkMode ? 'bg-gray-800 text-white' : 'bg-white text-stone-900'} text-sm`;
  if (use24HourClock) {
    return <input type="time" value={value} onChange={e => onChange(e.target.value)} className={`w-full ${cls}`} />;
  }
  const [h, m] = value ? value.split(':').map(Number) : [9, 0];
  const ampm = h >= 12 ? 'PM' : 'AM';
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const set = (newH, newM) => onChange(`${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`);
  return (
    <div className="flex gap-1">
      <select value={displayHour} onChange={e => {
        const hr = Number(e.target.value);
        set(ampm === 'PM' ? (hr === 12 ? 12 : hr + 12) : (hr === 12 ? 0 : hr), m);
      }} className={cls}>
        {[12,1,2,3,4,5,6,7,8,9,10,11].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <select value={m} onChange={e => set(h, Number(e.target.value))} className={cls}>
        {Array.from({length:12}, (_,i) => i*5).map(min => <option key={min} value={min}>{String(min).padStart(2,'0')}</option>)}
      </select>
      <select value={ampm} onChange={e => {
        const a = e.target.value;
        set(a === 'AM' && h >= 12 ? h - 12 : a === 'PM' && h < 12 ? h + 12 : h, m);
      }} className={cls}>
        <option>AM</option>
        <option>PM</option>
      </select>
    </div>
  );
};

// Frame Editor component for creating/editing GTD Frames

// Quick Add Frame form — compact modal for creating single-day frames from timeline right-click

// Smart Schedule panel — shows AI scheduling UI
// FrameNudgeCard extracted to src/components/FrameNudgeCard.jsx


const DayPlanner = () => {
  const _visibleDays = useVisibleDays();
  const { isPhone, isMobile, isTablet } = useDeviceType();
  const isLandscape = useIsLandscape();

  // Ref for the mobile bottom tab bar. With windowSoftInputMode="adjustNothing" the
  // layout viewport never resizes, so we track keyboard height via window.visualViewport
  // and apply a translateY directly to the DOM node (no React state → no re-render).
  const tabBarRef = useRef(null);
  // When a keyboard-triggering modal (e.g. daily notes) closes, we reset the tab-bar
  // immediately and suppress visualViewport updates for ~400ms so the tab-bar doesn't
  // flutter back up while the keyboard's dismiss animation is still in progress.
  const suppressTabBarRef = useRef(false);
  // Declared here (before the useEffect below that depends on it) to avoid a TDZ
  // ReferenceError. The logical home for daily-notes state is further down but hooks
  // must be called in the same order on every render and cannot be forward-referenced.
  const [dailyNotesModalDate, setDailyNotesModalDate] = useState(null); // date string when modal is open
  useEffect(() => {
    // On native Android the FrameLayout padding in MainActivity already consumes
    // the navigation-bar inset, so the WebView viewport ends exactly above the
    // nav bar. Any delta between window.innerHeight and visualViewport.height is
    // an artefact of the edge-to-edge layout (not a real keyboard), and applying
    // a translateY here creates a persistent gap below the content on every tab.
    // The tab bar is fixed bottom-0 and is already in the right place — skip the
    // listener entirely on Android native.
    if (!isMobile || !window.visualViewport || isNativeAndroid()) return;
    let timer = null;
    const updateTabBar = () => {
      if (!tabBarRef.current || suppressTabBarRef.current) return;
      const kh = Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop);
      tabBarRef.current.style.transform = kh > 0 ? `translateY(-${kh}px)` : '';
    };
    // Debounce by 50 ms so transient viewport spikes on app open don't cause a flash.
    const scheduleUpdate = () => { clearTimeout(timer); timer = setTimeout(updateTabBar, 50); };
    window.visualViewport.addEventListener('resize', scheduleUpdate);
    window.visualViewport.addEventListener('scroll', scheduleUpdate);
    return () => {
      clearTimeout(timer);
      window.visualViewport.removeEventListener('resize', scheduleUpdate);
      window.visualViewport.removeEventListener('scroll', scheduleUpdate);
    };
  }, [isMobile]);
  // When the daily-notes modal closes, snap the tab-bar to the bottom immediately
  // instead of waiting for the keyboard dismiss animation to complete.
  useEffect(() => {
    if (!dailyNotesModalDate && tabBarRef.current) {
      suppressTabBarRef.current = true;
      tabBarRef.current.style.transform = '';
      const t = setTimeout(() => { suppressTabBarRef.current = false; }, 400);
      return () => clearTimeout(t);
    }
  }, [dailyNotesModalDate]);
  const [tabletActiveTab, setTabletActiveTab] = useState('glance'); // 'glance' | 'inbox' — for landscape tabbed panel
  // Override visible days: tablet uses orientation (static panel always present), mobile always 1, desktop uses width-based hook
  const visibleDays = isTablet ? (isLandscape ? 2 : 1) : isMobile ? 1 : _visibleDays;
  const [viewMode, setViewMode] = useState(() => {
    // URL ?view= param takes priority over defaultView on cold load.
    const urlView = new URLSearchParams(window.location.search).get('view');
    if (urlView && ['multi', 'day', 'week'].includes(urlView)) return urlView;
    const def = localStorage.getItem('day-planner-default-view');
    return def ? JSON.parse(def) : 'multi';
  });
  // Only expose the cycler (and honour viewMode) when the 3-day breakpoint is active
  const canShowViewCycler = !isTablet && !isMobile && _visibleDays === 3;
  // Below 1600px the cycler is hidden and the stored mode is ignored until the
  // viewport grows back; the app behaves as 'multi' in the meantime.
  const effectiveViewMode = canShowViewCycler ? viewMode : 'multi';
  const [defaultView, setDefaultView] = useState(() => {
    const saved = localStorage.getItem('day-planner-default-view');
    return saved ? JSON.parse(saved) : 'multi';
  });
  const [dayViewMode, setDayViewMode] = useState(() => {
    const saved = localStorage.getItem('day-planner-day-view-mode');
    return saved ? JSON.parse(saved) : 'calendar-day';
  });
  const [weekViewMode, setWeekViewMode] = useState(() => {
    const saved = localStorage.getItem('day-planner-week-view-mode');
    return saved ? JSON.parse(saved) : 'strict';
  });
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem('day-planner-darkmode');
    return saved ? JSON.parse(saved) : false;
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    const urlDate = new URLSearchParams(window.location.search).get('date');
    if (urlDate) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(urlDate);
      if (m) {
        const parsed = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
        const currentYear = new Date().getFullYear();
        if (!isNaN(parsed.getTime()) && parsed.getFullYear() >= currentYear - 100 && parsed.getFullYear() <= currentYear + 100) {
          return parsed;
        }
      }
    }
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today;
  });
  const [tasks, setTasks] = useState([]);
  const [unscheduledTasks, setUnscheduledTasks] = useState([]);
  const [unscheduledOrderTimestamp, setUnscheduledOrderTimestamp] = useState(null);
  // Call this instead of setUnscheduledTasks when the user explicitly reorders tasks
  // so the new order is timestamped and wins during cloud sync merges.
  const reorderUnscheduledTasks = (nextTasks) => {
    setUnscheduledTasks(nextTasks);
    setUnscheduledOrderTimestamp(new Date().toISOString());
  };
  const [dataLoaded, setDataLoaded] = useState(false); // Track if initial data has been loaded
  const [recycleBin, setRecycleBin] = useState([]);
  const [recurringTasks, setRecurringTasks] = useState([]);
  const [showRecurrencePicker, setShowRecurrencePicker] = useState(false);
  const [recurringDeleteConfirm, setRecurringDeleteConfirm] = useState(null); // { taskId, dateStr }
  const [editingRecurrenceTaskId, setEditingRecurrenceTaskId] = useState(null); // recurring composite ID string
  const [showRecurrenceEndDatePicker, setShowRecurrenceEndDatePicker] = useState(null); // { source: 'edit' | 'new', templateId?: number }
  const [showAddTask, setShowAddTask] = useState(false);
  const [taskAISuggestion, setTaskAISuggestion] = useState(null); // { duration, tags }
  const [taskAISuggestionLoading, setTaskAISuggestionLoading] = useState(false);
  const [frameNudgeSuggestion, setFrameNudgeSuggestion] = useState(null); // { taskId, taskTitle, reason, isInbox }
  const [frameNudgeLoading, setFrameNudgeLoading] = useState(false);
  const [frameNudgeError, setFrameNudgeError] = useState('');
  const [frameNudgeDismissedKey, setFrameNudgeDismissedKey] = useState(''); // key = todayStr-frameId
  const [aiSubtasksLoadingForTask, setAiSubtasksLoadingForTask] = useState(null); // taskId while loading

  const [minimizedSections, setMinimizedSections] = useState(() => {
    const saved = localStorage.getItem('minimizedSections');
    return saved ? JSON.parse(saved) : {
      overdue: false,
      inbox: false,
      dayglance: false,
      dailySummary: false,
      allTimeSummary: false,
      recycleBin: false,
      tags: false
    };
  });
  const { selectedTags, setSelectedTags, showUntagged, setShowUntagged, showMobileTagFilter, setShowMobileTagFilter, toggleTag, clearTagFilter } = useTagFilter();
  const [use24HourClock, setUse24HourClock] = useState(() => {
    const saved = localStorage.getItem('day-planner-use-24h-clock');
    return saved !== null ? JSON.parse(saved) : false;
  });
  const [inboxAutoArchiveDays, setInboxAutoArchiveDays] = useState(() => {
    const saved = localStorage.getItem('day-planner-inbox-auto-archive-days');
    return saved !== null ? JSON.parse(saved) : 14;
  });
  useEffect(() => { localStorage.setItem('day-planner-inbox-auto-archive-days', JSON.stringify(inboxAutoArchiveDays)); }, [inboxAutoArchiveDays]);
  const [weekStartDay, setWeekStartDay] = useState(() => {
    const saved = localStorage.getItem('day-planner-week-start-day');
    return saved !== null ? JSON.parse(saved) : 0; // 0=Sunday, 1=Monday
  });
  useEffect(() => { localStorage.setItem('day-planner-week-start-day', JSON.stringify(weekStartDay)); }, [weekStartDay]);
  const { weather, setWeather, weatherZip, setWeatherZip, weatherTempUnit, setWeatherTempUnit, fetchWeather } = useWeather();
  const [weatherEnabled, setWeatherEnabled] = useState(() => {
    const saved = localStorage.getItem('day-planner-weather-enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });
  const [dailyContentEnabled, setDailyContentEnabled] = useState(() => {
    const saved = localStorage.getItem('day-planner-daily-content-enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });
  useEffect(() => { localStorage.setItem('day-planner-weather-enabled', JSON.stringify(weatherEnabled)); }, [weatherEnabled]);
  useEffect(() => { localStorage.setItem('day-planner-daily-content-enabled', JSON.stringify(dailyContentEnabled)); }, [dailyContentEnabled]);
  const [syncUrl, setSyncUrl] = useState('');
  const [showCalendarUrlHint, setShowCalendarUrlHint] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [expandedTaskMenu, setExpandedTaskMenu] = useState(null);
  const [expandedNotesTaskId, setExpandedNotesTaskId] = useState(null);
  const hasCheckedInitialWelcome = useRef(false); // Track if we've done the initial welcome check
  const skipOnboardingPersist = useRef(false); // Skip persisting onboarding dismissal (for testing)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [deadlinePickerTaskId, setDeadlinePickerTaskId] = useState(null); // Task ID for deadline date picker
  const [showMonthView, setShowMonthView] = useState(false);
  const [viewedMonth, setViewedMonth] = useState(() => new Date());
  const [mobileReviewPage, setMobileReviewPage] = useState(0);
  const [showMobileDailySummary, setShowMobileDailySummary] = useState(false);
  const [desktopStatsHabitsCollapsed, setDesktopStatsHabitsCollapsed] = useState(true);
  const [desktopStatsAllTimeCollapsed, setDesktopStatsAllTimeCollapsed] = useState(true);
  const reviewScrollRef = useRef(null);
  const [syncNotification, setSyncNotification] = useState(null); // { type: 'success' | 'error' | 'info', message: string }
  const [isSyncing, setIsSyncing] = useState(false);
  const {
    calSyncStatus, setCalSyncStatus,
    calSyncLastSynced, setCalSyncLastSynced,
    taskCalendarUrl, setTaskCalendarUrl,
    taskCalendarAuth, setTaskCalendarAuth,
    syncRetentionDays, setSyncRetentionDays,
    completedTaskUids, setCompletedTaskUids,
    pendingImportFile, setPendingImportFile,
    showImportModal, setShowImportModal,
    importColor, setImportColor,
  } = useCalendarSync();
  // Android device calendars — populated on first load when running in the native WebView
  const [availableCalendars, setAvailableCalendars] = useState([]);
  // IDs of calendars to include; empty array = show all
  const [calendarFilter, setCalendarFilter] = useState(() => {
    try { return JSON.parse(localStorage.getItem('day-planner-calendar-filter') || '[]'); } catch { return []; }
  });
  // On Android, calendar events come from the native bridge — only task calendar URL matters for sync
  const calSyncConfigured = isNativeAndroid() ? !!taskCalendarUrl : !!(syncUrl || taskCalendarUrl);
  const [calendarUrlAuth, setCalendarUrlAuth] = useState(() => {
    const saved = localStorage.getItem('day-planner-calendar-url-auth');
    return saved ? JSON.parse(saved) : { username: '', password: '' };
  });
  const {
    pendingBackupFile, setPendingBackupFile,
    showRestoreConfirm, setShowRestoreConfirm,
    showBackupMenu, setShowBackupMenu,
  } = useBackup();
  const { dailyContent, setDailyContent, contentRotation, setContentRotation, fetchAllDailyContent } = useDailyContent();

  const [inboxPriorityFilter, setInboxPriorityFilter] = useState(() => {
    const saved = localStorage.getItem('inboxPriorityFilter');
    return saved ? JSON.parse(saved) : 0;
  }); // 0 = show all, 1-3 = show >= that priority
  const [hideCompletedInbox, setHideCompletedInbox] = useState(() => {
    return localStorage.getItem('hideCompletedInbox') === 'true';
  });
  const [hideProjectTasksInbox, setHideProjectTasksInbox] = useState(() => {
    // Default true (hide) to preserve existing behavior; user can opt in to seeing them
    return localStorage.getItem('hideProjectTasksInbox') !== 'false';
  });
  const [hideStandaloneTasksInbox, setHideStandaloneTasksInbox] = useState(() => {
    return localStorage.getItem('hideStandaloneTasksInbox') === 'true';
  });
  const [inboxTagFilter, setInboxTagFilter] = useState(() => {
    try { return JSON.parse(localStorage.getItem('inboxTagFilter') || '[]'); } catch { return []; }
  });
  const [inboxProjectFilter, setInboxProjectFilter] = useState(() => {
    try { return JSON.parse(localStorage.getItem('inboxProjectFilter') || '[]'); } catch { return []; }
  });
  const [inboxArchivedExpanded, setInboxArchivedExpanded] = useState(false);
  const [priorityPromptDismissed, setPriorityPromptDismissed] = useState(() => {
    return localStorage.getItem('priorityPromptDismissed') === 'true';
  });
  // Tablet layout state
  // Mobile layout state
  const [mobileActiveTab, setMobileActiveTab] = useState('dayglance');
  const [mobileWelcomeStep, setMobileWelcomeStep] = useState(0);
  const [desktopWelcomeStep, setDesktopWelcomeStep] = useState(0);
  const {
    mobileEditingTask, setMobileEditingTask,
    mobileEditIsInbox, setMobileEditIsInbox,
  } = useMobileEdit();
  const [mobileEditingNativeEvent, setMobileEditingNativeEvent] = useState(null);
  const [nativeCalendarKey, setNativeCalendarKey] = useState(0);
  const [mobileSettingsView, setMobileSettingsView] = useState('main');
  const { showWelcome, setShowWelcome, gettingStartedDismissed, setGettingStartedDismissed, onboardingComplete, setOnboardingComplete, onboardingProgress, setOnboardingProgress } = useOnboarding();
  const [sectionInfoDismissed, setSectionInfoDismissed] = useState(() => {
    const saved = localStorage.getItem('sectionInfoDismissed');
    return saved ? JSON.parse(saved) : { inbox: false, tags: false, recycleBin: false };
  });
  const [expandedSectionInfo, setExpandedSectionInfo] = useState(null); // 'inbox' | 'tags' | 'recycleBin' | null
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(null); // task id or null
  const calendarRef = useRef(null);
  const timeGridRef = useRef(null);
  const currentTimeRef = useRef(null);

  // Keyboard shortcut cheat sheet
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);


  const tagFilterBtnRef = useRef(null);

  // Cloud Sync state
  const {
    cloudSyncConfig, setCloudSyncConfig,
    cloudSyncStatus, setCloudSyncStatus,
    cloudSyncError, setCloudSyncError,
    cloudSyncLastSynced, setCloudSyncLastSynced,
    cloudSyncConflict, setCloudSyncConflict,
    syncKeyReady, setSyncKeyReady,
    cloudSyncDebounceRef,
    suppressCloudUploadRef,
    suppressTimestampRef,
    suppressClearPendingRef,
    cloudSyncInProgressRef,
    cloudSyncInitialDoneRef,
    cloudSyncDownloadRef,
    cloudSyncErrorCountRef,
    cloudSyncBackoffUntilRef,
  } = useCloudSync();

  // Ref so interval/timeout callbacks can read the current syncKeyReady without stale closure
  const syncKeyReadyRef = useRef(syncKeyReady);
  useEffect(() => { syncKeyReadyRef.current = syncKeyReady; }, [syncKeyReady]);

  // Daily Notes state — keyed by date string "YYYY-MM-DD" → { text, lastModified }
  const [dailyNotes, setDailyNotes] = useState(() => {
    try {
      const saved = localStorage.getItem('day-planner-daily-notes');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [dailyNoteTemplate, setDailyNoteTemplate] = useState(() => {
    const saved = localStorage.getItem('day-planner-daily-note-template');
    return saved !== null ? saved : '## Quick Notes\n## Thoughts\n## Accomplished\n## Tasks\n';
  });


  // Obsidian Integration state
  const {
    obsidianConfig, setObsidianConfig,
    obsidianSyncStatus, setObsidianSyncStatus,
    obsidianSyncError, setObsidianSyncError,
    obsidianLastSynced, setObsidianLastSynced,
    obsidianVaultHandleRef,
    obsidianSyncInProgressRef,
    obsidianPrevTaskStateRef,
    obsidianTasksRef,
    obsidianInboxRef,
  } = useObsidian();

  // Wikilink autocomplete candidates — bare note names from the connected vault.
  // Populated when the vault connects (native or FSA) and used by task-title inputs.
  const [wikilinkCandidates, setWikilinkCandidates] = useState([]);

  // Auto-Backup state
  const [autoBackupConfig, setAutoBackupConfig] = useState(() => {
    try {
      const saved = localStorage.getItem('day-planner-auto-backup-config');
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      local: { enabled: false, frequency: 'daily' },
      remote: { enabled: false, frequency: 'daily', provider: 'nextcloud' }
    };
  });
  const [autoBackupStatus, setAutoBackupStatus] = useState(() => ({
    local: { lastBackup: localStorage.getItem('day-planner-auto-backup-local-last') || null, status: 'idle' },
    remote: { lastBackup: localStorage.getItem('day-planner-auto-backup-remote-last') || null, status: 'idle' }
  }));
  const [showAutoBackupManager, setShowAutoBackupManager] = useState(false);
  const [autoBackupManagerTab, setAutoBackupManagerTab] = useState('settings'); // 'settings' | 'history'
  const [autoBackupHistory, setAutoBackupHistory] = useState({ local: [], remote: [] });
  const [autoBackupRestoreConfirm, setAutoBackupRestoreConfirm] = useState(null); // { type: 'local'|'remote', id, filename, timestamp }
  const autoBackupInProgressRef = useRef(false);
  const [showStorageBreakdown, setShowStorageBreakdown] = useState(false);

  const syncAllRef = useRef(null);

  // Settings & Reminders modals
  const [showSettings, setShowSettings] = useState(false);
  const [collapsedSettings, setCollapsedSettings] = useState({ cloudSync: true, calSync: !isNativeAndroid(), ai: true, obsidian: !isNativeAndroid(), trmnl: true });
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateDismissedVersion, setUpdateDismissedVersion] = useState(() => localStorage.getItem('dayglance-update-dismissed') || null);
  const toggleSettingsSection = (key) => setCollapsedSettings(prev => ({ ...prev, [key]: !prev[key] }));
  const {
    showRemindersSettings, setShowRemindersSettings,
    reminderSettings, setReminderSettings,
    showMorningTimePicker, setShowMorningTimePicker,
    applyReminderPreset,
    updateCategoryReminder,
  } = useReminders();
  const { soundEnabled, setSoundEnabled, playUISound, playFocusSound } = useAudio();
  const {
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
    habitLongPressTimer,
    habitLongPressOpenedAt,
    activeHabits,
    habitStreaks,
    getTodayHabitCount,
    incrementHabit,
    setHabitCount,
    addHabit,
    updateHabit,
    archiveHabit,
    deleteHabit,
    reorderHabits,
    syncHealthConnectHabitsRef,
    addStepsHabit,
    addSleepHabit,
  } = useHabits({ playUISound });
  const {
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
    routineCompletions, setRoutineCompletions, toggleRoutineCompletion,
    openRoutinesDashboard,
    addRoutineChip,
    deleteRoutineChip,
    toggleRoutineChipSelection,
    handleRoutinesDone,
  } = useRoutines({ currentTime, onboardingProgress, setOnboardingProgress });
  const {
    goals, setGoals,
    projects, setProjects,
    showGoalsDashboard, setShowGoalsDashboard,
    goalsProjectsEnabled, setGoalsProjectsEnabled,
    addGoal, updateGoal, deleteGoal,
    addProject, updateProject, deleteProject, moveProject,
  } = useGoalsProjects();
  const [projectFilter, setProjectFilter] = useState(null);
  // Clear project filter when the selected date changes
  useEffect(() => { setProjectFilter(null); }, [selectedDate]);
  const {
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
    wakeLockSentinel,
    focusTimerRef,
    handleFocusTimerEndRef,
    exitFocusModeRef,
    focusModeAvailableRef,
  } = useFocusMode();

  // ── HyperGLANCE state ────────────────────────────────────────────────────
  const [showHyperGlanceMode, setShowHyperGlanceMode] = React.useState(false);
  const [hyperGlanceProjectId, setHyperGlanceProjectId] = React.useState(null);
  const [hyperGlanceSessionDate, setHyperGlanceSessionDate] = React.useState(null);
  const [hgTimerSeconds, setHgTimerSeconds] = React.useState(0);
  const [hgTimerRunning, setHgTimerRunning] = React.useState(false);
  const [hgTimerPhase, setHgTimerPhase] = React.useState('work'); // 'work' | 'break'
  const [hgWorkMinutes, setHgWorkMinutes] = React.useState(25);
  const [hgBreakMinutes, setHgBreakMinutes] = React.useState(5);
  const [hgLongBreakMinutes, setHgLongBreakMinutes] = React.useState(15);
  const [hgCycleCount, setHgCycleCount] = React.useState(0);
  const [hgExitConfirm, setHgExitConfirm] = React.useState(false);
  const [hgShowSettings, setHgShowSettings] = React.useState(true);
  const hgTimerRef = React.useRef(null);

  const {
    trmnlConfig, setTrmnlConfig,
    trmnlSyncStatus, setTrmnlSyncStatus,
    trmnlLastSynced, setTrmnlLastSynced,
    trmnlSyncTimerRef,
    trmnlLastPushRef,
    trmnlBackoffUntilRef,
    trmnlBackoffCountRef,
    trmnlSyncInProgressRef,
    performTrmnlSyncRef,
  } = useTrmnlSync();
  const { undoToast, setUndoToast, pushUndo, performUndo, performRedo } = useUndo({
    tasks, unscheduledTasks, recycleBin, recurringTasks,
    setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks,
    playUISound,
  });

  const {
    showEmptyBinConfirm, setShowEmptyBinConfirm,
    showMobileRecycleBin, setShowMobileRecycleBin,
    undeleteTask,
    emptyRecycleBin,
    confirmEmptyBin,
  } = useRecycleBin({
    recycleBin, setRecycleBin,
    pushUndo,
    setTasks, setUnscheduledTasks,
    playUISound,
  });

  // AI configuration, voice input, and weekly review state
  const {
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
    voiceRecorderRef,
    voiceAudioChunksRef,
    voiceAutoStartRef,
    voiceTextareaRef,
    voiceAllTagsRef,
    voiceBuildTaskContextRef,
    voiceResolveTaskMatchRef,
    voiceCanRecord,
    showWeeklyReview, setShowWeeklyReview,
    showWeeklyReviewTimePicker, setShowWeeklyReviewTimePicker,
    showWeeklyReviewReminder, setShowWeeklyReviewReminder,
    lastWeeklyReviewFiredRef,
    weeklyReviewDismissedRef,
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
  } = useVoiceAI();

  // GTD Frames state
  const {
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
  } = useGTDFrames();
  const [taskContextMenu, setTaskContextMenu] = useState(null); // { x, y, taskId, isRecurring, isImported, isAllDay, dateStr }
  const [timelineContextMenu, setTimelineContextMenu] = useState(null); // { x, y, dateStr, timeMinutes }
  const [hgContextMenu, setHgContextMenu] = useState(null); // { x, y, projectId, date, isCompleted }
  const [hgAdjustModal, setHgAdjustModal] = useState(null); // { projectId, date, time, duration }
  const [hgAdjustTimeField, setHgAdjustTimeField] = useState(null); // 'start' | 'end' | null
  const [pendingEditProjectId, setPendingEditProjectId] = useState(null);

  // Incomplete tasks modal
  const [showIncompleteTasks, setShowIncompleteTasks] = useState(null); // null | 'today' | 'allTime'
  const [dailyStatsHabitsCollapsed, setDailyStatsHabitsCollapsed] = useState(true);
  const [dailyStatsAllTimeCollapsed, setDailyStatsAllTimeCollapsed] = useState(true);

  // Spotlight search
  const [showSpotlight, setShowSpotlight] = useState(false);
  const [spotlightQuery, setSpotlightQuery] = useState('');
  const [spotlightSelectedIndex, setSpotlightSelectedIndex] = useState(0);
  const spotlightInputRef = useRef(null);

  const { changeDate, goToToday, goToDate, handleSpotlightSelect } = useNavigation({
    visibleDays,
    effectiveViewMode,
    setSelectedDate,
    setShowMonthView,
    setShowSpotlight,
    isMobile,
    setMobileActiveTab,
    setTabletActiveTab,
    setInboxProjectFilter,
    setInboxArchivedExpanded,
    calendarRef,
  });

  const {
    allTimeScheduledCount,
    allTimeCompletedCount,
    totalCompletedMinutes,
    totalScheduledMinutes,
    actualTodayNonImportedTasks,
    actualTodayCompletedTasks,
    actualTodayCompletedMinutes,
    actualTodayPlannedMinutes,
    actualTodayFocusMinutes,
    allTimeFocusMinutes,
    inboxCompletedTodayCount,
    inboxCompletedTodayMinutes,
    allTimeInboxCompletedCount,
    allTimeInboxCompletedMinutes,
    projectTasksCompletedTodayCount,
    projectTasksCompletedTodayMinutes,
    allTimeUnscheduledProjectDoneCount,
    allTimeUnscheduledProjectDoneMinutes,
    allTimeGoalsCreated,
    allTimeGoalsCompleted,
    allTimeProjectsCreated,
    allTimeProjectsCompleted,
    todayCompletedGoals,
    todayCompletedProjects,
    todayDueGoals,
    consecutiveDayStreak,
    todayIncompleteTasks,
    allTimeIncompleteTasks,
  } = useStats({ tasks, unscheduledTasks, recurringTasks, goals, projects });

  const {
    todayTasks,
    allTags,
    incompleteTodayTasks,
    filterByTags,
    filteredUnscheduledTasks,
    filteredTodayTasks,
  } = useComputedViews({
    tasks,
    unscheduledTasks,
    recurringTasks,
    selectedDate,
    selectedTags,
    inboxPriorityFilter,
    hideCompletedInbox,
    hideProjectTasksInbox,
    hideStandaloneTasksInbox,
    inboxTagFilter,
    inboxProjectFilter,
    goalsProjectsEnabled,
  });
  const { taskWidths, setTaskRef, getConflictingTasks, calculateConflictPosition, wouldExceedMaxColumns } = useTaskDerived({
    tasks,
    recurringTasks,
    visibleDays,
    mobileActiveTab,
  });
  const { pendingPriorities, cyclePriority, getDeadlineTasksForDate } = useDeadlinePriority({
    unscheduledTasks,
    setUnscheduledTasks,
    pushUndo,
    playUISound,
    onboardingProgress,
    setOnboardingProgress,
  });
  const { conflicts, checkConflicts } = useConflictDetection({
    tasks,
    recurringTasks,
    selectedDate,
    dataLoaded,
  });
  const {
    newTask, setNewTask,
    showNewTaskDeadlinePicker, setShowNewTaskDeadlinePicker,
    suggestions, setSuggestions,
    selectedSuggestionIndex, setSelectedSuggestionIndex,
    showSuggestions, setShowSuggestions,
    suggestionContext, setSuggestionContext,
    newTaskInputRef,
    buildSuggestions,
    handleNewTaskInputChange,
    handleNewTaskInputKeyDown,
    applySuggestionForNewTask,
  } = useNewTaskInput({ allTags, showAddTask });
  voiceAllTagsRef.current = allTags;

  // Show all 24 hours (full day) - scrollable
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const firstHour = 0; // Always start at midnight for positioning
  const colors = TASK_COLORS;
  const durationOptions = [15, 30, 45, 60, 90, 120];

  // Try to lock orientation to portrait on phones (works for installed PWAs)
  useEffect(() => {
    if (isPhone && screen.orientation?.lock) {
      screen.orientation.lock('portrait').catch(() => {});
    }
  }, [isPhone]);

  // Check for app updates on mount and every 6 hours
  useEffect(() => {
    const currentVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0';
    const doCheck = async () => {
      const result = await checkForUpdate(currentVersion);
      if (result.updateAvailable && result.latestVersion !== updateDismissedVersion) {
        setUpdateInfo(result);
      } else {
        setUpdateInfo(null);
      }
    };
    doCheck();
    const interval = setInterval(doCheck, 6 * 60 * 60 * 1000);
    return () => clearInterval(interval);
  }, [updateDismissedVersion]);

  // Track mouse vs keyboard input to suppress focus rings after mouse clicks
  useEffect(() => {
    const onPointerDown = () => document.body.classList.add('using-pointer');
    const onKeyDown = (e) => {
      if (e.key === 'Tab') document.body.classList.remove('using-pointer');
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  // Clear swipe-scheduling ref if add-task modal was dismissed without submitting
  useEffect(() => {
    if (!showAddTask) {
      swipeSchedulingInboxTaskId.current = null;
    }
  }, [showAddTask]);

  // Extract partial tag being typed at cursor position
  // Format time for display (respects 12h/24h setting)
  const formatTime = (timeStr) => {
    if (!timeStr) return '';
    if (use24HourClock) return timeStr;
    const [hours, minutes] = timeStr.split(':').map(Number);
    const displayHour = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    return `${displayHour}:${minutes.toString().padStart(2, '0')}\u00A0${ampm}`;
  };

  useLocalStoragePersist({
    minimizedSections,
    use24HourClock,
    inboxPriorityFilter,
    hideCompletedInbox,
    hideProjectTasksInbox,
    hideStandaloneTasksInbox,
    inboxTagFilter,
    inboxProjectFilter,
    priorityPromptDismissed,
    sectionInfoDismissed, skipOnboardingPersist,
    dailyNotes, suppressCloudUploadRef, cloudSyncConfig, cloudSyncInitialDoneRef,
    dailyNoteTemplate,
    calendarUrlAuth,
    autoBackupConfig,
    calendarFilter,
  });

  const { loadData, saveData, stampTaskTimestamps } = useDataPersistence({
    // setters for loadData
    setTasks, setUnscheduledTasks, setRecycleBin, setRecurringTasks,
    setDarkMode, setSyncUrl, setTaskCalendarUrl, setCompletedTaskUids,
    setDailyNotes, setRoutineDefinitions, setTodayRoutines, setRoutinesDate,
    setRemovedTodayRoutineIds, setHabits, setHabitLogs, setHabitsEnabled,
    setRoutinesEnabled, setGoals, setProjects, setGoalsProjectsEnabled, setDataLoaded,
    setUnscheduledOrderTimestamp,
    // values for saveData
    tasks, unscheduledTasks, recycleBin, recurringTasks, todayRoutines,
    darkMode, syncUrl, taskCalendarUrl, syncRetentionDays, completedTaskUids,
    routineDefinitions, routinesDate, removedTodayRoutineIds,
    habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames,
    goals, projects, goalsProjectsEnabled,
    unscheduledOrderTimestamp,
    cloudSyncConfig, cloudSyncInitialDoneRef, suppressTimestampRef,
    setUndoToast,
  });

  useSaveOnChange({
    saveData, checkConflicts,
    dataLoaded,
    suppressClearPendingRef, suppressCloudUploadRef, suppressTimestampRef,
    tasks, unscheduledTasks, recycleBin, taskCalendarUrl, syncUrl, syncRetentionDays,
    completedTaskUids, recurringTasks, routineDefinitions, todayRoutines, routinesDate,
    removedTodayRoutineIds, habits, habitLogs, habitsEnabled, routinesEnabled, gtdFrames,
    goals, projects, goalsProjectsEnabled,
  });

  const { timelineScrolledAway, setTimelineScrolledAway, scrollToCurrentHour, scrollToHour } = useTimelineScroll({
    calendarRef, timeGridRef,
    selectedDate,
    isMobile, isTablet,
    mobileActiveTab,
    viewMode: effectiveViewMode,
  });

  // Close month view when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showMonthView && !e.target.closest('.month-view-container') && !e.target.closest('.month-view-toggle')) {
        setShowMonthView(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showMonthView]);

  // Close task menus when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (expandedTaskMenu && !e.target.closest('.task-menu-container')) {
        setExpandedTaskMenu(null);
      }
      if (showColorPicker && !e.target.closest('.color-picker-container')) {
        setShowColorPicker(null);
      }
      if (showDeadlinePicker && !e.target.closest('.deadline-picker-container')) {
        setShowDeadlinePicker(null);
      }
      if (expandedNotesTaskId && !e.target.closest('.notes-panel-container') && !e.target.closest('.notes-toggle-button')) {
        setExpandedNotesTaskId(null);
      }
      if (routineDurationEditId && !e.target.closest('.routine-duration-edit')) {
        setRoutineDurationEditId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [expandedTaskMenu, showColorPicker, showDeadlinePicker, expandedNotesTaskId, routineDurationEditId]);


  // Close habit day popup on ESC
  useEffect(() => {
    if (!habitDayPopup) return;
    const handleKeyDown = (e) => { if (e.key === 'Escape') { e.preventDefault(); setHabitDayPopup(null); } };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [habitDayPopup]);

  // Close notes panel on ESC
  useEffect(() => {
    if (!expandedNotesTaskId) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setExpandedNotesTaskId(null);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [expandedNotesTaskId]);

  // Persist darkMode to localStorage and update theme-color meta tag
  useEffect(() => {
    localStorage.setItem('day-planner-darkmode', JSON.stringify(darkMode));
    document.documentElement.classList.toggle('dark', darkMode);
    document.documentElement.style.colorScheme = darkMode ? 'dark' : 'light';
    document.documentElement.style.backgroundColor = darkMode ? '#1f2937' : '#ffffff';
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) themeColorMeta.setAttribute('content', darkMode ? '#1f2937' : '#ffffff');
    // Sync status-bar icon colour with the app's own theme.  The app has its own
    // dark-mode toggle independent of the Android OS setting, so the Kotlin side
    // can't reliably read resources.configuration.uiMode — it has to be told.
    if (isNativeAndroid()) window.DayGlanceNative?.setStatusBarAppearance?.(darkMode);
  }, [darkMode]);

  useEffect(() => {
    localStorage.setItem('day-planner-view-mode', JSON.stringify(viewMode));
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('day-planner-default-view', JSON.stringify(defaultView));
  }, [defaultView]);

  useEffect(() => {
    localStorage.setItem('day-planner-day-view-mode', JSON.stringify(dayViewMode));
  }, [dayViewMode]);
  useEffect(() => {
    localStorage.setItem('day-planner-week-view-mode', JSON.stringify(weekViewMode));
  }, [weekViewMode]);

  // Lock body/html scrolling to prevent scroll chaining (all devices incl. desktop PWA)
  useEffect(() => {
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.height = '100dvh';
    document.body.style.overflow = 'hidden';
    document.body.style.height = '100dvh';
    return () => {
      document.documentElement.style.overflow = '';
      document.documentElement.style.height = '';
      document.body.style.overflow = '';
      document.body.style.height = '';
    };
  }, []);


  // Android back button: navigate from settings sub-screen back to main settings
  useEffect(() => {
    if (!isMobile) return;
    if (mobileSettingsView !== 'main') {
      window.history.pushState({ settingsSubView: true }, '');
      const onPopState = (e) => {
        if (e.state?.settingsSubView || mobileSettingsView !== 'main') {
          setMobileSettingsView('main');
        }
      };
      window.addEventListener('popstate', onPopState);
      return () => window.removeEventListener('popstate', onPopState);
    }
  }, [mobileSettingsView, isMobile]);

  // Redirect away from routines tab if routines are disabled
  useEffect(() => {
    if (!routinesEnabled && mobileActiveTab === 'routines') {
      handleRoutinesDone();
      setMobileActiveTab('dayglance');
    }
  }, [routinesEnabled]);

  // Android back button: navigate to dayglance tab from other screens
  useEffect(() => {
    if (!isMobile) return;
    if (mobileActiveTab === 'dayglance') return;
    // Don't interfere with settings sub-view back navigation
    if (mobileActiveTab === 'settings' && mobileSettingsView !== 'main') return;

    // Only push if there isn't already an app-tab history entry
    if (!window.history.state?.appTab) {
      window.history.pushState({ appTab: mobileActiveTab }, '');
    }

    const onPopState = () => {
      setMobileActiveTab('dayglance');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [mobileActiveTab, mobileSettingsView, isMobile]);



  // Track for onboarding when sync is set up
  useEffect(() => {
    if (!onboardingProgress.hasSetupSync && (syncUrl.trim() || taskCalendarUrl.trim())) {
      setOnboardingProgress(prev => ({ ...prev, hasSetupSync: true }));
    }
  }, [syncUrl, taskCalendarUrl, onboardingProgress.hasSetupSync]);

  useEffect(() => {
    // Tick every 15s for responsive reminders; firedRemindersRef prevents duplicates
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Catch up on missed reminders and sync when tab becomes visible
  useEffect(() => {
    const handleVisibility = () => {
      if (!document.hidden) {
        setCurrentTime(new Date());
        if (Date.now() >= cloudSyncBackoffUntilRef.current) {
          cloudSyncDownloadRef.current?.();
        }
        syncHealthConnectHabitsRef.current?.();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []);

  // Auto-refresh page at midnight (00:00:01) to reset the timeline to the new day
  useEffect(() => {
    const calculateMsUntilMidnight = () => {
      const now = new Date();
      const midnight = new Date(now);
      midnight.setDate(midnight.getDate() + 1);
      midnight.setHours(0, 0, 1, 0); // 00:00:01
      return midnight.getTime() - now.getTime();
    };

    const scheduleRefresh = () => {
      const msUntilMidnight = calculateMsUntilMidnight();
      return setTimeout(() => {
        window.location.reload();
      }, msUntilMidnight);
    };

    const midnightTimer = scheduleRefresh();

    return () => clearTimeout(midnightTimer);
  }, []);

  // Cleanup expired single-day frames (older than 7 days)
  useEffect(() => {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const cutoff = dateToString(sevenDaysAgo);
    setGtdFrames(prev => {
      const filtered = prev.filter(f => !f.singleDate || f.singleDate >= cutoff);
      return filtered.length === prev.length ? prev : filtered;
    });
  }, []); // Run once on app start

  // Auto-sync calendars every 15 minutes when URLs are configured.
  // On Android, only the task calendar matters — calendar events come from the native bridge.
  useEffect(() => {
    const hasSyncTarget = isNativeAndroid() ? !!taskCalendarUrl : !!(syncUrl || taskCalendarUrl);
    if (!hasSyncTarget) return;

    const syncTimer = setInterval(() => {
      syncAllRef.current({ silent: true });
    }, 15 * 60 * 1000); // 15 minutes

    return () => clearInterval(syncTimer);
  }, [syncUrl, taskCalendarUrl]);

  // Cloud sync: debounced upload on data changes
  useEffect(() => {
    if (!cloudSyncConfig?.enabled || !dataLoaded || suppressCloudUploadRef.current) return;
    if (cloudSyncDebounceRef.current) clearTimeout(cloudSyncDebounceRef.current);
    cloudSyncDebounceRef.current = setTimeout(() => {
      cloudSyncUpload();
    }, 5000);
    return () => { if (cloudSyncDebounceRef.current) clearTimeout(cloudSyncDebounceRef.current); };
  }, [tasks, unscheduledTasks, recycleBin, taskCalendarUrl, completedTaskUids, recurringTasks, routineDefinitions, todayRoutines, routinesDate, routineCompletions, removedTodayRoutineIds, use24HourClock, habits, habitLogs, habitsEnabled, routinesEnabled, dailyNotes, gtdFrames, cloudSyncConfig?.enabled]);

  // Cloud sync: download on app load or when sync is first enabled.
  // If encryption is enabled, wait until the session key is ready (either
  // restored from IndexedDB or provided by the passphrase modal).
  useEffect(() => {
    if (dataLoaded && cloudSyncConfig?.enabled && syncKeyReady) {
      cloudSyncDownload();
    } else if (dataLoaded && !cloudSyncConfig?.enabled) {
      // No cloud sync — allow local-modified timestamps immediately
      cloudSyncInitialDoneRef.current = true;
    }
  }, [dataLoaded, cloudSyncConfig?.enabled, syncKeyReady]);

  // Cloud sync: poll for remote changes every 60 seconds
  useEffect(() => {
    if (!cloudSyncConfig?.enabled) return;
    const pollTimer = setInterval(() => {
      if (syncKeyReadyRef.current && Date.now() >= cloudSyncBackoffUntilRef.current) {
        cloudSyncDownloadRef.current?.();
      }
    }, 60 * 1000);
    return () => clearInterval(pollTimer);
  }, [cloudSyncConfig?.enabled]);

  // TRMNL auto-sync: push data when tasks/habits change
  // Debounce 10s to batch rapid edits, then throttle to at most once per 2 min.
  // On 429 backoff the cooldown extends to 5 min.
  const TRMNL_THROTTLE_MS = 2 * 60 * 1000; // 2 minutes between pushes
  useEffect(() => {
    performTrmnlSyncRef.current = performTrmnlSync;
  });
  useEffect(() => {
    if (!trmnlConfig?.enabled || !trmnlConfig?.webhookUrl || !dataLoaded) return;
    if (trmnlSyncTimerRef.current) clearTimeout(trmnlSyncTimerRef.current);
    trmnlSyncTimerRef.current = setTimeout(() => {
      const now = Date.now();
      const earliest = Math.max(
        trmnlLastPushRef.current + TRMNL_THROTTLE_MS,
        trmnlBackoffUntilRef.current,
      );
      if (now >= earliest) {
        if (performTrmnlSyncRef.current) performTrmnlSyncRef.current();
      } else {
        // Schedule for when the cooldown expires
        trmnlSyncTimerRef.current = setTimeout(() => {
          if (performTrmnlSyncRef.current) performTrmnlSyncRef.current();
        }, earliest - now);
      }
    }, 10 * 1000); // 10-second debounce after last change
    return () => { if (trmnlSyncTimerRef.current) clearTimeout(trmnlSyncTimerRef.current); };
  }, [tasks, unscheduledTasks, habits, habitLogs, todayRoutines, routinesEnabled, trmnlConfig?.enabled, dataLoaded]);

  // Auto-archive completed inbox tasks older than the configured threshold
  useEffect(() => {
    if (!dataLoaded || inboxAutoArchiveDays === 0) return;
    const cutoff = Date.now() - inboxAutoArchiveDays * 86400000;
    setUnscheduledTasks(prev => {
      const hasChanges = prev.some(t => t.completed && !t.archived && t.completedAt && new Date(t.completedAt).getTime() < cutoff);
      if (!hasChanges) return prev;
      return prev.map(t =>
        (t.completed && !t.archived && t.completedAt && new Date(t.completedAt).getTime() < cutoff)
          ? { ...t, archived: true }
          : t
      );
    });
  }, [dataLoaded, inboxAutoArchiveDays]);

  // Obsidian sync: restore vault handle on mount and do initial sync
  useEffect(() => {
    if (!dataLoaded) return;
    if (isNativeAndroid()) {
      // Android: vault is configured natively — detect and auto-enable
      try {
        const cfg = nativeGetVaultConfig();
        if (cfg?.configured) {
          obsidianVaultHandleRef.current = 'native';
          if (!obsidianConfig?.enabled) {
            setObsidianConfig({ enabled: true, dailyNotesPath: cfg.folder || '', newNotesFolder: cfg.newNotesFolder || 'dayGLANCE', dailyNotePattern: cfg.pattern || 'yyyy-MM-dd' });
          }
          // notifyNativeReady() is called in performObsidianSync's finally block
          performObsidianSync();
          // Populate wikilink autocomplete candidates from the vault index
          try {
            const notes = nativeListNotes('');
            if (notes) setWikilinkCandidates(notes.map(p => p.split('/').pop().replace(/\.md$/i, '')).sort((a, b) => a.localeCompare(b)));
          } catch {}
        } else {
          // No Obsidian configured — release the splash immediately
          notifyNativeReady();
        }
      } catch (err) {
        console.error('Obsidian: failed to read native vault config', err);
        notifyNativeReady();
      }
      return;
    }
    if (!obsidianConfig?.enabled) return;
    (async () => {
      try {
        const handle = await tryRestoreVaultAccess();
        if (handle) {
          obsidianVaultHandleRef.current = handle;
          performObsidianSync();
          listVaultNotes(handle).then(names => setWikilinkCandidates(names)).catch(() => {});
        }
      } catch (err) {
        console.error('Obsidian: failed to restore vault access', err);
      }
    })();
  }, [dataLoaded, obsidianConfig?.enabled]);

  // Obsidian sync: on visibility change (user switches back from Obsidian / native settings)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (isNativeAndroid()) {
        // Re-check in case user just configured the vault in native settings
        try {
          const cfg = nativeGetVaultConfig();
          if (cfg?.configured) {
            obsidianVaultHandleRef.current = 'native';
            if (!obsidianConfig?.enabled) {
              setObsidianConfig({ enabled: true, dailyNotesPath: cfg.folder || '', newNotesFolder: cfg.newNotesFolder || 'dayGLANCE', dailyNotePattern: cfg.pattern || 'yyyy-MM-dd' });
            }
            performObsidianSync();
            // Refresh candidates in case new notes were added while in native settings
            try {
              const notes = nativeListNotes('');
              if (notes) setWikilinkCandidates(notes.map(p => p.split('/').pop().replace(/\.md$/i, '')).sort((a, b) => a.localeCompare(b)));
            } catch {}
          }
        } catch {}
        return;
      }
      if (obsidianVaultHandleRef.current) {
        performObsidianSync();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [obsidianConfig?.enabled]);

  // Obsidian sync: poll every 5 minutes while open
  useEffect(() => {
    if (!obsidianConfig?.enabled) return;
    const timer = setInterval(() => {
      if (obsidianVaultHandleRef.current) performObsidianSync();
    }, 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [obsidianConfig?.enabled]);

  // Keep always-fresh refs so the interval-triggered performObsidianSync never reads stale state.
  useEffect(() => { obsidianTasksRef.current = tasks; }, [tasks]);
  useEffect(() => { obsidianInboxRef.current = unscheduledTasks; }, [unscheduledTasks]);

  // Obsidian writeback: detect completion/scheduling/title changes and write back to vault
  useEffect(() => {
    if (!obsidianConfig?.enabled || !obsidianVaultHandleRef.current) return;
    // Skip writeback while a sync is replacing the task arrays
    if (obsidianSyncInProgressRef.current) return;

    const allObsidian = [...tasks, ...unscheduledTasks].filter(t => t.importSource === 'obsidian' && t.obsidianRawTitle);
    const prev = obsidianPrevTaskStateRef.current;
    const isNative = obsidianVaultHandleRef.current === 'native';

    // IDs of tasks whose obsidianRawTitle / id changed during this loop (title writeback).
    // We collect them and apply a single batched state update after the loop.
    const titleUpdates = []; // { oldId, newId, newRawTitle }

    for (const task of allObsidian) {
      const p = prev[task.id];
      if (!p) continue;

      const titleChanged = p.title !== undefined && p.title !== task.title;
      const stateChanged = p.completed !== task.completed || p.startTime !== (task.startTime || null) || p.duration !== (task.duration || null);

      // Detect rescheduling to a different day by comparing against the prev snapshot
      // (not obsidianFileDate) so this is a one-shot trigger per reschedule.
      const dateChanged = !!(task.date && p.date && task.date !== p.date);

      if (!titleChanged && !stateChanged && !dateChanged) continue;

      // Always write back to the original file the task was parsed from.
      // obsidianFileDate is set at parse time and never changes.
      const sourceDate = task.obsidianFileDate || task.id.match(/^obsidian-(\d{4}-\d{2}-\d{2})/)?.[1] || task.date;
      if (!sourceDate) continue;

      // Derive the new raw title (strip #obsidian tag the app appends for display)
      const newRawTitle = titleChanged
        ? task.title.replace(/\s*#obsidian\b/gi, '').trim()
        : undefined;

      // When the task has been rescheduled to a different day, pass the new date
      // so the write adds/updates an inline date prefix in the original file
      // (e.g. "- [ ] 2026-03-20 10:00 Task").  No new file is created.
      const targetDate = dateChanged ? task.date : undefined;

      // All-day tasks have startTime: '00:00' in state but must write back with no
      // time prefix so the line stays as "YYYY-MM-DD Task" (not "YYYY-MM-DD 00:00-00:30 Task").
      const writeStartTime = task.isAllDay ? null : (task.startTime || null);
      const writeDuration = task.isAllDay ? null : (task.duration || null);
      const taskHeading = obsidianConfig?.taskHeading || '## Tasks';
      if (isNative) {
        writeTaskStateNative(
          sourceDate,
          task.obsidianRawTitle,
          task.completed,
          writeStartTime,
          newRawTitle,
          writeDuration,
          targetDate,
          taskHeading,
        );
      } else {
        writeTaskStateToFile(
          obsidianVaultHandleRef.current,
          obsidianConfig.dailyNotesPath || '',
          sourceDate,
          task.obsidianRawTitle,
          task.completed,
          writeStartTime,
          newRawTitle,
          writeDuration,
          targetDate,
          taskHeading,
        ).catch(err => console.error('Obsidian: failed to write task state back', err));
      }

      if (titleChanged && newRawTitle) {
        // New stable ID based on the updated raw title (mirrors parseTasksFromMarkdown)
        const newId = `obsidian-${sourceDate}-${obsidianSimpleHash(newRawTitle)}`;
        titleUpdates.push({ oldId: task.id, newId, newRawTitle });
      }
    }

    // Apply title-writeback ID/obsidianRawTitle updates to React state
    if (titleUpdates.length > 0) {
      const applyUpdates = t => {
        const u = titleUpdates.find(u => u.oldId === t.id);
        return u ? { ...t, id: u.newId, obsidianRawTitle: u.newRawTitle } : t;
      };
      setTasks(prev => prev.map(applyUpdates));
      setUnscheduledTasks(prev => prev.map(applyUpdates));
    }

    // Update previous-state snapshot (keyed by new IDs after title changes)
    // Include date so we can detect future rescheduling to a different day
    const next = {};
    for (const task of allObsidian) {
      const u = titleUpdates.find(u => u.oldId === task.id);
      const snapshotId = u ? u.newId : task.id;
      next[snapshotId] = { completed: task.completed, startTime: task.startTime || null, duration: task.duration || null, title: task.title, date: task.date || null };
    }
    obsidianPrevTaskStateRef.current = next;
  }, [tasks, unscheduledTasks, obsidianConfig?.enabled]);


  // Auto-backup timer
  useEffect(() => {
    if (!dataLoaded) return;
    const localEnabled = autoBackupConfig.local.enabled;
    const remoteEnabled = autoBackupConfig.remote.enabled;
    if (!localEnabled && !remoteEnabled) return;

    const checkAndBackup = () => {
      const now = Date.now() / 1000;

      if (localEnabled) {
        // Read from localStorage directly to avoid stale closure
        const lastLocal = localStorage.getItem('day-planner-auto-backup-local-last');
        const elapsed = lastLocal ? now - new Date(lastLocal).getTime() / 1000 : Infinity;
        if (elapsed >= AUTO_BACKUP_INTERVALS[autoBackupConfig.local.frequency]) {
          performLocalBackup(autoBackupConfig.local.frequency);
        }
      }

      if (remoteEnabled) {
        const lastRemote = localStorage.getItem('day-planner-auto-backup-remote-last');
        const elapsed = lastRemote ? now - new Date(lastRemote).getTime() / 1000 : Infinity;
        if (elapsed >= AUTO_BACKUP_INTERVALS[autoBackupConfig.remote.frequency]) {
          performRemoteBackup(autoBackupConfig.remote.frequency);
        }
      }
    };

    // Check immediately on enable/frequency change
    checkAndBackup();

    // Then check every 60 seconds
    const timer = setInterval(checkAndBackup, 60 * 1000);
    return () => clearInterval(timer);
  }, [dataLoaded, autoBackupConfig.local.enabled, autoBackupConfig.local.frequency, autoBackupConfig.remote.enabled, autoBackupConfig.remote.frequency]);


  const getNextQuarterHour = () => {
    const now = new Date();
    const minutes = now.getMinutes();
    const nextQuarter = Math.ceil(minutes / 15) * 15;
    
    if (nextQuarter === 60) {
      now.setHours(now.getHours() + 1);
      now.setMinutes(0);
    } else {
      now.setMinutes(nextQuarter);
    }
    
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  };

  const getTaskCalendarStyle = (task, isDarkMode) => {
    // Native Android calendar events: apply the calendar color from the device.
    // Skip if the user has set a color override (task.color) — the Tailwind class handles it.
    if (task.nativeCalendarColor && !task.isTaskCalendar && !task.color) {
      return { backgroundColor: task.nativeCalendarColor };
    }
    if (!task.isTaskCalendar) return {};

    if (task.completed) {
      // Completed: solid muted gray with lower opacity
      return {
        backgroundColor: isDarkMode ? '#4b5563' : '#6b7280',
        opacity: 0.5
      };
    }

    // Active: -45° diagonal stripes
    const color1 = isDarkMode ? '#4b5563' : '#6b7280';
    const color2 = isDarkMode ? '#6b7280' : '#9ca3af';

    return {
      background: `repeating-linear-gradient(
        -45deg,
        ${color1},
        ${color1} 8px,
        ${color2} 8px,
        ${color2} 16px
      )`
    };
  };


  const timeToMinutes = (time) => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const minutesToTime = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  };

  // Check if a task placement would conflict with imported calendar events or reminders
  // Returns { conflicted: boolean, adjustedStartTime: string, conflictingEvent: task }
  const getAdjustedTimeForImportedConflicts = (taskId, startTime, duration, dateStr) => {
    // Get all imported calendar events and task calendar reminders for this date
    const importedEvents = tasks.filter(t =>
      t.date === dateStr &&
      t.imported &&
      !t.isAllDay &&
      t.id !== taskId
    );

    // Also treat today's timeline-placed routine chips as obstacles
    const todayStr = dateToString(new Date());
    if (routinesEnabled && dateStr === todayStr) {
      todayRoutines.filter(r => !r.isAllDay && r.startTime).forEach(r => {
        importedEvents.push({ startTime: r.startTime, duration: r.duration, title: r.name, id: `routine-${r.id}` });
      });
    }

    if (importedEvents.length === 0) {
      return { conflicted: false, adjustedStartTime: startTime, conflictingEvent: null };
    }

    let currentStart = timeToMinutes(startTime);
    let currentEnd = currentStart + duration;
    let conflictingEvent = null;
    let wasAdjusted = false;

    // Keep adjusting until no conflicts with imported events
    let maxIterations = 100; // Prevent infinite loops
    while (maxIterations > 0) {
      maxIterations--;
      let foundConflict = false;

      for (const event of importedEvents) {
        const eventStart = timeToMinutes(event.startTime);
        const eventEnd = eventStart + event.duration;

        // Check for overlap
        if (currentStart < eventEnd && currentEnd > eventStart) {
          foundConflict = true;
          wasAdjusted = true;
          conflictingEvent = event;
          // Move to end of this event
          currentStart = eventEnd;
          currentEnd = currentStart + duration;
          break;
        }
      }

      if (!foundConflict) break;
    }

    // Cap at end of day
    if (currentStart >= 24 * 60) {
      currentStart = 24 * 60 - duration;
    }

    return {
      conflicted: wasAdjusted,
      adjustedStartTime: minutesToTime(currentStart),
      conflictingEvent
    };
  };

  const toggleSection = (sectionName) => {
    setMinimizedSections(prev => ({
      ...prev,
      [sectionName]: !prev[sectionName]
    }));
  };

  const selectAllTags = () => {
    setSelectedTags([...allTags]);
  };

  // Get today's date string for overdue comparisons
  const getTodayStr = () => dateToString(new Date());

  // Get overdue tasks: incomplete tasks past their end time + inbox tasks with past deadlines
  // Includes recurring instances for today (matches dayGLANCE widget behavior)
  const getOverdueTasks = () => {
    const todayStr = getTodayStr();
    const now = currentTime || new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const isOverdueToday = (t) => {
      if (t.date !== todayStr || t.isAllDay) return false;
      const [h, m] = (t.startTime || '00:00').split(':').map(Number);
      const endMinutes = h * 60 + m + (t.duration || 30);
      return endMinutes <= nowMinutes;
    };

    // Incomplete scheduled tasks from past dates (not imported events)
    // + today's tasks whose end time has passed
    const overdueScheduled = tasks.filter(t => {
      if (t.completed || t.imported || t.isExample) return false;
      if (t.date < todayStr) return true;
      return isOverdueToday(t);
    }).map(t => ({ ...t, _overdueType: 'scheduled' }));

    // Today's recurring instances past their end time
    const todayRecurring = expandedRecurringTasks.filter(t =>
      t.date === todayStr && !t.completed && !t.isExample && isOverdueToday(t)
    ).map(t => ({ ...t, _overdueType: 'scheduled' }));

    // Past uncompleted recurring all-day instances (look back up to 7 days)
    const overdueRecurringAllDay = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = dateToString(d);
      for (const template of recurringTasks) {
        if (template.isExample) continue;
        const isTemplateAllDay = template.isAllDay ?? false;
        if (!isTemplateAllDay) continue;
        const occs = getOccurrencesInRange(template, dateStr, dateStr);
        if (occs.length === 0) continue;
        if ((template.completedDates || []).includes(dateStr)) continue;
        const exception = template.exceptions?.[dateStr];
        if (exception?.completed) continue;
        const instanceId = `recurring-${template.id}-${dateStr}`;
        // Skip if already covered by overdueScheduled (shouldn't happen for recurring, but be safe)
        if (overdueScheduled.some(t => t.id === instanceId)) continue;
        overdueRecurringAllDay.push({
          id: instanceId,
          title: exception?.title ?? template.title,
          startTime: null,
          duration: exception?.duration ?? template.duration,
          color: exception?.color ?? template.color,
          completed: false,
          isAllDay: true,
          notes: template.notes || '',
          subtasks: template.subtasks || [],
          date: dateStr,
          isRecurring: true,
          recurringTemplateId: template.id,
          recurrenceType: template.recurrence?.type,
          _overdueType: 'scheduled',
        });
      }
    }

    // Inbox tasks with past deadlines
    const overdueDeadlines = unscheduledTasks.filter(t =>
      t.deadline && t.deadline < todayStr && !t.completed && !t.isExample
    ).map(t => ({ ...t, _overdueType: 'deadline' }));

    return [...overdueScheduled, ...todayRecurring, ...overdueRecurringAllDay, ...overdueDeadlines];
  };
  const parseRecurringId = (id) => {
    if (typeof id !== 'string' || !id.startsWith('recurring-')) return null;
    const parts = id.split('-');
    // Date is always the last 3 segments (YYYY-MM-DD), template ID is everything between
    const dateStr = parts.slice(-3).join('-');
    const rawTemplateId = parts.slice(1, -3).join('-');
    const templateId = /^\d+$/.test(rawTemplateId) ? Number(rawTemplateId) : rawTemplateId;
    return { templateId, dateStr };
  };

  // Refs for functions/values defined after the useDragDrop call (TDZ-safe pattern).
  // moveToRecycleBin/clearDeadline: circular dep with useTaskActions (wired after useTaskActions).
  // Others: defined later in the component body (wired immediately after their definitions).
  const moveToRecycleBinRef = useRef(null);
  const clearDeadlineRef = useRef(null);
  const expandedRecurringTasksRef = useRef(null);
  const moveToInboxRef = useRef(null);
  const openMobileEditTaskRef = useRef(null);
  const openMobileEditNativeEventRef = useRef(null);

  // useDragDrop is placed here — after all its dependencies are defined and before any
  // useEffect that references its state (hoverPreviewTime at ~line 2671) to avoid TDZ errors.
  const {
    // state
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
    // refs
    autoScrollInterval,
    frameResizingRef,
    stickyHeaderRef,
    // position helpers
    getHourHeight,
    minutesToPosition,
    positionToMinutes,
    durationToHeight,
    calculateTaskPosition,
    // cursor + calendar hover/click handlers
    getTimeFromCursorPosition,
    openNewTaskAtTime,
    handleCalendarMouseMove,
    handleCalendarMouseLeave,
    // desktop drag start/end + auto-scroll
    handleDragStart,
    handleDragEnd,
    updateDragAutoScroll,
    // desktop drag-over handlers
    handleDragOver,
    handleDragOverInbox,
    handleDragOverRecycleBin,
    // desktop drop on calendar + date header
    handleDropOnCalendar,
    handleDropOnDateHeader,
    // desktop drop on inbox + recycle bin
    handleDropOnInbox,
    handleDropOnRecycleBin,
    // task resize handlers
    handleResizeStart,
    handleTouchResizeStart,
    // routine + frame resize handlers
    handleRoutineResizeStart,
    handleTouchRoutineResizeStart,
    handleFrameResizeStart,
    // mobile drag state
    mobileDragPreviewTime, setMobileDragPreviewTime,
    mobileDragPreviewDate, setMobileDragPreviewDate,
    mobileDragTaskIdState, setMobileDragTaskIdState,
    mobileDragIsRoutine,
    // mobile swipe refs
    swipeTouchStartX,
    swipeTouchStartY,
    swipeCurrentOffset,
    swipedTaskId,
    swipeDirection,
    swipeLocked,
    swipeIsVertical,
    swipeTaskElement,
    swipeSchedulingInboxTaskId,
    // mobile long-press drag refs
    mobileDragActive,
    mobileDragTaskId,
    mobileDragTimer,
    mobileDragOriginalTask,
    mobileDragTouchStartPos,
    mobileDragAutoScrollInterval,
    mobileDragLastTouch,
    mobileDragScrollDir,
    mobileDragPreventScrollRef,
    mobileDragStartScrollTop,
    mobileDateHeaderRef,
    mobileAllDaySectionRef,
    mobileDragSourceType,
    mobileDragPreviewTimeRef,
    mobileDragPreviewDateRef,
    // mobile touch start + move
    handleMobileTaskTouchStart,
    handleMobileTaskTouchMove,
    // mobile touch end (swipe actions)
    handleMobileTaskTouchEnd,
  } = useDragDrop({
    calendarRef, timeGridRef,
    setNewTask, setShowAddTask, selectedDate, setExpandedNotesTaskId,
    tasks, setTasks, setUnscheduledTasks, setRecurringTasks, setRecycleBin, setTodayRoutines,
    pushUndo, parseRecurringId, getAdjustedTimeForImportedConflicts, wouldExceedMaxColumns,
    playUISound, setSyncNotification, onboardingProgress, setOnboardingProgress,
    moveToRecycleBinRef, clearDeadlineRef,
    gtdFrames, setGtdFrames,
    unscheduledTasks, setMobileEditingTask,
    expandedRecurringTasksRef, moveToInboxRef, openMobileEditTaskRef, openMobileEditNativeEventRef,
  });

  const {
    editingTaskId, setEditingTaskId,
    editingTaskText, setEditingTaskText,
    editingInputRef,
    startEditingTask,
    saveTaskTitle,
    cancelEditingTask,
    applySuggestionForEdit,
    handleEditKeyDown,
    handleEditInputChange,
  } = useTaskFormHelpers({
    tasks,
    setTasks,
    setUnscheduledTasks,
    setRecurringTasks,
    pushUndo,
    onboardingProgress,
    setOnboardingProgress,
    parseRecurringId,
    getAdjustedTimeForImportedConflicts,
    buildSuggestions,
    suggestions,
    selectedSuggestionIndex,
    showSuggestions,
    setSuggestions,
    setSelectedSuggestionIndex,
    setShowSuggestions,
    setSuggestionContext,
  });

  const updateDailyNote = (dateStr, text) => {
    setDailyNotes(prev => {
      const next = { ...prev };
      if (!text || !text.trim()) {
        // Keep a tombstone so sync can propagate the deletion
        next[dateStr] = { text: '', lastModified: new Date().toISOString(), deleted: true };
      } else {
        next[dateStr] = { text, lastModified: new Date().toISOString() };
      }
      return next;
    });
    // If Obsidian integration is enabled, write the note to the vault
    if (obsidianConfig?.enabled && obsidianVaultHandleRef.current) {
      if (obsidianVaultHandleRef.current === 'native') {
        // writeDailyNoteNative is synchronous (JavascriptInterface blocks the JS thread
        // during the SAF write).  Defer it by one frame so the note modal closes
        // immediately rather than waiting ~100–200 ms for the I/O to complete.
        const _d = dateStr, _t = text || '';
        setTimeout(() => writeDailyNoteNative(_d, _t), 0);
      } else {
        writeDailyNoteFile(
          obsidianVaultHandleRef.current,
          obsidianConfig.dailyNotesPath || '',
          dateStr,
          text || '',
          obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd'
        ).catch(err => console.error('Obsidian: failed to write daily note', err));
      }
    }
  };

  // TRMNL e-ink dashboard sync — push today's data to TRMNL webhook
  const performTrmnlSync = async () => {
    if (!trmnlConfig?.enabled || !trmnlConfig?.webhookUrl) return;
    if (trmnlSyncInProgressRef.current) return; // prevent concurrent pushes
    trmnlSyncInProgressRef.current = true;
    setTrmnlSyncStatus('syncing');
    try {
      const today = selectedDate ? dateToString(selectedDate) : new Date().toISOString().slice(0, 10);
      const mergeVars = gatherTrmnlData({
        tasks,
        unscheduledTasks,
        selectedDate: today,
        use24HourClock: use24HourClock,
        habits,
        habitLogs,
        weatherSummary: weather ? `${weather.temp}°${weatherTempUnit === 'celsius' ? 'C' : 'F'} ${weather.description || ''}`.trim() : '',
        dailyNotes,
        todayRoutines,
        routinesEnabled,
      });
      const result = await pushToTrmnl(trmnlConfig, mergeVars);
      trmnlLastPushRef.current = Date.now();
      if (result.success) {
        trmnlBackoffCountRef.current = 0; // reset exponential backoff on success
        setTrmnlSyncStatus('success');
        const ts = new Date().toISOString();
        setTrmnlLastSynced(ts);
        localStorage.setItem('day-planner-trmnl-last-synced', ts);
      } else {
        setTrmnlSyncStatus('error');
        console.warn('TRMNL sync failed:', result.error);
        if (result.rateLimited) {
          trmnlBackoffCountRef.current += 1;
          // Exponential backoff: 5 min, 10 min, 20 min, 40 min … capped at 60 min
          const backoffMins = Math.min(5 * Math.pow(2, trmnlBackoffCountRef.current - 1), 60);
          trmnlBackoffUntilRef.current = Date.now() + backoffMins * 60 * 1000;
        }
      }
    } catch (err) {
      setTrmnlSyncStatus('error');
      console.error('TRMNL sync error:', err);
    } finally {
      trmnlSyncInProgressRef.current = false;
    }
  };

  // Callbacks for reading/writing linked wiki notes from the vault
  const loadWikiNote = useCallback(async (noteName) => {
    const handle = obsidianVaultHandleRef.current;
    if (!handle) return null;
    // Strip [[Note#Heading]] fragment — we load the whole note file, not just a section
    const notePath = noteName.split('#')[0].trim();
    if (handle === 'native') {
      return nativeGetNote(notePath);
    }
    try {
      return await readWikiNote(handle, notePath);
    } catch (err) {
      console.error('Failed to read wiki note:', err);
      return null;
    }
  }, []);

  const saveWikiNote = useCallback(async (noteName, content) => {
    const handle = obsidianVaultHandleRef.current;
    if (!handle) return;
    // Strip [[Note#Heading]] fragment for write path too
    const notePath = noteName.split('#')[0].trim();
    if (handle === 'native') {
      nativeWriteNote(notePath, content);
      return;
    }
    try {
      await writeWikiNote(handle, notePath, content, obsidianConfig?.newNotesFolder ?? 'dayGLANCE');
    } catch (err) {
      console.error('Failed to write wiki note:', err);
    }
  }, [obsidianConfig?.newNotesFolder]);

  // Opens a vault note in the Obsidian app (Android) or via obsidian:// URI (web/desktop).
  const openInObsidian = useCallback((noteName) => {
    const handle = obsidianVaultHandleRef.current;
    if (!handle) return;
    if (handle === 'native') {
      nativeOpenNote(noteName);
      return;
    }
    // Web/desktop: construct obsidian:// deep link using the vault folder name
    const vaultName = handle.name;
    if (vaultName) {
      window.open(
        `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(noteName)}`,
        '_blank',
      );
    }
  }, []);

  // Signal the native Android side that the app is interactive and the initial
  // Obsidian sync has completed. This releases the splash screen that was held
  // to hide the blocking sync freeze. Only fires once per session.
  const nativeReadyNotifiedRef = useRef(false);
  const notifyNativeReady = useCallback(() => {
    if (!isNativeAndroid()) return;
    if (nativeReadyNotifiedRef.current) return;
    nativeReadyNotifiedRef.current = true;
    try { window.DayGlanceNative?.notifyAppReady?.(); } catch {}
  }, []);

  // Obsidian vault sync — reads daily notes + imports tasks
  const performObsidianSync = async () => {
    if (obsidianSyncInProgressRef.current) return;
    // If the vault handle was lost (e.g. permission expired after page reload),
    // try to re-acquire it. When called from a button click this will trigger
    // the browser's requestPermission prompt. When called from a timer/visibility
    // event without a user gesture it will silently return null and we skip.
    if (!obsidianVaultHandleRef.current) {
      try {
        const handle = await getVaultAccess();
        if (!handle) return;
        obsidianVaultHandleRef.current = handle;
      } catch {
        return;
      }
    }
    obsidianSyncInProgressRef.current = true;
    const syncStart = Date.now();
    setObsidianSyncStatus('syncing');

    try {
      const isNative = obsidianVaultHandleRef.current === 'native';
      // syncObsidianVaultNative is synchronous (JavascriptInterface blocks the JS
      // thread until all SAF file reads complete).  Wrap it in a one-frame
      // setTimeout so React finishes its current render — and the UI stays
      // responsive — before the blocking I/O runs.  This prevents the brief
      // white/blank flash users see when the app is opened with Obsidian enabled.
      // Use refs so interval-triggered syncs always see the latest task state,
      // not the stale closure from when the interval was set up.
      const currentTasks = obsidianTasksRef.current;
      const currentInbox = obsidianInboxRef.current;
      const result = isNative
        ? await new Promise(resolve => setTimeout(() => resolve(syncObsidianVaultNative(
            obsidianConfig?.dailyNotesPath || '',
            syncRetentionDays,
            currentTasks,
            currentInbox,
          )), 0))
        : await syncObsidianVault(
            obsidianVaultHandleRef.current,
            obsidianConfig?.dailyNotesPath || '',
            syncRetentionDays,
            currentTasks,
            currentInbox,
            obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd',
          );

      // Update daily notes — replace with Obsidian-sourced notes
      setDailyNotes(prev => {
        const next = {};
        // Keep non-Obsidian notes (from dates without Obsidian files, if integration was just enabled)
        // Actually when Obsidian is enabled, Obsidian is the ONLY source — so just use the result
        for (const [dateStr, note] of Object.entries(result.dailyNotes)) {
          next[dateStr] = note;
        }
        return next;
      });

      // Update tasks — remove old Obsidian imports, add fresh ones.
      // Preserve app-only fields (projectId, deadline) that aren't stored in the
      // Obsidian markdown and would otherwise be wiped on every re-sync.
      setTasks(prev => {
        const nonObsidian = prev.filter(t => t.importSource !== 'obsidian');
        const oldObsidianMap = new Map(prev.filter(t => t.importSource === 'obsidian').map(t => [String(t.id), t]));
        const merged = result.scheduledTasks.map(t => {
          const old = oldObsidianMap.get(String(t.id));
          if (!old) return t;
          return { ...t, ...(old.projectId ? { projectId: old.projectId } : {}), ...(old.deadline ? { deadline: old.deadline } : {}) };
        });
        return [...nonObsidian, ...merged];
      });

      // Update inbox — remove old Obsidian imports, add fresh ones.
      // Preserve app-only fields (projectId, deadline) that aren't stored in the
      // Obsidian markdown and would otherwise be wiped on every re-sync.
      setUnscheduledTasks(prev => {
        const nonObsidian = prev.filter(t => t.importSource !== 'obsidian');
        const oldObsidianMap = new Map(prev.filter(t => t.importSource === 'obsidian').map(t => [String(t.id), t]));
        const merged = result.inboxTasks.map(t => {
          const old = oldObsidianMap.get(String(t.id));
          if (!old) return t;
          return { ...t, ...(old.projectId ? { projectId: old.projectId } : {}), ...(old.deadline ? { deadline: old.deadline } : {}) };
        });
        return [...nonObsidian, ...merged];
      });

      // Snapshot the fresh task state so the writeback effect doesn't re-trigger
      const snapshot = {};
      for (const t of [...result.scheduledTasks, ...result.inboxTasks]) {
        snapshot[t.id] = { completed: t.completed, startTime: t.startTime || null, duration: t.duration || null, title: t.title, date: t.date || null };
      }
      obsidianPrevTaskStateRef.current = snapshot;

      const elapsed = Date.now() - syncStart;
      if (elapsed < 2000) await new Promise(r => setTimeout(r, 2000 - elapsed));
      const now = new Date().toISOString();
      setObsidianLastSynced(now);
      localStorage.setItem('day-planner-obsidian-last-synced', now);
      setObsidianSyncError(null);
      setObsidianSyncStatus('success');
      setTimeout(() => setObsidianSyncStatus(s => s === 'success' ? 'idle' : s), 3000);
    } catch (err) {
      console.error('Obsidian sync error:', err);
      setObsidianSyncError(err.message);
      setObsidianSyncStatus('error');
      setTimeout(() => setObsidianSyncStatus(s => s === 'error' ? 'idle' : s), 5000);
    } finally {
      obsidianSyncInProgressRef.current = false;
      notifyNativeReady();
    }
  };

  // Voice input — reset state when modal opens, cleanup recognition on close
  // Voice input — reset state when modal opens, cleanup on close
  useEffect(() => {
    if (showVoiceInput) {
      setVoiceIsRecording(false);
      setVoiceIsTranscribing(false);
      setVoiceTranscript('');
      setVoiceParsedTasks(null);
      setVoiceParsedEdits(null);
      setVoiceIsParsing(false);
      setVoiceParseError('');
      setVoiceEditingParsed(null);
      setVoiceManualMode(false);
      setVoiceMicError(null);
    } else {
      // Cleanup MediaRecorder on modal close
      const ref = voiceRecorderRef.current;
      if (ref) {
        if (ref.recorder.state !== 'inactive') ref.recorder.stop();
        ref.stream.getTracks().forEach(t => t.stop());
        voiceRecorderRef.current = null;
      }
      voiceAudioChunksRef.current = [];
    }
  }, [showVoiceInput]);

  const voiceStartRecording = useCallback(async () => {
    if (!voiceCanRecord) return;
    setVoiceMicError(null);
    setVoiceParseError('');
    setVoiceTranscript('');
    setVoiceParsedTasks(null);
    setVoiceParsedEdits(null);

    // On Android, use the native MediaRecorder bridge instead of WebView getUserMedia,
    // which is unreliable and produces NotReadableError on many devices/WebView versions.
    const nativeResult = nativeStartRecording();
    if (nativeResult !== null) {
      if (nativeResult === 'ok') {
        voiceRecorderRef.current = { native: true };
        setVoiceIsRecording(true);
      } else {
        setVoiceParseError(`Microphone error: ${nativeResult.error ?? nativeResult}`);
        setVoiceMicError('error');
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      const recorder = new MediaRecorder(stream, { mimeType });
      voiceAudioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) voiceAudioChunksRef.current.push(e.data);
      };

      voiceRecorderRef.current = { recorder, stream };
      recorder.start();
      setVoiceIsRecording(true);
    } catch (err) {
      console.error('Microphone error:', err);
      const msg = err.name === 'NotAllowedError'
        ? typeof navigator.brave !== 'undefined'
          ? 'Microphone access denied. Brave Shields may be blocking access — try disabling Shields for this site, or allow microphone permissions in your browser settings.'
          : 'Microphone access denied. Please allow microphone permissions in your browser settings.'
        : err.name === 'NotFoundError'
        ? 'No microphone found. Please connect a microphone and try again.'
        : `Microphone error: ${err.message}`;
      setVoiceParseError(msg);
      setVoiceMicError('error');
    }
  }, [voiceCanRecord]);

  // When the voice modal is opened via the Android launcher shortcut, auto-start recording.
  useEffect(() => {
    if (showVoiceInput && voiceAutoStartRef.current) {
      voiceAutoStartRef.current = false;
      voiceStartRecording();
    }
  }, [showVoiceInput, voiceStartRecording]);

  const voiceStopRecording = useCallback(async () => {
    const ref = voiceRecorderRef.current;
    if (!ref) return;

    let blob;

    if (ref.native) {
      // Native Android recording path
      voiceRecorderRef.current = null;
      setVoiceIsRecording(false);
      const result = nativeStopRecording();
      if (!result || result.error) {
        setVoiceParseError(`Microphone error: ${result?.error ?? 'unknown'}`);
        setVoiceMicError('error');
        return;
      }
      blob = result;
    } else {
      const { recorder, stream } = ref;

      // Collect recorded audio
      blob = await new Promise((resolve) => {
        recorder.onstop = () => {
          const audioBlob = new Blob(voiceAudioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          voiceAudioChunksRef.current = [];
          resolve(audioBlob);
        };
        if (recorder.state !== 'inactive') recorder.stop();
        else resolve(new Blob([], { type: 'audio/webm' }));
      });

      stream.getTracks().forEach(t => t.stop());
      voiceRecorderRef.current = null;
      setVoiceIsRecording(false);
    }

    // Transcribe + parse in one shot
    if (blob.size > 0) {
      setVoiceIsTranscribing(true);
      try {
        const text = (await aiTranscribe(blob, aiConfig)).trim();
        setVoiceTranscript(text);
        // Immediately parse into tasks
        if (text && aiConfig.enabled && (aiConfig.apiKey || aiConfig.provider === 'ollama')) {
          setVoiceIsParsing(true);
          try {
            const context = { todayDate: dateToString(new Date()), existingTags: voiceAllTagsRef.current, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, existingTasks: voiceBuildTaskContextRef.current() };
            const result = await aiJSON(voiceParseSystemPrompt(context), voiceParseUserPrompt(text), aiConfig);
            const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
            let newTasks = [];
            let edits = [];
            if (Array.isArray(result)) {
              newTasks = result;
            } else if (result && typeof result === 'object') {
              newTasks = Array.isArray(result.newTasks) ? result.newTasks : [];
              edits = Array.isArray(result.edits) ? result.edits : [];
            }
            setVoiceParsedTasks(newTasks.map(t => ({ ...t, title: cap(t.title) })));
            const resolved = edits.map(edit => {
              const match = voiceResolveTaskMatchRef.current(edit.taskMatch);
              return { ...edit, resolvedTask: match?.task || null, source: match?.source || null };
            });
            setVoiceParsedEdits(resolved);
          } catch (parseErr) {
            setVoiceParseError(parseErr.message);
            setVoiceParsedTasks([{ title: text.charAt(0).toUpperCase() + text.slice(1), tags: [], date: null, time: null, duration: 30, priority: 0, deadline: null, notes: '' }]);
            setVoiceParsedEdits([]);
          }
          setVoiceIsParsing(false);
        } else {
          setVoiceParsedTasks([{ title: text.charAt(0).toUpperCase() + text.slice(1), tags: [], date: null, time: null, duration: 30, priority: 0, deadline: null, notes: '' }]);
        }
      } catch (err) {
        console.error('Transcription error:', err);
        setVoiceParseError(`Transcription failed: ${err.message}`);
        setVoiceManualMode(true); // fall back to text input
      }
      setVoiceIsTranscribing(false);
    }
  }, [aiConfig]);

  const enterFocusModeRef = useRef(null);
  const openRoutinesDashboardRef = useRef(null);

  const { longPressTriggeredRef, longPressTimerRef } = useMobileInteractions({
    isMobile, performUndo, performRedo,
  });

  useModalClose({
    taskContextMenu, setTaskContextMenu,
    timelineContextMenu, setTimelineContextMenu,
    quickAddFrameModal, setQuickAddFrameModal,
    frameContextMenu, setFrameContextMenu,
    frameAdjustModal, setFrameAdjustModal,
    frameScheduleModal, setFrameScheduleModal,
    showFramesModal, setShowFramesModal, setEditingFrame,
    showSpotlight, setShowSpotlight,
    showHelpModal, setShowHelpModal,
    showShortcutHelp, setShowShortcutHelp,
    editingRecurrenceTaskId, setEditingRecurrenceTaskId,
    showMonthView, setShowMonthView,
    showAutoBackupManager, setShowAutoBackupManager, setAutoBackupRestoreConfirm,
    showBackupMenu, setShowBackupMenu,
    showVoiceInput, setShowVoiceInput,
    showSettings, setShowSettings,
    showRemindersSettings, setShowRemindersSettings,
    showWeeklyReview, setShowWeeklyReview,
    showMobileDailySummary, setShowMobileDailySummary,
    showAddTask, setShowAddTask, setShowNewTaskDeadlinePicker,
    showRecurrencePicker, setShowRecurrencePicker,
    focusLogModalDate, setFocusLogModalDate,
  });

  useKeyboardShortcuts({
    performUndo, performRedo,
    setShowSpotlight, setSpotlightQuery, setSpotlightSelectedIndex, playUISound,
    setShowShortcutHelp,
    showAddTask, showFocusMode, showRoutinesDashboard, showShortcutHelp, showSpotlight,
    showSettings, showRemindersSettings, showWeeklyReview, showVoiceInput,
    showHabitModal, showFramesModal, frameAdjustModal, showRescheduleModal,
    selectedDate, hoverPreviewTime, hoverPreviewDate,
    setNewTask, setShowAddTask, setHoverPreviewTime, setHoverPreviewDate,
    routinesEnabled, setRoutinesEnabled, openRoutinesDashboardRef,
    focusModeAvailableRef, enterFocusModeRef,
    setDarkMode,
    showMonthView, goToToday, setViewedMonth,
    setShowMonthView,
    setShowMobileTagFilter,
    setShowBackupMenu,
    isMobile, setTabletActiveTab,
    aiConfig, setShowVoiceInput,
    habitsEnabled, setHabitsEnabled, setShowHabitModal,
    goalsProjectsEnabled, setGoalsProjectsEnabled, showGoalsDashboard, setShowGoalsDashboard,
    gtdFrames, setShowRescheduleModal, setRescheduleResults, setRescheduleError,
    setMobileActiveTab, setMobileSettingsView, setFramesModalTab, setEditingFrame, setShowFramesModal,
    changeDate, setSelectedDate,
    setViewMode, canShowViewCycler,
  });

  const changeViewedMonth = (delta) => {
    setViewedMonth(prev => {
      const newMonth = new Date(prev);
      newMonth.setDate(1); // Set to 1st to avoid month rollover issues
      newMonth.setMonth(newMonth.getMonth() + delta);
      return newMonth;
    });
  };

  const getMonthDays = () => {
    const year = viewedMonth.getFullYear();
    const month = viewedMonth.getMonth();
    
    // First day of the month
    const firstDay = new Date(year, month, 1);
    const firstDayOfWeek = (firstDay.getDay() - weekStartDay + 7) % 7;

    // Last day of the month
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();

    // Generate array of days
    const days = [];

    // Add empty slots for days before month starts
    for (let i = 0; i < firstDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    return days;
  };

  const hasTasksOnDate = (date) => {
    if (!date) return false;
    const dateStr = dateToString(date);
    if (tasks.some(task => task.date === dateStr)) return true;
    // Check recurring tasks for this date
    for (const template of recurringTasks) {
      const occs = getOccurrencesInRange(template, dateStr, dateStr);
      if (occs.length > 0) return true;
    }
    return false;
  };

  // Pre-compute date indicator sets for the viewed month (avoids O(tasks * 42) per render)
  const dateIndicatorData = useMemo(() => {
    const importedDates = new Set();
    const appTaskDates = new Set();
    for (const task of tasks) {
      if (!task.date) continue;
      if (task.imported) importedDates.add(task.date);
      else appTaskDates.add(task.date);
    }
    // Recurring task occurrences for the viewed month range
    const year = viewedMonth.getFullYear();
    const month = viewedMonth.getMonth();
    const rangeStart = dateToString(new Date(year, month, 1));
    const rangeEnd = dateToString(new Date(year, month + 1, 0));
    const recurringDates = new Set();
    for (const template of recurringTasks) {
      const occs = getOccurrencesInRange(template, rangeStart, rangeEnd);
      for (const dateStr of occs) recurringDates.add(dateStr);
    }
    // Inbox tasks with deadlines
    const deadlineDates = new Set();
    for (const task of unscheduledTasks) {
      if (task.deadline) deadlineDates.add(task.deadline);
    }
    return { importedDates, appTaskDates, recurringDates, deadlineDates };
  }, [tasks, recurringTasks, unscheduledTasks, viewedMonth]);

  // Returns which indicator dots to show for a date: { hasNote, hasImported, hasAppTask }
  const getDateIndicators = (date) => {
    if (!date) return { hasNote: false, hasImported: false, hasAppTask: false };
    const dateStr = dateToString(date);
    const note = dailyNotes[dateStr];
    const hasNote = !!(note && note.text && note.text.trim() && !note.deleted);
    const hasImported = dateIndicatorData.importedDates.has(dateStr);
    const hasAppTask = dateIndicatorData.appTaskDates.has(dateStr)
      || dateIndicatorData.recurringDates.has(dateStr)
      || dateIndicatorData.deadlineDates.has(dateStr);
    return { hasNote, hasImported, hasAppTask };
  };

  const openMobileEditTask = (task, isInbox) => {
    setMobileEditingTask(task);
    setMobileEditIsInbox(isInbox);
    if (isInbox) {
      setNewTask({
        title: task.title,
        duration: task.duration || 30,
        color: task.color || colors[0].class,
        openInInbox: true,
        deadline: task.deadline || null,
        priority: task.priority || 0,
        startTime: getNextQuarterHour(),
        date: dateToString(selectedDate),
        isAllDay: false,
        projectId: task.projectId || null,
      });
    } else {
      // Load recurrence from recurring template if editing a recurring task
      let recurrence = null;
      if (typeof task.id === 'string' && task.id.startsWith('recurring-')) {
        const parsed = parseRecurringId(task.id);
        if (parsed) {
          const template = recurringTasks.find(t => t.id === parsed.templateId);
          if (template?.recurrence) {
            recurrence = { ...template.recurrence };
          }
        }
      }
      setNewTask({
        title: task.title,
        startTime: task.startTime || getNextQuarterHour(),
        duration: task.duration || 30,
        date: task.date || dateToString(selectedDate),
        isAllDay: task.isAllDay || false,
        color: task.color || colors[0].class,
        recurrence,
        projectId: task.projectId || null,
        keepUnscheduled: !!(task.projectId && !task.date),
      });
    }
    setShowAddTask(true);
  };
  openMobileEditTaskRef.current = openMobileEditTask;

  const openMobileEditNativeEvent = (task) => {
    const overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}');
    const override = (task.nativeEventId && overrides[String(task.nativeEventId)]) || {};
    setMobileEditingNativeEvent(task);
    setNewTask({
      title: override.title !== undefined ? override.title : task.title,
      date: override.date !== undefined ? override.date : task.date,
      startTime: override.startTime !== undefined ? override.startTime : (task.startTime || '09:00'),
      duration: override.duration !== undefined ? override.duration : (task.duration || 60),
      isAllDay: override.startTime === undefined && (task.isAllDay || false),
      color: override.color || '',
      notes: override.notes !== undefined ? override.notes : (task.notes || ''),
    });
  };
  openMobileEditNativeEventRef.current = openMobileEditNativeEvent;

  const saveMobileEditNativeEvent = async () => {
    if (!mobileEditingNativeEvent) return;
    const orig = mobileEditingNativeEvent;
    const title = newTask.title.trim() || orig.title;
    const date = newTask.date || orig.date;
    const isAllDay = newTask.isAllDay;
    const startTime = isAllDay ? null : (newTask.startTime || orig.startTime || '09:00');
    const duration = isAllDay ? (orig.duration || 60) : (newTask.duration || orig.duration || 60);
    const notes = newTask.notes || '';

    // Optimistically update state immediately
    const applyToTask = (t) => ({
      ...t,
      title,
      date,
      startTime,
      isAllDay,
      duration,
      notes,
      color: newTask.color || '',
    });
    setTasks(prev => prev.map(t => t.nativeEventId === orig.nativeEventId ? applyToTask(t) : t));
    setMobileEditingNativeEvent(null);

    // Attempt to write back to the device calendar
    const endMin = startTime ? timeToMinutes(startTime) + duration : 0;
    const newStart = isAllDay ? date : `${date}T${startTime}:00`;
    const newEnd = isAllDay ? date : `${date}T${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}:00`;
    const result = await nativeUpdateEvent({
      id: orig.nativeEventId,
      title,
      start: newStart,
      end: newEnd,
      allDay: isAllDay,
      notes,
      location: orig.location || '',
    });

    const id = String(orig.nativeEventId);
    const overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}');

    if (result?.success) {
      // Write succeeded — keep state update, clear any stale local override
      // (but preserve color override since the calendar has no color field)
      if (newTask.color) {
        overrides[id] = { ...(overrides[id] || {}), color: newTask.color };
      } else {
        const { color: _c, ...rest } = overrides[id] || {};
        if (Object.keys(rest).length === 0) delete overrides[id];
        else overrides[id] = rest;
      }
    } else {
      // Write failed (e.g. read-only calendar) — store as local override so
      // the changes survive re-fetches
      const updated = {};
      if (title !== orig.title) updated.title = title;
      if (date !== orig.date) updated.date = date;
      if (!isAllDay) { updated.startTime = startTime; updated.duration = duration; }
      if (notes.trim() !== (orig.notes || '').trim()) updated.notes = notes.trim();
      if (newTask.color) updated.color = newTask.color;
      if (Object.keys(updated).length === 0) delete overrides[id];
      else overrides[id] = updated;
    }
    localStorage.setItem('day-planner-native-time-overrides', JSON.stringify(overrides));
  };

  const clearNativeEventOverride = (task) => {
    const id = String(task.nativeEventId);
    const overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}');
    delete overrides[id];
    localStorage.setItem('day-planner-native-time-overrides', JSON.stringify(overrides));
    setMobileEditingNativeEvent(null);
    setNativeCalendarKey(k => k + 1);
  };

  const saveMobileEditTask = () => {
    if (!mobileEditingTask || !newTask.title.trim()) return;
    pushUndo();
    const taskId = mobileEditingTask.id;
    if (mobileEditIsInbox) {
      setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? {
        ...t,
        title: cleanTitle(newTask.title),
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        deadline: newTask.deadline || null,
        priority: newTask.priority || 0,
        projectId: newTask.projectId || undefined,
      } : t));
    } else if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
      const parsed = parseRecurringId(taskId);
      if (parsed) {
        if (!newTask.recurrence) {
          // Recurrence set to none: convert to regular scheduled task and remove recurring template
          const template = recurringTasks.find(t => t.id === parsed.templateId);
          const isCompleted = template?.completedDates?.includes(parsed.dateStr);
          const regularTask = {
            id: crypto.randomUUID(),
            title: cleanTitle(newTask.title),
            startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
            duration: newTask.duration,
            color: newTask.color || colors[0].class,
            completed: isCompleted || false,
            isAllDay: newTask.isAllDay || false,
            notes: template?.notes || '',
            subtasks: template?.subtasks ? JSON.parse(JSON.stringify(template.subtasks)) : [],
            date: newTask.date || parsed.dateStr,
          };
          setTasks(prev => [...prev, regularTask]);
          recordDeletedTaskTombstone(parsed.templateId);
          setRecurringTasks(prev => prev.filter(t => t.id !== parsed.templateId));
        } else {
          const dateChanged = newTask.date && newTask.date !== parsed.dateStr;
          const isDaily = newTask.recurrence?.type === 'daily';
          if (dateChanged && !isDaily) {
            // Date changed for a non-daily recurring instance:
            // skip the original occurrence and create a one-off task on the new date
            setRecurringTasks(prev => prev.map(t => {
              if (t.id !== parsed.templateId) return t;
              return {
                ...t,
                exceptions: {
                  ...t.exceptions,
                  [parsed.dateStr]: { ...(t.exceptions?.[parsed.dateStr] || {}), skipped: true },
                }
              };
            }));
            setTasks(prev => [...prev, {
              id: crypto.randomUUID(),
              title: cleanTitle(newTask.title),
              startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
              duration: newTask.duration,
              color: newTask.color || colors[0].class,
              isAllDay: newTask.isAllDay || false,
              date: newTask.date,
              completed: false,
              notes: '',
              subtasks: [],
            }]);
          } else {
            setRecurringTasks(prev => prev.map(t => {
              if (t.id === parsed.templateId) {
                const updated = {
                  ...t,
                  exceptions: {
                    ...t.exceptions,
                    [parsed.dateStr]: {
                      ...(t.exceptions?.[parsed.dateStr] || {}),
                      title: cleanTitle(newTask.title),
                      startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
                      duration: newTask.duration,
                      isAllDay: newTask.isAllDay || false,
                      color: newTask.color || colors[0].class,
                    }
                  }
                };
                // Update recurrence pattern on template if changed
                updated.recurrence = { ...newTask.recurrence, startDate: t.recurrence?.startDate || parsed.dateStr.substring(0, 8) + '01' };
                return updated;
              }
              return t;
            }));
          }
        }
      }
    } else if (newTask.recurrence) {
      // Convert regular task to recurring: remove from tasks, create recurring template
      const existingTask = tasks.find(t => t.id === taskId);
      const taskDate = newTask.date || existingTask?.date || dateToString(selectedDate);
      const template = {
        id: crypto.randomUUID(),
        title: cleanTitle(newTask.title),
        startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
        duration: newTask.duration,
        color: newTask.color || colors[0].class,
        isAllDay: newTask.isAllDay || false,
        notes: existingTask?.notes || '',
        subtasks: existingTask?.subtasks || [],
        recurrence: { ...newTask.recurrence, startDate: taskDate },
        completedDates: existingTask?.completed ? [taskDate] : [],
        exceptions: {}
      };
      setTasks(prev => prev.filter(t => t.id !== taskId));
      setRecurringTasks(prev => [...prev, template]);
    } else if (newTask.keepUnscheduled && newTask.projectId) {
      // Keep/make this an unscheduled project task
      const inScheduled = tasks.find(t => t.id === taskId);
      if (inScheduled) {
        // Move from scheduled → unscheduled project task.
        // Clear schedule fields and drop lastModified so stampTaskTimestamps
        // re-stamps it as "just changed", preventing cloud sync from reverting
        // the move when the remote still has the task in the scheduled list.
        const { date: _d, startTime: _s, isAllDay: _a, lastModified: _m, ...rest } = inScheduled;
        setTasks(prev => prev.filter(t => t.id !== taskId));
        setUnscheduledTasks(prev => [...prev, {
          ...rest,
          title: cleanTitle(newTask.title),
          duration: newTask.duration,
          color: newTask.color || colors[0].class,
          projectId: newTask.projectId,
        }]);
      } else {
        // Already unscheduled, just update
        setUnscheduledTasks(prev => prev.map(t => t.id === taskId ? {
          ...t,
          title: cleanTitle(newTask.title),
          duration: newTask.duration,
          color: newTask.color || colors[0].class,
          projectId: newTask.projectId,
        } : t));
      }
    } else {
      const inScheduled = tasks.find(t => t.id === taskId);
      if (inScheduled) {
        setTasks(prev => prev.map(t => t.id === taskId ? {
          ...t,
          title: cleanTitle(newTask.title),
          startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
          duration: newTask.duration,
          date: newTask.date || t.date,
          isAllDay: newTask.isAllDay || false,
          color: newTask.color || colors[0].class,
          projectId: newTask.projectId || undefined,
        } : t));
      } else {
        // Task was unscheduled (e.g. a project task) — move it to the scheduled list
        const existing = unscheduledTasks.find(t => t.id === taskId);
        setUnscheduledTasks(prev => prev.filter(t => t.id !== taskId));
        setTasks(prev => [...prev, {
          ...(existing || {}),
          id: taskId,
          title: cleanTitle(newTask.title),
          startTime: newTask.isAllDay ? '00:00' : newTask.startTime,
          duration: newTask.duration,
          date: newTask.date || dateToString(selectedDate),
          isAllDay: newTask.isAllDay || false,
          color: newTask.color || colors[0].class,
          projectId: newTask.projectId || undefined,
        }]);
      }
    }
    setShowAddTask(false);
    setMobileEditingTask(null);
    setMobileEditIsInbox(false);
  };

  // --- Routines handlers ---
  const getDayName = (date) => {
    return ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
  };

  // --- Focus Mode handlers ---


  // ── Native Calendar Events (Android only) ────────────────────────────────
  // Fetches events from the device calendar for a ±2-day window around the
  // selected date and merges them into `tasks` as _native-flagged entries.
  // _native tasks are excluded from saveData so they're never persisted.

  const nativeEventToTask = (event) => {
    const isAllDay = event.allDay;
    const startStr = event.start; // "YYYY-MM-DDThh:mm:ss" or "YYYY-MM-DD"
    const endStr   = event.end;

    // Android formats all-day event timestamps (stored as UTC midnight) as local time
    // strings without a timezone suffix. In UTC- timezones this shifts the date one day
    // back (e.g. UTC midnight March 15 → local "2026-03-14T19:00:00"). Parse via Date
    // so JS treats the string as local time, then read the UTC date from toISOString()
    // to recover the correct calendar date regardless of device timezone.
    const allDayDateStr = (str) => {
      if (!str || str.length === 10) return str; // already "YYYY-MM-DD"
      return new Date(str).toISOString().substring(0, 10);
    };

    const startDate = isAllDay ? allDayDateStr(startStr) : startStr.substring(0, 10);
    // CalendarRepository already subtracts 1 day from Android's exclusive dtend before
    // sending, so the end arrives as the inclusive last day in "YYYY-MM-DD" format.
    const endDate = endStr ? endStr.substring(0, 10) : startDate;
    const isMultiDay = isAllDay && endDate > startDate;
    // For multi-day all-day events use the queried date so each day they span appears
    // correctly. Clamp _queryDate to [startDate, endDate]: Android can return an event
    // one day early/late due to UTC-offset arithmetic, so out-of-range query dates are
    // snapped to the nearest valid boundary instead of displaying the event off by a day.
    let date;
    if (isMultiDay && event._queryDate) {
      const qd = event._queryDate;
      date = qd < startDate ? startDate : qd > endDate ? endDate : qd;
    } else {
      date = startDate;
    }
    const startTime = isAllDay ? null : startStr.substring(11, 16); // "HH:MM"
    let duration = 60;
    if (!isAllDay && endStr && endStr.length >= 16) {
      const endTime = endStr.substring(11, 16);
      duration = Math.max(15, timeToMinutes(endTime) - timeToMinutes(startTime));
    }
    return {
      // Multi-day all-day events get a per-day ID so each day's copy survives dedup
      id:                   isMultiDay ? `native-cal-${event.id}-${date}` : `native-cal-${event.id}`,
      nativeEventId:        event.id,
      nativeCalendarColor:  event.color || '',
      title:                event.title || '',
      date,
      startTime:            startTime || null,
      duration,
      isAllDay,
      imported:             true,
      isTaskCalendar:       String(event.id).startsWith('task-'),
      notes:                event.notes || '',
      location:             event.location || '',
      calendarName:         event.calendarName || '',
      completed:            false,
      _native:              true,
    };
  };

  // Fetch available device calendars once on load (Android only)
  useEffect(() => {
    if (!isNativeAndroid()) return;
    const cals = nativeGetCalendars();
    if (cals.length > 0) setAvailableCalendars(cals);
  }, []);


  useEffect(() => {
    if (!isNativeAndroid()) return;

    const dates = [];
    for (let offset = -2; offset <= 2; offset++) {
      const d = new Date(selectedDate);
      d.setDate(d.getDate() + offset);
      dates.push(dateToString(d));
    }

    Promise.all(dates.map(d => nativeGetEvents(d))).then(results => {
      // Tag each event with the date it was queried for so multi-day all-day events
      // can be shown on every day they span, not just their start date.
      const allEvents = results.flatMap((result, i) =>
        Array.isArray(result) ? result.map(e => ({ ...e, _queryDate: dates[i] })) : []
      );

      // Discover calendars that appear in events but weren't returned by getCalendars()
      // (e.g. task-only calendars that some providers omit from the calendars list).
      setAvailableCalendars(prev => {
        const knownIds = new Set(prev.map(c => c.id));
        const newCals = [];
        allEvents.forEach(e => {
          if (e.calendarId && !knownIds.has(e.calendarId)) {
            knownIds.add(e.calendarId);
            newCals.push({ id: e.calendarId, name: e.calendarName || 'Unknown Calendar', accountName: '', color: e.color || '#6b7280' });
          }
        });
        if (newCals.length === 0) return prev;
        // Extend any active calendarFilter so newly discovered calendars show as checked.
        setCalendarFilter(f => {
          if (f.length === 0) return f;
          const toAdd = newCals.map(c => c.id).filter(id => !f.includes(id));
          return toAdd.length > 0 ? [...f, ...toAdd] : f;
        });
        return [...prev, ...newCals];
      });

      const filterSet = calendarFilter.length > 0 ? new Set(calendarFilter) : null;

      // Deduplicate by task id: CalendarContract can return the same all-day event
      // in adjacent day windows (especially in UTC+ timezones). Keep first occurrence.
      const seen = new Set();
      const fetched = allEvents
        .filter(e => !filterSet || filterSet.has(e.calendarId))
        .map(e => nativeEventToTask(e))
        .filter(t => {
          if (seen.has(t.id)) return false;
          seen.add(t.id);
          return true;
        });

      // Apply any stored time overrides (from dragging all-day events to the timeline)
      // so the scheduled position survives date navigation and native calendar re-fetches.
      const overrides = JSON.parse(localStorage.getItem('day-planner-native-time-overrides') || '{}');
      const fetchedWithOverrides = fetched.map(t => {
        const override = t.nativeEventId && overrides[String(t.nativeEventId)];
        if (!override) return t;
        return {
          ...t,
          ...(override.date !== undefined ? { date: override.date } : {}),
          ...(override.startTime !== undefined ? { startTime: override.startTime, isAllDay: false } : {}),
          ...(override.duration !== undefined ? { duration: override.duration } : {}),
          ...(override.title !== undefined ? { title: override.title } : {}),
          ...(override.notes !== undefined ? { notes: override.notes } : {}),
          ...(override.color !== undefined ? { color: override.color } : {}),
        };
      });

      setTasks(prev => [
        ...prev.filter(t => !t._native),
        ...fetchedWithOverrides,
      ]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, calendarFilter, nativeCalendarKey]);

  const enterFocusMode = () => {
    setShowFocusMode(true);
    setFocusShowSettings(true);
    setFocusShowStats(false);
    setFocusPhase('work');
    setFocusTimerSeconds(0);
    setFocusCycleCount(0);
    setFocusSessionStart(null);
    setFocusCompletedTasks(new Set());
    setFocusTimerRunning(false);
    setFocusTaskMinutes({});
    setFocusBlockTasks(computeFocusBlockTasks());
    setFocusWorkMinutes(25);
    setFocusBreakMinutes(5);
    setFocusLongBreakMinutes(15);
    // Request fullscreen (web fallback; Android uses native immersive mode below)
    try { document.documentElement.requestFullscreen?.(); } catch (e) {}
    // Request wake lock
    (async () => {
      try {
        if (navigator.wakeLock) {
          wakeLockSentinel.current = await navigator.wakeLock.request('screen');
        }
      } catch (e) {}
    })();
    // Android: immersive mode + pause notifications + DND
    nativeEnterFocusMode();
  };
  enterFocusModeRef.current = enterFocusMode;
  openRoutinesDashboardRef.current = openRoutinesDashboard;

  const startFocusTimer = () => {
    setFocusShowSettings(false);
    setFocusSessionStart(new Date());
    setFocusPhase('work');
    setFocusTimerSeconds(focusWorkMinutes * 60);
    setFocusTimerRunning(true);
    playFocusSound('work');
    if (!onboardingProgress.hasUsedFocusMode) {
      setOnboardingProgress(prev => ({ ...prev, hasUsedFocusMode: true }));
    }
  };

  const exitFocusMode = (showStats = true) => {
    setFocusTimerRunning(false);
    if (focusTimerRef.current) {
      clearInterval(focusTimerRef.current);
      focusTimerRef.current = null;
    }
    // Distribute partial work time for current in-progress work cycle
    const minutesCopy = { ...focusTaskMinutes };
    if (focusPhase === 'work' && focusTimerSeconds < focusWorkMinutes * 60) {
      const elapsedMinutes = (focusWorkMinutes * 60 - focusTimerSeconds) / 60;
      const activeTasks = focusBlockTasks.filter(t => !t.completed && !focusCompletedTasks.has(t.id));
      if (activeTasks.length > 0) {
        const perTask = elapsedMinutes / activeTasks.length;
        activeTasks.forEach(t => {
          minutesCopy[t.id] = (minutesCopy[t.id] || 0) + perTask;
        });
      }
    }
    if (Object.keys(minutesCopy).length > 0) {
      setTasks(prev => prev.map(t => {
        if (minutesCopy[t.id]) {
          return { ...t, focusMinutes: (t.focusMinutes || 0) + minutesCopy[t.id] };
        }
        return t;
      }));
    }
    // Record session in daily focus log
    if (focusSessionStart) {
      const sessionMinutes = Math.round((new Date() - focusSessionStart) / 60000);
      if (sessionMinutes > 0) {
        const sessionDateStr = dateToString(new Date(focusSessionStart));
        setFocusLog(prev => {
          const existing = prev[sessionDateStr] || { totalMinutes: 0, sessions: 0, cyclesCompleted: 0, tasksCompleted: 0 };
          const updated = {
            ...existing,
            totalMinutes: existing.totalMinutes + sessionMinutes,
            sessions: existing.sessions + 1,
            cyclesCompleted: existing.cyclesCompleted + focusCycleCount,
            tasksCompleted: existing.tasksCompleted + focusCompletedTasks.size,
          };
          return { ...prev, [sessionDateStr]: updated };
        });
      }
    }
    if (showStats) {
      setFocusShowStats(true);
    } else {
      // Exit fullscreen and release wake lock only when closing entirely
      try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch (e) {}
      try { wakeLockSentinel.current?.release(); wakeLockSentinel.current = null; } catch (e) {}
      // Android: restore system bars + DND + reschedule notifications
      nativeExitFocusMode();
      setShowFocusMode(false);
    }
  };
  exitFocusModeRef.current = exitFocusMode;

  const dismissFocusStats = () => {
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch (e) {}
    try { wakeLockSentinel.current?.release(); wakeLockSentinel.current = null; } catch (e) {}
    // Android: restore system bars + DND + reschedule notifications
    nativeExitFocusMode();
    setFocusShowStats(false);
    setShowFocusMode(false);
  };

  const skipFocusPhase = () => {
    if (focusPhase === 'work') {
      const newCycle = focusCycleCount + 1;
      setFocusCycleCount(newCycle);
      if (newCycle % 4 === 0) {
        setFocusPhase('longBreak');
        setFocusTimerSeconds(focusLongBreakMinutes * 60);
      } else {
        setFocusPhase('shortBreak');
        setFocusTimerSeconds(focusBreakMinutes * 60);
      }
    } else {
      setFocusPhase('work');
      setFocusTimerSeconds(focusWorkMinutes * 60);
    }
  };

  const handleFocusTimerEnd = () => {
    if (focusPhase === 'work') {
      // Distribute work minutes across active (non-completed) block tasks
      const activeTasks = focusBlockTasks.filter(t => !t.completed && !focusCompletedTasks.has(t.id));
      if (activeTasks.length > 0) {
        const perTask = focusWorkMinutes / activeTasks.length;
        setFocusTaskMinutes(prev => {
          const next = { ...prev };
          activeTasks.forEach(t => {
            next[t.id] = (next[t.id] || 0) + perTask;
          });
          return next;
        });
      }
      const newCycle = focusCycleCount + 1;
      setFocusCycleCount(newCycle);
      if (newCycle % 4 === 0) {
        setFocusPhase('longBreak');
        setFocusTimerSeconds(focusLongBreakMinutes * 60);
        playFocusSound('break');
      } else {
        setFocusPhase('shortBreak');
        setFocusTimerSeconds(focusBreakMinutes * 60);
        playFocusSound('break');
      }
    } else {
      // Break ended → start work
      setFocusPhase('work');
      setFocusTimerSeconds(focusWorkMinutes * 60);
      playFocusSound('work');
    }
    setFocusTimerRunning(true);
  };
  handleFocusTimerEndRef.current = handleFocusTimerEnd;

  // ── HyperGLANCE functions ──────────────────────────────────────────────────
  const instantiateHGTemplateTasks = (project, sessionDate) => {
    const templates = project.hyperglance?.templateTasks || [];
    if (templates.length === 0) return;
    // Avoid duplicate instantiation for the same session date
    const alreadyInstantiated = unscheduledTasks.some(
      t => t.projectId === project.id && t.hyperglanceSessionDate === sessionDate
    );
    if (alreadyInstantiated) return;
    const parentGoal = project.goalId ? goals.find(g => g.id === project.goalId) : null;
    const taskColor = parentGoal?.color || 'bg-blue-500';
    const newTasks = templates.map(tmpl => ({
      id: `hg-${project.id}-${sessionDate}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: tmpl.name,
      ...(tmpl.notes ? { notes: tmpl.notes } : {}),
      color: taskColor,
      projectId: project.id,
      hyperglanceSessionDate: sessionDate,
      completed: false,
      createdAt: new Date().toISOString(),
    }));
    setUnscheduledTasks(prev => [...prev, ...newTasks]);
  };

  const enterHyperGlanceMode = (projectId, date) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    instantiateHGTemplateTasks(project, date);
    setHyperGlanceProjectId(projectId);
    setHyperGlanceSessionDate(date);
    setHgTimerSeconds(0);
    setHgTimerRunning(false);
    setHgTimerPhase('work');
    setHgCycleCount(0);
    setHgExitConfirm(false);
    setHgShowSettings(true);
    setShowHyperGlanceMode(true);
    // Request fullscreen (web fallback; Android uses native immersive mode below)
    try { document.documentElement.requestFullscreen?.(); } catch (e) {}
    // Request wake lock
    (async () => {
      try {
        if (navigator.wakeLock) {
          wakeLockSentinel.current = await navigator.wakeLock.request('screen');
        }
      } catch (e) {}
    })();
    // Android: immersive mode + pause notifications + DND (same as Focus Mode)
    nativeEnterFocusMode();
  };

  const exitHyperGlanceMode = () => {
    // Pause: close the modal but leave the session open (bar stays on timeline)
    setHgTimerRunning(false);
    setHgExitConfirm(false);
    setShowHyperGlanceMode(false);
    // Exit fullscreen and release wake lock
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch (e) {}
    try { wakeLockSentinel.current?.release(); wakeLockSentinel.current = null; } catch (e) {}
    // Android: restore system bars + DND + reschedule notifications
    nativeExitFocusMode();
  };

  const completeHyperGlanceSession = (stats = {}) => {
    if (!hyperGlanceProjectId || !hyperGlanceSessionDate) return;
    const project = projects.find(p => p.id === hyperGlanceProjectId);
    if (!project) return;
    const hg = project.hyperglance || {};
    const completions = hg.completions || [];
    if (completions.some(c => c.date === hyperGlanceSessionDate)) return;
    // Use updateProject so updatedAt is bumped — cloud sync uses updatedAt for
    // conflict resolution, so a raw setProjects would let stale remote copies win.
    updateProject(hyperGlanceProjectId, {
      hyperglance: {
        ...hg,
        completions: [
          ...completions,
          { date: hyperGlanceSessionDate, completedAt: new Date().toISOString(), ...stats },
        ],
      },
    });
    setHgTimerRunning(false);
    setHgExitConfirm(false);
    // Don't close the modal here — the modal handles showing the summary screen
    // and the user dismisses it via the "Done" button (exitHyperGlanceMode).
  };

  const openHGAdjust = (projectId, date) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const hg = project.hyperglance || {};
    setHgAdjustModal({
      projectId,
      date,
      time: (hg.scheduledTimeOverrides || {})[date] || hg.scheduledTime || '9:00',
      duration: (hg.scheduledDurationOverrides || {})[date] || hg.scheduledDuration || 60,
    });
    setHgContextMenu(null);
  };

  const saveHGAdjust = () => {
    if (!hgAdjustModal) return;
    const { projectId, date, time, duration } = hgAdjustModal;
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const hg = project.hyperglance || {};
    updateProject(projectId, {
      hyperglance: {
        ...hg,
        scheduledTimeOverrides: { ...(hg.scheduledTimeOverrides || {}), [date]: time },
        scheduledDurationOverrides: { ...(hg.scheduledDurationOverrides || {}), [date]: duration },
      },
    });
    setHgAdjustModal(null);
  };

  const cancelHGSession = (projectId, date) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    const hg = project.hyperglance || {};
    if (!hg.isRecurring) {
      updateProject(projectId, { hyperglance: { ...hg, enabled: false } });
    } else {
      const skipped = hg.skippedDates || [];
      if (!skipped.includes(date)) {
        updateProject(projectId, { hyperglance: { ...hg, skippedDates: [...skipped, date] } });
      }
    }
    setHgContextMenu(null);
  };

  const saveEditProjectFromBar = (fields) => {
    if (!pendingEditProjectId) return;
    const projectId = pendingEditProjectId;
    const project = projects.find(p => p.id === projectId);
    if (project) {
      const wasArchived = project.status === 'archived';
      const nowArchived = fields.status === 'archived';
      if (nowArchived && !wasArchived) {
        const cascadeTask = t => {
          if (t.projectId !== projectId) return t;
          if (t.completed) return { ...t, archived: true };
          const { projectId: _removed, ...rest } = t;
          return rest;
        };
        setTasks(prev => prev.map(cascadeTask));
        setUnscheduledTasks(prev => prev.map(cascadeTask));
      }
      updateProject(projectId, fields);
    }
    setPendingEditProjectId(null);
  };

  const parseICS = (icsContent) => {
    // Unfold iCal line continuations (RFC 5545: lines starting with space/tab are continuations)
    const rawLines = icsContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const lines = [];
    for (const raw of rawLines) {
      if ((raw.startsWith(' ') || raw.startsWith('\t')) && lines.length > 0) {
        lines[lines.length - 1] += raw.substring(1);
      } else {
        lines.push(raw.trim());
      }
    }
    const events = [];
    let currentEvent = null;
    let currentType = null; // 'event' or 'todo'

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line === 'BEGIN:VEVENT') {
        currentEvent = {};
        currentType = 'event';
      } else if (line === 'BEGIN:VTODO') {
        currentEvent = {};
        currentType = 'todo';
      } else if ((line === 'END:VEVENT' || line === 'END:VTODO') && currentEvent) {
        // For VTODOs, use DUE as dtstart if no DTSTART present
        if (currentType === 'todo' && !currentEvent.dtstart && currentEvent.due) {
          currentEvent.dtstart = currentEvent.due;
          currentEvent.isAllDay = currentEvent.dueIsAllDay;
        }
        // Skip RECURRENCE-ID overrides — these are individual-instance exceptions
        // (e.g. a single completed occurrence of a recurring VTODO). The master RRULE
        // expansion already generates dates for each occurrence, and completion state
        // is tracked locally via completedTaskUids.
        if (currentEvent.summary && currentEvent.dtstart && !currentEvent.isRecurrenceOverride) {
          events.push(currentEvent);
        }
        currentEvent = null;
        currentType = null;
      } else if (currentEvent) {
        if (line.startsWith('SUMMARY')) {
          // Extract value after colon, handling parameters like SUMMARY;LANGUAGE=en:Text
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            // Unescape ICS escape sequences: \, -> , and \; -> ; and \\ -> \ and \n -> newline
            currentEvent.summary = line.substring(colonIdx + 1)
              .replace(/\\,/g, ',')
              .replace(/\\;/g, ';')
              .replace(/\\n/gi, '\n')
              .replace(/\\\\/g, '\\');
          }
        } else if (line.startsWith('DTSTART')) {
          // Detect all-day events (VALUE=DATE or 8-character date)
          if (line.includes('VALUE=DATE') || line.split(':')[1]?.length === 8) {
            currentEvent.isAllDay = true;
          }
          const dateStr = line.split(':')[1];
          currentEvent.dtstart = dateStr;
        } else if (line.startsWith('DTEND')) {
          const dateStr = line.split(':')[1];
          currentEvent.dtend = dateStr;
        } else if (line.startsWith('DUE')) {
          // Handle VTODO due dates
          if (line.includes('VALUE=DATE') || line.split(':')[1]?.length === 8) {
            currentEvent.dueIsAllDay = true;
          }
          const dateStr = line.split(':')[1];
          currentEvent.due = dateStr;
        } else if (line.startsWith('UID')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            currentEvent.uid = line.substring(colonIdx + 1);
          }
        } else if (line.startsWith('DESCRIPTION')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            currentEvent.description = line.substring(colonIdx + 1)
              .replace(/\\,/g, ',')
              .replace(/\\;/g, ';')
              .replace(/\\n/gi, '\n')
              .replace(/\\\\/g, '\\');
          }
        } else if (line.startsWith('RECURRENCE-ID')) {
          currentEvent.isRecurrenceOverride = true;
        } else if (line.startsWith('RRULE:')) {
          currentEvent.rrule = line.substring(6);
        } else if (line.startsWith('EXDATE')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            if (!currentEvent.exdates) currentEvent.exdates = [];
            const values = line.substring(colonIdx + 1).split(',');
            values.forEach(v => currentEvent.exdates.push(v.trim().substring(0, 8)));
          }
        }
      }
    }

    // Expand events with RRULE into individual occurrences
    const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    const fmt = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const curYear = new Date().getFullYear();
    const expandedEvents = [];

    for (const event of events) {
      if (!event.rrule) {
        expandedEvents.push(event);
        continue;
      }

      const rule = {};
      event.rrule.split(';').forEach(part => {
        const eq = part.indexOf('=');
        if (eq !== -1) rule[part.substring(0, eq).trim().toUpperCase()] = part.substring(eq + 1).trim().toUpperCase();
      });

      // Common setup for all frequencies
      const dtstr = event.dtstart;
      const sYear = parseInt(dtstr.substring(0, 4));
      const sMonth = parseInt(dtstr.substring(4, 6)) - 1;
      const sDay = parseInt(dtstr.substring(6, 8));
      const interval = parseInt(rule.INTERVAL || '1');
      const count = rule.COUNT ? parseInt(rule.COUNT) : null;
      const untilDate = rule.UNTIL ? new Date(
        parseInt(rule.UNTIL.substring(0, 4)),
        parseInt(rule.UNTIL.substring(4, 6)) - 1,
        parseInt(rule.UNTIL.substring(6, 8))
      ) : null;

      // Duration in days for all-day events
      let durDays = 1;
      if (event.dtend && event.isAllDay) {
        const s = new Date(sYear, sMonth, sDay);
        const e = new Date(parseInt(event.dtend.substring(0, 4)), parseInt(event.dtend.substring(4, 6)) - 1, parseInt(event.dtend.substring(6, 8)));
        durDays = Math.max(1, Math.round((e - s) / 86400000));
      }

      const eventStart = new Date(sYear, sMonth, sDay);
      const now = new Date();
      // Expansion window for non-yearly: 1 year back to 1 year ahead
      const windowStart = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      const windowEnd = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());

      const isExcluded = (d) => {
        const s = fmt(d);
        return event.exdates && event.exdates.includes(s);
      };

      const pushOcc = (occDate) => {
        const occStr = fmt(occDate);
        const newDtstart = event.isAllDay ? occStr : occStr + 'T' + dtstr.substring(9);
        let newDtend = event.dtend;
        if (event.dtend && event.isAllDay) {
          const endD = new Date(occDate);
          endD.setDate(endD.getDate() + durDays);
          newDtend = fmt(endD);
        }
        expandedEvents.push({ ...event, dtstart: newDtstart, dtend: newDtend, rrule: undefined, isRecurringSeries: true });
      };

      if (rule.FREQ === 'YEARLY') {
        const byMonth = rule.BYMONTH ? parseInt(rule.BYMONTH) - 1 : sMonth;
        const byDay = rule.BYDAY || null;
        const maxYear = untilDate ? Math.min(untilDate.getFullYear(), curYear + 3) : curYear + 3;
        let occ = 0;

        for (let year = sYear; year <= maxYear; year += interval) {
          if (count && occ >= count) break;

          let occDate;
          if (byDay) {
            const m = byDay.match(/^(-?\d*)([A-Z]{2})$/);
            if (m && dayMap[m[2]] !== undefined) {
              const nth = m[1] ? parseInt(m[1]) : 1;
              const target = dayMap[m[2]];
              if (nth > 0) {
                const firstDow = new Date(year, byMonth, 1).getDay();
                occDate = new Date(year, byMonth, 1 + ((target - firstDow + 7) % 7) + (nth - 1) * 7);
              } else {
                const last = new Date(year, byMonth + 1, 0);
                occDate = new Date(year, byMonth, last.getDate() - ((last.getDay() - target + 7) % 7) + (nth + 1) * 7);
              }
            }
          } else {
            occDate = new Date(year, byMonth, sDay);
          }

          if (!occDate) continue;
          if (untilDate && occDate > untilDate) break;
          if (isExcluded(occDate)) continue;

          pushOcc(occDate);
          occ++;
        }
      } else if (rule.FREQ === 'MONTHLY') {
        const byDay = rule.BYDAY || null;
        const byMonthDay = rule.BYMONTHDAY ? parseInt(rule.BYMONTHDAY) : null;
        let occ = 0;
        let mDate = new Date(sYear, sMonth, 1);

        while (mDate <= windowEnd) {
          if (count && occ >= count) break;
          let occDate;

          if (byDay) {
            const m = byDay.match(/^(-?\d*)([A-Z]{2})$/);
            if (m && dayMap[m[2]] !== undefined) {
              const nth = m[1] ? parseInt(m[1]) : 1;
              const target = dayMap[m[2]];
              if (nth > 0) {
                const firstDow = new Date(mDate.getFullYear(), mDate.getMonth(), 1).getDay();
                occDate = new Date(mDate.getFullYear(), mDate.getMonth(), 1 + ((target - firstDow + 7) % 7) + (nth - 1) * 7);
              } else {
                const last = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0);
                occDate = new Date(mDate.getFullYear(), mDate.getMonth(), last.getDate() - ((last.getDay() - target + 7) % 7) + (nth + 1) * 7);
              }
            }
          } else {
            const day = byMonthDay || sDay;
            occDate = new Date(mDate.getFullYear(), mDate.getMonth(), day);
            // Handle months with fewer days (e.g., Jan 31 in Feb -> Feb 28)
            if (occDate.getMonth() !== mDate.getMonth()) {
              occDate = new Date(mDate.getFullYear(), mDate.getMonth() + 1, 0);
            }
          }

          if (occDate && occDate >= eventStart) {
            if (untilDate && occDate > untilDate) break;
            if (!isExcluded(occDate)) {
              if (occDate >= windowStart) pushOcc(occDate);
              occ++;
            }
          }
          mDate.setMonth(mDate.getMonth() + interval);
        }
      } else if (rule.FREQ === 'WEEKLY') {
        const byDays = rule.BYDAY
          ? rule.BYDAY.split(',').map(d => dayMap[d.trim()]).filter(d => d !== undefined)
          : [eventStart.getDay()];
        let occ = 0;
        // Start from the Sunday of the week containing eventStart
        let weekStart = new Date(eventStart);
        weekStart.setDate(weekStart.getDate() - weekStart.getDay());

        while (weekStart <= windowEnd) {
          for (const targetDay of byDays) {
            if (count && occ >= count) break;
            const d = new Date(weekStart);
            d.setDate(d.getDate() + targetDay);
            if (d < eventStart) continue;
            if (d > windowEnd) continue;
            if (untilDate && d > untilDate) break;
            if (!isExcluded(d)) {
              if (d >= windowStart) pushOcc(d);
              occ++;
            }
          }
          if (count && occ >= count) break;
          weekStart.setDate(weekStart.getDate() + 7 * interval);
        }
      } else if (rule.FREQ === 'DAILY') {
        let occ = 0;
        let d = new Date(eventStart);
        // Skip ahead efficiently when no COUNT limit
        if (!count && d < windowStart) {
          const intervalsToSkip = Math.floor((windowStart - d) / (86400000 * interval));
          d.setDate(d.getDate() + intervalsToSkip * interval);
        }
        while (d <= windowEnd) {
          if (count && occ >= count) break;
          if (untilDate && d > untilDate) break;
          if (d >= eventStart && !isExcluded(d)) {
            if (d >= windowStart) pushOcc(d);
            occ++;
          }
          d.setDate(d.getDate() + interval);
        }
      } else {
        // Unsupported frequency — keep the original event
        expandedEvents.push(event);
      }
    }

    return expandedEvents;
  };

  const parseDatetime = (dtstr) => {
    if (dtstr.length === 8) {
      return new Date(
        parseInt(dtstr.substr(0, 4)),
        parseInt(dtstr.substr(4, 2)) - 1,
        parseInt(dtstr.substr(6, 2))
      );
    } else if (dtstr.length >= 15) {
      return new Date(
        parseInt(dtstr.substr(0, 4)),
        parseInt(dtstr.substr(4, 2)) - 1,
        parseInt(dtstr.substr(6, 2)),
        parseInt(dtstr.substr(9, 2)),
        parseInt(dtstr.substr(11, 2))
      );
    }
    return new Date();
  };

  // Filter imported tasks to a date window: keep events from (today - retentionDays) onward.
  // retentionDays=0 means keep all events (no filtering).
  const filterByDateWindow = (importedTasks, retentionDays) => {
    if (!retentionDays || retentionDays <= 0) return importedTasks;
    const today = new Date();
    const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate() - retentionDays);
    const cutoffStr = dateToString(cutoff);
    return importedTasks.filter(t => t.date >= cutoffStr);
  };

  // Helper to expand multi-day events into separate tasks for each day
  const expandMultiDayEvent = (event, options = {}) => {
    const { asTaskCalendar = false, freshCompletedUids = new Set(), color: customColor, importSource = 'sync' } = options;
    const startDate = parseDatetime(event.dtstart);
    const endDate = event.dtend ? parseDatetime(event.dtend) : new Date(startDate.getTime() + 60 * 60 * 1000);
    const duration = Math.round((endDate - startDate) / (1000 * 60));

    const isAllDay = event.isAllDay ||
      (startDate.getHours() === 0 && startDate.getMinutes() === 0 && duration >= 1440);

    // Calculate number of days this event spans
    const startDateOnly = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endDateOnly = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    // For all-day events, DTEND is exclusive (event on Jan 1-3 has DTEND of Jan 4)
    const dayCount = isAllDay
      ? Math.max(1, Math.round((endDateOnly - startDateOnly) / (1000 * 60 * 60 * 24)))
      : 1;

    const tasks = [];
    for (let i = 0; i < dayCount; i++) {
      const taskDate = new Date(startDateOnly);
      taskDate.setDate(taskDate.getDate() + i);

      const baseId = event.uid || `imported-${Date.now()}-${Math.random()}`;
      const dateStr = dateToString(taskDate);
      const taskId = dayCount > 1 ? `${baseId}-${dateStr}-day${i + 1}` : `${baseId}-${dateStr}`;

      // Add day indicator for multi-day events
      const titleSuffix = dayCount > 1 ? ` (Day ${i + 1}/${dayCount})` : '';

      tasks.push({
        id: taskId,
        icalUid: event.uid,
        title: event.summary + titleSuffix,
        startTime: `${startDate.getHours().toString().padStart(2, '0')}:${startDate.getMinutes().toString().padStart(2, '0')}`,
        duration: isAllDay ? 60 : (asTaskCalendar ? 15 : (duration > 0 ? duration : 60)),
        date: dateToString(taskDate),
        color: asTaskCalendar ? 'task-calendar' : (customColor || 'bg-gray-600'),
        completed: asTaskCalendar ? freshCompletedUids.has(event.uid + '::' + dateToString(taskDate)) : false,
        imported: true,
        isTaskCalendar: asTaskCalendar,
        isAllDay: isAllDay,
        isRecurringSeries: !!event.isRecurringSeries,
        importSource: importSource,
        ...(event.description ? { notes: event.description } : {})
      });
    }

    return tasks;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setPendingImportFile(file);
    setImportColor('bg-gray-600');
    setShowImportModal(true);
    e.target.value = '';
  };

  const processImportFile = (asTaskCalendar) => {
    if (!pendingImportFile) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const icsContent = event.target.result;
      const events = parseICS(icsContent);

      // Read fresh completedTaskUids from localStorage to avoid stale closure
      const freshCompletedUids = new Set(
        JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]')
      );

      const allImported = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar, freshCompletedUids, color: importColor, importSource: 'file' })
      );
      const importedTasks = filterByDateWindow(allImported, syncRetentionDays);

      if (asTaskCalendar) {
        const kept = tasks.filter(t => !(t.isTaskCalendar && t.importSource === 'file'));
        setTasks([...kept, ...importedTasks]);
      } else {
        const kept = tasks.filter(t => !(t.imported && !t.isTaskCalendar && t.importSource === 'file'));
        setTasks([...kept, ...importedTasks]);
      }

      setPendingImportFile(null);
      setShowImportModal(false);

      const count = importedTasks.length;
      setSyncNotification({
        type: count > 0 ? 'success' : 'info',
        title: 'iCal Import',
        message: count > 0
          ? `Imported ${count} event${count !== 1 ? 's' : ''}`
          : 'No events found in the file'
      });
    };
    reader.readAsText(pendingImportFile);
  };

  // Export all app data as a JSON backup file
  const exportBackup = () => {
    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        tasks: JSON.parse(localStorage.getItem('day-planner-tasks') || '[]'),
        unscheduledTasks: JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'),
        recycleBin: JSON.parse(localStorage.getItem('day-planner-recycle-bin') || '[]'),
        darkMode: JSON.parse(localStorage.getItem('day-planner-darkmode') || 'false'),
        syncUrl: localStorage.getItem('day-planner-sync-url') || '',
        taskCalendarUrl: localStorage.getItem('day-planner-task-calendar-url') || '',
        taskCalendarAuth: JSON.parse(localStorage.getItem('day-planner-task-calendar-auth') || 'null'),
        completedTaskUids: JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]'),
        recurringTasks: JSON.parse(localStorage.getItem('day-planner-recurring-tasks') || '[]'),
        routineDefinitions: JSON.parse(localStorage.getItem('day-planner-routine-definitions') || '{}'),
        selectedTags: JSON.parse(localStorage.getItem('day-planner-selected-tags') || '[]'),
        minimizedSections: JSON.parse(localStorage.getItem('minimizedSections') || '{}'),
        cloudSyncConfig: JSON.parse(localStorage.getItem('day-planner-cloud-sync-config') || 'null'),
        reminderSettings: JSON.parse(localStorage.getItem('day-planner-reminder-settings') || 'null'),
        use24HourClock: JSON.parse(localStorage.getItem('day-planner-use-24h-clock') || 'false'),
        weatherZip: localStorage.getItem('day-planner-weather-zip') || '',
        weatherTempUnit: localStorage.getItem('day-planner-weather-temp-unit') || 'fahrenheit',
        habits: JSON.parse(localStorage.getItem('day-planner-habits') || '[]'),
        habitLogs: JSON.parse(localStorage.getItem('day-planner-habit-logs') || '{}'),
        habitsEnabled: JSON.parse(localStorage.getItem('day-planner-habits-enabled') || 'true'),
        routinesEnabled: JSON.parse(localStorage.getItem('day-planner-routines-enabled') || 'true'),
        aiConfig: JSON.parse(localStorage.getItem('day-planner-ai-config') || 'null'),
        calendarFilter: JSON.parse(localStorage.getItem('day-planner-calendar-filter') || '[]'),
        goals: JSON.parse(localStorage.getItem('day-planner-goals') || '[]'),
        projects: JSON.parse(localStorage.getItem('day-planner-projects') || '[]'),
        goalsProjectsEnabled: JSON.parse(localStorage.getItem('day-planner-goals-projects-enabled') || 'false'),
      }
    };

    const filename = `dayglance-backup-${dateToString(new Date())}.json`;
    const jsonStr = JSON.stringify(backup, null, 2);

    // On Android the <a download> trick is silently ignored inside a WebView.
    // Use the native share sheet instead so the user can save to Files / Drive.
    if (isNativeAndroid()) {
      nativeShareFile(filename, jsonStr);
      return;
    }

    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Auto-backup: build payload (reuses buildSyncPayload data format)
  const buildAutoBackupPayload = () => ({
    type: 'auto-backup',
    version: 1,
    timestamp: new Date().toISOString(),
    data: {
      tasks: JSON.parse(localStorage.getItem('day-planner-tasks') || '[]'),
      unscheduledTasks: JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]'),
      recycleBin: JSON.parse(localStorage.getItem('day-planner-recycle-bin') || '[]'),
      darkMode: JSON.parse(localStorage.getItem('day-planner-darkmode') || 'false'),
      syncUrl: localStorage.getItem('day-planner-sync-url') || '',
      taskCalendarUrl: localStorage.getItem('day-planner-task-calendar-url') || '',
      taskCalendarAuth: JSON.parse(localStorage.getItem('day-planner-task-calendar-auth') || 'null'),
      completedTaskUids: JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]'),
      recurringTasks: JSON.parse(localStorage.getItem('day-planner-recurring-tasks') || '[]'),
      routineDefinitions: JSON.parse(localStorage.getItem('day-planner-routine-definitions') || '{}'),
      minimizedSections: JSON.parse(localStorage.getItem('minimizedSections') || '{}'),
      cloudSyncConfig: JSON.parse(localStorage.getItem('day-planner-cloud-sync-config') || 'null'),
      reminderSettings: JSON.parse(localStorage.getItem('day-planner-reminder-settings') || 'null'),
      habits: JSON.parse(localStorage.getItem('day-planner-habits') || '[]'),
      habitLogs: JSON.parse(localStorage.getItem('day-planner-habit-logs') || '{}'),
      aiConfig: JSON.parse(localStorage.getItem('day-planner-ai-config') || 'null'),
      obsidianConfig: JSON.parse(localStorage.getItem('day-planner-obsidian-config') || 'null'),
      calendarFilter: JSON.parse(localStorage.getItem('day-planner-calendar-filter') || '[]'),
      goals: JSON.parse(localStorage.getItem('day-planner-goals') || '[]'),
      projects: JSON.parse(localStorage.getItem('day-planner-projects') || '[]'),
      goalsProjectsEnabled: JSON.parse(localStorage.getItem('day-planner-goals-projects-enabled') || 'false'),
    }
  });

  const performLocalBackup = async (frequency) => {
    try {
      setAutoBackupStatus(prev => ({ ...prev, local: { ...prev.local, status: 'backing-up' } }));
      const payload = buildAutoBackupPayload();
      await autoBackupDB.saveBackup(frequency, payload);
      await autoBackupDB.pruneBackups(frequency, AUTO_BACKUP_RETENTION[frequency]);
      const now = new Date().toISOString();
      localStorage.setItem('day-planner-auto-backup-local-last', now);
      setAutoBackupStatus(prev => ({ ...prev, local: { lastBackup: now, status: 'success' } }));
      setTimeout(() => setAutoBackupStatus(prev => ({
        ...prev, local: { ...prev.local, status: prev.local.status === 'success' ? 'idle' : prev.local.status }
      })), 3000);
    } catch (err) {
      console.error('Local auto-backup failed:', err);
      setAutoBackupStatus(prev => ({ ...prev, local: { ...prev.local, status: 'error' } }));
    }
  };

  const performRemoteBackup = async (frequency) => {
    if (autoBackupInProgressRef.current) return;
    // Guard: skip silently if the selected provider's required fields aren't filled yet.
    // This prevents error spam on the backup interval when the user has enabled remote
    // backup but hasn't finished configuring it (e.g. Nextcloud URL missing).
    const provider = autoBackupProviders[autoBackupConfig.remote.provider];
    if (!provider || !provider.configFields.every(f => autoBackupConfig.remote[f.key])) return;
    autoBackupInProgressRef.current = true;
    try {
      setAutoBackupStatus(prev => ({ ...prev, remote: { ...prev.remote, status: 'backing-up' } }));
      const payload = buildAutoBackupPayload();
      await provider.uploadBackup(autoBackupConfig.remote, payload);
      // Prune remote backups
      const remoteFiles = await provider.listBackups(autoBackupConfig.remote);
      const maxKeep = AUTO_BACKUP_RETENTION[frequency];
      if (remoteFiles.length > maxKeep) {
        const toDelete = remoteFiles.slice(maxKeep);
        for (const f of toDelete) {
          await provider.deleteBackup(autoBackupConfig.remote, f.filename);
        }
      }
      const now = new Date().toISOString();
      localStorage.setItem('day-planner-auto-backup-remote-last', now);
      setAutoBackupStatus(prev => ({ ...prev, remote: { lastBackup: now, status: 'success' } }));
      setTimeout(() => setAutoBackupStatus(prev => ({
        ...prev, remote: { ...prev.remote, status: prev.remote.status === 'success' ? 'idle' : prev.remote.status }
      })), 3000);
    } catch (err) {
      console.error('Remote auto-backup failed:', err);
      setAutoBackupStatus(prev => ({ ...prev, remote: { ...prev.remote, status: 'error' } }));
    } finally {
      autoBackupInProgressRef.current = false;
    }
  };

  const restoreFromAutoBackup = async (backupId) => {
    try {
      const record = await autoBackupDB.getBackup(backupId);
      if (!record?.data?.data) throw new Error('Invalid backup record');
      const { data } = record.data;
      if (data.aiConfig) localStorage.setItem('day-planner-ai-config', JSON.stringify(data.aiConfig));
      if (data.obsidianConfig) localStorage.setItem('day-planner-obsidian-config', JSON.stringify(data.obsidianConfig));
      applyRemoteData(data);
      window.location.reload();
    } catch (err) {
      alert('Failed to restore backup: ' + err.message);
    }
  };

  const restoreFromRemoteBackup = async (filename) => {
    try {
      const provider = autoBackupProviders[autoBackupConfig.remote.provider];
      if (!provider) throw new Error('No provider configured');
      const backup = await provider.downloadBackup(autoBackupConfig.remote, filename);
      if (!backup?.data) throw new Error('Invalid backup file');
      if (backup.data.aiConfig) localStorage.setItem('day-planner-ai-config', JSON.stringify(backup.data.aiConfig));
      if (backup.data.obsidianConfig) localStorage.setItem('day-planner-obsidian-config', JSON.stringify(backup.data.obsidianConfig));
      applyRemoteData(backup.data);
      window.location.reload();
    } catch (err) {
      alert('Failed to restore remote backup: ' + err.message);
    }
  };

  const loadAutoBackupHistory = async () => {
    try {
      const localBackups = await autoBackupDB.listBackups();
      let remoteBackups = [];
      if (autoBackupConfig.remote.enabled) {
        try {
          const provider = autoBackupProviders[autoBackupConfig.remote.provider];
          if (provider) remoteBackups = await provider.listBackups(autoBackupConfig.remote);
        } catch (err) {
          console.error('Failed to list remote backups:', err);
        }
      }
      setAutoBackupHistory({ local: localBackups, remote: remoteBackups });
    } catch (err) {
      console.error('Failed to load backup history:', err);
    }
  };

  const deleteLocalAutoBackup = async (id) => {
    await autoBackupDB.deleteBackup(id);
    setAutoBackupHistory(prev => ({ ...prev, local: prev.local.filter(b => b.id !== id) }));
  };

  const deleteRemoteAutoBackup = async (filename) => {
    const provider = autoBackupProviders[autoBackupConfig.remote.provider];
    if (provider) {
      await provider.deleteBackup(autoBackupConfig.remote, filename);
      setAutoBackupHistory(prev => ({ ...prev, remote: prev.remote.filter(b => b.filename !== filename) }));
    }
  };

  // Handle backup file selection
  const handleBackupFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPendingBackupFile(file);
    setShowBackupMenu(false);
    setShowRestoreConfirm(true);
    e.target.value = '';
  };

  // Restore data from backup file
  const restoreBackup = () => {
    if (!pendingBackupFile) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const backup = JSON.parse(e.target.result);

        // Validate structure
        if (!backup.data || !backup.version) {
          throw new Error('Invalid backup file format');
        }

        // Restore all data
        const { data } = backup;
        if (data.tasks) localStorage.setItem('day-planner-tasks', JSON.stringify(data.tasks));
        if (data.unscheduledTasks) localStorage.setItem('day-planner-unscheduled', JSON.stringify(data.unscheduledTasks));
        if (data.recycleBin) localStorage.setItem('day-planner-recycle-bin', JSON.stringify(data.recycleBin));
        if (data.darkMode !== undefined) localStorage.setItem('day-planner-darkmode', JSON.stringify(data.darkMode));
        if (data.syncUrl !== undefined) localStorage.setItem('day-planner-sync-url', data.syncUrl);
        if (data.taskCalendarUrl !== undefined) localStorage.setItem('day-planner-task-calendar-url', data.taskCalendarUrl);
        if (data.taskCalendarAuth) localStorage.setItem('day-planner-task-calendar-auth', JSON.stringify(data.taskCalendarAuth));
        if (data.completedTaskUids) localStorage.setItem('day-planner-task-completed-uids', JSON.stringify(data.completedTaskUids));
        if (data.recurringTasks) localStorage.setItem('day-planner-recurring-tasks', JSON.stringify(data.recurringTasks));
        if (data.routineDefinitions) localStorage.setItem('day-planner-routine-definitions', JSON.stringify(data.routineDefinitions));
        if (data.selectedTags) localStorage.setItem('day-planner-selected-tags', JSON.stringify(data.selectedTags));
        if (data.minimizedSections) localStorage.setItem('minimizedSections', JSON.stringify(data.minimizedSections));
        if (data.cloudSyncConfig) localStorage.setItem('day-planner-cloud-sync-config', JSON.stringify(data.cloudSyncConfig));
        if (data.reminderSettings) localStorage.setItem('day-planner-reminder-settings', JSON.stringify(data.reminderSettings));
        if (data.use24HourClock !== undefined) localStorage.setItem('day-planner-use-24h-clock', JSON.stringify(data.use24HourClock));
        if (data.weatherZip !== undefined) localStorage.setItem('day-planner-weather-zip', data.weatherZip);
        if (data.weatherTempUnit !== undefined) localStorage.setItem('day-planner-weather-temp-unit', data.weatherTempUnit);
        if (data.habits) localStorage.setItem('day-planner-habits', JSON.stringify(data.habits));
        if (data.habitLogs) localStorage.setItem('day-planner-habit-logs', JSON.stringify(data.habitLogs));
        // If backup has habits data, always enable habits regardless of the backed-up toggle value
        // (the toggle may have been incorrectly saved as false by an earlier bug)
        const habitsEnabledVal = (data.habits && data.habits.filter(h => !h.archived).length > 0) ? true : (data.habitsEnabled ?? false);
        localStorage.setItem('day-planner-habits-enabled', JSON.stringify(habitsEnabledVal));
        // Same for routines
        const hasRoutineDefs = data.routineDefinitions && Object.values(data.routineDefinitions).some(arr => arr.length > 0);
        const routinesEnabledVal = hasRoutineDefs ? true : (data.routinesEnabled ?? false);
        localStorage.setItem('day-planner-routines-enabled', JSON.stringify(routinesEnabledVal));
        if (data.aiConfig) localStorage.setItem('day-planner-ai-config', JSON.stringify(data.aiConfig));
        if (data.obsidianConfig) localStorage.setItem('day-planner-obsidian-config', JSON.stringify(data.obsidianConfig));
        if (data.calendarFilter) localStorage.setItem('day-planner-calendar-filter', JSON.stringify(data.calendarFilter));
        if (data.goals) localStorage.setItem('day-planner-goals', JSON.stringify(data.goals));
        if (data.projects) localStorage.setItem('day-planner-projects', JSON.stringify(data.projects));
        if (data.goalsProjectsEnabled !== undefined) localStorage.setItem('day-planner-goals-projects-enabled', JSON.stringify(data.goalsProjectsEnabled));

        // Reload app to reflect changes
        // On Android WebView, use href assignment for a full reload; fall back to reload()
        try {
          window.location.href = window.location.href;
        } catch {
          window.location.reload();
        }
      } catch (err) {
        alert('Failed to restore backup: ' + err.message);
        setPendingBackupFile(null);
        setShowRestoreConfirm(false);
      }
    };
    reader.onerror = () => {
      alert('Failed to read backup file. On Android, try sharing the file directly to the app or using a file manager app.');
      setPendingBackupFile(null);
      setShowRestoreConfirm(false);
    };
    reader.readAsText(pendingBackupFile);
  };

  // Returns { success: boolean, count?: number, error?: string }
  const syncWithCalendar = async () => {
    // On Android, calendar events come from the native CalendarBridge (device accounts).
    // CalDAV iCal sync would duplicate those events, so skip it entirely.
    if (isNativeAndroid()) return { success: false, error: 'no-url' };
    if (!syncUrl) {
      return { success: false, error: 'no-url' };
    }

    try {
      // Use proxy to bypass CORS restrictions
      // Note: URL is not encoded because nginx's $arg_url doesn't auto-decode
      const proxyUrl = `/api/calendar-proxy/?url=${syncUrl}`;
      const calProxyHeaders = {};
      if (calendarUrlAuth.username && calendarUrlAuth.password) {
        calProxyHeaders['X-Calendar-Auth'] = 'Basic ' + toBase64(calendarUrlAuth.username + ':' + calendarUrlAuth.password);
      }
      const response = await fetch(proxyUrl, { headers: calProxyHeaders });
      if (!response.ok) throw new Error('Failed to fetch calendar');

      let icsContent = await response.text();
      let effectiveUrl = syncUrl;

      if (!icsContent.includes('BEGIN:VCALENDAR')) {
        // CalDAV collection URLs (Baikal, Nextcloud, etc.) return HTML or WebDAV XML
        // unless ?export is appended. Auto-retry once before giving up.
        console.log('[calendar-sync] Response is not ICS. Content-Type:', response.headers.get('content-type'), '— First 300 chars:', icsContent.slice(0, 300));
        if (!syncUrl.includes('export')) {
          const exportUrl = syncUrl.includes('?') ? `${syncUrl}&export` : `${syncUrl}?export`;
          console.log('[calendar-sync] Retrying with ?export:', exportUrl);
          try {
            const exportResponse = await fetch(`/api/calendar-proxy/?url=${exportUrl}`, { headers: calProxyHeaders });
            if (exportResponse.ok) {
              const exportContent = await exportResponse.text();
              if (exportContent.includes('BEGIN:VCALENDAR')) {
                icsContent = exportContent;
                effectiveUrl = exportUrl;
              } else {
                console.log('[calendar-sync] ?export retry also returned non-ICS. Content-Type:', exportResponse.headers.get('content-type'), '— First 300 chars:', exportContent.slice(0, 300));
              }
            }
          } catch { /* fall through to not-ical error below */ }
        }
      }

      if (!icsContent.includes('BEGIN:VCALENDAR')) {
        throw new Error('not-ical');
      }

      // Persist the corrected URL so future syncs use it directly
      if (effectiveUrl !== syncUrl) {
        setSyncUrl(effectiveUrl);
        localStorage.setItem('day-planner-sync-url', effectiveUrl);
      }

      const events = parseICS(icsContent);

      const allImported = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar: false })
      );
      const importedTasks = filterByDateWindow(allImported, syncRetentionDays);

      // Remove old sync-sourced imported events (not task calendar) and add the fresh ones
      // Preserves file-imported events; uses functional form to avoid stale closures
      setTasks(prevTasks => {
        const kept = prevTasks.filter(t => !(t.imported && !t.isTaskCalendar && t.importSource !== 'file'));
        return [...kept, ...importedTasks];
      });
      return { success: true, count: importedTasks.length, urlUpdated: effectiveUrl !== syncUrl };
    } catch (error) {
      console.error('Sync error:', error);
      return { success: false, error: error.message === 'not-ical' ? 'not-ical' : 'calendar' };
    }
  };

  // Returns { success: boolean, count?: number, error?: string }
  const syncTaskCalendar = async () => {
    if (!taskCalendarUrl) {
      return { success: false, error: 'no-url' };
    }

    try {
      let icsContent;
      const taskAuthHeaders = { Accept: 'text/calendar, text/plain, */*' };
      if (taskCalendarAuth.username && taskCalendarAuth.appPassword) {
        taskAuthHeaders['Authorization'] = 'Basic ' + toBase64(taskCalendarAuth.username + ':' + taskCalendarAuth.appPassword);
      }
      let effectiveTaskUrl = taskCalendarUrl;
      if (isNativeAndroid()) {
        // On Android: fetch directly — no CORS restrictions, no proxy server available
        const result = nativeHttpRequest('GET', taskCalendarUrl, taskAuthHeaders, '');
        if (!result || !result.ok) throw new Error('Failed to fetch task calendar');
        icsContent = result.body;
      } else {
        const proxyUrl = `/api/calendar-proxy/?url=${taskCalendarUrl}`;
        const taskProxyHeaders = {};
        if (taskCalendarAuth.username && taskCalendarAuth.appPassword) {
          taskProxyHeaders['X-Calendar-Auth'] = 'Basic ' + toBase64(taskCalendarAuth.username + ':' + taskCalendarAuth.appPassword);
        }
        const response = await fetch(proxyUrl, { headers: taskProxyHeaders });
        if (!response.ok) throw new Error('Failed to fetch task calendar');
        icsContent = await response.text();

        if (!icsContent.includes('BEGIN:VCALENDAR') && !taskCalendarUrl.includes('export')) {
          // Auto-retry with ?export for CalDAV collection URLs (Baikal, Nextcloud, etc.)
          console.log('[task-calendar-sync] Response is not ICS. Content-Type:', response.headers.get('content-type'), '— First 300 chars:', icsContent.slice(0, 300));
          const exportUrl = taskCalendarUrl.includes('?') ? `${taskCalendarUrl}&export` : `${taskCalendarUrl}?export`;
          console.log('[task-calendar-sync] Retrying with ?export:', exportUrl);
          try {
            const exportResponse = await fetch(`/api/calendar-proxy/?url=${exportUrl}`, { headers: taskProxyHeaders });
            if (exportResponse.ok) {
              const exportContent = await exportResponse.text();
              if (exportContent.includes('BEGIN:VCALENDAR')) {
                icsContent = exportContent;
                effectiveTaskUrl = exportUrl;
              }
            }
          } catch { /* fall through, parseICS will handle gracefully */ }
        }
      }

      // Persist the corrected URL so future syncs use it directly
      if (effectiveTaskUrl !== taskCalendarUrl) {
        setTaskCalendarUrl(effectiveTaskUrl);
        localStorage.setItem('day-planner-task-calendar-url', effectiveTaskUrl);
      }

      const events = parseICS(icsContent);

      // Read fresh completedTaskUids from localStorage to avoid stale closure
      const freshCompletedUids = new Set(
        JSON.parse(localStorage.getItem('day-planner-task-completed-uids') || '[]')
      );

      const allTaskItems = events.flatMap(event =>
        expandMultiDayEvent(event, { asTaskCalendar: true, freshCompletedUids })
      );
      const taskCalendarItems = filterByDateWindow(allTaskItems, syncRetentionDays);

      // Remove old sync-sourced task calendar items and add the fresh ones
      // Preserves file-imported task calendar items; uses functional form to avoid stale closures
      setTasks(prevTasks => {
        const kept = prevTasks.filter(t => !(t.isTaskCalendar && t.importSource !== 'file'));
        return [...kept, ...taskCalendarItems];
      });
      return { success: true, count: taskCalendarItems.length, urlUpdated: effectiveTaskUrl !== taskCalendarUrl };
    } catch (error) {
      console.error('Task calendar sync error:', error);
      return { success: false, error: 'task-calendar' };
    }
  };

  // Sync task completion status back to CalDAV server
  // For non-recurring tasks: modifies STATUS/COMPLETED/PERCENT-COMPLETE directly.
  // For recurring tasks: advances DUE/DTSTART to the next RRULE occurrence (keeps
  // STATUS:NEEDS-ACTION) so Nextcloud immediately shows the next instance as a fresh
  // to-do. Nextcloud doesn't support RECURRENCE-ID overrides for VTODOs
  // (https://github.com/nextcloud/tasks/issues/2276), so per-instance completion
  // can't be represented — advancing the due date is the best compatible approach.
  const syncTaskCompletionToCalDAV = async (icalUid, completed, { isRecurring = false, date, startTime, isAllDay } = {}) => {
    const { username, appPassword, caldavBaseUrl } = taskCalendarAuth;
    if (!caldavBaseUrl || !username || !appPassword) {
      console.warn('CalDAV task sync skipped: caldavBaseUrl, username, or appPassword is not set in task calendar settings.');
      return;
    }

    const baseUrl = caldavBaseUrl.replace(/\/+$/, '');
    // Use encodeURI (not encodeURIComponent) for the UID — CalDAV UIDs often contain
    // @ and other characters that are valid in URL paths but encodeURIComponent would escape
    const resourceUrl = `${baseUrl}/${encodeURI(icalUid)}.ics`;
    const authHeaders = {
      'X-WebDAV-Auth': 'Basic ' + toBase64(username + ':' + appPassword)
    };

    try {
      const getRes = await fetch(`/api/webdav-proxy/?url=${resourceUrl}`, {
        method: 'GET',
        headers: authHeaders
      });

      if (!getRes.ok) {
        console.error('CalDAV GET failed:', getRes.status, resourceUrl);
        setSyncNotification({ type: 'error', title: 'CalDAV Sync', message: `Failed to fetch task from server (HTTP ${getRes.status}). Check CalDAV Base URL.` });
        return;
      }

      let icsContent = await getRes.text();
      const now = new Date();
      const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

      if (isRecurring && date) {
        // --- Recurring task: advance (or revert) DUE/DTSTART ---
        // Clean up any stale RECURRENCE-ID overrides from previous sync code
        icsContent = icsContent.replace(
          /BEGIN:VTODO\r?\n(?:(?!END:VTODO)[\s\S])*?RECURRENCE-ID[\s\S]*?END:VTODO\r?\n?/gm,
          ''
        );

        // Parse RRULE from master VTODO
        const rruleMatch = icsContent.match(/^RRULE:(.+)$/m);
        if (!rruleMatch) {
        } else {
          const rruleStr = rruleMatch[1].trim();
          const datePart = date.replace(/-/g, ''); // "YYYYMMDD"
          const completedYear = parseInt(datePart.substring(0, 4));
          const completedMonth = parseInt(datePart.substring(4, 6)) - 1;
          const completedDay = parseInt(datePart.substring(6, 8));
          const completedDate = new Date(completedYear, completedMonth, completedDay);

          // Calculate the target date: next occurrence (completing) or the instance date (uncompleting)
          let targetDate;
          if (completed) {
            // Calculate next RRULE occurrence after the completed instance
            const rule = {};
            rruleStr.split(';').forEach(part => {
              const eq = part.indexOf('=');
              if (eq !== -1) rule[part.substring(0, eq).trim().toUpperCase()] = part.substring(eq + 1).trim().toUpperCase();
            });
            const interval = parseInt(rule.INTERVAL || '1');
            const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

            if (rule.FREQ === 'DAILY') {
              targetDate = new Date(completedDate);
              targetDate.setDate(targetDate.getDate() + interval);
            } else if (rule.FREQ === 'WEEKLY') {
              const byDays = rule.BYDAY
                ? rule.BYDAY.split(',').map(d => dayMap[d.trim()]).filter(d => d !== undefined).sort((a, b) => a - b)
                : [completedDate.getDay()];
              const currentDow = completedDate.getDay();
              const nextDow = byDays.find(d => d > currentDow);
              targetDate = new Date(completedDate);
              if (nextDow !== undefined) {
                targetDate.setDate(targetDate.getDate() + (nextDow - currentDow));
              } else {
                // Wrap to first BYDAY of next interval-week
                const daysToNextSunday = 7 - currentDow;
                targetDate.setDate(targetDate.getDate() + daysToNextSunday + (interval - 1) * 7 + byDays[0]);
              }
            } else if (rule.FREQ === 'MONTHLY') {
              targetDate = new Date(completedDate);
              if (rule.BYDAY) {
                const m = rule.BYDAY.match(/^(-?\d*)([A-Z]{2})$/);
                if (m && dayMap[m[2]] !== undefined) {
                  const nth = m[1] ? parseInt(m[1]) : 1;
                  const targetDow = dayMap[m[2]];
                  targetDate.setMonth(targetDate.getMonth() + interval);
                  if (nth > 0) {
                    const firstDow = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1).getDay();
                    targetDate.setDate(1 + ((targetDow - firstDow + 7) % 7) + (nth - 1) * 7);
                  } else {
                    const last = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
                    targetDate = new Date(targetDate.getFullYear(), targetDate.getMonth(),
                      last.getDate() - ((last.getDay() - targetDow + 7) % 7) + (nth + 1) * 7);
                  }
                } else {
                  targetDate.setMonth(targetDate.getMonth() + interval);
                }
              } else {
                const targetDay = rule.BYMONTHDAY ? parseInt(rule.BYMONTHDAY) : completedDay;
                targetDate.setMonth(targetDate.getMonth() + interval);
                targetDate.setDate(targetDay);
                if (targetDate.getDate() !== targetDay) {
                  targetDate = new Date(targetDate.getFullYear(), targetDate.getMonth(), 0);
                }
              }
            } else if (rule.FREQ === 'YEARLY') {
              targetDate = new Date(completedDate);
              targetDate.setFullYear(targetDate.getFullYear() + interval);
            }

            // Check UNTIL — if next occurrence exceeds UNTIL, the series is done
            if (targetDate && rule.UNTIL) {
              const u = rule.UNTIL;
              const untilDate = new Date(parseInt(u.substring(0, 4)), parseInt(u.substring(4, 6)) - 1, parseInt(u.substring(6, 8)));
              if (targetDate > untilDate) targetDate = null;
            }
          } else {
            // Uncompleting: revert DUE/DTSTART back to the instance's date
            targetDate = completedDate;
          }

          if (targetDate) {
            // Calculate delta from the CURRENT DUE/DTSTART in the ICS to the target date.
            // Using the current anchor (not completedDate) is critical for uncomplete:
            // the DUE was previously advanced, so we need to shift it BACK.
            const fmtDate = (d) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
            const vtodoBlock = icsContent.match(/BEGIN:VTODO[\s\S]*?END:VTODO/);
            const currentDueMatch = icsContent.match(/^DUE[^:]*:(\d{8})/m);
            const currentDtstartMatch = vtodoBlock && vtodoBlock[0].match(/^DTSTART[^:]*:(\d{8})/m);
            const anchorStr = (currentDueMatch || currentDtstartMatch || [])[1];
            let deltaDays = 0;
            if (anchorStr) {
              const anchorDate = new Date(parseInt(anchorStr.substring(0, 4)), parseInt(anchorStr.substring(4, 6)) - 1, parseInt(anchorStr.substring(6, 8)));
              deltaDays = Math.round((targetDate - anchorDate) / 86400000);
            }

            const advanceDateInLine = (line) => line.replace(/(\d{4})(\d{2})(\d{2})/, (_m, y, mo, d) => {
              const orig = new Date(parseInt(y), parseInt(mo) - 1, parseInt(d));
              orig.setDate(orig.getDate() + deltaDays);
              return fmtDate(orig);
            });

            // Update DUE line
            const dueLineMatch = icsContent.match(/^DUE[^:]*:\d{8}.*$/m);
            if (dueLineMatch) {
              icsContent = icsContent.replace(dueLineMatch[0], advanceDateInLine(dueLineMatch[0]));
            }
            // Update DTSTART line (only inside VTODO, not VTIMEZONE)
            if (vtodoBlock) {
              const dtstartInVtodo = vtodoBlock[0].match(/^DTSTART[^:]*:\d{8}.*$/m);
              if (dtstartInVtodo) {
                icsContent = icsContent.replace(dtstartInVtodo[0], advanceDateInLine(dtstartInVtodo[0]));
              }
            }

            // Ensure STATUS is NEEDS-ACTION (the next instance is not yet completed)
            if (/^STATUS:/m.test(icsContent)) {
              icsContent = icsContent.replace(/^STATUS:.*$/m, 'STATUS:NEEDS-ACTION');
            }
            // Remove any COMPLETED timestamp
            icsContent = icsContent.replace(/^COMPLETED:.*\r?\n/m, '');
            // Reset PERCENT-COMPLETE
            if (/^PERCENT-COMPLETE:/m.test(icsContent)) {
              icsContent = icsContent.replace(/^PERCENT-COMPLETE:.*$/m, 'PERCENT-COMPLETE:0');
            }

          } else if (completed) {
            // Fall through to non-recurring completion below
          }

          // If targetDate was set, skip the non-recurring block
          if (targetDate) {
            // Already handled above — skip to LAST-MODIFIED/PUT
          } else if (!completed) {
            // Uncomplete with no targetDate shouldn't happen, but be safe
          } else {
            // completed && !targetDate => series ended, use non-recurring completion
            if (/^STATUS:/m.test(icsContent)) {
              icsContent = icsContent.replace(/^STATUS:.*$/m, 'STATUS:COMPLETED');
            } else {
              icsContent = icsContent.replace(/^(END:VTODO)/m, 'STATUS:COMPLETED\r\n$1');
            }
            if (/^COMPLETED:/m.test(icsContent)) {
              icsContent = icsContent.replace(/^COMPLETED:.*$/m, `COMPLETED:${timestamp}`);
            } else {
              icsContent = icsContent.replace(/^(END:VTODO)/m, `COMPLETED:${timestamp}\r\n$1`);
            }
            if (/^PERCENT-COMPLETE:/m.test(icsContent)) {
              icsContent = icsContent.replace(/^PERCENT-COMPLETE:.*$/m, 'PERCENT-COMPLETE:100');
            } else {
              icsContent = icsContent.replace(/^(END:VTODO)/m, 'PERCENT-COMPLETE:100\r\n$1');
            }
          }
        }
      }

      if (!isRecurring || !date || !icsContent.match(/^RRULE:/m)) {
        // --- Non-recurring (or recurring without RRULE fallback): update STATUS directly ---
        if (completed) {
          if (/^STATUS:/m.test(icsContent)) {
            icsContent = icsContent.replace(/^STATUS:.*$/m, 'STATUS:COMPLETED');
          } else {
            icsContent = icsContent.replace(/^(END:VTODO)/m, 'STATUS:COMPLETED\r\n$1');
          }
          if (/^COMPLETED:/m.test(icsContent)) {
            icsContent = icsContent.replace(/^COMPLETED:.*$/m, `COMPLETED:${timestamp}`);
          } else {
            icsContent = icsContent.replace(/^(END:VTODO)/m, `COMPLETED:${timestamp}\r\n$1`);
          }
          if (/^PERCENT-COMPLETE:/m.test(icsContent)) {
            icsContent = icsContent.replace(/^PERCENT-COMPLETE:.*$/m, 'PERCENT-COMPLETE:100');
          } else {
            icsContent = icsContent.replace(/^(END:VTODO)/m, 'PERCENT-COMPLETE:100\r\n$1');
          }
        } else {
          if (/^STATUS:/m.test(icsContent)) {
            icsContent = icsContent.replace(/^STATUS:.*$/m, 'STATUS:NEEDS-ACTION');
          }
          icsContent = icsContent.replace(/^COMPLETED:.*\r?\n/m, '');
          if (/^PERCENT-COMPLETE:/m.test(icsContent)) {
            icsContent = icsContent.replace(/^PERCENT-COMPLETE:.*$/m, 'PERCENT-COMPLETE:0');
          }
        }
      }

      // Update LAST-MODIFIED on the master component
      if (/^LAST-MODIFIED:/m.test(icsContent)) {
        icsContent = icsContent.replace(/^LAST-MODIFIED:.*$/m, `LAST-MODIFIED:${timestamp}`);
      }

      // PUT the updated resource back
      const putRes = await fetch(`/api/webdav-proxy/?url=${resourceUrl}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'text/calendar; charset=utf-8' },
        body: icsContent
      });

      if (!putRes.ok) {
        console.error('CalDAV PUT failed:', putRes.status, resourceUrl);
        setSyncNotification({ type: 'error', title: 'CalDAV Sync', message: `Failed to update task on server (HTTP ${putRes.status})` });
      }
    } catch (err) {
      console.error('CalDAV completion sync error:', err);
      setSyncNotification({ type: 'error', title: 'CalDAV Sync', message: `Sync error: ${err.message}` });
    }
  };

  // Combined sync function that shows a single notification
  const syncAll = async ({ silent = false } = {}) => {
    const hasSyncTarget = isNativeAndroid() ? !!taskCalendarUrl : !!(syncUrl || taskCalendarUrl);
    if (!hasSyncTarget) {
      if (!silent) setSyncNotification({ type: 'info', message: 'Please enter a task calendar URL in sync settings' });
      return;
    }

    setIsSyncing(true);
    try {
      const [calendarResult, taskResult] = await Promise.all([
        syncWithCalendar(),
        syncTaskCalendar()
      ]);

      // Track status and last synced time
      const hasSuccess = calendarResult.success || taskResult.success;
      const hasError = (calendarResult.error === 'calendar') || (taskResult.error === 'task-calendar');

      if (hasSuccess) {
        const now = new Date().toISOString();
        setCalSyncLastSynced(now);
        localStorage.setItem('day-planner-cal-sync-last-synced', now);
      }
      setCalSyncStatus(hasError ? 'error' : hasSuccess ? 'success' : null);

      if (silent) return;

      // Build notification message
      const successes = [];
      const errors = [];

      if (calendarResult.success) {
        successes.push(`${calendarResult.count} event${calendarResult.count !== 1 ? 's' : ''}`);
      } else if (calendarResult.error === 'not-ical') {
        if (!silent) setSyncNotification({ type: 'error', title: 'Calendar Sync', message: 'The URL did not return a calendar file. For CalDAV servers (Nextcloud, Baikal, etc.), append ?export to the URL (e.g. …/default/?export).' });
        setIsSyncing(false);
        return;
      } else if (calendarResult.error === 'calendar') {
        errors.push('calendar');
      }

      if (taskResult.success) {
        successes.push(`${taskResult.count} task${taskResult.count !== 1 ? 's' : ''}`);
      } else if (taskResult.error === 'task-calendar') {
        errors.push('task calendar');
      }

      const urlUpdated = calendarResult.urlUpdated || taskResult.urlUpdated;
      if (errors.length > 0 && successes.length === 0) {
        setSyncNotification({ type: 'error', message: `Failed to sync with ${errors.join(' and ')}. Make sure the URL is correct and publicly accessible.` });
      } else if (errors.length > 0) {
        setSyncNotification({ type: 'error', message: `Synced ${successes.join(' and ')}, but failed to sync ${errors.join(' and ')}` });
      } else if (successes.length > 0) {
        const urlNote = urlUpdated ? ' (?export appended to your calendar URL automatically)' : '';
        setSyncNotification({ type: 'success', message: `Synced ${successes.join(' and ')}${urlNote}` });
      }
    } finally {
      setIsSyncing(false);
    }
  };
  syncAllRef.current = syncAll;

  // Cloud sync functions
  const buildSyncPayload = () => {
    // Read directly from React state (always current) rather than localStorage to
    // avoid a stale-read race when a state change hasn't flushed to localStorage yet.
    // Task arrays need timestamp-stamping (mirrors saveData); tombstone maps that
    // have no React state counterpart still fall back to localStorage.
    const uidCutoff = syncRetentionDays > 0 ? new Date(Date.now() - syncRetentionDays * 86400000) : null;
    const prunedUids = [...completedTaskUids].filter(uid => {
      if (!uidCutoff) return true;
      const m = uid.match(/::(\d{4}-\d{2}-\d{2})$/);
      return !m || new Date(m[1]) >= uidCutoff;
    });
    return {
      version: 2,
      lastModified: new Date().toISOString(),
      data: {
        tasks: stampTaskTimestamps(tasks.filter(t => !t._native), 'day-planner-tasks'),
        unscheduledTasks: stampTaskTimestamps(unscheduledTasks, 'day-planner-unscheduled'),
        unscheduledOrderTimestamp,
        recycleBin: stampTaskTimestamps(recycleBin, 'day-planner-recycle-bin'),
        syncUrl,
        taskCalendarUrl,
        // taskCalendarAuth is intentionally excluded — credentials must not be written
        // to the shared sync file on the WebDAV server.
        completedTaskUids: prunedUids,
        recurringTasks: stampTaskTimestamps(recurringTasks, 'day-planner-recurring-tasks'),
        routineDefinitions,
        todayRoutines: stampTaskTimestamps(todayRoutines, 'day-planner-today-routines'),
        routinesDate,
        routineCompletions,
        minimizedSections,
        use24HourClock,
        weatherZip,
        weatherTempUnit,
        // Tombstone maps have no React state — read from localStorage (they only
        // change during sync, never between a state change and the next flush).
        deletedTaskIds: JSON.parse(localStorage.getItem('day-planner-deleted-task-ids') || '{}'),
        deletedRoutineChipIds: JSON.parse(localStorage.getItem('day-planner-deleted-routine-chip-ids') || '{}'),
        deletedFrameIds: JSON.parse(localStorage.getItem('day-planner-deleted-frame-ids') || '{}'),
        removedTodayRoutineIds,
        dailyNotes,
        habits,
        habitLogs,
        habitsEnabled,
        deletedHabitIds: JSON.parse(localStorage.getItem('day-planner-deleted-habit-ids') || '{}'),
        routinesEnabled,
        gtdFrames,
        goals,
        deletedGoalIds: JSON.parse(localStorage.getItem('day-planner-deleted-goal-ids') || '{}'),
        projects,
        deletedProjectIds: JSON.parse(localStorage.getItem('day-planner-deleted-project-ids') || '{}'),
        goalsProjectsEnabled,
        obsidianConfig: obsidianConfig ?? null,
      }
    };
  };

  const cloudSyncUpload = async (prebuiltPayload) => {
    if (!cloudSyncConfig?.enabled || cloudSyncInProgressRef.current) return;
    const provider = cloudSyncProviders[cloudSyncConfig.provider];
    if (!provider) return;

    cloudSyncInProgressRef.current = true;
    const syncStart = Date.now();
    setCloudSyncStatus('uploading');
    setCloudSyncError(null);
    try {
      const payload = prebuiltPayload || buildSyncPayload();

      // Safety check: never upload a payload that would wipe all user data.
      // If local has tasks/habits/inbox items but the payload is empty, something
      // went wrong (stale state, race condition, etc.) — abort rather than
      // overwriting the remote with empty data.
      const localTaskCount = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]').length;
      const localInboxCount = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]').length;
      const payloadTaskCount = (payload.data?.tasks?.length || 0) + (payload.data?.unscheduledTasks?.length || 0);
      if (localTaskCount + localInboxCount > 0 && payloadTaskCount === 0) {
        console.error('Cloud sync upload aborted: payload has 0 tasks but localStorage has', localTaskCount + localInboxCount);
        setCloudSyncStatus('idle');
        return;
      }

      await provider.upload(cloudSyncConfig, payload);
      const elapsed = Date.now() - syncStart;
      if (elapsed < 2000) await new Promise(r => setTimeout(r, 2000 - elapsed));
      const now = new Date().toISOString();
      cloudSyncErrorCountRef.current = 0; // reset error backoff on success
      cloudSyncBackoffUntilRef.current = 0;
      setCloudSyncLastSynced(now);
      localStorage.setItem('day-planner-cloud-sync-last-synced', now);
      localStorage.setItem('day-planner-cloud-sync-local-modified', payload.lastModified);
      setCloudSyncStatus('success');
      setTimeout(() => setCloudSyncStatus((s) => s === 'success' ? 'idle' : s), 3000);
    } catch (err) {
      console.error('Cloud sync upload error:', err);
      cloudSyncErrorCountRef.current += 1;
      const backoffMs = Math.min(30 * Math.pow(2, cloudSyncErrorCountRef.current - 1), 15 * 60) * 1000;
      cloudSyncBackoffUntilRef.current = Date.now() + backoffMs;
      const errMsg = err.message === 'FORBIDDEN'
        ? 'Sync blocked (403) — your server may be blocking Vercel\'s IP addresses.'
        : err.message;
      setCloudSyncError(errMsg);
      setCloudSyncStatus('error');
      setTimeout(() => setCloudSyncStatus((s) => s === 'error' ? 'idle' : s), 5000);
    } finally {
      cloudSyncInProgressRef.current = false;
    }
  };

  const applyRemoteData = (data) => {
    // Safety check: if remote/merged data has zero tasks but local has data,
    // something went wrong in the merge — skip applying to avoid data wipe.
    const localTaskCount = JSON.parse(localStorage.getItem('day-planner-tasks') || '[]').length;
    const localInboxCount = JSON.parse(localStorage.getItem('day-planner-unscheduled') || '[]').length;
    const remoteTaskCount = (data.tasks?.length || 0) + (data.unscheduledTasks?.length || 0);
    if (localTaskCount + localInboxCount > 0 && remoteTaskCount === 0) {
      console.error('applyRemoteData aborted: remote has 0 tasks but local has', localTaskCount + localInboxCount);
      return;
    }

    suppressCloudUploadRef.current = true;
    suppressTimestampRef.current = true;

    // Normalize task defaults so localStorage and React state are identical.
    // Without this, stampTaskTimestamps detects spurious differences (e.g.
    // missing notes/subtasks) and re-stamps lastModified, making stale local
    // tasks appear newer than actual remote changes during merge.
    const normalizeTasks = (tasks) => tasks.map(t => ({ ...t, notes: t.notes ?? '', subtasks: t.subtasks ?? [] }));

    // On Android, drop imported calendar events that arrived via cloud sync — the native
    // CalendarBridge already provides those events and syncing them in causes duplicates.
    // Calendar tasks (isTaskCalendar:true) and file imports are kept as normal.
    const filterTasks = isNativeAndroid()
      ? tasks => tasks.filter(t => !(t.imported && !t.isTaskCalendar && t.importSource !== 'file'))
      : tasks => tasks;

    const normalizedTasks = data.tasks ? filterTasks(normalizeTasks(data.tasks)) : null;
    const normalizedUnsched = data.unscheduledTasks ? filterTasks(normalizeTasks(data.unscheduledTasks)) : null;

    // Update localStorage
    if (normalizedTasks) localStorage.setItem('day-planner-tasks', JSON.stringify(normalizedTasks));
    if (normalizedUnsched) localStorage.setItem('day-planner-unscheduled', JSON.stringify(normalizedUnsched));
    if (data.recycleBin) localStorage.setItem('day-planner-recycle-bin', JSON.stringify(data.recycleBin));
    // Calendar URLs: only overwrite if remote provides a non-empty value
    // (prevents a device without URLs from wiping one that has them configured).
    if (data.syncUrl) localStorage.setItem('day-planner-sync-url', data.syncUrl);
    if (data.taskCalendarUrl) localStorage.setItem('day-planner-task-calendar-url', data.taskCalendarUrl);
    // taskCalendarAuth is not applied from sync — credentials are device-local only.
    if (data.completedTaskUids) localStorage.setItem('day-planner-task-completed-uids', JSON.stringify(data.completedTaskUids));
    if (data.recurringTasks) localStorage.setItem('day-planner-recurring-tasks', JSON.stringify(data.recurringTasks));
    if (data.routineDefinitions) localStorage.setItem('day-planner-routine-definitions', JSON.stringify(data.routineDefinitions));
    // Only apply todayRoutines/routinesDate if the remote data is from today.
    // If it's from a previous day, skip it — local state (already cleared by loadData) is correct.
    const todayStr = dateToString(new Date());
    if (data.routinesDate === todayStr) {
      if (data.todayRoutines) localStorage.setItem('day-planner-today-routines', JSON.stringify(data.todayRoutines));
      localStorage.setItem('day-planner-routines-date', data.routinesDate);
      if (data.routineCompletions) localStorage.setItem('day-planner-routine-completions', JSON.stringify(data.routineCompletions));
    }
    // selectedTags and minimizedSections are per-device UI preferences — not synced to state
    if (data.minimizedSections) localStorage.setItem('minimizedSections', JSON.stringify(data.minimizedSections));
    if (data.use24HourClock !== undefined) localStorage.setItem('day-planner-use-24h-clock', JSON.stringify(data.use24HourClock));
    if (data.weatherZip !== undefined) localStorage.setItem('day-planner-weather-zip', data.weatherZip);
    if (data.weatherTempUnit !== undefined) localStorage.setItem('day-planner-weather-temp-unit', data.weatherTempUnit);
    if (data.deletedTaskIds) localStorage.setItem('day-planner-deleted-task-ids', JSON.stringify(data.deletedTaskIds));
    if (data.deletedRoutineChipIds) localStorage.setItem('day-planner-deleted-routine-chip-ids', JSON.stringify(data.deletedRoutineChipIds));
    if (data.deletedFrameIds) localStorage.setItem('day-planner-deleted-frame-ids', JSON.stringify(data.deletedFrameIds));
    if (data.removedTodayRoutineIds) {
      localStorage.setItem('day-planner-removed-today-routine-ids', JSON.stringify(data.removedTodayRoutineIds));
      setRemovedTodayRoutineIds(data.removedTodayRoutineIds);
    }
    if (data.dailyNotes) {
      localStorage.setItem('day-planner-daily-notes', JSON.stringify(data.dailyNotes));
      setDailyNotes(data.dailyNotes);
    }
    if (data.habits) {
      localStorage.setItem('day-planner-habits', JSON.stringify(data.habits));
      setHabits(data.habits);
    }
    if (data.deletedHabitIds) localStorage.setItem('day-planner-deleted-habit-ids', JSON.stringify(data.deletedHabitIds));
    if (data.habitLogs) {
      localStorage.setItem('day-planner-habit-logs', JSON.stringify(data.habitLogs));
      setHabitLogs(data.habitLogs);
    }
    if (data.habitsEnabled !== undefined) {
      localStorage.setItem('day-planner-habits-enabled', JSON.stringify(data.habitsEnabled));
      setHabitsEnabled(data.habitsEnabled);
    }
    if (data.routinesEnabled !== undefined) {
      localStorage.setItem('day-planner-routines-enabled', JSON.stringify(data.routinesEnabled));
      setRoutinesEnabled(data.routinesEnabled);
    }
    if (data.gtdFrames) {
      localStorage.setItem('day-planner-gtd-frames', JSON.stringify(data.gtdFrames));
      setGtdFrames(data.gtdFrames);
    }
    if (data.goals) {
      localStorage.setItem('day-planner-goals', JSON.stringify(data.goals));
      setGoals(data.goals);
    }
    if (data.projects) {
      localStorage.setItem('day-planner-projects', JSON.stringify(data.projects));
      setProjects(data.projects);
    }
    if (data.goalsProjectsEnabled !== undefined) {
      localStorage.setItem('day-planner-goals-projects-enabled', JSON.stringify(data.goalsProjectsEnabled));
      setGoalsProjectsEnabled(data.goalsProjectsEnabled);
    }
    if (data.deletedGoalIds) localStorage.setItem('day-planner-deleted-goal-ids', JSON.stringify(data.deletedGoalIds));
    if (data.deletedProjectIds) localStorage.setItem('day-planner-deleted-project-ids', JSON.stringify(data.deletedProjectIds));
    if (data.obsidianConfig) {
      // On Android, vault path and pattern are managed by native settings — only apply
      // the app-level fields so a desktop value doesn't break the native integration.
      // The startup useEffect always re-seeds path/pattern from native config anyway.
      if (isNativeAndroid()) {
        setObsidianConfig(prev => prev ? {
          ...prev,
          taskHeading: data.obsidianConfig.taskHeading ?? prev.taskHeading,
          dailyNoteTemplate: data.obsidianConfig.dailyNoteTemplate ?? prev.dailyNoteTemplate,
          newNotesFolder: data.obsidianConfig.newNotesFolder ?? prev.newNotesFolder,
        } : prev);
        const existing = JSON.parse(localStorage.getItem('day-planner-obsidian-config') || 'null');
        if (existing) localStorage.setItem('day-planner-obsidian-config', JSON.stringify({
          ...existing,
          taskHeading: data.obsidianConfig.taskHeading ?? existing.taskHeading,
          dailyNoteTemplate: data.obsidianConfig.dailyNoteTemplate ?? existing.dailyNoteTemplate,
          newNotesFolder: data.obsidianConfig.newNotesFolder ?? existing.newNotesFolder,
        }));
      } else {
        localStorage.setItem('day-planner-obsidian-config', JSON.stringify(data.obsidianConfig));
        setObsidianConfig(data.obsidianConfig);
      }
    }
    // darkMode, reminderSettings, and soundEnabled are device-specific — not synced

    // Update React state directly (avoid page reload).
    // Preserve imported events and native tasks from prev that the merge didn't
    // see.  buildSyncPayload() reads the current `tasks` state variable, but a
    // concurrent calendar sync may have queued a setTasks updater that React
    // hasn't rendered yet.  Without this, those queued imported events are
    // silently discarded by the replacement, causing them to vanish until the
    // next calendar sync re-imports them.
    if (normalizedTasks) setTasks(prev => {
      const mergedIds = new Set(normalizedTasks.map(t => String(t.id)));
      return [...normalizedTasks, ...prev.filter(t => !mergedIds.has(String(t.id)) && (t._native || t.imported))];
    });
    if (normalizedUnsched) setUnscheduledTasks(normalizedUnsched);
    if (data.unscheduledOrderTimestamp) {
      setUnscheduledOrderTimestamp(data.unscheduledOrderTimestamp);
      localStorage.setItem('day-planner-unscheduled-order-ts', data.unscheduledOrderTimestamp);
    }
    if (data.recycleBin) setRecycleBin(data.recycleBin);
    if (data.syncUrl) setSyncUrl(data.syncUrl);
    if (data.taskCalendarUrl) setTaskCalendarUrl(data.taskCalendarUrl);
    if (data.completedTaskUids) setCompletedTaskUids(new Set(data.completedTaskUids));
    if (data.recurringTasks) setRecurringTasks(data.recurringTasks);
    if (data.routineDefinitions) setRoutineDefinitions(data.routineDefinitions);
    // Only apply today's routine state if the remote data is from today — matching
    // the localStorage guard above. If routinesDate is stale/off, applying it would
    // trigger the auto-clear effect in useRoutines and wipe todayRoutines to [].
    if (data.routinesDate === dateToString(new Date())) {
      if (data.todayRoutines) setTodayRoutines(data.todayRoutines);
      setRoutinesDate(data.routinesDate);
      if (data.routineCompletions) setRoutineCompletions(data.routineCompletions);
    }
    if (data.use24HourClock !== undefined) setUse24HourClock(data.use24HourClock);
    if (data.weatherZip !== undefined) setWeatherZip(data.weatherZip);
    if (data.weatherTempUnit !== undefined) setWeatherTempUnit(data.weatherTempUnit);

    // Flag for the save effect to clear suppress after the initial (merged-data) save pass.
    // This avoids a fixed 500ms window that could swallow user actions.
    suppressClearPendingRef.current = true;
  };

  const cloudSyncDownload = async () => {
    if (!cloudSyncConfig?.enabled) return;
    const provider = cloudSyncProviders[cloudSyncConfig.provider];
    if (!provider) return;

    if (cloudSyncInProgressRef.current) return;
    cloudSyncInProgressRef.current = true;
    const syncStart = Date.now();
    setCloudSyncStatus('downloading');
    setCloudSyncError(null);
    try {
      const remote = await provider.download(cloudSyncConfig);
      if (!remote) {
        // No remote file yet — do initial upload
        cloudSyncInProgressRef.current = false;
        await cloudSyncUpload();
        return;
      }

      const remoteModified = remote.lastModified;
      const hasNeverSynced = !localStorage.getItem('day-planner-cloud-sync-last-synced');

      if (hasNeverSynced && remoteModified) {
        // First sync on this device — ask user what to do
        // Keep inProgressRef locked so poll timer doesn't re-trigger
        setCloudSyncConflict({ remoteData: remote.data, remoteModified });
        setCloudSyncStatus('idle');
        // Don't release lock — conflict dialog handlers will release it
        return;
      }

      // Build local snapshot and merge with remote at the task level
      const localData = buildSyncPayload().data;
      const { data: mergedData, localChanged, remoteChanged } = mergeSyncData(localData, remote.data, syncRetentionDays);

      if (localChanged) {
        applyRemoteData(mergedData);
        localStorage.setItem('day-planner-cloud-sync-local-modified', new Date().toISOString());
      }

      if (remoteChanged) {
        // Upload merged result so both sides converge.
        // Pass the merged data directly as a pre-built payload — reading from
        // React state via buildSyncPayload() would return stale pre-merge data
        // because applyRemoteData's setState calls haven't been processed yet.
        const mergedPayload = {
          version: 2,
          lastModified: new Date().toISOString(),
          data: mergedData,
        };
        cloudSyncInProgressRef.current = false;
        await cloudSyncUpload(mergedPayload);
        // cloudSyncUpload sets its own success status
        return;
      }

      cloudSyncErrorCountRef.current = 0; // reset error backoff on success
      cloudSyncBackoffUntilRef.current = 0;
      const elapsed = Date.now() - syncStart;
      if (elapsed < 2000) await new Promise(r => setTimeout(r, 2000 - elapsed));
      const now = new Date().toISOString();
      setCloudSyncLastSynced(now);
      localStorage.setItem('day-planner-cloud-sync-last-synced', now);
      setCloudSyncStatus('success');
      setTimeout(() => setCloudSyncStatus((s) => s === 'success' ? 'idle' : s), 3000);
    } catch (err) {
      console.error('Cloud sync download error:', err);
      // If the file's encryption salt doesn't match the cached key and no passphrase
      // is in memory, re-show the passphrase modal so the user can re-enter it.
      if (err.code === 'PASSPHRASE_REQUIRED') {
        setSyncKeyReady(false);
        setCloudSyncStatus('idle');
        return;
      }
      cloudSyncErrorCountRef.current += 1;
      // Exponential backoff: 30s, 60s, 2m, 4m … capped at 15 min
      const backoffMs = Math.min(30 * Math.pow(2, cloudSyncErrorCountRef.current - 1), 15 * 60) * 1000;
      cloudSyncBackoffUntilRef.current = Date.now() + backoffMs;
      const errMsg = err.message === 'FORBIDDEN'
        ? 'Sync blocked (403) — your server may be blocking Vercel\'s IP addresses.'
        : err.message;
      setCloudSyncError(errMsg);
      setCloudSyncStatus('error');
      setTimeout(() => setCloudSyncStatus((s) => s === 'error' ? 'idle' : s), 5000);
    } finally {
      cloudSyncInProgressRef.current = false;
      cloudSyncInitialDoneRef.current = true;
    }
  };

  // Keep ref updated so polling interval and visibilitychange handler always
  // call the latest version (avoids stale closure reading outdated React state).
  cloudSyncDownloadRef.current = cloudSyncDownload;

  const cloudSyncTest = async (config) => {
    const provider = cloudSyncProviders[config.provider];
    if (!provider) return { success: false, error: 'Unknown provider' };
    try {
      return await provider.test(config);
    } catch (err) {
      return { success: false, error: err.message };
    }
  };

  // DeadlinePickerPopover extracted to src/components/DeadlinePickerPopover.jsx

  // Voice input — parse and add callbacks (must be after allTags is defined)
  // Build a text summary of existing tasks for AI context
  const buildTaskContextForAI = useCallback(() => {
    const today = new Date();
    const todayStr = dateToString(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = dateToString(yesterday);
    const lines = [];
    // Scheduled tasks (yesterday + today + future — user may reschedule past tasks)
    const relevant = tasks.filter(t => !t.imported && !t.isExample && t.date >= yesterdayStr).slice(0, 40);
    relevant.forEach(t => {
      let d = `"${t.title}" — ${t.date}`;
      if (t.startTime) d += ` at ${t.startTime}`;
      d += `, ${t.duration || 30}min`;
      if (t.completed) d += ' [COMPLETED]';
      lines.push(d);
    });
    // Inbox tasks (uncompleted)
    unscheduledTasks.filter(t => !t.completed && !t.isExample).slice(0, 20).forEach(t => {
      let d = `"${t.title}" — inbox, ${t.duration || 30}min`;
      if (t.priority > 0) d += `, priority: ${['none', 'low', 'medium', 'high'][t.priority]}`;
      if (t.deadline) d += `, deadline: ${t.deadline}`;
      lines.push(d);
    });
    return lines.length > 0 ? lines.join('\n') : 'No tasks currently.';
  }, [tasks, unscheduledTasks]);
  voiceBuildTaskContextRef.current = buildTaskContextForAI;

  // Resolve an AI-provided taskMatch string to an actual task
  const resolveTaskMatch = useCallback((taskMatch) => {
    const lower = (taskMatch || '').toLowerCase();
    if (!lower) return null;
    // Search scheduled tasks (best match = shortest title containing the match)
    const scheduledMatches = tasks.filter(t => !t.imported && !t.isExample && t.title.toLowerCase().includes(lower));
    if (scheduledMatches.length > 0) {
      const best = scheduledMatches.sort((a, b) => a.title.length - b.title.length)[0];
      return { task: best, source: 'scheduled' };
    }
    // Search inbox tasks
    const inboxMatches = unscheduledTasks.filter(t => !t.isExample && t.title.toLowerCase().includes(lower));
    if (inboxMatches.length > 0) {
      const best = inboxMatches.sort((a, b) => a.title.length - b.title.length)[0];
      return { task: best, source: 'inbox' };
    }
    return null;
  }, [tasks, unscheduledTasks]);
  voiceResolveTaskMatchRef.current = resolveTaskMatch;

  const voiceParseWithAI = useCallback(async () => {
    const text = voiceTranscript.trim();
    if (!text) return;
    const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    if (!aiConfig.enabled || (!aiConfig.apiKey && aiConfig.provider !== 'ollama')) {
      setVoiceParsedTasks([{ title: cap(text), tags: [], date: null, time: null, duration: 30, priority: 0, deadline: null, notes: '' }]);
      setVoiceParsedEdits([]);
      return;
    }
    setVoiceIsParsing(true);
    setVoiceParseError('');
    try {
      const context = {
        todayDate: dateToString(new Date()),
        existingTags: allTags,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        existingTasks: buildTaskContextForAI(),
      };
      const result = await aiJSON(voiceParseSystemPrompt(context), voiceParseUserPrompt(text), aiConfig);

      // Handle both old format (array) and new format ({ newTasks, edits })
      let newTasks = [];
      let edits = [];
      if (Array.isArray(result)) {
        newTasks = result;
      } else if (result && typeof result === 'object') {
        newTasks = Array.isArray(result.newTasks) ? result.newTasks : [];
        edits = Array.isArray(result.edits) ? result.edits : [];
      }

      setVoiceParsedTasks(newTasks.map(t => ({ ...t, title: cap(t.title) })));

      // Resolve each edit command to an actual task
      const resolved = edits.map(edit => {
        const match = resolveTaskMatch(edit.taskMatch);
        return { ...edit, resolvedTask: match?.task || null, source: match?.source || null };
      });
      setVoiceParsedEdits(resolved);
    } catch (err) {
      setVoiceParseError(err.message);
      setVoiceParsedTasks([{ title: cap(text), tags: [], date: null, time: null, duration: 30, priority: 0, deadline: null, notes: '' }]);
      setVoiceParsedEdits([]);
    }
    setVoiceIsParsing(false);
  }, [voiceTranscript, aiConfig, allTags, buildTaskContextForAI, resolveTaskMatch]);

  // Apply all parsed changes (new tasks + edit commands)
  const voiceApplyAllChanges = useCallback(() => {
    const hasNewTasks = voiceParsedTasks && voiceParsedTasks.length > 0;
    const hasEdits = voiceParsedEdits && voiceParsedEdits.length > 0;
    if (!hasNewTasks && !hasEdits) return;
    pushUndo();

    // Add new tasks
    if (hasNewTasks) {
      for (const parsed of voiceParsedTasks) {
        const taskId = crypto.randomUUID();
        const tagStr = (parsed.tags || []).map(t => ` #${t}`).join('');
        const rawTitle = parsed.title + tagStr;
        const title = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);
        if (parsed.date && parsed.time) {
          setTasks(prev => [...prev, { id: taskId, title, startTime: parsed.time, duration: parsed.duration || 30, date: parsed.date, color: colors[0].class, completed: false, isAllDay: false, notes: parsed.notes || '', subtasks: [] }]);
        } else {
          const inboxTask = { id: taskId, title, duration: parsed.duration || 30, color: colors[0].class, completed: false, isAllDay: false, notes: parsed.notes || '', subtasks: [], priority: parsed.priority || 0 };
          if (parsed.deadline) inboxTask.deadline = parsed.deadline;
          if (parsed.date && !parsed.time) {
            setTasks(prev => [...prev, { ...inboxTask, startTime: '09:00', date: parsed.date }]);
          } else {
            setUnscheduledTasks(prev => [...prev, inboxTask]);
          }
        }
      }
    }

    // Apply edit commands
    if (hasEdits) {
      for (const edit of voiceParsedEdits) {
        if (!edit.resolvedTask) continue; // skip unresolved
        const id = edit.resolvedTask.id;
        const isInbox = edit.source === 'inbox';

        switch (edit.action) {
          case 'move': {
            if (isInbox && edit.date) {
              // Move from inbox to scheduled
              setUnscheduledTasks(prev => prev.filter(t => t.id !== id));
              const movedTask = { ...edit.resolvedTask, date: edit.date, startTime: edit.time || '09:00' };
              delete movedTask.priority; delete movedTask.deadline;
              setTasks(prev => [...prev, movedTask]);
            } else if (!isInbox) {
              setTasks(prev => prev.map(t => t.id === id ? {
                ...t,
                ...(edit.date != null ? { date: edit.date } : {}),
                ...(edit.time != null ? { startTime: edit.time } : {}),
              } : t));
            }
            break;
          }
          case 'changeDuration': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => t.id === id ? { ...t, duration: edit.duration } : t));
            break;
          }
          case 'rename': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => t.id === id ? { ...t, title: edit.newTitle } : t));
            break;
          }
          case 'delete': {
            moveToRecycleBin(id, isInbox);
            break;
          }
          case 'complete': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => t.id === id ? { ...t, completed: true, lastModified: new Date().toISOString() } : t));
            break;
          }
          case 'uncomplete': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => t.id === id ? { ...t, completed: false, lastModified: new Date().toISOString() } : t));
            break;
          }
          case 'changePriority': {
            if (isInbox) {
              setUnscheduledTasks(prev => prev.map(t => t.id === id ? { ...t, priority: edit.priority } : t));
            }
            break;
          }
          case 'addTag': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => {
              if (t.id !== id) return t;
              const existing = (t.title.match(/#(\p{L}[\p{L}\p{N}_]*)/gu) || []).map(s => s.slice(1).toLowerCase());
              if (existing.includes(edit.tag.toLowerCase())) return t;
              return { ...t, title: t.title + ` #${edit.tag}` };
            }));
            break;
          }
          case 'removeTag': {
            const setter = isInbox ? setUnscheduledTasks : setTasks;
            setter(prev => prev.map(t => {
              if (t.id !== id) return t;
              return { ...t, title: t.title.replace(new RegExp(`\\s*#${edit.tag}\\b`, 'gi'), '') };
            }));
            break;
          }
        }
      }
    }

    setShowVoiceInput(false);
  }, [voiceParsedTasks, voiceParsedEdits]);

  // --- Morning dayGLANCE (AI morning summary) ---
  const generateMorningSummary = useCallback(async () => {
    if (!aiConfig.enabled || (!aiConfig.apiKey && aiConfig.provider !== 'ollama') || !aiConfig.features.morningSummary) return;
    const todayStr = dateToString(new Date());
    // Check cache
    try {
      const cached = localStorage.getItem('day-planner-morning-glance');
      if (cached) {
        const { date, text } = JSON.parse(cached);
        if (date === todayStr) { setMorningGlanceText(text); return; }
      }
    } catch {}

    setMorningGlanceLoading(true);
    setMorningGlanceError('');
    try {
      const todayDate = new Date();
      const dayOfWeek = todayDate.toLocaleDateString('en-US', { weekday: 'long' });

      // Gather today's scheduled tasks
      const scheduledToday = tasks.filter(t => t.date === todayStr && !t.imported && !t.isExample);
      // Gather imported calendar events for today
      const calendarEventsToday = tasks.filter(t => t.date === todayStr && t.imported && !t.isTaskCalendar)
        .map(t => ({ title: t.title, time: t.startTime, isAllDay: t.isAllDay || false, duration: t.duration || 0 }))
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      // Gather today's recurring tasks
      const todayRecurring = recurringTasks.flatMap(t => {
        const occs = getOccurrencesInRange(t, todayStr, todayStr);
        return occs.map(() => ({ title: t.title, time: t.startTime, completed: (t.completedDates || []).includes(todayStr) }));
      }).filter(t => !t.completed);
      // Inbox count — split into free inbox tasks vs project-assigned tasks
      const activeUnscheduled = unscheduledTasks.filter(t => !t.completed && !t.isExample);
      const inboxCount = activeUnscheduled.filter(t => !goalsProjectsEnabled || !t.projectId).length;
      const projectTaskCount = goalsProjectsEnabled ? activeUnscheduled.filter(t => t.projectId).length : 0;
      // Overdue tasks
      const overdue = getOverdueTasks();
      const overdueTasks = overdue.filter(t => t.date !== todayStr).slice(0, 5);
      // Deadlines
      const deadlinesToday = unscheduledTasks.filter(t => t.deadline === todayStr && !t.completed);
      const nextWeek = new Date(todayDate);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = dateToString(nextWeek);
      const upcomingDeadlines = unscheduledTasks.filter(t => t.deadline && t.deadline > todayStr && t.deadline <= nextWeekStr && !t.completed).slice(0, 5);
      // Total minutes
      const totalMinutes = scheduledToday.reduce((s, t) => s + (t.duration || 0), 0)
        + todayRecurring.reduce((s, t) => s + 30, 0) // recurring default 30
        + calendarEventsToday.reduce((s, t) => s + (t.isAllDay ? 0 : t.duration), 0);

      const data = {
        todayDate: todayStr,
        dayOfWeek,
        scheduledTasks: scheduledToday.map(t => ({ title: t.title, time: t.startTime, priority: t.priority || 0 })),
        recurringTasks: todayRecurring.map(t => ({ title: t.title, time: t.time })),
        calendarEvents: calendarEventsToday,
        inboxCount,
        projectTaskCount,
        overdueTasks: overdueTasks.map(t => ({ title: t.title })),
        deadlinesToday: deadlinesToday.map(t => ({ title: t.title })),
        upcomingDeadlines: upcomingDeadlines.map(t => ({ title: t.title, deadline: t.deadline })),
        totalMinutes,
      };

      const text = await aiComplete(morningSummarySystemPrompt(), morningSummaryUserPrompt(data), aiConfig);
      const cleaned = text.trim();
      setMorningGlanceText(cleaned);
      localStorage.setItem('day-planner-morning-glance', JSON.stringify({ date: todayStr, text: cleaned }));
    } catch (err) {
      setMorningGlanceError(err.message);
    }
    setMorningGlanceLoading(false);
  }, [aiConfig, tasks, recurringTasks, unscheduledTasks]);

  const dismissMorningGlance = useCallback(() => {
    setMorningGlanceDismissed(true);
    localStorage.setItem('day-planner-mg-dismissed', localDateStr());
  }, []);

  // Reset morning briefing state on day rollover (tab regains focus the next day).
  // We no longer auto-generate — the user clicks "see your daily briefing" to trigger it.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !aiConfig.enabled || !aiConfig.features.morningSummary) return;
      const todayStr = dateToString(new Date());
      // Already have today's briefing cached?
      try {
        const cached = localStorage.getItem('day-planner-morning-glance');
        if (cached && JSON.parse(cached).date === todayStr) return;
      } catch {}
      // Dismissed today?
      if (localStorage.getItem('day-planner-mg-dismissed') === todayStr) return;
      // New day — reset state so click prompt appears
      setMorningGlanceDismissed(false);
      setMorningGlanceText(null);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [aiConfig.enabled, aiConfig.features.morningSummary]);

  // --- Evening Reflection ---
  const generateEveningReflection = useCallback(async () => {
    if (!aiConfig.enabled || (!aiConfig.apiKey && aiConfig.provider !== 'ollama') || !aiConfig.features.eveningReflection) return;
    const todayStr = dateToString(new Date());
    try {
      const cached = localStorage.getItem('day-planner-evening-glance');
      if (cached) {
        const { date, text } = JSON.parse(cached);
        if (date === todayStr) { setEveningGlanceText(text); return; }
      }
    } catch {}

    setEveningGlanceLoading(true);
    setEveningGlanceError('');
    try {
      const todayDate = new Date();
      const dayOfWeek = todayDate.toLocaleDateString('en-US', { weekday: 'long' });
      const tomorrow = new Date(todayDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = dateToString(tomorrow);

      const completedToday = tasks.filter(t => t.date === todayStr && t.completed && !t.imported && !t.isExample);
      const incompleteToday = tasks.filter(t => t.date === todayStr && !t.completed && !t.imported && !t.isExample);
      const tomorrowTasks = tasks.filter(t => t.date === tomorrowStr && !t.imported && !t.isExample);
      const tomorrowCalendarEvents = tasks.filter(t => t.date === tomorrowStr && t.imported && !t.isTaskCalendar)
        .map(t => ({ title: t.title, time: t.startTime, isAllDay: t.isAllDay || false }))
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      // For suggestions, only surface free inbox tasks — project tasks have their own home
      const inboxItems = unscheduledTasks.filter(t => !t.completed && !t.isExample && (!goalsProjectsEnabled || !t.projectId))
        .sort((a, b) => (b.priority || 0) - (a.priority || 0));

      const total = completedToday.length + incompleteToday.length;
      const completionRate = total > 0 ? Math.round((completedToday.length / total) * 100) : 0;

      const data = {
        todayDate: todayStr,
        dayOfWeek,
        completedTasks: completedToday.map(t => ({ title: t.title, priority: t.priority || 0 })),
        incompleteTasks: incompleteToday.map(t => ({ title: t.title, priority: t.priority || 0 })),
        completionRate,
        tomorrowTasks: tomorrowTasks.map(t => ({ title: t.title, time: t.startTime })),
        tomorrowCalendarEvents,
        inboxSuggestions: inboxItems.slice(0, 3).map(t => ({ title: t.title, priority: t.priority || 0 })),
      };

      const text = await aiComplete(eveningReflectionSystemPrompt(), eveningReflectionUserPrompt(data), aiConfig);
      const cleaned = text.trim();
      setEveningGlanceText(cleaned);
      localStorage.setItem('day-planner-evening-glance', JSON.stringify({ date: todayStr, text: cleaned }));
    } catch (err) {
      setEveningGlanceError(err.message);
    }
    setEveningGlanceLoading(false);
  }, [aiConfig, tasks, unscheduledTasks]);

  const dismissEveningGlance = useCallback(() => {
    setEveningGlanceDismissed(true);
    localStorage.setItem('day-planner-eg-dismissed', localDateStr());
  }, []);

  // Reset evening reflection on day rollover
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !aiConfig.enabled || !aiConfig.features.eveningReflection) return;
      const todayStr = dateToString(new Date());
      try {
        const cached = localStorage.getItem('day-planner-evening-glance');
        if (cached && JSON.parse(cached).date === todayStr) return;
      } catch {}
      if (localStorage.getItem('day-planner-eg-dismissed') === todayStr) return;
      setEveningGlanceDismissed(false);
      setEveningGlanceText(null);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [aiConfig.enabled, aiConfig.features.eveningReflection]);

  // --- AI Task Suggestion (duration + tags debounce) ---
  useEffect(() => {
    // Clear suggestion when form closes or when editing an existing task
    if (!showAddTask || mobileEditingTask) {
      setTaskAISuggestion(null);
      setTaskAISuggestionLoading(false);
      return;
    }
    // Strip inline tags/shorthands so we query the clean title words
    const cleanedTitle = newTask.title.replace(/#\w+|@\S+|~\S+|%\d+|\^\S*/g, '').trim();
    if (
      cleanedTitle.length < 3 ||
      !aiConfig.enabled ||
      !aiConfig.features?.durationEstimate ||
      (!aiConfig.apiKey && aiConfig.provider !== 'ollama')
    ) {
      setTaskAISuggestion(null);
      return;
    }
    setTaskAISuggestionLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await aiJSON(
          taskSuggestSystemPrompt(),
          taskSuggestUserPrompt({ title: cleanedTitle, existingTags: allTags }),
          aiConfig
        );
        if (result && typeof result.duration === 'number') {
          setTaskAISuggestion(result);
        }
      } catch {}
      setTaskAISuggestionLoading(false);
    }, 650);
    return () => { clearTimeout(timer); setTaskAISuggestionLoading(false); };
  }, [newTask.title, showAddTask, mobileEditingTask, aiConfig, allTags]);

  // --- Weekly AI Summary (enhanced weekly review) ---
  const generateWeeklyAISummary = useCallback(async (stats) => {
    if (!aiConfig.enabled || (!aiConfig.apiKey && aiConfig.provider !== 'ollama') || !aiConfig.features.weeklySummary) return;
    setWeeklyAILoading(true);
    setWeeklyAIError('');
    try {
      const text = await aiComplete(weeklySummarySystemPrompt(), weeklySummaryUserPrompt(stats), aiConfig);
      setWeeklyAISummary(text.trim());
    } catch (err) {
      setWeeklyAIError(err.message);
    }
    setWeeklyAILoading(false);
  }, [aiConfig]);

  // Voice input keyboard shortcuts (SPACE to hold-record, T for typing, ENTER to parse/accept)
  const voiceHasTranscription = aiConfig.enabled && supportsTranscription(aiConfig);
  useEffect(() => {
    if (!showVoiceInput) return;

    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

    const handleKeyDown = (e) => {
      const tag = e.target.tagName;
      const isTextInput = tag === 'TEXTAREA' || tag === 'INPUT' || e.target.isContentEditable;

      // ENTER in textarea → parse with AI
      if (e.key === 'Enter' && tag === 'TEXTAREA' && !e.isComposing) {
        e.preventDefault();
        voiceParseWithAI();
        return;
      }

      if (isTextInput) return;

      // SPACE hold-to-record (desktop only, not on parsed/transcribing screen)
      if (e.key === ' ' && !isTouchDevice && !voiceParsedTasks && !voiceManualMode && !voiceIsTranscribing && voiceCanRecord && voiceHasTranscription) {
        e.preventDefault();
        if (!voiceIsRecording && !e.repeat) {
          voiceStartRecording();
        }
        return;
      }

      // T to switch to typing mode (only on voice recording screen)
      if ((e.key === 't' || e.key === 'T') && !voiceParsedTasks && !voiceManualMode && !voiceIsRecording && !voiceIsTranscribing) {
        e.preventDefault();
        setVoiceManualMode(true);
        return;
      }

      // ENTER to accept parsed tasks/edits
      if (e.key === 'Enter' && (voiceParsedTasks || voiceParsedEdits) && voiceEditingParsed === null) {
        e.preventDefault();
        voiceApplyAllChanges();
        return;
      }
    };

    const handleKeyUp = (e) => {
      if (e.key === ' ' && !isTouchDevice && voiceIsRecording) {
        e.preventDefault();
        voiceStopRecording();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [showVoiceInput, voiceIsRecording, voiceIsTranscribing, voiceParsedTasks, voiceParsedEdits, voiceManualMode, voiceCanRecord, voiceHasTranscription, voiceEditingParsed, voiceStartRecording, voiceStopRecording, voiceParseWithAI, voiceApplyAllChanges]);

  // Getting Started checklist - uses persistent progress tracking
  const gettingStartedItems = useMemo(() => {
    return [
      { id: 'inbox', label: 'Add your first inbox task', completed: onboardingProgress.hasAddedInboxTask },
      { id: 'scheduled', label: 'Add your first scheduled task', completed: onboardingProgress.hasAddedScheduledTask },
      { id: 'drag', label: isMobile ? 'Schedule a task from inbox' : 'Drag a task to the timeline', completed: onboardingProgress.hasDraggedToTimeline },
      { id: 'priority', label: 'Set a priority or deadline', completed: onboardingProgress.hasSetPriority || onboardingProgress.hasAddedDeadline },
      { id: 'notes', label: 'Add notes or subtasks to a task', completed: onboardingProgress.hasAddedNotes },
      { id: 'tags', label: 'Use #tags in a task title', completed: onboardingProgress.hasUsedTags },
      { id: 'recurring', label: 'Create a recurring task', completed: onboardingProgress.hasCreatedRecurring },
      { id: 'focus', label: 'Try Focus Mode', completed: onboardingProgress.hasUsedFocusMode },
      { id: 'sync', label: 'Set up calendar sync', completed: onboardingProgress.hasSetupSync },
      { id: 'optional', label: 'Enable routines, habits, or AI', completed: onboardingProgress.hasEnabledOptionalFeature },
    ];
  }, [onboardingProgress, isMobile]);

  const allGettingStartedComplete = gettingStartedItems.every(item => item.completed);
  const gettingStartedCompleteCount = gettingStartedItems.filter(item => item.completed).length;


  // Check if user has zero real tasks (for showing onboarding)
  const hasZeroRealTasks = useMemo(() => {
    const realScheduledTasks = tasks.filter(t => !t.isExample && !t.imported);
    const realInboxTasks = unscheduledTasks.filter(t => !t.isExample);
    return realScheduledTasks.length === 0 && realInboxTasks.length === 0 && recurringTasks.filter(t => !t.isExample).length === 0;
  }, [tasks, unscheduledTasks, recurringTasks]);

  // Show onboarding when user has zero real tasks (and data is loaded, to prevent flash)
  const showOnboarding = dataLoaded && !onboardingComplete && hasZeroRealTasks;
  // Getting Started checklist — show until dismissed or all items complete
  const showGettingStarted = dataLoaded && !gettingStartedDismissed && !allGettingStartedComplete;

  useAppInit({
    loadData, fetchAllDailyContent, setContentRotation,
    dailyContentEnabled,
    dataLoaded, hasZeroRealTasks,
    hasCheckedInitialWelcome,
    showWelcome, setShowWelcome,
  });

  // Compute array of visible dates based on selectedDate and visibleDays
  const visibleDates = useMemo(() => {
    return Array.from({ length: visibleDays }, (_, i) => {
      const date = new Date(selectedDate);
      date.setDate(date.getDate() + i);
      return date;
    });
  }, [selectedDate, visibleDays]);

  // Columns for DayView — three 8-hour windows.
  // 'calendar-day': fixed 00-08 / 08-16 / 16-24 for selectedDate.
  // 'rolling-24': leftmost column is the current 8-hour block; columns that
  // cross midnight carry the next calendar day's date.
  const dayViewColumns = useMemo(() => {
    const base = new Date(selectedDate);
    base.setHours(0, 0, 0, 0);
    const nextDay = new Date(base);
    nextDay.setDate(nextDay.getDate() + 1);
    const baseStr = dateToString(base);
    const nextStr = dateToString(nextDay);

    // rolling-24 only makes sense when viewing today; fall back to calendar-day for other dates
    const isViewingToday = baseStr === dateToString(new Date());
    if (dayViewMode === 'rolling-24' && isViewingToday) {
      const blockStart = Math.floor(currentTime.getHours() / 8) * 8;
      return [0, 1, 2].map(i => {
        const absStart = blockStart + i * 8;
        const crossesMidnight = absStart >= 24;
        const startHour = absStart % 24;
        const endHour = startHour + 8;
        const date = crossesMidnight ? nextDay : base;
        const dateStr = crossesMidnight ? nextStr : baseStr;
        return { startHour, endHour, date, dateStr };
      });
    }
    // calendar-day (default)
    return [
      { startHour: 0,  endHour: 8,  date: base, dateStr: baseStr },
      { startHour: 8,  endHour: 16, date: base, dateStr: baseStr },
      { startHour: 16, endHour: 24, date: base, dateStr: baseStr },
    ];
  }, [selectedDate, dayViewMode, currentTime]);

  // Seven dates for week view — strict (calendar week) or rolling (today + 6 days).
  // Empty array when not in week mode so it doesn't affect other views.
  const weekViewDates = useMemo(() => {
    if (effectiveViewMode !== 'week') return [];
    const base = new Date(selectedDate);
    base.setHours(0, 0, 0, 0);
    const todayStr = dateToString(new Date());
    const isViewingToday = dateToString(base) === todayStr;

    if (weekViewMode === 'rolling' && isViewingToday) {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(base);
        d.setDate(d.getDate() + i);
        return d;
      });
    }

    // Strict: week containing selectedDate, starting on weekStartDay
    const dayOfWeek = base.getDay();
    const diff = (dayOfWeek - weekStartDay + 7) % 7;
    const weekStart = new Date(base);
    weekStart.setDate(weekStart.getDate() - diff);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [effectiveViewMode, selectedDate, weekViewMode, weekStartDay]);

  // Auto-select new tags when they appear (only truly new tags, not previously deselected ones)
  const prevAllTagsRef = useRef(new Set(allTags));
  useEffect(() => {
    const prevTags = prevAllTagsRef.current;
    const brandNewTags = allTags.filter(tag => !prevTags.has(tag));
    if (brandNewTags.length > 0) {
      setSelectedTags(prev => [...prev, ...brandNewTags.filter(t => !prev.includes(t))]);
    }
    prevAllTagsRef.current = new Set(allTags);
  }, [allTags]);

  // Expand recurring task templates into virtual task instances for visible dates.
  // In week view, expand over the full week range (which may extend beyond visibleDates).
  const expandedRecurringTasks = useMemo(() => {
    if (recurringTasks.length === 0) return [];
    const allDateStrs = [...visibleDates, ...weekViewDates].map(d => dateToString(d)).sort();
    const rangeStart = allDateStrs[0];
    const rangeEnd = allDateStrs[allDateStrs.length - 1];
    const today = getTodayStr();
    const instances = [];
    for (const template of recurringTasks) {
      const occurrences = getOccurrencesInRange(template, rangeStart, rangeEnd);
      for (const dateStr of occurrences) {
        const completed = (template.completedDates || []).includes(dateStr);
        const exception = template.exceptions?.[dateStr];
        // Don't show past uncompleted recurring instances (except all-day — those surface as overdue)
        if (dateStr < today && !completed && !(exception?.isAllDay ?? template.isAllDay)) continue;
        instances.push({
          id: `recurring-${template.id}-${dateStr}`,
          title: exception?.title ?? template.title,
          startTime: exception?.startTime ?? template.startTime,
          duration: exception?.duration ?? template.duration,
          color: exception?.color ?? template.color,
          completed,
          isAllDay: exception?.isAllDay ?? template.isAllDay ?? false,
          notes: template.notes || '',
          subtasks: template.subtasks || [],
          date: dateStr,
          isRecurring: true,
          recurringTemplateId: template.id,
          recurrenceType: template.recurrence?.type,
          ...(template.isExample ? { isExample: true } : {}),
        });
      }
    }
    return instances;
  }, [recurringTasks, visibleDates, weekViewDates]);
  expandedRecurringTasksRef.current = expandedRecurringTasks;

  // Build today's non-overdue HG sessions for the reminder engine.
  // Only sessions with an explicit scheduled time are included (skips time-unset sessions).
  const hgSessionsForReminders = React.useMemo(() => {
    if (!goalsProjectsEnabled) return [];
    const todayStr = dateToString(new Date());
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return getGlanceHGInstances(projects, nowMin)
      .filter(({ instance }) => !instance.isOverdue && instance.date === todayStr)
      .flatMap(({ project, instance }) => {
        const hg = project.hyperglance;
        const effectiveTime = hg.scheduledTimeOverrides?.[instance.date] || hg.scheduledTime || '';
        if (!effectiveTime || effectiveTime === '0:0') return [];
        const [startH, startM] = effectiveTime.split(':').map(Number);
        if (!Number.isFinite(startH) || !Number.isFinite(startM)) return [];
        const allProjectTasks = [...tasks, ...unscheduledTasks];
        const alreadyInstantiated = allProjectTasks.some(
          t => t.projectId === project.id && t.hyperglanceSessionDate === instance.date
        );
        const taskCount = allProjectTasks.filter(
          t => t.projectId === project.id && !t.archived && !t.completed
        ).length + (alreadyInstantiated ? 0 : (hg.templateTasks?.length || 0));
        return [{ id: project.id, title: project.title, date: instance.date, startMinutes: startH * 60 + startM, taskCount }];
      });
  }, [projects, goalsProjectsEnabled, tasks, unscheduledTasks]);

  const {
    activeReminders, setActiveReminders,
    snoozeReminder,
    dismissReminder,
    dismissAllReminders,
  } = useReminderEngine({
    currentTime,
    reminderSettings,
    tasks,
    expandedRecurringTasks,
    hgSessions: hgSessionsForReminders,
    playUISound,
    pushUndo,
    setTasks,
    setRecurringTasks,
    parseRecurringId,
    setShowWeeklyReviewReminder,
    weeklyReviewDismissedRef,
    lastWeeklyReviewFiredRef,
  });

  // Native Android: pick up pending actions (e.g. Mark Complete) from notification buttons.
  // The native side stores the action in SharedPreferences; we read it here via getPendingAction()
  // whenever the app comes back to the foreground (visibilitychange) or on first mount.
  useEffect(() => {
    if (!isNativeAndroid()) return;
    const checkPending = () => {
      const pending = nativeGetPendingAction();
      if (!pending) return;
      if (pending.action === 'voice_input') {
        voiceAutoStartRef.current = true;
        setShowVoiceInput(true);
      } else if (pending.action === 'add_task') {
        setShowAddTask(true);
      } else if (pending.action === 'add_inbox_task') {
        openNewInboxTask();
      } else if (pending.action === 'share' && pending.text) {
        const { title: shareTitle, notes: shareNotes } = extractShareTitle(pending.text);
        setNewTask({
          title: shareTitle,
          notes: shareNotes || undefined,
          startTime: getNextQuarterHour(),
          duration: 30,
          date: dateToString(selectedDate),
          isAllDay: false,
          openInInbox: true,
          deadline: null,
          priority: 0
        });
        setShowAddTask(true);
      } else if (pending.action === 'complete' && pending.taskId) {
        toggleComplete(pending.taskId);
      } else if (pending.action === 'snooze' && pending.taskId) {
        // Shift the task's start time forward by the snooze duration (default 15 min)
        const snoozeMin = pending.minutes || 15;
        const parsed = parseRecurringId(pending.taskId);
        if (parsed) {
          setRecurringTasks(prev => prev.map(t => {
            if (t.id !== parsed.templateId) return t;
            const exceptions = { ...(t.exceptions || {}) };
            const baseStart = (exceptions[parsed.dateStr] || t).startTime || '0:00';
            const newStart = minutesToTime(Math.min(timeToMinutes(baseStart) + snoozeMin, 23 * 60 + 45));
            exceptions[parsed.dateStr] = { ...(exceptions[parsed.dateStr] || {}), startTime: newStart };
            return { ...t, exceptions };
          }));
        } else {
          setTasks(prev => prev.map(t => {
            if (String(t.id) !== String(pending.taskId)) return t;
            const newStart = minutesToTime(Math.min(timeToMinutes(t.startTime || '0:00') + snoozeMin, 23 * 60 + 45));
            return { ...t, startTime: newStart };
          }));
        }
      }
    };
    const onVisibility = () => { if (document.visibilityState === 'visible') checkPending(); };
    document.addEventListener('visibilitychange', onVisibility);
    checkPending(); // also check immediately on mount
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Spotlight search results
  const spotlightResults = useMemo(() => {
    if (!showSpotlight || !spotlightQuery.trim()) return [];
    const q = spotlightQuery.trim().toLowerCase();
    const results = [];
    const now = new Date();
    const cutoff = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
    const cutoffStr = dateToString(cutoff);

    const matchTask = (task, source, sourceLabel, date) => {
      // Skip scheduled tasks older than 2 years
      if (date && date < cutoffStr) return;
      // Check title
      if (task.title.toLowerCase().includes(q)) {
        results.push({ task, source, sourceLabel, match: { field: 'title', text: task.title }, date });
        return;
      }
      // Check tags
      const tags = extractTags(task.title);
      const matchedTag = tags.find(t => t.toLowerCase().includes(q));
      if (matchedTag) {
        results.push({ task, source, sourceLabel, match: { field: 'tag', text: '#' + matchedTag }, date });
        return;
      }
      // Check notes
      if (task.notes && task.notes.toLowerCase().includes(q)) {
        results.push({ task, source, sourceLabel, match: { field: 'notes', text: task.notes }, date });
        return;
      }
      // Check subtasks
      const matchedSub = (task.subtasks || []).find(s => s.title.toLowerCase().includes(q));
      if (matchedSub) {
        results.push({ task, source, sourceLabel, match: { field: 'subtask', text: matchedSub.title }, date });
      }
    };

    // Scheduled tasks
    for (const task of tasks) {
      matchTask(task, 'scheduled', 'Scheduled', task.date);
    }
    // Inbox tasks (archived get their own source/label)
    for (const task of unscheduledTasks) {
      if (task.archived) {
        matchTask(task, 'archived', 'Completed', task.deadline || null);
      } else {
        matchTask(task, 'inbox', 'Inbox', task.deadline || null);
      }
    }
    // Recurring templates
    for (const template of recurringTasks) {
      matchTask(template, 'recurring', 'Recurring', template.startDate || null);
    }
    // Recycle bin
    for (const task of recycleBin) {
      matchTask(task, 'deleted', 'Deleted', task.date || null);
    }

    // Assign a time-based group to each result
    const todayStr = dateToString(now);
    const weekEndDate = new Date(now);
    weekEndDate.setDate(weekEndDate.getDate() + 7);
    const weekEndStr = dateToString(weekEndDate);
    const groupOrder = { today: 0, thisweek: 1, future: 2, nodate: 3, past: 4, deleted: 5, archived: 6 };
    const getGroup = (r) => {
      if (r.source === 'deleted') return 'deleted';
      if (r.source === 'archived') return 'archived';
      const d = r.date;
      if (!d) return 'nodate';
      if (d < todayStr) return 'past';
      if (d === todayStr) return 'today';
      if (d <= weekEndStr) return 'thisweek';
      return 'future';
    };
    results.forEach(r => { r.group = getGroup(r); });

    // Sort: by group, then title match, then source priority, then date
    const sourcePriority = { scheduled: 0, inbox: 1, recurring: 2, deleted: 3, archived: 4 };
    results.sort((a, b) => {
      const gA = groupOrder[a.group] ?? 6;
      const gB = groupOrder[b.group] ?? 6;
      if (gA !== gB) return gA - gB;
      const aTitle = a.match.field === 'title' ? 0 : 1;
      const bTitle = b.match.field === 'title' ? 0 : 1;
      if (aTitle !== bTitle) return aTitle - bTitle;
      const aPri = sourcePriority[a.source] ?? 4;
      const bPri = sourcePriority[b.source] ?? 4;
      if (aPri !== bPri) return aPri - bPri;
      // Past: most recent first; everything else: soonest first
      if (a.group === 'past') return (b.date || '').localeCompare(a.date || '');
      return (a.date || '').localeCompare(b.date || '');
    });

    return results.slice(0, 50);
  }, [showSpotlight, spotlightQuery, tasks, unscheduledTasks, recurringTasks, recycleBin]);

  // Compute today's agenda for dayGLANCE section (excludes past events)
  const todayAgenda = useMemo(() => {
    const today = getTodayStr();
    const nowMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();

    // Include recurring instances for today
    const todayRecurring = expandedRecurringTasks.filter(t => t.date === today);
    const allTodayTasks = [...tasks, ...todayRecurring];

    const allDay = allTodayTasks.filter(t => t.date === today && t.isAllDay && !t.completed);
    const deadlines = unscheduledTasks.filter(t => t.deadline === today && t.deadline >= today && !t.completed);
    const scheduled = allTodayTasks.filter(t => {
      if (t.date !== today || t.isAllDay) return false;
      const [h, m] = (t.startTime || '0:0').split(':').map(Number);
      const endMinutes = h * 60 + m + (t.duration || 0);
      // Past: hide completed tasks and imported calendar events; keep incomplete user/task-calendar tasks
      if (endMinutes <= nowMinutes) return !t.completed && !(t.imported && !t.isTaskCalendar);
      return true;
    }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

    return [
      ...deadlines.map(t => ({ ...t, _agendaType: 'deadline' })),
      ...allDay.map(t => ({ ...t, _agendaType: 'allday' })),
      ...scheduled.map(t => ({ ...t, _agendaType: 'scheduled' })),
    ].filter(t => !t.isExample);
  }, [tasks, unscheduledTasks, currentTime, expandedRecurringTasks]);

  // Compute "now" marker position and inbox gap nudge for DayGlance agenda
  const agendaNowMarker = useMemo(() => {
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const nowH = String(currentTime.getHours()).padStart(2, '0');
    const nowM = String(currentTime.getMinutes()).padStart(2, '0');
    const nowTimeStr = `${nowH}:${nowM}`;
    // Only consider scheduled (timed) tasks, sorted by start time
    const scheduled = todayAgenda.filter(t => t._agendaType === 'scheduled');
    // Find where "now" falls among scheduled tasks
    // insertAfterIndex: index in todayAgenda after which to insert the marker (-1 = before all)
    let insertAfterIndex = -1;
    let insideTask = false;
    if (scheduled.length > 0) {
      for (let i = 0; i < todayAgenda.length; i++) {
        const t = todayAgenda[i];
        if (t._agendaType !== 'scheduled') continue;
        const [h, m] = (t.startTime || '0:0').split(':').map(Number);
        const endMin = h * 60 + m + (t.duration || 0);
        if (nowMin >= endMin) {
          insertAfterIndex = i;
        } else if (nowMin >= h * 60 + m) {
          // Currently within this task — place marker before it (it shows "In Progress")
          insertAfterIndex = i - 1;
          insideTask = true;
          break;
        } else {
          break;
        }
      }
    }
    // Ensure the now-marker never appears above all-day or deadline tasks
    const lastNonScheduledIdx = todayAgenda.reduce((acc, t, i) => t._agendaType !== 'scheduled' ? i : acc, -1);
    if (insertAfterIndex < lastNonScheduledIdx) {
      insertAfterIndex = lastNonScheduledIdx;
    }
    // If no scheduled tasks, place marker after all items
    if (scheduled.length === 0) {
      insertAfterIndex = todayAgenda.length - 1;
    }
    // Calculate gap to next scheduled task
    let gapMinutes = 0;
    const nextScheduledIdx = todayAgenda.findIndex((t, i) => i > insertAfterIndex && t._agendaType === 'scheduled');
    if (nextScheduledIdx !== -1) {
      const next = todayAgenda[nextScheduledIdx];
      const [nh, nm] = (next.startTime || '0:0').split(':').map(Number);
      gapMinutes = (nh * 60 + nm) - nowMin;
    } else {
      // No more scheduled tasks — gap is rest of day (cap at a large number)
      gapMinutes = 24 * 60 - nowMin;
    }
    const incompleteInbox = unscheduledTasks.filter(t => !t.completed && !t.isExample);
    const showNudge = gapMinutes >= 60 && incompleteInbox.length > 0;
    return { insertAfterIndex, nowTimeStr, showNudge, inboxCount: incompleteInbox.length, gapMinutes, insideTask };
  }, [todayAgenda, currentTime, unscheduledTasks]);

  // GLANCEahead: compute tomorrow's preview data
  const glanceAhead = useMemo(() => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = dateToString(tomorrow);

    // Gather tomorrow's tasks (regular + recurring)
    const regularTasks = tasks.filter(t => t.date === tomorrowStr && !t.completed && !t.isExample);
    // Expand recurring tasks for tomorrow
    const recurringInstances = recurringTasks.flatMap(template => {
      const occs = getOccurrencesInRange(template, tomorrowStr, tomorrowStr);
      return occs.map(dateStr => {
        const completed = (template.completedDates || []).includes(dateStr);
        if (completed) return null;
        const exception = template.exceptions?.[dateStr];
        if (exception?.deleted) return null;
        return {
          id: `recurring-${template.id}-${dateStr}`,
          title: exception?.title ?? template.title,
          startTime: exception?.startTime ?? template.startTime,
          duration: exception?.duration ?? template.duration,
          color: exception?.color ?? template.color,
          isAllDay: exception?.isAllDay ?? template.isAllDay ?? false,
          imported: false,
          date: dateStr,
        };
      }).filter(Boolean);
    });
    const allTasks = [...regularTasks, ...recurringInstances];
    const userTasks = allTasks.filter(t => !t.imported || t.isTaskCalendar);
    const calendarEvents = allTasks.filter(t => t.imported && !t.isTaskCalendar);
    const deadlines = unscheduledTasks.filter(t => t.deadline === tomorrowStr && !t.completed && !t.isExample);
    const scheduledItems = allTasks.filter(t => t.startTime && !t.isAllDay);

    // First start time (earliest scheduled item)
    let firstStartTime = null;
    if (scheduledItems.length > 0) {
      firstStartTime = scheduledItems
        .map(t => t.startTime)
        .sort((a, b) => a.localeCompare(b))[0];
    }

    // Committed hours (sum of durations of scheduled items)
    const committedMinutes = scheduledItems.reduce((sum, t) => sum + (t.duration || 0), 0);

    // Day label
    const dayLabel = tomorrow.toLocaleDateString('en-US', { weekday: 'long' });

    return {
      dayLabel,
      taskCount: userTasks.length,
      eventCount: calendarEvents.length,
      deadlineCount: deadlines.length,
      firstStartTime,
      committedMinutes,
      isEmpty: allTasks.length === 0 && deadlines.length === 0,
    };
  }, [tasks, recurringTasks, unscheduledTasks, getOccurrencesInRange, dateToString]);

  // Group tasks + recurring by date for O(1) lookups (avoids repeated O(n) scans)
  const tasksByDate = useMemo(() => {
    const map = {};
    for (const task of tasks) {
      if (!task.date) continue;
      if (!map[task.date]) map[task.date] = [];
      map[task.date].push(task);
    }
    for (const task of expandedRecurringTasks) {
      if (!task.date) continue;
      if (!map[task.date]) map[task.date] = [];
      map[task.date].push(task);
    }
    return map;
  }, [tasks, expandedRecurringTasks]);

  // Helper to get tasks for a specific date (must be after filterByTags)
  const getTasksForDate = (date) => {
    const dateStr = dateToString(date);
    return filterByTags(tasksByDate[dateStr] || []);
  };

  // --- GTD Frames: Instance computation + Available time calculation ---

  // Get frame instances for a given date (which templates apply)
  const getFrameInstancesForDate = useCallback((date) => {
    const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
    const dateStr = dateToString(date);
    return gtdFrames
      .filter(f => {
        if (!f.enabled) return false;
        if (f.singleDate) return f.singleDate === dateStr;
        return f.days.includes(dayOfWeek);
      })
      .map(f => {
        // Check for per-day exceptions
        const exception = f.exceptions?.[dateStr];
        if (exception?.deleted) return null;
        return {
          frameId: f.id,
          templateId: f.id,
          date: dateStr,
          start: exception?.start || f.start,
          end: exception?.end || f.end,
          label: f.label,
          color: f.color,
          tagAffinity: f.tagAffinity || [],
          energyLevel: f.energyLevel || 'medium',
          bufferMinutes: f.bufferMinutes ?? 5,
        };
      })
      .filter(Boolean);
  }, [gtdFrames]);

  // --- Frame Nudge --- (must be after getFrameInstancesForDate and getTasksForDate)
  const activeFrameForNudge = useMemo(() => {
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const today = new Date();
    const frame = getFrameInstancesForDate(today).find(f => {
      const fStart = timeToMinutes(f.start);
      const fEnd = timeToMinutes(f.end);
      return nowMin >= fStart && nowMin < fEnd;
    }) || null;
    if (!frame) return null;
    return { ...frame, minutesRemaining: timeToMinutes(frame.end) - nowMin };
  }, [currentTime, getFrameInstancesForDate]);

  const activeFrameNudgeKey = useMemo(() => {
    const todayStr = dateToString(new Date());
    return activeFrameForNudge
      ? `${todayStr}-${activeFrameForNudge.frameId}`
      : `${todayStr}-free`;
  }, [activeFrameForNudge]);

  const generateFrameNudge = useCallback(async () => {
    if (!aiConfig.enabled || !aiConfig.features?.frameNudge || (!aiConfig.apiKey && aiConfig.provider !== 'ollama')) return;
    const nowMin = currentTime.getHours() * 60 + currentTime.getMinutes();
    const today = new Date();
    const todayStr = dateToString(today);

    // Only fire when inside an active frame with >30 min remaining
    const allFramesToday = getFrameInstancesForDate(today).sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
    const activeF = allFramesToday.find(f => nowMin >= timeToMinutes(f.start) && nowMin < timeToMinutes(f.end));
    if (!activeF) return;
    const minutesRemaining = timeToMinutes(activeF.end) - nowMin;
    if (minutesRemaining <= 30) return;

    // Effective free time = gap to the next scheduled task (or end of frame), whichever is sooner.
    // This prevents nudging when the calendar is back-to-back even if the frame has time left.
    const effectiveMinutes = Math.min(minutesRemaining, agendaNowMarker.gapMinutes);
    if (effectiveMinutes < 15) return;

    setFrameNudgeLoading(true);
    setFrameNudgeError('');
    setFrameNudgeSuggestion(null);
    try {
      // Candidate tasks: inbox + today's past-scheduled incomplete tasks
      // Exclude any task scheduled now or in the future (taskEnd > nowMin covers both active and upcoming)
      const todayScheduled = getTasksForDate(today).filter(t => {
        if (t.completed || t.imported || t.isExample) return false;
        if (t.startTime) {
          const taskEnd = timeToMinutes(t.startTime) + (t.duration || 30);
          if (taskEnd > nowMin) return false;
        }
        return true;
      });
      const inboxItems = unscheduledTasks.filter(t => !t.completed && !t.isExample);
      // Only include tasks that can actually fit in the available slot.
      // Tasks with no duration are always included (we don't know how long they take).
      const candidates = [
        ...inboxItems.map(t => ({ id: t.id, title: renderTitleWithoutTags(t.title), tags: extractTags(t.title), duration: t.duration || null, isInbox: true })),
        ...todayScheduled.map(t => ({ id: t.id, title: renderTitleWithoutTags(t.title), tags: extractTags(t.title), duration: t.duration || null, isInbox: false })),
      ]
        .filter(t => !t.duration || t.duration <= effectiveMinutes)
        .slice(0, 20);

      if (candidates.length === 0) { setFrameNudgeLoading(false); return; }

      const currentTimeStr = `${String(currentTime.getHours()).padStart(2, '0')}:${String(currentTime.getMinutes()).padStart(2, '0')}`;
      const ctx = {
        currentTimeStr,
        activeFrame: {
          label: activeF.label,
          energyLevel: activeF.energyLevel,
          minutesRemaining: effectiveMinutes,
          tagAffinity: activeF.tagAffinity || [],
        },
        candidates,
      };

      const result = await aiJSON(frameNudgeSystemPrompt(), frameNudgeUserPrompt(ctx), aiConfig);
      if (result?.taskId) {
        const matched = candidates.find(t => t.id === result.taskId || String(t.id) === String(result.taskId));
        // Discard the suggestion if the AI picked a task that won't fit in the available slot.
        if (matched?.duration && matched.duration > effectiveMinutes) {
          setFrameNudgeLoading(false);
          return;
        }
        setFrameNudgeSuggestion({
          taskId: result.taskId,
          taskTitle: matched ? matched.title : (result.taskTitle || ''),
          reason: result.reason || '',
          isInbox: matched ? matched.isInbox : (result.isInbox ?? true),
        });
      }
    } catch {
      setFrameNudgeError('Could not get suggestion.');
    }
    setFrameNudgeLoading(false);
  }, [agendaNowMarker, aiConfig, currentTime, extractTags, getFrameInstancesForDate, getTasksForDate, renderTitleWithoutTags, tasks, unscheduledTasks]);

  // Auto-trigger frame nudge when entering a new Frame
  const prevFrameNudgeKeyRef = useRef(null);
  useEffect(() => {
    if (!aiConfig.enabled || !aiConfig.features?.frameNudge) return;
    if (gtdFrames.filter(f => f.enabled).length === 0) return;
    if (activeFrameNudgeKey === prevFrameNudgeKeyRef.current) return;
    prevFrameNudgeKeyRef.current = activeFrameNudgeKey;
    // Only auto-fire when inside an active frame (not free time)
    if (!activeFrameForNudge) return;
    // Skip if the user already dismissed this key
    if (frameNudgeDismissedKey === activeFrameNudgeKey) return;
    generateFrameNudge();
  }, [activeFrameNudgeKey, activeFrameForNudge, aiConfig, gtdFrames, frameNudgeDismissedKey, generateFrameNudge]);

  // Compute available time slots within a frame instance, subtracting existing tasks/events.
  // For today, elapsed time is excluded: each slot's start is clipped to the current time.
  const computeAvailableSlots = useCallback((frameInstance, date) => {
    const allDayTasks = getTasksForDate(date instanceof Date ? date : new Date(frameInstance.date + 'T12:00:00'));
    const timedTasks = allDayTasks.filter(t => !t.isAllDay && t.startTime);
    const frameStartMin = timeToMinutes(frameInstance.start);
    const frameEndMin = timeToMinutes(frameInstance.end);
    const buffer = frameInstance.bufferMinutes || 0;

    // Determine the "now" floor: for today, clip slots to current time;
    // for past dates all time is elapsed; for future dates no clipping.
    const slotDate = date instanceof Date ? date : new Date(frameInstance.date + 'T12:00:00');
    const slotDateStr = dateToString(slotDate);
    const todayStr = dateToString(new Date());
    let nowFloor = frameStartMin; // future dates: no clipping
    if (slotDateStr === todayStr) {
      const now = new Date();
      nowFloor = now.getHours() * 60 + now.getMinutes();
    } else if (slotDateStr < todayStr) {
      nowFloor = frameEndMin; // past dates: everything elapsed
    }

    // Collect occupied intervals within the frame
    const occupied = [];
    for (const task of timedTasks) {
      const tStart = timeToMinutes(task.startTime);
      const tEnd = tStart + (task.duration || 30);
      // Only include if it overlaps the frame
      if (tEnd > frameStartMin && tStart < frameEndMin) {
        occupied.push({
          start: Math.max(tStart, frameStartMin),
          end: Math.min(tEnd, frameEndMin),
        });
      }
    }

    // Sort occupied by start time
    occupied.sort((a, b) => a.start - b.start);

    // Merge overlapping intervals
    const merged = [];
    for (const o of occupied) {
      if (merged.length > 0 && o.start <= merged[merged.length - 1].end + buffer) {
        merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, o.end);
      } else {
        merged.push({ ...o });
      }
    }

    // Compute free gaps, clipping to nowFloor for today
    const slots = [];
    let cursor = frameStartMin;
    for (const m of merged) {
      const gapStart = cursor + (cursor === frameStartMin ? 0 : buffer);
      const gapEnd = m.start - buffer;
      const clippedStart = Math.max(gapStart, nowFloor);
      if (gapEnd > clippedStart) {
        slots.push({
          start: minutesToTime(clippedStart),
          end: minutesToTime(gapEnd),
          minutes: gapEnd - clippedStart,
        });
      }
      cursor = m.end;
    }
    // Final gap after last occupied block
    const finalStart = Math.max(cursor + (cursor === frameStartMin ? 0 : buffer), nowFloor);
    if (finalStart < frameEndMin) {
      slots.push({
        start: minutesToTime(finalStart),
        end: minutesToTime(frameEndMin),
        minutes: frameEndMin - finalStart,
      });
    }

    return slots;
  }, [getTasksForDate]);

  const {
    setDeadline,
    postponeDeadlineTask,
    clearDeadline,
    addTask,
    openNewTaskForm,
    openNewInboxTask,
    changeTaskColor,
    updateTaskNotes,
    updateRecurringTemplate,
    updateRecurrencePattern,
    updateRecurrenceEndCondition,
    toggleComplete,
    postponeTask,
    moveToInbox,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
    updateSubtaskTitle,
    moveToRecycleBin,
    deleteRecurringInstance,
    recordDeletedTaskTombstone,
    scheduleTaskAtNextSlot,
    manuallyScheduleTask,
    focusCompleteTask,
    focusUpdateTaskNotes,
    focusAddSubtask,
    focusToggleSubtask,
    focusDeleteSubtask,
    focusUpdateSubtaskTitle,
  } = useTaskActions({
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    recurringTasks, setRecurringTasks,
    recycleBin, setRecycleBin,
    completedTaskUids, setCompletedTaskUids,
    selectedDate,
    onboardingProgress, setOnboardingProgress,
    pushUndo,
    playUISound,
    parseRecurringId,
    getAdjustedTimeForImportedConflicts,
    newTask, setNewTask,
    setShowAddTask,
    setShowRecurrencePicker,
    expandedNotesTaskId, setExpandedNotesTaskId,
    setSyncNotification,
    setUndoToast,
    setShowColorPicker,
    setShowDeadlinePicker,
    recurringDeleteConfirm, setRecurringDeleteConfirm,
    hoverPreviewTime, hoverPreviewDate, setHoverPreviewTime, setHoverPreviewDate,
    swipeSchedulingInboxTaskId,
    syncTaskCompletionToCalDAV,
    computeAvailableSlots,
    activeFrameNudgeKey, setFrameNudgeDismissedKey,
    frameScheduleModal, setFrameScheduleModal,
    focusBlockTasks, setFocusBlockTasks,
    focusCompletedTasks, setFocusCompletedTasks,
    exitFocusModeRef,
    playFocusSound,
    getObsidianTaskMeta: obsidianConfig?.enabled && obsidianVaultHandleRef.current
      ? (rawTitle) => {
          const todayStr = new Date().toISOString().split('T')[0];
          return {
            id: `obsidian-${todayStr}-${obsidianSimpleHash(rawTitle)}`,
            importSource: 'obsidian',
            obsidianRawTitle: rawTitle,
            obsidianFileDate: todayStr,
          };
        }
      : null,
    onWriteObsidianTask: obsidianConfig?.enabled && obsidianVaultHandleRef.current
      ? (task) => {
          const todayStr = new Date().toISOString().split('T')[0];
          const heading = obsidianConfig.taskHeading || '## Tasks';
          if (obsidianVaultHandleRef.current === 'native') {
            appendTaskToDailyNoteNative(todayStr, task, heading, dailyNoteTemplate);
          } else {
            appendTaskToDailyNote(
              obsidianVaultHandleRef.current,
              obsidianConfig.dailyNotesPath || '',
              todayStr,
              task,
              heading,
              dailyNoteTemplate,
              obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd',
            ).catch(err => console.error('[Obsidian] Failed to write task to daily note:', err));
          }
        }
      : null,
  });

  // Wire up TDZ-safe refs for useDragDrop (see refs declared before the hook call).
  moveToRecycleBinRef.current = moveToRecycleBin;
  clearDeadlineRef.current = clearDeadline;
  moveToInboxRef.current = moveToInbox;

  const archiveInboxTask = (id) => {
    setUnscheduledTasks(prev => prev.map(t => t.id === id ? { ...t, archived: true } : t));
  };
  const restoreArchivedInboxTask = (id) => {
    setUnscheduledTasks(prev => prev.map(t => t.id === id ? { ...t, archived: false } : t));
  };

  // Focus mode availability: current task or back-to-back block >= 45 min remaining
  const focusModeAvailable = useMemo(() => {
    const now = currentTime;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayTasks = getTasksForDate(now);

    const timelineTasks = todayTasks
      .filter(t => !t.isAllDay && !t.completed && t.startTime)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    const inProgress = timelineTasks.filter(t => {
      const start = timeToMinutes(t.startTime);
      const end = start + t.duration;
      return start <= nowMin && end > nowMin;
    });

    if (inProgress.length === 0) return false;

    let blockStart = Math.min(...inProgress.map(t => timeToMinutes(t.startTime)));
    let blockEnd = Math.max(...inProgress.map(t => timeToMinutes(t.startTime) + t.duration));

    let extended = true;
    while (extended) {
      extended = false;
      for (const t of timelineTasks) {
        const tStart = timeToMinutes(t.startTime);
        const tEnd = tStart + t.duration;
        if (tStart <= blockEnd && tEnd > blockEnd) {
          blockEnd = tEnd;
          extended = true;
        }
      }
    }

    const remainingMinutes = blockEnd - nowMin;
    return remainingMinutes >= 45;
  }, [currentTime, tasks, expandedRecurringTasks]);
  focusModeAvailableRef.current = focusModeAvailable;

  // ── Electron desktop bridge ──────────────────────────────────────────────
  // Pushes lightweight state snapshots to the Electron WebSocket server and
  // routes commands from connected clients (Stream Deck, etc.) back into the app.
  useElectronBridge({
    todayAgenda,
    currentTime,
    tasks,
    focusModeAvailable,
    showFocusMode,
    focusPhase,
    focusTimerSeconds,
    focusTimerRunning,
    focusWorkMinutes,
    focusBreakMinutes,
    enterFocusModeRef,
    exitFocusModeRef,
    skipFocusPhase,
    toggleComplete,
  });

  // ── Native Android widget snapshot sync ──────────────────────────────────
  // Pushes a rich snapshot of today's agenda to the native widget via NativeBridge.
  // Runs whenever tasks, habits, routines, or frames change so the widget is always
  // current. Also runs on app startup (dataLoaded) for the first render.
  //
  // The snapshot mirrors what the Glance tab shows: overdue tasks, habit rings,
  // all-day events, deadline tasks, GTD frame sections with nested tasks, and routines.
  // The native WidgetUpdateWorker patches in fresh step counts and calendar events
  // every 15 minutes when the app is closed.
  useEffect(() => {
    if (!dataLoaded) return;
    if (!isNativeAndroid() || !window.DayGlanceNative?.updateWidgetSnapshot) return;

    const today = new Date();
    const todayStr = getTodayStr();

    // ── Overdue tasks (split: prior-day vs today-past-endtime) ────────────
    const allOverdueTasks = getOverdueTasks();
    const getProjectName = t => (goalsProjectsEnabled && t.projectId)
      ? (projects.find(p => p.id === t.projectId)?.title || '')
      : '';
    // Prior-day tasks → dedicated OVERDUE section in widget (no time, no badge)
    const overdueItems = allOverdueTasks
      .filter(t => t._overdueType === 'scheduled' ? t.date < todayStr : true)
      .map(t => ({
        id: t.id,
        title: t.title,
        colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
        overdueType: t._overdueType || 'scheduled',
        projectName: getProjectName(t),
      }));
    // Today's tasks that have passed their end time → shown in SCHEDULED with time
    const overdueTodayItems = allOverdueTasks
      .filter(t => t._overdueType === 'scheduled' && t.date === todayStr)
      .map(t => ({
        id: t.id,
        title: t.title,
        colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
        startTime: t.startTime || '',
        duration: t.duration || 0,
        projectName: getProjectName(t),
      }));

    // ── Habits (up to 5) — omit entirely when habits feature is disabled ──
    const habitItems = habitsEnabled ? activeHabits.slice(0, 5).map(h => {
      const colorObj = HABIT_COLORS.find(c => c.name === h.color) || HABIT_COLORS[0];
      const count = getTodayHabitCount(h.id);
      let progress, ringColorHex, isComplete;
      if (h.type === 'doMore') {
        progress = h.target > 0 ? Math.min(count / h.target, 1) : 0;
        isComplete = h.target > 0 && count >= h.target;
        ringColorHex = count === 0 ? '#d1d5db' : colorObj.ring;
      } else {
        progress = 1;
        isComplete = false;
        if (count === 0) ringColorHex = '#22c55e';
        else if (count <= h.target * 0.5) ringColorHex = '#eab308';
        else if (count <= h.target) ringColorHex = '#f59e0b';
        else ringColorHex = '#ef4444';
      }
      return {
        id: h.id,
        name: h.name,
        colorHex: colorObj.ring,
        ringColorHex,
        count,
        target: h.target,
        type: h.type || 'doMore',
        progress,
        complete: isComplete,
      };
    }) : [];

    // ── All-day tasks/events ───────────────────────────────────────────────
    const allDayItems = todayAgenda
      .filter(t => t._agendaType === 'allday')
      .map(t => ({
        id: t.id,
        title: t.title,
        colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
        projectName: getProjectName(t),
      }));

    // ── Deadline tasks (due today) ─────────────────────────────────────────
    const deadlineItems = todayAgenda
      .filter(t => t._agendaType === 'deadline')
      .map(t => ({
        id: t.id,
        title: t.title,
        colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
        projectName: getProjectName(t),
      }));

    // ── Frame sections + unframed scheduled tasks ─────────────────────────
    const nowMinW = today.getHours() * 60 + today.getMinutes();
    const todayFramesW = getFrameInstancesForDate(today).filter(
      f => timeToMinutes(f.end) > nowMinW
    );
    const overdueIdSet = new Set([...overdueItems, ...overdueTodayItems].map(t => String(t.id)));
    const scheduledW = todayAgenda.filter(t => t._agendaType === 'scheduled' && !overdueIdSet.has(String(t.id)));

    const taskFrameMapW = new Map();
    for (const task of scheduledW) {
      if (!task.startTime) continue;
      const tStart = timeToMinutes(task.startTime);
      const tEnd = tStart + (task.duration || 0);
      for (const frame of todayFramesW) {
        if (tStart >= timeToMinutes(frame.start) && tEnd <= timeToMinutes(frame.end)) {
          taskFrameMapW.set(String(task.id), frame.frameId);
          break;
        }
      }
    }

    const serTask = t => ({
      id: t.id,
      title: t.title,
      colorHex: taskColorToHex(t.color, t.nativeCalendarColor),
      startTime: t.startTime || '',
      duration: t.duration || 0,
      tags: (t.tags || []).slice(0, 3),
      projectName: (goalsProjectsEnabled && t.projectId)
        ? (projects.find(p => p.id === t.projectId)?.title || '')
        : '',
    });

    const sections = [];
    const sortedFramesW = [...todayFramesW].sort(
      (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)
    );
    const assignedIdsW = new Set();
    let schedIdxW = 0;

    for (const frame of sortedFramesW) {
      const fStart = timeToMinutes(frame.start);
      const beforeTasks = [];
      while (schedIdxW < scheduledW.length) {
        const t = scheduledW[schedIdxW];
        if (timeToMinutes(t.startTime || '00:00') < fStart && !taskFrameMapW.has(String(t.id))) {
          beforeTasks.push(t);
          assignedIdsW.add(String(t.id));
          schedIdxW++;
        } else break;
      }
      if (beforeTasks.length > 0) {
        sections.push({ type: 'unframed', tasks: beforeTasks.map(serTask) });
      }

      const frameTasks = scheduledW.filter(t => taskFrameMapW.get(String(t.id)) === frame.frameId);
      const availSlots = computeAvailableSlots(frame, today);
      const totalAvail = availSlots.reduce((s, slot) => s + slot.minutes, 0);
      const frameColorHex = TAILWIND_TO_HEX[frame.color] || '#3b82f6';

      if (totalAvail > 0 || frameTasks.length > 0) {
        sections.push({
          type: 'frame',
          name: frame.label,
          colorHex: frameColorHex,
          start: frame.start,
          end: frame.end,
          availableMinutes: totalAvail,
          tasks: frameTasks.map(serTask),
        });
      }
      frameTasks.forEach(t => assignedIdsW.add(String(t.id)));
      while (schedIdxW < scheduledW.length && assignedIdsW.has(String(scheduledW[schedIdxW].id))) schedIdxW++;
    }
    const remainingW = scheduledW.filter(t => !assignedIdsW.has(String(t.id)));
    if (remainingW.length > 0) {
      sections.push({ type: 'unframed', tasks: remainingW.map(serTask) });
    }

    // ── Routines ──────────────────────────────────────────────────────────
    const routineItems = todayRoutines.map(r => ({
      id: r.id,
      name: r.name,
      startTime: r.startTime || '',
      isAllDay: !r.startTime || r.isAllDay || false,
      completed: !!routineCompletions[r.id],
    }));

    // ── Goals due today ───────────────────────────────────────────────────
    const allTasksCombinedW = [...tasks, ...unscheduledTasks];
    const goalItems = goalsProjectsEnabled
      ? goals
          .filter(g => g.status === 'active' && g.targetDate === todayStr)
          .map(g => {
            const progressPct = Math.round(calculateGoalProgress(g.id, projects, allTasksCombinedW) * 100);
            const childProjects = projects.filter(p => p.goalId === g.id && p.status !== 'archived');
            const totalTasks = allTasksCombinedW.filter(t => childProjects.some(p => p.id === t.projectId) && !t.archived).length;
            const completedTasks = allTasksCombinedW.filter(t => childProjects.some(p => p.id === t.projectId) && !t.archived && t.completed).length;
            return { id: g.id, title: g.title, progressPct, totalTasks, completedTasks };
          })
      : [];

    // ── Next Task (for Up Next widget) ───────────────────────────────────
    // The nearest non-completed scheduled task that hasn't ended yet (or is in progress).
    const nowMin = today.getHours() * 60 + today.getMinutes();
    const nextTaskCandidate = todayAgenda
      .filter(t => t._agendaType === 'scheduled' && !t.completed && t.startTime)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime))
      .find(t => {
        const start = timeToMinutes(t.startTime);
        const end = start + (t.duration || 0);
        // Include if not yet ended (covers "in progress" and "upcoming")
        return end > nowMin || (t.duration === 0 && start >= nowMin);
      }) || null;
    const nextTaskItem = nextTaskCandidate ? {
      id: nextTaskCandidate.id,
      title: nextTaskCandidate.title,
      colorHex: taskColorToHex(nextTaskCandidate.color, nextTaskCandidate.nativeCalendarColor),
      startTime: nextTaskCandidate.startTime || '',
      duration: nextTaskCandidate.duration || 0,
      tags: (nextTaskCandidate.tags || []).slice(0, 5),
      notes: (nextTaskCandidate.notes || '').substring(0, 300),
      subtasks: (nextTaskCandidate.subtasks || []).slice(0, 5).map(s => ({
        title: s.title,
        completed: s.completed || false,
      })),
      projectName: getProjectName(nextTaskCandidate),
    } : null;

    // ── All Goals (for Goal widget) ───────────────────────────────────────
    const allGoalsData = goalsProjectsEnabled
      ? goals
          .filter(g => g.status === 'active')
          .map(g => {
            const childProjects = projects.filter(p => p.goalId === g.id && p.status !== 'archived');
            const goalTasks = allTasksCombinedW.filter(
              t => childProjects.some(p => p.id === t.projectId) && !t.archived
            );
            const pct = Math.round(calculateGoalProgress(g.id, projects, allTasksCombinedW) * 100);
            const goalColorHex = TAILWIND_TO_HEX[g.color] || '#3b82f6';
            let daysUntilDue = null;
            if (g.targetDate) {
              daysUntilDue = Math.round(
                (new Date(g.targetDate) - new Date(todayStr)) / 86400000
              );
            }
            return {
              id: g.id,
              title: g.title,
              colorHex: goalColorHex,
              targetDate: g.targetDate || '',
              daysUntilDue,
              progressPct: pct,
              totalTasks: goalTasks.length,
              completedTasks: goalTasks.filter(t => t.completed).length,
              projects: childProjects.map(p => {
                const ptasks = allTasksCombinedW.filter(t => t.projectId === p.id && !t.archived);
                const pp = ptasks.length > 0
                  ? Math.round((ptasks.filter(t => t.completed).length / ptasks.length) * 100) : 0;
                return {
                  id: p.id,
                  title: p.title,
                  status: p.status,
                  progressPct: pp,
                  totalTasks: ptasks.length,
                  completedTasks: ptasks.filter(t => t.completed).length,
                };
              }),
            };
          })
      : [];

    // ── All Projects (for Project widget) ─────────────────────────────────
    const allProjectsData = goalsProjectsEnabled
      ? projects
          .filter(p => p.status !== 'archived')
          .map(p => {
            const ptasks = allTasksCombinedW.filter(t => t.projectId === p.id && !t.archived);
            const pp = ptasks.length > 0
              ? Math.round((ptasks.filter(t => t.completed).length / ptasks.length) * 100) : 0;
            const parentGoal = goals.find(g => g.id === p.goalId);
            return {
              id: p.id,
              title: p.title,
              status: p.status,
              goalId: p.goalId || '',
              goalTitle: parentGoal?.title || '',
              goalColorHex: parentGoal ? (TAILWIND_TO_HEX[parentGoal.color] || '#3b82f6') : '',
              progressPct: pp,
              totalTasks: ptasks.length,
              completedTasks: ptasks.filter(t => t.completed).length,
              tasks: [...ptasks]
                .sort((a, b) => (a.completed ? 1 : 0) - (b.completed ? 1 : 0))
                .slice(0, 6)
                .map(t => ({ id: t.id, title: t.title, completed: !!t.completed })),
            };
          })
      : [];

    // ── Steps (from HealthConnect cache if available) ─────────────────────
    let steps = -1;
    try {
      const cachedSteps = JSON.parse(localStorage.getItem('day-planner-steps-cache') || 'null');
      if (cachedSteps?.date === todayStr) steps = cachedSteps.steps ?? -1;
    } catch (_) {}

    // ── GLANCEahead — include tomorrow preview when day is done or evening ──
    const nowHour = today.getHours();
    const nowMinW2 = nowHour * 60 + today.getMinutes();
    // "Day done" check: all scheduled tasks are past, or there are none
    const scheduledTodayW = todayAgenda.filter(t => t._agendaType === 'scheduled');
    const allPast = scheduledTodayW.length > 0 && scheduledTodayW.every(t => {
      if (!t.startTime) return true;
      const parts = t.startTime.split(':').map(Number);
      const endMin = parts[0] * 60 + (parts[1] || 0) + (t.duration || 0);
      return nowMinW2 >= endMin;
    });
    const isDayDoneW = (allPast && scheduledTodayW.length > 0) || scheduledTodayW.length === 0;
    const isEveningW = nowHour >= 19;
    const showGlanceAhead = isDayDoneW || isEveningW;

    let glanceAheadData = null;
    if (showGlanceAhead) {
      const { dayLabel, taskCount, eventCount, deadlineCount, firstStartTime, committedMinutes, isEmpty } = glanceAhead;
      const committedH = Math.floor(committedMinutes / 60);
      const committedM = committedMinutes % 60;
      const committedStr = committedH > 0 ? `${committedH}h${committedM > 0 ? ` ${committedM}m` : ''}` : committedM > 0 ? `${committedM}m` : null;
      glanceAheadData = {
        dayLabel,
        taskCount,
        eventCount,
        deadlineCount,
        firstStartTime: firstStartTime || '',
        committedStr: committedStr || '',
        isEmpty,
      };
    }

    // ── hyperGLANCE sessions (today + overdue) ────────────────────────────
    const hyperGlanceItems = goalsProjectsEnabled
      ? getGlanceHGInstances(projects, nowMinW).map(({ project, instance }) => {
          const hg = project.hyperglance;
          const effectiveTime = hg.scheduledTimeOverrides?.[instance.date] || hg.scheduledTime || '';
          const duration = hg.scheduledDurationOverrides?.[instance.date] || hg.scheduledDuration || 60;
          const allProjectTasks = [...tasks, ...unscheduledTasks];
          const alreadyInstantiated = allProjectTasks.some(
            t => t.projectId === project.id && t.hyperglanceSessionDate === instance.date
          );
          const taskCount = allProjectTasks.filter(
            t => t.projectId === project.id && !t.archived && !t.completed
          ).length + (alreadyInstantiated ? 0 : (hg.templateTasks?.length || 0));
          return {
            id: project.id,
            title: project.title,
            colorHex: hg.color || '#4f46e5',
            startTime: effectiveTime,
            duration,
            isOverdue: instance.isOverdue,
            date: instance.date,
            taskCount,
          };
        })
      : [];

    // Unified "Up Next" entry for the native background notification.
    // The native UpNextNotificationUpdater reads this so it correctly handles
    // HG sessions (not just tasks) when the WebView is backgrounded.
    const nextHGForUpNext = hyperGlanceItems
      .filter(s => !s.isOverdue && s.startTime && s.startTime !== '0:0')
      .map(s => { const [h, m] = s.startTime.split(':').map(Number); return { ...s, startMin: h * 60 + m }; })
      .filter(s => nowMinW < s.startMin + s.duration)
      .sort((a, b) => a.startMin - b.startMin)[0] || null;
    const nextUpNext = (() => {
      const taskMin = nextTaskItem ? timeToMinutes(nextTaskItem.startTime) : Infinity;
      const hgMin = nextHGForUpNext ? nextHGForUpNext.startMin : Infinity;
      if (nextHGForUpNext && hgMin <= taskMin) {
        const tc = nextHGForUpNext.taskCount;
        const tcLabel = tc > 0 ? ` · ${tc} task${tc !== 1 ? 's' : ''}` : '';
        return { title: 'hyperGLANCE', startTime: nextHGForUpNext.startTime, duration: nextHGForUpNext.duration, bodyPrefix: `${nextHGForUpNext.title}${tcLabel} · ` };
      }
      if (nextTaskItem)
        return { title: nextTaskItem.title, startTime: nextTaskItem.startTime, duration: nextTaskItem.duration, bodyPrefix: '' };
      return null;
    })();

    const snapshot = {
      date: todayStr,
      dateLabel: today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      steps,
      use24Hour: use24HourClock,
      overdue: overdueItems,
      overdueToday: overdueTodayItems,
      habits: habitItems,
      goals: goalItems,
      allGoals: allGoalsData,
      allProjects: allProjectsData,
      allDay: allDayItems,
      deadlines: deadlineItems,
      sections,
      routines: routineItems,
      hyperGlance: hyperGlanceItems,
      glanceAhead: glanceAheadData,
      nextTask: nextTaskItem,
      nextUpNext,
      updatedAt: Date.now(),
    };

    try {
      window.DayGlanceNative.updateWidgetSnapshot(JSON.stringify(snapshot));
    } catch (_) {}
  }, [
    dataLoaded,
    todayAgenda,
    activeHabits,
    habitsEnabled,
    habitLogs,
    todayRoutines,
    routineCompletions,
    tasks,
    unscheduledTasks,
    glanceAhead,
    currentTime,
    projects,
    goals,
    goalsProjectsEnabled,
  ]);

  // GTD Frame CRUD operations
  const saveFrame = (frame) => {
    if (frame.id) {
      setGtdFrames(prev => prev.map(f => f.id === frame.id ? frame : f));
    } else {
      setGtdFrames(prev => [...prev, { ...frame, id: crypto.randomUUID() }]);
    }
    setEditingFrame(null);
  };

  const deleteFrame = (frameId) => {
    setGtdFrames(prev => prev.filter(f => f.id !== frameId));
    // Record tombstone so cloud sync doesn't resurrect the frame from other devices
    const tombstones = JSON.parse(localStorage.getItem('day-planner-deleted-frame-ids') || '{}');
    tombstones[String(frameId)] = new Date().toISOString();
    localStorage.setItem('day-planner-deleted-frame-ids', JSON.stringify(tombstones));
    setEditingFrame(null);
  };

  // Frame context menu: skip this day (mark exception as deleted)
  const skipFrameForDay = (frameId, dateStr) => {
    pushUndo();
    setGtdFrames(prev => prev.map(f => {
      if (f.id !== frameId) return f;
      return { ...f, lastModified: new Date().toISOString(), exceptions: { ...(f.exceptions || {}), [dateStr]: { ...(f.exceptions?.[dateStr] || {}), deleted: true } } };
    }));
    setFrameContextMenu(null);
    playUISound('click');
  };

  // Frame context menu: open adjust time modal
  const openFrameAdjust = (frameId, dateStr) => {
    const frame = gtdFrames.find(f => f.id === frameId);
    if (!frame) return;
    const exception = frame.exceptions?.[dateStr];
    setFrameAdjustModal({
      frameId,
      dateStr,
      start: exception?.start || frame.start,
      end: exception?.end || frame.end,
    });
    setFrameContextMenu(null);
  };

  // Frame adjust: save new start/end as exception
  const saveFrameAdjust = () => {
    if (!frameAdjustModal) return;
    const { frameId, dateStr, start, end } = frameAdjustModal;
    pushUndo();
    setGtdFrames(prev => prev.map(f => {
      if (f.id !== frameId) return f;
      return { ...f, lastModified: new Date().toISOString(), exceptions: { ...(f.exceptions || {}), [dateStr]: { ...(f.exceptions?.[dateStr] || {}), start, end, deleted: false } } };
    }));
    setFrameAdjustModal(null);
    playUISound('click');
  };

  // Frame context menu: open manually schedule modal
  const openFrameSchedule = (frameId, dateStr) => {
    const frame = gtdFrames.find(f => f.id === frameId);
    if (!frame) return;
    const exception = frame.exceptions?.[dateStr];
    setFrameScheduleModal({
      frameId,
      dateStr,
      frame: {
        ...frame,
        start: exception?.start || frame.start,
        end: exception?.end || frame.end,
      },
    });
    setFrameContextMenu(null);
  };

  // Run Smart Schedule: gather context, call AI, present results
  const runSmartSchedule = async () => {
    if (!aiConfig?.enabled || !aiConfig.features?.smartScheduling) return;
    setSmartScheduleLoading(true);
    setSmartScheduleError('');
    setSmartScheduleResults(null);
    setSmartScheduleAccepted({});

    try {
      const today = new Date();
      const todayStr = dateToString(today);
      // Gather inbox tasks (non-completed, non-example, non-project)
      // Project tasks belong to their project cards and shouldn't be auto-scheduled from here
      const inboxTasks = unscheduledTasks.filter(t => !t.completed && !t.isExample && (!goalsProjectsEnabled || !t.projectId));
      if (inboxTasks.length === 0) {
        setSmartScheduleError('No inbox tasks to schedule.');
        setSmartScheduleLoading(false);
        return;
      }

      // Gather available slots for today + 2 days
      const dateRange = [];
      for (let d = 0; d < 3; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() + d);
        dateRange.push(date);
      }

      // Current time in minutes — used to exclude past slots for today
      const nowMinutes = today.getHours() * 60 + today.getMinutes();

      const slotsContext = [];
      for (const date of dateRange) {
        const dateStr = dateToString(date);
        const isToday = dateStr === todayStr;
        const frames = getFrameInstancesForDate(date);
        for (const frame of frames) {
          const slots = computeAvailableSlots(frame, date);
          for (const slot of slots) {
            // For today, skip slots that have already ended and
            // truncate slots that are partially in the past
            if (isToday) {
              const slotEndMin = timeToMinutes(slot.end);
              if (slotEndMin <= nowMinutes) continue; // entirely in the past
              const slotStartMin = timeToMinutes(slot.start);
              if (slotStartMin < nowMinutes) {
                // Truncate: move start to now
                const newStart = minutesToTime(nowMinutes);
                const newMinutes = slotEndMin - nowMinutes;
                if (newMinutes <= 0) continue;
                slotsContext.push({
                  date: dateStr,
                  frameLabel: frame.label,
                  energyLevel: frame.energyLevel,
                  tagAffinity: frame.tagAffinity,
                  start: newStart,
                  end: slot.end,
                  minutes: newMinutes,
                });
                continue;
              }
            }
            slotsContext.push({
              date: dateStr,
              frameLabel: frame.label,
              energyLevel: frame.energyLevel,
              tagAffinity: frame.tagAffinity,
              start: slot.start,
              end: slot.end,
              minutes: slot.minutes,
            });
          }
        }
      }

      if (slotsContext.length === 0) {
        setSmartScheduleError('No available time slots found in your frames for the next 3 days. Create or adjust your GTD Frames first.');
        setSmartScheduleLoading(false);
        return;
      }

      // Build the prompt using ai-prompts.js
      const systemPrompt = smartScheduleSystemPrompt();
      const taskData = inboxTasks.map(t => ({
        id: t.id,
        title: t.title,
        duration: t.duration || 30,
        priority: t.priority || 0,
        deadline: t.deadline || null,
        tags: extractTags(t.title),
      }));
      const userMessage = smartScheduleUserPrompt({
        todayDate: todayStr,
        slots: slotsContext,
        tasks: taskData,
      });

      const result = await aiJSON(systemPrompt, userMessage, aiConfig);
      setSmartScheduleResults(result);
      // Default all placements to accepted
      const accepted = {};
      if (result?.placements) {
        result.placements.forEach(p => { accepted[p.taskId] = true; });
      }
      setSmartScheduleAccepted(accepted);
    } catch (err) {
      setSmartScheduleError(err.message || 'Failed to generate schedule');
    } finally {
      setSmartScheduleLoading(false);
    }
  };

  // Apply accepted smart schedule placements
  const applySmartSchedule = () => {
    if (!smartScheduleResults?.placements) return;
    pushUndo();
    const accepted = smartScheduleResults.placements.filter(p => smartScheduleAccepted[p.taskId]);
    const movedIds = new Set();

    for (const placement of accepted) {
      // Robust lookup: AI may return taskId as a different type
      const task = unscheduledTasks.find(t => t.id === placement.taskId)
        || unscheduledTasks.find(t => String(t.id) === String(placement.taskId));
      if (!task) continue;
      const { priority, deadline, ...preserved } = task;
      setTasks(prev => [...prev, {
        ...preserved,
        date: placement.date,
        startTime: placement.time,
        duration: task.duration || 30,
        color: task.color || 'bg-blue-500',
        isAllDay: false,
      }]);
      movedIds.add(task.id); // Use actual task.id for consistent removal
    }

    setUnscheduledTasks(prev => prev.filter(t => !movedIds.has(t.id)));
    setSmartScheduleResults(null);
    setSmartScheduleAccepted({});
    setShowFramesModal(false);
    if (movedIds.size > 0) {
      setSyncNotification({
        type: 'success',
        title: 'Tasks Scheduled',
        message: `${movedIds.size} task${movedIds.size === 1 ? '' : 's'} placed on your timeline`
      });
    }
  };

  // --- AI Rescheduling ---
  const runReschedule = async () => {
    if (!aiConfig?.enabled || !aiConfig.features?.aiReschedule) return;
    setRescheduleLoading(true);
    setRescheduleError('');
    setRescheduleResults(null);
    setRescheduleAccepted({});
    try {
      const today = new Date();
      const todayStr = dateToString(today);
      const tasksToReschedule = tasks.filter(t => t.date <= todayStr && !t.completed && !t.imported && !t.isExample);
      if (tasksToReschedule.length === 0) {
        setRescheduleError('No incomplete tasks to reschedule.');
        setRescheduleLoading(false);
        return;
      }

      // Gather available slots starting from tomorrow (3-day window)
      const slotsContext = [];
      for (let d = 1; d <= 3; d++) {
        const date = new Date(today);
        date.setDate(date.getDate() + d);
        const dateStr = dateToString(date);
        const frames = getFrameInstancesForDate(date);
        for (const frame of frames) {
          const slots = computeAvailableSlots(frame, date);
          for (const slot of slots) {
            slotsContext.push({
              date: dateStr,
              frameLabel: frame.label,
              energyLevel: frame.energyLevel,
              tagAffinity: frame.tagAffinity,
              start: slot.start,
              end: slot.end,
              minutes: slot.minutes,
            });
          }
        }
      }

      if (slotsContext.length === 0) {
        setRescheduleError('No available frame slots found for the next 3 days. Adjust your GTD Frames first.');
        setRescheduleLoading(false);
        return;
      }

      const taskData = tasksToReschedule.map(t => ({
        id: t.id,
        title: t.title,
        duration: t.duration || 30,
        priority: t.priority || 0,
        deadline: t.deadline || null,
        tags: extractTags(t.title),
      }));

      const result = await aiJSON(rescheduleSystemPrompt(), rescheduleUserPrompt({ todayDate: todayStr, slots: slotsContext, tasks: taskData }), aiConfig);
      setRescheduleResults(result);
      const accepted = {};
      if (result?.placements) {
        result.placements.forEach(p => { accepted[p.taskId] = true; });
      }
      setRescheduleAccepted(accepted);
    } catch (err) {
      setRescheduleError(err.message || 'Failed to generate reschedule');
    } finally {
      setRescheduleLoading(false);
    }
  };

  const applyReschedule = () => {
    if (!rescheduleResults?.placements) return;
    pushUndo();
    const accepted = rescheduleResults.placements.filter(p => rescheduleAccepted[p.taskId]);
    let appliedCount = 0;
    for (const placement of accepted) {
      setTasks(prev => prev.map(t => {
        if (t.id === placement.taskId || String(t.id) === String(placement.taskId)) {
          return { ...t, date: placement.date, startTime: placement.time, isAllDay: false };
        }
        return t;
      }));
      appliedCount++;
    }
    setRescheduleResults(null);
    setRescheduleAccepted({});
    setShowRescheduleModal(false);
    if (appliedCount > 0) {
      setSyncNotification({
        type: 'success',
        title: 'Tasks Rescheduled',
        message: `${appliedCount} task${appliedCount === 1 ? '' : 's'} moved to future slots`,
      });
    }
  };

  // --- AI Subtask Generation ---
  const generateAISubtasks = useCallback(async (taskId, taskTitle, taskNotes, isInbox) => {
    if (!aiConfig?.enabled || !aiConfig.features?.aiSubtasks || (!aiConfig.apiKey && aiConfig.provider !== 'ollama')) return;
    setAiSubtasksLoadingForTask(taskId);
    try {
      const result = await aiJSON(aiSubtasksSystemPrompt(), aiSubtasksUserPrompt({ title: taskTitle, notes: taskNotes }), aiConfig);
      const newSubtasks = (result?.subtasks || [])
        .filter(st => st?.title?.trim())
        .map(st => ({
          id: crypto.randomUUID(),
          title: st.title.trim(),
          completed: false,
          ...(st.duration ? { duration: st.duration } : {}),
        }));
      if (newSubtasks.length > 0) {
        pushUndo();
        const updater = t => t.id === taskId ? { ...t, subtasks: [...(t.subtasks || []), ...newSubtasks] } : t;
        if (typeof taskId === 'string' && taskId.startsWith('recurring-')) {
          updateRecurringTemplate(taskId, updater);
        } else if (isInbox) {
          setUnscheduledTasks(prev => prev.map(updater));
        } else {
          setTasks(prev => prev.map(updater));
        }
      }
    } catch {}
    setAiSubtasksLoadingForTask(null);
  }, [aiConfig, pushUndo, updateRecurringTemplate]);

  // Focus mode: compute the current block tasks (used to snapshot when entering focus mode)
  const computeFocusBlockTasks = () => {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const todayTasks = getTasksForDate(now);

    const timelineTasks = todayTasks
      .filter(t => !t.isAllDay && !t.completed && t.startTime)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    const inProgress = timelineTasks.filter(t => {
      const start = timeToMinutes(t.startTime);
      const end = start + t.duration;
      return start <= nowMin && end > nowMin;
    });

    if (inProgress.length === 0) return [];

    let blockEnd = Math.max(...inProgress.map(t => timeToMinutes(t.startTime) + t.duration));

    let extended = true;
    while (extended) {
      extended = false;
      for (const t of timelineTasks) {
        const tStart = timeToMinutes(t.startTime);
        const tEnd = tStart + t.duration;
        if (tStart <= blockEnd && tEnd > blockEnd) {
          blockEnd = tEnd;
          extended = true;
        }
      }
    }

    const blockStart = Math.min(...inProgress.map(t => timeToMinutes(t.startTime)));
    return timelineTasks.filter(t => {
      const tStart = timeToMinutes(t.startTime);
      const tEnd = tStart + t.duration;
      return tStart < blockEnd && tEnd > blockStart;
    });
  };

  const isToday = dateToString(selectedDate) === dateToString(new Date());
  const currentTimeMinutes = currentTime.getHours() * 60 + currentTime.getMinutes();
  const currentHour = currentTime.getHours();
  const currentTimeTop = minutesToPosition(currentTimeMinutes);
  const showCurrentTimeLine = isToday;

  const bgClass = darkMode ? 'bg-gray-900' : 'bg-stone-100';
  const cardBg = darkMode ? 'bg-gray-800' : 'bg-white';
  const borderClass = darkMode ? 'border-gray-700' : 'border-stone-300';
  const textPrimary = darkMode ? 'text-gray-100' : 'text-stone-900';
  const textSecondary = darkMode ? 'text-gray-400' : 'text-stone-600';
  const hoverBg = darkMode ? 'hover:bg-gray-700' : 'hover:bg-stone-100';

  // Provider value — rebuilt each render; all consumers are children of this
  // Provider so they receive fresh values on every state update automatically.
  // Expose every component-scope binding so Phase 8 layout files can consume
  // any variable via useDayPlannerCtx() without prop-drilling.
  const ctx = {
    // ── Device & layout ──────────────────────────────────────────────────────
    isPhone, isMobile, isTablet, isLandscape,
    visibleDays, visibleDates,
    viewMode, setViewMode, canShowViewCycler, effectiveViewMode,
    defaultView, setDefaultView,
    dayViewMode, setDayViewMode,
    dayViewColumns,
    weekViewMode, setWeekViewMode,
    weekViewDates,

    // ── DOM / timer / function refs ───────────────────────────────────────────
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

    // ── Core data ─────────────────────────────────────────────────────────────
    selectedDate, setSelectedDate,
    tasks, setTasks,
    unscheduledTasks, setUnscheduledTasks,
    recurringTasks, setRecurringTasks,
    recycleBin, setRecycleBin,
    completedTaskUids, setCompletedTaskUids,
    dataLoaded, setDataLoaded,
    darkMode, setDarkMode,

    // ── Time ──────────────────────────────────────────────────────────────────
    currentTime, setCurrentTime,
    hours, firstHour,

    // ── Layout / navigation ───────────────────────────────────────────────────
    tabletActiveTab, setTabletActiveTab,
    mobileActiveTab, setMobileActiveTab,
    mobileWelcomeStep, setMobileWelcomeStep,
    desktopWelcomeStep, setDesktopWelcomeStep,
    showMonthView, setShowMonthView,
    viewedMonth, setViewedMonth,
    mobileReviewPage, setMobileReviewPage,
    showMobileDailySummary, setShowMobileDailySummary,
    mobileSettingsView, setMobileSettingsView,

    // ── Settings / preferences ────────────────────────────────────────────────
    use24HourClock, setUse24HourClock,
    inboxAutoArchiveDays, setInboxAutoArchiveDays,
    weekStartDay, setWeekStartDay,
    minimizedSections, setMinimizedSections,
    showSettings, setShowSettings,
    collapsedSettings, setCollapsedSettings,
    soundEnabled, setSoundEnabled,
    updateInfo, setUpdateInfo,
    updateDismissedVersion, setUpdateDismissedVersion,
    inboxPriorityFilter, setInboxPriorityFilter,
    hideCompletedInbox, setHideCompletedInbox,
    hideProjectTasksInbox, setHideProjectTasksInbox,
    hideStandaloneTasksInbox, setHideStandaloneTasksInbox,
    inboxTagFilter, setInboxTagFilter,
    inboxProjectFilter, setInboxProjectFilter,
    inboxArchivedExpanded, setInboxArchivedExpanded,
    priorityPromptDismissed, setPriorityPromptDismissed,
    sectionInfoDismissed, setSectionInfoDismissed,
    expandedSectionInfo, setExpandedSectionInfo,

    // ── Tags ──────────────────────────────────────────────────────────────────
    selectedTags, setSelectedTags,
    showUntagged, setShowUntagged,
    showMobileTagFilter, setShowMobileTagFilter,
    allTags,

    // ── Task modals & editing ─────────────────────────────────────────────────
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
    dailyStatsHabitsCollapsed, setDailyStatsHabitsCollapsed,
    dailyStatsAllTimeCollapsed, setDailyStatsAllTimeCollapsed,
    showShortcutHelp, setShowShortcutHelp,
    showHelpModal, setShowHelpModal,

    // ── Autocomplete suggestions ──────────────────────────────────────────────
    suggestions, setSuggestions,
    selectedSuggestionIndex, setSelectedSuggestionIndex,
    showSuggestions, setShowSuggestions,
    suggestionContext, setSuggestionContext,

    // ── Spotlight ─────────────────────────────────────────────────────────────
    showSpotlight, setShowSpotlight,
    spotlightQuery, setSpotlightQuery,
    spotlightSelectedIndex, setSpotlightSelectedIndex,
    spotlightResults,

    // ── Daily notes ───────────────────────────────────────────────────────────
    dailyNotes, setDailyNotes,
    dailyNoteTemplate, setDailyNoteTemplate,
    dailyNotesModalDate, setDailyNotesModalDate,

    // ── Weather ───────────────────────────────────────────────────────────────
    weather, setWeather,
    weatherZip, setWeatherZip,
    weatherTempUnit, setWeatherTempUnit,
    weatherEnabled, setWeatherEnabled,

    // ── Daily content (quotes / tips) ─────────────────────────────────────────
    dailyContent, setDailyContent,
    contentRotation, setContentRotation,
    dailyContentEnabled, setDailyContentEnabled,

    // ── Onboarding / welcome ──────────────────────────────────────────────────
    showWelcome, setShowWelcome,
    gettingStartedDismissed, setGettingStartedDismissed,
    onboardingComplete, setOnboardingComplete,
    onboardingProgress, setOnboardingProgress,
    showOnboarding,
    showGettingStarted,
    gettingStartedItems,
    allGettingStartedComplete,
    gettingStartedCompleteCount,

    // ── Undo / redo ───────────────────────────────────────────────────────────
    undoToast, setUndoToast,

    // ── Mobile editing ────────────────────────────────────────────────────────
    mobileEditingTask, setMobileEditingTask,
    mobileEditIsInbox, setMobileEditIsInbox,
    mobileEditingNativeEvent, setMobileEditingNativeEvent,
    nativeCalendarKey, setNativeCalendarKey,

    // ── Drag / drop state ─────────────────────────────────────────────────────
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
    timelineScrolledAway, setTimelineScrolledAway,

    // ── Computed / derived values ─────────────────────────────────────────────
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

    // ── Stats ─────────────────────────────────────────────────────────────────
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
    todayCompletedGoals, todayCompletedProjects, todayDueGoals,
    consecutiveDayStreak,
    todayIncompleteTasks, allTimeIncompleteTasks,

    // ── Functions – audio / UI ────────────────────────────────────────────────
    playUISound, playFocusSound,
    formatTime,
    toggleSection, toggleSettingsSection,

    // ── Functions – navigation ────────────────────────────────────────────────
    changeDate, goToToday, goToDate, changeViewedMonth,
    scrollToCurrentHour, scrollToHour,

    // ── Functions – task CRUD ─────────────────────────────────────────────────
    addTask, toggleComplete,
    archiveInboxTask, restoreArchivedInboxTask,
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

    // ── Functions – timeline / layout helpers ──────────────────────────────────
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

    reorderUnscheduledTasks,

    // ── Functions – drag / drop ───────────────────────────────────────────────
    handleCalendarMouseMove, handleCalendarMouseLeave,
    handleDragStart, handleDragEnd, updateDragAutoScroll,
    handleDragOver, handleDragOverInbox, handleDragOverRecycleBin,
    handleDropOnCalendar, handleDropOnDateHeader,
    handleDropOnInbox, handleDropOnRecycleBin,
    handleResizeStart, handleTouchResizeStart,
    handleRoutineResizeStart, handleTouchRoutineResizeStart,
    handleFrameResizeStart,
    handleMobileTaskTouchStart, handleMobileTaskTouchMove, handleMobileTaskTouchEnd,

    // ── Functions – mobile editing ────────────────────────────────────────────
    openMobileEditTask, openMobileEditNativeEvent,
    saveMobileEditTask, saveMobileEditNativeEvent,

    // ── Functions – undo / recycle bin ────────────────────────────────────────
    pushUndo, performUndo, performRedo,
    confirmEmptyBin, emptyRecycleBin,
  };

  const syncCtx = {
    // ── Calendar sync ─────────────────────────────────────────────────────────
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

    // ── Backup / restore ──────────────────────────────────────────────────────
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

    // ── Cloud sync ────────────────────────────────────────────────────────────
    cloudSyncConfig, setCloudSyncConfig,
    cloudSyncStatus, setCloudSyncStatus,
    cloudSyncError, setCloudSyncError,
    cloudSyncLastSynced, setCloudSyncLastSynced,
    cloudSyncConflict, setCloudSyncConflict,
    syncKeyReady, setSyncKeyReady,

    // ── Obsidian ──────────────────────────────────────────────────────────────
    obsidianConfig, setObsidianConfig,
    obsidianSyncStatus, setObsidianSyncStatus,
    obsidianSyncError, setObsidianSyncError,
    obsidianLastSynced, setObsidianLastSynced,
    wikilinkCandidates, setWikilinkCandidates,

    // ── TRMNL ─────────────────────────────────────────────────────────────────
    trmnlConfig, setTrmnlConfig,
    trmnlSyncStatus, setTrmnlSyncStatus,
    trmnlLastSynced, setTrmnlLastSynced,

    // ── Refs ──────────────────────────────────────────────────────────────────
    autoBackupInProgressRef, syncAllRef,
    cloudSyncDebounceRef, suppressCloudUploadRef, suppressTimestampRef,
    suppressClearPendingRef, cloudSyncInProgressRef, cloudSyncInitialDoneRef,
    cloudSyncDownloadRef, cloudSyncErrorCountRef, cloudSyncBackoffUntilRef,
    obsidianVaultHandleRef, obsidianSyncInProgressRef, obsidianPrevTaskStateRef,
    obsidianTasksRef, obsidianInboxRef,
    trmnlSyncTimerRef, trmnlLastPushRef, trmnlBackoffUntilRef, trmnlBackoffCountRef,
    trmnlSyncInProgressRef, performTrmnlSyncRef,

    // ── Functions – calendar sync ─────────────────────────────────────────────
    syncWithCalendar, syncTaskCalendar, syncTaskCompletionToCalDAV,
    nativeEventToTask, clearNativeEventOverride,
    parseDatetime, parseICS, filterByDateWindow,

    // ── Functions – data persistence ──────────────────────────────────────────
    loadData, saveData, applyRemoteData,
    cloudSyncDownload, cloudSyncUpload, cloudSyncTest, syncAll,
    performObsidianSync, loadWikiNote, saveWikiNote, openInObsidian, nativeClearVault,
    performTrmnlSync,
    performLocalBackup, performRemoteBackup,
    buildAutoBackupPayload, loadAutoBackupHistory,
    deleteLocalAutoBackup, deleteRemoteAutoBackup,
    restoreFromAutoBackup, restoreFromRemoteBackup,
    exportBackup, restoreBackup,
    handleFileUpload, handleBackupFileSelect, processImportFile,
    buildSyncPayload,
    fetchAllDailyContent, fetchWeather,
  };

  const featuresCtx = {
    // ── Routines ──────────────────────────────────────────────────────────────
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
    routineCompletions, setRoutineCompletions, toggleRoutineCompletion,

    // ── Habits ────────────────────────────────────────────────────────────────
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
    habitLongPressTimer,
    habitLongPressOpenedAt,

    // ── Focus mode ────────────────────────────────────────────────────────────
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

    // ── AI / Voice ────────────────────────────────────────────────────────────
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
    taskAISuggestion, setTaskAISuggestion,
    taskAISuggestionLoading, setTaskAISuggestionLoading,
    aiSubtasksLoadingForTask, setAiSubtasksLoadingForTask,

    // ── Weekly review / AI summaries ──────────────────────────────────────────
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

    // ── GTD Frames ────────────────────────────────────────────────────────────
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

    // ── Goals & Projects ──────────────────────────────────────────────────────
    goals, setGoals,
    projects, setProjects,
    showGoalsDashboard, setShowGoalsDashboard,
    goalsProjectsEnabled, setGoalsProjectsEnabled,
    addGoal, updateGoal, deleteGoal,
    addProject, updateProject, deleteProject, moveProject,
    projectFilter, setProjectFilter,

    // ── Reminders ─────────────────────────────────────────────────────────────
    reminderSettings, setReminderSettings,
    showRemindersSettings, setShowRemindersSettings,
    activeReminders, setActiveReminders,

    // ── Refs ──────────────────────────────────────────────────────────────────
    voiceRecorderRef, voiceAudioChunksRef, voiceAutoStartRef,
    voiceAllTagsRef, voiceBuildTaskContextRef, voiceResolveTaskMatchRef,
    lastWeeklyReviewFiredRef, weeklyReviewDismissedRef,
    focusTimerRef, handleFocusTimerEndRef, focusModeAvailableRef,
    syncHealthConnectHabitsRef,

    // ── Functions – routines ──────────────────────────────────────────────────
    openRoutinesDashboard, addRoutineChip, deleteRoutineChip,
    toggleRoutineChipSelection, handleRoutinesDone,

    // ── Functions – habits ────────────────────────────────────────────────────
    getTodayHabitCount, incrementHabit, setHabitCount,
    addHabit, updateHabit, archiveHabit, deleteHabit, reorderHabits,
    addStepsHabit, addSleepHabit,

    // ── Functions – focus mode ────────────────────────────────────────────────
    enterFocusMode, exitFocusMode, skipFocusPhase,
    startFocusTimer, dismissFocusStats, handleFocusTimerEnd,
    focusCompleteTask, focusToggleSubtask, focusAddSubtask,
    focusDeleteSubtask, focusUpdateSubtaskTitle, focusUpdateTaskNotes,
    computeFocusBlockTasks,

    // ── HyperGLANCE ───────────────────────────────────────────────────────────
    showHyperGlanceMode, setShowHyperGlanceMode,
    hyperGlanceProjectId, setHyperGlanceProjectId,
    hyperGlanceSessionDate, setHyperGlanceSessionDate,
    hgTimerSeconds, setHgTimerSeconds,
    hgTimerRunning, setHgTimerRunning,
    hgTimerPhase, setHgTimerPhase,
    hgWorkMinutes, setHgWorkMinutes,
    hgBreakMinutes, setHgBreakMinutes,
    hgLongBreakMinutes, setHgLongBreakMinutes,
    hgCycleCount, setHgCycleCount,
    hgExitConfirm, setHgExitConfirm,
    hgShowSettings, setHgShowSettings,
    enterHyperGlanceMode, exitHyperGlanceMode, completeHyperGlanceSession,
    hgContextMenu, setHgContextMenu,
    hgAdjustModal, setHgAdjustModal,
    hgAdjustTimeField, setHgAdjustTimeField,
    openHGAdjust, saveHGAdjust, cancelHGSession,
    pendingEditProjectId, setPendingEditProjectId,

    // ── Functions – GTD / AI ──────────────────────────────────────────────────
    saveFrame, deleteFrame, skipFrameForDay,
    openFrameAdjust, openFrameSchedule, saveFrameAdjust,
    getFrameInstancesForDate,
    runSmartSchedule, applySmartSchedule,
    runReschedule, applyReschedule,
    computeAvailableSlots,
    generateFrameNudge, generateMorningSummary, generateEveningReflection,
    generateWeeklyAISummary, generateAISubtasks,
    dismissMorningGlance, dismissEveningGlance,
    voiceParseWithAI, voiceStartRecording, voiceStopRecording,
    voiceApplyAllChanges, voiceHasTranscription,
    buildTaskContextForAI, resolveTaskMatch,

    // ── Functions – reminders ─────────────────────────────────────────────────
    applyReminderPreset, updateCategoryReminder,
    snoozeReminder, dismissReminder, dismissAllReminders,
  };

  return (
    <DayPlannerContext.Provider value={ctx}>
    <SyncContext.Provider value={syncCtx}>
    <FeaturesContext.Provider value={featuresCtx}>
    <div className={`app-shell ${bgClass}`} style={{ paddingTop: 'env(safe-area-inset-top)' }}
      onContextMenu={(e) => {
        // Allow native context menu on inputs/textareas/contenteditable
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName) || e.target.isContentEditable) return;
        // Allow elements that explicitly opt-in via data-ctx-menu
        if (e.target.closest('[data-ctx-menu]')) return;
        e.preventDefault();
      }}
    >
      {/* Safe-area cover: fills the status bar inset with the header color so
           bg-gray-900 (which has a blue tint) doesn't peek through as a visible line */}
      <div className={`fixed top-0 left-0 right-0 ${cardBg} z-[60]`} style={{ height: 'env(safe-area-inset-top, 0px)' }} />
      {/* Landscape blocker overlay for phones only (not tablets or narrow desktop windows) */}
      {isPhone && isLandscape && (
        <div className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 ${bgClass}`}>
          <Smartphone className={`w-12 h-12 ${darkMode ? 'text-gray-500' : 'text-stone-400'} -rotate-90`} />
          <p className={`${darkMode ? 'text-gray-400' : 'text-stone-500'} text-center px-8`}>
            Please rotate your device to portrait mode
          </p>
        </div>
      )}
      {isMobile ? (
        <MobileLayout />
      ) : (
        <DesktopLayout />
      )}

      {showTimePicker && (
        <ClockTimePicker
          value={newTask.startTime}
          onChange={(time) => setNewTask({ ...newTask, startTime: time })}
          onClose={() => setShowTimePicker(false)}
          darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
        />
      )}

      {showDatePicker && (
        <DatePicker
          value={newTask.date}
          onChange={(date) => setNewTask({ ...newTask, date })}
          onClose={() => setShowDatePicker(false)}
        />
      )}

      {deadlinePickerTaskId && (
        <DatePicker
          value={deadlinePickerTaskId === 'newTask'
            ? (newTask.deadline || dateToString(new Date()))
            : (unscheduledTasks.find(t => t.id === deadlinePickerTaskId)?.deadline || dateToString(new Date()))}
          onChange={(date) => {
            if (deadlinePickerTaskId === 'newTask') {
              setNewTask({ ...newTask, deadline: date });
            } else {
              setDeadline(deadlinePickerTaskId, date);
            }
            setDeadlinePickerTaskId(null);
          }}
          onClose={() => setDeadlinePickerTaskId(null)}
        />
      )}

      {showRecurrenceEndDatePicker && (
        <DatePicker
          value={(() => {
            if (showRecurrenceEndDatePicker.source === 'edit') {
              const tmpl = recurringTasks.find(t => t.id === showRecurrenceEndDatePicker.templateId);
              return tmpl?.recurrence?.endDate || dateToString(new Date());
            }
            return newTask.recurrence?.endDate || dateToString(new Date());
          })()}
          onChange={(date) => {
            if (showRecurrenceEndDatePicker.source === 'edit') {
              updateRecurrenceEndCondition(showRecurrenceEndDatePicker.templateId, { endDate: date });
            } else {
              const { maxOccurrences: _m, ...rest } = newTask.recurrence;
              setNewTask({ ...newTask, recurrence: { ...rest, endDate: date } });
            }
            setShowRecurrenceEndDatePicker(null);
          }}
          onClose={() => setShowRecurrenceEndDatePicker(null)}
        />
      )}

      {dailyNotesModalDate && (
        <DailyNotesModal
          dateStr={dailyNotesModalDate}
          note={dailyNotes[dailyNotesModalDate]}
          onSave={updateDailyNote}
          onClose={() => setDailyNotesModalDate(null)}
          darkMode={darkMode}
          isMobile={isMobile}
          template={dailyNoteTemplate}
          loadFresh={obsidianConfig?.enabled && obsidianVaultHandleRef.current
            ? obsidianVaultHandleRef.current === 'native'
              // Defer the synchronous native SAF read by one frame so the loading
              // spinner renders before the JS thread is blocked.
              ? (d) => new Promise(resolve => setTimeout(() => resolve(readDailyNoteNative(d)), 0))
              : (d) => readDailyNoteFresh(obsidianVaultHandleRef.current, obsidianConfig.dailyNotesPath || '', d, obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd')
            : null}
        />
      )}

      {/* Focus Log Modal */}
      {focusLogModalDate && (() => {
        const fmtMin = (min) => {
          const h = Math.floor(min / 60);
          const m = min % 60;
          if (h === 0) return `${m}m`;
          if (m === 0) return `${h}h`;
          return `${h}h ${m}m`;
        };
        const dayData = focusLog[focusLogModalDate] || { totalMinutes: 0, sessions: 0, cyclesCompleted: 0, tasksCompleted: 0 };
        const displayDate = new Date(focusLogModalDate + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

        // Last 7 days ending on focusLogModalDate
        const anchorDate = new Date(focusLogModalDate + 'T12:00:00');
        const last7 = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(anchorDate);
          d.setDate(d.getDate() - (6 - i));
          return dateToString(d);
        });
        const last7Data = last7.map(ds => focusLog[ds] || { totalMinutes: 0, sessions: 0, cyclesCompleted: 0, tasksCompleted: 0 });
        const totalMin7 = last7Data.reduce((s, d) => s + d.totalMinutes, 0);
        const activeDays7 = last7Data.filter(d => d.totalMinutes > 0).length;
        const avgMin7 = activeDays7 > 0 ? Math.round(totalMin7 / activeDays7) : 0;
        const sessions7 = last7Data.reduce((s, d) => s + d.sessions, 0);
        const maxMin7 = Math.max(...last7Data.map(d => d.totalMinutes), 1);

        // Streak: consecutive days with focus sessions ending on focusLogModalDate
        let streak = 0;
        for (let i = 6; i >= 0; i--) {
          if (last7Data[i].totalMinutes > 0) streak++;
          else break;
        }
        const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

        const Tile = ({ value, label }) => (
          <div className={`${darkMode ? 'bg-gray-700/50' : 'bg-stone-50'} rounded-lg p-3 flex-1`}>
            <div className={`text-lg font-bold ${textPrimary}`}>{value}</div>
            <div className={`text-xs ${textSecondary} mt-0.5`}>{label}</div>
          </div>
        );

        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60]" onClick={() => setFocusLogModalDate(null)}>
            <div
              className={`${cardBg} rounded-xl shadow-xl p-5 max-w-xs w-full mx-4 ${borderClass} border`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Target size={16} className="text-purple-500" />
                  <span className={`font-semibold text-sm ${textPrimary}`}>Focus Log</span>
                  <span className={`text-xs ${textSecondary}`}>{displayDate}</span>
                </div>
                <button
                  onClick={() => setFocusLogModalDate(null)}
                  className={`p-1 rounded ${darkMode ? 'hover:bg-white/10' : 'hover:bg-stone-100'} transition-colors`}
                >
                  <X size={16} className={textSecondary} />
                </button>
              </div>

              {/* This day */}
              <div className={`text-xs font-semibold uppercase tracking-wider ${textSecondary} mb-2`}>This Day</div>
              {dayData.totalMinutes === 0 ? (
                <p className={`text-sm ${textSecondary} italic mb-4`}>No focus sessions recorded.</p>
              ) : (
                <div className="flex gap-2 mb-4">
                  <Tile value={fmtMin(dayData.totalMinutes)} label="Focus time" />
                  <Tile value={dayData.sessions} label={dayData.sessions === 1 ? 'Session' : 'Sessions'} />
                  <Tile value={dayData.tasksCompleted} label={dayData.tasksCompleted === 1 ? 'Task done' : 'Tasks done'} />
                </div>
              )}

              {/* Last 7 days */}
              <div className={`text-xs font-semibold uppercase tracking-wider ${textSecondary} mb-2`}>Last 7 Days</div>
              {/* Mini bar chart */}
              <div className="flex items-end gap-1 h-12 mb-1">
                {last7Data.map((d, i) => {
                  const pct = d.totalMinutes / maxMin7;
                  const isAnchor = last7[i] === focusLogModalDate;
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5 h-full">
                      <div className="flex-1 w-full flex items-end">
                        <div
                          className="w-full rounded-sm"
                          style={{
                            height: d.totalMinutes > 0 ? `${Math.max(pct * 100, 8)}%` : '3px',
                            backgroundColor: d.totalMinutes > 0
                              ? (isAnchor ? '#a855f7' : (darkMode ? '#7c3aed80' : '#c4b5fd'))
                              : (darkMode ? '#374151' : '#e7e5e4'),
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-1 mb-3">
                {last7.map((ds, i) => (
                  <div key={i} className={`flex-1 text-center text-[10px] ${ds === focusLogModalDate ? 'text-purple-500 font-bold' : textSecondary}`}>
                    {dayLetters[new Date(ds + 'T12:00:00').getDay()]}
                  </div>
                ))}
              </div>
              {totalMin7 === 0 ? (
                <p className={`text-sm ${textSecondary} italic`}>No focus sessions in the last 7 days.</p>
              ) : (
                <div className="flex gap-2">
                  <Tile value={fmtMin(totalMin7)} label="Total" />
                  <Tile value={fmtMin(avgMin7)} label="Avg / active day" />
                  <Tile value={`${streak}d`} label="Streak" />
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Empty Bin / Recurrence Modals */}
      <EmptyBinConfirmModal />


      {/* Storage Breakdown Modal */}
      <StorageBreakdownModal />


      <RecurringDeleteModal />

      <EditRecurrenceModal />

      {/* Import Calendar Modal */}
      <ImportCalendarModal />


      {cloudSyncConflict && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Cloud size={20} className="text-blue-600 dark:text-blue-400" />
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>Existing Data Found</h3>
            </div>
            <p className={`${textSecondary} mb-2`}>
              Your cloud server already has synced data. What would you like to do?
            </p>
            <p className={`text-xs ${textSecondary} mb-4`}>
              Last modified: {new Date(cloudSyncConflict.remoteModified).toLocaleString()}
            </p>
            <div className="space-y-2">
              <button
                onClick={async () => {
                  const localData = buildSyncPayload().data;
                  const { data: mergedData, remoteChanged } = mergeSyncData(localData, cloudSyncConflict.remoteData, syncRetentionDays);
                  applyRemoteData(mergedData);
                  const now = new Date().toISOString();
                  localStorage.setItem('day-planner-cloud-sync-local-modified', now);
                  setCloudSyncLastSynced(now);
                  localStorage.setItem('day-planner-cloud-sync-last-synced', now);
                  setCloudSyncConflict(null);
                  cloudSyncInProgressRef.current = false;
                  cloudSyncInitialDoneRef.current = true;
                  if (remoteChanged) {
                    // Pass merged data directly — React state is stale after applyRemoteData
                    const mergedPayload = { version: 2, lastModified: now, data: mergedData };
                    await cloudSyncUpload(mergedPayload);
                  } else {
                    setCloudSyncStatus('success');
                    setTimeout(() => setCloudSyncStatus((s) => s === 'success' ? 'idle' : s), 3000);
                  }
                }}
                className={`w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">Merge both</div>
                <div className="text-sm text-blue-100">Combine local and server data, keeping all tasks</div>
              </button>
              <button
                onClick={() => {
                  applyRemoteData(cloudSyncConflict.remoteData);
                  localStorage.setItem('day-planner-cloud-sync-local-modified', cloudSyncConflict.remoteModified);
                  const now = new Date().toISOString();
                  setCloudSyncLastSynced(now);
                  localStorage.setItem('day-planner-cloud-sync-last-synced', now);
                  setCloudSyncConflict(null);
                  cloudSyncInProgressRef.current = false;
                  cloudSyncInitialDoneRef.current = true;
                  setCloudSyncStatus('success');
                  setTimeout(() => setCloudSyncStatus((s) => s === 'success' ? 'idle' : s), 3000);
                }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">Use server data</div>
                <div className={`text-sm ${textSecondary}`}>Replace local data with what's on the server</div>
              </button>
              <button
                onClick={async () => {
                  setCloudSyncConflict(null);
                  cloudSyncInProgressRef.current = false;
                  cloudSyncInitialDoneRef.current = true;
                  const now = new Date().toISOString();
                  localStorage.setItem('day-planner-cloud-sync-last-synced', now);
                  setCloudSyncLastSynced(now);
                  await cloudSyncUpload();
                }}
                className={`w-full px-4 py-3 ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-100 hover:bg-stone-200'} ${textPrimary} rounded-lg text-left transition-colors`}
              >
                <div className="font-medium">Use local data</div>
                <div className={`text-sm ${textSecondary}`}>Upload current data to the server, replacing what's there</div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Backup Modals */}
      <BackupMenuModal />
      <RestoreConfirmModal />
      <AutoBackupManagerModal />

      {syncNotification && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSyncNotification(null)}>
          <div
            className={`${cardBg} rounded-lg shadow-xl p-6 ${borderClass} border max-w-sm w-full mx-4`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className={`p-2 rounded-full ${
                syncNotification.type === 'success' ? 'bg-green-100 dark:bg-green-900/30' :
                syncNotification.type === 'error' ? 'bg-red-100 dark:bg-red-900/30' :
                'bg-blue-100 dark:bg-blue-900/30'
              }`}>
                {syncNotification.type === 'success' ? (
                  <Check size={20} className="text-green-600 dark:text-green-400" />
                ) : syncNotification.type === 'error' ? (
                  <AlertCircle size={20} className="text-red-600 dark:text-red-400" />
                ) : (
                  <RefreshCw size={20} className="text-blue-600 dark:text-blue-400" />
                )}
              </div>
              <h3 className={`text-lg font-semibold ${textPrimary}`}>
                {syncNotification.title ? syncNotification.title :
                 syncNotification.type === 'success' ? 'Sync Complete' :
                 syncNotification.type === 'error' ? 'Sync Failed' : 'Calendar Sync'}
              </h3>
            </div>
            <p className={`${textSecondary} mb-6`}>
              {syncNotification.message}
            </p>
            <div className="flex justify-end">
              <button
                onClick={() => setSyncNotification(null)}
                className={`px-4 py-2 ${
                  syncNotification.type === 'success' ? 'bg-green-600 hover:bg-green-700' :
                  syncNotification.type === 'error' ? 'bg-red-600 hover:bg-red-700' :
                  'bg-blue-600 hover:bg-blue-700'
                } text-white rounded-lg`}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Undo/Redo Toast */}
      {undoToast && (
        <div className={`fixed left-1/2 -translate-x-1/2 z-50 ${undoToast.actionable ? 'pointer-events-auto' : 'pointer-events-none'}`} style={{ bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom, 0px))' : '1.5rem' }}>
          <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${darkMode ? 'bg-gray-700 text-gray-200' : 'bg-gray-800 text-white'}`}>
            <span>{undoToast.message}</span>
            {undoToast.actionable && (
              <button
                onClick={() => { performUndo(); }}
                className="font-semibold text-blue-400 hover:text-blue-300 ml-1"
              >
                Undo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Tablet: Timeline FABs — + (new task), Frames */}
      {isTablet && (
        <>
          {/* GTD Frames FAB */}
          <button
            onClick={() => { setShowFramesModal(true); setEditingFrame(null); }}
            className={`fixed z-40 w-14 h-14 rounded-full shadow-lg active:opacity-90 flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-600'}`}
            style={{ right: '1rem', bottom: '5.5rem' }}
            title="GTD Frames & Smart Schedule"
          >
            <LayoutGrid size={22} />
          </button>
          {/* + New task FAB */}
          <button
            onClick={openNewTaskForm}
            className="fixed z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg active:bg-blue-700 flex items-center justify-center transition-colors"
            style={{ right: '1rem', bottom: '1.5rem' }}
            title="New Scheduled Task"
          >
            <Plus size={28} />
          </button>
          {/* Glance panel FABs: weekly review (bottom), daily summary (middle), recycle bin (top) — only when glance panel is visible (portrait or landscape glance tab) */}
          {tabletActiveTab === 'glance' && (<>
          {/* Daily summary ring FAB */}
          {(() => {
            const pct = actualTodayNonImportedTasks.length > 0 ? Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100) : 0;
            const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
            return (
              <button
                onClick={() => setShowMobileDailySummary(true)}
                className={`fixed z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 active:bg-gray-600' : 'bg-stone-200 active:bg-stone-300'}`}
                style={{ left: '268px', bottom: '5.5rem' }}
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
            className={`fixed z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${showWeeklyReviewReminder ? 'bg-blue-600 text-white active:bg-blue-700' : darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-200 text-stone-600 active:bg-stone-300'}`}
            style={{ left: '268px', bottom: '1.5rem' }}
          >
            <BarChart3 size={22} />
          </button>
          {/* Recycle bin FAB — only when non-empty, always on top */}
          {recycleBin.filter(t => !t.isExample).length > 0 && (
            <button
              onClick={() => setShowMobileRecycleBin(true)}
              className={`fixed z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 active:bg-gray-600' : 'bg-stone-200 text-stone-600 active:bg-stone-300'}`}
              style={{ left: '268px', bottom: '9.5rem' }}
            >
              <div className="relative">
                <Trash2 size={22} />
                <span className="absolute -top-2 -right-3 bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-[16px] flex items-center justify-center rounded-full px-0.5">
                  {recycleBin.filter(t => !t.isExample).length > 9 ? '9+' : recycleBin.filter(t => !t.isExample).length}
                </span>
              </div>
            </button>
          )}
          </>)}
        </>
      )}

      {/* Desktop: Timeline FABs — + (new task), Frames, mic (voice input) */}
      {!isTablet && !isMobile && (
        <>
          {/* GTD Frames FAB */}
          <button
            onClick={() => { setShowFramesModal(true); setEditingFrame(null); }}
            className={`fixed z-40 w-14 h-14 rounded-full shadow-lg hover:opacity-90 flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 text-gray-300' : 'bg-stone-200 text-stone-600'}`}
            style={{ right: '1.5rem', bottom: '5.5rem' }}
            title="GTD Frames & Smart Schedule"
          >
            <LayoutGrid size={22} />
          </button>
          <button
            onClick={openNewTaskForm}
            className="fixed z-40 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 flex items-center justify-center transition-colors"
            style={{ right: '1.5rem', bottom: '1.5rem' }}
            title="New Scheduled Task"
          >
            <Plus size={28} />
          </button>
          {/* Desktop Glance panel FABs — matching tablet landscape */}
          {tabletActiveTab === 'glance' && (<>
          {/* Daily summary ring FAB */}
          {(() => {
            const pct = actualTodayNonImportedTasks.length > 0 ? Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100) : 0;
            const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
            return (
              <button
                onClick={() => setShowMobileDailySummary(true)}
                className={`fixed z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 hover:bg-gray-600' : 'bg-stone-200 hover:bg-stone-300'}`}
                style={{ left: '268px', bottom: '5.5rem' }}
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
            className={`fixed z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${showWeeklyReviewReminder ? 'bg-blue-600 text-white hover:bg-blue-700' : darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-200 text-stone-600 hover:bg-stone-300'}`}
            style={{ left: '268px', bottom: '1.5rem' }}
          >
            <BarChart3 size={22} />
          </button>
          {/* Recycle bin FAB — only when non-empty */}
          {recycleBin.filter(t => !t.isExample).length > 0 && (
            <button
              onClick={() => setShowMobileRecycleBin(true)}
              className={`fixed z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-colors ${darkMode ? 'bg-gray-700 text-gray-300 hover:bg-gray-600' : 'bg-stone-200 text-stone-600 hover:bg-stone-300'}`}
              style={{ left: '268px', bottom: '9.5rem' }}
            >
              <div className="relative">
                <Trash2 size={22} />
                <span className="absolute -top-2 -right-3 bg-red-500 text-white text-[10px] font-bold min-w-[16px] h-[16px] flex items-center justify-center rounded-full px-0.5">
                  {recycleBin.filter(t => !t.isExample).length > 9 ? '9+' : recycleBin.filter(t => !t.isExample).length}
                </span>
              </div>
            </button>
          )}
          </>)}
        </>
      )}

      {/* Desktop/Tablet: Recycle Bin Bottom Sheet */}
      {!isMobile && showMobileRecycleBin && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end items-start" onClick={() => setShowMobileRecycleBin(false)}>
          <div className="bg-black/30 absolute inset-0" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[70vh] flex flex-col`}
            style={{ paddingBottom: '1rem', width: '320px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className={`w-10 h-1 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-stone-300'}`} />
            </div>
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
                  <button onClick={emptyRecycleBin} className="text-xs text-red-500 font-medium px-2 py-1 rounded-lg hover:bg-red-500/5 active:bg-red-500/10 dark:hover:bg-red-500/10 dark:active:bg-red-500/20 transition-colors">Empty All</button>
                )}
                <button onClick={() => setShowMobileRecycleBin(false)} className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`} aria-label="Close recycle bin">
                  <X size={16} className={textSecondary} />
                </button>
              </div>
            </div>
            <div className="overflow-y-auto px-4 pb-2 space-y-2">
              {recycleBin.filter(t => !t.isExample).length === 0 ? (
                <p className={`text-sm ${textSecondary} text-center py-8`}>Recycle bin is empty</p>
              ) : (
                recycleBin.filter(t => !t.isExample).map(task => (
                  <div key={`tablet-bin-${task.id}`} className={`${task.color} rounded-lg p-3 opacity-60`}>
                    <div className="flex items-start justify-between text-white">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{renderTitle(task.title)}</div>
                        <div className="text-xs opacity-75 mt-1">
                          {task._deletedFrom === 'inbox' ? <>Inbox • {task.duration}min</> : task.startTime ? <>{formatTime(task.startTime)} • {task.duration}min</> : <>{task.duration}min</>}
                        </div>
                      </div>
                      <button onClick={() => { undeleteTask(task.id); if (recycleBin.filter(t => !t.isExample).length <= 1) setShowMobileRecycleBin(false); }} className="bg-white/20 rounded-lg p-1.5 hover:bg-white/25 active:bg-white/30 transition-colors" title="Restore">
                        <Undo2 size={14} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Desktop/Tablet: Daily Summary Bottom Card */}
      {!isMobile && showMobileDailySummary && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end items-start" style={{ width: '320px' }} onClick={() => setShowMobileDailySummary(false)}>
          <div className="bg-black/30 absolute inset-0" />
          <div
            className={`relative ${cardBg} rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col w-full`}
            style={{ paddingBottom: '1rem' }}
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
              <button onClick={() => setShowMobileDailySummary(false)} className={`p-1.5 rounded-lg ${darkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-stone-100 hover:bg-stone-200'} transition-colors`} aria-label="Close">
                <X size={16} className={textSecondary} />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-2">
              {actualTodayNonImportedTasks.length === 0 ? (
                <p className={`text-sm ${textSecondary} text-center py-4`}>No tasks scheduled for today</p>
              ) : (() => {
                const pct = Math.round(((actualTodayCompletedTasks.length + inboxCompletedTodayCount) / actualTodayNonImportedTasks.length) * 100);
                const ringColor = pct >= 100 ? 'stroke-green-500' : pct >= 50 ? 'stroke-amber-500' : 'stroke-red-500';
                return (
                  <>
                    <div className="flex items-center gap-4 mb-4">
                      <div className="relative w-16 h-16 flex-shrink-0">
                        <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className={darkMode ? 'stroke-gray-700' : 'stroke-gray-200'} />
                          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round" className={ringColor}
                            strokeDasharray={`${(pct / 100) * 97.4} 97.4`}
                          />
                        </svg>
                        <span className={`absolute inset-0 flex items-center justify-center text-sm font-bold ${textPrimary}`}>{pct}%</span>
                      </div>
                      <div>
                        <div className={`text-lg font-bold ${textPrimary}`}>{actualTodayCompletedTasks.length} of {actualTodayNonImportedTasks.length} done</div>
                        {todayIncompleteTasks.length > 0 && (
                          <button onClick={() => { setShowIncompleteTasks('today'); setShowMobileDailySummary(false); }} className="text-sm text-blue-500 hover:text-blue-600">
                            {todayIncompleteTasks.length} incomplete
                          </button>
                        )}
                        {inboxCompletedTodayCount > 0 && (
                          <div className={`text-sm ${textSecondary}`}>+ {inboxCompletedTodayCount} inbox {inboxCompletedTodayCount === 1 ? 'task' : 'tasks'} done</div>
                        )}
                        {goalsProjectsEnabled && projectTasksCompletedTodayCount > 0 && (
                          <div className={`text-sm ${textSecondary}`}>+ {projectTasksCompletedTodayCount} project {projectTasksCompletedTodayCount === 1 ? 'task' : 'tasks'} done</div>
                        )}
                        {consecutiveDayStreak > 1 && (
                          <div className="flex items-center gap-1 text-sm text-orange-500 font-medium mt-0.5">
                            <Flame size={13} />
                            {consecutiveDayStreak} day streak
                          </div>
                        )}
                      </div>
                    </div>
                    {goalsProjectsEnabled && (todayDueGoals.length > 0 || todayCompletedGoals.length > 0 || todayCompletedProjects.length > 0) && (
                      <div className="space-y-1.5 mb-3">
                        {todayDueGoals.map(g => (
                          <div key={g.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${darkMode ? 'bg-yellow-900/30 text-yellow-300' : 'bg-yellow-50 text-yellow-700'}`}>
                            <Flag size={14} className="flex-shrink-0" />
                            <span className="truncate">Goal due today: {g.title}</span>
                          </div>
                        ))}
                        {todayCompletedGoals.map(g => (
                          <div key={g.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${darkMode ? 'bg-amber-900/30 text-amber-300' : 'bg-amber-50 text-amber-700'}`}>
                            <Flag size={14} className="flex-shrink-0" />
                            <span className="truncate">Goal complete: {g.title}</span>
                          </div>
                        ))}
                        {todayCompletedProjects.map(p => (
                          <div key={p.id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ${darkMode ? 'bg-green-900/30 text-green-300' : 'bg-green-50 text-green-700'}`}>
                            <FolderOpen size={14} className="flex-shrink-0" />
                            <span className="truncate">Project complete: {p.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
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

              {/* Habit Streaks — collapsible, default collapsed */}
              {habitsEnabled && activeHabits.length > 0 && (
                <div className={`mt-4 pt-4 border-t ${borderClass}`}>
                  <button
                    className="flex items-center justify-between w-full mb-0"
                    onClick={() => setDesktopStatsHabitsCollapsed(c => !c)}
                  >
                    <div className="flex items-center gap-2">
                      <Flame size={18} className="text-orange-500" />
                      <span className={`font-semibold ${textPrimary}`}>Habit Tracker</span>
                    </div>
                    {desktopStatsHabitsCollapsed ? <ChevronDown size={16} className={textSecondary} /> : <ChevronUp size={16} className={textSecondary} />}
                  </button>
                  {!desktopStatsHabitsCollapsed && (
                  <div className="space-y-2 mt-3">
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
                  )}
                </div>
              )}

              {/* All-Time Summary — collapsible, default collapsed */}
              <div className={`mt-4 pt-4 border-t ${borderClass}`}>
                <button
                  className="flex items-center justify-between w-full mb-0"
                  onClick={() => setDesktopStatsAllTimeCollapsed(c => !c)}
                >
                  <div className="flex items-center gap-2">
                    <TrendingUp size={18} className={textSecondary} />
                    <span className={`font-semibold ${textPrimary}`}>All-Time Summary</span>
                  </div>
                  {desktopStatsAllTimeCollapsed ? <ChevronDown size={16} className={textSecondary} /> : <ChevronUp size={16} className={textSecondary} />}
                </button>
                {!desktopStatsAllTimeCollapsed && (
                <div className={`space-y-2 text-sm ${textSecondary} mt-3`}>
                  {goalsProjectsEnabled && allTimeGoalsCreated > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Flag size={14} className="text-amber-400" /> Goals</div>
                      <span className={`font-medium ${textPrimary}`}>{allTimeGoalsCompleted}/{allTimeGoalsCreated} completed</span>
                    </div>
                  )}
                  {goalsProjectsEnabled && allTimeProjectsCreated > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><FolderOpen size={14} className="text-blue-400" /> Projects</div>
                      <span className={`font-medium ${textPrimary}`}>{allTimeProjectsCompleted}/{allTimeProjectsCreated} completed</span>
                    </div>
                  )}
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
                          className="ml-1 text-blue-500 hover:text-blue-400"
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
                  {goalsProjectsEnabled && allTimeUnscheduledProjectDoneCount > 0 && (
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><FolderOpen size={14} className="text-green-400" /> Project queue done</div>
                      <span className={`font-medium ${textPrimary}`}>{allTimeUnscheduledProjectDoneCount}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Clock size={14} className="text-orange-400" /> Time spent</div>
                    <span className={`font-medium ${textPrimary}`}>{Math.floor((totalCompletedMinutes + allTimeInboxCompletedMinutes + allTimeUnscheduledProjectDoneMinutes) / 60)}h {(totalCompletedMinutes + allTimeInboxCompletedMinutes + allTimeUnscheduledProjectDoneMinutes) % 60}m</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Clock size={14} className="text-blue-400" /> Time planned</div>
                    <span className={`font-medium ${textPrimary}`}>{Math.floor(totalScheduledMinutes / 60)}h {totalScheduledMinutes % 60}m</span>
                  </div>
                  {allTimeFocusMinutes > 0 && (
                    <>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><Target size={14} className="text-purple-400" /> Focus time</div>
                        <span className={`font-medium ${textPrimary}`}>{Math.floor(allTimeFocusMinutes / 60)}h {Math.round(allTimeFocusMinutes % 60)}m</span>
                      </div>
                    </>
                  )}
                  {allTimeScheduledCount > 0 && (
                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-2"><Trophy size={14} className="text-amber-400" /> <span className={`font-semibold ${textPrimary}`}>Completion rate</span></div>
                      <span className={`font-semibold ${textPrimary}`}>{Math.round((allTimeCompletedCount / allTimeScheduledCount) * 100)}%</span>
                    </div>
                  )}
                </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Refocus timeline toast — all form factors */}
      {timelineScrolledAway && effectiveViewMode === 'multi' && (
        <div className="fixed left-1/2 -translate-x-1/2 z-50 pointer-events-auto" style={{ bottom: isMobile ? 'calc(5rem + env(safe-area-inset-bottom, 0px))' : '1.5rem' }}>
          <button
            onClick={() => { setTimelineScrolledAway(false); scrollToCurrentHour(true); }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg text-sm font-medium bg-blue-600 text-white active:bg-blue-700 transition-opacity`}
          >
            <Clock size={14} />
            <span>Refocus timeline</span>
          </button>
        </div>
      )}

      {/* Weekly Review Reminder Toast */}
      <WeeklyReviewReminderCard />
      {/* Reminder Toasts */}
      <ReminderToasts />
      {/* Obsidian Sync Toast */}
      <ObsidianSyncToast />


      {/* New Task Modals */}
      <MobileNewTaskModal />
      <DesktopNewTaskModal />


      {/* AI Reschedule Modal */}
      {showRescheduleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowRescheduleModal(false)}>
          <div className={`${cardBg} rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[85vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
            <div className={`px-5 py-4 border-b ${borderClass} flex items-center justify-between`}>
              <div className="flex items-center gap-2">
                <CalendarDays size={18} className="text-orange-500" />
                <h2 className={`text-lg font-bold ${textPrimary}`}>Reschedule Incomplete Tasks</h2>
              </div>
              <button onClick={() => setShowRescheduleModal(false)} className={`p-1.5 rounded-lg ${hoverBg} transition-colors`}>
                <X size={20} className={textSecondary} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              <SmartSchedulePanel
                mode="reschedule"
                aiConfig={aiConfig}
                inboxTasks={tasks.filter(t => t.date <= dateToString(new Date()) && !t.completed && !t.imported && !t.isExample)}
                smartScheduleResults={rescheduleResults}
                smartScheduleLoading={rescheduleLoading}
                smartScheduleError={rescheduleError}
                smartScheduleAccepted={rescheduleAccepted}
                setSmartScheduleAccepted={setRescheduleAccepted}
                onRun={runReschedule}
                onApply={applyReschedule}
                onCancel={() => { setRescheduleResults(null); setRescheduleError(''); setShowRescheduleModal(false); }}
                darkMode={darkMode}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
                borderClass={borderClass}
                cardBg={cardBg}
                hoverBg={hoverBg}
                gtdFrames={gtdFrames}
                formatTime={formatTime}
              />
            </div>
          </div>
        </div>
      )}

      {/* Prior-day habit summary popup */}
      {habitDayPopup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setHabitDayPopup(null)}>
          <div className={`${cardBg} rounded-xl shadow-2xl border ${borderClass} max-w-sm w-full p-5`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className={`font-semibold ${textPrimary}`}>
                  {new Date(habitDayPopup + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </div>
                <div className={`text-xs ${textSecondary} mt-0.5`}>Habit summary</div>
              </div>
              <button onClick={() => setHabitDayPopup(null)} className={`${textSecondary} hover:${textPrimary} transition-colors`}><X size={18} /></button>
            </div>
            <div className="flex flex-wrap gap-3 justify-center">
              {activeHabits.filter(h => (h.scheduledDays ?? [0,1,2,3,4,5,6]).includes(new Date(habitDayPopup + 'T12:00:00').getDay())).map(habit => (
                <div key={habit.id} className="flex flex-col items-center gap-1">
                  <div className="pointer-events-none">
                    <HabitRing
                      size={44}
                      habit={habit}
                      count={habitLogs[habitDayPopup]?.[habit.id] || 0}
                      darkMode={darkMode}
                      autoSynced={false}
                    />
                  </div>
                  <span className={`text-[10px] text-center max-w-[52px] truncate ${textSecondary}`}>{habit.name}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Habit Management Modal */}
      {showHabitModal && <HabitModal />}

      {/* Routines Dashboard Modal */}
      {showRoutinesDashboard && <RoutinesDashboardModal />}

      {/* Focus Mode Overlay */}
      {showFocusMode && <FocusModeModal />}

      {/* HyperGLANCE Overlay */}
      {showHyperGlanceMode && <HyperGlanceModeModal />}

      {/* Spotlight Search */}
      {showSpotlight && <SpotlightModal />}

      {/* Settings Modal */}
      {showSettings && <SettingsModal />}

      {/* Reminders Modal */}
      <RemindersSettingsModal />
      {/* Incomplete Tasks Modal */}
      <IncompleteTasksModal />

      {/* Help & Feedback Modal */}
      {showHelpModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowHelpModal(false)}>
          <div
            className={`${cardBg} rounded-xl shadow-xl border ${borderClass} w-full max-w-sm mx-4 overflow-hidden`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b ${borderClass}`}>
              <div className="flex items-center gap-2">
                <HelpCircle size={18} className="text-blue-500" />
                <h2 className={`font-semibold ${textPrimary}`}>Help & Feedback</h2>
              </div>
              <button onClick={() => setShowHelpModal(false)} className={`p-1 rounded-lg ${darkMode ? 'hover:bg-white/10' : 'hover:bg-stone-100'}`}>
                <X size={18} className={textSecondary} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-5">
              {/* Docs */}
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} mb-2`}>Documentation</p>
                <a
                  href="https://docs.dayglance.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors text-sm font-medium"
                >
                  <ExternalLink size={14} />
                  docs.dayglance.app
                </a>
              </div>

              {/* Contact */}
              <div>
                <p className={`text-xs font-semibold uppercase tracking-wide ${textSecondary} mb-2`}>Contact & Issues</p>
                <a
                  href="mailto:admin@dayglance.app"
                  className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors text-sm font-medium"
                >
                  <ExternalLink size={14} />
                  admin@dayglance.app
                </a>
                <a
                  href="https://github.com/krelltunez/day-planner/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors text-sm font-medium mt-1.5"
                >
                  <ExternalLink size={14} />
                  Report an issue on GitHub
                </a>
              </div>

              {/* Getting Started toggle */}
              <div className={`pt-4 border-t ${borderClass}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-sm font-medium ${textPrimary}`}>Getting Started checklist</p>
                    <p className={`text-xs ${textSecondary} mt-0.5`}>Show the guided checklist in the sidebar</p>
                  </div>
                  <button
                    onClick={() => {
                      if (gettingStartedDismissed) {
                        localStorage.removeItem('gettingStartedDismissed');
                        setGettingStartedDismissed(false);
                      } else {
                        setGettingStartedDismissed(true);
                      }
                    }}
                    className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${!gettingStartedDismissed ? 'bg-blue-500' : (darkMode ? 'bg-gray-600' : 'bg-stone-300')}`}
                  >
                    <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-all ${!gettingStartedDismissed ? 'left-5' : 'left-1'}`} />
                  </button>
                </div>
              </div>

              {/* About / build info */}
              <div className={`pt-4 border-t ${borderClass} space-y-2`}>
                {(() => {
                  const su = getStorageUsage();
                  const warn = su.totalBytes > 4 * 1024 * 1024;
                  return (
                    <button
                      onClick={() => { setShowHelpModal(false); setShowStorageBreakdown(true); }}
                      className={`flex items-center gap-1.5 text-xs ${warn ? 'text-orange-500' : textSecondary} hover:opacity-75 transition-opacity w-full`}
                    >
                      {warn && <AlertTriangle size={11} />}
                      Storage: {formatBytes(su.totalBytes)} / ~5 MB
                    </button>
                  );
                })()}
                <div className={`flex items-center justify-between`}>
                  <p className={`text-xs ${textSecondary}`}>
                    {typeof __APP_VERSION__ !== 'undefined' ? `v${__APP_VERSION__}` : 'dayGLANCE'}
                    {typeof __BUILD_TIMESTAMP__ !== 'undefined' ? ` · ${new Date(__BUILD_TIMESTAMP__).toLocaleString()}` : ''}
                  </p>
                  <button
                    onClick={() => { setShowHelpModal(false); setShowShortcutHelp(true); }}
                    className={`text-xs ${textSecondary} hover:opacity-75 transition-opacity`}
                  >
                    <kbd className={`px-1 py-0.5 rounded font-mono ${darkMode ? 'bg-gray-700' : 'bg-stone-100'} border ${borderClass}`}>?</kbd> shortcuts
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcut Cheat Sheet */}
      {showShortcutHelp && <ShortcutHelpModal />}

      {/* Sync passphrase prompt — shown on app load when encryption is enabled
          but no cached key was found in device storage (e.g. new device). */}
      {cloudSyncConfig?.encryptionEnabled && !syncKeyReady && (
        <SyncPassphraseModal
          darkMode={darkMode}
          textPrimary={textPrimary}
          textSecondary={textSecondary}
          borderClass={borderClass}
          onUnlocked={() => setSyncKeyReady(true)}
        />
      )}

      {/* Frame Context Menu */}
      {frameContextMenu && (() => {
        const fmX = Math.min(frameContextMenu.x, window.innerWidth - 168);
        const fmY = Math.min(frameContextMenu.y, window.innerHeight - 3 * 36 - 16);
        return (
        <div className="fixed inset-0 z-[70]" onClick={() => setFrameContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setFrameContextMenu(null); }}>
          <div
            className={`absolute ${cardBg} rounded-lg shadow-xl border ${borderClass} py-1 min-w-[160px]`}
            style={{ left: `${fmX}px`, top: `${fmY}px` }}
          >
            <button
              className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
              onClick={() => openFrameAdjust(frameContextMenu.frameId, frameContextMenu.dateStr)}
            >
              <Clock size={14} />
              Adjust time
            </button>
            <button
              className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
              onClick={() => openFrameSchedule(frameContextMenu.frameId, frameContextMenu.dateStr)}
            >
              <ListChecks size={14} />
              Manually schedule
            </button>
            <button
              className={`w-full text-left px-3 py-2 text-sm text-red-500 ${hoverBg} transition-colors flex items-center gap-2`}
              onClick={() => skipFrameForDay(frameContextMenu.frameId, frameContextMenu.dateStr)}
            >
              <X size={14} />
              Skip this day
            </button>
          </div>
        </div>
        );
      })()}

      {/* Task Context Menu */}
      {taskContextMenu && (() => {
        const { x, y, taskId, isRecurring, isImported, isAllDay, dateStr: ctxDateStr, supportsInlineNotes } = taskContextMenu;
        const ctxDate = new Date(ctxDateStr + 'T12:00:00');
        const scheduledMatch = getTasksForDate(ctxDate).find(t => t.id === taskId);
        const inboxMatch = !scheduledMatch && unscheduledTasks.find(t => t.id === taskId);
        const ctxTask = scheduledMatch || inboxMatch;
        const isInbox = !!inboxMatch;
        const isCompleted = ctxTask?.completed || false;
        const isTaskCalendar = ctxTask?.isTaskCalendar || false;
        const isCalendarEvent = isImported && !isTaskCalendar;
        const ctxHasNotes = ctxTask?.notes && ctxTask.notes.trim();
        // Check if any menu items would be visible; if not, don't show the menu
        const hasEdit = !isImported;
        const hasNotes = isImported ? !!ctxHasNotes : true;
        const isDaily = isRecurring && ctxTask?.recurrenceType === 'daily';
        const hasMoveTomorrow = !isImported && !isInbox && !isDaily;
        const hasMoveInbox = !isRecurring && !isImported && !isAllDay && !isInbox;
        const hasComplete = !isImported || isTaskCalendar;
        const hasDelete = !isImported;
        if (!hasEdit && !hasNotes && !hasMoveTomorrow && !hasMoveInbox && !hasComplete && !hasDelete) return null;
        // Clamp menu position to stay within viewport
        const menuWidth = 180;
        const menuItemHeight = 36;
        const menuItems = [hasEdit, hasNotes, hasMoveTomorrow, hasMoveInbox, hasComplete, hasDelete].filter(Boolean).length;
        const menuHeight = menuItems * menuItemHeight + 8;
        const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
        const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);
        return (
          <div className="fixed inset-0 z-[70]" onClick={() => setTaskContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setTaskContextMenu(null); }}>
            <div
              className={`absolute ${cardBg} rounded-lg shadow-xl border ${borderClass} py-1 min-w-[180px]`}
              style={{ left: `${clampedX}px`, top: `${clampedY}px` }}
            >
              {!isImported && (
                <button
                  className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                  onClick={() => {
                    if (ctxTask) openMobileEditTask(ctxTask, isInbox);
                    setTaskContextMenu(null);
                  }}
                >
                  <Pencil size={14} />
                  Edit
                </button>
              )}
              {/* Imported: only show Notes if the task actually has notes (no subtask support) */}
              {/* Non-imported: always show Notes / subtasks */}
              {isImported ? (
                ctxHasNotes && (
                  <button
                    className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                    onClick={() => {
                      setExpandedNotesTaskId(prev => prev === taskId ? null : taskId);
                      setTaskContextMenu(null);
                    }}
                  >
                    <FileText size={14} />
                    Notes
                  </button>
                )
              ) : (
                <button
                  className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                  onClick={() => {
                    setExpandedNotesTaskId(prev => prev === taskId ? null : taskId);
                    setTaskContextMenu(null);
                  }}
                >
                  <FileText size={14} />
                  Notes / subtasks
                </button>
              )}
              {!isImported && aiConfig?.enabled && aiConfig.features?.aiSubtasks && (
                <button
                  className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                  onClick={() => {
                    setExpandedNotesTaskId(prev => prev === taskId ? prev : taskId);
                    generateAISubtasks(taskId, ctxTask?.title, ctxTask?.notes, isInbox);
                    setTaskContextMenu(null);
                  }}
                >
                  <Sparkles size={14} />
                  Generate subtasks (AI)
                </button>
              )}
              {!isImported && !isInbox && !isDaily && (
                <button
                  className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                  onClick={() => {
                    postponeTask(taskId);
                    setTaskContextMenu(null);
                  }}
                >
                  <SkipForward size={14} />
                  Move to tomorrow
                </button>
              )}
              {!isRecurring && !isImported && !isAllDay && !isInbox && (
                <button
                  className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                  onClick={() => {
                    moveToInbox(taskId);
                    setTaskContextMenu(null);
                  }}
                >
                  <Inbox size={14} />
                  Move to inbox
                </button>
              )}
              {(!isImported || isTaskCalendar) && (
                <button
                  className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                  onClick={() => {
                    toggleComplete(taskId, isInbox);
                    setTaskContextMenu(null);
                  }}
                >
                  {isCompleted ? <RotateCcw size={14} /> : <Check size={14} />}
                  {isCompleted ? 'Uncomplete' : 'Complete'}
                </button>
              )}
              {!isImported && (
                <button
                  className={`w-full text-left px-3 py-2 text-sm text-red-500 ${hoverBg} transition-colors flex items-center gap-2`}
                  onClick={() => {
                    moveToRecycleBin(taskId, isInbox);
                    setTaskContextMenu(null);
                  }}
                >
                  <Trash2 size={14} />
                  Delete
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Timeline Context Menu (right-click on empty timeline area) */}
      {timelineContextMenu && (() => {
        const { x, y, dateStr: ctxDateStr, timeMinutes } = timelineContextMenu;
        const endMinutes = Math.min(timeMinutes + 60, 1440);
        const startH = String(Math.floor(timeMinutes / 60)).padStart(2, '0');
        const startM = String(timeMinutes % 60).padStart(2, '0');
        const endH = String(Math.floor(endMinutes / 60)).padStart(2, '0');
        const endM = String(endMinutes % 60).padStart(2, '0');
        const tlX = Math.min(x, window.innerWidth - 208);
        const tlY = Math.min(y, window.innerHeight - 44);
        return (
          <div className="fixed inset-0 z-[70]" onClick={() => setTimelineContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setTimelineContextMenu(null); }}>
            <div
              className={`absolute ${cardBg} rounded-lg shadow-xl border ${borderClass} py-1 min-w-[200px]`}
              style={{ left: `${tlX}px`, top: `${tlY}px` }}
            >
              <button
                className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                onClick={() => {
                  setQuickAddFrameModal({
                    dateStr: ctxDateStr,
                    startMinutes: timeMinutes,
                    endMinutes,
                  });
                  setTimelineContextMenu(null);
                }}
              >
                <Plus size={14} />
                Add a Frame ({formatTime(`${startH}:${startM}`)} – {formatTime(`${endH}:${endM}`)})
              </button>
            </div>
          </div>
        );
      })()}

      {/* Quick Add Frame Modal (from timeline right-click) */}
      {quickAddFrameModal && (() => {
        const { dateStr: qDateStr, startMinutes: qStart, endMinutes: qEnd } = quickAddFrameModal;
        const qDate = new Date(qDateStr + 'T12:00:00');
        const dateDisplay = qDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        // Pick first color not already used on that date
        const usedColors = getFrameInstancesForDate(qDate).map(f => f.color);
        const defaultColor = FRAME_COLORS.find(c => !usedColors.includes(c.class))?.class || FRAME_COLORS[0].class;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70]" onClick={() => setQuickAddFrameModal(null)}>
            <div className={`${cardBg} rounded-lg shadow-xl p-5 border ${borderClass} w-80`} onClick={(e) => e.stopPropagation()}>
              <QuickAddFrameForm
                dateStr={qDateStr}
                dateDisplay={dateDisplay}
                defaultStart={minutesToTime(qStart)}
                defaultEnd={minutesToTime(qEnd)}
                defaultColor={defaultColor}
                existingFrames={gtdFrames}
                getFrameInstancesForDate={getFrameInstancesForDate}
                onSave={(frame) => {
                  saveFrame(frame);
                  setQuickAddFrameModal(null);
                }}
                onCancel={() => setQuickAddFrameModal(null)}
                darkMode={darkMode}
                textPrimary={textPrimary}
                textSecondary={textSecondary}
                borderClass={borderClass}
                hoverBg={hoverBg}
                formatTime={formatTime}
                isTablet={isTablet}
                use24HourClock={use24HourClock}
              />
            </div>
          </div>
        );
      })()}

      {/* Frame Adjust Time Modal */}
      {frameAdjustModal && <FrameAdjustModal />}

      {/* Frame Manually Schedule Modal */}
      {frameScheduleModal && <FrameScheduleModal />}

      {/* HyperGLANCE bar context menu */}
      {hgContextMenu && (() => {
        const { x, y, projectId, date, isCompleted } = hgContextMenu;
        const proj = projects.find(p => p.id === projectId);
        if (!proj) return null;
        const itemCount = isCompleted ? 2 : 4;
        const cmX = Math.min(x, window.innerWidth - 176);
        const cmY = Math.min(y, window.innerHeight - itemCount * 36 - 16);
        return (
          <div className="fixed inset-0 z-[70]" onClick={() => setHgContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setHgContextMenu(null); }}>
            <div
              className={`absolute ${cardBg} rounded-lg shadow-xl border ${borderClass} py-1 min-w-[168px]`}
              style={{ left: `${cmX}px`, top: `${cmY}px` }}
            >
              {!isCompleted && (
                <button
                  className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                  onClick={() => { enterHyperGlanceMode(projectId, date); setHgContextMenu(null); }}
                >
                  <Zap size={14} />
                  hyperGLANCE
                </button>
              )}
              <button
                className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                onClick={() => { setPendingEditProjectId(projectId); setHgContextMenu(null); }}
              >
                <Pencil size={14} />
                Edit
              </button>
              <button
                className={`w-full text-left px-3 py-2 text-sm ${textPrimary} ${hoverBg} transition-colors flex items-center gap-2`}
                onClick={() => openHGAdjust(projectId, date)}
              >
                <Clock size={14} />
                Adjust time
              </button>
              {!isCompleted && (
                <button
                  className={`w-full text-left px-3 py-2 text-sm text-red-500 ${hoverBg} transition-colors flex items-center gap-2`}
                  onClick={() => cancelHGSession(projectId, date)}
                >
                  <X size={14} />
                  Cancel session
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* HyperGLANCE Adjust Session Time Modal */}
      {hgAdjustModal && <HGAdjustModal />}

      {/* HyperGLANCE Edit Project (triggered from bar context menu) */}
      {pendingEditProjectId && (() => {
        const proj = projects.find(p => p.id === pendingEditProjectId);
        if (!proj) return null;
        return (
          <FormOverlay onClose={() => setPendingEditProjectId(null)} mobile={isMobile} cardBg={cardBg}>
            <ProjectForm
              initial={proj}
              goals={goals}
              onSave={saveEditProjectFromBar}
              onCancel={() => setPendingEditProjectId(null)}
              mobile={isMobile}
            />
          </FormOverlay>
        );
      })()}

      {/* Goals & Projects Dashboard */}
      <GoalDashboard />

      {/* Weekly Review Modal */}
      <WeeklyReviewModal />

      {/* Mobile Routine Time Picker (outside routines dashboard modal) */}
      {isMobile && routineTimePickerChipId !== null && !showRoutinesDashboard && (
        <ClockTimePicker
          value={dashboardSelectedChips.find(c => c.id === routineTimePickerChipId)?.startTime || '09:00'}
          onChange={(time) => {
            setDashboardSelectedChips(prev => prev.map(c => c.id === routineTimePickerChipId ? { ...c, startTime: time } : c));
            setRoutineTimePickerChipId(null);
          }}
          onClose={() => setRoutineTimePickerChipId(null)}
          darkMode={darkMode} isTablet={isTablet} use24HourClock={use24HourClock}
        />
      )}

      {/* Welcome Modal for New Users */}
      {showWelcome && isMobile && <MobileWelcomeModal />}
      {showWelcome && !isMobile && <DesktopWelcomeModal />}

      {/* Voice Input Modal (Phase 1) */}
      <VoiceInputModal />
      {/* GTD Frames Modal (Desktop/Tablet) */}
      {showFramesModal && !isMobile && <FramesModal />}
    </div>
    </FeaturesContext.Provider>
    </SyncContext.Provider>
    </DayPlannerContext.Provider>
  );
};

export default DayPlanner;