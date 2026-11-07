// The home-screen widgets' snapshot of today (Android widgets, the iOS
// widgets and Live Activity, the Day Dial widget), built from the app's
// state. App.jsx's widget effect gathers the inputs, calls this, and owns
// everything that is not assembly: the native guards, the dedupe and push
// (utils/widgetSnapshotDedupe.js) and the boundary re-push timer.
//
// The snapshot mirrors what the Glance tab shows: overdue tasks, habit
// rings, all-day events, deadline tasks, GTD frame sections with nested
// tasks, and routines. The native WidgetUpdateWorker patches in fresh step
// counts and calendar events every 15 minutes when the app is closed.
//
// Pure apart from the helpers it is handed: nothing here reads storage, the
// clock or the DOM. `now` is the instant the snapshot describes, and every
// value the effect used to read from storage (steps, the weather
// coordinates, the dial's alarm prefs) arrives as an input.

import { stripWikilinksAndTags, extractTags } from './taskUtils.js';
import { taskColorToHex } from './colorUtils.js';
import { buildWidgetGoalsProjects, buildWidgetDueOn } from './widgetGoalsProjects.js';
import { buildScheduleSections, serializeWidgetTask } from './widgetDayProjection.js';
import { computeSkySnapshot, projectDialSnapshot } from './dayDial.js';
import { computeDaySummary } from './daySummary.js';
import { buildUpNextFact } from './liveActivity.js';
import { deriveBlockEnergy } from './energyAxis.js';
import { formatDuration } from './formatDuration.js';
import { formatLocalizedDate } from './localeFormatting.js';
import { getGlanceHGInstances } from '../hooks/useHyperGlance.js';
import { HABIT_COLORS } from '../constants/habits.js';
import { agendaItemAsTodayRow, agendaItemSpan, agendaNowAndNext, blockAsTodayRow } from './todayAgenda.js';

// App.jsx's own HH:MM → minutes, kept identical so the snapshot is unchanged
// (the shared ones in utils/ differ on malformed input).
const timeToMinutes = (time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
};

/**
 * @param {object} input
 * @param {Date} input.now           the instant described; its date is "today"
 * @param {string} input.todayStr    today's YYYY-MM-DD, as the app derives it
 * @param {Array} input.overdueTasks the app's overdue list (getOverdueTasks())
 * @param {Array} input.todayAgenda  today's agenda, `_agendaType`-tagged
 * @param {Array} input.tasks @param {Array} input.unscheduledTasks
 * @param {Array} input.projects @param {Array} input.goals
 * @param {boolean} input.goalsProjectsEnabled @param {Function} input.isVisibleForUser
 * @param {boolean} input.habitsEnabled @param {Array} input.activeHabits
 * @param {Function} input.getTodayHabitCount  habit id → today's count
 * @param {Array} input.todayRoutines @param {object} input.routineCompletions
 * @param {Array} input.hgVisibleProjects @param {object} input.glanceAhead
 * @param {number} input.steps       today's cached steps, or -1
 * @param {boolean} input.use24Hour @param {boolean} input.liveActivityEnabled
 * @param {object} input.projectedDays @param {object} input.monthWindow
 * @param {?{lat:number, lon:number}} input.weatherCoords
 * @param {object} input.dialAlarm   the dial's alarm prefs (utils/dialPrefs.js)
 * @param {string} input.timezone    the zone every minute above is in
 * @param {number} input.updatedAt   the push's own stamp (excluded from dedupe)
 * @param {*} input.listEndOfDayTime
 * @param {Function} input.getFrameInstancesForDate @param {Function} input.computeAvailableSlots
 * @param {Function} input.getTasksForDate @param {Function} input.getDayWindow
 * @param {Function} input.dialFramesForDate @param {Function} input.formatTime
 * @param {Function} input.t         i18next's t
 */
export function buildWidgetSnapshot({
  now, todayStr,
  overdueTasks, todayAgenda, tasks, unscheduledTasks,
  projects, goals, goalsProjectsEnabled, isVisibleForUser,
  habitsEnabled, activeHabits, getTodayHabitCount,
  todayRoutines, routineCompletions,
  hgVisibleProjects, glanceAhead,
  steps, use24Hour, liveActivityEnabled,
  projectedDays, monthWindow, weatherCoords, dialAlarm, timezone, updatedAt,
  listEndOfDayTime,
  getFrameInstancesForDate, computeAvailableSlots, getTasksForDate, getDayWindow,
  dialFramesForDate, formatTime, t,
}) {
  const today = now;

  // ── Overdue tasks (split: prior-day vs today-past-endtime) ────────────
  const getProjectName = task => (goalsProjectsEnabled && task.projectId)
    ? (projects.find(p => p.id === task.projectId)?.title || '')
    : '';
  // Prior-day tasks → dedicated OVERDUE section in widget (no time, no badge)
  const overdueItems = overdueTasks
    .filter(task => task._overdueType === 'scheduled' ? task.date < todayStr : true)
    .map(task => ({
      id: task.id,
      title: stripWikilinksAndTags(task.title),
      colorHex: taskColorToHex(task.color, task.nativeCalendarColor),
      overdueType: task._overdueType || 'scheduled',
      projectName: getProjectName(task),
    }));
  // Today's tasks that have passed their end time → shown in SCHEDULED with time
  const overdueTodayItems = overdueTasks
    .filter(task => task._overdueType === 'scheduled' && task.date === todayStr)
    .map(task => ({
      id: task.id,
      title: stripWikilinksAndTags(task.title),
      colorHex: taskColorToHex(task.color, task.nativeCalendarColor),
      startTime: task.startTime || '',
      duration: task.duration || 0,
      projectName: getProjectName(task),
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
      // Limit type: green (met) while at or under the limit, red once over —
      // no amber intermediate state.
      progress = 1;
      isComplete = count <= h.target;
      ringColorHex = count <= h.target ? '#22c55e' : '#ef4444';
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
    .filter(task => task._agendaType === 'allday')
    .map(task => ({
      id: task.id,
      title: stripWikilinksAndTags(task.title),
      colorHex: taskColorToHex(task.color, task.nativeCalendarColor),
      projectName: getProjectName(task),
    }));

  // ── Deadline tasks (due today) ─────────────────────────────────────────
  const deadlineItems = todayAgenda
    .filter(task => task._agendaType === 'deadline')
    .map(task => ({
      id: task.id,
      title: stripWikilinksAndTags(task.title),
      colorHex: taskColorToHex(task.color, task.nativeCalendarColor),
      projectName: getProjectName(task),
    }));

  // ── Frame sections + unframed scheduled tasks ─────────────────────────
  const nowMin = today.getHours() * 60 + today.getMinutes();
  const todayFrames = getFrameInstancesForDate(today).filter(
    f => timeToMinutes(f.end) > nowMin
  );
  const overdueIdSet = new Set([...overdueItems, ...overdueTodayItems].map(task => String(task.id)));
  // The night before's task still running (#2278) is in today's list as its
  // piece, from 00:00 for the minutes it runs into today, as GLANCE lists it.
  const scheduled = todayAgenda
    .filter(task => task._agendaType === 'scheduled' && !overdueIdSet.has(String(task.id)))
    .map(agendaItemAsTodayRow);

  // Every title the widget draws goes through the same rule: no
  // [[wikilinks]] (a widget cannot open a note) and no #tags (they ride
  // the `tags` field where the widget wants them). The row shape and the
  // frame/unframed assembly live in utils/widgetDayProjection.js, shared
  // with the projected days so the two cannot drift.
  const sections = buildScheduleSections({
    scheduled,
    frames: todayFrames,
    frameAvailableMinutes: (frame) => computeAvailableSlots(frame, today).reduce((s, slot) => s + slot.minutes, 0),
    serialize: task => serializeWidgetTask(task, getProjectName),
  });

  // ── Routines ──────────────────────────────────────────────────────────
  const routineItems = todayRoutines.map(r => ({
    id: r.id,
    name: r.name,
    startTime: r.startTime || '',
    isAllDay: !r.startTime || r.isAllDay || false,
    completed: !!routineCompletions[r.id],
  }));

  // ── Goals due today ───────────────────────────────────────────────────
  // Multi-user: widgets show only the current user's goals/projects/tasks.
  const allTasksCombined = [...tasks, ...unscheduledTasks].filter(isVisibleForUser);
  const visibleProjects = projects.filter(isVisibleForUser);
  const visibleGoals = goals.filter(isVisibleForUser);
  // Goals and projects due today (utils/widgetGoalsProjects.js): projects
  // ride their own list so a widget that does not know them is unchanged.
  const dueToday = goalsProjectsEnabled
    ? buildWidgetDueOn({ goals: visibleGoals, projects: visibleProjects, tasks: allTasksCombined, dateStr: todayStr })
    : { goals: [], projects: [] };
  const goalItems = dueToday.goals;

  // ── Next Task (for Up Next widget) ───────────────────────────────────
  // Scheduled, non-completed tasks that haven't ended yet (in progress or
  // upcoming), in chronological order. The first is the "Up Next" task; the
  // rest fill leftover widget space when the primary task is simple.
  //
  // Across midnight (#2278): the night before's task still running is the
  // first, as its piece on today's clock (00:00 for the minutes it runs into
  // today), so the native side, which promotes through this list by today's
  // clock (start + duration), keeps it up until it ends and then moves on.
  // The shared rule: agendaNowAndNext's `ahead` (agenda-core nowAndNext).
  const sortedUpcoming = agendaNowAndNext(todayAgenda, nowMin, { include: task => !task.completed })
    .ahead.map(blockAsTodayRow);
  const nextTaskCandidate = sortedUpcoming[0] || null;
  const nextTaskItem = nextTaskCandidate ? {
    id: nextTaskCandidate.id,
    title: stripWikilinksAndTags(nextTaskCandidate.title),
    colorHex: taskColorToHex(nextTaskCandidate.color, nextTaskCandidate.nativeCalendarColor),
    startTime: nextTaskCandidate.startTime || '',
    duration: nextTaskCandidate.duration || 0,
    tags: extractTags(nextTaskCandidate.title).slice(0, 5),
    notes: (nextTaskCandidate.notes || '').substring(0, 300),
    subtasks: (nextTaskCandidate.subtasks || []).slice(0, 7).map(s => ({
      title: s.title,
      completed: s.completed || false,
    })),
    projectName: getProjectName(nextTaskCandidate),
  } : null;

  // The tasks after the "Up Next" one — used to fill the widget when the
  // primary task has no subtasks/notes, and to promote Up Next by the clock
  // while the app sits in the background (the widgets draw at most 4 of
  // them). Uncapped, like a projected day's (utils/widgetDayProjection.js):
  // a capped list runs out, and a promotion past its end would claim the
  // day is clear.
  const upcomingTaskItems = sortedUpcoming.slice(1).map(task => ({
    id: task.id,
    title: stripWikilinksAndTags(task.title),
    colorHex: taskColorToHex(task.color, task.nativeCalendarColor),
    startTime: task.startTime || '',
    duration: task.duration || 0,
  }));

  // ── All Goals / All Projects (the Goal and Project widgets) ───────────
  // Ordered as the app draws them (utils/widgetGoalsProjects.js).
  const { allGoals, allProjects } = goalsProjectsEnabled
    ? buildWidgetGoalsProjects({
        goals: visibleGoals,
        allGoals: goals,
        projects: visibleProjects,
        scheduled: tasks.filter(isVisibleForUser),
        unscheduled: unscheduledTasks.filter(isVisibleForUser),
        todayStr,
      })
    : { allGoals: [], allProjects: [] };

  // ── GLANCEahead — include tomorrow preview when day is done or evening ──
  // "Day done" check: all scheduled tasks are past, or there are none
  const scheduledToday = todayAgenda.filter(task => task._agendaType === 'scheduled');
  const allPast = scheduledToday.length > 0 && scheduledToday.every(task => {
    if (!task.startTime) return true;
    // Its block today: the night before's task ends at its piece's end (#2278).
    return nowMin >= agendaItemSpan(task).end;
  });
  const isDayDone = (allPast && scheduledToday.length > 0) || scheduledToday.length === 0;
  const isEvening = today.getHours() >= 19;

  let glanceAheadData = null;
  if (isDayDone || isEvening) {
    const { dayLabel, taskCount, eventCount, deadlineCount, firstStartTime, committedMinutes, isEmpty } = glanceAhead;
    const committedStr = committedMinutes > 0 ? formatDuration(committedMinutes, t) : null;
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
    ? getGlanceHGInstances(hgVisibleProjects, nowMin).map(({ project, instance }) => {
        const hg = project.hyperglance;
        const effectiveTime = hg.scheduledTimeOverrides?.[instance.date] || hg.scheduledTime || '';
        const duration = hg.scheduledDurationOverrides?.[instance.date] || hg.scheduledDuration || 60;
        const allProjectTasks = [...tasks, ...unscheduledTasks].filter(isVisibleForUser);
        const alreadyInstantiated = allProjectTasks.some(
          task => task.projectId === project.id && task.hyperglanceSessionDate === instance.date
        );
        const taskCount = allProjectTasks.filter(
          task => task.projectId === project.id && !task.archived && !task.completed
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
    .filter(s => nowMin < s.startMin + s.duration)
    .sort((a, b) => a.startMin - b.startMin)[0] || null;
  // energy is resolved from the SOURCE block, never from the projected title:
  // nextTaskItem.title has already had its #tags and [[wikilinks]] stripped
  // for display, and the per-block `energy` override is not projected at all,
  // so deriving from it would silently drop both of deriveBlockEnergy's
  // stronger signals. nextTaskCandidate / nextHGForUpNext still carry them.
  const nextUpNext = (() => {
    const taskMin = nextTaskItem ? timeToMinutes(nextTaskItem.startTime) : Infinity;
    const hgMin = nextHGForUpNext ? nextHGForUpNext.startMin : Infinity;
    if (nextHGForUpNext && hgMin <= taskMin) {
      const tc = nextHGForUpNext.taskCount;
      const tcLabel = tc > 0 ? ` · ${t('reminders.taskCount', { count: tc })}` : '';
      return { title: 'hyperGLANCE', startTime: nextHGForUpNext.startTime, duration: nextHGForUpNext.duration, energy: deriveBlockEnergy(nextHGForUpNext), bodyPrefix: `${nextHGForUpNext.title}${tcLabel} · ` };
    }
    if (nextTaskItem)
      return { title: nextTaskItem.title, startTime: nextTaskItem.startTime, duration: nextTaskItem.duration, energy: deriveBlockEnergy(nextTaskCandidate), bodyPrefix: '' };
    return null;
  })();

  return {
    date: todayStr,
    dateLabel: formatLocalizedDate(today, { weekday: 'short', month: 'short', day: 'numeric' }),
    steps,
    use24Hour,
    overdue: overdueItems,
    overdueToday: overdueTodayItems,
    habits: habitItems,
    goals: goalItems,
    projectsDue: dueToday.projects,
    allGoals,
    allProjects,
    allDay: allDayItems,
    deadlines: deadlineItems,
    sections,
    routines: routineItems,
    hyperGlance: hyperGlanceItems,
    glanceAhead: glanceAheadData,
    nextTask: nextTaskItem,
    upcomingTasks: upcomingTaskItems,
    nextUpNext,
    // Opt-in flag for the iOS Live Activity; the bridge ends any live
    // activity when this is false (or absent, for old snapshots).
    liveActivityEnabled,
    // ── Day-summary projection (Live Activity / Dynamic Island) ────────
    // The strip's numbers for TODAY, precomputed here so the native side
    // never re-implements the math: the projection IS computeDaySummary.
    // Raw minutes plus preformatted strings (formatDuration keeps the
    // wording identical to the in-app strip); metadata only, no media
    // bytes. unblockedMinutes is null on an empty day with no declared
    // window — the native side should show nothing rather than "0m".
    daySummary: (() => {
      const win = getDayWindow(todayStr);
      const sum = computeDaySummary(getTasksForDate(today), listEndOfDayTime, win);
      return {
        date: todayStr,
        windowStart: win?.start ?? null,
        windowEnd: win?.stop ?? null,
        unblockedMinutes: sum.unblockedMinutes,
        blockedMinutes: sum.blockedMinutes,
        effortMinutes: sum.effortMinutes,
        restoreMinutes: sum.restoreMinutes,
        doneMinutes: sum.doneMinutes,
        completableMinutes: sum.completableMinutes,
        unblocked: sum.unblockedMinutes === null ? null : formatDuration(sum.unblockedMinutes, t),
        effort: formatDuration(sum.effortMinutes, t),
        restore: formatDuration(sum.restoreMinutes, t),
        done: `${formatDuration(sum.doneMinutes, t)}/${formatDuration(sum.completableMinutes, t)}`,
        // The island's schedule-fact pair, built from the same unified
        // current-or-next entry (task or HG session) the Android Up Next
        // notification uses. Labels stay factual when stale ("until 2:00
        // PM" / "at 3:30 PM"); the countdown interval feeds SwiftUI's
        // Text(timerInterval:), which ticks live with no updates.
        upNext: nextUpNext
          ? buildUpNextFact(
              nextUpNext.bodyPrefix
                ? { ...nextUpNext, title: `${nextUpNext.bodyPrefix}${nextUpNext.title}` }
                : nextUpNext,
              now.getTime(), formatTime,
              { until: t('strip.until'), at: t('strip.at') })
          : null,
        // The island's four Swift-rendered words, localized HERE like every
        // other island string — the JS side owns all wording, so the iOS
        // project needs no localization infrastructure of its own.
        labels: {
          done: t('strip.done'),
          remaining: t('strip.remaining'),
          startsIn: t('strip.startsIn'),
          noMoreBlocks: t('strip.noMoreBlocks'),
        },
      };
    })(),
    // ── Sky, for the Day Dial widget's ring ────────────────────────────
    // Derived here, never re-solved natively (docs/day-dial-widget-handoff.md
    // §4): 24 hourly sun/moon strengths plus the rise/set minutes and the
    // moon's phase, from the same solar and lunar math the in-app dial
    // draws with. Null until a location has been geocoded (useWeather
    // stores the coords after each successful geocode, header weather on
    // or off; Settings → Weather on desktop and tablet, Settings → App
    // Settings → Location on phones), and then the widget draws the ring unlit and
    // no glyphs, like the dial draws no solar layer. ~0.6 KB.
    sky: computeSkySnapshot(today, weatherCoords),
    // ── The whole day, for the Day Dial widget's ring ──────────────────
    // NOT from todayAgenda: that list hides a completed task once it has
    // ended, which is right for an agenda and wrong for a dial that draws
    // the day's shape. computeDialModel over the unfiltered day instead —
    // the same model the in-app dial renders — via projectDialSnapshot.
    // Yesterday is passed for the overnight carry, exactly as DayDialModal
    // does. No tag filter: the home screen shows the day, not a view of it.
    dial: (() => {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return projectDialSnapshot({
        date: todayStr,
        dayTasks: getTasksForDate(today),
        prevDayTasks: getTasksForDate(yesterday),
        dayWindow: getDayWindow(todayStr),
        routines: todayRoutines,
        routineCompletions,
        frames: dialFramesForDate(today),
      });
    })(),
    // ── The next three days, keyed by date ──────────────────────────────
    // The native side switches to the matching entry at each midnight and
    // labels it "planned as of". Only today carries state (completions,
    // habits, routines, overdue); a projected day carries the shape of the
    // day.
    days: projectedDays,
    // ── Six weeks of bars, for a month grid ─────────────────────────────
    // { from, weekStart, days: [{date, bars:[{s,d,c}], allDay, deadlines}] },
    // 49 days (42 + a rollover week). Wholly hot in the dedupe: any change
    // in it reloads (utils/widgetSnapshotDedupe.js).
    monthWindow,
    // The zone every clock minute above was computed in. A widget on a
    // device that has since moved to a different UTC offset shows its own
    // "time zone changed" state instead of blocks at the wrong angles
    // (WidgetFreshness.zoneChanged); a zone change with the app open
    // changes this field, so the hot fingerprint re-pushes on its own.
    timezone,
    // The Day Dial's alarm-mark prefs (utils/dialPrefs.js), for the
    // Android home-screen dial, which reads the alarm itself (ClockAlarm)
    // but takes the user's choice from here. Device-local, like this
    // snapshot.
    dialAlarm,
    updatedAt,
  };
}

/** Today's cached step count from HealthConnect, or -1 when there is none. */
export function readCachedSteps(raw, todayStr) {
  try {
    const cachedSteps = JSON.parse(raw || 'null');
    if (cachedSteps?.date === todayStr) return cachedSteps.steps ?? -1;
  } catch (_) { /* no steps */ }
  return -1;
}
