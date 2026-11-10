import { useEffect } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { isMonthDaySheetOpen } from '../components/month/MonthDaySheet.jsx';
import { cyclerStates, nextState, VIEW_SHORTCUT_KEYS } from '../constants/views.js';
import { aiFeatureOn } from '../ai.js';
import { readDefaultTaskDuration } from '../utils/defaultTaskDuration.js';

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

// Where Cmd+Z belongs to the field, not the app: anything the user types text
// into keeps the browser's own undo of that typing. A checkbox, a slider or a
// button has no undo of its own, so the app's still runs there.
const NON_TEXT_INPUT_TYPES = new Set([
  'button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit',
]);
export const isTextEntryTarget = (target) => {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag !== 'INPUT') return false;
  return !NON_TEXT_INPUT_TYPES.has(String(target.type || 'text').toLowerCase());
};

// The shortcuts that only make sense with the calendar on screen: date
// navigation (arrows, 't'), the MONTH cursor and its popup ('m', Space, Up,
// Down, Enter), the view cycler and its direct jumps (1–6, 'c'), focus mode
// ('f', a block of today's timeline), and the calendar side panel's tag filter
// and tabs ('/', ',', '.'). Everything else is app-level and works in both
// spaces. Modifier combos never count: they are handled before this runs.
const CALENDAR_ONLY_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', 'Enter',
  't', 'm', 'f', '/', ',', '.', 'c', 'C',
  ...Object.values(VIEW_SHORTCUT_KEYS),
]);
export const isCalendarOnlyShortcut = (e) =>
  !e.ctrlKey && !e.metaKey && !e.altKey && CALENDAR_ONLY_KEYS.has(e.key);

export default function useKeyboardShortcuts({
  // undo/redo
  performUndo, performRedo,
  // spotlight
  setShowSpotlight, setSpotlightQuery, setSpotlightSelectedIndex, playUISound,
  // shortcut help
  setShowShortcutHelp,
  // modal guard state
  showAddTask, showFocusMode, showRoutinesDashboard, showShortcutHelp, showSpotlight,
  showSettings, showRemindersSettings, showWeeklyReview, showVoiceInput,
  showHabitModal, showFramesModal, frameAdjustModal, showRescheduleModal, showGoalsDashboard,
  // day dial ('o') — the overlay owns its own keys (Esc, arrows) while open
  showDayDial, setShowDayDial,
  // an open Project Planner owns its keys too (arrows, Enter)
  plannerProjectId = null,
  showTagManager = false,
  setShowTagManager = () => {},
  // bucket list ('u')
  showBucketList, setShowBucketList,
  // new task ('n' / 'i')
  selectedDate, hoverPreviewTime, hoverPreviewDate,
  setNewTask, setShowAddTask, setHoverPreviewTime, setHoverPreviewDate,
  // routines ('r')
  routinesEnabled, setRoutinesEnabled, openRoutinesDashboardRef,
  // focus mode ('f') — passed as a ref to avoid TDZ
  focusModeAvailableRef, enterFocusModeRef,
  // dark mode ('d')
  setDarkMode,
  // today ('t')
  showMonthView, goToToday, setViewedMonth,
  // month view ('m')
  setShowMonthView,
  // MONTH view cursor (Space, Shift+Space, Up, Down, Enter)
  monthViewActive, openMonthDaySheetRef,
  // tag filter ('/')
  setShowMobileTagFilter,
  // backup menu ('b')
  setShowBackupMenu,
  // panel tabs (',', '.')
  isMobile, tabletActiveTab, setTabletActiveTab,
  // voice input ('v')
  aiConfig, setShowVoiceInput,
  // habits ('h')
  habitsEnabled, setHabitsEnabled, setShowHabitModal,
  // goals & projects ('g') — on desktop the key TOGGLES the Goals space;
  // showGoalsDashboard (above) is true while that space is active
  goalsProjectsEnabled, toggleDesktopSpace,
  // Goals & Projects space sidebar: { moveSelection(delta), setTab(tab) } while
  // the space is active (registered by GoalDashboard), else null
  goalsSpaceKeysRef,
  // reschedule ('e')
  gtdFrames, setShowRescheduleModal, setRescheduleResults, setRescheduleError,
  // settings ('s')
  setMobileActiveTab, setMobileSettingsView, setShowSettings,
  // date navigation (arrows)
  changeDate, setSelectedDate,
  // view cycler (1/2/3)
  setViewMode, canShowViewCycler, schedOnlyCycler, effectiveViewMode, hiddenViews,
}) {
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Undo/Redo. In a text field the keys undo the typing, as everywhere
      // else; the app's undo would revert tasks behind the field instead.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !isTextEntryTarget(e.target)) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          performUndo();
          return;
        }
        if ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault();
          performRedo();
          return;
        }
      }

      // Cmd+K / Ctrl+K for spotlight search (works even in inputs)
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowSpotlight(prev => {
          if (!prev) {
            setSpotlightQuery('');
            setSpotlightSelectedIndex(0);
            playUISound('spotlight');
          }
          return !prev;
        });
        return;
      }

      // '?' for shortcut cheat sheet (works even in inputs)
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Don't trigger in inputs unless it's already showing (to allow closing)
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
          return;
        }
        e.preventDefault();
        setShowShortcutHelp(prev => !prev);
        return;
      }

      // Don't trigger if typing in an input or textarea
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
        return;
      }

      // Don't trigger shortcuts when a modal is open (except Escape and ? handled above)
      // An open PLANNER is modal too: it takes its own keys (ProjectPlanner),
      // and nothing behind it, the calendar or the project list, moves.
      if (showAddTask || showFocusMode || showRoutinesDashboard || showShortcutHelp || showSpotlight || showSettings || showRemindersSettings || showWeeklyReview || showVoiceInput || showHabitModal || showFramesModal || frameAdjustModal || showRescheduleModal || showBucketList || showDayDial || plannerProjectId || showTagManager) {
        return;
      }
      // The Goals & Projects space is not a modal: it swaps the sidebar and the
      // main area for the calendar, and the header keeps its icon cluster. So
      // the app-level shortcuts (new task, settings, dark mode, 'g' itself…)
      // keep working there, and only the CALENDAR shortcuts stand down: the
      // ones that navigate dates, pick a calendar view, or drive the calendar
      // side panel, none of which is on screen. Enumerated rather than
      // blanket-blocked so a new app-level shortcut works in both spaces.
      const goalsSpaceActive = !isMobile && showGoalsDashboard;
      if (goalsSpaceActive) {
        // The keys the calendar uses for dates and its side panel drive the
        // space's sidebar instead: Up/Down move the selection, ',' and '.'
        // pick the Goals / Projects tab (as they pick GLANCE / inbox), '/'
        // focuses the project filter (as it opens the tag filter), and 'n'
        // makes a new goal or project — whatever the current tab shows —
        // rather than a scheduled task the space has no timeline for.
        const keys = goalsSpaceKeysRef?.current;
        if (keys && !e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.key === 'Enter' && keys.openSelected?.()) {
            e.preventDefault();
            return;
          }
          if (e.key === 'n') {
            e.preventDefault();
            keys.newItem();
            return;
          }
          if (e.key === '/') {
            e.preventDefault();
            keys.focusFilter();
            return;
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            keys.moveSelection(e.key === 'ArrowUp' ? -1 : 1);
            return;
          }
          if (e.key === ',' || e.key === '.') {
            e.preventDefault();
            keys.setTab(e.key === ',' ? 'goals' : 'projects');
            return;
          }
        }
        if (isCalendarOnlyShortcut(e)) return;
      }
      // The month view's day sheet is modal too: its own controller owns the
      // arrow keys (previous/next day) and Escape while it is open.
      if (isMonthDaySheetOpen()) {
        return;
      }

      const noModifiers = !e.ctrlKey && !e.metaKey && !e.altKey;

      // MONTH: the selection is a cursor over the grid. Space and Shift+Space
      // step a day, Up and Down a week (Left and Right page months, below,
      // like every view's stride), Enter opens the selected day's sheet.
      // Space is claimed even with a cell focused, where it would otherwise
      // activate the cell; Enter still does, and now opens the same day.
      if (monthViewActive && noModifiers) {
        const stepDays = (n) => setSelectedDate(prev => {
          const d = new Date(prev);
          d.setDate(d.getDate() + n);
          d.setHours(12, 0, 0, 0);
          return d;
        });
        if (e.key === ' ') {
          e.preventDefault();
          stepDays(e.shiftKey ? -1 : 1);
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          stepDays(e.key === 'ArrowUp' ? -7 : 7);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          openMonthDaySheetRef?.current?.();
          return;
        }
      }

      // 'n' for new scheduled task
      if (e.key === 'n' && noModifiers) {
        e.preventDefault();
        setNewTask({
          title: '',
          startTime: hoverPreviewTime || getNextQuarterHour(),
          duration: readDefaultTaskDuration(),
          date: hoverPreviewDate ? dateToString(hoverPreviewDate) : dateToString(selectedDate),
          isAllDay: false,
          openInInbox: false
        });
        setHoverPreviewTime(null);
        setHoverPreviewDate(null);
        setShowAddTask(true);
      }

      // 'i' for new inbox task
      if (e.key === 'i' && noModifiers) {
        e.preventDefault();
        setNewTask({
          title: '',
          duration: readDefaultTaskDuration(),
          openInInbox: true
        });
        setShowAddTask(true);
      }

      // 'r' for routines dashboard
      if (e.key === 'r' && noModifiers) {
        e.preventDefault();
        if (!routinesEnabled) setRoutinesEnabled(true);
        if (isMobile) {
          setMobileActiveTab('routines');
        } else {
          openRoutinesDashboardRef.current?.();
        }
      }

      // 'f' for focus mode (only when available)
      if (e.key === 'f' && noModifiers) {
        e.preventDefault();
        if (focusModeAvailableRef.current) {
          enterFocusModeRef.current?.();
        }
      }

      // 'd' to toggle dark mode
      if (e.key === 'd' && noModifiers) {
        e.preventDefault();
        setDarkMode(prev => !prev);
      }

      // 't' to jump to today
      if (e.key === 't' && noModifiers) {
        e.preventDefault();
        goToToday();
        if (showMonthView) {
          const today = new Date();
          setViewedMonth(new Date(today.getFullYear(), today.getMonth(), 1));
        }
      }

      // 'm' to toggle month view
      if (e.key === 'm' && noModifiers) {
        e.preventDefault();
        setShowMonthView(prev => !prev);
      }

      // '/' to toggle tag filter — only when GLANCE is active
      if (e.key === '/' && noModifiers && (isMobile || tabletActiveTab === 'glance')) {
        e.preventDefault();
        setShowMobileTagFilter(prev => !prev);
      }

      // '#' opens the Tag manager (rename, merge or remove tags across tasks,
      // #2136), which was found only at the foot of the tag filter. '#' is
      // already "tag" in a task title. Read from the character, so it works
      // on any layout; Alt is allowed, as some Mac layouts type it with
      // Option+3. Not a calendar shortcut: it works in the Goals space too.
      if (e.key === '#' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShowMobileTagFilter(false);
        setShowTagManager(true);
      }

      // 'b' to toggle backup menu
      if (e.key === 'b' && noModifiers) {
        e.preventDefault();
        setShowBackupMenu(prev => !prev);
      }

      // ',' to switch side panel to Glance
      if (e.key === ',' && noModifiers && !isMobile) {
        e.preventDefault();
        setTabletActiveTab('glance');
        setShowMobileTagFilter(false);
      }

      // '.' to switch side panel to Inbox
      if (e.key === '.' && noModifiers && !isMobile) {
        e.preventDefault();
        setTabletActiveTab('inbox');
        setShowMobileTagFilter(false);
      }

      // 'v' for voice task input — never gated: voice works without AI, and
      // the Settings › AI toggle only decides whether AI is used for it.
      if (e.key === 'v' && noModifiers) {
        e.preventDefault();
        setShowVoiceInput(true);
      }

      // 'o' for the Day Dial (the key is the shape of the dial)
      if (e.key === 'o' && noModifiers) {
        e.preventDefault();
        setShowDayDial(true);
      }

      // 'u' for the bUcket List
      if (e.key === 'u' && noModifiers) {
        e.preventDefault();
        setShowBucketList(true);
      }

      // 'g' toggles the Goals & Projects space on desktop (from either space,
      // including while in Goals) and opens the Goals tab on the phone. Inert
      // while the feature is off in Settings: the switch is the only way in.
      if (e.key === 'g' && noModifiers) {
        e.preventDefault();
        if (!goalsProjectsEnabled) return;
        if (isMobile) {
          setMobileActiveTab('goals');
        } else {
          toggleDesktopSpace();
        }
      }

      // 'h' for habits modal
      if (e.key === 'h' && noModifiers) {
        e.preventDefault();
        if (!habitsEnabled) setHabitsEnabled(true);
        setShowHabitModal(true);
      }

      // 'e' for end-of-day reschedule
      if (e.key === 'e' && noModifiers && aiFeatureOn(aiConfig, 'aiReschedule') && gtdFrames.filter(f => f.enabled).length > 0) {
        e.preventDefault();
        setShowRescheduleModal(true);
        setRescheduleResults(null);
        setRescheduleError('');
      }

      // 's' for settings (Smart Schedule moved off the shortcut — it stays
      // reachable via the Inbox button, GLANCE AI prompts, and the Frames FAB)
      if (e.key === 's' && noModifiers) {
        e.preventDefault();
        if (isMobile) {
          setMobileActiveTab('settings');
          setMobileSettingsView('main');
        } else {
          setShowSettings(true);
        }
      }

      // 1/2/3/4/5 to jump directly to multi/day/week/month/sched view: the
      // views the cycler offers at this width, minus any turned off on this
      // device. (The Day Dial's modal check above already stands every
      // shortcut down while it is up, MONTH included.)
      if (noModifiers && (canShowViewCycler || schedOnlyCycler) && Object.values(VIEW_SHORTCUT_KEYS).includes(e.key)) {
        const view = Object.keys(VIEW_SHORTCUT_KEYS).find((v) => VIEW_SHORTCUT_KEYS[v] === e.key);
        if (cyclerStates(canShowViewCycler, showDayDial, hiddenViews).includes(view)) {
          e.preventDefault();
          setViewMode(view);
        }
      }
      // C cycles through whichever views the current width offers — always
      // valid, unlike the direct-jump numbers (2/3 need the 3-column grid).
      if ((e.key === 'c' || e.key === 'C') && noModifiers && (canShowViewCycler || schedOnlyCycler)) {
        e.preventDefault();
        const states = cyclerStates(canShowViewCycler, showDayDial, hiddenViews);
        // Cycle from the EFFECTIVE mode, matching the ViewCycler: a stored
        // DAY/WEEK renders as MULTI at narrow widths, so cycling must start
        // from what's on screen, not the raw stored mode.
        setViewMode(nextState(states, effectiveViewMode));
      }

      // Arrow left/right to navigate dates
      if (e.key === 'ArrowLeft' && noModifiers) {
        e.preventDefault();
        changeDate(-1);
        if (showMonthView) {
          // Sync viewed month after date change
          setSelectedDate(prev => {
            setViewedMonth(new Date(prev.getFullYear(), prev.getMonth(), 1));
            return prev;
          });
        }
      }
      if (e.key === 'ArrowRight' && noModifiers) {
        e.preventDefault();
        changeDate(1);
        if (showMonthView) {
          setSelectedDate(prev => {
            setViewedMonth(new Date(prev.getFullYear(), prev.getMonth(), 1));
            return prev;
          });
        }
      }
    };

    document.addEventListener('keydown', handleGlobalKeyDown);
    return () => document.removeEventListener('keydown', handleGlobalKeyDown);
    // Deps list the state the handler branches on (incl. tabletActiveTab, read by
    // the '/' shortcut). The omitted names are setX setters, *Ref values, and the
    // action callbacks (changeDate/goToToday/performUndo/performRedo/playUISound),
    // all stable or read through refs — listing them would needlessly re-bind.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthViewActive, selectedDate, showAddTask, showShortcutHelp, showFocusMode, showRoutinesDashboard, showHabitModal, showMonthView, showSpotlight, showSettings, showRemindersSettings, showWeeklyReview, showVoiceInput, showFramesModal, frameAdjustModal, showRescheduleModal, showGoalsDashboard, showBucketList, showDayDial, plannerProjectId, showTagManager, hoverPreviewTime, hoverPreviewDate, isMobile, tabletActiveTab, routinesEnabled, habitsEnabled, goalsProjectsEnabled, aiConfig, gtdFrames, canShowViewCycler, schedOnlyCycler, effectiveViewMode, hiddenViews]);
}
