// Bridge scenario harness: the vault task scope, end to end (companion §6).
// The real plugin transport stamps and reports a stub vault; the real
// dayGLANCE sync hook consumes the stream through the real bridge modules
// against one in-memory GLANCEvault. These are the field-test steps of
// 2026-09-04, scripted.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const effects: Array<{ fn: () => unknown; deps?: unknown[] }> = [];
vi.mock('react', () => ({
  useEffect: (fn: () => unknown, deps?: unknown[]) => { effects.push({ fn, deps }); },
  useCallback: (fn: unknown) => fn,
  useRef: (init: unknown) => ({ current: init }),
}));
// Direct vault access is OFF on every device: the plugin is authoritative
// for the whole scenario (a fresh, paired heartbeat every cycle).
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
  isNativeAndroid: () => false,
  isNativeApp: () => false,
  nativeGetVaultConfig: vi.fn(() => null),
  nativeGetNote: vi.fn(() => null),
  nativeWriteNote: vi.fn(),
  nativeOpenNote: vi.fn(),
  nativeListNotes: vi.fn(() => []),
  nativeSetVaultSettings: vi.fn(),
  nativeSetLaunchOnWrite: vi.fn(),
}));
vi.mock('../../src/utils/obsidianBridgeMode.js', () => ({
  recordBridgeMode: vi.fn(),
  reconcileArchivedBaseline: vi.fn(() => null),
}));

const { createScenario, VAULT_URL, ACCOUNT_ID, until, advanceFake } = await import('./harness');
const { default: useObsidianSync } = await import('../../src/hooks/useObsidianSync.js');
const { flushBridgeOutbox, __resetBridgeStreamForTests } = await import('../../src/utils/obsidianBridgeStream.js');
const { PROJECT_NOTE_ID_KEY } = await import('@glance-apps/obsidian-format');
void PROJECT_NOTE_ID_KEY;

type Task = Record<string, any>;


/** A dayGLANCE device: its own localStorage and task lists, the real sync hook. */
function mountDevice(name: string) {
  const store = new Map<string, string>();
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
  };
  // The device's storage stays installed until another device runs: the
  // hook fires several fire-and-forget tails (config publish, outbox flush,
  // projection) that outlive the awaited cycle and read localStorage late.
  const activate = () => { (globalThis as any).localStorage = ls; };
  const run = async <T,>(fn: () => Promise<T> | T): Promise<T> => {
    activate();
    const out = await fn();
    await advanceFake(300); // let the cycle's tails land
    return out;
  };

  ls.setItem('dayglance-vault-config', JSON.stringify({ enabled: true, vaultUrl: VAULT_URL, vaultToken: `token-${name}`, accountId: ACCOUNT_ID }));
  const state = { tasks: [] as Task[], inbox: [] as Task[], recycleBin: [] as Task[] };
  const log: string[] = [];
  const tasksRef = { current: state.tasks };
  const inboxRef = { current: state.inbox };
  // In place: the mocked React never re-renders, so the hook's effects keep
  // the arrays they were mounted with (the app re-renders with fresh lists).
  const replace = (arr: Task[], next: Task[]) => { arr.splice(0, arr.length, ...next); };
  const setTasks = (up: Task[] | ((p: Task[]) => Task[])) => { replace(state.tasks, typeof up === 'function' ? up([...state.tasks]) : up); };
  const setUnscheduledTasks = (up: Task[] | ((p: Task[]) => Task[])) => { replace(state.inbox, typeof up === 'function' ? up([...state.inbox]) : up); };
  const setRecycleBin = (up: Task[] | ((p: Task[]) => Task[])) => { state.recycleBin = typeof up === 'function' ? up(state.recycleBin) : up; };
  const syncRef = { current: false };
  const prevRef = { current: {} as Record<string, unknown> };
  effects.length = 0;
  activate();
  const api = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: state.tasks, setTasks,
    unscheduledTasks: state.inbox, setUnscheduledTasks,
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null,
    obsidianCompletionDates: false,
    obsidianSyncError: null,
    setObsidianSyncStatus: (v: unknown) => { log.push(`status:${typeof v === 'function' ? '(fn)' : String(v)}@${Date.now() % 100000}`); },
    setObsidianSyncError: (v: unknown) => { log.push(`error:${typeof v === 'function' ? '(fn)' : String(v)}@${Date.now() % 100000}`); },
    setObsidianLastSynced: vi.fn(),
    setObsidianSyncNotice: (v: unknown) => { log.push(`notice:${JSON.stringify(v)}`); },
    obsidianVaultHandleRef: { current: {} },
    obsidianSyncInProgressRef: syncRef,
    obsidianPrevTaskStateRef: prevRef,
    obsidianTasksRef: tasksRef, obsidianInboxRef: inboxRef,
    recycleBin: state.recycleBin, setRecycleBin,
  });
  const myEffects = [...effects];
  api.bridgeHeartbeatRef.current = { obsidianRunning: true, pluginAuthoritative: true };
  return {
    name, state, api, store, log,
    sync: () => run(() => until(api.performObsidianSync())),
    /** Run the writeback effect against the current lists, then push the outbox to the vault. */
    writeback: () => run(async () => {
      for (const e of myEffects) if (e.deps?.length === 3) e.fn();
      await advanceFake(50);
      await until(flushBridgeOutbox());
    }),
    setTasks, setUnscheduledTasks,
    /** dayGLANCE-side edits, as the UI would make them (fresh lastModified). */
    schedule: (id: string, date: string) => {
      const t = state.inbox.find((x) => x.id === id) ?? state.tasks.find((x) => x.id === id);
      if (!t) throw new Error(`no task ${id}`);
      setUnscheduledTasks((p) => p.filter((x) => x.id !== id));
      setTasks((p) => [...p.filter((x) => x.id !== id), { ...t, date, isAllDay: true, startTime: undefined, lastModified: new Date().toISOString() }]);
    },
    unschedule: (id: string) => {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) throw new Error(`no task ${id}`);
      const { date: _d, isAllDay: _a, startTime: _s, ...rest } = t;
      setTasks((p) => p.filter((x) => x.id !== id));
      setUnscheduledTasks((p) => [...p, { ...rest, lastModified: new Date().toISOString() }]);
    },
    patch: (id: string, fields: Task) => {
      const bump = (list: Task[]) => list.map((x) => (x.id === id ? { ...x, ...fields, lastModified: new Date().toISOString() } : x));
      setTasks(bump); setUnscheduledTasks(bump);
    },
    all: () => [...state.tasks, ...state.inbox],
    byPath: (p: string) => [...state.tasks, ...state.inbox].filter((t) => t.obsidianNotePath === p),
  };
}

const NOTE = 'Projects/House.md';
const LINE = 'Call the plumber';

let s: Awaited<ReturnType<typeof createScenario>>;
let A: ReturnType<typeof mountDevice>;

/** Bring both sides up: meta row, app config row, plugin config adopted (armed), scope set, the note stamped and imported. */
async function bootWithScopedNote(content = `# House\n\n- [ ] ${LINE}\n`): Promise<void> {
  await s.plugin.transport.drain();       // publishes meta:pairing
  A = mountDevice('A');
  await A.sync();                          // reads the meta, publishes meta:config
  for (let i = 0; i < 5 && s.plugin.transport.stampingState() !== 'armed'; i++) {
    await s.advance(1000);
    await s.plugin.transport.drain();     // adopts the config (stamping armed)
  }
  if (s.plugin.transport.stampingState() !== 'armed') {
    const syncPkg = await import('@glance-apps/sync');
    throw new Error(`boot: plugin not armed (${s.plugin.transport.stampingState()}); rows ${s.vault.all('dayglance-bridge').map((r) => r.entityId).join(',')}; `
      + `rateLimited=${syncPkg.isVaultRateLimited()} rootKey=${syncPkg.hasDbRootKey()} metaCache=${A.store.get('dayglance-bridge-pairing-meta')} `
      + `log=${A.log.join(' ')} heartbeat=${JSON.stringify(A.api.bridgeHeartbeatRef.current)} requests=${s.vault.requests.map((r) => `${r.who}:${r.method} ${r.path.replace('/sync/dayglance-bridge/', '')}@${r.at % 100000}`).join(',')}`);
  }
  await s.write(NOTE, content);
  await s.plugin.setScope({ folders: ['Projects'] });
  await s.settle();
  await A.sync();
}

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date('2026-09-04T12:00:00.000Z') });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1; });
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  __resetBridgeStreamForTests(); // module-level guards (publish-once, subkey cache) must not leak between scenarios
  s = await createScenario();
});
afterEach(() => {
  s.plugin.shutdown();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('vault task scope, end to end', () => {
  it('1. a note entering the scope is stamped by the plugin and imported by dayGLANCE under its stamped id', async () => {
    await bootWithScopedNote();
    expect(s.text(NOTE)).toMatch(/Call the plumber \^dg-[a-z0-9]{8}/);
    const mine = A.byPath(NOTE);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toMatch(/^obsidian-dg-/);
    expect(mine[0].date).toBeUndefined();
    expect(A.state.inbox).toHaveLength(1);
  });

  it('2. a rename within the scope keeps the task, under the same id, at the new path', async () => {
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    await s.plugin.app.vault.rename(s.file(NOTE), 'Projects/Home.md');
    await s.settle();
    await A.sync();
    await s.advance(95_000);
    await A.sync();
    expect(A.all()).toHaveLength(1);
    expect(A.all()[0]).toMatchObject({ id, obsidianNotePath: 'Projects/Home.md' });
  });

  it('3. a note moved OUT of the scope withdraws its tasks; moved BACK, they return under the same ids (the 2026-09-04 field bug)', async () => {
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    await s.plugin.app.vault.rename(s.file(NOTE), 'Archive/House.md');
    await s.settle();
    await A.sync();
    expect(A.all()).toHaveLength(0);
    // The vault line is untouched (a withdrawal deletes nothing).
    expect(s.text('Archive/House.md')).toMatch(/\^dg-/);

    await s.plugin.app.vault.rename(s.file('Archive/House.md'), NOTE);
    await s.settle();
    await A.sync();
    expect(A.all()).toHaveLength(1);
    expect(A.all()[0]).toMatchObject({ id, obsidianNotePath: NOTE });
  });

  it('4. a deleted note drops its tasks after the wall-clock confirmation hold', async () => {
    await bootWithScopedNote();
    await s.plugin.app.vault.delete(s.file(NOTE));
    await s.settle();
    await A.sync();
    expect(A.all()).toHaveLength(1); // the hold: not yet
    await s.advance(95_000);
    await A.sync();
    expect(A.all()).toHaveLength(0);
  });

  it('4b. a deleted DAILY note drops its tasks after the hold and tombstones the date (2026-09-05 finding: it used to delete nothing while paired)', async () => {
    await bootWithScopedNote();
    await s.write('Daily/2026-09-04.md', '## Tasks\n- [ ] Call the plumber\n- [ ] Pay the bill\n');
    await s.settle();
    await A.sync();
    expect(A.all()).toHaveLength(3);
    await s.plugin.app.vault.delete(s.file('Daily/2026-09-04.md'));
    await s.settle();
    await A.sync();
    expect(A.all()).toHaveLength(3); // the hold: not yet
    expect(JSON.parse(A.store.get('day-planner-deleted-obsidian-keys') ?? '{}')['2026-09-04']).toBeTruthy(); // the note's copy: at once
    await s.advance(95_000);
    await A.sync();
    expect(A.all().map((t) => t.title)).toEqual([`${LINE} #obsidian`]);
  });

  it('5. scheduling from dayGLANCE writes the date as line metadata; clearing it removes the segment and nothing else', async () => {
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    A.schedule(id, '2026-09-10');
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toMatch(/- \[ \] Call the plumber \[scheduled:: 2026-09-10\] \^dg-/);
    await s.settle();
    await A.sync();
    expect(A.state.tasks.map((t) => t.id)).toEqual([id]);
    expect(A.state.tasks[0]).toMatchObject({ date: '2026-09-10', title: 'Call the plumber #obsidian' });
    expect(A.state.inbox).toHaveLength(0);

    A.unschedule(id);
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toMatch(/- \[ \] Call the plumber \^dg-/);
    expect(s.text(NOTE)).not.toMatch(/scheduled::/);
    await s.settle();
    await A.sync();
    expect(A.state.tasks).toHaveLength(0);
    expect(A.state.inbox.map((t) => t.id)).toEqual([id]);
  });

  it('6. a second device sees the same task, and after a schedule on the first sees ONE scheduled copy and no inbox copy', async () => {
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    const B = mountDevice('B');
    await B.sync();
    expect(B.state.inbox.map((t) => t.id)).toEqual([id]);
    expect(B.state.tasks).toHaveLength(0);

    A.schedule(id, '2026-09-10');
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await B.sync();
    expect(B.state.tasks.map((t) => t.id)).toEqual([id]);
    expect(B.state.tasks[0].date).toBe('2026-09-10');
    expect(B.state.inbox).toHaveLength(0);
  });

  it('7. the completion window: recent completed lines are stamped and imported, old and undated ones are left alone', async () => {
    await bootWithScopedNote(['# House', '', '- [ ] Open forever', '- [x] Recent ✅ 2026-08-30', '- [x] Ancient ✅ 2024-01-01', '- [x] Undated done', ''].join('\n'));
    const text = s.text(NOTE)!;
    expect(text).toMatch(/Open forever \^dg-/);
    expect(text).toMatch(/Recent ✅ 2026-08-30 \^dg-/);
    expect(text).toMatch(/- \[x\] Ancient ✅ 2024-01-01\n/);
    expect(text).toMatch(/- \[x\] Undated done\n/);
    const titles = A.all().map((t) => String(t.title).replace(/ #obsidian$/, '')).sort();
    expect(titles).toEqual(['Open forever', 'Recent']);
    expect(A.all().find((t) => t.title.startsWith('Recent'))?.completed).toBe(true);
  });

  it('8. idle: ten minutes of ticks with nothing changing writes no rows, no files, and no data.json', async () => {
    await bootWithScopedNote();
    const seq = s.vault.maxSeq;
    const saves = s.plugin.data.saves;
    const writes = s.plugin.app.vault.writes;
    const text = s.text(NOTE);
    for (let i = 0; i < 20; i++) {
      await s.plugin.transport.drain();
      s.plugin.transport.adoptTick();
      s.plugin.transport.linkTick();
      await s.advance(30_000);
      if (i % 10 === 9) await A.sync();
    }
    expect(s.vault.maxSeq).toBe(seq);
    expect(s.plugin.data.saves).toBe(saves);
    expect(s.plugin.app.vault.writes).toBe(writes);
    expect(s.text(NOTE)).toBe(text);
    expect(A.all()).toHaveLength(1);
  });

  it('10. retitle from dayGLANCE reaches the line; a retitle and a completion in Obsidian reach dayGLANCE under the same id', async () => {
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    A.patch(id, { title: 'Call the electrician #obsidian' });
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toMatch(/- \[ \] Call the electrician \^dg-/);
    await s.settle();
    await A.sync();
    expect(A.all().map((t) => t.id)).toEqual([id]);
    expect(A.all()[0].title).toBe('Call the electrician #obsidian');

    // Obsidian side: retitle and check the box by hand. (Completion is OR
    // across the two sides by ruled design: a box checked in either place
    // completes the task; unchecking in Obsidian does not reopen it.)
    const edited = s.text(NOTE)!.replace('- [ ] Call the electrician', '- [x] Call the plumber again');
    await s.write(NOTE, edited);
    await s.settle();
    await A.sync();
    expect(A.all().map((t) => t.id)).toEqual([id]);
    expect(A.all()[0]).toMatchObject({ completed: true, title: 'Call the plumber again #obsidian' });
  });

  it('11. completing from dayGLANCE checks the box in the note', async () => {
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    A.patch(id, { completed: true, completedAt: new Date().toISOString() });
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toMatch(/- \[x\] Call the plumber \^dg-/);
    await s.settle();
    await A.sync();
    expect(A.all().map((t) => t.id)).toEqual([id]);
    expect(A.all()[0].completed).toBe(true);
  });

  it('9. a plugin reload republishes the pairing meta WITH the scope (harness finding)', async () => {
    await bootWithScopedNote();
    s.plugin.reload();
    await s.plugin.transport.drain();
    const row = s.vault.live('dayglance-bridge').find((r) => r.entityId === 'meta:pairing');
    const meta = JSON.parse(atob(row!.envelope!));
    expect(meta.scope).toMatchObject({ folders: ['Projects'] });
  });
});
