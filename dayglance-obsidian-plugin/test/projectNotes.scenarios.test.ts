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
const { flushBridgeOutbox, __resetBridgeStreamForTests } = await import('../../src/utils/obsidianBridgeStream.js');
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
    writeback: () => run(async () => { for (const e of myEffects) if (e.deps?.length === 3) e.fn(); await advanceFake(50); await until(flushBridgeOutbox()); }),
    patch: (id: string, fields: Row) => {
      const bump = (list: Row[]) => list.map((x) => (x.id === id ? { ...x, ...fields, lastModified: new Date().toISOString() } : x));
      setTasks(bump); setUnscheduledTasks(bump);
    },
    all: () => [...state.tasks, ...state.inbox],
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

  it('4. a daily-note task reassigned in dayGLANCE gets the project wikilink on its line; an Obsidian edit of the field reassigns it back', async () => {
    const projects = [{ id: 'p1', title: 'House', status: 'active', obsidianNotePath: 'Projects/House.md' }, { id: 'p2', title: 'Garden', status: 'active' }];
    await boot({ projects });
    await s.write('Daily/2026-09-04.md', '## Tasks\n- [ ] Call the plumber\n');
    for (let i = 0; i < 40; i++) await s.advance(1000);
    await A.sync();
    const task = A.all()[0];
    expect(task.id).toMatch(/^obsidian-dg-/);
    expect(task.projectId).toBeUndefined();

    A.patch(task.id, { projectId: 'p1' });
    await A.writeback();
    await s.plugin.transport.drain();
    // The note's basename equals the title, so the wikilink needs no alias.
    expect(s.text('Daily/2026-09-04.md')).toMatch(/- \[ \] Call the plumber \[project:: \[\[Projects\/House\]\]\] \^dg-/);
    for (let i = 0; i < 40; i++) await s.advance(1000);
    await A.sync();
    expect(A.all()[0].projectId).toBe('p1');
    expect(A.all()[0].title).toBe('Call the plumber #obsidian');

    const edited = s.text('Daily/2026-09-04.md')!.replace('[project:: [[Projects/House]]]', '[project:: Garden]');
    await s.write('Daily/2026-09-04.md', edited);
    for (let i = 0; i < 40; i++) await s.advance(1000);
    await A.sync();
    expect(A.all()[0].projectId).toBe('p2');
  });
});
