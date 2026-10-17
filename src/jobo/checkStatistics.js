import { buildCheckSummary, CHECK_PRIORITIES, groupSessionCount } from './checkSummary.js';
import { skippedOccurrences } from './skipOccurrence.js';
import { createJoboDayModelReader, buildJoboTaskResolver, projectJoboRecords, timedSliceOnDate } from './viewModel.js';
import { completionMarker } from './completionMarker.js';
import { validCivilDate } from './viewDates.js';
import { expandRecurringTasks, recurringTaskInstance } from '../utils/expandRecurringTasks.js';

const dateKey = (value) => {
  if (typeof value !== 'string') return null;
  const key = value.slice(0, 10);
  return validCivilDate(key) ? key : null;
};
const toDateKey = (value) => {
  if (!(value instanceof Date)) return dateKey(value);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};
const localDate = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0);
};

export const STATISTICS_SCOPES = ['day', 'week', 'month', 'allTime'];

/**
 * Dates backed by persisted task/JOBO evidence. This is intentionally sparse:
 * an untouched recurring occurrence is not historical evidence in the ledger.
 */
export function statisticsEvidenceDates({
  records = [], tasks = [], recurringTasks = [], anchorDate, throughDate, isVisibleForUser,
} = {}) {
  const through = dateKey(throughDate);
  const dates = new Set();
  const add = (value) => {
    const key = dateKey(value);
    if (key && (!through || key <= through)) dates.add(key);
  };
  const visible = (task) => typeof isVisibleForUser !== 'function' || isVisibleForUser(task);
  const { liveRecords } = projectJoboRecords(records);
  const resolveTask = buildJoboTaskResolver({ records: liveRecords, taskLookup: tasks, recurringTasks });
  for (const record of liveRecords) {
    const task = resolveTask(record);
    if (task && !visible(task)) continue;
    add(record.date);
    add(record.planSnapshot?.date);
    // UTC completion stamps are displayed in the viewer's local civil day.
    // Use the same marker as the day model rather than the UTC date prefix.
    add(completionMarker(record)?.date);
    if (record.timing === 'timed') {
      // A positive slice, not just its endpoints, proves activity on a date.
      // Civil UTC iteration is timezone/DST independent; an end at midnight
      // contributes no slice to the following day.
      const limit = through && through < record.endDate ? through : record.endDate;
      for (let day = record.date; day <= limit; day = nextDate(day)) {
        if (timedSliceOnDate(record, day)) add(day);
        if (day === limit) break;
      }
    }
  }
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || !visible(task)) continue;
    add(task.date);
    add(task?.originalPlan?.date);
    add(task?.completedAt);
  }
  for (const template of Array.isArray(recurringTasks) ? recurringTasks : []) {
    if (!template || template.id == null) continue;
    const saved = new Set([...(template.completedDates || []), ...Object.keys(template.exceptions || {})]);
    for (const day of saved) {
      if (dateKey(day) && visible(recurringTaskInstance(template, day))) add(day);
    }
  }
  add(anchorDate);
  if (!dates.size) add(throughDate || anchorDate);
  return [...dates].sort();
}

const nextDate = (date) => new Date(Date.parse(`${date}T00:00:00.000Z`) + 86400000).toISOString().slice(0, 10);

// Statistics alone materializes saved historical occurrences. These read-only
// task objects never enter App's live expansion or a task/ledger write path.
export function buildStatisticsDayReport({ date, ...source } = {}) {
  return buildStatisticsReports({ ...source, dates: [date] })[0];
}

/** Build a range with one shared day-model preparation, not one per date. */
export function buildStatisticsReports({
  dates = [], tasks = [], inboxTasks = [], recurringTasks = [], records = [], now, isVisibleForUser,
} = {}) {
  if (!dates.length) return [];
  const taskLookup = [...tasks, ...inboxTasks];
  const { liveRecords } = projectJoboRecords(records);
  const resolveTask = buildJoboTaskResolver({ records: liveRecords, taskLookup, recurringTasks });
  const recordedOccurrences = new Map();
  for (const record of liveRecords) {
    const task = resolveTask(record);
    if (task?.recurringTemplateId == null) continue;
    if (!recordedOccurrences.has(task.date)) recordedOccurrences.set(task.date, new Set());
    recordedOccurrences.get(task.date).add(String(task.recurringTemplateId));
  }
  const tasksByDate = new Map();
  for (const task of tasks) {
    if (!task) continue;
    if (!tasksByDate.has(task.date)) tasksByDate.set(task.date, []);
    tasksByDate.get(task.date).push(task);
  }
  const inboxByDate = new Map();
  for (const task of inboxTasks) {
    if (typeof isVisibleForUser === 'function' && !isVisibleForUser(task)) continue;
    const date = dateKey(task?.completedAt);
    if (!date) continue;
    if (!inboxByDate.has(date)) inboxByDate.set(date, []);
    inboxByDate.get(date).push(task);
  }
  const inputsByDate = new Map();
  for (const date of new Set(dates)) {
    const today = dateKey(now?.date) || date;
    const occurrences = date < today
      ? recurringTasks.filter(template => template && template.id != null
        && !template.exceptions?.[date]?.deleted && !template.exceptions?.[date]?.skipped
        && ((template.completedDates || []).includes(date)
          || Object.hasOwn(template.exceptions || {}, date)
          || recordedOccurrences.get(date)?.has(String(template.id))))
        .map(template => recurringTaskInstance(template, date))
      : expandRecurringTasks(recurringTasks, { rangeStart: date, rangeEnd: date, today });
    const dayTasks = [...(tasksByDate.get(date) || []), ...occurrences]
      .filter(task => !task.isAllDay && task.startTime);
    inputsByDate.set(date, { occurrences, tasks: dayTasks });
  }
  // Native historical instances must precede projection preparation so the
  // shared resolver preserves currentTask/denominator semantics for every day.
  const readDay = createJoboDayModelReader({
    taskLookup: [...taskLookup, ...[...inputsByDate.values()].flatMap(input => input.occurrences)],
    recurringTasks, records, isVisibleForUser, dates,
  });
  // A skip from the Check is evidence captured at the time, so every date
  // reads its skipped occurrences (skipOccurrence.js); a move is still dropped.
  return dates.map(date => statisticsReportFromModel(readDay({
    date, tasks: inputsByDate.get(date).tasks, now,
  }), { date, inboxTasks: inboxByDate.get(date) || [], skips: skippedOccurrences(recurringTasks, date, { records, isVisibleForUser }) }));
}

export function statisticsReportFromModel(model, { date, inboxTasks = [], isVisibleForUser, skips = [] } = {}) {
  const summary = buildCheckSummary(model, {
    date, inboxTasks: inboxTasks.filter(task => typeof isVisibleForUser !== 'function' || isVisibleForUser(task)),
    skips,
  });
  if (!summary) return null;
  const items = [...new Map([...model.timedRecords, ...model.untimedRecords]
    .map(item => [item.id, item])).values()];
  const groups = [...new Map(items.map(item => [item.groupKey, item])).values()];
  return {
    ...summary,
    // Only validated winning records from the real day model get identities.
    // A missing id remains invalid evidence; there is no synthetic fallback.
    inferredRecordIds: model.timedRecords.filter(item => item.record.timingBasis === 'planDuration')
      .map(item => item.id),
    // Keep identities from the prepared model, not additive day counters.
    // Membership is a positive day slice or the model's untimed marker date;
    // classification still sees the full group, including sessions outside it.
    executionRecords: items.map(item => ({ id: item.id, progress: item.record.progress })),
    executionGroups: groups.map(item => ({
      id: item.groupKey,
      attemptCount: item.attempts.length,
      sessionCount: groupSessionCount(item),
      context: item.comparison?.planContext ?? item.comparisonMeta?.measuredComparison?.planContext ?? 'unknown',
    })),
  };
}

const monthDates = (anchor) => {
  const base = localDate(anchor);
  const year = base.getFullYear();
  const month = base.getMonth();
  const last = new Date(year, month + 1, 0, 12).getDate();
  return Array.from({ length: last }, (_, index) =>
    toDateKey(new Date(year, month, index + 1, 12)));
};

export function statisticsDatesForScope({
  scope, anchorDate, weekDates = [], evidenceDates = [],
} = {}) {
  if (!STATISTICS_SCOPES.includes(scope)) throw new TypeError('Unknown statistics scope');
  const anchor = dateKey(anchorDate);
  if (!anchor) throw new TypeError('anchorDate must be YYYY-MM-DD');
  if (scope === 'day') return [anchor];
  if (scope === 'week') {
    const dates = weekDates.map(toDateKey).filter(Boolean);
    return dates.length ? [...new Set(dates)] : [anchor];
  }
  if (scope === 'month') return monthDates(anchor);
  const dates = [...new Set(evidenceDates.map(toDateKey).filter(Boolean))].sort();
  return dates.length ? dates : [anchor];
}

const sum = (values) => values.reduce((total, value) => total + (Number(value) || 0), 0);
const nullableSum = (values) => {
  const known = values.filter(Number.isFinite);
  return known.length ? sum(known) : null;
};
const nullableMax = (values) => {
  const known = values.filter(Number.isFinite);
  return known.length ? Math.max(...known) : null;
};
const nullableMin = (values) => {
  const known = values.filter(Number.isFinite);
  return known.length ? Math.min(...known) : null;
};
const sumBuckets = (reports, pick, keys, clean) => Object.fromEntries(keys.map((key) => [
  key, clean ? sum(reports.map((report) => pick(report)?.[key])) : null,
]));
const sumMap = (reports, pick) => {
  const result = {};
  for (const report of reports) {
    for (const [key, value] of Object.entries(pick(report) || {})) {
      result[key] = (result[key] || 0) + (Number(value) || 0);
    }
  }
  return result;
};

function rangeExecution(reports) {
  // A bare checkSummary has no identities and cannot prove a range count.
  // Never fall back to summing its per-day Execution counters.
  if (!reports.every(report => Array.isArray(report.executionRecords) && Array.isArray(report.executionGroups))) {
    return { doCount: null, single: null, split: null, progress: null, contexts: null };
  }
  const records = new Map();
  const groups = new Map();
  for (const report of reports) {
    for (const record of report.executionRecords) records.set(record.id, record);
    for (const group of report.executionGroups) groups.set(group.id, group);
  }
  const progress = { completed: 0, mostly: 0, partial: 0, started: 0 };
  const contexts = { planned: 0, noPlan: 0, unknown: 0 };
  let single = 0, split = 0;
  for (const record of records.values()) {
    if (Object.hasOwn(progress, record.progress)) progress[record.progress] += 1;
  }
  for (const group of groups.values()) {
    // Older reports carry no sessionCount; their attempts are the sessions.
    const sessions = group.sessionCount ?? group.attemptCount;
    single += Number(sessions === 1);
    split += Number(sessions > 1);
    contexts[group.context] += 1;
  }
  return { doCount: records.size, single, split, progress, contexts };
}

/**
 * Aggregate per-day checkSummary reports. Coverage/time and captured-plan
 * comparisons partition by day and are additive. Execution is deduplicated by
 * the prepared model's record/group identities across the selected dates.
 * Full-group gap and priority progress diagnostics remain Day-only.
 */
export function aggregateCheckSummaries(input = []) {
  const reports = (Array.isArray(input) ? input : []).filter(Boolean);
  if (!reports.length) return null;
  if (reports.length === 1) return { ...reports[0], days: 1 };

  const clean = reports.every((report) => report.clean === true);
  const exactSum = (values) => clean ? nullableSum(values) : null;
  const comparison = {
    comparableCount: clean ? sum(reports.map((report) => report.stats?.comparison?.comparableCount)) : null,
    groupCount: sum(reports.map((report) => report.stats?.comparison?.groupCount)),
    excludedCount: clean ? sum(reports.map((report) => report.stats?.comparison?.excludedCount)) : null,
    start: sumBuckets(reports, (report) => report.stats?.comparison?.start, ['early', 'onTime', 'late'], clean),
    finish: sumBuckets(reports, (report) => report.stats?.comparison?.finish, ['early', 'onTime', 'late'], clean),
    duration: sumBuckets(reports, (report) => report.stats?.comparison?.duration, ['shorter', 'onEstimate', 'longer'], clean),
  };

  const priorities = Object.fromEntries(CHECK_PRIORITIES.map((key) => {
    const rows = reports.map((report) => report.priorities?.[key]).filter(Boolean);
    return [key, {
      total: sum(rows.map((row) => row.total)),
      completed: sum(rows.map((row) => row.completed)),
      recordedMinutes: clean ? nullableSum(rows.map((row) => row.recordedMinutes)) : null,
      progress: null,
      changed: clean ? sum(rows.map((row) => row.changed)) : null,
      comparable: clean ? sum(rows.map((row) => row.comparable)) : null,
      lateStart: clean ? sum(rows.map((row) => row.lateStart)) : null,
      lateFinish: clean ? sum(rows.map((row) => row.lateFinish)) : null,
      longer: clean ? sum(rows.map((row) => row.longer)) : null,
    }];
  }));

  return {
    days: reports.length,
    clean,
    stats: {
      native: {
        completed: sum(reports.map((report) => report.stats?.native?.completed)),
        total: sum(reports.map((report) => report.stats?.native?.total)),
        plannedMinutes: sum(reports.map((report) => report.stats?.native?.plannedMinutes)),
        skipped: sum(reports.map((report) => report.stats?.native?.skipped)),
      },
      recordedMinutes: exactSum(reports.map((report) => report.stats?.recordedMinutes)),
      untimedCount: sum(reports.map((report) => report.stats?.untimedCount)),
      inferredCount: reports.every(report => Array.isArray(report.inferredRecordIds))
        ? new Set(reports.flatMap(report => report.inferredRecordIds)).size : null,
      invalidCount: sum(reports.map((report) => report.stats?.invalidCount)),
      comparison,
    },
    priorities,
    changes: clean ? {
      compared: sum(reports.map((report) => report.changes?.compared)),
      start: sum(reports.map((report) => report.changes?.start)),
      finish: sum(reports.map((report) => report.changes?.finish)),
      duration: sum(reports.map((report) => report.changes?.duration)),
      unchanged: sum(reports.map((report) => report.changes?.unchanged)),
      unknown: sum(reports.map((report) => report.changes?.unknown)),
    } : null,
    ...rangeExecution(reports),
    relations: clean ? sumMap(reports, (report) => report.relations) : null,
    inboxCompleted: sum(reports.map((report) => report.inboxCompleted)),
    projectCompleted: sum(reports.map((report) => report.projectCompleted)),
    rawMinutes: exactSum(reports.map((report) => report.rawMinutes)),
    overlapMinutes: exactSum(reports.map((report) => report.overlapMinutes)),
    gapMinutes: null,
    maxSpanMinutes: clean ? nullableMax(reports.map((report) => report.maxSpanMinutes)) : null,
    insideMinutes: exactSum(reports.map((report) => report.insideMinutes)),
    outsideMinutes: exactSum(reports.map((report) => report.outsideMinutes)),
    maxStart: clean ? nullableMax(reports.map((report) => report.maxStart)) : null,
    maxFinish: clean ? nullableMax(reports.map((report) => report.maxFinish)) : null,
    maxLonger: clean ? nullableMax(reports.map((report) => report.maxLonger)) : null,
    minRatio: clean ? nullableMin(reports.map((report) => report.minRatio)) : null,
    maxRatio: clean ? nullableMax(reports.map((report) => report.maxRatio)) : null,
    withinPlan: clean ? sum(reports.map((report) => report.withinPlan)) : null,
    noDo: clean ? sum(reports.map((report) => report.noDo)) : null,
  };
}
