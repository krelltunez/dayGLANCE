// Read-only aggregation of the existing day model, before any display-only
// completion estimate or drag preview. No second model build, state or writer.
//
// Time is committed measured coverage clipped to the selected day. Comparison
// is per captured Plan dated that day, using its COMPLETE attempt group (which
// can span days). These scopes must not be divided into an actual/plan ratio.
// Native task denominators and not-started counts share this population.
// Execution history is independent and must not be filtered by this predicate.
export function isNativeJoboTask(task) {
  return task?.id != null && !task.archived && !task.isJoboSyntheticOccurrence
    && !(task.imported && !task.isTaskCalendar);
}

// Timed occurrences skipped from the Check (skipOccurrence.js). The engine
// hides them, so the day model has no plan for them; they join the native
// population here with their frozen plan, never the comparisons.
export const timedSkips = skips => (Array.isArray(skips) ? skips : []).filter(task => task && !task.isAllDay && task.startTime);

export function summarizeJoboDayModel(model, { skips = [] } = {}) {
  if (!model) return null;
  const native = new Map();
  for (const item of model.plans) {
    const task = item.currentTask;
    if (!isNativeJoboTask(task)) continue;
    native.set(String(task.id), { task, minutes: Math.max(0, item.endMinute - item.startMinute) });
  }
  // A skip stays in the denominator as planned and not done (completed only
  // if a completion arrived after it), so skipping never raises the rate.
  const skipped = timedSkips(skips);
  for (const task of skipped) {
    if (!native.has(String(task.id))) native.set(String(task.id), { task, minutes: Math.max(0, Number(task.duration) || 0) });
  }
  const current = [...native.values()];
  const measured = model.timedRecords.filter(item => item.record.timingBasis !== 'planDuration');
  let end = -Infinity;
  let recordedMinutes = 0;
  for (const item of [...measured].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute)) {
    recordedMinutes += Math.max(0, item.endMinute - Math.max(item.startMinute, end));
    end = Math.max(end, item.endMinute);
  }
  // Plans may expose both a captured title and a renamed current task at the
  // same time. Each captured execution group contributes only once.
  const captured = new Map();
  for (const item of model.plans) {
    if (item.id.startsWith('captured::') && item.attempts.length) captured.set(item.groupKey, item);
  }
  const groups = [...captured.values()];
  const clean = model.invalidRecordCount === 0;
  const comparable = clean ? groups.filter(item => item.comparison?.comparable === true) : [];
  const start = { early: 0, onTime: 0, late: 0 };
  const finish = { early: 0, onTime: 0, late: 0 };
  const duration = { shorter: 0, onEstimate: 0, longer: 0 };
  for (const { comparison } of comparable) {
    start[comparison.startTiming] += 1;
    finish[comparison.finishTiming] += 1;
    duration[comparison.durationComparison] += 1;
  }
  return {
    native: {
      completed: current.filter(({ task }) => task.completed === true).length,
      total: current.length,
      plannedMinutes: current.reduce((sum, item) => sum + item.minutes, 0),
      // Still skipped: no completion and no Do arrived after the skip.
      skipped: skipped.filter(task => task.skipState === 'skipped').length,
    },
    // No measured intervals means unknown recorded duration, not zero activity.
    recordedMinutes: clean && measured.length ? recordedMinutes : null,
    untimedCount: model.untimedRecords.length,
    inferredCount: model.timedRecords.length - measured.length,
    invalidCount: model.invalidRecordCount,
    comparison: {
      comparableCount: clean ? comparable.length : null,
      groupCount: groups.length,
      excludedCount: clean ? groups.length - comparable.length : null,
      start, finish, duration,
    },
  };
}
