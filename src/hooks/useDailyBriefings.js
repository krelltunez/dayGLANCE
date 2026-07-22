import { useEffect, useCallback } from 'react';
import { aiComplete } from '../ai.js';
import {
  morningSummarySystemPrompt, morningSummaryUserPrompt,
  eveningReflectionSystemPrompt, eveningReflectionUserPrompt,
} from '../ai-prompts.js';
import { dateToString, localDateStr } from '../utils/taskUtils.js';
import { getOccurrencesInRange } from '../utils/recurrenceEngine.js';

/**
 * AI daily briefings — extracted from App.jsx (see "App.jsx — Ongoing
 * Decomposition" in CLAUDE.md), logic moved verbatim.
 *
 * Owns the Morning dayGLANCE summary and the Evening Reflection: data
 * gathering from the task lists, the aiComplete calls, the per-day
 * localStorage caches, dismissal, and the day-rollover reset effects.
 * Glance state stays owned by useVoiceAI and is passed in.
 */
export default function useDailyBriefings({
  aiConfig,
  tasks, recurringTasks, unscheduledTasks,
  goalsProjectsEnabled,
  isVisibleForUser, getOverdueTasks,
  setMorningGlanceText, setMorningGlanceLoading, setMorningGlanceError, setMorningGlanceDismissed,
  setEveningGlanceText, setEveningGlanceLoading, setEveningGlanceError, setEveningGlanceDismissed,
}) {
  // --- Morning dayGLANCE (AI morning summary) ---
  const generateMorningSummary = useCallback(async (force = false) => {
    if (!aiConfig.enabled || (!aiConfig.apiKey && aiConfig.provider !== 'ollama') || !aiConfig.features.morningSummary) return;
    const todayStr = dateToString(new Date());
    // Check cache (skip when force-regenerating via the refresh button)
    try {
      const cached = localStorage.getItem('day-planner-morning-glance');
      if (cached && !force) {
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
      const scheduledToday = tasks.filter(t => t.date === todayStr && !t.imported && !t.isExample && isVisibleForUser(t));
      // Gather imported calendar events for today
      const calendarEventsToday = tasks.filter(t => t.date === todayStr && t.imported && !t.isTaskCalendar)
        .map(t => ({ title: t.title, time: t.startTime, isAllDay: t.isAllDay || false, duration: t.duration || 0 }))
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      // Gather today's recurring tasks (series-level assignment → filter templates)
      const todayRecurring = recurringTasks.filter(isVisibleForUser).flatMap(t => {
        const occs = getOccurrencesInRange(t, todayStr, todayStr);
        return occs.map(() => ({ title: t.title, time: t.startTime, completed: (t.completedDates || []).includes(todayStr) }));
      }).filter(t => !t.completed);
      // Inbox count — split into free inbox tasks vs project-assigned tasks
      const activeUnscheduled = unscheduledTasks.filter(t => !t.completed && !t.isExample && isVisibleForUser(t));
      const inboxCount = activeUnscheduled.filter(t => !goalsProjectsEnabled || !t.projectId).length;
      const projectTaskCount = goalsProjectsEnabled ? activeUnscheduled.filter(t => t.projectId).length : 0;
      // Overdue tasks
      const overdue = getOverdueTasks();
      const overdueTasks = overdue.filter(t => t.date !== todayStr).slice(0, 5);
      // Deadlines
      const deadlinesToday = unscheduledTasks.filter(t => t.deadline === todayStr && !t.completed && isVisibleForUser(t));
      const nextWeek = new Date(todayDate);
      nextWeek.setDate(nextWeek.getDate() + 7);
      const nextWeekStr = dateToString(nextWeek);
      const upcomingDeadlines = unscheduledTasks.filter(t => t.deadline && t.deadline > todayStr && t.deadline <= nextWeekStr && !t.completed && isVisibleForUser(t)).slice(0, 5);
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
    // Curated deps: the inputs that should regenerate the briefing. getOverdueTasks
    // is an unstable helper read at call time (listing it would defeat this
    // callback's memoization); the setters and isVisibleForUser are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConfig, tasks, recurringTasks, unscheduledTasks]);

  const dismissMorningGlance = useCallback(() => {
    setMorningGlanceDismissed(true);
    localStorage.setItem('day-planner-mg-dismissed', localDateStr());
  }, [setMorningGlanceDismissed]);

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
  }, [aiConfig.enabled, aiConfig.features.morningSummary, setMorningGlanceDismissed, setMorningGlanceText]);

  // --- Evening Reflection ---
  const generateEveningReflection = useCallback(async (force = false) => {
    if (!aiConfig.enabled || (!aiConfig.apiKey && aiConfig.provider !== 'ollama') || !aiConfig.features.eveningReflection) return;
    const todayStr = dateToString(new Date());
    try {
      const cached = localStorage.getItem('day-planner-evening-glance');
      if (cached && !force) {
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

      const completedToday = tasks.filter(t => t.date === todayStr && t.completed && !t.imported && !t.isExample && isVisibleForUser(t));
      const incompleteToday = tasks.filter(t => t.date === todayStr && !t.completed && !t.imported && !t.isExample && isVisibleForUser(t));
      const tomorrowTasks = tasks.filter(t => t.date === tomorrowStr && !t.imported && !t.isExample && isVisibleForUser(t));
      const tomorrowCalendarEvents = tasks.filter(t => t.date === tomorrowStr && t.imported && !t.isTaskCalendar)
        .map(t => ({ title: t.title, time: t.startTime, isAllDay: t.isAllDay || false }))
        .sort((a, b) => (a.time || '').localeCompare(b.time || ''));
      // For suggestions, only surface free inbox tasks — project tasks have their own home
      const inboxItems = unscheduledTasks.filter(t => !t.completed && !t.isExample && (!goalsProjectsEnabled || !t.projectId) && isVisibleForUser(t))
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
    // Curated deps (see generateMorningSummary): getOverdueTasks/isVisibleForUser
    // are read at call time; the setters are stable. Listing the unstable helper
    // would defeat this callback's memoization.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiConfig, tasks, unscheduledTasks]);

  const dismissEveningGlance = useCallback(() => {
    setEveningGlanceDismissed(true);
    localStorage.setItem('day-planner-eg-dismissed', localDateStr());
  }, [setEveningGlanceDismissed]);

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
  }, [aiConfig.enabled, aiConfig.features.eveningReflection, setEveningGlanceDismissed, setEveningGlanceText]);

  return { generateMorningSummary, dismissMorningGlance, generateEveningReflection, dismissEveningGlance };
}
