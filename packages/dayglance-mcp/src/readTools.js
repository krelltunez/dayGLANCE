// The Phase 2 read tools (spec §5.1), registered onto a per-request McpServer
// instance by the server's factory: the desktop app's (electron/mcpServer.ts)
// and a GLANCEvault-client host's. Formerly electron/mcpReadTools.ts.
//
// §3.7 DISCIPLINE: this module holds no state. Everything the tools need
// arrives as `deps` — the bridge to the data, the clock, the timezone, and the
// device-calendar consent tier — owned at module scope by the host (the
// desktop app's main.ts) and closed over by the factory. Phase 5 swaps the
// tier's SOURCE (env var → settings) without touching anything in this file:
// `includeNativeEvents` is already a function, not a value.
//
// §5.2 ERRORS: every failure is a tool error (isError: true) with a JSON body
// carrying { error: { code, message } } the model can branch on. Codes used
// here: renderer_unavailable, not_found, validation, internal. An unavailable
// renderer is NEVER an empty result — an empty result set is indistinguishable
// from an empty day, and the model would confidently report a clear schedule.

import { z } from 'zod';
import {
  isValidLocalDate,
  localDateOf,
  dateEnvelope,
  paginate,
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
} from '@glance-apps/mcp-host';
import { resolveInboxFilter } from './inboxFilter.js';

/**
 * dayGLANCE's pagination cursor prefix ("dayGLANCE cursor, version 1"). Part
 * of the wire format: changing it invalidates every cursor a client holds.
 */
export const CURSOR_PREFIX = 'dgc1.';

// ReadToolDeps (types/index.d.ts):
//   bridge               the HostBridge the tools read through
//   now()                injectable clock, same idiom as electron/calendarCache.ts
//   timeZone()           the IANA timezone the server resolves, never
//                        inferred from the client (§5.3)
//   includeNativeEvents() device-calendar consent tier (§6.3)
//   multiUserEnabled()   multi-user mode, pushed from the app (per-device
//                        toggle). Gates the EXISTENCE of dayglance_list_users,
//                        evaluated at registration time, which is per request
//                        (§3.7 factory), so a toggle mid-session changes the
//                        schema on the client's next request.

const ok = (data) => ({
  content: [{ type: 'text', text: JSON.stringify(data) }],
  structuredContent: data,
});

const toolError = (code, message) => ({
  isError: true,
  content: [{ type: 'text', text: JSON.stringify({ error: { code, message } }) }],
});

/** Map a renderer bridge failure onto the §5.2 typed error, verbatim codes. */
const bridgeError = (r) => toolError(r.error.code, r.error.message);

const NATIVE_NOTE =
  ' Items with type "device_calendar_event" are read-only device calendar events: ' +
  'dayGLANCE cannot modify, move, resize, or complete them. Items with type "calendar_event" ' +
  'are events imported from a calendar feed (ICS or CalDAV), read-only the same way; a task with ' +
  'source "caldav_tasks" comes from a CalDAV task calendar and cannot be edited or completed here. ' +
  'Blocks carry assignee_id when assigned (multi-user). The response also carries daily_note, the ' +
  "user's note for that day as dayGLANCE shows it (text and last_modified), or null; it is read-only over MCP.";

// Same reasoning as NATIVE_NOTE: state the limit in the description so the
// model knows it before it spends a call finding out. A routine is occupied
// time, which is the part that matters when looking for a free slot.
// Frames are the answer to "where could this go", so the description has to
// say that available_slots is already net of everything: a caller that
// re-subtracts the blocks it can see would double-count, and one that ignores
// the buffer would propose times the app itself would not.
const FRAME_NOTE =
  ' The response also carries "frames": the time windows the user set aside for a kind of work ' +
  '(GTD frames), each with available_slots and available_minutes ALREADY NET of tasks, routines, ' +
  'and, for today, time that has already passed, with the frame\'s buffer applied. Do not subtract ' +
  'the blocks again. Each frame carries tag_affinity, the #tags that window is meant for: match your ' +
  'own candidate tasks against it, dayGLANCE does not filter anything for you. Frames are read-only ' +
  'and are windows rather than work, so they are NOT in "blocks".';

const ROUTINE_NOTE =
  ' Items with type "routine" are dayGLANCE routine blocks. They OCCUPY the time they cover, ' +
  'exactly like a task, so treat them as busy when looking for a free slot. They are read-only ' +
  '(read_only: true): they cannot be moved, resized, completed, or edited over MCP, because ' +
  'routines are managed in the dayGLANCE routines dashboard. Routines exist only for the current ' +
  'day, so past and future dates never carry them.';

/**
 * @param {import('@modelcontextprotocol/server').McpServer} server
 * @param {import('../types/index.js').ReadToolDeps} deps
 */
export function registerReadTools(server, deps) {
  const getDay = async (date) => {
    const r = await deps.bridge.request('get_day', {
      date,
      include_native: deps.includeNativeEvents(),
    });
    if (!r.ok) return bridgeError(r);
    return ok({ ...dateEnvelope(date, deps.timeZone()), ...r.data });
  };

  server.registerTool(
    'dayglance_get_today',
    {
      description:
        "Today's schedule from dayGLANCE. Resolves the current LOCAL calendar date on the " +
        'user\'s machine. Use this instead of guessing the date. Response echoes the resolved ' +
        'date and IANA timezone; times are local wall-clock HH:MM.' + NATIVE_NOTE + ROUTINE_NOTE + FRAME_NOTE,
    },
    async () => getDay(localDateOf(deps.now(), deps.timeZone())),
  );

  server.registerTool(
    'dayglance_get_day',
    {
      description:
        'The dayGLANCE schedule for one LOCAL calendar date (YYYY-MM-DD, no time component, ' +
        'no UTC, no offsets). Response echoes the resolved date and IANA timezone; times are ' +
        'local wall-clock HH:MM. For the current date, prefer dayglance_get_today.' + NATIVE_NOTE + ROUTINE_NOTE + FRAME_NOTE,
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
        'back as cursor for the next page. Filters: scope "all" returns every unscheduled task ' +
        '(the default), "standalone" only tasks not attached to a project (what the app itself ' +
        'counts as the inbox), "project" only project-attached tasks; include_completed defaults ' +
        'to true, pass false for open tasks only. total, truncated, and next_cursor always ' +
        'describe the FILTERED set. Bucket List (someday/maybe) items are never returned by this ' +
        'tool; see dayglance_list_bucket_list. Items carry duration_minutes and, when assigned, ' +
        'assignee_id. A cursor is bound to the filters it was issued under: changing scope or ' +
        'include_completed mid-pagination is a validation error, so to change filters, restart ' +
        'with a fresh call and no cursor.',
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
      const items = r.data.items ?? [];
      const page = paginate(items, { limit, cursor, filterKey: filter.key, cursorPrefix: CURSOR_PREFIX });
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
        return ok({ ...r.data });
      },
    );
  }

  server.registerTool(
    'dayglance_list_bucket_list',
    {
      description:
        'The dayGLANCE Bucket List: someday/maybe items kept out of the inbox on purpose, in two lists with ' +
        "the user's own headings (by default Anytime and Someday). Items are inbox-shaped (id, title, completed, " +
        'and notes, project_id, duration_minutes, assignee_id, subtasks when present) plus bucket_id; they carry ' +
        'no priority or deadline. These items never appear in dayglance_list_unscheduled_tasks. Read-only over ' +
        'MCP: moving an item between the Bucket List and the inbox is done in dayGLANCE.',
    },
    async () => {
      const r = await deps.bridge.request('list_bucket_list', {});
      if (!r.ok) return bridgeError(r);
      return ok({ ...r.data, timezone: deps.timeZone() });
    },
  );

  server.registerTool(
    'dayglance_list_areas',
    {
      description:
        'The areas of life a dayGLANCE goal can belong to, as { id, name }. Use the id as area_id on ' +
        'dayglance_create_goal and dayglance_update_goal; goals report area_id and area_name. Areas are ' +
        'managed in dayGLANCE and cannot be created over MCP.',
    },
    async () => {
      const r = await deps.bridge.request('list_areas', {});
      if (!r.ok) return bridgeError(r);
      return ok({ ...r.data });
    },
  );

  server.registerTool(
    'dayglance_get_goal_progress',
    {
      description:
        'Goals and projects from dayGLANCE with their fields and progress. Each goal carries title, status, ' +
        'description, start_date, target_date, area_id and area_name, assignee_ids (multi-user), the linked ' +
        'Obsidian note when there is one, duration-weighted progress matching what the app shows, and its ' +
        'projects; each project carries title, status, description, goal_id, assignee_ids, obsidian_note, ' +
        'progress and task counts. A goal or project with obsidian_note keeps its description in that ' +
        "note's opening section: it is read from the note here (description_source \"obsidian_note\", with " +
        'description_base for a safe write through dayglance_update_goal or dayglance_update_project), or left ' +
        'empty when this computer cannot read the vault. Scope with goal_id ' +
        "for one goal's tree; window is 'active' (default) or 'all' (includes archived/completed goals and " +
        'projects). Tasks carry project_id, so dayglance_get_day and dayglance_list_unscheduled_tasks give a ' +
        "project's tasks.",
      inputSchema: z.object({
        goal_id: z.string().optional().describe('Narrow to one goal by id.'),
        window: z.enum(['active', 'all']).optional().describe("Status scope. Default 'active'."),
      }),
    },
    async ({ goal_id, window }) => {
      const params = {};
      if (goal_id !== undefined) params['goal_id'] = goal_id;
      if (window !== undefined) params['window'] = window;
      // Opens the linked notes for their descriptions, so it gets longer than a state read.
      const r = await deps.bridge.request('goal_progress', params, 8000);
      if (!r.ok) return bridgeError(r);
      return ok({ ...r.data, timezone: deps.timeZone() });
    },
  );
}
