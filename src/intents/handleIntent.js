import {
  ACTIONS,
  TABS,
  QUERY_RETURN_VARS,
  RETURN_VAR_TYPES,
  CreateSchema,
  CompleteSchema,
  OpenSchema,
  QuerySchema,
  normalizePriority,
  normalizeTags,
  normalizeDue,
  normalizeRecurring,
  createKey,
} from '@glance-apps/intents';

export const DEFAULT_TASK_COLOR = 'bg-blue-500';

function ok(extra = {}) {
  return { success: true, task_id: '', error: '', warning: '', ...extra };
}

function fail(message) {
  return { success: false, task_id: '', error: message, warning: '' };
}

function validate(schema, payload) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'Invalid payload' };
  }
  return { ok: true, data: result.data };
}

/**
 * Re-embed tags into the title so dayGLANCE's tag-in-title storage model is
 * satisfied. normalizeTags strips inline #tags from the title; this puts the
 * full merged+deduped set back.
 */
function rebuildTitle(cleanedTitle, tags) {
  if (!tags?.length) return cleanedTitle;
  return `${cleanedTitle} ${tags.map(t => `#${t}`).join(' ')}`;
}

/**
 * Split a normalized ISO `due` string into the dayGLANCE task scheduling fields.
 * Date-only strings (YYYY-MM-DD) and explicit all_day=true produce isAllDay tasks.
 */
function parseDue(due, allDay) {
  if (!due) return null;

  const dateOnly = !due.includes('T');
  if (dateOnly || allDay) {
    return { date: due.slice(0, 10), startTime: '00:00', isAllDay: true };
  }

  const d = new Date(due);
  const date = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
  const startTime = [
    String(d.getHours()).padStart(2, '0'),
    String(d.getMinutes()).padStart(2, '0'),
  ].join(':');

  return { date, startTime, isAllDay: false };
}

/**
 * Convert a normalizeRecurring-produced `FREQ=…` string to dayGLANCE's
 * internal recurrence object `{ type, startDate, daysOfWeek?, … }`.
 */
function freqToRecurrence(freqStr, startDate) {
  const DAY_MAP = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 0 };
  const parts = Object.fromEntries(
    freqStr.split(';').map(p => {
      const eq = p.indexOf('=');
      return [p.slice(0, eq).toUpperCase(), p.slice(eq + 1).toUpperCase()];
    })
  );

  const base = { startDate };

  switch (parts.FREQ) {
    case 'DAILY':
      return { ...base, type: 'daily' };
    case 'WEEKLY': {
      if (parts.BYDAY) {
        const daysOfWeek = parts.BYDAY.split(',')
          .map(d => DAY_MAP[d.trim()])
          .filter(d => d !== undefined);
        return { ...base, type: 'weekly', daysOfWeek };
      }
      return { ...base, type: 'weekly' };
    }
    case 'MONTHLY':
      return { ...base, type: 'monthly' };
    case 'YEARLY':
      return { ...base, type: 'yearly' };
    default:
      return { ...base, type: 'daily' };
  }
}

/** Match a project name or ID against the projects list. Returns projectId or undefined. */
function resolveProjectId(nameOrId, projects) {
  if (!nameOrId || !projects?.length) return undefined;
  return (
    projects.find(p => p.id === nameOrId)?.id ??
    projects.find(p => p.name?.toLowerCase() === nameOrId.toLowerCase())?.id
  );
}

async function handleCreate(payload, context) {
  const {
    tasks = [],
    unscheduledTasks = [],
    recurringTasks = [],
    setTasks,
    setUnscheduledTasks,
    setRecurringTasks,
    projects = [],
  } = context;

  const v = validate(CreateSchema, payload);
  if (!v.ok) return fail(v.error);

  const raw = v.data;

  const { title: cleanedTitle, tags } = normalizeTags({ title: raw.title, tags: raw.tags });
  const { due, all_day: inferredAllDay } = normalizeDue(raw.due);
  const priority = normalizePriority(raw.priority);

  let recurring;
  try {
    recurring = normalizeRecurring(raw.recurring);
  } catch {
    return fail(`Invalid recurring value: ${raw.recurring}`);
  }

  const allDay = raw.all_day !== undefined ? raw.all_day : inferredAllDay;

  const normalized = {
    title: cleanedTitle,
    tags,
    due,
    all_day: allDay,
    duration: raw.duration,
    deadline: raw.deadline,
    notes: raw.notes,
    project: raw.project,
    priority,
    recurring,
    source_app: raw.source_app,
    source_entity_id: raw.source_entity_id,
  };

  let intentKey = null;

  if (raw.source_app && raw.source_entity_id) {
    intentKey = await createKey(raw.source_app, raw.source_entity_id, due);

    const existing =
      tasks.find(t => t._intentKey === intentKey && !t.completed) ||
      unscheduledTasks.find(t => t._intentKey === intentKey && !t.completed) ||
      recurringTasks.find(t => t._intentKey === intentKey);

    if (existing) {
      if (setTasks || setUnscheduledTasks || setRecurringTasks) {
        // Execute: update the existing task in whichever list it lives in.
        const projectId = resolveProjectId(normalized.project, projects);
        const taskTitle = rebuildTitle(cleanedTitle, tags);
        const updates = {
          title: taskTitle,
          notes: normalized.notes ?? existing.notes,
          priority: priority ?? existing.priority,
          ...(projectId !== undefined ? { projectId } : {}),
        };

        if (tasks.find(t => t.id === existing.id)) {
          setTasks(prev => prev.map(t => t.id === existing.id ? { ...t, ...updates } : t));
        } else if (unscheduledTasks.find(t => t.id === existing.id)) {
          setUnscheduledTasks(prev => prev.map(t => t.id === existing.id ? { ...t, ...updates } : t));
        } else {
          setRecurringTasks(prev => prev.map(t => t.id === existing.id ? { ...t, ...updates } : t));
        }

        return ok({ task_id: existing.id, warning: 'Updated existing task' });
      }

      // Skeleton: no setters — return normalized result with warning.
      const warning = `Task already exists; will update (id: ${existing.id})`;
      return ok({ warning, _normalized: normalized, _intentKey: intentKey });
    }
  }

  // Skeleton mode: no setters provided, return normalized result only.
  if (!setTasks && !setUnscheduledTasks && !setRecurringTasks) {
    return ok({ warning: '', _normalized: normalized, _intentKey: intentKey });
  }

  // Execute: create a new task.
  const taskId = crypto.randomUUID();
  const projectId = resolveProjectId(normalized.project, projects);
  const taskTitle = rebuildTitle(cleanedTitle, tags);

  const baseTask = {
    id: taskId,
    title: taskTitle,
    duration: normalized.duration ?? 30,
    color: DEFAULT_TASK_COLOR,
    completed: false,
    notes: normalized.notes ?? '',
    subtasks: [],
    ...(projectId !== undefined ? { projectId } : {}),
    ...(normalized.source_app ? { source_app: normalized.source_app } : {}),
    ...(normalized.source_entity_id ? { source_entity_id: normalized.source_entity_id } : {}),
    ...(intentKey ? { _intentKey: intentKey } : {}),
  };

  if (recurring) {
    const scheduled = parseDue(due, allDay);
    const startDate = scheduled?.date ?? new Date().toISOString().slice(0, 10);
    setRecurringTasks(prev => [...prev, {
      ...baseTask,
      startTime: scheduled && !scheduled.isAllDay ? scheduled.startTime : '00:00',
      isAllDay: allDay ?? true,
      recurrence: freqToRecurrence(recurring, startDate),
      completedDates: [],
      exceptions: {},
    }]);
  } else if (due) {
    const scheduled = parseDue(due, allDay);
    setTasks(prev => [...prev, {
      ...baseTask,
      date: scheduled.date,
      startTime: scheduled.startTime,
      isAllDay: scheduled.isAllDay,
    }]);
  } else {
    setUnscheduledTasks(prev => [...prev, {
      ...baseTask,
      priority: priority ?? 0,
      ...(normalized.deadline ? { deadline: normalized.deadline } : {}),
    }]);
  }

  return ok({ task_id: taskId });
}

function handleComplete(payload, context) {
  const v = validate(CompleteSchema, payload);
  if (!v.ok) return fail(v.error);

  const { title: searchTitle, completed_at } = v.data;
  const { tasks = [], unscheduledTasks = [], setTasks, setUnscheduledTasks } = context;

  // Skeleton mode: no setters provided.
  if (!setTasks && !setUnscheduledTasks) {
    return ok({ _normalized: v.data });
  }

  // Collect all incomplete tasks, tagging each with which list it came from.
  const candidates = [
    ...tasks.map(t => ({ ...t, _list: 'tasks' })),
    ...unscheduledTasks.map(t => ({ ...t, _list: 'unscheduled' })),
  ].filter(t => !t.completed);

  const norm = s => s.toLowerCase().trim();
  const needle = norm(searchTitle);

  // Exact match first, then partial.
  let matches = candidates.filter(t => norm(t.title) === needle);
  if (!matches.length) {
    matches = candidates.filter(t => norm(t.title).includes(needle));
  }

  if (!matches.length) {
    return fail('no matching task');
  }

  let warning = '';
  let target = matches[0];

  if (matches.length > 1) {
    // Soonest-due tiebreak: scheduled date, then deadline, then no-date (sorts last).
    const dueOf = t => t.date || t.deadline || null;
    matches.sort((a, b) => {
      const da = dueOf(a), db = dueOf(b);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? -1 : da > db ? 1 : 0;
    });
    target = matches[0];
    warning = `${matches.length} tasks matched "${searchTitle}"; completed soonest-due (${target.date || target.deadline || 'no date'})`;
  }

  const completedAt = completed_at || new Date().toISOString();
  const patch = { completed: true, completedAt };

  if (target._list === 'tasks') {
    setTasks(prev => prev.map(t => t.id === target.id ? { ...t, ...patch } : t));
  } else {
    setUnscheduledTasks(prev => prev.map(t => t.id === target.id ? { ...t, ...patch } : t));
  }

  return ok({ task_id: target.id, warning });
}

function handleOpen(payload) {
  const v = validate(OpenSchema, payload);
  if (!v.ok) return fail(v.error);

  const requested = v.data.tab;
  const tab = Object.values(TABS).includes(requested) ? requested : TABS.GLANCE;

  return ok({ _normalized: { tab } });
}

function handleQuery(payload) {
  const v = validate(QuerySchema, payload);
  if (!v.ok) return fail(v.error);

  // Query vars are populated by the executor (PR #6); skeleton returns typed zero-values.
  const queryVars = Object.fromEntries(
    Object.values(QUERY_RETURN_VARS).map(k => [k, RETURN_VAR_TYPES[k] === 'string' ? '' : 0])
  );

  return ok(queryVars);
}

/**
 * Core intent handler. Validates, normalizes, and checks idempotency.
 * Executes state changes when setters are provided in context.
 *
 * @param {string} action - One of the ACTIONS constants
 * @param {object} payload - Raw payload from the transport layer
 * @param {object} context - { tasks?, unscheduledTasks?, recurringTasks?, projects?,
 *                             setTasks?, setUnscheduledTasks?, setRecurringTasks? }
 * @returns {Promise<object>} Result: { success, task_id, error, warning, ...queryVars? }
 */
export async function handleIntent(action, payload, context = {}) {
  switch (action) {
    case ACTIONS.CREATE:
      return handleCreate(payload, context);
    case ACTIONS.COMPLETE:
      return handleComplete(payload, context);
    case ACTIONS.OPEN:
      return handleOpen(payload);
    case ACTIONS.QUERY:
      return handleQuery(payload);
    default:
      return fail(`Unknown action: ${action}`);
  }
}
