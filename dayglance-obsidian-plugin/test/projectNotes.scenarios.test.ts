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
const { noteTextHash, bridgeNoteDescriptionLoader, importBridgeSubkey, openBridgeEnvelope, BRIDGE_VAULT_APP, BRIDGE_INTENT_PREFIX } = await import('@glance-apps/obsidian-format');
const { readWikiNote } = await import('../../src/obsidian.js');
const { topProjectOrder, sendToBottomIds, applyProjectReorder, sortByProjectOrder } = await import('../../src/utils/projectOrder.js');
const { readRetiredTaskIds } = await import('../../src/utils/retiredTaskIds.js');
const { buildMcpReadState, handleMcpRequest } = await import('@glance-apps/dayglance-mcp/model');
const { enrichGoalTreeDescriptions, splitDescriptionWrite, writeLinkedDescription } = await import('../../src/utils/mcpNoteDescriptions.js');

type Row = Record<string, any>;

/** `folder: false` is a device that cannot read the vault folder: no handle, so no Obsidian cycle runs and no posture is recorded (a phone paired through GLANCEvault). */
function mountDevice(name: string, lists: { projects?: Row[]; goals?: Row[] } = {}, { folder = true }: { folder?: boolean } = {}) {
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
    obsidianVaultHandleRef: { current: folder ? {} : null }, obsidianSyncInProgressRef: { current: false }, obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: tasksRef, obsidianInboxRef: inboxRef,
    recycleBin: state.recycleBin, setRecycleBin: vi.fn(),
    projects: state.projects, goals: state.goals, updateProject, updateGoal,
  });
  const myEffects = [...effects];
  if (folder) api.bridgeHeartbeatRef.current = { obsidianRunning: true, pluginAuthoritative: true };
  return {
    name, state, api, store, run,
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
  // The applier lease claimed on the first drain settles before any scenario
  // emits (ONE APPLIER PER VAULT, scope scenario 22).
  await s.advance(2500);
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

  it('5b. PLANNER "Send to bottom" (2026-10-11): a quick-add to a linked project is re-ided by the writeback; the offer still finds it through the retired-id record and moves it last, and the order survives the round trip', async () => {
    await bootLinked();
    const inboxOf = () => A.state.inbox.filter((t) => t.projectId === 'p1' && !t.archived);
    A.add({ title: 'First', projectId: 'p1', projectOrder: 0 });
    A.add({ title: 'Second', projectId: 'p1', projectOrder: 10 });
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    // The planner's quick-add: a random id, at the top.
    const addedId = A.add({ title: 'Fresh', projectId: 'p1', projectOrder: topProjectOrder(inboxOf()) });
    expect(sortByProjectOrder(inboxOf())[0].id).toBe(addedId);
    // The writeback lands it in the note and swaps its id while the offer is showing.
    await A.writeback();
    await s.plugin.transport.drain();
    expect(A.all().find((t) => t.id === addedId)).toBeUndefined();
    const fresh = A.all().find((t) => t.title.startsWith('Fresh'))!;
    expect(fresh.id).toMatch(/^obsidian-dg-/);
    // The click, as the planner makes it.
    (globalThis as any).localStorage = { getItem: (k: string) => A.store.get(k) ?? null };
    const ids = sendToBottomIds(inboxOf(), addedId, readRetiredTaskIds());
    expect(ids).not.toBeNull();
    A.state.inbox.splice(0, A.state.inbox.length, ...applyProjectReorder(A.state.inbox, ids!));
    const order = () => sortByProjectOrder(inboxOf()).map((t) => t.title.replace(/ #obsidian$/, ''));
    expect(order()).toEqual(['First', 'Second', 'Fresh']);
    // The order is the app's: the next observation round trip keeps it.
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    expect(order()).toEqual(['First', 'Second', 'Fresh']);
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
  it('8b. A BARE NAME ON A LINK REQUEST (2026-10-04): [[House]] typed on a device without the plugin is stored folder-less; the plugin resolves it as Obsidian resolves a link, keys the note in its folder, and the report moves the locator to the real path; a bare name nothing matches, and a folder path to nothing, come back as missing', async () => {
    const house = { id: 'p1', title: 'House', status: 'active' };
    const attic = { id: 'p2', title: 'Attic', status: 'active' };
    const shed = { id: 'p3', title: 'Shed', status: 'active' };
    await boot({ projects: [house, attic, shed] });
    await s.write(NOTE, '---\ntags: [hub]\n---\n# House\nMy own hub paragraph.\n');
    await s.settle();
    expect(A.api.linkProjectNote('project', 'p1', '[[House]]')).toBe(true);
    expect(house.obsidianNotePath).toBe('House.md');
    expect(A.api.linkProjectNote('project', 'p2', '[[Attic]]')).toBe(true);
    expect(A.api.linkProjectNote('project', 'p3', '[[Projects/Shed]]')).toBe(true);
    await A.flush();
    await s.plugin.transport.drain();
    await s.advance(3000);
    await A.sync();
    expect(frontmatterOf(NOTE)['dayglance-id']).toBe('p1');
    expect(frontmatterOf(NOTE).tags).toEqual(['hub']);
    expect(s.text('House.md')).toBeNull();
    expect(s.plugin.transport.linkedNotes().get(NOTE)).toBe('p1');
    expect(house.obsidianNotePath).toBe(NOTE);
    expect(house.obsidianNoteMissingAt ?? null).toBeNull();
    // Nothing anywhere is called Attic; Projects/Shed does not exist: ruling F for both, paths kept for a relink.
    expect(attic.obsidianNotePath).toBe('Attic.md');
    expect(attic.obsidianNoteMissingAt).toBeTruthy();
    expect(shed.obsidianNotePath).toBe('Projects/Shed.md');
    expect(shed.obsidianNoteMissingAt).toBeTruthy();
    // MUTATION: drop the resolution in applyLinkIntent and House is marked
    // missing like the others, the key written nowhere.
  });

  it('12. notes typed on a placed project task become a note in the project folder, linked from the line; the record empties; a same-title task gets its own suffixed note; a second pass writes nothing', async () => {
    await bootLinked();
    A.add({ title: 'Fix the gutter', projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    const first = A.all().find((t) => t.title.startsWith('Fix the gutter'))!;
    expect(first.id).toMatch(/^obsidian-dg-/);
    // The notes, typed in dayGLANCE (the panel's save), migrate on the next pass.
    A.patch(first.id, { notes: 'Call the roofer first' });
    await A.writeback();
    await s.plugin.transport.drain();
    const TASK_NOTE = 'Projects/Fix the gutter.md';
    expect(s.text(TASK_NOTE)).toMatch(/^---\n/);
    expect(s.text(TASK_NOTE)).toContain('Call the roofer first');
    expect(s.text(NOTE)).toMatch(/- \[ \] Fix the gutter \[\[Projects\/Fix the gutter\]\] \^dg-[a-z0-9]{8}/);
    const migrated = A.all().find((t) => t.id === first.id)!;
    expect(migrated.title).toBe('Fix the gutter [[Projects/Fix the gutter]] #obsidian');
    expect(migrated.notes).toBe('');
    // The observation round trip keeps the link in the title and the record empty.
    await s.settle();
    await A.sync();
    const observed = A.all().find((t) => t.id === first.id)!;
    expect(observed.title).toBe('Fix the gutter [[Projects/Fix the gutter]] #obsidian');
    expect(observed.notes ?? '').toBe('');
    const writes = s.plugin.app.vault.writes;
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
    // A second task with the same title: its own note, suffixed, never appended to the first.
    A.add({ title: 'Fix the gutter', projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    const second = A.all().find((t) => t.id !== first.id && t.title.startsWith('Fix the gutter'))!;
    A.patch(second.id, { notes: 'The other gutter' });
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text('Projects/Fix the gutter 2.md')).toContain('The other gutter');
    expect(s.text(TASK_NOTE)).not.toContain('The other gutter');
    expect(A.all().find((t) => t.id === second.id)!.title).toBe('Fix the gutter [[Projects/Fix the gutter 2]] #obsidian');
  });
  it('13. THE RE-APPEND (owner ruling 2026-09-16): a line wiped from the note comes back for a task whose record is newer than the wipe; an untouched task follows the vault and is dropped', async () => {
    await bootLinked();
    A.add({ title: 'Survivor', projectId: 'p1' });
    A.add({ title: 'Follower', projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    const survivor = A.all().find((t) => t.title.startsWith('Survivor'))!;
    const follower = A.all().find((t) => t.title.startsWith('Follower'))!;
    expect(s.text(NOTE)).toMatch(lineFor('Survivor'));
    // The 2026-09-13 shape: a merge on another machine replaced the section body; both lines are gone.
    await s.write(NOTE, s.text(NOTE)!.split('\n').filter((l) => !l.includes('Survivor') && !l.includes('Follower')).join('\n'));
    await s.settle();
    await A.sync(); // candidates pended, the wall-clock hold running
    expect(A.all().map((t) => t.id).sort()).toEqual([follower.id, survivor.id].sort());
    await s.advance(5_000);
    A.patch(survivor.id, { color: 'bg-orange-500' }); // an app edit newer than the wipe
    await s.advance(95_000);
    await A.sync(); // the hold commits: tombstones stamped at the note's mtime
    expect(A.all().find((t) => t.id === follower.id)).toBeUndefined(); // the vault owns existence
    expect(A.all().find((t) => t.id === survivor.id)).toBeDefined();   // the record won
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toMatch(lineFor('Survivor'));
    expect(s.text(NOTE)).toContain(`^dg-${survivor.obsidianBlockId}`);
    expect(s.text(NOTE)).not.toContain('Follower');
    // Once per wipe: a second pass writes nothing.
    const writes = s.plugin.app.vault.writes;
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
    // The line's observation re-admits it under the same id, app fields intact, and settles.
    await s.settle();
    await A.sync();
    expect(A.all().filter((t) => t.title.startsWith('Survivor')).map((t) => t.id)).toEqual([survivor.id]);
    expect(A.all().find((t) => t.id === survivor.id)).toMatchObject({ color: 'bg-orange-500', projectId: 'p1', obsidianNotePath: NOTE });
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
  });
  it('14. LINKED-TASK NOTES (option B, 2026-09-17): notes on a task whose own note is linked are appended to it, the field clears, the body is journaled; a second pass writes nothing; the same body again is not appended twice', async () => {
    await bootLinked();
    A.add({ title: 'Gutter', projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    const id = A.all().find((t) => t.title.startsWith('Gutter'))!.id;
    A.patch(id, { notes: 'first' });
    await A.writeback();
    await s.plugin.transport.drain(); // the fresh migration: note created, link in the title, target stored
    expect(A.all().find((t) => t.id === id)).toMatchObject({ obsidianNoteTarget: 'Projects/Gutter', notes: '' });
    await s.settle();
    await A.sync(); // the line observed carrying the link
    expect(A.all().find((t) => t.id === id)).toMatchObject({ obsidianNoteLinkSeen: true, title: 'Gutter [[Projects/Gutter]] #obsidian' });
    A.patch(id, { notes: 'second' });
    await A.writeback();
    await s.plugin.transport.drain(); // the append
    expect(s.text('Projects/Gutter.md')).toContain('first');
    expect(s.text('Projects/Gutter.md')).toContain('second');
    expect(A.all().find((t) => t.id === id)!.notes).toBe('');
    expect(JSON.parse(A.store.get('day-planner-obsidian-notes-sent')!)[id]).toMatchObject({ target: 'Projects/Gutter', body: 'second' });
    const writes = s.plugin.app.vault.writes;
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
    // The same body again: the block guard skips it, the field still clears.
    A.patch(id, { notes: 'second' });
    await A.writeback();
    await s.plugin.transport.drain();
    expect((s.text('Projects/Gutter.md')!.match(/second/g) ?? []).length).toBe(1);
    expect(A.all().find((t) => t.id === id)!.notes).toBe('');
  });

  it('15. a hand-linked task keeps its notes local: nothing is written, the shared note is untouched', async () => {
    await bootLinked();
    await s.write('Shared doc.md', 'shared body\n');
    A.add({ title: 'Setup [[Shared doc]]', projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    const id = A.all().find((t) => t.title.startsWith('Setup'))!.id;
    A.patch(id, { notes: 'local text' });
    const writes = s.plugin.app.vault.writes;
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
    expect(s.text('Shared doc.md')).toBe('shared body\n');
    const t = A.all().find((x) => x.id === id)!;
    expect(t.notes).toBe('local text');
    expect(t.obsidianNoteTarget).toBeUndefined();
  });

  it('16. a fresh migration whose derived-name file already exists appends into it (option D), adds the link and stores the target', async () => {
    await bootLinked();
    await s.write('Projects/Fence.md', '# Fence\n\nOwner text.\n');
    A.add({ title: 'Fence', projectId: 'p1', notes: 'gate hinge' });
    await A.writeback();
    await s.plugin.transport.drain(); // placement
    await A.writeback();
    await s.plugin.transport.drain(); // migration
    expect(s.text('Projects/Fence.md')).toBe('# Fence\n\nOwner text.\n\ngate hinge\n');
    expect(A.all().find((x) => x.title.startsWith('Fence'))).toMatchObject({ title: 'Fence [[Projects/Fence]] #obsidian', notes: '', obsidianNoteTarget: 'Projects/Fence' });
  });

  it('17. THE RE-ASSERT: a retitle the line guard refused (an Obsidian edit before the line was observed) is put back once from the stored target; the next observation marks the link seen', async () => {
    await bootLinked();
    A.add({ title: 'Epsilon', projectId: 'p1', notes: 'eps notes' });
    await A.writeback();
    await s.plugin.transport.drain(); // placement, not yet observed
    await s.write(NOTE, s.text(NOTE)!.replace('Epsilon ^', 'Epsilon edited ^'));
    await A.writeback();
    await s.plugin.transport.drain(); // migration: the note is written, the retitle is refused by the guard
    expect(s.text('Projects/Epsilon.md')).toContain('eps notes');
    expect(s.text(NOTE)).not.toContain('[[Projects/Epsilon]]');
    await s.settle();
    await A.sync(); // the vault's title wins: the link is gone from the app, the target stays
    const mid = A.all().find((x) => x.title.startsWith('Epsilon'))!;
    expect(mid).toMatchObject({ title: 'Epsilon edited #obsidian', obsidianNoteTarget: 'Projects/Epsilon', notes: '' });
    expect(mid.obsidianNoteLinkSeen).toBeFalsy();
    await A.writeback();
    await s.plugin.transport.drain(); // the re-assert, on the line's own base
    expect(s.text(NOTE)).toMatch(/- \[ \] Epsilon edited \[\[Projects\/Epsilon\]\] \^dg-/);
    await s.settle();
    await A.sync();
    expect(A.all().find((x) => x.title.startsWith('Epsilon'))).toMatchObject({ title: 'Epsilon edited [[Projects/Epsilon]] #obsidian', obsidianNoteLinkSeen: true });
    const writes = s.plugin.app.vault.writes;
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
  });

  it('18. the user removes the link in Obsidian after it was seen: the record forgets its note and nothing re-asserts', async () => {
    await bootLinked();
    A.add({ title: 'Hedge', projectId: 'p1', notes: 'trim' });
    await A.writeback();
    await s.plugin.transport.drain();
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    const id = A.all().find((x) => x.title.startsWith('Hedge'))!.id;
    expect(A.all().find((x) => x.id === id)).toMatchObject({ obsidianNoteLinkSeen: true });
    await s.write(NOTE, s.text(NOTE)!.replace(' [[Projects/Hedge]]', ''));
    await s.settle();
    await A.sync();
    const t = A.all().find((x) => x.id === id)!;
    expect(t.title).toBe('Hedge #obsidian');
    expect(t.obsidianNoteTarget).toBeNull();
    const writes = s.plugin.app.vault.writes;
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
    expect(s.text(NOTE)).not.toContain('[[Projects/Hedge]]');
  });

  it('19. the user removes the link in dayGLANCE: the record forgets its note and the line follows', async () => {
    await bootLinked();
    A.add({ title: 'Path', projectId: 'p1', notes: 'gravel' });
    await A.writeback();
    await s.plugin.transport.drain();
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    const id = A.all().find((x) => x.title.startsWith('Path'))!.id;
    A.patch(id, { title: 'Path #obsidian' });
    await A.writeback();
    await s.plugin.transport.drain();
    expect(A.all().find((x) => x.id === id)!.obsidianNoteTarget).toBeNull();
    expect(s.text(NOTE)).toMatch(/- \[ \] Path \^dg-/);
  });

  it('20. create with notes in one call, inbox and scheduled: the note is created, the link lands on the line, the target is stored and seen', async () => {
    await bootLinked();
    A.add({ title: 'Iota', projectId: 'p1', notes: 'iota notes' });
    A.add({ title: 'Kappa', projectId: 'p1', notes: 'kappa notes', date: '2026-09-06', startTime: '10:00', duration: 30 });
    await A.writeback();
    await s.plugin.transport.drain();
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    expect(s.text(NOTE)).toMatch(/- \[ \] Iota \[\[Projects\/Iota\]\] \^dg-/);
    expect(s.text(NOTE)).toMatch(/- \[ \] 10:00-10:30 Kappa \[\[Projects\/Kappa\]\] \[scheduled:: 2026-09-06\] \^dg-/);
    expect(s.text('Projects/Iota.md')).toContain('iota notes');
    expect(s.text('Projects/Kappa.md')).toContain('kappa notes');
    for (const name of ['Iota', 'Kappa']) {
      expect(A.all().find((x) => x.title.startsWith(name))).toMatchObject({ notes: '', obsidianNoteTarget: `Projects/${name}`, obsidianNoteLinkSeen: true });
    }
  });
  it('21. THE LATE-OBSERVATION GATE FOR PROJECT NOTES (2026-09-17): a stale follower report with the old title does not revert a dayGLANCE retitle; a genuinely newer Obsidian edit still wins', async () => {
    await bootLinked();
    A.add({ title: 'Lawn', projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    const id = A.all().find((t) => t.title.startsWith('Lawn'))!.id;
    A.patch(id, { title: 'Lawn mowed #obsidian' });
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    expect(A.all().find((t) => t.id === id)!.title).toBe('Lawn mowed #obsidian');
    const applied = JSON.parse(A.store.get('dayglance-obsidian-last-applied-mtime')!)[NOTE];
    expect(typeof applied).toBe('string');
    // A lagging plugin copy reports the OLD line under the old version's mtime.
    await s.write(NOTE, s.text(NOTE)!.replace('Lawn mowed ^', 'Lawn ^'));
    s.file(NOTE).stat.mtime = Date.parse(applied) - 60_000;
    const info = vi.spyOn(console, 'info');
    await s.settle();
    await A.sync();
    expect(info.mock.calls.some((c) => String(c[0]).includes('late observation skipped'))).toBe(true);
    info.mockRestore();
    expect(A.all().find((t) => t.id === id)!.title).toBe('Lawn mowed #obsidian');
    expect(JSON.parse(A.store.get('dayglance-obsidian-last-applied-mtime')!)[NOTE]).toBe(applied);
    // A genuinely newer edit in Obsidian still wins the title.
    await s.advance(5_000);
    await s.write(NOTE, s.text(NOTE)!.replace('Lawn ^', 'Lawn trimmed ^'));
    await s.settle();
    await A.sync();
    expect(A.all().find((t) => t.id === id)!.title).toBe('Lawn trimmed #obsidian');
  });

  it('22. THE NOTES BOX AT CREATION (owner ruling 2026-10-03): the box rides the create intent into the description slot; the record empties on enqueue; the journal holds the text', async () => {
    const project = { id: 'p1', title: 'House', status: 'active', description: 'Dry roof by spring.' };
    await boot({ projects: [project] });
    expect(A.api.createProjectNote('project', 'p1', { title: 'House', description: project.description })).toBe(true);
    expect(project.description).toBe('');
    expect(JSON.parse(A.store.get('day-planner-obsidian-notes-sent')!)['project:p1']).toMatchObject({ body: 'Dry roof by spring.' });
    await A.flush();
    await s.plugin.transport.drain();
    await s.advance(3000);
    await A.sync();
    expect(project.obsidianNotePath).toBe(NOTE);
    const text = s.text(NOTE)!;
    expect(text).toContain('# House\nDry roof by spring.\n\n## Tasks\n');
    expect(text).not.toContain('One line on what done looks like.');
  });

  it('23. THE MIGRATION ON LINK: a box filled on a linked project moves into the section below the note\'s own text, once; the record empties; a second pass writes nothing', async () => {
    const project = await bootLinked();
    // The user wrote their own hub paragraph in Obsidian, and typed a summary in the box.
    await s.write(NOTE, s.text(NOTE)!.replace('One line on what done looks like.', 'My own hub paragraph.'));
    await s.settle();
    project.description = 'Purpose: keep the house dry.';
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toContain('# House\nMy own hub paragraph.\n\nPurpose: keep the house dry.\n\n## Tasks\n');
    expect(project.description).toBe('');
    expect(JSON.parse(A.store.get('day-planner-obsidian-notes-sent')!)['project:p1']).toMatchObject({ target: NOTE, body: 'Purpose: keep the house dry.' });
    // MUTATION: drop the record clear and every pass re-sends the box; drop
    // the block guard in mergeNoteDescription and a re-send doubles it.
    const writes = s.plugin.app.vault.writes;
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
    expect(s.text(NOTE)!.split('Purpose: keep the house dry.').length).toBe(2);
  });

  it('24. THE EDITOR OVER THE SECTION: a save with the section\'s base replaces exactly the section; one whose base the section no longer matches keeps the vault\'s text and adds the dayGLANCE text as a dated callout; the task list is never touched', async () => {
    await bootLinked();
    A.add({ title: 'Fix the gutter', projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    const line = s.text(NOTE)!.match(lineFor('Fix the gutter'))![0];
    const base = noteTextHash('One line on what done looks like.');
    // This device's folder read finds nothing (readWikiNote is stubbed), so
    // the app-side re-read is the plugin's report of the note (#2291), and
    // the intent goes out with the base; the applier's check decides.
    await A.api.saveNoteDescription('project', 'p1', NOTE, 'Dry roof, and gutters.', { base });
    await A.flush();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toContain('# House\nDry roof, and gutters.\n\n## Tasks\n');
    expect(s.text(NOTE)).toContain(line);
    await s.settle();
    // Obsidian edits the section and dayGLANCE saves against the old base
    // before the plugin has reported the edit (the race of seconds): the
    // app-side check passes on the last report, the applier's refuses.
    // (Scenario 27 has the app-side refusal, once the edit is reported.)
    await s.write(NOTE, s.text(NOTE)!.replace('Dry roof, and gutters.', 'Edited in Obsidian.'));
    await A.api.saveNoteDescription('project', 'p1', NOTE, 'Typed in dayGLANCE.', { base: noteTextHash('Dry roof, and gutters.') });
    await A.flush();
    await s.plugin.transport.drain();
    const text = s.text(NOTE)!;
    expect(text).toContain('# House\nEdited in Obsidian.\n\n> [!note] Edited in dayGLANCE ');
    expect(text).toContain('\n> Typed in dayGLANCE.\n\n## Tasks\n');
    expect(text).not.toContain('Dry roof, and gutters.');
    expect(text).toContain(line);
    // MUTATION: drop the base check in the applier and 'Edited in Obsidian.'
    // is overwritten; drop the callout and the dayGLANCE text is gone.
  });

  it('25. THE LINK TAKEN WITHOUT THE PLUGIN (owner 2026-10-03: a wikilink in the title): the record names its note, marked pending; the first authoritative pass asks for the key, the note gains it, the mark clears, the box moves in; a pending link to a note that is not there comes back as missing', async () => {
    // Daniel's case: a hub note he wrote himself, a project linked to it by
    // typing its wikilink into the title on a device with no plugin, and a
    // summary in the notes box. Then he installs the plugin.
    await s.write(NOTE, '---\ntags: [hub]\n---\n# House\nMy own hub paragraph.\n\n## Links\n- [[Roof quotes]]\n');
    const house = { id: 'p1', title: 'House', status: 'active', obsidianNotePath: NOTE, obsidianNoteLinkPending: '2026-10-01T09:00:00.000Z', description: 'Purpose: keep the house dry.' };
    const attic = { id: 'p2', title: 'Attic', status: 'active', obsidianNotePath: 'Projects/Attic.md', obsidianNoteLinkPending: '2026-10-01T09:00:00.000Z' };
    await boot({ projects: [house, attic] });
    expect(frontmatterOf(NOTE)['dayglance-id']).toBeUndefined();
    await A.writeback();
    // The mark clears on enqueue, before any word comes back from the vault.
    expect(house.obsidianNoteLinkPending).toBe(null);
    expect(attic.obsidianNoteLinkPending).toBe(null);
    await s.plugin.transport.drain();
    await s.advance(3000);
    await A.sync();
    // The key is in the note; the user's own frontmatter and text survive; the box sits below the paragraph.
    expect(frontmatterOf(NOTE)['dayglance-id']).toBe('p1');
    expect(frontmatterOf(NOTE).tags).toEqual(['hub']);
    expect(s.text(NOTE)).toContain('# House\nMy own hub paragraph.\n\nPurpose: keep the house dry.\n\n## Links\n- [[Roof quotes]]\n');
    expect(s.plugin.transport.linkedNotes().get(NOTE)).toBe('p1');
    expect(house.obsidianNoteLinkPending).toBe(null);
    expect(house.obsidianNotePath).toBe(NOTE);
    expect(house.description).toBe('');
    // The note Attic named does not exist: ruling F, the record learns it is missing and keeps the path for a relink.
    expect(attic.obsidianNoteLinkPending).toBe(null);
    expect(attic.obsidianNotePath).toBe('Projects/Attic.md');
    expect(attic.obsidianNoteMissingAt).toBeTruthy();
    // A second pass asks for nothing again.
    const writes = s.plugin.app.vault.writes;
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.plugin.app.vault.writes).toBe(writes);
    // MUTATION: drop the pending branch and the key never arrives; drop the
    // clear on enqueue and the mark outlives the enqueue (the plugin's own
    // report clears it later, so the second-pass check alone would not see
    // it).
  });

  it('26. THE SECTION FROM THE STREAM (#2280, #2291): a reader with no vault folder reads a linked note\'s description from the plugin\'s own report of it and gets what the app\'s file loader gets, text and base; an edit reaches it when the plugin reports; a deletion reads as not found', async () => {
    const project = await bootLinked();
    await s.write(NOTE, s.text(NOTE)!.replace('One line on what done looks like.', 'Keep the roof dry.'));
    await s.settle();
    const subkey = await importBridgeSubkey(s.pairing.subkeyB64);
    const fromStream = async (path: string): Promise<any> => (await bridgeNoteDescriptionLoader(s.vault.all(BRIDGE_VAULT_APP), { subkey }))(path);
    // The app's loader over the file itself: the harness stubs readWikiNote,
    // so this one read is fed the vault's text.
    vi.mocked(readWikiNote).mockImplementationOnce(async (_handle: unknown, name: string) => ({ text: s.text(`${name}.md`), lastModified: null }) as any);
    const fromFile: any = await A.api.loadNoteDescription(project.obsidianNotePath);
    const streamed = await fromStream(project.obsidianNotePath);
    expect(fromFile.text).toBe('Keep the roof dry.');
    expect({ text: streamed.text, base: streamed.base }).toEqual({ text: fromFile.text, base: fromFile.base });
    // As current as the plugin's last report: an edit not yet reported is not seen, and is once it is.
    await s.write(NOTE, s.text(NOTE)!.replace('Keep the roof dry.', 'Gutters first.'));
    expect((await fromStream(NOTE)).text).toBe('Keep the roof dry.');
    await s.settle();
    expect(await fromStream(NOTE)).toMatchObject({ text: 'Gutters first.', base: noteTextHash('Gutters first.') });
    // Deleted in Obsidian: the plugin's report replaces the row, and the reader says not found.
    await s.plugin.app.vault.delete(s.file(NOTE));
    await s.settle();
    expect(await fromStream(NOTE)).toEqual({ notFound: true });
    // MUTATION: ignore the deleted flag and the last expectation fails. (The
    // plugin upserts one row per path, so latest-wins across several copies
    // is pinned in noteObservations.test.js, where a reader holds more.)
  });

  it('27. THE PLANNER WITHOUT THE FOLDER (#2291): a device that cannot read the vault shows the section the plugin reported, with its age; an edit in Obsidian reaches it when reported; its save goes out as the replace intent under the base of the text it showed and the plugin applies it; a reported edit since is refused here; a copy that is behind gives way to a newer report; a deletion is not found; a note never reported stays no information', async () => {
    const project = await bootLinked();
    await s.write(NOTE, s.text(NOTE)!.replace('One line on what done looks like.', 'Keep the roof dry.'));
    await s.settle();
    // The phone: paired through GLANCEvault, no vault folder, no Obsidian cycle.
    const B = mountDevice('B', { projects: [{ ...project }] }, { folder: false });
    // Reads of the report are awaited in real time, not through `until`: the
    // read has a time budget (REPORTED_NOTE_READ_BUDGET_MS), and fake time
    // stepped ahead of the real crypto would spend it.
    const load = (path = NOTE): Promise<any> => B.run(() => B.api.loadNoteDescription(path));
    const shown = await load();
    expect(shown).toMatchObject({ text: 'Keep the roof dry.', base: noteTextHash('Keep the roof dry.'), source: 'report' });
    // Its age, for the box: when the plugin reported it, and the file's own time.
    expect(Date.parse(shown.observedAt)).toBeGreaterThan(0);
    expect(Date.parse(shown.lastModified)).toBeGreaterThan(0);

    // An edit in Obsidian reaches the phone when the plugin reports it, not before.
    await s.write(NOTE, s.text(NOTE)!.replace('Keep the roof dry.', 'Gutters first.'));
    expect((await load()).text).toBe('Keep the roof dry.');
    await s.settle();
    const reported = await load();
    expect(reported).toMatchObject({ text: 'Gutters first.', base: noteTextHash('Gutters first.'), source: 'report' });

    // The save: a replace intent under the base of the SHOWN text, applied by the plugin.
    const subkey = await importBridgeSubkey(s.pairing.subkeyB64);
    const saved = await B.run(() => B.api.saveNoteDescription('project', 'p1', NOTE, 'Typed on the phone.', { base: reported.base }));
    expect(saved).toEqual({ ok: true, mode: 'queued' });
    await B.flush();
    const intents: any[] = [];
    for (const row of s.vault.live(BRIDGE_VAULT_APP)) {
      if (!row.entityId.startsWith(BRIDGE_INTENT_PREFIX) || !row.envelope) continue;
      const payload: any = await openBridgeEnvelope(subkey, row.envelope);
      if (payload?.type === 'project_note_description') intents.push(payload);
    }
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ path: NOTE, targetId: 'p1', content: 'Typed on the phone.', mode: 'replace', base: noteTextHash('Gutters first.') });
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toContain('# House\nTyped on the phone.\n\n## Tasks\n');
    expect(s.text(NOTE)).not.toContain('[!note] Edited in dayGLANCE');
    await s.settle();
    expect((await load()).text).toBe('Typed on the phone.');

    // Edited in Obsidian and reported since the phone loaded it: refused here, nothing queued, the newer text handed back.
    await s.write(NOTE, s.text(NOTE)!.replace('Typed on the phone.', 'Edited again in Obsidian.'));
    await s.settle();
    const before = s.vault.maxSeq;
    const refused = await B.run(() => B.api.saveNoteDescription('project', 'p1', NOTE, 'Stale edit.', { base: noteTextHash('Typed on the phone.') }));
    expect(refused).toMatchObject({ refused: 'changed', text: 'Edited again in Obsidian.', source: 'report' });
    await B.flush();
    expect(s.vault.maxSeq).toBe(before);

    // A device WITH a folder whose copy is behind (holding: Obsidian is not
    // running there): the report is newer, file mtime to file mtime, so it wins.
    const reportNow: any = await load();
    const reportMs = Date.parse(reportNow.lastModified);
    const staleCopy = (lastModifiedMs: number) => vi.mocked(readWikiNote).mockImplementationOnce(async () => ({ text: '# House\nStale copy here.\n\n## Tasks\n', lastModified: new Date(lastModifiedMs).toISOString() }) as any);
    staleCopy(reportMs - 60_000);
    expect(await A.run(() => A.api.loadNoteDescription(NOTE))).toMatchObject({ text: 'Edited again in Obsidian.', source: 'report' });
    // A copy newer than the report (edited here since) is the one shown.
    staleCopy(reportMs + 60_000);
    const fromFile: any = await A.run(() => A.api.loadNoteDescription(NOTE));
    expect(fromFile).toMatchObject({ text: 'Stale copy here.' });
    expect(fromFile.source).toBeUndefined();

    // Deleted in Obsidian: not found on the phone, and over a copy that still has the note.
    await s.plugin.app.vault.delete(s.file(NOTE));
    await s.settle();
    expect(await load()).toEqual({ notFound: true });
    staleCopy(Date.now() + 60_000);
    expect(await A.run(() => A.api.loadNoteDescription(NOTE))).toEqual({ notFound: true });

    // A note the plugin never reported: no information, never "not found".
    expect(await load('Projects/Never reported.md')).toBeNull();
    // MUTATION (each checked): compare the report's mtime the wrong way and
    // the holding copy shows its stale text; ignore the deleted flag and the
    // phone shows old text; read a missing report as not found and the last
    // expectation fails; carry the user's base instead of checking it against
    // the shown text and the stale edit is queued.
  });

  it('28. THE MCP WITHOUT THE FOLDER (#2291): the desktop server fills a linked goal\'s description through the app\'s loader, so a computer that cannot read the vault answers with the plugin\'s report, its base and when it was reported; a description write through it is queued as the replace intent and the plugin applies it', async () => {
    const GOAL_NOTE = 'Goals/Home.md';
    await boot({ goals: [{ id: 'g1', title: 'Home', status: 'active' }] });
    expect(A.api.createProjectNote('goal', 'g1', { title: 'Home' })).toBe(true);
    await A.flush();
    await s.plugin.transport.drain();
    await s.advance(3000);
    await A.sync();
    const goal = A.state.goals[0];
    expect(goal.obsidianNotePath).toBe(GOAL_NOTE);
    await s.write(GOAL_NOTE, s.text(GOAL_NOTE)!.replace(/^# Home\n[^#]*/m, '# Home\nA dry, warm house.\n\n'));
    await s.settle();

    const B = mountDevice('B', { goals: [{ ...goal }] }, { folder: false });
    const notes = { loadNoteDescription: B.api.loadNoteDescription, saveNoteDescription: B.api.saveNoteDescription, noteWriteMode: () => 'written' };
    const state = buildMcpReadState({ goals: B.state.goals, projects: [] }, { now: Date.now(), timeZone: 'UTC' });
    const tree = handleMcpRequest(state, { method: 'goal_progress', params: { window: 'all' } });
    expect(tree.ok).toBe(true);
    const out: any = await B.run(() => enrichGoalTreeDescriptions(tree.data, notes));
    const home = out.goals.find((g: Row) => g.id === 'g1');
    expect(home).toMatchObject({ description: 'A dry, warm house.', description_source: 'obsidian_note', description_base: noteTextHash('A dry, warm house.') });
    expect(Date.parse(home.description_reported_at)).toBeGreaterThan(0);

    // The write tool's note half, with the base the read returned.
    const split = splitDescriptionWrite({ goals: B.state.goals, projects: [] }, 'update_goal', { goalId: 'g1', set: { description: 'Warm by winter.', descriptionBase: home.description_base } });
    const wrote: any = await B.run(() => writeLinkedDescription(split, notes));
    expect(wrote).toEqual({ ok: true, text: 'Warm by winter.', mode: 'queued' });
    await B.flush();
    await s.plugin.transport.drain();
    expect(s.text(GOAL_NOTE)).toContain('# Home\nWarm by winter.\n');
    expect(s.text(GOAL_NOTE)).not.toContain('[!note] Edited in dayGLANCE');
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
