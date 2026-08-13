// The five Phase 3 write tools (spec §5.1), registered onto a per-request
// McpServer instance by the mcpServer.ts factory. §3.7 discipline as in
// mcpReadTools.ts: this module holds no state — the write gate, replay store,
// consent tier, and renderer bridge all arrive as deps owned by main.ts.
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
import type { RendererBridge } from './mcpRendererBridge.js';
import { isValidLocalDate, localDateOf, dateEnvelope } from './mcpDates.js';
import { validateStartTime, validateDurationMinutes } from './mcpLocalTime.js';
import type { createWriteGate } from './mcpWriteGate.js';
import {
  createIdempotencyStore,
  isValidIdempotencyKey,
  makeStoreKey,
  deterministicTaskIdFromSeed,
} from './mcpIdempotency.js';
import { planCreateTask } from './mcpCreateArgs.js';
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
  bridge: RendererBridge;
  gate: ReturnType<typeof createWriteGate>;
  store: ReturnType<typeof createIdempotencyStore<StoredResult>>;
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
            'MCP writes have been automatically disabled after repeated rate-limit violations. The user must re-enable them (restart dayGLANCE in Phase 3).',
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
    r: Awaited<ReturnType<RendererBridge['request']>>,
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
      'Attach to a project (see dayglance_get_goal_progress). Project tasks do not carry priority or deadline by design.'),
    ...(multiUser ? {
      assignee_id: z.string().optional().describe(
        'Assign to one household member by their user id. Ids come from dayglance_list_users — never guess from a name.'),
    } : {}),
    priority: z.number().int().optional().describe(
      'Inbox tasks only: 0 none (default), 1 low, 2 medium, 3 high. Scheduled and project tasks do not carry priority by design.'),
    deadline: z.string().optional().describe(
      'Inbox tasks only: local calendar date, strict YYYY-MM-DD. Scheduled and project tasks do not carry a deadline by design.'),
    start: z.string().optional().describe(
      'Presence makes this a SCHEDULED create, placed directly on the calendar in one call. ' +
      'Timed: local "YYYY-MM-DD HH:MM" (DST gap/repeat times rejected). With all_day: a bare "YYYY-MM-DD".'),
    duration_minutes: z.number().int().optional().describe(
      '1-1440. Defaults to 30. Contradicts all_day — an all-day task has no meaningful duration.'),
    all_day: z.boolean().optional().describe(
      'With start: create an all-day task. start must then be a bare YYYY-MM-DD date.'),
    repeat: z.unknown().optional().describe(
      'NOT SUPPORTED: recurring tasks cannot be created over MCP in v1. Passing anything here is an error.'),
    idempotency_key: IDEMPOTENCY_ARG,
  });

  server.registerTool(
    'dayglance_create_task',
    {
      description:
        'Create a new dayGLANCE task. Without start: an unscheduled inbox task (may carry priority and ' +
        'deadline). With start: a scheduled task placed directly onto the calendar — one call, no separate ' +
        'scheduling step. Returns the created task or block.',
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

  server.registerTool(
    'dayglance_schedule_task',
    {
      description:
        'Schedule an unscheduled dayGLANCE inbox task onto a day and time. start is local: ' +
        '"YYYY-MM-DD HH:MM", no UTC, no offsets. Returns the resulting block. If the inbox task ' +
        'carried a priority or deadline, scheduling drops them BY DESIGN and the response lists ' +
        'them in dropped_fields — tell the user rather than treating it as an error.' + CANNOT_MODIFY_NATIVE,
      inputSchema: z.object({
        task_id: z.string(),
        start: z.string().describe('Local "YYYY-MM-DD HH:MM". Times inside a DST gap or repeat are rejected.'),
        duration_minutes: z.number().int().optional().describe('1-1440. Defaults to the task\'s own duration, then 30.'),
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
        '(same or different day). Returns the resulting block.' + CANNOT_MODIFY_NATIVE,
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
        'Returns the resulting block.' + CANNOT_MODIFY_NATIVE,
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
        'Set a dayGLANCE task\'s completion state (a setter, not a toggle — safe to retry, and ' +
        'setting completed:false is the agent\'s own undo). Works for scheduled blocks, inbox ' +
        'tasks, and recurring-task instances.' + CANNOT_MODIFY_NATIVE,
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
}
