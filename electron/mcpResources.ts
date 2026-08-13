// The three Phase 4 read-only resources (spec §5.4), registered onto a
// per-request McpServer instance by the mcpServer.ts factory.
//
// NO SUBSCRIPTIONS — deferred per §5.4: they would add a stateful session
// dimension to the HTTP transport, and §3.7 keeps this transport sessionless.
//
// SAME READ PATH AS THE TOOLS: every resource goes over the same renderer
// bridge to the same pure read models (mcpReadModel.js) the Phase 2 tools
// use — no second read path. §5.3 semantics: the server resolves today from
// its own clock and timezone (never the client's), and every payload echoes
// the resolved date and IANA timezone. _native device-calendar events ride
// the same consent tier as the tools (deps.includeNativeEvents) and carry the
// same distinct type flag, applied inside the shared model.
//
// ERRORS: a resource read has no isError content channel, so failures THROW
// and surface as a JSON-RPC error whose message leads with the same §5.2 code
// the tools use (e.g. "[renderer_unavailable] …"). Never empty contents — an
// empty schedule payload is indistinguishable from an empty day (§3.3).

import type { McpServer } from '@modelcontextprotocol/server';
import type { ReadToolDeps } from './mcpReadTools.js';
import { localDateOf, dateEnvelope } from './mcpDates.js';

const MIME = 'application/json';

function resourceError(code: string, message: string): Error {
  return new Error(`[${code}] ${message}`);
}

export function registerResources(server: McpServer, deps: ReadToolDeps): void {
  /** Shared fetch: renderer request → JSON contents, or a typed throw. */
  const read = async (
    uri: string,
    method: string,
    params: Record<string, unknown>,
    envelope: Record<string, unknown>,
  ) => {
    const r = await deps.bridge.request(method, params);
    if (!r.ok) throw resourceError(r.error.code, r.error.message);
    return {
      contents: [{
        uri,
        mimeType: MIME,
        text: JSON.stringify({ ...envelope, ...(r.data as Record<string, unknown>) }),
      }],
    };
  };

  server.registerResource(
    'dayglance-schedule-today',
    'dayglance://schedule/today',
    {
      title: "Today's schedule",
      description:
        "Today's dayGLANCE blocks and completion state. The date is resolved on the user's machine " +
        '(local calendar date, §5.3) and echoed with the IANA timezone. Items with type ' +
        '"device_calendar_event" are read-only device calendar events.',
      mimeType: MIME,
    },
    async (uri) => {
      const today = localDateOf(deps.now(), deps.timeZone());
      return read(uri.href, 'get_day', {
        date: today,
        include_native: deps.includeNativeEvents(),
      }, dateEnvelope(today, deps.timeZone()) as unknown as Record<string, unknown>);
    },
  );

  server.registerResource(
    'dayglance-schedule-week-current',
    'dayglance://schedule/week/current',
    {
      title: 'Current week',
      description:
        'The current calendar week of dayGLANCE blocks: the week containing today, starting on the ' +
        "user's configured week-start day (echoed as week_start_day, 0=Sunday). Dates and times are " +
        'local (§5.3); the resolved date and IANA timezone are echoed.',
      mimeType: MIME,
    },
    async (uri) => {
      const today = localDateOf(deps.now(), deps.timeZone());
      return read(uri.href, 'get_week', {
        date: today,
        include_native: deps.includeNativeEvents(),
      }, { resolved_date: today, timezone: deps.timeZone() });
    },
  );

  server.registerResource(
    'dayglance-goals-tree',
    'dayglance://goals/tree',
    {
      title: 'Goals and projects',
      description:
        'The dayGLANCE goal and project hierarchy with duration-weighted progress (active goals and ' +
        'projects, matching what the app shows). Same data as the dayglance_get_goal_progress tool.',
      mimeType: MIME,
    },
    async (uri) => read(uri.href, 'goal_progress', {}, { timezone: deps.timeZone() }),
  );
}
