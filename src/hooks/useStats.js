import { useMemo } from 'react';
import { dateToString } from '../utils/taskUtils.js';
import { getOccurrencesInRange } from '../utils/recurrenceEngine.js';

export default function useStats({ tasks, unscheduledTasks, recurringTasks, goals = [], projects = [] }) {
  const todayStr = dateToString(new Date());

  // All-time stats helpers (exclude imported events, include recurring)
  // Only count tasks up through today — future tasks aren't "incomplete" yet
  const nonImportedTasks = useMemo(
    () => tasks.filter(t => !t.imported && t.date <= todayStr),
    [tasks, todayStr]
  );

  const deadlineInboxTasks = useMemo(
    () => unscheduledTasks.filter(t => t.deadline && t.deadline <= todayStr),
    [unscheduledTasks, todayStr]
  );

  const {
    allTimeScheduledCount,
    allTimeCompletedCount,
    totalCompletedMinutes,
    totalScheduledMinutes,
  } = useMemo(() => {
    const allCompletedTasks = nonImportedTasks.filter(t => t.completed);
    const deadlineInboxCompleted = deadlineInboxTasks.filter(t => t.completed);
    const recurringAllTimeStats = recurringTasks.reduce((acc, t) => {
      const occs = getOccurrencesInRange(t, t.recurrence?.startDate || todayStr, todayStr);
      const completedSet = new Set(t.completedDates || []);
      const completed = occs.filter(d => completedSet.has(d)).length;
      return {
        scheduled: acc.scheduled + occs.length,
        completed: acc.completed + completed,
        scheduledMinutes: acc.scheduledMinutes + occs.length * (t.duration || 0),
        completedMinutes: acc.completedMinutes + completed * (t.duration || 0),
      };
    }, { scheduled: 0, completed: 0, scheduledMinutes: 0, completedMinutes: 0 });
    return {
      allTimeScheduledCount: nonImportedTasks.length + recurringAllTimeStats.scheduled + deadlineInboxTasks.length,
      allTimeCompletedCount: allCompletedTasks.length + recurringAllTimeStats.completed + deadlineInboxCompleted.length,
      totalCompletedMinutes: allCompletedTasks.reduce((sum, task) => sum + task.duration, 0) + recurringAllTimeStats.completedMinutes + deadlineInboxCompleted.reduce((sum, t) => sum + (t.duration || 0), 0),
      totalScheduledMinutes: nonImportedTasks.reduce((sum, task) => sum + task.duration, 0) + recurringAllTimeStats.scheduledMinutes + deadlineInboxTasks.reduce((sum, t) => sum + (t.duration || 0), 0),
    };
  }, [nonImportedTasks, deadlineInboxTasks, recurringTasks, todayStr]);

  // Daily summary stats — always use actual current date, not selected date
  // Compute today's recurring instances directly from templates (not expandedRecurringTasks
  // which is scoped to visibleDates and would miss today when navigated away)
  const actualTodayStr = todayStr;
  const todayRecurringInstances = recurringTasks.flatMap(t => {
    const occs = getOccurrencesInRange(t, actualTodayStr, actualTodayStr);
    const completedSet = new Set(t.completedDates || []);
    return occs.map(dateStr => ({
      id: `recurring-${t.id}-${dateStr}`,
      title: t.title,
      date: dateStr,
      startTime: t.startTime,
      duration: t.duration,
      color: t.color,
      completed: completedSet.has(dateStr),
      isRecurring: true,
    }));
  });
  const todayDeadlineInboxTasks = unscheduledTasks.filter(t => t.deadline === actualTodayStr);
  const actualTodayTasks = [
    ...tasks.filter(t => t.date === actualTodayStr),
    ...todayRecurringInstances,
    ...todayDeadlineInboxTasks,
  ];
  const actualTodayNonImportedTasks = actualTodayTasks.filter(t => !t.imported);
  const actualTodayCompletedTasks = actualTodayNonImportedTasks.filter(t => t.completed);
  const actualTodayCompletedMinutes = actualTodayCompletedTasks.reduce((sum, task) => sum + (task.duration || 0), 0);
  const actualTodayPlannedMinutes = actualTodayNonImportedTasks.reduce((sum, task) => sum + (task.duration || 0), 0);
  const actualTodayFocusMinutes = actualTodayNonImportedTasks.reduce((sum, t) => sum + (t.focusMinutes || 0), 0);

  // Project task focus (unscheduled tasks with a projectId)
  const allTimeProjectFocusMinutes = useMemo(
    () => unscheduledTasks.filter(t => t.projectId).reduce((sum, t) => sum + (t.focusMinutes || 0), 0),
    [unscheduledTasks]
  );

  const allTimeFocusMinutes = nonImportedTasks.reduce((sum, t) => sum + (t.focusMinutes || 0), 0)
    + deadlineInboxTasks.reduce((sum, t) => sum + (t.focusMinutes || 0), 0)
    + allTimeProjectFocusMinutes;

  // Inbox completion stats — pure inbox only (no projectId, no deadline)
  const inboxCompletedToday = unscheduledTasks.filter(t => t.completed && !t.deadline && !t.projectId && t.completedAt && t.completedAt.startsWith(todayStr));
  const inboxCompletedTodayCount = inboxCompletedToday.length;
  const inboxCompletedTodayMinutes = inboxCompletedToday.reduce((sum, t) => sum + (t.duration || 0), 0);
  const allTimeInboxCompleted = unscheduledTasks.filter(t => t.completed && !t.deadline && !t.projectId);
  const allTimeInboxCompletedCount = allTimeInboxCompleted.length;
  const allTimeInboxCompletedMinutes = allTimeInboxCompleted.reduce((sum, t) => sum + (t.duration || 0), 0);

  // Project task completions today (unscheduled project tasks, won't count toward ring)
  const projectTasksCompletedToday = unscheduledTasks.filter(t => t.projectId && t.completed && t.completedAt && t.completedAt.startsWith(todayStr));
  const projectTasksCompletedTodayCount = projectTasksCompletedToday.length;
  const projectTasksCompletedTodayMinutes = projectTasksCompletedToday.reduce((sum, t) => sum + (t.duration || 0), 0);

  // All-time unscheduled project task completions
  const allTimeUnscheduledProjectDone = useMemo(
    () => unscheduledTasks.filter(t => t.completed && t.projectId),
    [unscheduledTasks]
  );
  const allTimeUnscheduledProjectDoneCount = allTimeUnscheduledProjectDone.length;
  const allTimeUnscheduledProjectDoneMinutes = allTimeUnscheduledProjectDone.reduce((sum, t) => sum + (t.duration || 0), 0);

  // Goals & Projects all-time counts
  const allTimeGoalsCreated = goals.filter(g => g.status !== 'archived').length;
  const allTimeGoalsCompleted = goals.filter(g => g.status === 'completed').length;
  const allTimeProjectsCreated = projects.filter(p => p.status !== 'archived').length;
  const allTimeProjectsCompleted = projects.filter(p => p.status === 'completed').length;

  // Goals & Projects completed today
  const todayCompletedGoals = goals.filter(g => g.status === 'completed' && g.updatedAt?.startsWith(todayStr));
  const todayCompletedProjects = projects.filter(p => p.status === 'completed' && p.updatedAt?.startsWith(todayStr));

  // Consecutive day streak — count of consecutive days (going back from today)
  // on which at least one task was completed
  const consecutiveDayStreak = useMemo(() => {
    let streak = 0;
    const todayDate = new Date();
    todayDate.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() - i);
      const dateStr = dateToString(d);
      const hadCompletion =
        tasks.some(t => !t.imported && t.completed && t.date === dateStr) ||
        recurringTasks.some(t => (t.completedDates || []).includes(dateStr)) ||
        unscheduledTasks.some(t => t.completed && t.completedAt?.startsWith(dateStr));
      if (hadCompletion) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }, [tasks, recurringTasks, unscheduledTasks]);

  // Incomplete task lists for modal
  // Don't flag tasks as incomplete if they haven't ended yet (still in progress or upcoming)
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
  const todayIncompleteTasks = actualTodayNonImportedTasks.filter(t => {
    if (t.completed) return false;
    if (!t.startTime || t.isAllDay) return false;
    const [h, m] = t.startTime.split(':').map(Number);
    const taskEndMinutes = h * 60 + m + (t.duration || 0);
    if (taskEndMinutes > nowMinutes) return false;
    return true;
  }).sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  const allTimeIncompleteTasks = useMemo(() => {
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    const isTodayAndFuture = (t) => {
      if ((t.date || t.deadline) !== todayStr) return false;
      if (!t.startTime || t.isAllDay) return true;
      const [h, m] = t.startTime.split(':').map(Number);
      return h * 60 + m + (t.duration || 0) > nowMins;
    };
    const regularIncomplete = nonImportedTasks.filter(t => !t.completed && !isTodayAndFuture(t));
    const recurringIncomplete = [];
    recurringTasks.forEach(t => {
      const occs = getOccurrencesInRange(t, t.recurrence?.startDate || todayStr, todayStr);
      const completedSet = new Set(t.completedDates || []);
      occs.forEach(dateStr => {
        if (!completedSet.has(dateStr) && !t.exceptions?.[dateStr]?.deleted) {
          const entry = {
            id: `recurring-${t.id}-${dateStr}`,
            title: t.title,
            date: dateStr,
            color: t.color,
            startTime: t.startTime,
            duration: t.duration,
            isRecurring: true,
          };
          if (!isTodayAndFuture(entry)) {
            recurringIncomplete.push(entry);
          }
        }
      });
    });
    const deadlineInboxIncomplete = unscheduledTasks.filter(t => t.deadline && t.deadline <= todayStr && !t.completed && !isTodayAndFuture(t));
    return [...regularIncomplete, ...recurringIncomplete, ...deadlineInboxIncomplete]
      .sort((a, b) => ((a.date || a.deadline || '').localeCompare(b.date || b.deadline || '')) || (a.startTime || '').localeCompare(b.startTime || ''));
  }, [nonImportedTasks, recurringTasks, todayStr, unscheduledTasks]);

  return {
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
    allTimeProjectFocusMinutes,
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
    consecutiveDayStreak,
    todayIncompleteTasks,
    allTimeIncompleteTasks,
  };
}
