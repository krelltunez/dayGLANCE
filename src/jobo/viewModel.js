import {
  DO_PROGRESS,
  DO_TIMING,
  TIMING_SUMMARY,
  compareExecutionToPlan,
  summarizeTiming,
  validateDoRecord,
  pickJoboRecord,
} from './core.js';
import { resolveOccurrence } from './detector.js';
import { validCivilDate } from './viewDates.js';

import { completionMarker } from './completionMarker.js';

const DAY_MINUTES = 24 * 60;
const PROGRESS_ORDER = Object.freeze([
  DO_PROGRESS.STARTED,
  DO_PROGRESS.PARTIAL,
  DO_PROGRESS.MOSTLY,
  DO_PROGRESS.COMPLETED,
]);

const validDate = validCivilDate;
const compareId = (a, b) => String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;

function timeMinutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function dayNumber(date) {
  if (!validDate(date)) return null;
  return Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86400000);
}

function absoluteMinute(date, time) {
  const day = dayNumber(date);
  const minute = timeMinutes(time);
  return day == null || minute == null ? null : day * DAY_MINUTES + minute;
}

function planSnapshotKey(snapshot) {
  if (!snapshot) return 'none';
  return `${snapshot.date}|${snapshot.startTime}|${snapshot.duration}`;
}

function createdAtMillis(record) {
  const stamp = Date.parse(record?.createdAt ?? '');
  return Number.isFinite(stamp) ? stamp : Number.NEGATIVE_INFINITY;
}

/**
 * Return attempts newest first.  `updatedAt` is deliberately not part of the
 * ordering: correcting an old attempt must not make it look like a new one.
 * The id tie-break makes records with the same source timestamp deterministic
 * across devices.
 */
export function sortJoboAttempts(records) {
  return (Array.isArray(records) ? records : [])
    .filter((record) => record && !record.deleted)
    .slice()
    .sort((a, b) => createdAtMillis(b) - createdAtMillis(a)
      || compareId(b.id ?? '', a.id ?? ''));
}

export function latestJoboAttempt(records) {
  return sortJoboAttempts(records)[0] || null;
}

function recurringInstanceDateFromRecord(record) {
  if (record?.source !== 'completion' || record.taskId == null || typeof record.id !== 'string') return null;
  const prefix = `do:${String(record.taskId)}:`;
  if (!record.id.startsWith(prefix)) return null;
  const rest = record.id.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}(?::|$)/.test(rest) ? rest.slice(0, 10) : null;
}

function recordGroupKey(record) {
  // An unlinked Do has no task identity that can prove two rows are sessions
  // of the same execution. Keep each one independent rather than deriving
  // "split" across unrelated manual records.
  if (record.taskId == null) return `record::${record.id}`;

  // A timed Final Plan is the strongest execution anchor. For null snapshots,
  // recurring completions still need an occurrence boundary: every occurrence
  // shares the template taskId, and all-day/untimed occurrences would otherwise
  // collapse into one false "split" history across dates.
  if (record.planSnapshot) {
    return `${String(record.taskId)}::${planSnapshotKey(record.planSnapshot)}`;
  }
  // A manual/focus row with a recurring template id and no captured Plan
  // has no occurrence identity. Keep it independent instead of assigning it
  // to whichever occurrence happens to be visible in the selected day.
  if (record.source !== 'completion') return `record::${record.id}`;
  const instanceDate = recurringInstanceDateFromRecord(record);
  return `${String(record.taskId)}::${instanceDate ? `instance:${instanceDate}` : 'none'}`;
}

function taskLinkId(task) {
  if (!task) return null;
  if (task.recurringTemplateId != null) return String(task.recurringTemplateId);
  return task.id == null ? null : String(task.id);
}

function taskPlanGroupKey(task, plan) {
  const taskId = taskLinkId(task);
  return taskId == null ? null : `${taskId}::${planSnapshotKey(plan)}`;
}

function safeSummary(plan, records, options = {}) {
  try {
    return summarizeTiming(compareExecutionToPlan(plan, records, options));
  } catch {
    return [];
  }
}

function safeComparison(plan, records, options = {}) {
  try {
    return compareExecutionToPlan(plan, records, options);
  } catch {
    return null;
  }
}

/**
 * Keep the full comparison and the timed-only comparison together.  Slice 2
 * intentionally makes a mixed timed/untimed history non-comparable as a
 * whole, while the timed subset remains useful for diagnostics.
 */
function comparisonMetadata(plan, records, options = {}) {
  const attempts = sortJoboAttempts(records);
  const hasEstimatedAttempts = attempts.some(record => record.timingBasis === 'planDuration');
  const measuredAttempts = attempts.filter((record) => record.timing === DO_TIMING.TIMED && record.timingBasis !== 'planDuration');
  const comparison = hasEstimatedAttempts ? null : safeComparison(plan, attempts, options);
  const measuredComparison = safeComparison(plan, measuredAttempts, options);
  return {
    comparable: comparison?.comparable === true,
    comparison,
    measuredComparison,
    hasEstimatedAttempts,
    hasUntimedAttempts: attempts.some((record) => record.timing === DO_TIMING.UNTIMED),
    attempts,
    measuredAttempts,
    measured: {
      comparable: measuredComparison?.comparable === true,
      attemptCount: attempts.length,
      timedSessionCount: measuredAttempts.length,
      untimedAttemptCount: attempts.length - measuredAttempts.length,
      recordedMinutes: measuredComparison?.metrics?.recordedMinutes ?? null,
      activeMinutes: measuredComparison?.metrics?.activeMinutes ?? null,
      elapsedMinutes: measuredComparison?.metrics?.elapsedMinutes ?? null,
    },
  };
}

function progressesForGroup(records) {
  const seen = new Set(records.map((record) => record.progress));
  return PROGRESS_ORDER.filter((progress) => seen.has(progress));
}

function occurrenceDateForRecord(record) {
  if (validDate(record?.planSnapshot?.date)) return record.planSnapshot.date;
  return recurringInstanceDateFromRecord(record);
}

function noteKeyForTask(task) {
  return task?.id == null ? null : String(task.id);
}

function buildTaskResolver(sourceTasks) {
  const byId = new Map();
  const recurringByDate = new Map();
  const recurringTemplateIds = new Set();
  for (const task of sourceTasks) {
    if (!task || task.id == null) continue;
    byId.set(String(task.id), task);
    if (task.recurringTemplateId != null && validDate(task.date)) {
      const templateId = String(task.recurringTemplateId);
      recurringTemplateIds.add(templateId);
      recurringByDate.set(`${templateId}::${task.date}`, task);
    }
  }

  return (record) => {
    if (record?.taskId == null) return null;
    const taskId = String(record.taskId);
    const exact = byId.get(taskId);
    const occurrenceDate = occurrenceDateForRecord(record);
    // A template id alone is not enough to resolve a recurring task. Prefer
    // the captured occurrence date whenever expanded recurring candidates are
    // present, even if a template object with the same id is also in lookup.
    if (recurringTemplateIds.has(taskId)) {
      if (!occurrenceDate) return null;
      return recurringByDate.get(`${taskId}::${occurrenceDate}`) || null;
    }
    // An exact occurrence id is safe; ordinary task ids are safe as well.
    return exact || null;
  };
}

function expandRecurringOccurrence(template, date) {
  if (!template || template.id == null || !validDate(date)) return null;
  const exception = template.exceptions?.[date] || {};
  const occurrence = resolveOccurrence(template, date);
  return {
    id: `recurring-${template.id}-${date}`,
    title: exception.title ?? template.title,
    startTime: exception.startTime ?? template.startTime,
    duration: exception.duration ?? template.duration,
    color: exception.color ?? template.color,
    completed: (template.completedDates || []).includes(date),
    isAllDay: exception.isAllDay ?? template.isAllDay ?? false,
    assignedUserSyncIds: exception.assignedUserSyncIds ?? template.assignedUserSyncIds,
    notes: template.notes || '',
    subtasks: template.subtasks || [],
    energy: template.energy,
    date,
    isRecurring: true,
    recurringTemplateId: template.id,
    recurrenceType: template.recurrence?.type,
    projectId: template.projectId,
    ...(template.isExample ? { isExample: true } : {}),
    // This occurrence was synthesized outside the native expansion window.
    // It can provide historical title/color/notes identity, but must never be
    // treated as a live task for native edit/complete/drag capabilities.
    isJoboSyntheticOccurrence: true,
    ...occurrence,
  };
}

export function resolveEditableDoRecord(records, openedRecord) {
  if (!Array.isArray(records) || !openedRecord?.id) return null;
  const current = records.find((record) => record?.id === openedRecord.id);
  if (!current || current.deleted) return null;
  // A newer reassessment, interval correction or tombstone must win over a
  // dialog that was opened earlier. Exact-timestamp tie resolution may swap
  // pristine copies, so use the current winner as the edit base when the
  // version timestamp itself has not advanced.
  if (current.updatedAt !== openedRecord.updatedAt) return null;
  return current;
}

export function planFromTask(task) {
  if (!task || !validDate(task.date) || task.isAllDay) return null;
  const start = timeMinutes(task.startTime);
  const duration = Number(task.duration);
  if (start == null || !Number.isFinite(duration) || duration <= 0) return null;
  return {
    date: task.date,
    startTime: task.startTime,
    duration,
  };
}

export function timedSliceOnDate(record, date) {
  if (!record || record.timing !== DO_TIMING.TIMED || !validDate(date)) return null;
  const start = absoluteMinute(record.date, record.startTime);
  const end = absoluteMinute(record.endDate, record.endTime);
  const day = dayNumber(date);
  if (start == null || end == null || day == null || end <= start) return null;
  const dayStart = day * DAY_MINUTES;
  const dayEnd = dayStart + DAY_MINUTES;
  const visibleStart = Math.max(start, dayStart);
  const visibleEnd = Math.min(end, dayEnd);
  if (visibleEnd <= visibleStart) return null;
  return {
    startMinute: visibleStart - dayStart,
    endMinute: visibleEnd - dayStart,
    durationMinutes: visibleEnd - visibleStart,
    clippedStart: start < dayStart,
    clippedEnd: end > dayEnd,
  };
}

export function assignOverlapColumns(items, options = {}) {
  const scale = typeof options === 'number' ? options : options?.scale;
  const minHeightPx = typeof options === 'object' && Number.isFinite(options?.minHeightPx)
    ? Math.max(0, options.minHeightPx) : 40;
  const gapPx = typeof options === 'object' && Number.isFinite(options?.gapPx)
    ? Math.max(0, options.gapPx) : 2;
  const useDisplayedFootprint = Number.isFinite(scale) && scale > 0;
  const displayedEnd = (item) => {
    if (!useDisplayedFootprint) return item.endMinute;
    const actualMinutes = Math.max(0, item.endMinute - item.startMinute);
    const actualHeightPx = actualMinutes / 60 * scale;
    // cardStyle subtracts the visual gap from the card height and enforces a
    // 40px minimum. Add the gap back here so the next card gets a real pixel
    // separation instead of only an interval separation.
    const cardHeightPx = Math.max(minHeightPx, actualHeightPx - gapPx);
    return item.startMinute + ((cardHeightPx + gapPx) / scale) * 60;
  };
  const sorted = [...items].sort((a, b) =>
    a.startMinute - b.startMinute
    || a.endMinute - b.endMinute
    || compareId(a.id, b.id));

  const out = [];
  let cluster = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;
    const columnEnds = [];
    const placed = cluster.map((item) => {
      let column = columnEnds.findIndex((end) => end <= item.startMinute);
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = displayedEnd(item);
      return { ...item, column };
    });
    const columnCount = Math.max(1, columnEnds.length);
    out.push(...placed.map((item) => ({
      ...item,
      columnCount,
      leftPct: (item.column / columnCount) * 100,
      widthPct: 100 / columnCount,
    })));
    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length && item.startMinute >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, displayedEnd(item));
  }
  flush();
  return out;
}

export function projectJoboRecords(records) {
  const winners = new Map();
  const unusable = new Set();
  let invalidRecordCount = Array.isArray(records) ? 0 : 1;
  for (const record of Array.isArray(records) ? records : []) {
    if (typeof record?.id !== 'string' || !record.id.trim()) { invalidRecordCount += 1; continue; }
    if (unusable.has(record.id)) continue;
    try { winners.set(record.id, pickJoboRecord(winners.get(record.id), record)); }
    catch { winners.delete(record.id); unusable.add(record.id); invalidRecordCount += 1; }
  }
  const liveRecords = [];
  for (const record of winners.values()) {
    if (!validateDoRecord(record).ok) { invalidRecordCount += 1; continue; }
    if (!record.deleted) liveRecords.push(record);
  }
  return { liveRecords, invalidRecordCount };
}

export function buildJoboDayModel({
  date,
  tasks = [],
  taskLookup = tasks,
  recurringTasks = [],
  records = [],
  now,
  scale,
  isVisibleForUser,
}) {
  const lookupTasks = Array.isArray(taskLookup) ? taskLookup : [];
  const { liveRecords, invalidRecordCount } = projectJoboRecords(records);
  // Resolve only the historical dates actually referenced by each template.
  // Expanding every template across every ledger date grows quadratically.
  const datesByTask = new Map();
  for (const record of liveRecords) {
    const occurrenceDate = occurrenceDateForRecord(record);
    if (!occurrenceDate || record.taskId == null) continue;
    const id = String(record.taskId);
    if (!datesByTask.has(id)) datesByTask.set(id, new Set());
    datesByTask.get(id).add(occurrenceDate);
  }
  const expandedFromTemplates = (Array.isArray(recurringTasks) ? recurringTasks : [])
    .flatMap(template => [...(datesByTask.get(String(template.id)) || [])]
      .map(occurrenceDate => expandRecurringOccurrence(template, occurrenceDate)).filter(Boolean));
  // Existing expanded objects carry live exception/completion fields. Template
  // expansion fills only dates outside the current scheduler window; lookup
  // objects therefore win deterministicly when both represent the same day.
  const sourceTasks = [...expandedFromTemplates, ...lookupTasks];
  const resolveRecordTask = buildTaskResolver(sourceTasks);

  const visibleTask = task => typeof isVisibleForUser !== 'function' || isVisibleForUser(task);
  const validLiveRecords = liveRecords.filter(record => {
    const source = resolveRecordTask(record);
    // Resolved household assignments are respected in both lanes. Orphaned
    // history remains independent of a task still existing, as the contract requires.
    return !source || visibleTask(source);
  });

  const visibleRecords = validLiveRecords.filter((record) => (
    record.timing === DO_TIMING.UNTIMED
      ? completionMarker(record)?.date === date
      : timedSliceOnDate(record, date) !== null
  ));

  // Rendering is date-windowed, but comparison is not: an attempt can happen
  // on a later day and still be evidence against this Plan. Group the complete
  // live ledger here, then use visibleRecords only for drawing the selected day.
  const groups = new Map();
  for (const record of validLiveRecords) {
    const key = recordGroupKey(record);
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }

  const summaryByGroup = new Map();
  const progressesByGroup = new Map();
  const attemptsByGroup = new Map();
  const metadataByGroup = new Map();
  for (const [key, group] of groups) {
    const snapshot = group[0]?.planSnapshot ?? null;
    const knownUnplanned = snapshot === null;
    const metadata = comparisonMetadata(snapshot, group, { knownUnplanned });
    metadataByGroup.set(key, metadata);
    summaryByGroup.set(key, metadata.comparison ? summarizeTiming(metadata.comparison) : []);
    progressesByGroup.set(key, progressesForGroup(group));
    attemptsByGroup.set(key, metadata.attempts);
  }

  const timedRecords = assignOverlapColumns(
    visibleRecords
      .filter((record) => record.timing === DO_TIMING.TIMED)
      .map((record) => {
        const slice = timedSliceOnDate(record, date);
        const groupKey = recordGroupKey(record);
        const metadata = metadataByGroup.get(groupKey);
        const task = resolveRecordTask(record);
        return {
          id: record.id,
          groupKey,
          record,
          task,
          sourceTask: task,
          noteKey: noteKeyForTask(task),
          labels: summaryByGroup.get(groupKey) || [],
          attempts: attemptsByGroup.get(groupKey) || [],
          latestAttempt: latestJoboAttempt(attemptsByGroup.get(groupKey) || []),
          comparison: metadata?.comparison || null,
          comparisonMeta: metadata || null,
          ...slice,
        };
      }),
    scale === undefined ? undefined : { scale },
  );

  const untimedRecords = visibleRecords
    .filter((record) => record.timing === DO_TIMING.UNTIMED)
    .map((record) => {
      const groupKey = recordGroupKey(record);
      const metadata = metadataByGroup.get(groupKey);
      const task = resolveRecordTask(record);
      return {
        ...completionMarker(record),
        id: record.id,
        groupKey,
        record,
        task,
        sourceTask: task,
        noteKey: noteKeyForTask(task),
        labels: summaryByGroup.get(groupKey) || [],
        attempts: attemptsByGroup.get(groupKey) || [],
        latestAttempt: latestJoboAttempt(attemptsByGroup.get(groupKey) || []),
        comparison: metadata?.comparison || null,
        comparisonMeta: metadata || null,
      };
    })
    .sort((a, b) => String(a.record.title).localeCompare(String(b.record.title)));

  // Final Plan is capture-once history. Render a captured Plan from the record
  // even when the live task was later renamed, rescheduled or deleted; otherwise
  // the card position could disagree with the very snapshot used for its badges.
  const capturedPlanKeys = new Set();
  const capturedPlans = [];
  for (const [key, group] of groups) {
    const representative = sortJoboAttempts(group).at(-1);
    const plan = representative?.planSnapshot ?? null;
    if (!plan || plan.date !== date) continue;

    const linkedTask = resolveRecordTask(representative);
    const task = linkedTask
      ? { ...linkedTask, title: representative.title }
      : {
          id: representative.taskId,
          title: representative.title,
          color: 'bg-blue-500',
          notes: '',
        };
    const startMinute = timeMinutes(plan.startTime);
    const livePlan = planFromTask(linkedTask);
    const currentTask = !linkedTask?.isJoboSyntheticOccurrence
      && livePlan && planSnapshotKey(livePlan) === planSnapshotKey(plan)
      && linkedTask.title === representative.title
      ? linkedTask : null;
    if (currentTask) capturedPlanKeys.add(key);
    const metadata = metadataByGroup.get(key);
    const attempts = attemptsByGroup.get(key) || [];
    capturedPlans.push({
      id: `captured::${key}`,
      groupKey: key,
      currentTask,
      historical: !currentTask,
      task,
      sourceTask: linkedTask,
      plan,
      labels: summaryByGroup.get(key) || [],
      progresses: progressesByGroup.get(key) || [],
      attempts,
      latestAttempt: latestJoboAttempt(attempts),
      latestProgress: latestJoboAttempt(attempts)?.progress || null,
      comparison: metadata?.comparison || null,
      comparisonMeta: metadata || null,
      noteKey: noteKeyForTask(linkedTask),
      startMinute,
      endMinute: Math.min(DAY_MINUTES, startMinute + plan.duration),
    });
  }

  const currentPlans = (Array.isArray(tasks) ? tasks : [])
    .map((task) => ({ task, plan: planFromTask(task) }))
    .filter(({ task, plan }) => task?.id != null && plan && plan.date === date && visibleTask(task))
    // When a record already captured this exact Final Plan, the captured copy
    // is the historical source of truth and also preserves the captured title.
    .filter(({ task, plan }) => !capturedPlanKeys.has(taskPlanGroupKey(task, plan)))
    .map(({ task, plan }) => {
      const startMinute = timeMinutes(plan.startTime);
      const key = taskPlanGroupKey(task, plan);
      const linked = key == null ? [] : (groups.get(key) || []);
      const comparisonOptions = {
        displayedPlan: plan,
        ...(linked.length === 0 && now && invalidRecordCount === 0 ? { now } : {}),
      };
      const metadata = comparisonMetadata(plan, linked, comparisonOptions);
      const labels = metadata.comparison && (linked.length > 0 || (now && invalidRecordCount === 0))
        ? summarizeTiming(metadata.comparison) : [];
      const attempts = metadata.attempts;
      const latestAttempt = latestJoboAttempt(attempts);

      return {
        id: `current::${String(task.id)}::${planSnapshotKey(plan)}`,
        groupKey: key,
        currentTask: task,
        historical: false,
        task,
        sourceTask: task,
        plan,
        labels,
        progresses: progressesByGroup.get(key) || [],
        attempts,
        latestAttempt,
        latestProgress: latestAttempt?.progress || null,
        comparison: metadata.comparison,
        comparisonMeta: metadata,
        noteKey: noteKeyForTask(task),
        startMinute,
        endMinute: Math.min(DAY_MINUTES, startMinute + plan.duration),
      };
    });

  const planned = [...capturedPlans, ...currentPlans];

  return {
    // ExecutionDetails can edit any attempt in a group, not only today's
    // visible slices. Reuse this resolver for its current task/occurrence.
    resolveRecordTask,
    plans: assignOverlapColumns(planned, scale === undefined ? undefined : { scale }),
    timedRecords,
    untimedRecords,
    invalidRecordCount,
  };
}

export { DAY_MINUTES, TIMING_SUMMARY };
