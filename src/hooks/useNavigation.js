import { useCallback } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { getNextOccurrence } from '../utils/recurrenceEngine.js';

export default function useNavigation({
  visibleDays,
  setSelectedDate,
  setShowMonthView,
  setShowSpotlight,
  isMobile,
  setMobileActiveTab,
  setTabletActiveTab,
  setInboxProjectFilter,
  setInboxArchivedExpanded,
  calendarRef,
}) {
  const changeDate = useCallback((direction) => {
    setSelectedDate(prev => {
      const newDate = new Date(prev);
      newDate.setDate(newDate.getDate() + (direction * visibleDays));
      newDate.setHours(12, 0, 0, 0);
      return newDate;
    });
  }, [setSelectedDate, visibleDays]);

  const goToToday = useCallback(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    setSelectedDate(today);
  }, [setSelectedDate]);

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

  const handleSpotlightSelect = useCallback((result) => {
    setShowSpotlight(false);
    const { task, source } = result;

    const scrollAndHighlight = (selector, delay = 300) => {
      setTimeout(() => {
        const el = document.querySelector(selector);
        if (el && calendarRef.current) {
          const container = calendarRef.current;
          const elTop = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
          const scrollTarget = Math.max(0, elTop - container.clientHeight / 2 + el.offsetHeight / 2);
          container.scrollTo({ top: scrollTarget, behavior: 'smooth' });
          el.classList.add('ring-2', 'ring-blue-400');
          setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400'), 2000);
        }
      }, delay);
    };

    if (source === 'scheduled') {
      if (isMobile) {
        setMobileActiveTab('timeline');
      }
      goToDate(task.date);
      scrollAndHighlight(`[data-task-id="${task.id}"]`);
    } else if (source === 'inbox') {
      if (isMobile) {
        setMobileActiveTab('inbox');
      } else {
        setTabletActiveTab('inbox');
      }
      // Apply project filter for project tasks; clear it for plain inbox tasks
      setInboxProjectFilter(task.projectId ? [task.projectId] : []);
      scrollAndHighlight(`[data-task-id="${task.id}"]`);
    } else if (source === 'archived') {
      if (isMobile) {
        setMobileActiveTab('inbox');
      } else {
        setTabletActiveTab('inbox');
      }
      setInboxArchivedExpanded(true);
      scrollAndHighlight(`[data-task-id="${task.id}"]`, 500);
    } else if (source === 'recurring') {
      const date = getNextOccurrence(task) || task.recurrence?.startDate || dateToString(new Date());
      if (isMobile) {
        setMobileActiveTab('timeline');
      }
      goToDate(date);
      scrollAndHighlight(`[data-task-id="recurring-${task.id}-${date}"]`);
    } else if (source === 'deleted') {
      scrollAndHighlight(`[data-task-id="bin-${task.id}"]`);
    }
  }, [setShowSpotlight, isMobile, setMobileActiveTab, setTabletActiveTab, setInboxProjectFilter, setInboxArchivedExpanded, calendarRef, goToDate]);

  return { changeDate, goToToday, goToDate, handleSpotlightSelect };
}
