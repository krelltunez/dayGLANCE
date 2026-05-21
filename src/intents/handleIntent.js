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

async function handleCreate(payload, tasks) {
  const v = validate(CreateSchema, payload);
  if (!v.ok) return fail(v.error);

  const raw = v.data;

  const { title, tags } = normalizeTags({ title: raw.title, tags: raw.tags });
  const { due, all_day: inferredAllDay } = normalizeDue(raw.due);
  const priority = normalizePriority(raw.priority);

  let recurring;
  try {
    recurring = normalizeRecurring(raw.recurring);
  } catch (e) {
    return fail(`Invalid recurring value: ${raw.recurring}`);
  }

  const normalized = {
    title,
    tags,
    due,
    all_day: raw.all_day !== undefined ? raw.all_day : inferredAllDay,
    duration: raw.duration,
    deadline: raw.deadline,
    notes: raw.notes,
    project: raw.project,
    priority,
    recurring,
    source_app: raw.source_app,
    source_entity_id: raw.source_entity_id,
  };

  let warning = '';
  let intentKey = null;

  if (raw.source_app && raw.source_entity_id) {
    intentKey = await createKey(raw.source_app, raw.source_entity_id, due);
    const existing = tasks.find(t => t._intentKey === intentKey && !t.completed);
    if (existing) {
      warning = `Task already exists; will update (id: ${existing.id})`;
    }
  }

  return ok({ warning, _normalized: normalized, _intentKey: intentKey });
}

function handleComplete(payload) {
  const v = validate(CompleteSchema, payload);
  if (!v.ok) return fail(v.error);
  return ok({ _normalized: v.data });
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
 * Execution is stubbed — filled in by subsequent PRs per action.
 *
 * @param {string} action - One of the ACTIONS constants
 * @param {object} payload - Raw payload from the transport layer
 * @param {{ tasks?: object[] }} context - Read-only task list for idempotency checks
 * @returns {Promise<object>} Result: { success, task_id, error, warning, ...queryVars? }
 */
export async function handleIntent(action, payload, context = {}) {
  const { tasks = [] } = context;

  switch (action) {
    case ACTIONS.CREATE:
      return handleCreate(payload, tasks);
    case ACTIONS.COMPLETE:
      return handleComplete(payload);
    case ACTIONS.OPEN:
      return handleOpen(payload);
    case ACTIONS.QUERY:
      return handleQuery(payload);
    default:
      return fail(`Unknown action: ${action}`);
  }
}
