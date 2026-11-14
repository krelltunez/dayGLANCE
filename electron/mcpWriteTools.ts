// The Phase 3 write tools (spec §5.1) plus update_task, registered onto a per-request
// McpServer instance by the mcpServer.ts factory. §3.7 discipline as in the
// read tools (@glance-apps/dayglance-mcp): this module holds no state — the
// write gate, replay store, consent tier, and renderer bridge all arrive as
// deps owned by main.ts.
//
// PER-WRITE PIPELINE, in order:
//   1. consent tier (read-write, §6.3) — off means a read_only_mode error
//   2. idempotency replay — a known (token, tool, key) returns the FIRST
//      attempt's stored result; no gate charge, no renderer call. This store
//      is NEW MACHINERY, named as such (spec §5.2 r5): nothing reusable
//      exists for mutation-level replay protection on move/resize/completion.
//      What IS reused: the key travels into the mutation as its GLANCEintents
//      transitionId (delivery dedup at the outbox — the part of the old §5.2
//      claim that was true), and create_task derives its task id from the key
//      per the handleIntent.js deterministic-id precedent, so a create replay
//      no-ops renderer-side even if this store has been reset.
//   3. write gate (§4.3) — 30/min sliding window keyed on the token; repeated
//      violations auto-disable writes and fire the notification once.
//   4. validation (§5.3) — local calendar date, wall-clock time incl. DST
//      gap/repeat rejection, duration bounds. All before any mutation.
//   5. renderer mutation through the shared pure module (§3.1 r5), returning
//      the resulting entity state (§5.2).

import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/server';
import {
  isValidLocalDate,
  localDateOf,
  dateEnvelope,
  validateStartTime,
  isValidIdempotencyKey,
  makeStoreKey,
  type HostBridge,
  type WriteGate,
  type IdempotencyStore,
} from '@glance-apps/mcp-host';
import { validateDurationMinutes } from './mcpLocalTime.js';
import { deterministicTaskIdFromSeed } from './mcpIdempotency.js';
import { planCreateTask } from './mcpCreateArgs.js';
import { planUpdateTask } from './mcpUpdateArgs.js';
import { planUpdateRecurringTask } from './mcpRecurringArgs.js';
import {
  planCreateGoal, planUpdateGoal, planCreateProject, planUpdateProject, planAddSubtask, planUpdateSubtask,
  GOAL_CLEARABLE, PROJECT_CLEARABLE,
} from './mcpGoalArgs.js';
import type { JournalRecord } from './mcpJournal.js';

/** Renderer-captured undo descriptor, diverted to the §4.3 journal. */
interface UndoDescriptor {
  summary: string;
  op: JournalRecord['op'];
}
interface UndoCapture {
  undo?: UndoDescriptor;
}
function isUndoDescriptor(v: unknown): v is UndoDescriptor {
  return typeof v === 'object' && v !== null
    && typeof (v as UndoDescriptor).summary === 'string'
    && typeof (v as UndoDescriptor).op === 'object' && (v as UndoDescriptor).op !== null;
}

export interface WriteToolDeps {
  bridge: HostBridge;
  gate: WriteGate;
  store: IdempotencyStore<StoredResult>;
  /** The bearer token — the gate/replay key (no sessions, §3.7). */
  token: () => string;
  /** Read-write consent tier (§6.3). Env-sourced in Phase 3; Phase 5 swaps the source. */
  includeWrites: () => boolean;
  /** Marks an MCP write for the §3.6 tray reload policy (trayReloadPolicy.ts). */
  noteMcpWrite: () => void;
  /** Fired exactly once when repeated violations auto-disable writes (§4.3). */
  onWritesDisabled: () => void;
  /**
   * Multi-user mode, pushed from the renderer (a per-device toggle that lives
   * in renderer state, unlike the main-owned consent tiers). Gates the
   * assignee_id argument's EXISTENCE in the create_task schema — evaluated at
   * registration time, which is per request (§3.7 factory), so toggling
   * multi-user updates the schema on the very next request.
   */
  multiUserEnabled: () => boolean;
  /**
   * §4.3 write journal (Phase 5b): called once per successful non-replayed
   * write with tool, summary, idempotency key, and the reversal op. Optional
   * so the listener still runs journal-less (tests, skeleton mode).
   */
  journal?: (record: JournalRecord) => void;
  now: () => number;
  timeZone: () => string;
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
type StoredResult = Record<string, unknown>;

const ok = (data: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});
const toolError = (code: string, message: string): ToolResult => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }],
});

const CANNOT_MODIFY_NATIVE =
  ' Cannot target device calendar events (type "device_calendar_event"): dayGLANCE has read-only ' +
  'access to the device calendar, and such calls return a device_calendar_readonly error.';

// Why an id can change under a client, and that the old one keeps working:
// the Obsidian placement pass re-keys a project task whose project has a
// linked note, seconds after create_task returned. The renderer resolves the
// old id through the id-retirement record (src/utils/mcpWriteModel.js).
const ID_MAY_CHANGE =
  ' If the Obsidian integration claims the task (a project task whose project has a linked note), its id ' +
  'changes to obsidian-dg-... shortly after creation. The returned id keeps working on every tool that ' +
  'takes a task id; responses then carry the current id and resolved_from naming the one you passed.';

// The editing side of ID_MAY_CHANGE: a client holding the id create_task
// returned should know it still works here after the re-key.
const OLD_ID_STILL_WORKS =
  ' A task id returned by dayglance_create_task keeps working after the Obsidian integration re-keys the ' +
  'task to obsidian-dg-...: the edit lands on the current task, and the response carries its current id ' +
  'plus resolved_from naming the id you passed.';

// Stated in the description for the same reason as CANNOT_MODIFY_NATIVE: the
// model should know the rule before it spends a call discovering it. The
// "will not shift it for you" half matters most: the app's own drag-and-drop
// slides past a routine, so a model reasoning from how dayGLANCE behaves in
// the UI would otherwise expect an adjustment rather than a refusal.
const ROUTINE_TIME_IS_OCCUPIED =
  ' Time covered by a routine block (type "routine") is occupied and cannot be scheduled over: such ' +
  'calls return a routine_conflict error naming the routine and its span. dayGLANCE will NOT silently ' +
  'shift your task to the next free time, so pick a time that does not overlap. Use dayglance_get_day ' +
  'or dayglance_get_today first to see which parts of the day routines already hold.';

/** "YYYY-MM-DD HH:MM", both halves validated separately for precise §5.3 errors. */
function parseStart(start: unknown, timeZone: string): { date: string; time: string } | { invalid: string } {
  if (typeof start !== 'string' || !/^\S+ \S+$/.test(start)) {
    return { invalid: `start must be "YYYY-MM-DD HH:MM" (local calendar date + local wall-clock time), got ${JSON.stringify(start)}` };
  }
  const [date, time] = start.split(' ') as [string, string];
  if (!isValidLocalDate(date)) {
    return { invalid: `start date must be a real local calendar date in strict YYYY-MM-DD form, got ${JSON.stringify(date)}` };
  }
  const timeError = validateStartTime(date, time, timeZone);
  if (timeError) return { invalid: timeError };
  return { date, time };
}

export function registerWriteTools(server: McpServer, deps: WriteToolDeps): void {
  /**
   * The shared pipeline. `mutate` runs only after consent, replay, gate, and
   * validation all pass; its transitionId is the caller's idempotency key
   * when given (the §5.2 emit-path reuse), else a fresh UUID.
   */
  const write = async (
    tool: string,
    idempotencyKey: unknown,
    mutate: (transitionId: string, capture: UndoCapture) => Promise<ToolResult>,
  ): Promise<ToolResult> => {
    if (!deps.includeWrites()) {
      return toolError(
        'read_only_mode',
        'dayGLANCE MCP is in read-only mode; writes are a separate opt-in the user has not enabled.',
      );
    }

    let storeKey: string | null = null;
    if (idempotencyKey !== undefined) {
      if (!isValidIdempotencyKey(idempotencyKey)) {
        return toolError('validation', 'idempotency_key must be 1-128 chars of [A-Za-z0-9_.:-]');
      }
      storeKey = makeStoreKey(deps.token(), tool, idempotencyKey);
      const replay = deps.store.get(storeKey);
      if (replay) return ok({ ...replay, replayed: true });
    }

    const admission = deps.gate.tryWrite(deps.token());
    if (!admission.allowed) {
      if (admission.disabledNow) deps.onWritesDisabled();
      return admission.reason === 'writes_disabled'
        ? toolError(
            'writes_disabled',
            'MCP writes have been automatically disabled after repeated rate-limit violations. The user must re-enable them by restarting dayGLANCE.',
          )
        : toolError(
            'rate_limited',
            'MCP write rate limit reached (30 writes/minute). Wait for the window to slide before retrying; repeated violations disable writes entirely.',
          );
    }

    const transitionId = typeof idempotencyKey === 'string' ? idempotencyKey : randomUUID();
    const capture: UndoCapture = {};
    const result = await mutate(transitionId, capture);
    if (!result.isError) {
      deps.noteMcpWrite();
      // §4.3 write journal: record tool, time, what changed, and the reversal
      // descriptor the renderer captured from the before-state. Replayed
      // writes carry no descriptor — nothing changed, nothing to journal.
      if (capture.undo && deps.journal) {
        deps.journal({
          tool: `dayglance_${tool}`,
          ...(typeof idempotencyKey === 'string' ? { idempotencyKey } : {}),
          summary: capture.undo.summary,
          op: capture.undo.op,
        });
      }
      if (storeKey && result.structuredContent) deps.store.put(storeKey, result.structuredContent);
    }
    return result;
  };

  /**
   * Map a renderer response onto the tool result, preserving §5.2 error codes.
   * The renderer's `undo` descriptor is diverted into the capture for the
   * journal — it is main-process metadata and must never reach tool output.
   */
  const fromRenderer = (
    r: Awaited<ReturnType<HostBridge['request']>>,
    envelope: Record<string, unknown>,
    capture?: UndoCapture,
  ): ToolResult => {
    if (!r.ok) return toolError(r.error.code, r.error.message);
    if (capture && isUndoDescriptor(r.undo)) capture.undo = r.undo;
    return ok({ ...(r.data as Record<string, unknown>), ...envelope });
  };

  const IDEMPOTENCY_ARG = z.string().optional()
    .describe('Optional retry token, 1-128 chars of [A-Za-z0-9_.:-]. Replaying the same key returns the first result without repeating the write.');

  // assignee_id EXISTS in the schema only while multi-user mode is on —
  // evaluated here, at registration time, which is per request (the §3.7
  // per-request factory), so toggling multi-user in Settings changes the
  // schema a connected client sees on its next request. Same idea as the
  // calendar tier gating _native inclusion, applied at the schema level.
  const multiUser = deps.multiUserEnabled();
  const createTaskSchema = z.object({
    title: z.string().describe('Task title. Required, non-empty.'),
    notes: z.string().optional(),
    project_id: z.string().optional().describe(
      'Attach to a project (see dayglance_get_goal_progress). An unscheduled project task may carry priority and deadline like any inbox task. ' +
      'The task takes the project\'s colour and assignees, and its New task defaults where this call leaves them out: duration, notes, #tags appended to the title, a checklist, an energy (effort or restore). ' +
      'A completed or archived project takes no new tasks: reopen a completed one first (dayglance_update_project, status "active").'),
    ...(multiUser ? {
      assignee_id: z.string().optional().describe(
        'Assign to one household member by their user id. Ids come from dayglance_list_users. Never guess from a name.'),
    } : {}),
    priority: z.number().int().optional().describe(
      'Unscheduled tasks only (inbox or project): 0 none (default), 1 low, 2 medium, 3 high. Scheduled tasks do not carry priority by design.'),
    deadline: z.string().optional().describe(
      'Unscheduled tasks only (inbox or project): local calendar date, strict YYYY-MM-DD. Scheduled tasks do not carry a deadline by design.'),
    start: z.string().optional().describe(
      'Presence makes this a SCHEDULED create, placed directly on the calendar in one call. ' +
      'Timed: local "YYYY-MM-DD HH:MM" (DST gap/repeat times rejected). With all_day: a bare "YYYY-MM-DD".'),
    duration_minutes: z.number().int().optional().describe(
      '1-1440. Defaults to the project\'s New task default (with project_id), else the user\'s default task duration ' +
      '(set in dayGLANCE, 30 unless changed). Pass it only when the user names a length. ' +
      'Contradicts all_day: an all-day task has no meaningful duration.'),
    all_day: z.boolean().optional().describe(
      'With start: create an all-day task. start must then be a bare YYYY-MM-DD date.'),
    // Permissive on purpose (CLAUDE.md, MCP transport suite): parseRepeat
    // answers an `interval` or an unsupported frequency with the by-design
    // message, which a strict schema would replace with the SDK's own text.
    repeat: z.unknown().optional().describe(
      'With start: make this a repeating task. An object: {"frequency": "daily" | "weekly" | "biweekly" | ' +
      '"monthly" | "yearly", "days_of_week": ["mon","wed"] (weekly/biweekly; default start\'s weekday), ' +
      '"day_of_month": 1-31 (monthly, clamped in shorter months; default start\'s day), ' +
      '"nth_weekday": {"week": 1-5, "day": "tue"} (monthly instead of day_of_month; no "last"), ' +
      '"until": "YYYY-MM-DD" (inclusive), "count": total occurrences}. Yearly repeats on start\'s month and day. ' +
      'There is no interval: biweekly is the only "every N". The series starts on start\'s date.'),
    idempotency_key: IDEMPOTENCY_ARG,
  });

  server.registerTool(
    'dayglance_create_task',
    {
      description:
        'Create a new dayGLANCE task. Without start: an unscheduled task, in the inbox or in a project via ' +
        'project_id (either may carry priority and deadline). With start: a scheduled task placed directly onto ' +
        'the calendar in one call, with no separate scheduling step. With start and repeat: a repeating series, ' +
        'returned as the series, its first occurrence and its next dates. Returns the created task or block.' +
        ID_MAY_CHANGE + ROUTINE_TIME_IS_OCCUPIED,
      inputSchema: createTaskSchema,
    },
    async (args: Record<string, unknown>) => {
      const idempotency_key = args['idempotency_key'];
      return write('create_task', idempotency_key, async (transitionId, capture) => {
        const planned = planCreateTask(args, deps.timeZone());
        if (!planned.ok) return toolError(planned.code, planned.message);
        // Deterministic id from the key (handleIntent precedent): a replayed
        // create converges on the same id and no-ops renderer-side.
        const taskId = idempotency_key !== undefined
          ? deterministicTaskIdFromSeed(makeStoreKey(deps.token(), 'create_task', idempotency_key as string))
          : randomUUID();
        const r = await deps.bridge.request('create_task', { taskId, ...planned.plan, transitionId });
        const envelope = planned.plan.schedule
          ? dateEnvelope(planned.plan.schedule.date, deps.timeZone()) as unknown as Record<string, unknown>
          : { timezone: deps.timeZone() };
        return fromRenderer(r, envelope, capture);
      });
    },
  );

  const updateTaskSchema = z.object({
    task_id: z.string().describe('The task to edit. Recurring occurrences (recurring-...) are edited with dayglance_update_recurring_task.'),
    title: z.string().optional().describe('New title. Required on every task, so it can be set but never cleared.'),
    notes: z.string().optional().describe('New notes text. To remove notes entirely, name "notes" in clear_fields instead.'),
    priority: z.number().int().optional().describe(
      'Unscheduled tasks only (inbox or project): 0 none, 1 low, 2 medium, 3 high. Scheduled tasks do not carry priority by design.'),
    deadline: z.string().optional().describe(
      'Unscheduled tasks only (inbox or project): local calendar date, strict YYYY-MM-DD. Scheduled tasks do not carry a deadline by design.'),
    ...(multiUser ? {
      assignee_id: z.string().optional().describe(
        'Reassign to one household member by their user id. Ids come from dayglance_list_users. Never guess from a name.'),
    } : {}),
    project_id: z.string().optional().describe(
      'Move the task into a project by its id (see dayglance_get_goal_progress). To detach it from its project, name "project" in clear_fields. ' +
      'A completed or archived project takes no new tasks.'),
    clear_fields: z.array(z.string()).optional().describe(
      'Field names to REMOVE from the task. Accepts only fields that can meaningfully be empty: ' +
      `"notes", "deadline", "project"${multiUser ? ', "assignee"' : ''}. ` +
      'Naming a required field like title, or any other field, is a validation error.'),
    idempotency_key: IDEMPOTENCY_ARG,
  });

  server.registerTool(
    'dayglance_update_task',
    {
      description:
        'Edit fields of an existing dayGLANCE task: inbox, project, or scheduled. An absent argument leaves that field ' +
        'alone. A present argument sets it. A field named in clear_fields is removed. Fields are never cleared ' +
        'by passing null or empty values; clearing is only ever the explicit clear_fields list. ' +
        'project_id moves the task into a project ("project" in clear_fields detaches it); date, time, duration, and ' +
        'completion have their own tools (schedule_task, move_block, resize_block, set_task_completion), and subtasks ' +
        'have dayglance_add_subtask and dayglance_update_subtask. Returns the resulting task or block.' +
        OLD_ID_STILL_WORKS + CANNOT_MODIFY_NATIVE,
      inputSchema: updateTaskSchema,
    },
    async (args: Record<string, unknown>) => {
      const idempotency_key = args['idempotency_key'];
      return write('update_task', idempotency_key, async (transitionId, capture) => {
        const planned = planUpdateTask(args, multiUser);
        if (!planned.ok) return toolError(planned.code, planned.message);
        const r = await deps.bridge.request('update_task', { ...planned.plan, transitionId });
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      });
    },
  );

  const updateRecurringSchema = z.object({
    task_id: z.string().describe(
      'A recurring occurrence id, recurring-<series>-<YYYY-MM-DD>, as dayglance_get_day and dayglance_create_task return it.'),
    // A string rather than an enum so a wrong value reaches the by-design
    // message in mcpRecurringArgs.ts instead of the SDK's generic one.
    scope: z.string().describe(
      'Required. "occurrence": the change applies to this date only. "series": it applies to every occurrence, ' +
      'and the same field is cleared from any occurrence edited on its own. Ask the user if unsure, as the app does.'),
    title: z.string().optional().describe('New title. Can be set, never cleared.'),
    start_time: z.string().optional().describe('Local "HH:MM". Makes an all-day occurrence timed.'),
    duration_minutes: z.number().int().optional().describe('1-1440.'),
    all_day: z.boolean().optional().describe('true makes it all-day; false (with start_time) makes it timed.'),
    notes: z.string().optional().describe('Series only: one set of notes for every occurrence.'),
    project_id: z.string().optional().describe('Series only: move the series into a project. A completed or archived project takes none.'),
    repeat: z.unknown().optional().describe(
      'Series only: replace the whole pattern, its end included, in the dayglance_create_task repeat shape. ' +
      'The series start never moves earlier.'),
    ...(multiUser ? {
      assignee_id: z.string().optional().describe(
        'Reassign by user id from dayglance_list_users. Never guess from a name.'),
    } : {}),
    clear_fields: z.array(z.string()).optional().describe(
      `Field names to REMOVE: "notes", "project" (series only)${multiUser ? ', "assignee"' : ''}.`),
    idempotency_key: IDEMPOTENCY_ARG,
  });

  server.registerTool(
    'dayglance_update_recurring_task',
    {
      description:
        'Edit a repeating dayGLANCE task, for one occurrence or the whole series. Title, time, duration, all-day ' +
        'and assignee can change for either scope; notes, project and the repeat pattern belong to the series. ' +
        'Completing an occurrence is dayglance_set_task_completion. Returns the series, the edited occurrence ' +
        'and the next dates.' + ROUTINE_TIME_IS_OCCUPIED,
      inputSchema: updateRecurringSchema,
    },
    async (args: Record<string, unknown>) => {
      const idempotency_key = args['idempotency_key'];
      return write('update_recurring_task', idempotency_key, async (transitionId, capture) => {
        const planned = planUpdateRecurringTask(args, multiUser, deps.timeZone());
        if (!planned.ok) return toolError(planned.code, planned.message);
        const r = await deps.bridge.request('update_recurring_task', { ...planned.plan, transitionId });
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      });
    },
  );

  server.registerTool(
    'dayglance_schedule_task',
    {
      description:
        'Schedule an unscheduled dayGLANCE inbox task onto a day and time. start is local: ' +
        '"YYYY-MM-DD HH:MM", no UTC, no offsets. Returns the resulting block. If the inbox task ' +
        'carried a priority or deadline, scheduling drops them BY DESIGN and the response lists ' +
        'them in dropped_fields. Tell the user rather than treating it as an error.' + CANNOT_MODIFY_NATIVE + ROUTINE_TIME_IS_OCCUPIED,
      inputSchema: z.object({
        task_id: z.string(),
        start: z.string().describe('Local "YYYY-MM-DD HH:MM". Times inside a DST gap or repeat are rejected.'),
        duration_minutes: z.number().int().optional().describe('1-1440. Defaults to the task\'s own duration, then the user\'s default task duration.'),
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async ({ task_id, start, duration_minutes, idempotency_key }) =>
      write('schedule_task', idempotency_key, async (transitionId, capture) => {
        const parsed = parseStart(start, deps.timeZone());
        if ('invalid' in parsed) return toolError('validation', parsed.invalid);
        if (duration_minutes !== undefined) {
          const durationError = validateDurationMinutes(duration_minutes);
          if (durationError) return toolError('validation', durationError);
        }
        const r = await deps.bridge.request('schedule_task', {
          taskId: task_id, date: parsed.date, startTime: parsed.time, durationMinutes: duration_minutes, transitionId,
        });
        return fromRenderer(r, dateEnvelope(parsed.date, deps.timeZone()) as unknown as Record<string, unknown>, capture);
      }),
  );

  server.registerTool(
    'dayglance_move_block',
    {
      description:
        'Move a scheduled dayGLANCE block to a new local start: new_start is "YYYY-MM-DD HH:MM" ' +
        '(same or different day). Returns the resulting block.' + CANNOT_MODIFY_NATIVE + ROUTINE_TIME_IS_OCCUPIED,
      inputSchema: z.object({
        block_id: z.string(),
        new_start: z.string().describe('Local "YYYY-MM-DD HH:MM". Times inside a DST gap or repeat are rejected.'),
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async ({ block_id, new_start, idempotency_key }) =>
      write('move_block', idempotency_key, async (transitionId, capture) => {
        const parsed = parseStart(new_start, deps.timeZone());
        if ('invalid' in parsed) return toolError('validation', parsed.invalid);
        const r = await deps.bridge.request('move_block', {
          blockId: block_id, date: parsed.date, startTime: parsed.time, transitionId,
        });
        return fromRenderer(r, dateEnvelope(parsed.date, deps.timeZone()) as unknown as Record<string, unknown>, capture);
      }),
  );

  server.registerTool(
    'dayglance_resize_block',
    {
      description:
        'Change the duration of a scheduled dayGLANCE block without moving its start. ' +
        'Returns the resulting block.' + CANNOT_MODIFY_NATIVE + ROUTINE_TIME_IS_OCCUPIED,
      inputSchema: z.object({
        block_id: z.string(),
        duration_minutes: z.number().int().describe('New duration, 1-1440 minutes.'),
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async ({ block_id, duration_minutes, idempotency_key }) =>
      write('resize_block', idempotency_key, async (transitionId, capture) => {
        const durationError = validateDurationMinutes(duration_minutes);
        if (durationError) return toolError('validation', durationError);
        const r = await deps.bridge.request('resize_block', {
          blockId: block_id, durationMinutes: duration_minutes, transitionId,
        });
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      }),
  );

  server.registerTool(
    'dayglance_set_task_completion',
    {
      description:
        'Set a dayGLANCE task\'s completion state (a setter, not a toggle: safe to retry, and ' +
        'setting completed:false is the agent\'s own undo). Works for scheduled blocks, inbox ' +
        'tasks, and recurring-task instances. A task with "link" came from another GLANCE app (link.app, e.g. ' +
        '"lastglance"; link.id is the chore or person there): completing or reopening it is reported back to that app, ' +
        'so a lastGLANCE chore\'s task completed here is the chore done there; do not complete it in both.' + CANNOT_MODIFY_NATIVE,
      inputSchema: z.object({
        task_id: z.string(),
        completed: z.boolean(),
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async ({ task_id, completed, idempotency_key }) =>
      write('set_task_completion', idempotency_key, async (transitionId, capture) => {
        const r = await deps.bridge.request('set_completion', {
          taskId: task_id, completed, transitionId,
          todayStr: localDateOf(deps.now(), deps.timeZone()),
        });
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      }),
  );

  // ── Subtasks (2026-10-04) ───────────────────────────────────────────────────
  // The two shapes the UI has: add, and edit title or completion. There is no
  // delete: the agent's own additions reverse through the write journal.

  server.registerTool(
    'dayglance_add_subtask',
    {
      description:
        'Add a subtask to an existing dayGLANCE task (inbox, project, or scheduled). Subtasks are the task\'s own ' +
        'checklist, reported as "subtasks" on tasks and blocks. Returns the resulting task or block and the new ' +
        'subtask. Subtasks cannot be deleted over MCP; undo in dayGLANCE removes ones an assistant added.' +
        OLD_ID_STILL_WORKS + CANNOT_MODIFY_NATIVE,
      inputSchema: z.object({
        task_id: z.string().describe('The host task. Recurring-instance ids (recurring-...) are not editable.'),
        title: z.string().describe('Subtask title. Required, non-empty.'),
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async (args: Record<string, unknown>) => {
      const idempotency_key = args['idempotency_key'];
      return write('add_subtask', idempotency_key, async (transitionId, capture) => {
        const planned = planAddSubtask(args);
        if (!planned.ok) return toolError(planned.code, planned.message);
        const subtaskId = idempotency_key !== undefined
          ? deterministicTaskIdFromSeed(makeStoreKey(deps.token(), 'add_subtask', idempotency_key as string))
          : randomUUID();
        const r = await deps.bridge.request('add_subtask', { ...planned.plan, subtaskId, transitionId });
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      });
    },
  );

  server.registerTool(
    'dayglance_update_subtask',
    {
      description:
        'Edit a subtask of a dayGLANCE task: its title, its completion (a setter, not a toggle, so a retry is safe), ' +
        'or both. An absent argument leaves that field alone. Returns the resulting task or block and the subtask.' +
        OLD_ID_STILL_WORKS + CANNOT_MODIFY_NATIVE,
      inputSchema: z.object({
        task_id: z.string(),
        subtask_id: z.string().describe('From the task\'s "subtasks" list.'),
        title: z.string().optional().describe('New title. Required on every subtask, so it can be set but never cleared.'),
        completed: z.boolean().optional(),
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async (args: Record<string, unknown>) => {
      const idempotency_key = args['idempotency_key'];
      return write('update_subtask', idempotency_key, async (transitionId, capture) => {
        const planned = planUpdateSubtask(args);
        if (!planned.ok) return toolError(planned.code, planned.message);
        const r = await deps.bridge.request('update_subtask', { ...planned.plan, transitionId });
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      });
    },
  );

  // ── Goals and projects (2026-10-04) ─────────────────────────────────────────
  // Everything the read surface shows can be written, with two deliberate
  // holes: no deletes and no archiving (both stay the user's own step in
  // dayGLANCE), and no description on an entity whose description lives in a
  // linked Obsidian note. Completion mirrors the forms: a goal completes only
  // when every active child project is completed, a project only when every
  // one of its tasks is.

  // A string, not an enum: the SDK validates the schema BEFORE the handler
  // runs and answers a bad enum value with its own generic text, so an enum
  // here would mean a client asking for "archived" never sees the by-design
  // message the planner carries (mcpGoalArgs.ts optionalStatus). The planner
  // still rejects every value but the two.
  const STATUS_ARG = '"active" or "completed". Archiving is not available over MCP by design and is refused with a validation error naming that.';
  // A project can also be put on hold: paused, still listed and intact, but no
  // longer asking for attention (no stalled flag, target-date warnings or
  // hyperGLANCE sessions). Goals have no such status.
  const PROJECT_STATUS_ARG = '"active", "on-hold" (paused: still listed and intact, but not flagged stalled, not warned about its target date, no hyperGLANCE sessions) or "completed". Archiving is not available over MCP by design and is refused with a validation error naming that.';
  const NO_ARCHIVE =
    ' Status may be "active" or "completed"; archiving is not available over MCP by design and returns a ' +
    'validation error, as deleting does not exist.';
  const PROJECT_NO_ARCHIVE =
    ' Status may be "active", "on-hold" or "completed"; archiving is not available over MCP by design and returns a ' +
    'validation error, as deleting does not exist.';
  // A linked entity's description is the opening section of its Obsidian
  // note (companion spec §4.3). The write goes through the app's own section
  // save, which re-reads the note and refuses when it changed since the text
  // was read; the main process waits longer for it than for a state write.
  const LINKED_DESCRIPTION =
    'For an entity with obsidian_note, description is the opening section of that note: the write goes into the ' +
    'note itself (the rest of the note is never touched) and the response says note_write "written" or "queued" ' +
    '(queued: the bridge plugin applies it when Obsidian is open). Pass description_base from the last read to be ' +
    'refused with note_changed if the note moved since, rather than overwriting an edit made in Obsidian. ';
  const DESCRIPTION_ARG = 'The notes box; on an entity with obsidian_note, the opening section of that note.';
  const DESCRIPTION_BASE_ARG = 'The description_base a read returned. With it, the write is refused (note_changed) if the note changed since; without it the write is unconditional.';
  const NOTE_WRITE_TIMEOUT_MS = 8000;
  const assigneeIdsArg = multiUser ? {
    assignee_ids: z.array(z.string()).optional().describe(
      'Assign to household members by user id (ids from dayglance_list_users). Replaces the whole list. Never guess from a name.'),
  } : {};

  server.registerTool(
    'dayglance_create_goal',
    {
      description:
        'Create a dayGLANCE goal. Returns the goal as dayglance_get_goal_progress reports it. A new goal is active; ' +
        'its colour comes from its area when one is given.' + NO_ARCHIVE,
      inputSchema: z.object({
        title: z.string().describe('Goal title. Required, non-empty.'),
        description: z.string().optional().describe('The notes box of the goal.'),
        start_date: z.string().optional().describe('Local calendar date, strict YYYY-MM-DD.'),
        target_date: z.string().optional().describe('Local calendar date, strict YYYY-MM-DD. Must not precede start_date.'),
        area_id: z.string().optional().describe('An area id from dayglance_list_areas.'),
        ...assigneeIdsArg,
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async (args: Record<string, unknown>) => {
      const idempotency_key = args['idempotency_key'];
      return write('create_goal', idempotency_key, async (transitionId, capture) => {
        const planned = planCreateGoal(args, multiUser);
        if (!planned.ok) return toolError(planned.code, planned.message);
        const goalId = idempotency_key !== undefined
          ? deterministicTaskIdFromSeed(makeStoreKey(deps.token(), 'create_goal', idempotency_key as string))
          : randomUUID();
        const r = await deps.bridge.request('create_goal', { goalId, ...planned.plan, transitionId });
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      });
    },
  );

  server.registerTool(
    'dayglance_update_goal',
    {
      description:
        'Edit a dayGLANCE goal. Absent leaves a field alone, present sets it, a name in clear_fields removes it. ' +
        'Completing a goal is allowed only once every active child project is completed (the app\'s own rule). ' +
        LINKED_DESCRIPTION + 'Returns the resulting goal.' + NO_ARCHIVE,
      inputSchema: z.object({
        goal_id: z.string(),
        title: z.string().optional().describe('New title. Can be set, never cleared.'),
        description: z.string().optional().describe(DESCRIPTION_ARG),
        description_base: z.string().optional().describe(DESCRIPTION_BASE_ARG),
        start_date: z.string().optional().describe('Local calendar date, strict YYYY-MM-DD.'),
        target_date: z.string().optional().describe('Local calendar date, strict YYYY-MM-DD.'),
        area_id: z.string().optional().describe('An area id from dayglance_list_areas.'),
        status: z.string().optional().describe(STATUS_ARG),
        ...assigneeIdsArg,
        clear_fields: z.array(z.string()).optional().describe(
          `Field names to REMOVE: ${GOAL_CLEARABLE.filter((f) => multiUser || f !== 'assignees').map((f) => `"${f}"`).join(', ')}.`),
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async (args: Record<string, unknown>) => {
      const idempotency_key = args['idempotency_key'];
      return write('update_goal', idempotency_key, async (transitionId, capture) => {
        const planned = planUpdateGoal(args, multiUser);
        if (!planned.ok) return toolError(planned.code, planned.message);
        const r = await deps.bridge.request('update_goal', { ...planned.plan, transitionId }, NOTE_WRITE_TIMEOUT_MS);
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      });
    },
  );

  server.registerTool(
    'dayglance_create_project',
    {
      description:
        'Create a dayGLANCE project, standalone or under a goal (goal_id). A project under a goal takes the goal\'s ' +
        'colour and assignees at creation, and the New task defaults the goal (else its area) holds for new projects. ' +
        'Returns the project as dayglance_get_goal_progress reports it.' + NO_ARCHIVE,
      inputSchema: z.object({
        title: z.string().describe('Project title. Required, non-empty.'),
        goal_id: z.string().optional().describe('The parent goal. Omit for a standalone project.'),
        description: z.string().optional().describe('The notes box of the project.'),
        target_date: z.string().optional().describe('Local calendar date, strict YYYY-MM-DD — the project\'s own due date (a target date, like a goal\'s). Independent of its tasks\' deadlines.'),
        ...assigneeIdsArg,
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async (args: Record<string, unknown>) => {
      const idempotency_key = args['idempotency_key'];
      return write('create_project', idempotency_key, async (transitionId, capture) => {
        const planned = planCreateProject(args, multiUser);
        if (!planned.ok) return toolError(planned.code, planned.message);
        const projectId = idempotency_key !== undefined
          ? deterministicTaskIdFromSeed(makeStoreKey(deps.token(), 'create_project', idempotency_key as string))
          : randomUUID();
        const r = await deps.bridge.request('create_project', { projectId, ...planned.plan, transitionId });
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      });
    },
  );

  server.registerTool(
    'dayglance_update_project',
    {
      description:
        'Edit a dayGLANCE project. Absent leaves a field alone, present sets it, a name in clear_fields removes it ' +
        '("goal" detaches the project from its goal, making it standalone). Completing a project is allowed only once ' +
        'every one of its tasks is completed (the app\'s own rule). ' + LINKED_DESCRIPTION +
        'Returns the resulting project.' + PROJECT_NO_ARCHIVE,
      inputSchema: z.object({
        project_id: z.string(),
        title: z.string().optional().describe('New title. Can be set, never cleared.'),
        description: z.string().optional().describe(DESCRIPTION_ARG),
        description_base: z.string().optional().describe(DESCRIPTION_BASE_ARG),
        goal_id: z.string().optional().describe('Move the project under this goal.'),
        target_date: z.string().optional().describe('Local calendar date, strict YYYY-MM-DD — the project\'s own target date. Name "target_date" in clear_fields to remove it.'),
        status: z.string().optional().describe(PROJECT_STATUS_ARG),
        ...assigneeIdsArg,
        clear_fields: z.array(z.string()).optional().describe(
          `Field names to REMOVE: ${PROJECT_CLEARABLE.filter((f) => multiUser || f !== 'assignees').map((f) => `"${f}"`).join(', ')}.`),
        idempotency_key: IDEMPOTENCY_ARG,
      }),
    },
    async (args: Record<string, unknown>) => {
      const idempotency_key = args['idempotency_key'];
      return write('update_project', idempotency_key, async (transitionId, capture) => {
        const planned = planUpdateProject(args, multiUser);
        if (!planned.ok) return toolError(planned.code, planned.message);
        const r = await deps.bridge.request('update_project', { ...planned.plan, transitionId }, NOTE_WRITE_TIMEOUT_MS);
        return fromRenderer(r, { timezone: deps.timeZone() }, capture);
      });
    },
  );
}
