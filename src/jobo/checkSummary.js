// Dormant seed for the separately proposed Statistics view (#1882 review).
// The Check journal does not import this rollup. No records or writes owned here.
import { comparePlanAnchors } from './core.js';
import { isNativeJoboTask, summarizeJoboDayModel, timedSkips } from './dayStats.js';
import { notBucketed } from '../utils/bucketList.js';

export const CHECK_PRIORITIES = ['high', 'medium', 'low', 'none', 'unknown'];
const progressCounts = () => ({ completed: 0, mostly: 0, partial: 0, started: 0 });
const unique = (items, key) => [...new Map(items.map(item => [key(item), item])).values()];
const sum = (items, read) => items.reduce((total, item) => total + read(item), 0);

/**
 * Sessions in an execution group: its attempts, less any completion that
 * closes the last timed session (core's closesLastSession), which is that
 * session's end rather than a session. Do record counts are not reduced.
 * The same count classifies single and split sessions in every scope.
 */
export function groupSessionCount(item) {
  const attempts = item?.attempts?.length ?? 0;
  return attempts - (item?.comparison?.metrics?.closingCompletionCount ?? 0);
}

// Native priority: 0 = none, then low, medium, high. Missing task metadata
// stays unknown; neither a title nor a tag proves the current priority.
export function checkPriority(task) {
  if (!task) return 'unknown';
  const value = task.priority;
  return Number.isInteger(value) && value >= 0 && value <= 3
    ? ['none', 'low', 'medium', 'high'][value] : 'unknown';
}

export function buildCheckSummary(model, { date, inboxTasks = [], skips = [] } = {}) {
  if (!model) return null;
  const stats = summarizeJoboDayModel(model, { skips });
  const clean = stats.invalidCount === 0;
  // Skipped occurrences count in each priority's total as they do overall.
  const current = unique([...model.plans.map(item => item.currentTask).filter(isNativeJoboTask), ...timedSkips(skips)],
    task => String(task.id));
  const items = unique([...model.timedRecords, ...model.untimedRecords], item => item.id);
  const measured = model.timedRecords.filter(item => item.record.timingBasis !== 'planDuration');
  const dayGroups = unique(items, item => item.groupKey);
  // Exactly the captured-plan population used by the date-header statistics.
  const captured = unique(model.plans.filter(item => item.id.startsWith('captured::') && item.attempts.length), item => item.groupKey);
  const comparable = clean ? captured.filter(item => item.comparison?.comparable) : [];
  const priorities = Object.fromEntries(CHECK_PRIORITIES.map(key => [key, {
    completed: 0, total: 0, recordedMinutes: null, progress: progressCounts(),
    changed: 0, comparable: 0, lateStart: 0, lateFinish: 0, longer: 0,
  }]));
  const progress = progressCounts();
  for (const task of current) {
    const row = priorities[checkPriority(task)];
    row.total += 1;
    row.completed += Number(task.completed === true);
  }
  for (const item of items) {
    const value = item.record.progress;
    if (Object.hasOwn(progress, value)) {
      progress[value] += 1;
      priorities[checkPriority(item.sourceTask)].progress[value] += 1;
    }
  }
  for (const key of CHECK_PRIORITIES) {
    // Reuse the header's union/clipping semantics for every priority. These
    // coverages can overlap EACH OTHER, so they must not be summed as shares.
    priorities[key].recordedMinutes = summarizeJoboDayModel({
      ...model, plans: [], timedRecords: measured.filter(item => checkPriority(item.sourceTask) === key),
    }).recordedMinutes;
  }
  const changes = { compared: 0, start: 0, finish: 0, duration: 0, unchanged: 0, unknown: captured.length };
  if (clean) for (const item of captured) {
    try {
      const delta = comparePlanAnchors(item.sourceTask?.originalPlan, item.plan);
      const start = delta.startShiftMinutes !== 0;
      const finish = delta.finishShiftMinutes !== 0;
      const duration = delta.durationDifferenceMinutes !== 0;
      changes.compared += 1;
      changes.unknown -= 1;
      changes.start += Number(start);
      changes.finish += Number(finish);
      changes.duration += Number(duration);
      changes.unchanged += Number(!start && !finish && !duration);
      if (start || finish || duration) priorities[checkPriority(item.sourceTask)].changed += 1;
    } catch { /* No original anchor is unknown, not an unchanged plan. */ }
  }
  for (const item of comparable) {
    const row = priorities[checkPriority(item.sourceTask)];
    row.comparable += 1;
    row.lateStart += Number(item.comparison.startTiming === 'late');
    row.lateFinish += Number(item.comparison.finishTiming === 'late');
    row.longer += Number(item.comparison.durationComparison === 'longer');
  }
  // Group span/gap refer to the FULL group, not today's free time. Measured
  // diagnostics survive mixed groups, but are never called a full comparison.
  const measuredGroups = clean ? dayGroups.filter(item => item.comparisonMeta?.measuredAttempts?.length) : [];
  const groupMetrics = measuredGroups.map(item => item.comparisonMeta.measuredComparison?.metrics).filter(Boolean);
  const maxMetric = key => comparable.length ? Math.max(0, ...comparable.map(item => item.comparison.metrics[key])) : null;
  const windowMinutes = key => comparable.length ? sum(comparable, item => item.comparison.metrics[key]) : null;
  const inside = windowMinutes('planOverlapMinutes');
  const groupRecorded = windowMinutes('recordedMinutes');
  const rawMinutes = clean && measured.length ? sum(measured, item => item.endMinute - item.startMinute) : null;
  const contexts = { planned: 0, noPlan: 0, unknown: 0 };
  const relations = {};
  for (const item of dayGroups) {
    const context = item.comparison?.planContext ?? item.comparisonMeta?.measuredComparison?.planContext ?? 'unknown';
    contexts[context] += 1;
  }
  for (const item of comparable) {
    const relation = item.comparison.intervalRelation;
    if (relation) relations[relation] = (relations[relation] || 0) + 1;
  }
  // Same source-date criterion as useStats; never mix its always-TODAY totals
  // into a report of a selected historical date. Input has already been scoped
  // to the household user. Queue counts are separate from the timed-plan denominator.
  const completedInbox = unique(inboxTasks.filter(task => notBucketed(task)
    && !task.isExample && task.completed
    && typeof task.completedAt === 'string' && task.completedAt.startsWith(date)), task => String(task.id));
  return {
    stats, clean, priorities, changes, progress, contexts, relations,
    inboxCompleted: completedInbox.filter(task => !task.projectId && !task.deadline).length,
    projectCompleted: completedInbox.filter(task => task.projectId).length,
    doCount: items.length,
    single: dayGroups.filter(item => groupSessionCount(item) === 1).length,
    split: dayGroups.filter(item => groupSessionCount(item) > 1).length,
    rawMinutes,
    overlapMinutes: rawMinutes == null ? null : rawMinutes - stats.recordedMinutes,
    gapMinutes: groupMetrics.length ? sum(groupMetrics, m => m.gapMinutes) : null,
    maxSpanMinutes: groupMetrics.length ? Math.max(...groupMetrics.map(m => m.elapsedMinutes)) : null,
    insideMinutes: inside,
    outsideMinutes: inside == null ? null : groupRecorded - inside,
    maxStart: maxMetric('startOffsetMinutes'),
    maxFinish: maxMetric('finishOffsetMinutes'),
    maxLonger: maxMetric('durationDifferenceMinutes'),
    minRatio: comparable.length ? Math.min(...comparable.map(item => item.comparison.metrics.durationRatio)) : null,
    maxRatio: comparable.length ? Math.max(...comparable.map(item => item.comparison.metrics.durationRatio)) : null,
    withinPlan: comparable.filter(item => item.comparison.withinPlan).length,
    noDo: clean ? unique(model.plans.filter(item => isNativeJoboTask(item.currentTask) && item.comparison?.notStarted), item => String(item.currentTask.id)).length : null,
  };
}
