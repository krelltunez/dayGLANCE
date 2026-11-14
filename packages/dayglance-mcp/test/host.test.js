// @vitest-environment node
// The shape of a GLANCEvault-client MCP host, minus the vault (#2280): plain
// Node, no browser globals, payload-shaped data in memory, the shared state
// builder and read model behind a HostBridge, the shared tools and resources
// on a real McpServer, served by the host kit's listener on a free loopback
// port and driven by the official client over HTTP. Nothing here is the
// desktop app's: if this passes, a host can answer the read surface from its
// own copy of the slices through exactly the code the app uses.
import './hideNodeWebStorage.js'; // first: before anything that loads the package
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'node:net';
import { McpServer } from '@modelcontextprotocol/server';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { startMcpListener, generateMcpToken } from '@glance-apps/mcp-host';
import {
  buildMcpReadState,
  handleMcpRequest,
  registerReadTools,
  registerResources,
} from '../src/index.js';

// The user is in Los Angeles; the host's own clock is UTC (the suite runs
// with TZ=UTC). At this instant it is already the 22nd on the server and
// still the evening of Wednesday the 21st for the user.
const ZONE = 'America/Los_Angeles';
const NOW = Date.parse('2026-10-22T03:30:00Z'); // 20:30 PDT on 2026-10-21
const TODAY = '2026-10-21';
const ME = 'u-me';
const OTHER = 'u-other';

/** The slices as a sync payload carries them (reassembled from vault rows, in a real host). */
const payload = {
  multiUserEnabled: true,
  users: [
    { id: 1, syncId: ME, name: 'Alex' },
    { id: 2, syncId: OTHER, name: 'Sam' },
    { id: 3, syncId: 'u-gone', name: 'Former', deleted: true },
  ],
  tasks: [
    { id: 't1', title: 'Write report', date: TODAY, startTime: '09:00', duration: 60, projectId: 'p1', assignedUserSyncIds: [ME], completed: true, createdAt: '2026-10-20T16:00:00.000Z', completedAt: '2026-10-21T17:15:00.000Z' },
    { id: 't2', title: 'Sam: dentist', date: TODAY, startTime: '10:00', duration: 30, projectId: 'p1', assignedUserSyncIds: [OTHER], completed: true },
    { id: 't3', title: 'Groceries', date: TODAY, startTime: '18:00', duration: 30, projectId: 'p1' },
    { id: 't4', title: 'Dentist follow-up', date: '2026-10-22', startTime: '08:00', duration: 30 },
  ],
  recurringTasks: [
    { id: 'standup', title: 'Standup', startTime: '08:30', duration: 15, recurrence: { type: 'daily', startDate: '2026-10-01' } },
  ],
  unscheduledTasks: [
    { id: 'u1', title: 'Plan trip' },
    { id: 'u2', title: 'Draft outline', projectId: 'p1', duration: 45 },
    { id: 'u3', title: 'Old errand', completed: true },
    { id: 'u4', title: 'Learn piano', bucketId: 'b2' },
    { id: 'u5', title: 'Sam: call bank', assignedUserSyncIds: [OTHER] },
  ],
  recycleBin: [],
  todayRoutines: [
    { id: 'r-mine', name: 'Stretch', startTime: '07:00', duration: 15, ownerSyncId: ME },
    { id: 'r-other', name: 'Sam: yoga', startTime: '06:00', duration: 30, ownerSyncId: OTHER },
  ],
  routinesDate: TODAY,
  routineCompletions: { 'r-mine': TODAY },
  routinesEnabled: true,
  gtdFrames: [
    { id: 'f-mine', label: 'Evening focus', enabled: true, days: [3], start: '19:00', end: '21:00', bufferMinutes: 0, tagAffinity: ['#writing'], ownerSyncId: ME },
    { id: 'f-other', label: 'Sam: deep work', enabled: true, days: [3], start: '19:00', end: '21:00', ownerSyncId: OTHER },
  ],
  goals: [
    { id: 'g1', title: 'Ship the website', status: 'active', areaId: 'a1', targetDate: '2026-12-01' },
    { id: 'g2', title: 'Old goal', status: 'archived' },
  ],
  projects: [
    { id: 'p1', title: 'Website', status: 'active', goalId: 'g1' },
    { id: 'p2', title: 'Side project', status: 'active' },
  ],
  areas: [{ id: 'a1', name: 'Work', order: 0 }],
  dailyNotes: { [TODAY]: { text: 'Gym after work.', lastModified: '2026-10-21T15:00:00.000Z' } },
  bucketConfig: { headings: { b1: 'Anytime', b2: 'Someday maybe' } },
};

/** The host's configuration: who it answers as, and the user's device settings. */
const config = { userSyncId: ME, timeZone: ZONE, weekStartDay: 1 };

/** A HostBridge answering from the host's copy, through the shared state builder and read model. */
const bridge = {
  async request(method, params) {
    const state = buildMcpReadState(payload, { now: NOW, ...config });
    return handleMcpRequest(state, { method, params });
  },
  async ping() { return true; },
  dispose() {},
};

const deps = {
  bridge,
  now: () => NOW,
  timeZone: () => ZONE,
  includeNativeEvents: () => false,
  multiUserEnabled: () => payload.multiUserEnabled,
};

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const TOKEN = generateMcpToken();
let server;
let client;

beforeAll(async () => {
  const port = await freePort();
  const quiet = () => {};
  server = startMcpListener({
    name: 'dayGLANCE host test',
    token: TOKEN,
    portOverride: port,
    defaultPort: port,
    log: quiet,
    logError: quiet,
    createServer: () => {
      const s = new McpServer({ name: 'dayGLANCE', version: '0.0.0' });
      registerReadTools(s, deps);
      registerResources(s, deps);
      return s;
    },
  });
  if (!server) throw new Error('listener refused to start');
  await new Promise((resolve) => server.once('listening', resolve));
  client = new Client({ name: 'dayglance-host-test', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  }));
});

afterAll(async () => {
  await client?.close().catch(() => {});
  await new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
});

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
  return r.structuredContent;
};

describe('a host with no browser', () => {
  it('runs in plain Node: no window, document, localStorage or indexedDB', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
    expect(typeof indexedDB).toBe('undefined');
    expect(globalThis.window).toBeUndefined();
    expect(globalThis.localStorage).toBeUndefined();
    expect(globalThis.indexedDB).toBeUndefined();
  });

  it('lists the read tools and resources the desktop server registers', async () => {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(tools).toEqual([
      'dayglance_get_day', 'dayglance_get_goal_progress', 'dayglance_get_today', 'dayglance_list_areas',
      'dayglance_list_bucket_list', 'dayglance_list_project_tasks', 'dayglance_list_unscheduled_tasks', 'dayglance_list_users',
    ]);
    const resources = (await client.listResources()).resources.map((r) => r.uri).sort();
    expect(resources).toEqual(['dayglance://goals/tree', 'dayglance://schedule/today', 'dayglance://schedule/week/current']);
  });
});

describe('the read surface, answered from the host\'s copy for one user in their zone', () => {
  it('get_today resolves the USER\'s date, not the server\'s, with their routines, blocks, frames and note', async () => {
    const day = await call('dayglance_get_today');
    expect(day.date).toBe(TODAY); // the server's UTC date is already 2026-10-22
    expect(day.timezone).toBe(ZONE);
    expect(day.blocks.map((b) => [b.id, b.type, b.start_time, b.completed])).toEqual([
      ['routine-r-mine', 'routine', '07:00', true],
      ['recurring-standup-2026-10-21', 'recurring_task', '08:30', false],
      ['t1', 'task', '09:00', true],
      ['t3', 'task', '18:00', false],
    ]);
    // Stamps in the user's zone: completed at 17:15 UTC is 10:15 in Los Angeles.
    const report = day.blocks.find((b) => b.id === 't1');
    expect(report.completed_at).toEqual({ date: TODAY, time: '10:15' });
    expect(report.created_at).toEqual({ date: '2026-10-20', time: '09:00' });
    expect(report.assignee_id).toBe(ME);
    // Only the user's frame, clipped to the user's 20:30.
    expect(day.frames.map((f) => [f.label, f.available_minutes, f.available_slots])).toEqual([
      ['Evening focus', 30, [{ start: '20:30', end: '21:00', minutes: 30 }]],
    ]);
    expect(day.daily_note).toEqual({ text: 'Gym after work.', last_modified: '2026-10-21T15:00:00.000Z' });
  });

  it('get_day for the server\'s date is the user\'s tomorrow: no routines, the other member\'s nothing', async () => {
    const day = await call('dayglance_get_day', { date: '2026-10-22' });
    expect(day.blocks.map((b) => b.id)).toEqual(['t4', 'recurring-standup-2026-10-22']);
    expect(day.frames).toEqual([]);
    expect(day.daily_note).toBeNull();
  });

  it('the goal tree carries progress over the user\'s visible tasks only', async () => {
    const tree = await call('dayglance_get_goal_progress');
    // p1: t1 (60, done), t3 (30), u2 (45) are the user's; Sam's t2 is not counted.
    expect(tree.goals).toEqual([expect.objectContaining({
      id: 'g1', title: 'Ship the website', status: 'active', target_date: '2026-12-01',
      area_id: 'a1', area_name: 'Work', progress_percent: 44,
      projects: [expect.objectContaining({ id: 'p1', goal_id: 'g1', progress_percent: 44, tasks_done: 1, tasks_total: 3 })],
    })]);
    expect(tree.standalone_projects.map((p) => [p.id, p.progress_percent])).toEqual([['p2', null]]);
    const all = await call('dayglance_get_goal_progress', { window: 'all' });
    expect(all.goals.map((g) => g.id)).toEqual(['g1', 'g2']);
  });

  it('the inbox honours its filter, never shows Bucket List items, and is the user\'s', async () => {
    const open = await call('dayglance_list_unscheduled_tasks', { scope: 'standalone', include_completed: false });
    expect(open.items.map((t) => t.id)).toEqual(['u1']);
    expect(open.total).toBe(1);
    expect(open.timezone).toBe(ZONE);
    const all = await call('dayglance_list_unscheduled_tasks', { limit: 2 });
    expect(all.items.map((t) => t.id)).toEqual(['u1', 'u2']);
    expect(all.total).toBe(3);
    expect(all.truncated).toBe(true);
    const rest = await call('dayglance_list_unscheduled_tasks', { limit: 2, cursor: all.next_cursor });
    expect(rest.items.map((t) => t.id)).toEqual(['u3']);
    expect(all.next_cursor.startsWith('dgc1.')).toBe(true);
  });

  it('a project\'s tasks are the ones its counters count, scheduled and not, in pages', async () => {
    const tree = await call('dayglance_get_goal_progress');
    const p1 = tree.goals[0].projects[0];
    // Sam's t2 is in the project and not the user's: not counted, not listed.
    const all = await call('dayglance_list_project_tasks', { project_id: 'p1' });
    expect(all.project).toEqual({ id: 'p1', title: 'Website', status: 'active' });
    expect(all.items.map((t) => [t.id, t.placement])).toEqual([['t1', 'scheduled'], ['t3', 'scheduled'], ['u2', 'inbox']]);
    expect(all.total).toBe(p1.tasks_total);
    expect(all.items.filter((t) => t.completed).length).toBe(p1.tasks_done);
    expect(all.timezone).toBe(ZONE);
    // A scheduled task is the block the day read returns, stamps in the user's zone.
    const day = await call('dayglance_get_today');
    const { placement: _p, ...block } = all.items[0];
    expect(block).toEqual(day.blocks.find((b) => b.id === 't1'));

    const first = await call('dayglance_list_project_tasks', { project_id: 'p1', limit: 2 });
    expect(first.items.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(first).toMatchObject({ total: 3, truncated: true });
    // An explicit true is the filter the cursor was issued under.
    const rest = await call('dayglance_list_project_tasks', { project_id: 'p1', limit: 2, cursor: first.next_cursor, include_completed: true });
    expect(rest.items.map((t) => t.id)).toEqual(['u2']);
    expect(rest).toMatchObject({ truncated: false, next_cursor: null });

    const open = await call('dayglance_list_project_tasks', { project_id: 'p1', include_completed: false });
    expect(open.items.map((t) => t.id)).toEqual(['t3', 'u2']);
    expect(open.total).toBe(2);
    expect((await call('dayglance_list_project_tasks', { project_id: 'p2' })).items).toEqual([]);

    const error = async (args) => {
      const r = await client.callTool({ name: 'dayglance_list_project_tasks', arguments: args });
      expect(r.isError).toBe(true);
      return JSON.parse(r.content[0].text).error;
    };
    // A cursor is bound to its project and its filter.
    expect(await error({ project_id: 'p2', cursor: first.next_cursor })).toMatchObject({ code: 'validation' });
    expect((await error({ project_id: 'p1', cursor: first.next_cursor, include_completed: false })).message)
      .toContain('project=p1;completed=1');
    expect(await error({ project_id: 'nope' })).toEqual({ code: 'not_found', message: 'No project with id "nope"' });
  });

  it('lists active users, areas, and the Bucket List under the user\'s headings', async () => {
    expect((await call('dayglance_list_users')).users).toEqual([{ id: ME, name: 'Alex' }, { id: OTHER, name: 'Sam' }]);
    expect((await call('dayglance_list_areas')).areas).toEqual([{ id: 'a1', name: 'Work' }]);
    const bucket = await call('dayglance_list_bucket_list');
    expect(bucket.lists.map((l) => [l.id, l.heading, l.items.map((i) => i.id)])).toEqual([
      ['b1', 'Anytime', []],
      ['b2', 'Someday maybe', ['u4']],
    ]);
  });

  it('the week resource starts on the user\'s week-start day and carries routines on today only', async () => {
    const r = await client.readResource({ uri: 'dayglance://schedule/week/current' });
    const week = JSON.parse(r.contents[0].text);
    expect(week.resolved_date).toBe(TODAY);
    expect(week.timezone).toBe(ZONE);
    expect(week.week_start_day).toBe(1);
    expect(week.days.map((d) => d.date)).toEqual([
      '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25',
    ]);
    const withRoutines = week.days.filter((d) => d.blocks.some((b) => b.type === 'routine')).map((d) => d.date);
    expect(withRoutines).toEqual([TODAY]);
  });

  it('the today resource answers the same day as the tool', async () => {
    const r = await client.readResource({ uri: 'dayglance://schedule/today' });
    const day = JSON.parse(r.contents[0].text);
    expect(day.date).toBe(TODAY);
    expect(day.blocks.map((b) => b.id)).toEqual(['routine-r-mine', 'recurring-standup-2026-10-21', 't1', 't3']);
  });

  it('never shows another member\'s routines, frames, tasks or inbox', async () => {
    const day = await call('dayglance_get_today');
    const inbox = await call('dayglance_list_unscheduled_tasks');
    const text = JSON.stringify([day, inbox]);
    for (const theirs of ['Sam: yoga', 'Sam: deep work', 'Sam: dentist', 'Sam: call bank']) expect(text).not.toContain(theirs);
  });
});
