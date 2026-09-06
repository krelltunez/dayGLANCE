// Bridge scenario harness: project and goal notes (companion §4.3), the
// 2026-09-04 rulings. Real plugin transport and map writer, real sync hook.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const effects: Array<{ fn: () => unknown; deps?: unknown[] }> = [];
vi.mock('react', () => ({
  useEffect: (fn: () => unknown, deps?: unknown[]) => { effects.push({ fn, deps }); },
  useCallback: (fn: unknown) => fn,
  useRef: (init: unknown) => ({ current: init }),
}));
vi.mock('../../src/obsidian.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    tryRestoreVaultAccess: vi.fn(async () => null),
    getVaultAccess: vi.fn(async () => null),
    syncObsidianVault: vi.fn(async () => ({ dailyNotes: {}, scheduledTasks: [], inboxTasks: [] })),
    syncObsidianVaultNative: vi.fn(async () => null),
    writeTaskStateToFile: vi.fn(async () => true),
    writeTaskStateNative: vi.fn(() => false),
    readWikiNote: vi.fn(async () => null),
    writeWikiNote: vi.fn(async () => {}),
    scanVaultNotes: vi.fn(async () => ({ names: [], unportable: [] })),
    vaultHasTasksPlugin: vi.fn(async () => false),
    detectTasksPluginNative: vi.fn(() => null),
    readVaultHeartbeat: vi.fn(async () => ({ paired: true, tsMs: Date.now(), accountId: 'acc-1', deviceId: 'plugin-dev' })),
    readVaultHeartbeatNative: vi.fn(() => null),
  };
});
vi.mock('../../src/native.js', () => ({
  isNativeAndroid: () => false, isNativeApp: () => false,
  nativeGetVaultConfig: vi.fn(() => null), nativeGetNote: vi.fn(() => null), nativeWriteNote: vi.fn(), nativeOpenNote: vi.fn(),
  nativeListNotes: vi.fn(() => []), nativeSetVaultSettings: vi.fn(), nativeSetLaunchOnWrite: vi.fn(),
}));
vi.mock('../../src/utils/obsidianBridgeMode.js', () => ({ recordBridgeMode: vi.fn(), reconcileArchivedBaseline: vi.fn(() => null) }));

const { createScenario, VAULT_URL, ACCOUNT_ID, until, advanceFake } = await import('./harness');
const { default: useObsidianSync } = await import('../../src/hooks/useObsidianSync.js');
const { flushBridgeOutbox, emitBridgeIntent, __resetBridgeStreamForTests } = await import('../../src/utils/obsidianBridgeStream.js');
const { NoteBlockWriter } = await import('../src/noteBlocks');
const { parseYaml } = await import('obsidian');

type Row = Record<string, any>;

function mountDevice(name: string, lists: { projects?: Row[]; goals?: Row[] } = {}) {
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() };
  const activate = () => { (globalThis as any).localStorage = ls; };
  const run = async <T,>(fn: () => Promise<T> | T): Promise<T> => { activate(); const out = await fn(); await advanceFake(300); return out; };
  ls.setItem('dayglance-vault-config', JSON.stringify({ enabled: true, vaultUrl: VAULT_URL, vaultToken: `token-${name}`, accountId: ACCOUNT_ID }));
  const state = { tasks: [] as Row[], inbox: [] as Row[], recycleBin: [] as Row[], projects: lists.projects ?? [], goals: lists.goals ?? [] };
  const tasksRef = { current: state.tasks };
  const inboxRef = { current: state.inbox };
  const replace = (arr: Row[], next: Row[]) => { arr.splice(0, arr.length, ...next); };
  const setTasks = (up: Row[] | ((p: Row[]) => Row[])) => { replace(state.tasks, typeof up === 'function' ? up([...state.tasks]) : up); };
  const setUnscheduledTasks = (up: Row[] | ((p: Row[]) => Row[])) => { replace(state.inbox, typeof up === 'function' ? up([...state.inbox]) : up); };
  const updateProject = (id: string, updates: Row) => { for (const p of state.projects) if (p.id === id) Object.assign(p, updates); };
  const updateGoal = (id: string, updates: Row) => { for (const g of state.goals) if (g.id === id) Object.assign(g, updates); };
  effects.length = 0;
  activate();
  const api = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: state.tasks, setTasks, unscheduledTasks: state.inbox, setUnscheduledTasks,
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null, obsidianCompletionDates: false, obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError: vi.fn(), setObsidianLastSynced: vi.fn(), setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: {} }, obsidianSyncInProgressRef: { current: false }, obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: tasksRef, obsidianInboxRef: inboxRef,
    recycleBin: state.recycleBin, setRecycleBin: vi.fn(),
    projects: state.projects, goals: state.goals, updateProject, updateGoal,
  });
  const myEffects = [...effects];
  api.bridgeHeartbeatRef.current = { obsidianRunning: true, pluginAuthoritative: true };
  return {
    name, state, api, store,
    sync: () => run(() => until(api.performObsidianSync())),
    /** Push everything the app has queued: emitBridgeIntent's own flush is fire-and-forget and may have read the outbox before a later emit. */
    flush: () => run(async () => {
      for (let i = 0; i < 4; i++) {
        await until(flushBridgeOutbox());
        if (JSON.parse(store.get('dayglance-bridge-outbox') ?? '[]').length === 0) break;
      }
    }),
    /** Run the writeback effect, then push EVERYTHING it queued (a pass can emit several intents; the first emit's own flush may read the outbox before the rest land). */
    writeback: () => run(async () => {
      for (const e of myEffects) if (e.deps?.length === 3) e.fn();
      await advanceFake(50);
      for (let i = 0; i < 6; i++) {
        await until(flushBridgeOutbox());
        if (JSON.parse(store.get('dayglance-bridge-outbox') ?? '[]').length === 0) break;
      }
    }),
    patch: (id: string, fields: Row) => {
      const bump = (list: Row[]) => list.map((x) => (x.id === id ? { ...x, ...fields, lastModified: new Date().toISOString() } : x));
      setTasks(bump); setUnscheduledTasks(bump);
    },
    all: () => [...state.tasks, ...state.inbox],
    /** Emit one raw intent from this device and push it to the vault. */
    emit: (type: string, fields: Record<string, unknown>) => run(async () => {
      if (!emitBridgeIntent(type, fields)) throw new Error(`emit ${type} refused`);
      await until(flushBridgeOutbox());
    }),
    /** A task born in dayGLANCE (random id, no vault fields), scheduled or in the inbox. */
    add: (task: Row) => {
      const t = { id: `t-${Math.random().toString(36).slice(2, 10)}`, completed: false, lastModified: new Date().toISOString(), ...task };
      if (t.date) setTasks((prev) => [...prev, t]); else setUnscheduledTasks((prev) => [...prev, t]);
      return t.id;
    },
  };
}

let s: Awaited<ReturnType<typeof createScenario>>;
let A: ReturnType<typeof mountDevice>;
let blocks: InstanceType<typeof NoteBlockWriter>;

const frontmatterOf = (path: string) => { const t = s.text(path) ?? ''; const end = t.indexOf('\n---', 4); return parseYaml(t.slice(4, end + 1)); };

async function boot(lists: { projects?: Row[]; goals?: Row[] }): Promise<void> {
  await s.plugin.transport.drain();
  A = mountDevice('A', lists);
  await A.sync();
  for (let i = 0; i < 5 && s.plugin.transport.stampingState() !== 'armed'; i++) { await s.advance(1000); await s.plugin.transport.drain(); }
  if (s.plugin.transport.stampingState() !== 'armed') throw new Error('boot: plugin not armed');
  // The map writer, wired as main.ts wires it, fed by the app's lists in place of the mirror.
  blocks = new NoteBlockWriter({
    app: s.plugin.app,
    paired: () => true,
    linkedNotes: () => s.plugin.transport.linkedNotes(),
    blockInputs: () => ({ projects: A.state.projects, goals: A.state.goals }),
    bufferDirty: (p) => s.plugin.transport.bufferDirty(p),
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date('2026-09-04T12:00:00.000Z') });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1; });
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  __resetBridgeStreamForTests();
  s = await createScenario();
});
afterEach(() => { blocks?.dispose(); s.plugin.shutdown(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('project and goal notes: creation, the maintained map, the project field', () => {
  it('1. a project born in dayGLANCE gets the default note (no Dataview: sentences, no fences), the id key, and a three-key map that task changes never touch', async () => {
    const goal = { id: 'g1', title: 'Home', status: 'active' };
    const project = { id: 'p1', title: 'House', status: 'active', goalId: 'g1' };
    await boot({ projects: [project], goals: [goal] });
    expect(A.api.createProjectNote('project', 'p1', { title: 'House', goalId: 'g1' })).toBe(true);
    await A.flush();
    await s.plugin.transport.drain();
    await s.advance(3000);
    await A.sync();
    expect(project.obsidianNotePath).toBe('Projects/House.md');
    const text = s.text('Projects/House.md')!;
    expect(text).toContain('# House\n');
    expect(text).toContain('## Tasks\n- [ ] \n');
    expect(text).toContain('## Done\nWith the Dataview plugin installed');
    expect(text).not.toContain('```');
    expect(text).toContain('## Log\n- 2026-09-04 Created\n');
    expect(frontmatterOf('Projects/House.md')['dayglance-id']).toBe('p1');

    await blocks.tick();
    const writes = s.plugin.app.vault.writes;
    expect(frontmatterOf('Projects/House.md').dayglance).toEqual({ kind: 'project', status: 'active', goal: 'Home' });
    // No counts: neither a tick nor a task change writes again.
    await blocks.tick();
    await s.advance(6 * 60_000);
    await blocks.tick();
    expect(s.plugin.app.vault.writes).toBe(writes);
  });

  it('2. with Dataview installed the note carries exactly one query section; the goal note two', async () => {
    (s.plugin.app as any).plugins.plugins.dataview = {};
    await boot({ projects: [{ id: 'p1', title: 'House', status: 'active' }], goals: [{ id: 'g1', title: 'Home', status: 'active' }] });
    const q1 = A.api.createProjectNote('project', 'p1', { title: 'House' });
    const q2 = A.api.createProjectNote('goal', 'g1', { title: 'Home' });
    expect(q1 && q2).toBe(true);
    await A.flush();
    await s.plugin.transport.drain();
    const house = s.text('Projects/House.md')!;
    expect((house.match(/```dataview/g) || []).length).toBe(1);
    expect(house).toContain('FROM "Daily"\nFLATTEN file.lists AS item\nWHERE item.project = this.file.link');
    const home = s.text('Goals/Home.md')!;
    expect((home.match(/```dataview/g) || []).length).toBe(2);
    expect(home).toContain('WHERE dayglance.goal = this.file.link');
    expect(home).toContain('item.project.dayglance.goal = this.file.link');
  });

  it('3. the goal key is a wikilink once the goal note exists, and a goal reassignment is the one thing that rewrites the map', async () => {
    const goals = [{ id: 'g1', title: 'Home', status: 'active', obsidianNotePath: 'Goals/Home.md' }, { id: 'g2', title: 'Work', status: 'active' }];
    const projects = [{ id: 'p1', title: 'House', status: 'active', goalId: 'g1' }];
    await boot({ projects, goals });
    await s.write('Goals/Home.md', '---\ndayglance-id: g1\n---\n# Home\n');
    await s.write('Projects/House.md', '---\ndayglance-id: p1\n---\n# House\n');
    s.plugin.transport.linkTick();
    await s.advance(3000);
    await blocks.tick();
    expect(frontmatterOf('Projects/House.md').dayglance).toEqual({ kind: 'project', status: 'active', goal: '[[Goals/Home]]' });
    expect(frontmatterOf('Goals/Home.md').dayglance).toEqual({ kind: 'goal', status: 'active' });
    const writes = s.plugin.app.vault.writes;
    projects[0].goalId = 'g2';
    await s.advance(6 * 60_000);
    await blocks.tick();
    expect(frontmatterOf('Projects/House.md').dayglance).toEqual({ kind: 'project', status: 'active', goal: 'Work' });
    expect(s.plugin.app.vault.writes).toBe(writes + 1);
  });

  it('4. a daily-note task reassigned to an UNLINKED project gets the project field on its line; an Obsidian edit of the field reassigns it back', async () => {
    const projects = [{ id: 'p2', title: 'Garden', status: 'active' }, { id: 'p3', title: 'Attic', status: 'active' }];
    await boot({ projects });
    await s.write('Daily/2026-09-04.md', '## Tasks\n- [ ] Call the plumber\n');
    for (let i = 0; i < 40; i++) await s.advance(1000);
    await A.sync();
    const task = A.all()[0];
    expect(task.id).toMatch(/^obsidian-dg-/);
    expect(task.projectId).toBeUndefined();

    A.patch(task.id, { projectId: 'p2' });
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text('Daily/2026-09-04.md')).toMatch(/- \[ \] Call the plumber \[project:: Garden\] \^dg-/);
    for (let i = 0; i < 40; i++) await s.advance(1000);
    await A.sync();
    expect(A.all()[0].projectId).toBe('p2');
    expect(A.all()[0].title).toBe('Call the plumber #obsidian');

    const edited = s.text('Daily/2026-09-04.md')!.replace('[project:: Garden]', '[project:: Attic]');
    await s.write('Daily/2026-09-04.md', edited);
    for (let i = 0; i < 40; i++) await s.advance(1000);
    await A.sync();
    expect(A.all()[0].projectId).toBe('p3');
  });

  // ── Project routing (owner, 2026-09-05): a task assigned to a linked
  // project LIVES in that note. No folder scope is set in any of these:
  // the link is the scope.
  const NOTE = 'Projects/House.md';
  async function bootLinked(extraProjects: Row[] = []): Promise<Row> {
    const project = { id: 'p1', title: 'House', status: 'active' };
    await boot({ projects: [project, ...extraProjects] });
    expect(A.api.createProjectNote('project', 'p1', { title: 'House' })).toBe(true);
    await A.flush();
    await s.plugin.transport.drain();
    await s.advance(3000);
    await A.sync();
    expect(project.obsidianNotePath).toBe(NOTE);
    expect(s.plugin.transport.linkedNotes().has(NOTE)).toBe(true);
    return project;
  }
  const lineFor = (title: string) => new RegExp(`- \\[ \\] ${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\^dg-[a-z0-9]{8}`);

  it('5. a task born in dayGLANCE under a linked project lands in the note under a derived token, the schedule as metadata, and round-trips under that id', async () => {
    await bootLinked();
    const before = A.all().length;
    const scheduledId = A.add({ title: 'Buy hinges', projectId: 'p1', date: '2026-09-06', startTime: '10:00', duration: 30 });
    const inboxId = A.add({ title: 'Price the gate', projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    const text = s.text(NOTE)!;
    expect(text).toMatch(/- \[ \] 10:00-10:30 Buy hinges \[scheduled:: 2026-09-06\] \^dg-[a-z0-9]{8}/);
    expect(text).toMatch(lineFor('Price the gate'));
    // Under ## Tasks, at the section's end, before ## Done.
    expect(text.indexOf('## Tasks')).toBeLessThan(text.indexOf('Buy hinges'));
    expect(text.indexOf('Buy hinges')).toBeLessThan(text.indexOf('## Done'));
    // Identity moved on enqueue: the app task now carries the derived id and its home.
    const bound = A.all().filter((t) => t.projectId === 'p1');
    expect(bound).toHaveLength(2);
    for (const t of bound) {
      expect(t.id).toMatch(/^obsidian-dg-/);
      expect(t.obsidianNotePath).toBe(NOTE);
      expect(t.importSource).toBe('obsidian');
      expect(t.title).toMatch(/ #obsidian$/);
    }
    expect(A.all().find((t) => t.id === scheduledId)).toBeUndefined();
    expect(A.all().find((t) => t.id === inboxId)).toBeUndefined();
    const ids = bound.map((t) => t.id).sort();
    // The observation round trip keeps ONE task per line, same ids, same assignment and schedule.
    await s.settle();
    await A.sync();
    expect(A.all().length).toBe(before + 2);
    expect(A.all().filter((t) => t.projectId === 'p1').map((t) => t.id).sort()).toEqual(ids);
    expect(A.state.tasks.find((t) => t.title.startsWith('Buy hinges'))).toMatchObject({ date: '2026-09-06', startTime: '10:00', projectId: 'p1' });
    expect(A.state.inbox.find((t) => t.title.startsWith('Price the gate'))).toMatchObject({ projectId: 'p1' });
    // A second writeback pass writes nothing more.
    const writes = s.plugin.app.vault.writes;
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
  });

  it('6. assigning an existing daily-note task moves its line into the note under the SAME id; unassigning removes the line and the task stays in dayGLANCE, app-only', async () => {
    await bootLinked();
    await s.write('Daily/2026-09-04.md', '## Tasks\n- [ ] Call the plumber\n');
    await s.settle();
    await A.sync();
    const task = A.all().find((t) => t.title.startsWith('Call the plumber'))!;
    const id = task.id;
    expect(task.obsidianFileDate).toBe('2026-09-04');

    A.patch(id, { projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text('Daily/2026-09-04.md')).not.toContain('Call the plumber');
    expect(s.text(NOTE)).toMatch(new RegExp(`- \\[ \\] Call the plumber \\^dg-${id.slice('obsidian-dg-'.length)}`));
    expect(A.all().find((t) => t.id === id)).toMatchObject({ obsidianNotePath: NOTE, projectId: 'p1' });
    // Both notes re-observed, in whatever order: still one task, same id.
    await s.settle();
    await A.sync();
    await s.advance(100_000);
    await A.sync();
    expect(A.all().filter((t) => t.title.startsWith('Call the plumber')).map((t) => t.id)).toEqual([id]);
    expect(A.all().find((t) => t.id === id)).toMatchObject({ obsidianNotePath: NOTE, projectId: 'p1' });

    A.patch(id, { projectId: undefined });
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).not.toContain('Call the plumber');
    expect(s.text('Daily/2026-09-04.md')).not.toContain('Call the plumber');
    const gone = A.all().find((t) => t.id === id)!;
    expect(gone).toBeDefined();
    expect(gone.importSource).toBeNull();
    expect(gone.obsidianNotePath).toBeNull();
    expect(gone.obsidianBlockId).toBe(id.slice('obsidian-dg-'.length)); // the token is for life
    // The note's next observation (line absent) tombstones nothing: no task claims it.
    await s.settle();
    await A.sync();
    await s.advance(100_000);
    await A.sync();
    expect(A.all().filter((t) => t.id === id)).toHaveLength(1);
  });

  it('7. a line typed in the linked note imports assigned (the link is the scope); reassigning to another linked project moves it between notes', async () => {
    await bootLinked([{ id: 'p2', title: 'Garden', status: 'active' }]);
    expect(A.api.createProjectNote('project', 'p2', { title: 'Garden' })).toBe(true);
    await A.flush();
    await s.plugin.transport.drain();
    await s.advance(3000);
    await A.sync();
    const GARDEN = 'Projects/Garden.md';
    expect(s.plugin.transport.linkedNotes().has(GARDEN)).toBe(true);

    await s.write(NOTE, s.text(NOTE)!.replace('## Tasks\n', '## Tasks\n- [ ] Fix the gate\n'));
    await s.settle();
    await A.sync();
    const task = A.all().find((t) => t.title.startsWith('Fix the gate'))!;
    expect(task).toMatchObject({ projectId: 'p1', obsidianNotePath: NOTE });
    expect(task.id).toMatch(/^obsidian-dg-/);

    A.patch(task.id, { projectId: 'p2' });
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).not.toContain('Fix the gate');
    expect(s.text(GARDEN)).toMatch(new RegExp(`- \\[ \\] Fix the gate \\^dg-${task.id.slice('obsidian-dg-'.length)}`));
    await s.settle();
    await A.sync();
    await s.advance(100_000);
    await A.sync();
    expect(A.all().filter((t) => t.title.startsWith('Fix the gate')).map((t) => t.id)).toEqual([task.id]);
    expect(A.all().find((t) => t.id === task.id)).toMatchObject({ projectId: 'p2', obsidianNotePath: GARDEN });
  });

  it('8. a fresh link fills the note over passes, not in one burst', async () => {
    await bootLinked();
    for (let i = 0; i < 30; i++) A.add({ title: `Chore ${String(i).padStart(2, '0')}`, projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    expect((s.text(NOTE)!.match(/- \[ \] Chore /g) ?? []).length).toBe(25);
    await A.writeback();
    await s.plugin.transport.drain();
    expect((s.text(NOTE)!.match(/- \[ \] Chore /g) ?? []).length).toBe(30);
  });
});

// ── Daily-note templates (companion §4.4 build record, 2026-09-06) ──────────
// A daily note is created because dayGLANCE needed somewhere to write, and
// since the posture ruling that creation always happens HERE, in a running
// Obsidian, at apply time — so the plugin's creation point is where a
// template note renders through the ladder. The stub has no Templater, so
// the ladder's subset rung is what runs unless a scenario installs a fake.
describe('daily-note templates: the ladder at the plugin\'s creation point', () => {
  const DAILY = 'Daily/2026-09-10.md';
  const TEMPLATE = 'Templates/Daily.md';
  const appendFields = {
    path: DAILY, date: '2026-09-10', heading: '## Tasks', template: '## Fallback\n',
    task: { title: 'Water the plants #obsidian', startTime: null, duration: null, isAllDay: true, date: '2026-09-10', blockId: 'abc12345' },
  };
  const templaterFake = () => ({
    templater: {
      create_running_config: vi.fn((tf: unknown, target: { basename: string }, mode: number) => ({ tf, target, mode })),
      read_and_parse_template: vi.fn(async (cfg: { target: { basename: string } }) => `# Rendered by Templater for ${cfg.target.basename}\n\n## Tasks\n`),
    },
  });

  it('9. a task append that finds no note creates it from the configured template note (subset here), with the line under its heading, not from the text fallback', async () => {
    await boot({});
    await s.write(TEMPLATE, '# {{title}}\n\nToday is {{date}}.\n\n## Journal\n\n## Tasks\n');
    s.plugin.data.projectNotes = { dailyTemplate: TEMPLATE };
    await A.emit('task_append', appendFields);
    await s.plugin.transport.drain();
    const text = s.text(DAILY)!;
    expect(text.startsWith('---\n')).toBe(true);
    expect(text).toContain('# 2026-09-10');
    expect(text).toContain('Today is 2026-09-10.');
    expect(text).toContain('## Journal');
    expect(text).toMatch(/## Tasks\n- \[ \] Water the plants #obsidian \^dg-abc12345/);
    expect(text).not.toContain('## Fallback');
    expect(s.plugin.transport.templateStatus()).toBeNull();
    // Replay is a no-op: the note exists now and already carries the line.
    await A.emit('task_append', appendFields);
    await s.plugin.transport.drain();
    expect(s.text(DAILY)).toBe(text);
  });

  it('9b. a completion-log entry creates the day\'s note from the same template; without a template note the text fallback stands', async () => {
    await boot({});
    await s.write(TEMPLATE, '# {{date}}\n\n## Done\n');
    s.plugin.data.projectNotes = { dailyTemplate: TEMPLATE };
    await A.emit('completion_log_append', { path: DAILY, date: '2026-09-10', heading: '## Done', entry: '- 10:00 Did the thing', template: '## Fallback\n' });
    await s.plugin.transport.drain();
    expect(s.text(DAILY)).toContain('# 2026-09-10');
    expect(s.text(DAILY)).toContain('## Done\n- 10:00 Did the thing');
    // No template note configured: the app's text template, subset filled.
    s.plugin.data.projectNotes = {};
    const OTHER = 'Daily/2026-09-11.md';
    await A.emit('completion_log_append', { path: OTHER, date: '2026-09-11', heading: '## Done', entry: '- 11:00 Another', template: '# {{date}} fallback\n' });
    await s.plugin.transport.drain();
    expect(s.text(OTHER)).toContain('# 2026-09-11 fallback');
  });

  it('10. an INTERACTIVE template: without Templater\'s on-create trigger the subset leaves the call visible; with the trigger on it is refused, the fallback stands, and the settings tab says why', async () => {
    await boot({});
    await s.write(TEMPLATE, '# {{date}}\n<% tp.system.prompt("Mood?") %>\n\n## Tasks\n');
    s.plugin.data.projectNotes = { dailyTemplate: TEMPLATE };
    await A.emit('task_append', appendFields);
    await s.plugin.transport.drain();
    expect(s.text(DAILY)).toContain('<% tp.system.prompt("Mood?") %>'); // inert residue, Templater\'s own on-create behavior
    expect(s.plugin.transport.templateStatus()).toBeNull();

    // THE SECOND DOOR: the trigger renders every new file itself.
    s.plugin.app.localStorageData.set('templater-local-settings', JSON.stringify({ trigger_on_file_creation: true }));
    const D2 = 'Daily/2026-09-12.md';
    await A.emit('task_append', { ...appendFields, path: D2, date: '2026-09-12', task: { ...appendFields.task, date: '2026-09-12' } });
    await s.plugin.transport.drain();
    const text = s.text(D2)!;
    expect(text).not.toContain('tp.system');
    expect(text).toContain('## Fallback');
    expect(text).toMatch(/- \[ \] Water the plants #obsidian \^dg-abc12345/);
    expect(s.plugin.transport.templateStatus()).toMatch(/asks for input/);

    // The fallback text gets the same pre-scan under the trigger.
    const D3 = 'Daily/2026-09-13.md';
    await A.emit('task_append', { ...appendFields, path: D3, date: '2026-09-13', task: { ...appendFields.task, date: '2026-09-13' }, template: '<% tp.system.suggester(["a"],["a"]) %>\n' });
    await s.plugin.transport.drain();
    expect(s.text(D3)).not.toContain('tp.system');
    expect(s.text(D3)).toMatch(/- \[ \] Water the plants/);
  });

  it('11. Templater installed: a non-interactive template is delegated (with the trigger on too: the second pass has nothing left to render); an interactive one never reaches it', async () => {
    await boot({});
    const fake = templaterFake();
    s.plugin.app.plugins.plugins['templater-obsidian'] = fake;
    await s.write(TEMPLATE, '# <% tp.date.now() %>\n\n## Tasks\n');
    s.plugin.data.projectNotes = { dailyTemplate: TEMPLATE };
    await A.emit('task_append', appendFields);
    await s.plugin.transport.drain();
    expect(fake.templater.read_and_parse_template).toHaveBeenCalledTimes(1);
    expect(fake.templater.create_running_config.mock.calls[0][2]).toBe(0); // RunMode.CreateNewFromTemplate
    expect(s.text(DAILY)).toContain('# Rendered by Templater for 2026-09-10');
    expect(s.text(DAILY)).toMatch(/## Tasks\n- \[ \] Water the plants #obsidian \^dg-abc12345/);

    (fake as { settings?: Record<string, unknown> }).settings = { trigger_on_file_creation: true }; // the pre-2.21 synced form of the trigger
    const D2 = 'Daily/2026-09-12.md';
    await A.emit('task_append', { ...appendFields, path: D2, date: '2026-09-12', task: { ...appendFields.task, date: '2026-09-12' } });
    await s.plugin.transport.drain();
    expect(fake.templater.read_and_parse_template).toHaveBeenCalledTimes(2);
    expect(s.text(D2)).toContain('# Rendered by Templater for 2026-09-12');

    await s.write(TEMPLATE, '<% tp.system.prompt("x") %>\n');
    const D3 = 'Daily/2026-09-13.md';
    await A.emit('task_append', { ...appendFields, path: D3, date: '2026-09-13', task: { ...appendFields.task, date: '2026-09-13' } });
    await s.plugin.transport.drain();
    expect(fake.templater.read_and_parse_template).toHaveBeenCalledTimes(2); // never delegated
    expect(s.text(D3)).toContain('## Fallback');
  });
});
