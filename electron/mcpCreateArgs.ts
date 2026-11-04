// Argument-shape rules for the extended dayglance_create_task (spec §5.1),
// extracted pure in the host kit's dates.js style: every accept/reject decision for
// the create arguments lives here, unit-tested and mutation-verified, so the
// tool handler in mcpWriteTools.ts is wiring only.
//
// TWO CREATE SHAPES, decided by `start`:
//   absent  → inbox task (may carry priority 0-3 and a deadline date, with or
//             without project_id: an unscheduled project task is an inbox
//             task, and the UI gives it both controls)
//   present → scheduled task, created DIRECTLY onto the calendar in one
//             transition (never inbox-then-schedule: applyScheduleTask strips
//             priority and deadline by design, and §5.2 forbids the partial
//             state between two transitions)
//
// BY-DESIGN REJECTIONS (typed 'validation' errors, §5.2): the copy must say
// the app does not carry these combinations BY DESIGN — never that a field is
// unsupported — so a model reports the design to the user instead of retrying
// another way:
//   - priority/deadline with start:      scheduled tasks never carry them
//   - all_day with duration_minutes:     an all-day task has no meaningful
//     duration (the UI disables the input)
//   - all_day with a time in start:      all-day takes a bare date
//   - repeat without start:              a series lives on the calendar
//
// A THIRD SHAPE, repeat (#2066): with start, `repeat` turns the scheduled
// create into a recurring SERIES whose first date is start's. The pattern is
// validated by mcpRepeatArgs.ts, which also carries the by-design rejection of
// an interval the app cannot repeat on.

import { isValidLocalDate, validateStartTime } from '@glance-apps/mcp-host';
import { validateDurationMinutes } from './mcpLocalTime.js';
import { parseRepeat, type RecurrencePattern } from './mcpRepeatArgs.js';

export interface CreateTaskArgs {
  title?: unknown;
  notes?: unknown;
  project_id?: unknown;
  assignee_id?: unknown;
  priority?: unknown;
  deadline?: unknown;
  start?: unknown;
  duration_minutes?: unknown;
  all_day?: unknown;
  repeat?: unknown;
}

/** What the renderer mutation needs; field names are its camelCase params. */
export interface CreatePlan {
  title: string;
  notes?: string;
  projectId?: string;
  assigneeSyncId?: string;
  /** Inbox shape only. */
  priority?: number;
  deadline?: string;
  /** Inbox duration (scheduled duration lives in `schedule`). */
  durationMinutes?: number;
  /**
   * Series shape only (#2066): the stored recurrence, startDate included. Its
   * presence turns the scheduled create into a recurring template.
   */
  recurrence?: RecurrencePattern & { startDate: string };
  /** Scheduled shape only — presence means create onto the calendar. */
  schedule?: {
    date: string;
    /** '00:00' for all-day, matching the UI's own stored shape. */
    startTime: string;
    durationMinutes: number;
    allDay: boolean;
  };
}

export type CreatePlanResult =
  | { ok: true; plan: CreatePlan }
  | { ok: false; code: 'validation'; message: string };

const reject = (message: string): CreatePlanResult => ({ ok: false, code: 'validation', message });

/**
 * Validate the wire arguments and shape the renderer mutation params.
 * Everything here runs BEFORE any renderer call (§5.2: a failed validation
 * must leave no partial state — and no state at all is touched until the
 * single applyCreateTask transition).
 */
export function planCreateTask(args: CreateTaskArgs, timeZone: string): CreatePlanResult {
  const { title, notes, project_id, assignee_id, priority, deadline, start, duration_minutes, all_day, repeat } = args;

  if (typeof title !== 'string' || !title.trim()) {
    return reject('title must be a non-empty string');
  }

  const scheduled = start !== undefined;
  if (repeat !== undefined && !scheduled) {
    return reject(
      'A repeating series lives on the calendar, so repeat needs start: the first date, with a time ' +
      '("YYYY-MM-DD HH:MM") or as a bare date with all_day. Unscheduled inbox tasks do not repeat by design.',
    );
  }
  const allDay = all_day === true;

  if (scheduled && (priority !== undefined || deadline !== undefined)) {
    return reject(
      'Scheduled dayGLANCE tasks do not carry priority or deadline by design: those fields belong to inbox ' +
      'tasks only, and scheduling an inbox task drops them. Create the task without start to keep them.',
    );
  }

  let priorityValue: number | undefined;
  if (priority !== undefined) {
    if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > 3) {
      return reject(`priority must be an integer 0-3 (0 none, 1 low, 2 medium, 3 high), got ${JSON.stringify(priority)}`);
    }
    priorityValue = priority;
  }
  if (deadline !== undefined && !isValidLocalDate(deadline)) {
    return reject(`deadline must be a real local calendar date in strict YYYY-MM-DD form (no time), got ${JSON.stringify(deadline)}`);
  }
  if (duration_minutes !== undefined) {
    const durationError = validateDurationMinutes(duration_minutes);
    if (durationError) return reject(durationError);
  }

  if (!scheduled && allDay) {
    return reject('all_day applies to scheduled creates only. Pass start (a bare YYYY-MM-DD date) alongside all_day.');
  }

  const plan: CreatePlan = { title };
  if (typeof notes === 'string') plan.notes = notes;
  if (typeof project_id === 'string') plan.projectId = project_id;
  if (typeof assignee_id === 'string') plan.assigneeSyncId = assignee_id;

  if (!scheduled) {
    if (priorityValue !== undefined) plan.priority = priorityValue;
    if (deadline !== undefined) plan.deadline = deadline as string;
    if (typeof duration_minutes === 'number') plan.durationMinutes = duration_minutes;
    return { ok: true, plan };
  }

  if (allDay) {
    if (duration_minutes !== undefined) {
      return reject(
        'all_day and duration_minutes contradict each other: an all-day task has no meaningful duration. ' +
        'Drop duration_minutes, or drop all_day to create a timed block.',
      );
    }
    if (!isValidLocalDate(start)) {
      return reject(
        `with all_day, start is a bare local calendar date: all-day tasks take a date only, no time component. ` +
        `Expected strict YYYY-MM-DD, got ${JSON.stringify(start)}`,
      );
    }
    plan.schedule = { date: start as string, startTime: '00:00', durationMinutes: 30, allDay: true };
    return withRepeat(plan, repeat);
  }

  if (typeof start !== 'string' || !/^\S+ \S+$/.test(start)) {
    return reject(`start must be "YYYY-MM-DD HH:MM" (local calendar date + local wall-clock time), got ${JSON.stringify(start)}`);
  }
  const [date, time] = start.split(' ') as [string, string];
  if (!isValidLocalDate(date)) {
    return reject(`start date must be a real local calendar date in strict YYYY-MM-DD form, got ${JSON.stringify(date)}`);
  }
  const timeError = validateStartTime(date, time, timeZone);
  if (timeError) return reject(timeError);

  plan.schedule = {
    date,
    startTime: time,
    durationMinutes: typeof duration_minutes === 'number' ? duration_minutes : 30,
    allDay: false,
  };
  return withRepeat(plan, repeat);
}

/** Attach the series pattern to a scheduled plan, anchored on its first date. */
function withRepeat(plan: CreatePlan, repeat: unknown): CreatePlanResult {
  if (repeat === undefined || !plan.schedule) return { ok: true, plan };
  const parsed = parseRepeat(repeat, plan.schedule.date);
  if (!parsed.ok) return parsed;
  plan.recurrence = { ...parsed.recurrence, startDate: plan.schedule.date };
  return { ok: true, plan };
}
