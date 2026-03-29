import { useEffect } from 'react';
import { dateToString } from '../utils/taskUtils.js';

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
  // new task ('n' / 'i')
  selectedDate, hoverPreviewTime, hoverPreviewDate,
  setNewTask, setShowAddTask, setHoverPreviewTime, setHoverPreviewDate,
  // routines ('r')
  routinesEnabled, setRoutinesEnabled, setShowRoutinesDashboard,
  // focus mode ('f') — passed as a ref to avoid TDZ
  focusModeAvailableRef, enterFocusModeRef,
  // dark mode ('d')
  setDarkMode,
  // today ('t')
  showMonthView, goToToday, setViewedMonth,
  // month view ('m')
  setShowMonthView,
  // tag filter ('/')
  setShowMobileTagFilter,
  // backup menu ('b')
  setShowBackupMenu,
  // panel tabs (',', '.')
  isMobile, setTabletActiveTab,
  // voice input ('v')
  aiConfig, setShowVoiceInput,
  // habits ('h')
  habitsEnabled, setHabitsEnabled, setShowHabitModal,
  // goals & projects ('g')
  goalsProjectsEnabled, setGoalsProjectsEnabled, setShowGoalsDashboard,
  // reschedule ('e')
  gtdFrames, setShowRescheduleModal, setRescheduleResults, setRescheduleError,
  // smart schedule ('s')
  setMobileActiveTab, setFramesModalTab, setEditingFrame, setShowFramesModal,
  // date navigation (arrows)
  changeDate, setSelectedDate,
}) {
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      // Undo/Redo — works even when focus is in an input/textarea
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
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
      if (showAddTask || showFocusMode || showRoutinesDashboard || showShortcutHelp || showSpotlight || showSettings || showRemindersSettings || showWeeklyReview || showVoiceInput || showHabitModal || showFramesModal || frameAdjustModal || showRescheduleModal || showGoalsDashboard) {
        return;
      }

      const noModifiers = !e.ctrlKey && !e.metaKey && !e.altKey;

      // 'n' for new scheduled task
      if (e.key === 'n' && noModifiers) {
        e.preventDefault();
        setNewTask({
          title: '',
          startTime: hoverPreviewTime || getNextQuarterHour(),
          duration: 30,
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
          duration: 30,
          openInInbox: true
        });
        setShowAddTask(true);
      }

      // 'r' for routines dashboard
      if (e.key === 'r' && noModifiers) {
        e.preventDefault();
        if (!routinesEnabled) setRoutinesEnabled(true);
        setShowRoutinesDashboard(true);
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

      // '/' to toggle tag filter
      if (e.key === '/' && noModifiers) {
        e.preventDefault();
        setShowMobileTagFilter(prev => !prev);
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
      }

      // '.' to switch side panel to Inbox
      if (e.key === '.' && noModifiers && !isMobile) {
        e.preventDefault();
        setTabletActiveTab('inbox');
      }

      // 'v' for voice task input
      if (e.key === 'v' && noModifiers && aiConfig.enabled && aiConfig.features.voiceTaskInput) {
        e.preventDefault();
        setShowVoiceInput(true);
      }

      // 'g' for goals & projects dashboard (also auto-enables the feature on first use)
      if (e.key === 'g' && noModifiers) {
        e.preventDefault();
        if (!goalsProjectsEnabled) setGoalsProjectsEnabled(true);
        setShowGoalsDashboard(true);
      }

      // 'h' for habits modal
      if (e.key === 'h' && noModifiers) {
        e.preventDefault();
        if (!habitsEnabled) setHabitsEnabled(true);
        setShowHabitModal(true);
      }

      // 'e' for end-of-day reschedule
      if (e.key === 'e' && noModifiers && aiConfig?.enabled && aiConfig.features?.aiReschedule && gtdFrames.filter(f => f.enabled).length > 0) {
        e.preventDefault();
        setShowRescheduleModal(true);
        setRescheduleResults(null);
        setRescheduleError('');
      }

      // 's' for smart schedule (open frames modal on schedule tab)
      if (e.key === 's' && noModifiers && aiConfig?.enabled && aiConfig.features?.smartScheduling && gtdFrames.filter(f => f.enabled).length > 0) {
        e.preventDefault();
        if (isMobile) {
          setMobileActiveTab('frames');
          setFramesModalTab('schedule');
          setEditingFrame(null);
        } else {
          setShowFramesModal(true);
          setFramesModalTab('schedule');
          setEditingFrame(null);
        }
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
  }, [selectedDate, showAddTask, showShortcutHelp, showFocusMode, showRoutinesDashboard, showMonthView, showSpotlight, showSettings, showRemindersSettings, showWeeklyReview, showVoiceInput, showFramesModal, frameAdjustModal, showRescheduleModal, showGoalsDashboard, hoverPreviewTime, hoverPreviewDate, isMobile, routinesEnabled, habitsEnabled, goalsProjectsEnabled, aiConfig, gtdFrames]);
}
