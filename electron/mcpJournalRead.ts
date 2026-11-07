// dayglance_list_mcp_writes (#2321): the §4.3 session write journal, read back
// over MCP so an assistant can see what it, or another client, already
// changed this session. A READ tool: it never writes, and it rides the read
// consent tier (§6.3), so it answers in read-only mode too.
//
// The generic part (newest first, the id filter, pagination, a row built from
// named fields so the op can never reach it) is @glance-apps/mcp-host's
// journalPage, shared with other GLANCE hosts. What is dayGLANCE's is here:
// which entity ids each undo op names, under the wire names the read tools
// use, and the field-level `changes` an op's before-state allows, rendered as
// the read tools would show those values (storage keys mapped to wire fields,
// stamps in the wire form). A storage key not in a table below is never
// rendered, so a field added to an op later stays host-side until named here.
//
// WHY ONLY `before`: an op holds the before-state its undo needs, never the
// after. Deriving `after` from the live data would be wrong whenever anything
// edited the entity since (another write, the user, a sync), so a change says
// what the field held before that write, and the description says to read the
// entity for its value now.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { journalPage, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT, type JournalChange, type JournalDescription } from '@glance-apps/mcp-host';
import { wireStamp, CURSOR_PREFIX } from '@glance-apps/dayglance-mcp';
import type { JournalEntry, UndoOp } from './mcpJournal.js';

export interface JournalReadDeps {
  /** The session journal as it is now (main.ts's module-scope array), read per call. */
  entries: () => JournalEntry[];
  /** The IANA zone `at` and completed_at are reported in: the machine's, as for created_at. */
  timeZone: () => string;
}

type Render = (value: unknown) => unknown;
type FieldTable = ReadonlyArray<readonly [storageKey: string, wireField: string, render: Render]>;

// Each renderer gives the value the read surface would show for that field,
// absent included (an absent priority reads as 0, absent notes as none).
const text: Render = (v) => (typeof v === 'string' ? v : '');
const textOrNull: Render = (v) => (typeof v === 'string' && v ? v : null);
const idOrNull: Render = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const firstId: Render = (v) => (Array.isArray(v) && v.length ? String(v[0]) : null);
const idList: Render = (v) => (Array.isArray(v) && v.length ? v.map(String) : null);
const priority: Render = (v) => (typeof v === 'number' ? v : 0);
const bool: Render = (v) => !!v;

/** update_task's storage keys (applyUpdateTask's `touched`), as inboxItem and toBlock name them. */
const TASK_FIELDS: FieldTable = [
  ['title', 'title', text],
  ['notes', 'notes', textOrNull],
  ['priority', 'priority', priority],
  ['deadline', 'deadline', textOrNull],
  ['projectId', 'project_id', idOrNull],
  ['assignedUserSyncIds', 'assignee_id', firstId],
];

/** A subtask as the read tools list it: { id, title, completed }. */
const SUBTASK_FIELDS: FieldTable = [
  ['title', 'title', text],
  ['completed', 'completed', bool],
];

/** update_goal's storage keys, as goalItem names them. */
const GOAL_FIELDS: FieldTable = [
  ['title', 'title', text],
  ['description', 'description', text],
  ['startDate', 'start_date', textOrNull],
  ['targetDate', 'target_date', textOrNull],
  ['areaId', 'area_id', idOrNull],
  ['status', 'status', textOrNull],
  ['assignedUserSyncIds', 'assignee_ids', idList],
];

/** update_project's storage keys, as projectItem names them. */
const PROJECT_FIELDS: FieldTable = [
  ['title', 'title', text],
  ['description', 'description', text],
  ['goalId', 'goal_id', idOrNull],
  ['targetDate', 'target_date', textOrNull],
  ['status', 'status', textOrNull],
  ['assignedUserSyncIds', 'assignee_ids', idList],
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const has = (o: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** One change per table field the op touched: in `before`, or named in `absentBefore`. */
function fieldChanges(table: FieldTable, before: unknown, absentBefore: unknown): JournalChange[] {
  const prior = isRecord(before) ? before : {};
  const absent = new Set(Array.isArray(absentBefore) ? absentBefore : []);
  const changes: JournalChange[] = [];
  for (const [key, field, render] of table) {
    if (has(prior, key)) changes.push({ field, before: render(prior[key]) });
    else if (absent.has(key)) changes.push({ field, before: render(undefined) });
  }
  return changes;
}

/** A recurring occurrence's id, as the read tools and the write tools take it. */
const occurrenceId = (templateId: unknown, dateStr: unknown) => `recurring-${String(templateId)}-${String(dateStr)}`;

/**
 * The public description of one undo op: the ids it touched, under the read
 * tools' wire names, and the field-level changes its before-state allows.
 * Never throws: an unknown kind (or a malformed op) is described as nothing,
 * and journalPage still lists the entry by its tool and summary.
 */
export function describeUndoOp(op: UndoOp, timeZone: string): JournalDescription {
  if (!isRecord(op)) return {};
  switch (op.kind) {
    case 'remove_created':
      return { ids: { task_id: String(op.taskId) } };
    case 'restore_unscheduled': {
      // schedule_task: the task left the inbox for a date and time, and the
      // by-design strip dropped its priority and deadline when it had them
      // (the rule of scheduleDroppedFields in src/utils/mcpWriteModel.js:
      // priority 0 is "no priority", so nothing was dropped). Its duration
      // may or may not have changed, which the op cannot tell, so it is not
      // claimed.
      const task: Record<string, unknown> = isRecord(op.beforeTask) ? op.beforeTask : {};
      const changes: JournalChange[] = [
        { field: 'date', before: textOrNull(task.date) },
        { field: 'start_time', before: task.isAllDay ? null : textOrNull(task.startTime) },
      ];
      if (typeof task.priority === 'number' && task.priority > 0) changes.push({ field: 'priority', before: task.priority });
      if (task.deadline) changes.push({ field: 'deadline', before: textOrNull(task.deadline) });
      return { ids: { task_id: String(op.taskId) }, changes };
    }
    case 'restore_block_fields': {
      // move_block (date, start time, all-day) or resize_block (duration).
      const before: Record<string, unknown> = isRecord(op.before) ? op.before : {};
      const changes: JournalChange[] = [];
      if (has(before, 'date')) changes.push({ field: 'date', before: textOrNull(before.date) });
      if (has(before, 'startTime')) changes.push({ field: 'start_time', before: before.isAllDay ? null : textOrNull(before.startTime) });
      if (has(before, 'isAllDay')) changes.push({ field: 'all_day', before: !!before.isAllDay });
      if (has(before, 'duration')) changes.push({ field: 'duration_minutes', before: typeof before.duration === 'number' ? before.duration : null });
      return { ids: { task_id: String(op.blockId) }, changes };
    }
    case 'restore_completion': {
      const before: Record<string, unknown> = isRecord(op.before) ? op.before : {};
      return {
        ids: { task_id: String(op.taskId) },
        changes: [
          { field: 'completed', before: !!before.completed },
          { field: 'completed_at', before: before.completed ? wireStamp(before.completedAt, timeZone) : null },
        ],
      };
    }
    case 'restore_recurring_completion':
      return {
        ids: { task_id: occurrenceId(op.templateId, op.dateStr), series_id: String(op.templateId) },
        changes: [{ field: 'completed', before: !!op.wasCompleted }],
      };
    // A series edit's snapshot holds every series field, touched or not, and
    // the occurrence exceptions in storage form: nothing in it says which
    // field the edit changed, so it lists the series and its summary only.
    case 'remove_created_series':
    case 'restore_series_fields':
      return { ids: { series_id: String(op.templateId) } };
    case 'restore_task_fields':
      return { ids: { task_id: String(op.taskId) }, changes: fieldChanges(TASK_FIELDS, op.before, op.absentBefore) };
    case 'remove_created_subtask':
      return { ids: { task_id: String(op.taskId), subtask_id: String(op.subtaskId) } };
    case 'restore_subtask_fields':
      return {
        ids: { task_id: String(op.taskId), subtask_id: String(op.subtaskId) },
        changes: fieldChanges(SUBTASK_FIELDS, op.before, undefined),
      };
    case 'remove_created_goal':
      return { ids: { goal_id: String(op.goalId) } };
    case 'restore_goal_fields':
      return { ids: { goal_id: String(op.goalId) }, changes: fieldChanges(GOAL_FIELDS, op.before, op.absentBefore) };
    case 'remove_created_project':
      return { ids: { project_id: String(op.projectId) } };
    case 'restore_project_fields':
      return { ids: { project_id: String(op.projectId) }, changes: fieldChanges(PROJECT_FIELDS, op.before, op.absentBefore) };
    case 'restore_note_description': {
      // The description went into the linked note; the record half of the
      // same call, when it had one, rides along as `fields`.
      const idKey = op.entityKind === 'project' ? 'project_id' : 'goal_id';
      const inner = op.fields ? describeUndoOp(op.fields, timeZone).changes ?? [] : [];
      return {
        ids: { [idKey]: String(op.entityId) },
        changes: [{ field: 'description', before: text(op.before) }, ...inner.filter((c) => c.field !== 'description')],
      };
    }
    default:
      return {};
  }
}

const ok = (data: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data) }],
  structuredContent: data,
});
const toolError = (code: string, message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: JSON.stringify({ error: { code, message } }) }],
});

const ID_ARG = (what: string) => z.string().optional().describe(`Only writes that touched this ${what}.`);

/**
 * Registered beside the read tools, under the same consent tier (mcpServer.ts
 * registers it only with them), and NOT behind the writes opt-in: it changes
 * nothing, and a client in read-only mode may still need to see what an
 * earlier session of writes did.
 */
export function registerJournalReadTool(server: McpServer, deps: JournalReadDeps): void {
  server.registerTool(
    'dayglance_list_mcp_writes',
    {
      description:
        'The changes MCP clients made to dayGLANCE through this server since dayGLANCE last started, newest first: ' +
        'what you or another assistant already changed this session. It lists ONLY writes made over MCP. Edits ' +
        'made in the dayGLANCE app, on other devices or by sync, and anything before the last restart, are NOT ' +
        'here, and a write the user has undone in dayGLANCE leaves the list: this is not a task\'s full history. ' +
        'Each item carries at (local date and time), tool, summary, the ids it touched (task_id, subtask_id, ' +
        'series_id, goal_id, project_id), and, where dayGLANCE kept them, changes: [{ field, before }], the value ' +
        'each field held just before that write. There is no "after": read the entity for its value now, which ' +
        'later edits may have changed. A create carries no changes. Filter with task_id, subtask_id, series_id, ' +
        'goal_id or project_id; every filter given must match, and an id is the one the write used (a task the ' +
        'Obsidian integration re-keyed since is listed under its old id). A repeating task\'s writes carry ' +
        'series_id; filter by it for the whole series. Paginated, default page ' +
        `${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}; when truncated is true, pass next_cursor back as cursor ` +
        'with the same filters. total counts the filtered list.',
      inputSchema: z.object({
        task_id: ID_ARG('task (a recurring occurrence id lists that date\'s completions)'),
        subtask_id: ID_ARG('subtask'),
        series_id: ID_ARG('repeating series'),
        goal_id: ID_ARG('goal'),
        project_id: ID_ARG('project (the project itself, not its tasks)'),
        limit: z.number().int().optional().describe(`Page size, 1-${MAX_LIST_LIMIT}. Default ${DEFAULT_LIST_LIMIT}.`),
        cursor: z.string().optional().describe('Opaque cursor from a previous response\'s next_cursor.'),
      }),
    },
    async ({ task_id, subtask_id, series_id, goal_id, project_id, limit, cursor }) => {
      const timeZone = deps.timeZone();
      const page = journalPage(deps.entries(), {
        describe: (op) => describeUndoOp(op, timeZone),
        formatAt: (at) => wireStamp(at, timeZone),
        match: { task_id, subtask_id, series_id, goal_id, project_id },
        limit,
        cursor,
        cursorPrefix: CURSOR_PREFIX,
      });
      if (!page.ok) return toolError('validation', page.reason);
      return ok({
        items: page.items,
        total: page.total,
        truncated: page.truncated,
        next_cursor: page.nextCursor,
        timezone: timeZone,
      });
    },
  );
}
