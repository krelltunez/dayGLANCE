import { useCallback } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { getNextOccurrence } from '../utils/recurrenceEngine.js';
import { shiftDateByMonths } from '../utils/monthGrid.js';
import { shiftWeekStripDate } from '../utils/weekViewDates.js';
import { stepDayView } from '../utils/dayViewColumns.js';
import { revealTask } from './useIncrementalList.js';

export default function useNavigation({
  visibleDays,
  effectiveViewMode,
  monthViewActive = false,
  weekViewMode = 'strict',
  weekStartDay = 0,
  dayViewMode = 'calendar-day',
  rollingDayPausedOn = null,
  setRollingDayPausedOn = () => {},
  selectedDate,
  setSelectedDate,
  setShowMonthView,
  setShowSpotlight,
  isMobile,
  setMobileActiveTab,
  setTabletActiveTab,
  setInboxProjectFilter,
  setInboxArchivedExpanded,
  setDailyNotesModalDate,
  calendarRef,
  closePlanner = () => {},
  openGoalsTarget = () => {},
  setDesktopSpace = () => {},
}) {
  const changeDate = useCallback((direction) => {
    // MONTH: the chrome's arrows page whole months, keeping the day of the
    // month where it exists (Jan 31 → Feb 28, not Mar 3).
    if (monthViewActive) {
      setSelectedDate(prev => shiftDateByMonths(prev, direction));
      return;
    }
    // WEEK / SCHED: page to the strip adjacent to the one on screen, which a
    // plain seven-day shift misses around a rolling strip (#2045).
    if (effectiveViewMode === 'week' || effectiveViewMode === 'sched') {
      setSelectedDate(prev => shiftWeekStripDate({
        direction, selectedDate: prev, viewMode: effectiveViewMode, weekViewMode, weekStartDay,
      }));
      return;
    }
    // DAY: rolling-24 hides today's earlier hours, so today is two pages
    // (#2045). Both values change together, so this reads the rendered ones.
    if (effectiveViewMode === 'day') {
      const step = stepDayView({ direction, selectedDate, dayViewMode, rollingPausedOn: rollingDayPausedOn });
      setRollingDayPausedOn(step.rollingPausedOn);
      setSelectedDate(step.selectedDate);
      return;
    }
    const stride = effectiveViewMode === 'jobo' ? 1 : visibleDays;
    setSelectedDate(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + (direction * stride));
      newDate.setHours(12, 0, 0, 0);
      return newDate;
    });
  }, [setSelectedDate, visibleDays, effectiveViewMode, monthViewActive, weekViewMode, weekStartDay,
    dayViewMode, rollingDayPausedOn, setRollingDayPausedOn, selectedDate]);

  const goToToday = useCallback(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    setSelectedDate(today);
    setRollingDayPausedOn(null);
  }, [setSelectedDate, setRollingDayPausedOn]);

  const goToDate = useCallback((date) => {
    let newDate;
    if (typeof date === 'string') {
      const [y, m, d] = date.split('-').map(Number);
      newDate = new Date(y, m - 1, d, 12, 0, 0, 0);
    } else {
      newDate = new Date(date);
      newDate.setHours(12, 0, 0, 0);
    }
    setSelectedDate(newDate);
    setShowMonthView(false);
  }, [setSelectedDate, setShowMonthView]);

  // Scroll a task's card or row into view and ring it for two seconds.
  //
  // A card inside the calendar's scroll container is centred in it. Anything
  // else is scrolled in whatever list holds it: an Inbox row (`ownScroller`,
  // which the calendar's container left far down the Inbox off screen), an
  // all-day card in the header, an agenda card. `onMissing` runs when nothing
  // matches once the delay is up (the row is filtered out of its list, say),
  // so a click that asked for a task is never a click that does nothing.
  const scrollAndHighlight = useCallback((selector, delay = 300, { ownScroller = false, onMissing } = {}) => {
    setTimeout(() => {
      const el = document.querySelector(selector);
      if (!el) { onMissing?.(); return; }
      const container = calendarRef.current;
      if (ownScroller || !container?.contains?.(el)) {
        el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      } else {
        const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
        const scrollTarget = Math.max(0, elTop - container.clientHeight / 2 + el.offsetHeight / 2);
        container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
      }
      el.classList.add('ring-2', 'ring-blue-400');
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
    }, delay);
  }, [calendarRef]);

  // Show an Inbox task's row: the Inbox tab, the project filter that lists it,
  // the part of the list that holds it, then scroll and ring. An archived task
  // is in the Archived bar under the list instead.
  const goToInboxTask = useCallback((task, { onMissing } = {}) => {
    if (isMobile) {
      setMobileActiveTab('inbox');
    } else {
      setTabletActiveTab('inbox');
    }
    if (task.archived) {
      setInboxArchivedExpanded(true);
      scrollAndHighlight(`[data-task-id="${task.id}"]`, 500, { onMissing });
      return;
    }
    // Apply project filter for project tasks; clear it for plain inbox tasks
    setInboxProjectFilter(task.projectId ? [task.projectId] : []);
    // The Inbox renders a part at a time: make sure this row is rendered.
    revealTask(task.id);
    scrollAndHighlight(`[data-task-id="${task.id}"]`, 300, { ownScroller: true, onMissing });
  }, [isMobile, setMobileActiveTab, setTabletActiveTab, setInboxProjectFilter, setInboxArchivedExpanded, scrollAndHighlight]);

  // A row of the Overdue list (#2418). A scheduled task is found on the
  // timeline, in every view: on the date it is on, scrolled to and ringed. An
  // Inbox task whose deadline has passed has no place on the timeline, and its
  // row did nothing at all; it is found in the Inbox.
  const goToOverdueTask = useCallback((task, { onMissing } = {}) => {
    if (!task) return;
    if (task._overdueType === 'deadline') {
      setDesktopSpace('calendar');
      goToInboxTask(task, { onMissing });
      return;
    }
    // The timeline's card, or the agenda's (SCHED lists a task, it has no grid).
    const selector = `[data-task-id="${task.id}"], [data-sched-task="${task.id}"]`;
    if (isMobile) setMobileActiveTab('timeline');
    // A card already on screen is ringed where it is; changing the date for it
    // would only shift the columns under the user.
    const shown = !isMobile && !!document.querySelector(selector);
    if (!shown && task.date) goToDate(task.date);
    scrollAndHighlight(selector, shown ? 0 : 300, { onMissing });
  }, [isMobile, setMobileActiveTab, setDesktopSpace, goToDate, goToInboxTask, scrollAndHighlight]);

  const handleSpotlightSelect = useCallback((result) => {
    setShowSpotlight(false);
    // Every result navigates somewhere the Project Planner's overlay would
    // cover: the calendar, the inbox or the Goals space (#2131).
    closePlanner();
    const { task, source } = result;
    // The calendar and the Inbox are hidden, and inert, while the Goals &
    // Projects space is up: every other result is in the Calendar space
    // (#2231). A no-op on a phone, which has a tab instead.
    if (source !== 'goal' && source !== 'project' && source !== 'area') setDesktopSpace('calendar');

    if (source === 'scheduled' || source === 'event') {
      if (isMobile) {
        setMobileActiveTab('timeline');
      }
      goToDate(task.date);
      // Native calendar events are fetched per-date, so the card may not exist
      // until the timeline re-fetches the target day — give it a little longer.
      scrollAndHighlight(`[data-task-id="${task.id}"]`, source === 'event' ? 600 : 300);
    } else if (source === 'inbox' || source === 'archived') {
      // An archived task (`task.archived`, the 'archived' source) is in the
      // Archived bar; goToInboxTask opens that instead of the list.
      goToInboxTask(source === 'archived' ? { ...task, archived: true } : task);
    } else if (source === 'recurring') {
      const date = getNextOccurrence(task) || task.recurrence?.startDate || dateToString(new Date());
      if (isMobile) {
        setMobileActiveTab('timeline');
      }
      goToDate(date);
      scrollAndHighlight(`[data-task-id="recurring-${task.id}-${date}"]`);
    } else if (source === 'deleted') {
      scrollAndHighlight(`[data-task-id="bin-${task.id}"]`);
    } else if (source === 'dailynote') {
      // A daily-note hit opens that day's note on top of the day it belongs to.
      if (isMobile) {
        setMobileActiveTab('timeline');
      }
      goToDate(result.date);
      setDailyNotesModalDate?.(result.date);
    } else if (source === 'goal' || source === 'project' || source === 'area') {
      // The Goals & Projects space on that goal, project or area, as the
      // launcher's links open it (#2131).
      openGoalsTarget(source, task.id);
    }
  }, [setShowSpotlight, isMobile, setMobileActiveTab, setDailyNotesModalDate, goToDate, closePlanner, openGoalsTarget, setDesktopSpace, goToInboxTask, scrollAndHighlight]);

  return { changeDate, goToToday, goToDate, handleSpotlightSelect, goToOverdueTask };
}
