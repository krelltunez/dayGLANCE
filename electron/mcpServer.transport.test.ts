// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import net from 'node:net';
import type http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startMcpServer, MCP_ENDPOINT_PATH } from './mcpServer.js';
import {
  createWriteGate,
  createIdempotencyStore,
  generateMcpToken,
  appendEntry,
  type HostBridge as RendererBridge,
  type BridgeResult as RendererResult,
} from '@glance-apps/mcp-host';
import type { ReadToolDeps } from '@glance-apps/dayglance-mcp';
import { buildMcpReadState, handleMcpRequest } from '@glance-apps/dayglance-mcp/model';
import type { WriteToolDeps } from './mcpWriteTools.js';
import type { JournalReadDeps } from './mcpJournalRead.js';
import type { JournalEntry, JournalRecord } from './mcpJournal.js';

// The seam the unit tests cannot see (2026-10-04). Every layer below the
// listener has its own tests: argument parsers, the write gate, the replay
// store, the pure read and write models in the renderer. None of them starts
// the real server, registers the real tools, and talks to it the way Claude
// Desktop does. This suite does exactly that: the listener on a free loopback
// port, the official client over real HTTP with the real bearer token, and a
// scripted renderer bridge standing in for the dayGLANCE window.
//
// What it pins is the wiring, not the logic: that the tool and resource names
// are the ones docs/mcp-tools-reference.md documents, that a tool call reaches
// the bridge as the method the renderer answers, with the timeout the slower
// calls need, that a bridge failure comes back as the typed tool error and
// never as an empty result, and that the guards in front (token, path,
// consent, replay, rate gate) all run on the real request path.

const TOKEN = generateMcpToken();
const NOW = Date.parse('2026-10-04T12:00:00Z');
const TZ = 'UTC';
const TODAY = '2026-10-04';

type Call = { method: string; params: unknown; timeoutMs: number | undefined };
type Script = Record<string, (params: unknown) => RendererResult>;

const UNAVAILABLE: RendererResult = {
  ok: false,
  error: { code: 'renderer_unavailable', message: 'The dayGLANCE window is not responding. This is NOT an empty schedule.' },
};

/** A renderer bridge that answers from a script and records every request. */
function fakeBridge(script: Script) {
  const calls: Call[] = [];
  const bridge: RendererBridge = {
    async request(method, params, timeoutMs) {
      calls.push({ method, params, timeoutMs });
      const answer = script[method];
      return answer ? answer(params) : { ok: false, error: { code: 'validation', message: `unscripted method ${method}` } };
    },
    async ping() { return true; },
    dispose() {},
  };
  return { bridge, calls };
}

const DAY = { blocks: [{ id: 't1', type: 'task', title: 'Write tests', start_time: '09:00', duration_minutes: 60, completed: false }], frames: [], daily_note: { text: 'Quiet day.', last_modified: '2026-10-04T08:00:00Z' } };
const TREE = { goals: [{ id: 'g1', title: 'Home', status: 'active', description: '', progress_percent: 0, projects: [] }], standalone_projects: [] };

const okScript: Script = {
  get_day: () => ({ ok: true, data: DAY }),
  get_week: () => ({ ok: true, data: { week_start_day: 0, days: [{ date: TODAY, ...DAY }] } }),
  goal_progress: () => ({ ok: true, data: TREE }),
  list_unscheduled: () => ({ ok: true, data: { items: [] } }),
  list_users: () => ({ ok: true, data: { users: [{ id: 'u1', name: 'Alex' }] } }),
  list_areas: () => ({ ok: true, data: { areas: [] } }),
  list_bucket_list: () => ({ ok: true, data: { lists: [] } }),
  create_task: (p) => ({ ok: true, data: { task: { id: (p as { taskId: string }).taskId, title: (p as { title: string }).title } }, undo: { summary: `Created task “${(p as { title: string }).title}”`, op: { kind: 'remove_created_task', taskId: (p as { taskId: string }).taskId } } }),
};

/** The OS picks a free port; the listener refuses port 0 by design (mcpPort.ts), so we hand it the number. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

interface Harness {
  port: number;
  url: string;
  server: http.Server;
  connect(token?: string): Promise<Client>;
  close(): Promise<void>;
}

async function start(opts: { readDeps?: ReadToolDeps; writeDeps?: WriteToolDeps; journalDeps?: JournalReadDeps; token?: string }): Promise<Harness> {
  const port = await freePort();
  const quiet = () => {};
  const server = startMcpServer({ token: opts.token ?? TOKEN, portOverride: port, readDeps: opts.readDeps, writeDeps: opts.writeDeps, journalDeps: opts.journalDeps, log: quiet, logError: quiet });
  if (!server) throw new Error('listener refused to start');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const url = `http://127.0.0.1:${port}${MCP_ENDPOINT_PATH}`;
  const clients: Client[] = [];
  return {
    port,
    url,
    server,
    async connect(token = TOKEN) {
      const client = new Client({ name: 'dayglance-transport-test', version: '0.0.0' });
      const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
      await client.connect(transport);
      clients.push(client);
      return client;
    },
    async close() {
      await Promise.all(clients.map((c) => c.close().catch(() => {})));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function readDeps(bridge: RendererBridge, over: Partial<ReadToolDeps> = {}): ReadToolDeps {
  return { bridge, now: () => NOW, timeZone: () => TZ, includeNativeEvents: () => false, multiUserEnabled: () => false, ...over };
}

function writeDeps(bridge: RendererBridge, over: Partial<WriteToolDeps> = {}): WriteToolDeps {
  return {
    bridge,
    gate: createWriteGate({ now: () => NOW }),
    store: createIdempotencyStore({ now: () => NOW }),
    token: () => TOKEN,
    includeWrites: () => true,
    noteMcpWrite: () => {},
    onWritesDisabled: () => {},
    multiUserEnabled: () => false,
    now: () => NOW,
    timeZone: () => TZ,
    ...over,
  };
}

/** A tool result's JSON body, whichever side of isError it is on. */
function body(result: { content: unknown }): Record<string, unknown> {
  const [first] = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(first.text) as Record<string, unknown>;
}

/** The names docs/mcp-tools-reference.md documents, so the doc is the contract the server is held to. */
const reference = readFileSync(fileURLToPath(new URL('../docs/mcp-tools-reference.md', import.meta.url)), 'utf8');
const documentedTools = [...reference.matchAll(/^### `(dayglance_[a-z_]+)`/gm)].map((m) => m[1]!).sort();
const documentedResources = [...reference.matchAll(/^\| `(dayglance:\/\/[a-z/]+)` \|/gm)].map((m) => m[1]!).sort();

describe('the registered surface, read over the wire', () => {
  let multiUser = false;
  let h: Harness;
  let bridge: ReturnType<typeof fakeBridge>;
  beforeAll(async () => {
    bridge = fakeBridge(okScript);
    h = await start({
      readDeps: readDeps(bridge.bridge, { multiUserEnabled: () => multiUser }),
      writeDeps: writeDeps(bridge.bridge, { multiUserEnabled: () => multiUser }),
      journalDeps: { entries: () => [], timeZone: () => TZ },
    });
  });
  afterAll(() => h.close());
  afterEach(() => { multiUser = false; bridge.calls.length = 0; });

  it('lists exactly the tools the reference documents: 21 without multi-user, 22 with', async () => {
    const client = await h.connect();
    const without = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(without).toEqual(documentedTools.filter((n) => n !== 'dayglance_list_users'));
    expect(without).toHaveLength(21);

    multiUser = true;
    const withUsers = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(withUsers).toEqual(documentedTools);
    expect(withUsers).toHaveLength(22);
  });

  it('a multi-user toggle changes the schema on the SAME connection\'s next request, no reconnect', async () => {
    const client = await h.connect();
    const before = (await client.listTools()).tools.find((t) => t.name === 'dayglance_create_task')!;
    expect(Object.keys(before.inputSchema.properties ?? {})).not.toContain('assignee_id');
    multiUser = true;
    const after = (await client.listTools()).tools.find((t) => t.name === 'dayglance_create_task')!;
    expect(Object.keys(after.inputSchema.properties ?? {})).toContain('assignee_id');
    const goal = (await client.listTools()).tools.find((t) => t.name === 'dayglance_update_goal')!;
    expect(Object.keys(goal.inputSchema.properties ?? {})).toContain('assignee_ids');
  });

  it('lists exactly the resources the reference documents', async () => {
    const client = await h.connect();
    const uris = (await client.listResources()).resources.map((r) => r.uri).sort();
    expect(uris).toEqual(documentedResources);
    expect(uris).toHaveLength(3);
  });

  it('every tool and resource description is non-empty, so a model never meets a bare name', async () => {
    const client = await h.connect();
    for (const t of (await client.listTools()).tools) expect(t.description, t.name).toMatch(/\S/);
    for (const r of (await client.listResources()).resources) expect(r.description, r.uri).toMatch(/\S/);
  });
});

describe('a read call travels client → listener → bridge → client', () => {
  let h: Harness;
  let bridge: ReturnType<typeof fakeBridge>;
  beforeAll(async () => {
    bridge = fakeBridge(okScript);
    h = await start({ readDeps: readDeps(bridge.bridge) });
  });
  afterAll(() => h.close());
  afterEach(() => { bridge.calls.length = 0; });

  it('ping answers without touching the bridge', async () => {
    const client = await h.connect();
    const r = await client.callTool({ name: 'dayglance_ping', arguments: {} });
    expect(body(r)).toEqual({ ok: true, server: 'dayGLANCE MCP' });
    expect(bridge.calls).toEqual([]);
  });

  it('get_today resolves the local date on the server clock and asks the renderer for get_day with the default timeout', async () => {
    const client = await h.connect();
    const r = await client.callTool({ name: 'dayglance_get_today', arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(bridge.calls).toEqual([{ method: 'get_day', params: { date: TODAY, include_native: false }, timeoutMs: undefined }]);
    const data = body(r);
    expect(data).toMatchObject({ date: TODAY, timezone: TZ, daily_note: { text: 'Quiet day.' } });
    expect(data.blocks).toEqual(DAY.blocks);
    expect(data.frames).toEqual([]);
    // structuredContent carries the same object, for clients that read it instead of the text.
    expect(r.structuredContent).toEqual(data);
  });

  it('get_day validates before it asks: a bad date is a typed validation error and the bridge is never called', async () => {
    const client = await h.connect();
    const r = await client.callTool({ name: 'dayglance_get_day', arguments: { date: '2026-10-4' } });
    expect(r.isError).toBe(true);
    expect(body(r)).toMatchObject({ error: { code: 'validation' } });
    expect(bridge.calls).toEqual([]);
  });

  it('get_goal_progress and the goals resource ask with the 8 s note-reading timeout', async () => {
    const client = await h.connect();
    await client.callTool({ name: 'dayglance_get_goal_progress', arguments: {} });
    await client.readResource({ uri: 'dayglance://goals/tree' });
    expect(bridge.calls.map((c) => [c.method, c.timeoutMs])).toEqual([['goal_progress', 8000], ['goal_progress', 8000]]);
  });

  it('each read tool reaches the bridge as the method the renderer answers', async () => {
    const client = await h.connect();
    await client.callTool({ name: 'dayglance_list_unscheduled_tasks', arguments: {} });
    await client.callTool({ name: 'dayglance_list_areas', arguments: {} });
    await client.callTool({ name: 'dayglance_list_bucket_list', arguments: {} });
    expect(bridge.calls.map((c) => c.method)).toEqual(['list_unscheduled', 'list_areas', 'list_bucket_list']);
  });

  it('the schedule resources carry the day shape, with frames and daily_note, as JSON text', async () => {
    const client = await h.connect();
    const today = await client.readResource({ uri: 'dayglance://schedule/today' });
    const [contents] = today.contents as Array<{ uri: string; mimeType?: string; text: string }>;
    expect(contents.uri).toBe('dayglance://schedule/today');
    expect(contents.mimeType).toBe('application/json');
    expect(JSON.parse(contents.text)).toMatchObject({ date: TODAY, timezone: TZ, blocks: DAY.blocks, frames: [], daily_note: { text: 'Quiet day.' } });

    const week = await client.readResource({ uri: 'dayglance://schedule/week/current' });
    const parsed = JSON.parse((week.contents[0] as { text: string }).text) as { week_start_day: number; days: Array<{ date: string; daily_note: unknown }> };
    expect(parsed.week_start_day).toBe(0);
    expect(parsed.days[0]).toMatchObject({ date: TODAY, daily_note: { text: 'Quiet day.' } });
    expect(bridge.calls.map((c) => c.method)).toEqual(['get_day', 'get_week']);
  });
});

describe('a renderer that cannot answer', () => {
  let h: Harness;
  beforeAll(async () => {
    const down = fakeBridge({ get_day: () => UNAVAILABLE, goal_progress: () => UNAVAILABLE, create_task: () => UNAVAILABLE });
    h = await start({ readDeps: readDeps(down.bridge), writeDeps: writeDeps(down.bridge) });
  });
  afterAll(() => h.close());

  it('is a typed renderer_unavailable tool error whose text says it is not an empty schedule', async () => {
    const client = await h.connect();
    const r = await client.callTool({ name: 'dayglance_get_today', arguments: {} });
    expect(r.isError).toBe(true);
    const err = body(r).error as { code: string; message: string };
    expect(err.code).toBe('renderer_unavailable');
    expect(err.message).toMatch(/NOT an empty schedule/);
  });

  it('fails a resource read with the same code in the thrown message, never empty contents', async () => {
    const client = await h.connect();
    await expect(client.readResource({ uri: 'dayglance://goals/tree' })).rejects.toThrow(/renderer_unavailable/);
  });

  it('fails a write the same way, after the guards admitted it', async () => {
    const client = await h.connect();
    const r = await client.callTool({ name: 'dayglance_create_task', arguments: { title: 'x' } });
    expect(r.isError).toBe(true);
    expect(body(r)).toMatchObject({ error: { code: 'renderer_unavailable' } });
  });
});

describe('the guards in front of a write, on the real request path', () => {
  it('writes off: read_only_mode, and the bridge is never asked', async () => {
    const bridge = fakeBridge(okScript);
    const h = await start({ readDeps: readDeps(bridge.bridge), writeDeps: writeDeps(bridge.bridge, { includeWrites: () => false }) });
    try {
      const client = await h.connect();
      const r = await client.callTool({ name: 'dayglance_create_task', arguments: { title: 'Nope' } });
      expect(r.isError).toBe(true);
      expect(body(r)).toMatchObject({ error: { code: 'read_only_mode' } });
      expect(bridge.calls).toEqual([]);
      // Reads keep working in read-only mode.
      const today = await client.callTool({ name: 'dayglance_get_today', arguments: {} });
      expect(today.isError).toBeFalsy();
    } finally {
      await h.close();
    }
  });

  it('writes on: create_task reaches the bridge, is journaled, and a replay of the same key answers from the store', async () => {
    const bridge = fakeBridge(okScript);
    const journal: unknown[] = [];
    const h = await start({ writeDeps: writeDeps(bridge.bridge, { journal: (rec) => journal.push(rec) }) });
    try {
      const client = await h.connect();
      const args = { title: 'Order shingles', idempotency_key: 'order-shingles-1' };
      const first = await client.callTool({ name: 'dayglance_create_task', arguments: args });
      expect(first.isError).toBeFalsy();
      expect(bridge.calls).toHaveLength(1);
      expect(bridge.calls[0]).toMatchObject({ method: 'create_task', params: { title: 'Order shingles' } });
      expect(body(first)).toMatchObject({ task: { title: 'Order shingles' } });
      expect(body(first).replayed).toBeUndefined();
      expect(journal).toHaveLength(1);
      expect(journal[0]).toMatchObject({ tool: 'dayglance_create_task', idempotencyKey: 'order-shingles-1', summary: 'Created task “Order shingles”', op: { kind: 'remove_created_task' } });
      // The undo descriptor is main-process metadata and never reaches the client.
      expect(body(first).undo).toBeUndefined();

      const again = await client.callTool({ name: 'dayglance_create_task', arguments: args });
      expect(body(again)).toMatchObject({ task: { title: 'Order shingles' }, replayed: true });
      expect(bridge.calls).toHaveLength(1);
      expect(journal).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it('the rate gate refuses the write past the limit with rate_limited', async () => {
    const bridge = fakeBridge(okScript);
    const h = await start({ writeDeps: writeDeps(bridge.bridge, { gate: createWriteGate({ limit: 2, now: () => NOW }) }) });
    try {
      const client = await h.connect();
      for (const title of ['one', 'two']) {
        const r = await client.callTool({ name: 'dayglance_create_task', arguments: { title } });
        expect(r.isError, title).toBeFalsy();
      }
      const third = await client.callTool({ name: 'dayglance_create_task', arguments: { title: 'three' } });
      expect(third.isError).toBe(true);
      expect(body(third)).toMatchObject({ error: { code: 'rate_limited' } });
      expect(bridge.calls).toHaveLength(2);
    } finally {
      await h.close();
    }
  });

  it('a by-design rejection is a validation error decided before the bridge: archiving a goal', async () => {
    const bridge = fakeBridge(okScript);
    const h = await start({ writeDeps: writeDeps(bridge.bridge) });
    try {
      const client = await h.connect();
      const r = await client.callTool({ name: 'dayglance_update_goal', arguments: { goal_id: 'g1', status: 'archived' } });
      expect(r.isError).toBe(true);
      const err = body(r).error as { code: string; message: string };
      expect(err.code).toBe('validation');
      expect(err.message).toMatch(/not available over MCP/);
      expect(bridge.calls).toEqual([]);
    } finally {
      await h.close();
    }
  });
});

describe('project writes carry the project-level target date (2026-10-21)', () => {
  // A project's own target date, separate from any task's deadline. What the
  // transport must prove is that the plan reaches the renderer shaped and that
  // a malformed date is refused at the edge, before the bridge is asked.
  const projectScript: Script = {
    ...okScript,
    create_project: (p) => {
      const params = p as { projectId: string; title: string; targetDate?: string };
      return { ok: true, data: { project: { id: params.projectId, title: params.title, ...(params.targetDate ? { target_date: params.targetDate } : {}) } } };
    },
    update_project: (p) => {
      const params = p as { projectId: string; set?: { targetDate?: string } };
      return { ok: true, data: { project: { id: params.projectId, title: 'Roof', ...(params.set?.targetDate ? { target_date: params.set.targetDate } : {}) } } };
    },
  };

  it('create_project reaches the bridge with the target date in the plan', async () => {
    const bridge = fakeBridge(projectScript);
    const h = await start({ writeDeps: writeDeps(bridge.bridge) });
    try {
      const client = await h.connect();
      const r = await client.callTool({ name: 'dayglance_create_project', arguments: { title: 'Roof', target_date: '2026-12-01' } });
      expect(r.isError).toBeFalsy();
      expect(bridge.calls).toHaveLength(1);
      expect(bridge.calls[0]).toMatchObject({ method: 'create_project', params: { title: 'Roof', targetDate: '2026-12-01' } });
      expect(body(r)).toMatchObject({ project: { title: 'Roof', target_date: '2026-12-01' } });
    } finally {
      await h.close();
    }
  });

  it('update_project sets it, clears it by name, and refuses a malformed date before the bridge', async () => {
    const bridge = fakeBridge(projectScript);
    const h = await start({ writeDeps: writeDeps(bridge.bridge) });
    try {
      const client = await h.connect();
      const set = await client.callTool({ name: 'dayglance_update_project', arguments: { project_id: 'p1', target_date: '2026-12-01' } });
      expect(set.isError).toBeFalsy();
      expect(bridge.calls[0]).toMatchObject({ method: 'update_project', params: { projectId: 'p1', set: { targetDate: '2026-12-01' }, clear: [] } });
      const cleared = await client.callTool({ name: 'dayglance_update_project', arguments: { project_id: 'p1', clear_fields: ['target_date'] } });
      expect(cleared.isError).toBeFalsy();
      expect(bridge.calls[1]).toMatchObject({ method: 'update_project', params: { projectId: 'p1', clear: ['target_date'] } });
      const bad = await client.callTool({ name: 'dayglance_update_project', arguments: { project_id: 'p1', target_date: '2026-12-1' } });
      expect(bad.isError).toBe(true);
      expect(body(bad)).toMatchObject({ error: { code: 'validation' } });
      expect(bridge.calls).toHaveLength(2);
    } finally {
      await h.close();
    }
  });

  // On hold (src/utils/projectStatus.js): the tool says it takes the status,
  // and passes it to the app, whose mutation accepts it for projects.
  it('update_project takes status "on-hold", and its schema says so', async () => {
    const bridge = fakeBridge(projectScript);
    const h = await start({ writeDeps: writeDeps(bridge.bridge) });
    try {
      const client = await h.connect();
      const { tools } = await client.listTools();
      const tool = tools.find((x) => x.name === 'dayglance_update_project');
      expect(JSON.stringify(tool.inputSchema.properties.status)).toContain('on-hold');
      expect(tool.description).toContain('"on-hold"');
      const r = await client.callTool({ name: 'dayglance_update_project', arguments: { project_id: 'p1', status: 'on-hold' } });
      expect(r.isError).toBeFalsy();
      expect(bridge.calls[0]).toMatchObject({ method: 'update_project', params: { projectId: 'p1', set: { status: 'on-hold' } } });
    } finally {
      await h.close();
    }
  });
});

describe('repeating tasks over the wire (#2066)', () => {
  const seriesScript: Script = {
    ...okScript,
    create_task: (p) => ({
      ok: true,
      data: { series: { id: (p as { taskId: string }).taskId, title: (p as { title: string }).title } },
      undo: { summary: `Created repeating “${(p as { title: string }).title}”`, op: { kind: 'remove_created_series', templateId: (p as { taskId: string }).taskId } },
    }),
    update_recurring_task: (p) => ({
      ok: true,
      data: { scope: (p as { scope: string }).scope },
      undo: { summary: 'Edited repeating “Standup” (series: title)', op: { kind: 'restore_series_fields', templateId: 's1', before: { title: 'Standup' } } },
    }),
  };
  const withHarness = async (fn: (client: Awaited<ReturnType<Harness['connect']>>, calls: Call[], journal: unknown[]) => Promise<void>) => {
    const bridge = fakeBridge(seriesScript);
    const journal: unknown[] = [];
    const h = await start({ writeDeps: writeDeps(bridge.bridge, { journal: (rec) => journal.push(rec) }) });
    try {
      await fn(await h.connect(), bridge.calls, journal);
    } finally {
      await h.close();
    }
  };

  it('create_task with start and repeat reaches the bridge with the stored pattern, and is journaled per series', () =>
    withHarness(async (client, calls, journal) => {
      const r = await client.callTool({ name: 'dayglance_create_task', arguments: {
        title: 'Standup', start: '2026-10-05 09:00', duration_minutes: 15,
        repeat: { frequency: 'weekly', days_of_week: ['mon', 'wed'], count: 10 },
      } });
      expect(r.isError).toBeFalsy();
      expect(calls[0]).toMatchObject({
        method: 'create_task',
        params: {
          title: 'Standup',
          schedule: { date: '2026-10-05', startTime: '09:00', durationMinutes: 15 },
          recurrence: { type: 'weekly', daysOfWeek: [1, 3], maxOccurrences: 10 },
        },
      });
      expect(journal[0]).toMatchObject({ op: { kind: 'remove_created_series' } });
    }));

  it('an interval is a by-design rejection with its own message, decided before the bridge', () =>
    withHarness(async (client, calls) => {
      const r = await client.callTool({ name: 'dayglance_create_task', arguments: {
        title: 'Water plants', start: '2026-10-05 09:00', repeat: { frequency: 'daily', interval: 3 },
      } });
      expect(r.isError).toBe(true);
      expect(body(r)).toMatchObject({ error: { code: 'validation', message: expect.stringMatching(/no interval by design/) } });
      expect(calls).toEqual([]);
    }));

  it('update_recurring_task reaches the bridge with its plan; a bad scope or a series-only field never does', () =>
    withHarness(async (client, calls, journal) => {
      const ok = await client.callTool({ name: 'dayglance_update_recurring_task', arguments: {
        task_id: 'recurring-s1-2026-10-07', scope: 'series', title: 'Daily sync',
      } });
      expect(ok.isError).toBeFalsy();
      expect(calls[0]).toMatchObject({
        method: 'update_recurring_task',
        params: { taskId: 'recurring-s1-2026-10-07', scope: 'series', set: { title: 'Daily sync' }, clear: [] },
      });
      expect(journal[0]).toMatchObject({ tool: 'dayglance_update_recurring_task', op: { kind: 'restore_series_fields' } });

      // The scope is a plain string in the schema so this message survives SDK validation.
      const noScope = await client.callTool({ name: 'dayglance_update_recurring_task', arguments: {
        task_id: 'recurring-s1-2026-10-07', scope: 'all', title: 'x',
      } });
      expect(body(noScope)).toMatchObject({ error: { code: 'validation', message: expect.stringMatching(/"occurrence".*"series"/) } });

      const seriesOnly = await client.callTool({ name: 'dayglance_update_recurring_task', arguments: {
        task_id: 'recurring-s1-2026-10-07', scope: 'occurrence', notes: 'x',
      } });
      expect(body(seriesOnly)).toMatchObject({ error: { code: 'validation', message: expect.stringMatching(/belongs to the whole series by design/) } });
      expect(calls).toHaveLength(1);
    }));
});

// #2278: a task that runs past midnight is the previous date's; the next
// date's get_day carries the part after midnight as a block marked
// continues_from, and the frames there are net of it. The renderer here
// answers with the real read model over a fixture state, so what crosses the
// wire is what the app would send.
describe('a task running past midnight, over the wire (#2278)', () => {
  const YESTERDAY = '2026-10-03';
  const state = buildMcpReadState({
    tasks: [
      { id: 'night', title: 'Night shift', date: YESTERDAY, startTime: '23:00', duration: 120, completed: false, isAllDay: false },
      { id: 'breakfast', title: 'Breakfast', date: TODAY, startTime: '08:00', duration: 30, completed: false, isAllDay: false },
    ],
    gtdFrames: [{ id: 'f1', label: 'Early', enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '03:00', bufferMinutes: 0 }],
    // Read at 00:00, so the frame's hours have not yet elapsed.
  }, { now: Date.parse(`${TODAY}T00:00:00Z`), timeZone: TZ });
  let h: Harness;
  let bridge: ReturnType<typeof fakeBridge>;
  beforeAll(async () => {
    bridge = fakeBridge({ get_day: (params) => handleMcpRequest(state, { method: 'get_day', params }) as RendererResult });
    h = await start({ readDeps: readDeps(bridge.bridge) });
  });
  afterAll(() => h.close());

  it('get_today carries the continuation from 00:00, marked continues_from, and frames net of it', async () => {
    const client = await h.connect();
    const r = await client.callTool({ name: 'dayglance_get_today', arguments: {} });
    expect(r.isError).toBeFalsy();
    const data = body(r) as { blocks: Array<Record<string, unknown>>; frames: Array<Record<string, unknown>> };
    expect(data.blocks.map((b) => [b.id, b.start_time, b.duration_minutes, b.continues_from])).toEqual([
      ['night', '00:00', 60, YESTERDAY],
      ['breakfast', '08:00', 30, undefined],
    ]);
    expect(data.blocks[0]).toMatchObject({ type: 'task', title: 'Night shift', date: TODAY });
    expect(data.frames[0]).toMatchObject({ available_minutes: 120, available_slots: [{ start: '01:00', end: '03:00', minutes: 120 }] });
  });

  it('get_day on the start date reports the task once, with its full duration', async () => {
    const client = await h.connect();
    const r = await client.callTool({ name: 'dayglance_get_day', arguments: { date: YESTERDAY } });
    const data = body(r) as { blocks: Array<Record<string, unknown>> };
    expect(data.blocks).toEqual([expect.objectContaining({ id: 'night', date: YESTERDAY, start_time: '23:00', duration_minutes: 120 })]);
    expect(data.blocks[0]).not.toHaveProperty('continues_from');
  });

  it('the day tools tell the model what continues_from means', async () => {
    const client = await h.connect();
    const tools = (await client.listTools()).tools;
    for (const name of ['dayglance_get_today', 'dayglance_get_day']) {
      expect(tools.find((t) => t.name === name)!.description).toContain('continues_from');
    }
    // And the reference documents the field the server sends.
    expect(reference).toContain('`continues_from`');
  });
});

// #2278, phase 1 gaps: frame availability counts what get_day lists as
// blocks, recurring occurrences included (a recurring meeting in a frame used
// to read as free time), and the night before's occurrence still running
// after midnight. Through the real read model, as above.
describe('frames net of recurring occurrences, over the wire (#2278)', () => {
  const YESTERDAY = '2026-10-03';
  const state = buildMcpReadState({
    tasks: [],
    recurringTasks: [{
      id: 's1', title: 'Backup', startTime: '01:30', duration: 30, isAllDay: false,
      recurrence: { type: 'daily', startDate: '2026-09-01' },
      // Last night's ran late, into today.
      exceptions: { [YESTERDAY]: { startTime: '23:30', duration: 60 } },
    }],
    gtdFrames: [{ id: 'f1', label: 'Early', enabled: true, days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '03:00', bufferMinutes: 0 }],
  }, { now: Date.parse(`${TODAY}T00:00:00Z`), timeZone: TZ });
  let h: Harness;
  beforeAll(async () => {
    const bridge = fakeBridge({ get_day: (params) => handleMcpRequest(state, { method: 'get_day', params }) as RendererResult });
    h = await start({ readDeps: readDeps(bridge.bridge) });
  });
  afterAll(() => h.close());

  it('get_today\'s frame is net of today\'s occurrence and of last night\'s piece', async () => {
    const client = await h.connect();
    const data = body(await client.callTool({ name: 'dayglance_get_today', arguments: {} })) as {
      blocks: Array<Record<string, unknown>>; frames: Array<Record<string, unknown>>;
    };
    expect(data.blocks.map((b) => [b.id, b.start_time, b.duration_minutes, b.continues_from])).toEqual([
      [`recurring-s1-${YESTERDAY}`, '00:00', 30, YESTERDAY],
      [`recurring-s1-${TODAY}`, '01:30', 30, undefined],
    ]);
    expect(data.frames[0]).toMatchObject({
      available_minutes: 120,
      available_slots: [{ start: '00:30', end: '01:30', minutes: 60 }, { start: '02:00', end: '03:00', minutes: 60 }],
    });
  });
});

// #2321: the session write journal read back over MCP. The writes go through
// the real write pipeline and land in a journal kept the way main.ts keeps it
// (appendEntry into a plain array); the read goes through the real listener.
describe('dayglance_list_mcp_writes, over the wire (#2321)', () => {
  // What the renderer's undo descriptors carry beside user data: the op kinds,
  // the schedule op's whole before-task with its bookkeeping (the transition
  // id IS the caller's idempotency key), all host-side metadata.
  const INTERNAL = 'internal-lastModified-2026';
  const journalScript: Script = {
    ...okScript,
    // The kinds the renderer really journals, so the read can describe them.
    create_task: (p) => {
      const { taskId, title } = p as { taskId: string; title: string };
      return { ok: true, data: { task: { id: taskId, title } }, undo: { summary: `Created task “${title}”`, op: { kind: 'remove_created', taskId } } };
    },
    schedule_task: (p) => {
      const { taskId, date, startTime } = p as { taskId: string; date: string; startTime: string };
      return {
        ok: true,
        data: { block: { id: taskId, title: 'Order shingles', date, start_time: startTime } },
        undo: {
          summary: `Scheduled “Order shingles” at ${date} ${startTime}`,
          op: { kind: 'restore_unscheduled', taskId, beforeTask: { id: taskId, title: 'Order shingles', priority: 2, transitionId: 'shingles-1', lastModified: INTERNAL } },
        },
      };
    },
    create_goal: (p) => ({
      ok: true,
      data: { goal: { id: (p as { goalId: string }).goalId, title: 'Home' } },
      undo: { summary: 'Created goal “Home”', op: { kind: 'remove_created_goal', goalId: (p as { goalId: string }).goalId } },
    }),
  };

  /** A harness whose journal is kept as main.ts keeps it, with a clock that ticks a minute per write. */
  async function journalHarness(over: { writes?: boolean; reads?: boolean } = {}) {
    const bridge = fakeBridge(journalScript);
    let entries: JournalEntry[] = [];
    const record = (rec: JournalRecord) => {
      entries = appendEntry(entries, rec, new Date(NOW + entries.length * 60_000).toISOString());
    };
    const h = await start({
      ...(over.reads === false ? {} : { readDeps: readDeps(bridge.bridge) }),
      writeDeps: writeDeps(bridge.bridge, { journal: record, includeWrites: () => over.writes !== false }),
      journalDeps: { entries: () => entries, timeZone: () => TZ },
    });
    return { h, bridge, entries: () => entries };
  }

  const list = async (client: Client, args: Record<string, unknown> = {}) => {
    const r = await client.callTool({ name: 'dayglance_list_mcp_writes', arguments: args });
    // The raw wire text and the structured copy, for the leak assertions.
    const raw = `${(r.content as Array<{ text: string }>)[0]!.text}\n${JSON.stringify(r.structuredContent ?? null)}`;
    return { r, raw, data: body(r) as { items: Array<Record<string, unknown>>; total: number; truncated: boolean; next_cursor: string | null; timezone: string } };
  };

  it('reads back the writes this session made, newest first, without the undo op or anything in it', async () => {
    const { h, bridge, entries } = await journalHarness();
    try {
      const client = await h.connect();
      const created = await client.callTool({ name: 'dayglance_create_task', arguments: { title: 'Order shingles', idempotency_key: 'shingles-1' } });
      const taskId = (body(created).task as { id: string }).id;
      await client.callTool({ name: 'dayglance_schedule_task', arguments: { task_id: taskId, start: '2026-10-05 09:00' } });
      await client.callTool({ name: 'dayglance_create_goal', arguments: { title: 'Home' } });
      expect(entries()).toHaveLength(3);
      const callsBefore = bridge.calls.length;

      const { r, raw, data } = await list(client);
      expect(r.isError).toBeFalsy();
      // A read of main-process state: the renderer is never asked.
      expect(bridge.calls).toHaveLength(callsBefore);
      expect(data).toMatchObject({ total: 3, truncated: false, next_cursor: null, timezone: TZ });
      expect(data.items.map((i) => i.tool)).toEqual(['dayglance_create_goal', 'dayglance_schedule_task', 'dayglance_create_task']);
      expect(data.items[1]).toEqual({
        at: { date: TODAY, time: '12:01' },
        tool: 'dayglance_schedule_task',
        summary: 'Scheduled “Order shingles” at 2026-10-05 09:00',
        task_id: taskId,
        changes: [
          { field: 'date', before: null },
          { field: 'start_time', before: null },
          { field: 'priority', before: 2 },
        ],
      });
      expect(data.items[2]).toEqual({ at: { date: TODAY, time: '12:00' }, tool: 'dayglance_create_task', summary: 'Created task “Order shingles”', task_id: taskId });
      expect(data.items[0]).toMatchObject({ goal_id: expect.any(String) });
      expect(r.structuredContent).toEqual(data);

      // Nothing of the descriptor crosses the wire: not the op, its kinds, the
      // before-task's bookkeeping, nor the idempotency key it carried.
      for (const leak of ['"op"', 'restore_unscheduled', 'remove_created', 'beforeTask', 'transitionId', 'lastModified', INTERNAL, 'shingles-1', 'idempotency', '"seq"']) {
        expect(raw, leak).not.toContain(leak);
      }
    } finally {
      await h.close();
    }
  });

  it('task_id narrows to that task\'s writes; an id nothing touched is an empty list, not an error', async () => {
    const { h } = await journalHarness();
    try {
      const client = await h.connect();
      const a = body(await client.callTool({ name: 'dayglance_create_task', arguments: { title: 'Order shingles' } })).task as { id: string };
      await client.callTool({ name: 'dayglance_create_task', arguments: { title: 'Call roofer' } });
      await client.callTool({ name: 'dayglance_schedule_task', arguments: { task_id: a.id, start: '2026-10-05 09:00' } });

      const { data } = await list(client, { task_id: a.id });
      expect(data.items.map((i) => [i.tool, i.task_id])).toEqual([['dayglance_schedule_task', a.id], ['dayglance_create_task', a.id]]);
      expect(data.total).toBe(2);

      const none = await list(client, { task_id: 'no-such-task' });
      expect(none.r.isError).toBeFalsy();
      expect(none.data).toMatchObject({ items: [], total: 0, truncated: false });
    } finally {
      await h.close();
    }
  });

  it('an empty journal is an empty list', async () => {
    const { h } = await journalHarness();
    try {
      const { r, data } = await list(await h.connect());
      expect(r.isError).toBeFalsy();
      expect(data).toEqual({ items: [], total: 0, truncated: false, next_cursor: null, timezone: TZ });
    } finally {
      await h.close();
    }
  });

  it('pages under the read tools\' cap: a limit above 200 is a validation error, and the cursor walks the rest', async () => {
    const { h } = await journalHarness();
    try {
      const client = await h.connect();
      for (const title of ['one', 'two', 'three']) await client.callTool({ name: 'dayglance_create_task', arguments: { title } });
      const tooMany = await list(client, { limit: 201 });
      expect(tooMany.r.isError).toBe(true);
      expect(tooMany.data).toMatchObject({ error: { code: 'validation' } });

      const first = await list(client, { limit: 2 });
      expect(first.data).toMatchObject({ total: 3, truncated: true });
      expect(first.data.next_cursor).toMatch(/^dgc1\./);
      const second = await list(client, { limit: 2, cursor: first.data.next_cursor });
      expect(second.data.items.map((i) => i.summary)).toEqual(['Created task “one”']);
      // The cursor is bound to its filter.
      const changed = await list(client, { limit: 2, cursor: first.data.next_cursor, task_id: 'x' });
      expect(changed.data).toMatchObject({ error: { code: 'validation' } });
    } finally {
      await h.close();
    }
  });

  it('rides the read tier: it answers in read-only mode, and is not registered without the read surface', async () => {
    const readOnly = await journalHarness({ writes: false });
    try {
      const client = await readOnly.h.connect();
      const refused = await client.callTool({ name: 'dayglance_create_task', arguments: { title: 'Nope' } });
      expect(body(refused)).toMatchObject({ error: { code: 'read_only_mode' } });
      const { r, data } = await list(client);
      expect(r.isError).toBeFalsy();
      expect(data).toMatchObject({ items: [], total: 0 });
    } finally {
      await readOnly.h.close();
    }

    const noReads = await journalHarness({ reads: false });
    try {
      const client = await noReads.h.connect();
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain('dayglance_create_task');
      expect(names).not.toContain('dayglance_list_mcp_writes');
      await expect(client.callTool({ name: 'dayglance_list_mcp_writes', arguments: {} })).rejects.toThrow(/not found/);
    } finally {
      await noReads.h.close();
    }
  });

  it('the description says what it is not: MCP writes only, this session, not the app\'s edits', async () => {
    const { h } = await journalHarness();
    try {
      const tool = (await (await h.connect()).listTools()).tools.find((t) => t.name === 'dayglance_list_mcp_writes')!;
      expect(tool.description).toMatch(/since dayGLANCE last started/);
      expect(tool.description).toMatch(/ONLY writes made over MCP/);
      expect(tool.description).toMatch(/Edits made in the dayGLANCE app, on other devices/);
      expect(tool.description).toMatch(/not a task's full history/);
      expect(Object.keys(tool.inputSchema.properties ?? {}).sort()).toEqual(
        ['cursor', 'goal_id', 'limit', 'project_id', 'series_id', 'subtask_id', 'task_id'],
      );
    } finally {
      await h.close();
    }
  });
});

// A task's plan history (original_plan, deferrals, plan_trail,
// plan_trail_omitted) rides the task output the read tools already return.
// Through the real read model over a fixture state, as above: a task that
// slipped carries the fields in wire form, a task never moved carries none.
describe('plan history on the task output, over the wire', () => {
  const MON = '2026-09-28';
  const WED = '2026-09-30';
  const FRI = '2026-10-02';
  const history = {
    originalPlan: { date: MON, startTime: '09:00', duration: 60 },
    deferrals: 4,
    planTrail: [
      { at: Date.parse('2026-09-28T10:15:00Z'), date: WED, startTime: '09:00' },
      { at: Date.parse('2026-09-30T11:00:00Z'), date: TODAY, startTime: '14:00' },
    ],
  };
  const state = buildMcpReadState({
    tasks: [
      { id: 'slid', title: 'Write the report', date: TODAY, startTime: '14:00', duration: 60, completed: false, isAllDay: false, ...history },
      { id: 'fresh', title: 'Call the bank', date: TODAY, startTime: '10:00', duration: 30, completed: false, isAllDay: false },
      // An imported feed event carrying the fields anyway: never reported on an event.
      { id: 'feed', title: 'Standup', date: TODAY, startTime: '09:00', duration: 15, completed: false, imported: true, ...history },
    ],
    unscheduledTasks: [
      { id: 'parked', title: 'Renew passport', date: null, startTime: null, completed: false, ...history, deferrals: 2, planTrail: [history.planTrail[0]] },
    ],
  }, { now: NOW, timeZone: TZ });
  const HISTORY_KEYS = ['original_plan', 'deferrals', 'plan_trail', 'plan_trail_omitted'];
  let h: Harness;
  beforeAll(async () => {
    const bridge = fakeBridge({
      get_day: (params) => handleMcpRequest(state, { method: 'get_day', params }) as RendererResult,
      list_unscheduled: (params) => handleMcpRequest(state, { method: 'list_unscheduled', params }) as RendererResult,
    });
    h = await start({ readDeps: readDeps(bridge.bridge) });
  });
  afterAll(() => h.close());

  it('get_today: the slipped task carries its history in wire form; the task never moved and the event carry none', async () => {
    const client = await h.connect();
    const data = body(await client.callTool({ name: 'dayglance_get_today', arguments: {} })) as { blocks: Array<Record<string, unknown>> };
    const byId = Object.fromEntries(data.blocks.map((b) => [b.id, b]));
    expect(byId.slid).toMatchObject({
      original_plan: { date: MON, start_time: '09:00', duration_minutes: 60 },
      deferrals: 4,
      plan_trail: [
        { moved_at: { date: MON, time: '10:15' }, date: WED, start_time: '09:00' },
        { moved_at: { date: WED, time: '11:00' }, date: TODAY, start_time: '14:00' },
      ],
      plan_trail_omitted: 2,
    });
    for (const id of ['fresh', 'feed']) {
      for (const key of HISTORY_KEYS) expect(byId[id], `${id} ${key}`).not.toHaveProperty(key);
    }
  });

  it('list_unscheduled_tasks: an inbox task keeps the history it gathered while scheduled', async () => {
    const client = await h.connect();
    const data = body(await client.callTool({ name: 'dayglance_list_unscheduled_tasks', arguments: {} })) as { items: Array<Record<string, unknown>> };
    expect(data.items).toEqual([expect.objectContaining({
      id: 'parked',
      original_plan: { date: MON, start_time: '09:00', duration_minutes: 60 },
      deferrals: 2,
      plan_trail: [{ moved_at: { date: MON, time: '10:15' }, date: WED, start_time: '09:00' }],
      plan_trail_omitted: 1,
    })]);
  });

  it('the task-reading tools tell the model the fields and their limits, and the reference documents them', async () => {
    const client = await h.connect();
    const tools = (await client.listTools()).tools;
    for (const name of ['dayglance_get_today', 'dayglance_get_day', 'dayglance_list_unscheduled_tasks', 'dayglance_list_bucket_list']) {
      const description = tools.find((t) => t.name === name)!.description!;
      for (const key of HISTORY_KEYS) expect(description, `${name} ${key}`).toContain(key);
    }
    for (const key of HISTORY_KEYS) expect(reference).toContain(`\`${key}\``);
  });
});

describe('the listener itself', () => {
  let h: Harness;
  beforeAll(async () => {
    const bridge = fakeBridge(okScript);
    h = await start({ readDeps: readDeps(bridge.bridge) });
  });
  afterAll(() => h.close());

  it('a wrong token is one 401 with the bearer challenge, and the client cannot even initialize', async () => {
    const res = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer nope' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
    const missing = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
    expect(missing.status).toBe(401);
    await expect(h.connect('wrong-token')).rejects.toThrow();
  });

  it('any path but /mcp is 404 before auth runs', async () => {
    const res = await fetch(`http://127.0.0.1:${h.port}/`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(404);
  });

  it('a browser origin is refused by the DNS-rebinding guard', async () => {
    const res = await fetch(h.url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${TOKEN}`, origin: 'https://evil.example' }, body: '{}' });
    expect(res.status).toBe(403);
  });

  it('refuses to start without a token or with port 0, loudly', async () => {
    const errors: string[] = [];
    const port = await freePort();
    expect(startMcpServer({ token: '', portOverride: port, log: () => {}, logError: (m) => errors.push(m) })).toBeNull();
    expect(startMcpServer({ token: TOKEN, portOverride: 0, log: () => {}, logError: (m) => errors.push(m) })).toBeNull();
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/no bearer token/);
    expect(errors[1]).toMatch(/port 0/);
  });
});
