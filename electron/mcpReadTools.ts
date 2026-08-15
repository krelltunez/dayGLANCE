// The four Phase 2 read tools (spec §5.1), registered onto a per-request
// McpServer instance by the mcpServer.ts factory.
//
// §3.7 DISCIPLINE: this module holds no state. Everything the tools need
// arrives as `deps` — the renderer bridge, the clock, the timezone, and the
// device-calendar consent tier — owned at module scope by main.ts and closed
// over by the factory. Phase 5 swaps the tier's SOURCE (env var → settings)
// without touching anything in this file: `includeNativeEvents` is already a
// function, not a value.
//
// §5.2 ERRORS: every failure is a tool error (isError: true) with a JSON body
// carrying { error: { code, message } } the model can branch on. Codes used
// here: renderer_unavailable, not_found, validation, internal. An unavailable
// renderer is NEVER an empty result — an empty result set is indistinguishable
// from an empty day, and the model would confidently report a clear schedule.

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { RendererBridge } from './mcpRendererBridge.js';
import { isValidLocalDate, localDateOf, dateEnvelope } from './mcpDates.js';
import { paginate, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from './mcpPagination.js';
import { resolveInboxFilter } from './mcpInboxFilter.js';

export interface ReadToolDeps {
  bridge: RendererBridge;
  /** Injectable clock, same idiom as calendarCache.ts. */
  now: () => number;
  /** The IANA timezone the server resolves — never inferred from the client (§5.3). */
  timeZone: () => string;
  /** Device-calendar consent tier (§6.3). Phase 2 reads an env var behind this; Phase 5 swaps the source. */
  includeNativeEvents: () => boolean;
  /**
   * Multi-user mode, pushed from the renderer (per-device toggle). Gates the
   * EXISTENCE of dayglance_list_users — evaluated at registration time, which
   * is per request (§3.7 factory), so a toggle mid-session changes the
   * schema on the client's next request.
   */
  multiUserEnabled: () => boolean;
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const ok = (data: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});

const toolError = (code: string, message: string): ToolResult => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }],
});

/** Map a renderer bridge failure onto the §5.2 typed error, verbatim codes. */
const bridgeError = (r: { ok: false; error: { code: string; message: string } }): ToolResult =>
  toolError(r.error.code, r.error.message);

const NATIVE_NOTE =
  ' Items with type "device_calendar_event" are read-only device calendar events: ' +
  'dayGLANCE cannot modify, move, resize, or complete them.';

export function registerReadTools(server: McpServer, deps: ReadToolDeps): void {
  const getDay = async (date: string): Promise<ToolResult> => {
    const r = await deps.bridge.request('get_day', {
      date,
      include_native: deps.includeNativeEvents(),
    });
    if (!r.ok) return bridgeError(r);
    const data = r.data as Record<string, unknown>;
    return ok({ ...dateEnvelope(date, deps.timeZone()), ...data });
  };

  server.registerTool(
    'dayglance_get_today',
    {
      description:
        "Today's schedule from dayGLANCE. Resolves the current LOCAL calendar date on the " +
        'user\'s machine. Use this instead of guessing the date. Response echoes the resolved ' +
        'date and IANA timezone; times are local wall-clock HH:MM.' + NATIVE_NOTE,
    },
    async () => getDay(localDateOf(deps.now(), deps.timeZone())),
  );

  server.registerTool(
    'dayglance_get_day',
    {
      description:
        'The dayGLANCE schedule for one LOCAL calendar date (YYYY-MM-DD, no time component, ' +
        'no UTC, no offsets). Response echoes the resolved date and IANA timezone; times are ' +
        'local wall-clock HH:MM. For the current date, prefer dayglance_get_today.' + NATIVE_NOTE,
      inputSchema: z.object({
        date: z.string().describe('Local calendar date, strict YYYY-MM-DD. Not a timestamp.'),
      }),
    },
    async ({ date }) => {
      if (!isValidLocalDate(date)) {
        return toolError(
          'validation',
          `date must be a real local calendar date in strict YYYY-MM-DD form (no time, no timezone), got ${JSON.stringify(date)}`,
        );
      }
      return getDay(date);
    },
  );

  server.registerTool(
    'dayglance_list_unscheduled_tasks',
    {
      description:
        "The dayGLANCE inbox: tasks not yet scheduled onto a day. Paginated, default page " +
        `${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT}; when truncated is true, pass next_cursor ` +
        'back as cursor for the next page.',
      inputSchema: z.object({
        limit: z.number().int().optional().describe(`Page size, 1-${MAX_LIST_LIMIT}. Default ${DEFAULT_LIST_LIMIT}.`),
        cursor: z.string().optional().describe('Opaque cursor from a previous response\'s next_cursor.'),
        scope: z.enum(['all', 'standalone', 'project']).optional().describe(
          'Which inbox tasks to return. "all" (default): every unscheduled task. "standalone": tasks not ' +
          'attached to any project (what the app counts as the inbox). "project": only tasks attached to a project.'),
        include_completed: z.boolean().optional().describe(
          'Default true. Pass false to return only open tasks.'),
      }),
    },
    async ({ limit, cursor, scope, include_completed }) => {
      // Resolve defaults BEFORE anything compares or encodes: the canonical
      // tuple is what the renderer applies and what the cursor carries, so
      // omitted-vs-explicit defaults can never mismatch across pages.
      const resolved = resolveInboxFilter({ scope, include_completed });
      if (!resolved.ok) return toolError('validation', resolved.message);
      const { filter } = resolved;
      const r = await deps.bridge.request('list_unscheduled', {
        filter: { scope: filter.scope, includeCompleted: filter.includeCompleted },
      });
      if (!r.ok) return bridgeError(r);
      const items = (r.data as { items: unknown[] }).items ?? [];
      const page = paginate(items, { limit, cursor, filterKey: filter.key });
      if (!page.ok) return toolError('validation', page.reason);
      return ok({
        items: page.items,
        truncated: page.truncated,
        next_cursor: page.nextCursor,
        total: page.total,
        timezone: deps.timeZone(),
      });
    },
  );

  // Registered ONLY while multi-user mode is on: with it off there are no
  // assignees to enumerate and create_task has no assignee_id argument, so
  // the tool would only invite confusion. The roster itself stays in the
  // renderer (read over the bridge like every other read) — the main process
  // gates existence but never holds a copy of the user list.
  if (deps.multiUserEnabled()) {
    server.registerTool(
      'dayglance_list_users',
      {
        description:
          'The household members tasks can be assigned to (multi-user mode). Returns active users as ' +
          '{ id, name }. Use the id as create_task\'s assignee_id. Resolve names through this list, ' +
          'never guess an id.',
      },
      async () => {
        const r = await deps.bridge.request('list_users', {});
        if (!r.ok) return bridgeError(r);
        return ok({ ...(r.data as Record<string, unknown>) });
      },
    );
  }

  server.registerTool(
    'dayglance_get_goal_progress',
    {
      description:
        'Goal and project progress from dayGLANCE. Progress is duration-weighted, matching ' +
        "what the app itself shows. Scope with goal_id for one goal's tree; window is " +
        "'active' (default) or 'all' (includes archived/completed goals and projects).",
      inputSchema: z.object({
        goal_id: z.string().optional().describe('Narrow to one goal by id.'),
        window: z.enum(['active', 'all']).optional().describe("Status scope. Default 'active'."),
      }),
    },
    async ({ goal_id, window }) => {
      const params: Record<string, unknown> = {};
      if (goal_id !== undefined) params['goal_id'] = goal_id;
      if (window !== undefined) params['window'] = window;
      const r = await deps.bridge.request('goal_progress', params);
      if (!r.ok) return bridgeError(r);
      return ok({ ...(r.data as Record<string, unknown>), timezone: deps.timeZone() });
    },
  );
}
