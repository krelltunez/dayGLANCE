// Bridge scenario harness: the vault task scope, end to end (companion §6).
// The real plugin transport stamps and reports a stub vault; the real
// dayGLANCE sync hook consumes the stream through the real bridge modules
// against one in-memory GLANCEvault. These are the field-test steps of
// 2026-09-04, scripted.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as obsidianMod from '../../src/obsidian.js';

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
// The inbound fetch is spied so a scenario can make THIS device's stream
// unreadable for a chosen number of cycles (scenario 18) without touching
// the fake vault, whose list endpoint also serves the actions fetch and the
// plugin's own drain.
vi.mock('../../src/utils/obsidianBridgeInbound.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const real = actual.fetchBridgeObservations as (...a: unknown[]) => Promise<unknown>;
  return { ...actual, fetchBridgeObservations: vi.fn((...a: unknown[]) => real(...a)) };
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

const { createScenario, VAULT_URL, ACCOUNT_ID, until, advanceFake, makePairing } = await import('./harness');
const { default: useObsidianSync } = await import('../../src/hooks/useObsidianSync.js');
const { flushBridgeOutbox, emitBridgeIntent, __resetBridgeStreamForTests } = await import('../../src/utils/obsidianBridgeStream.js');
const { toInboxCopy } = await import('../../src/utils/inboxMove.js');
const { PROJECT_NOTE_ID_KEY, BRIDGE_PAIRING_META_ID, BRIDGE_APPLIER_META_ID, BRIDGE_VAULT_APP, decodePlainBridgeRow, sealBridgeEnvelope, importBridgeSubkey, bridgeCopyStatusId } = await import('@glance-apps/obsidian-format');
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
  const state = { tasks: [] as Task[], inbox: [] as Task[], recycleBin: [] as Task[], dailyNotes: {} as Record<string, { text?: string; lastModified?: string }> };
  const log: string[] = [];
  const tasksRef = { current: state.tasks };
  const inboxRef = { current: state.inbox };
  // In place: the mocked React never re-renders, so the hook's effects keep
  // the arrays they were mounted with (the app re-renders with fresh lists).
  const replace = (arr: Task[], next: Task[]) => { arr.splice(0, arr.length, ...next); };
  const setTasks = (up: Task[] | ((p: Task[]) => Task[])) => { replace(state.tasks, typeof up === 'function' ? up([...state.tasks]) : up); };
  const setUnscheduledTasks = (up: Task[] | ((p: Task[]) => Task[])) => { replace(state.inbox, typeof up === 'function' ? up([...state.inbox]) : up); };
  const setRecycleBin = (up: Task[] | ((p: Task[]) => Task[])) => { state.recycleBin = typeof up === 'function' ? up(state.recycleBin) : up; };
  // Daily notes are kept as a map mutated IN PLACE (like the task arrays) so
  // the hook's captured reference always reads the current texts.
  const setDailyNotes = (up: Record<string, unknown> | ((p: Record<string, unknown>) => Record<string, unknown>)) => {
    const next = typeof up === 'function' ? up({ ...state.dailyNotes }) : up;
    for (const k of Object.keys(state.dailyNotes)) delete state.dailyNotes[k];
    Object.assign(state.dailyNotes, next || {});
  };
  const syncRef = { current: false };
  const prevRef = { current: {} as Record<string, unknown> };
  effects.length = 0;
  activate();
  const api = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: state.tasks, setTasks,
    unscheduledTasks: state.inbox, setUnscheduledTasks,
    dailyNotes: state.dailyNotes, setDailyNotes, setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
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
      setTasks((p) => p.filter((x) => x.id !== id));
      setUnscheduledTasks((p) => [...p, toInboxCopy(t)]);
    },
    patch: (id: string, fields: Task) => {
      const bump = (list: Task[]) => list.map((x) => (x.id === id ? { ...x, ...fields, lastModified: new Date().toISOString() } : x));
      setTasks(bump); setUnscheduledTasks(bump);
    },
    all: () => [...state.tasks, ...state.inbox],
    byPath: (p: string) => [...state.tasks, ...state.inbox].filter((t) => t.obsidianNotePath === p),
    /** Emit one raw intent from this device and push it to the vault (the harness's hand-rolled writeback). */
    emit: (type: string, fields: Record<string, unknown>) => run(async () => {
      if (!emitBridgeIntent(type, fields)) throw new Error(`emit ${type} refused`);
      await until(flushBridgeOutbox());
    }),
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

  it('2b. a rename within the scope reports the old path gone WITHOUT the scoped flag (#2291 follow-up): Obsidian closed before the new path is reported, the old path\'s report alone never tombstones the moved task; the new path brings it back on the next run', async () => {
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    await s.plugin.app.vault.rename(s.file(NOTE), 'Projects/Home.md');
    await s.advance(500);                 // the old path's gone report goes out at once
    s.plugin.shutdown();                  // closed inside the new path's debounce
    await A.sync();
    await s.advance(95_000);              // past the deletion hold
    await A.sync();
    expect(A.all()).toHaveLength(1);
    expect(A.all()[0]).toMatchObject({ id });
    expect(JSON.parse(A.store.get('day-planner-deleted-obsidian-keys') ?? '{}')[id]).toBeUndefined();
    s.plugin.reload();
    await s.settle();
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

  it('8. idle: ten minutes of ticks with nothing changing writes no rows but its own lease renewals, no files, and no data.json', async () => {
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
    // The applier lease (scenario 22) is the ONE idle write: renewed at half
    // its five minutes, own-ack suppressed, waking nothing that writes.
    const moved = s.vault.all(BRIDGE_VAULT_APP).filter((r) => r.seq > seq);
    expect(moved.map((r) => r.entityId)).toEqual(moved.length ? ['meta:applier'] : []);
    expect(s.vault.maxSeq - seq).toBeLessThanOrEqual(4);
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

  it('11b. the line reported back after that completion changes NOTHING on the task (2026-09-06 finding: the phantom re-stamp)', async () => {
    // A completion mints a transitionId and the app's copy carries it; the
    // re-parse of the line the plugin reports back cannot reproduce it. Read
    // as an edit, that dropped key fabricated a fresh lastModified on every
    // device that re-parsed the line, and under DB-tier last-write-wins the
    // fabricated stamp outranked real edits made elsewhere in the same
    // window. The observation must leave the task byte-for-byte as the app
    // had it, so the stamper sees no change.
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    A.patch(id, { completed: true, completedAt: new Date().toISOString(), transitionId: 'tr-11b', energy: 'deep' } as Task);
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toMatch(/- \[x\] Call the plumber \^dg-/);
    await s.settle();
    const before = JSON.parse(JSON.stringify(A.all()[0]));
    await A.sync();
    expect(A.all().map((t) => t.id)).toEqual([id]);
    expect(JSON.parse(JSON.stringify(A.all()[0]))).toEqual(before);
  });

  it('12. THE POSTURE RULING (2026-09-06): a paired device with a STALE heartbeat neither scans nor writes; the stream still feeds it and its edits go out as intents', async () => {
    // A device's vault copy is only fresh while Obsidian runs (Obsidian
    // Sync does not run in the background on mobile), so a direct scan on a
    // stale heartbeat reads a snapshot and treats it as authoritative — the
    // Android that re-stamped a stale uncompleted line over the Mac's
    // completion. The ruling: stale heartbeat + paired vault = HOLD.
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    const scans = vi.mocked(obsidianMod.syncObsidianVault).mock.calls.length;
    const directWrites = vi.mocked(obsidianMod.writeTaskStateToFile).mock.calls.length;
    // B's Obsidian is closed: its heartbeat file is an hour old (still
    // claims `paired`, as a stale file does).
    vi.mocked(obsidianMod.readVaultHeartbeat).mockImplementation(async () => ({ paired: true, tsMs: Date.now() - 3600_000, accountId: 'acc-1', deviceId: 'plugin-dev' }));
    try {
      const B = mountDevice('B');
      await B.sync();
      expect(B.api.bridgeHeartbeatRef.current.pluginAuthoritative).toBe(false);
      expect(B.api.bridgeHeartbeatRef.current.vaultPosture).toBe('holding');
      // The stream fed it: the scoped note's task is here.
      expect(B.state.inbox.map((t) => t.id)).toEqual([id]);
      // It did NOT scan its own copy.
      expect(vi.mocked(obsidianMod.syncObsidianVault).mock.calls.length).toBe(scans);
      // Its completion goes out as an intent, which the (running) plugin
      // applies to the vault; no direct write.
      B.patch(id, { completed: true, completedAt: new Date().toISOString() });
      await B.writeback();
      await s.plugin.transport.drain();
      expect(s.text(NOTE)).toMatch(/- \[x\] Call the plumber \^dg-/);
      expect(vi.mocked(obsidianMod.writeTaskStateToFile).mock.calls.length).toBe(directWrites);
      // And a second stale cycle stays put: still holding, still no scan.
      await B.sync();
      expect(B.api.bridgeHeartbeatRef.current.vaultPosture).toBe('holding');
      expect(vi.mocked(obsidianMod.syncObsidianVault).mock.calls.length).toBe(scans);
    } finally {
      vi.mocked(obsidianMod.readVaultHeartbeat).mockImplementation(async () => ({ paired: true, tsMs: Date.now(), accountId: 'acc-1', deviceId: 'plugin-dev' }));
    }
  });

  it('13. an inbox task scheduled onto ANOTHER day gets the inline date prefix; moved back onto the note\'s day, the prefix clears (2026-09-06 field incident)', async () => {
    await bootWithScopedNote();
    const DAILY = 'Daily/2026-09-06.md';
    await s.write(DAILY, '## Tasks\n- [ ] Water the plants\n');
    await s.settle();
    await A.sync();
    const task = A.all().find((t) => /Water the plants/.test(t.title))!;
    expect(A.state.inbox.map((t) => t.id)).toContain(task.id);
    A.schedule(task.id, '2026-09-10');
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(DAILY)).toMatch(/- \[ \] 2026-09-10 Water the plants \^dg-/);
    A.schedule(task.id, '2026-09-06');
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(DAILY)).toMatch(/- \[ \] Water the plants \^dg-/);
    expect(s.text(DAILY)).not.toMatch(/2026-09-06 Water/);
  });

  it('14. THE INBOX RECORD (2026-09-06 ruling): a second device that observes the timed line before its DB pull keeps its inbox copy byte-identical — nothing to re-stamp, nothing to push', async () => {
    await bootWithScopedNote();
    const DAILY = 'Daily/2026-09-06.md';
    await s.write(DAILY, '## Tasks\n- [ ] Water the plants\n');
    await s.settle();
    await A.sync();
    const task = A.all().find((t) => /Water the plants/.test(t.title))!;
    const B = mountDevice('B');
    await B.sync();
    expect(B.state.inbox.map((t) => t.id)).toContain(task.id);
    const before = JSON.parse(JSON.stringify(B.state.inbox.find((t) => t.id === task.id)));
    // A schedules it; the plugin rewrites the line; B observes the timed line
    // with its copy still in the inbox (no DB tier in the harness: exactly
    // the race).
    A.schedule(task.id, '2026-09-10');
    await A.writeback();
    await s.plugin.transport.drain();
    expect(s.text(DAILY)).toMatch(/2026-09-10 Water the plants/);
    await s.settle();
    await B.sync();
    expect(B.state.tasks.map((t) => t.id)).not.toContain(task.id);
    const after = JSON.parse(JSON.stringify(B.state.inbox.find((t) => t.id === task.id)));
    expect(after).toEqual(before);
  });

  it('15. a CRLF note is stamped in place, stays CRLF throughout, and imports under the same id as its LF twin (audit low, 2026-09-06)', async () => {
    const lf = `# House\n\n- [ ] ${LINE}\n`;
    await bootWithScopedNote(lf.replace(/\n/g, '\r\n'));
    const text = s.text(NOTE)!;
    expect(text).toMatch(/Call the plumber \^dg-[a-z0-9]{8}\r\n/);
    expect(text).not.toMatch(/[^\r]\n/);            // no line was rewritten LF inside the CRLF note
    const mine = A.byPath(NOTE);
    expect(mine).toHaveLength(1);
    expect(mine[0].id).toMatch(/^obsidian-dg-/);
    expect(mine[0].title).toContain(LINE);            // the import tag follows as usual
    expect(mine[0].title).not.toMatch(/\r/);          // no '\r' rode into the title
    expect(A.state.inbox).toHaveLength(1);
  });

  it('16. a stamped line copy-pasted into a second daily note keeps its identity on the original; the copy is a separate task, in either observation order (audit low, 2026-08-31)', async () => {
    await bootWithScopedNote();
    const D1 = 'Daily/2026-09-04.md';
    const D2 = 'Daily/2026-09-05.md';
    await s.write(D1, '## Tasks\n- [ ] Water the plants\n');
    await s.settle();
    await A.sync();
    const original = A.all().find((t) => /Water the plants/.test(t.title))!;
    expect(original.obsidianFileDate).toBe('2026-09-04');
    const token = s.text(D1)!.match(/\^dg-([a-z0-9]{8})/)![1];
    expect(original.id).toBe(`obsidian-dg-${token}`);
    // Copy the stamped line, token and all, into the next day's note. D1 is
    // untouched, so only D2 is observed: the batch never contains the owner.
    await s.write(D2, `## Tasks\n- [ ] Water the plants ^dg-${token}\n`);
    await s.settle();
    await A.sync();
    const keeper = A.all().find((t) => t.id === original.id)!;
    expect(keeper.obsidianFileDate).toBe('2026-09-04');   // identity stayed home
    const copies = A.all().filter((t) => /Water the plants/.test(t.title));
    expect(copies).toHaveLength(2);                        // the copy is its own task
    expect(copies.find((t) => t.id !== original.id)!.obsidianFileDate).toBe('2026-09-05');
    // A later edit to D1 alone re-observes the owner: nothing changes hands.
    await s.write(D1, `## Tasks\n- [ ] Water the plants ^dg-${token}\n- [ ] Buy soil\n`);
    await s.settle();
    await A.sync();
    expect(A.all().find((t) => t.id === original.id)!.obsidianFileDate).toBe('2026-09-04');
    expect(A.all().filter((t) => /Water the plants/.test(t.title))).toHaveLength(2);
  });

  it('17. THE §8 RULING (2026-09-08): a time typed onto an inbox task in Obsidian schedules it; the stale read of a time dayGLANCE just removed does not', async () => {
    await bootWithScopedNote();
    const DAILY = 'Daily/2026-09-06.md';
    await s.write(DAILY, '## Tasks\n- [ ] Water the plants\n');
    await s.settle();
    await A.sync();
    const task = A.all().find((t) => /Water the plants/.test(t.title))!;
    expect(A.state.inbox.map((t) => t.id)).toContain(task.id);
    const token = s.text(DAILY)!.match(/\^dg-([a-z0-9]{8})/)![1];
    // (a) The user types a time onto the line in Obsidian.
    await s.write(DAILY, `## Tasks\n- [ ] 09:00 Water the plants ^dg-${token}\n`);
    await s.settle();
    await A.sync();
    expect(A.state.inbox.map((t) => t.id)).not.toContain(task.id);
    expect(A.state.tasks.find((t) => t.id === task.id)).toMatchObject({ date: '2026-09-06', startTime: '09:00', isAllDay: false });
    // (b) dayGLANCE moves it back to the inbox. Before that writeback lands
    // the note is re-observed for an unrelated edit, still carrying 09:00:
    // the observation is emitted first (settle), then the writeback is
    // flushed but not yet applied (no plugin drain), then the app syncs.
    A.unschedule(task.id);
    expect(A.state.inbox.find((t) => t.id === task.id)!.obsidianClearedTime).toBe('09:00');
    await s.write(DAILY, `## Tasks\n- [ ] 09:00 Water the plants ^dg-${token}\n- [ ] Buy soil\n`);
    await s.settle();
    await A.writeback();
    await A.sync();
    expect(A.state.inbox.map((t) => t.id)).toContain(task.id);   // the stale read did not reschedule it
    expect(A.state.inbox.find((t) => t.id === task.id)!.obsidianClearedTime).toBe('09:00');
    // (c) The writeback lands: the line loses its time, the marker is spent.
    await s.plugin.transport.drain();
    expect(s.text(DAILY)).toMatch(/- \[ \] Water the plants \^dg-/);
    await s.settle();
    await A.sync();
    expect(A.state.inbox.map((t) => t.id)).toContain(task.id);
    expect(A.state.inbox.find((t) => t.id === task.id)!.obsidianClearedTime).toBeUndefined();
    // (d) A different time typed later schedules it again.
    await s.write(DAILY, s.text(DAILY)!.replace('- [ ] Water the plants', '- [ ] 14:30 Water the plants'));
    await s.settle();
    await A.sync();
    expect(A.state.tasks.find((t) => t.id === task.id)).toMatchObject({ startTime: '14:30', date: '2026-09-06' });
  });

  it('18. the dead-stream toast is damped: one unreadable inbound read warns only, the second in a row shows it, a good read clears the count (2026-09-08)', async () => {
    await bootWithScopedNote();
    const inbound = await import('../../src/utils/obsidianBridgeInbound.js');
    const fetchSpy = vi.mocked(inbound.fetchBridgeObservations);
    const unavailable = () => A.log.filter((l) => l.startsWith('error:Vault changes are not arriving')).length;
    const before = unavailable();
    fetchSpy.mockResolvedValueOnce(null);      // one hiccup
    await A.sync();
    expect(unavailable()).toBe(before);       // warned in the console, no toast
    await A.sync();                           // a good read in between: the count resets
    fetchSpy.mockResolvedValueOnce(null).mockResolvedValueOnce(null); // two in a row
    await A.sync();
    expect(unavailable()).toBe(before);       // the first of the pair: still nothing
    await A.sync();
    expect(unavailable()).toBe(before + 1);   // the second: the dead-stream error
    await A.sync();                           // the stream reads again: the count resets
    fetchSpy.mockResolvedValueOnce(null);
    await A.sync();
    expect(unavailable()).toBe(before + 1);   // a single failure after a success is quiet again
  });

  it('19. THE 2026-09-08 PING-PONG: the observed note replacing a newer-stamped app record keeps that stamp, so the stale copy cannot win the date back here', async () => {
    await bootWithScopedNote();
    const DAILY = 'Daily/2026-09-08.md';
    await s.write(DAILY, '## Tasks\n- [ ] Water the plants\n');
    await s.settle();
    await A.sync();
    expect(A.state.dailyNotes['2026-09-08']!.text).toContain('Water the plants');
    // A device with no vault saved the raw template as the date's record,
    // stamped a minute into the future relative to the file (in the field:
    // the tablet's close time versus the note's mtime), and it synced here.
    const stale = new Date(Date.now() + 60_000).toISOString();
    A.state.dailyNotes['2026-09-08'] = { text: '<% tp.date.now() %>\n\n## Tasks\n', lastModified: stale };
    // The note is re-observed (an edit in Obsidian). Its mtime is older than
    // the stale record, which used to become the record's stamp.
    await s.write(DAILY, s.text(DAILY)!.replace('\n', '\n- [ ] Buy soil\n'));
    await s.settle();
    await A.sync();
    const rec = A.state.dailyNotes['2026-09-08']!;
    expect(rec.text).toContain('Buy soil');                       // the vault's text won
    expect(rec.text).not.toContain('tp.date.now');
    expect(rec.lastModified).toBe(stale);                          // and ties the stale copy: every tier keeps local on a tie
    // Steady state: the unchanged file carries that stamp forward, no re-stamp.
    await s.settle();
    await A.sync();
    expect(A.state.dailyNotes['2026-09-08']!.lastModified).toBe(rec.lastModified);
  });

  it('20. every intent the plugin applies to a CRLF note leaves it CRLF: state, append, completion log, remove (format-package audit low, follow-up)', async () => {
    const lf = `# House\n\n- [ ] ${LINE}\n`;
    await bootWithScopedNote(lf.replace(/\n/g, '\r\n'));
    const noBareLf = (text: string) => !/[^\r]\n/.test(text) && !text.startsWith('\n');
    const token = s.text(NOTE)!.match(/\^dg-([a-z0-9]{8})/)![1];
    // (a) task_state through the real plugin applier.
    await A.emit('task_state', { path: NOTE, blockId: token, obsidianRawTitle: LINE, completed: true });
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toMatch(/- \[x\] Call the plumber \^dg-[a-z0-9]{8}\r\n/);
    expect(noBareLf(s.text(NOTE)!)).toBe(true);
    // (b) task_append and (c) completion_log_append into a CRLF daily note.
    const DAILY = 'Daily/2026-09-10.md';
    await s.write(DAILY, '## Tasks\r\n- [ ] Existing\r\n\r\n## Completed\r\n');
    await A.emit('task_append', {
      path: DAILY, date: '2026-09-10', heading: '## Tasks', template: '',
      task: { title: 'Water the plants #obsidian', startTime: null, duration: null, isAllDay: true, date: '2026-09-10', blockId: 'cr1f0001' },
    });
    await A.emit('completion_log_append', { path: DAILY, date: '2026-09-10', heading: '## Completed', entry: '- ✅ 09:00 Existing', template: '' });
    await s.plugin.transport.drain();
    const daily = s.text(DAILY)!;
    expect(daily).toContain('- [ ] Water the plants #obsidian ^dg-cr1f0001\r\n');
    expect(daily).toContain('## Completed\r\n- ✅ 09:00 Existing\r\n');
    expect(noBareLf(daily)).toBe(true);
    // (d) task_remove takes the line and nothing else.
    await A.emit('task_remove', { path: DAILY, blockId: 'cr1f0001', obsidianRawTitle: 'Water the plants #obsidian' });
    await s.plugin.transport.drain();
    const after = s.text(DAILY)!;
    expect(after).not.toContain('Water the plants');
    expect(after).toContain('- [ ] Existing\r\n');
    expect(noBareLf(after)).toBe(true);
  });

  it('21. LATE OBSERVATION (spec 2.7 ruling): a report whose mtime is older than the last applied one is dropped; equal and newer apply', async () => {
    await bootWithScopedNote();
    const DAILY = 'Daily/2026-09-11.md';
    // A daily note with no task lines: the plugin has nothing to stamp, so the
    // file's mtime is exactly what the test sets.
    await s.write(DAILY, '## Notes\nMorning: coffee\n');
    await s.settle();
    await A.sync();
    expect(A.state.dailyNotes['2026-09-11']!.text).toContain('Morning: coffee');
    const applied = JSON.parse((globalThis as any).localStorage.getItem('dayglance-obsidian-last-applied-mtime'))['2026-09-11'];
    expect(typeof applied).toBe('string');
    // A newer edit lands and is applied; the memory advances.
    await s.advance(5_000);
    await s.write(DAILY, '## Notes\nMorning: coffee\nNoon: walk\n');
    await s.settle();
    await A.sync();
    expect(A.state.dailyNotes['2026-09-11']!.text).toContain('Noon: walk');
    const newerApplied = JSON.parse((globalThis as any).localStorage.getItem('dayglance-obsidian-last-applied-mtime'))['2026-09-11'];
    expect(Date.parse(newerApplied)).toBeGreaterThan(Date.parse(applied));
    // A lagging copy reports: older text under an mtime BEFORE the last
    // applied one (a second desktop's Obsidian Sync copy, or a stream row
    // delivered late). The text must not come back, and the memory holds.
    await s.write(DAILY, '## Notes\nMorning: coffee\n');
    s.file(DAILY).stat.mtime = Date.parse(applied) - 60_000;
    const info = vi.spyOn(console, 'info');
    await s.settle();
    await A.sync();
    expect(A.state.dailyNotes['2026-09-11']!.text).toContain('Noon: walk');
    expect(info.mock.calls.some((c) => String(c[0]).includes('late observation skipped'))).toBe(true);
    info.mockRestore();
    expect(JSON.parse((globalThis as any).localStorage.getItem('dayglance-obsidian-last-applied-mtime'))['2026-09-11']).toBe(newerApplied);
    // A genuinely newer edit still applies after the late one.
    await s.advance(5_000);
    await s.write(DAILY, '## Notes\nMorning: coffee\nNoon: walk\nEvening: read\n');
    await s.settle();
    await A.sync();
    expect(A.state.dailyNotes['2026-09-11']!.text).toContain('Evening: read');
  });

  it('22. ONE APPLIER PER VAULT (2026-09-13): two plugin copies drain the same burst; only the lease holder applies, in one write per note; the other takes over when the holder quits', async () => {
    await bootWithScopedNote();
    const B = s.plugin.second('plugin-B');
    // B lists the lease A claimed at boot and stands down.
    await B.transport.drain();
    const writesBefore = s.plugin.app.vault.writes;
    const append = (n: number) => A.emit('task_append', {
      path: NOTE, date: null, noteTask: true, heading: '## Tasks',
      task: { title: `Line ${n}`, startTime: null, duration: null, isAllDay: true, date: null, blockId: `burst000${n}` },
    });
    // Four intents against one note in a burst (the field sequence).
    for (const n of [1, 2, 3, 4]) await append(n);
    await s.plugin.transport.drain();
    await B.transport.drain();
    const text = s.text(NOTE)!;
    for (const n of [1, 2, 3, 4]) expect(text.match(new RegExp(`Line ${n} \\^dg-burst000${n}`, 'g'))).toHaveLength(1);
    // One write for the burst, one applier: B consumed nothing and the rows are gone.
    expect(s.plugin.app.vault.writes - writesBefore).toBe(1);
    expect(B.data.bridge!.appliedIds).toEqual([]);
    expect(s.vault.live(BRIDGE_VAULT_APP).filter((r) => r.entityId.startsWith('int:'))).toHaveLength(0);
    // A quits; its lease lapses by expiry. A new intent waits for B to claim and settle, then B applies it.
    s.plugin.shutdown();
    await append(9);
    await B.transport.drain();
    expect(s.text(NOTE)).not.toContain('Line 9'); // A's lease still stands
    await s.advance(100_000);
    await B.transport.drain();
    expect(s.text(NOTE)).not.toContain('Line 9'); // still stands: five minutes, not ninety seconds
    await s.advance(210_000);
    await B.transport.drain();                    // expired: B claims
    expect(s.text(NOTE)).not.toContain('Line 9'); // and settles first
    await s.advance(2500);
    await B.transport.drain();
    expect(s.text(NOTE)).toContain('Line 9 ^dg-burst0009');
    expect(B.data.bridge!.appliedIds).toHaveLength(1);
    B.shutdown();
  });

  it('23. THE LIVE-COLLISION REFUSAL (2026-09-13): a duplicated tokenized line never overwrites the live task; removing the duplicate resolves it', async () => {
    await bootWithScopedNote();
    const id = A.byPath(NOTE)[0].id;
    A.patch(id, { notes: 'keep me', color: 'bg-orange-500' });
    // A merge doubled the line, token and all (the incident's shape).
    const line = s.text(NOTE)!.split('\n').find((l) => l.includes('^dg-'))!;
    await s.write(NOTE, s.text(NOTE)!.replace(line, `${line}\n${line}`));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await s.settle();
      await A.sync();
      await A.writeback();
      await s.plugin.transport.drain();
      await s.settle();
      await A.sync();
      // The live task keeps its app fields; nothing was redirected over it.
      expect(A.all().find((t) => t.id === id)).toMatchObject({ notes: 'keep me', color: 'bg-orange-500' });
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('REFUSING to mint'))).toBe(true);
      // The note still carries exactly one token: no second identity was minted.
      expect((s.text(NOTE)!.match(/\^dg-/g) ?? []).length).toBe(2); // two lines, one token each, same token
      expect(new Set(s.text(NOTE)!.match(/\^dg-[a-z0-9]{8}/g)).size).toBe(1);
    } finally { errSpy.mockRestore(); }
    // The human removes the duplicate; the app converges to one task with its fields intact.
    await s.write(NOTE, s.text(NOTE)!.replace(`${line}\n${line}`, line));
    await s.settle();
    await A.sync();
    await s.advance(100_000);
    await A.sync();
    expect(A.byPath(NOTE).map((t) => t.id)).toEqual([id]);
    expect(A.all().find((t) => t.id === id)).toMatchObject({ notes: 'keep me', color: 'bg-orange-500' });
  });

  it('24. THE GATE COVERS PARSED TASKS (2026-09-17): a stale report of a daily note with the old title does not revert a dayGLANCE retitle; a newer Obsidian edit still wins', async () => {
    await bootWithScopedNote();
    const DAILY = 'Daily/2026-09-04.md';
    await s.write(DAILY, '## Tasks\n- [ ] Fix the boiler\n');
    await s.settle();
    await A.sync();
    const id = A.all().find((t) => t.title.startsWith('Fix the boiler'))!.id;
    A.patch(id, { title: 'Fix the boiler valve #obsidian' });
    await A.writeback();
    await s.plugin.transport.drain();
    await s.settle();
    await A.sync();
    expect(A.all().find((t) => t.id === id)!.title).toBe('Fix the boiler valve #obsidian');
    const applied = JSON.parse((globalThis as any).localStorage.getItem('dayglance-obsidian-last-applied-mtime'))['2026-09-04'];
    expect(typeof applied).toBe('string');
    // The lagging copy: the old line under the old mtime.
    await s.write(DAILY, s.text(DAILY)!.replace('Fix the boiler valve', 'Fix the boiler'));
    s.file(DAILY).stat.mtime = Date.parse(applied) - 60_000;
    await s.settle();
    await A.sync();
    expect(A.all().find((t) => t.id === id)!.title).toBe('Fix the boiler valve #obsidian');
    expect(A.all().filter((t) => t.title.startsWith('Fix the boiler')).length).toBe(1);
    // A genuinely newer edit still wins.
    await s.advance(5_000);
    await s.write(DAILY, s.text(DAILY)!.replace('Fix the boiler', 'Fix the boiler pump'));
    await s.settle();
    await A.sync();
    expect(A.all().find((t) => t.id === id)!.title).toBe('Fix the boiler pump #obsidian');
  });

  it('25. THE PAIRING SPLIT (2026-09-29): a copy on an older pairing never overwrites the vault\'s row, never claims the lease, holds what it cannot read, and applies it once the current pairing arrives', async () => {
    await bootWithScopedNote();
    const metaGeneration = () => {
      const row = s.vault.live(BRIDGE_VAULT_APP).find((r) => r.entityId === BRIDGE_PAIRING_META_ID);
      return (decodePlainBridgeRow(row!.envelope!) as { generation?: string }).generation;
    };
    expect(metaGeneration()).toBe(s.pairing.generation);
    // B: a second desktop whose plugin still holds last month's pairing (the
    // synced data.json arrived underneath it, unread until a restart).
    const old = await makePairing({ generation: 'gen-old', pairedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), saltByte: 9 });
    const B = s.plugin.second('plugin-B', old);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await B.transport.drain();
    expect(B.transport.pairingStale()).toBe(true);
    // MUTATION: assert-before-read (the old drain) puts 'gen-old' in the
    // vault's row here, and every dayGLANCE device then seals under a dead key.
    expect(metaGeneration()).toBe(s.pairing.generation);
    expect(warn.mock.calls.some(([m]) => String(m).includes('older pairing'))).toBe(true);
    // A quits; its lease lapses. dayGLANCE writes under the current pairing.
    s.plugin.shutdown();
    await s.advance(310_000);
    await A.emit('task_append', {
      path: NOTE, date: null, noteTask: true, heading: '## Tasks',
      task: { title: 'Line 25', startTime: null, duration: null, isAllDay: true, date: null, blockId: 'split0025' },
    });
    await B.transport.drain();
    await s.advance(2500);
    await B.transport.drain();
    const intents = () => s.vault.live(BRIDGE_VAULT_APP).filter((r) => r.entityId.startsWith('int:'));
    // Held, not deleted (MUTATION: the old consume-and-delete empties this),
    // nothing applied, and the expired lease still names A: B never claimed.
    expect(intents()).toHaveLength(1);
    expect(s.text(NOTE)).not.toContain('Line 25');
    expect(B.data.bridge!.appliedIds).toEqual([]);
    const lease = s.vault.live(BRIDGE_VAULT_APP).find((r) => r.entityId === BRIDGE_APPLIER_META_ID);
    expect((decodePlainBridgeRow(lease!.envelope!) as { deviceId?: string }).deviceId).toBe('plugin-A');
    expect(warn.mock.calls.some(([m]) => String(m).includes('held, not deleted') && String(m).includes(s.pairing.generation))).toBe(true);
    // Obsidian Sync delivers the current data.json (main.ts reloads it on
    // onExternalSettingsChange): B now holds the vault's pairing.
    B.data.pairing = s.pairing;
    await B.transport.drain();   // current again: claims the free lease
    await s.advance(2500);
    await B.transport.drain();   // settled: applies the held row
    expect(s.text(NOTE)).toContain('Line 25 ^dg-split0025');
    expect(intents()).toHaveLength(0);
    expect(B.transport.pairingStale()).toBe(false);
    warn.mockRestore();
    B.shutdown();
  });

  it('26. NEVER DELETE WHAT THIS COPY CANNOT READ (2026-09-29): an intent sealed under a pairing nobody current holds is held and said once; only a week unreadable drops it', async () => {
    await bootWithScopedNote();
    // Rows sealed under a revoked pairing (a device whose meta cache was
    // behind a re-pair): the current copy cannot open them.
    const revoked = await makePairing({ generation: 'gen-revoked', pairedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(), saltByte: 11 });
    const key = await importBridgeSubkey(revoked.subkeyB64);
    const ghost = (n: number) => ({
      v: 1, kind: 'intent', type: 'task_append', intentId: `ghost-${n}`, createdAt: new Date().toISOString(),
      path: NOTE, date: null, noteTask: true, heading: '## Tasks',
      task: { title: `Ghost ${n}`, startTime: null, duration: null, isAllDay: true, date: null, blockId: `ghost000${n}` },
    });
    const put = async (n: number, createdAt: number) => s.vault.handle(
      'POST', `${VAULT_URL}/sync/${BRIDGE_VAULT_APP}/batch`,
      JSON.stringify({ accountId: ACCOUNT_ID, rows: [{ entityId: `int:ghost-${n}`, envelope: await sealBridgeEnvelope(key, ghost(n), 'gen-revoked'), createdAt }] }),
      'Bearer device-token',
    );
    await put(1, Date.now());                        // fresh: held
    await put(2, Date.now() - 8 * 86_400_000);       // a week unreadable: dropped, aloud
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await s.plugin.transport.drain();
    const live = () => s.vault.live(BRIDGE_VAULT_APP).filter((r) => r.entityId.startsWith('int:ghost')).map((r) => r.entityId);
    expect(live()).toEqual(['int:ghost-1']);
    expect(s.text(NOTE)).not.toContain('Ghost');
    expect(s.plugin.data.bridge!.appliedIds).not.toContain('ghost-1');
    expect(s.plugin.data.bridge!.appliedIds).toContain('ghost-2');
    const held = () => warn.mock.calls.filter(([m]) => String(m).includes('held, not deleted'));
    expect(held()).toHaveLength(1);
    expect(String(held()[0][0])).toContain('gen-revoked');   // the tag names the pairing it needs
    expect(warn.mock.calls.filter(([m]) => String(m).includes('dropping intent ghost-2'))).toHaveLength(1);
    // The next drain re-lists the held row (the cursor floor) and repeats
    // nothing; a current intent still applies around it.
    await s.plugin.transport.drain();
    expect(held()).toHaveLength(1);
    expect(live()).toEqual(['int:ghost-1']);
    await A.emit('task_append', {
      path: NOTE, date: null, noteTask: true, heading: '## Tasks',
      task: { title: 'Line 26', startTime: null, duration: null, isAllDay: true, date: null, blockId: 'split0026' },
    });
    await s.plugin.transport.drain();
    expect(s.text(NOTE)).toContain('Line 26 ^dg-split0026');
    expect(live()).toEqual(['int:ghost-1']);
    warn.mockRestore();
  });

  it('27. THE FLEET VIEW (2026-09-29): every copy publishes its status row; a stale copy reports behind with its held count; the app on ANOTHER machine says so, and clears once the copy catches up', async () => {
    await bootWithScopedNote();
    const copyRow = (deviceId: string) => {
      const row = s.vault.live(BRIDGE_VAULT_APP).find((r) => r.entityId === bridgeCopyStatusId(deviceId));
      return row ? decodePlainBridgeRow(row.envelope!) as Record<string, unknown> : null;
    };
    // A's copy published itself at boot: current, holding nothing.
    expect(copyRow('plugin-A')).toMatchObject({ kind: 'copy', deviceId: 'plugin-A', generation: s.pairing.generation, stale: false, held: 0 });
    // B: a second desktop on last month's pairing.
    const old = await makePairing({ generation: 'gen-old', pairedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(), saltByte: 9 });
    const B = s.plugin.second('plugin-B', old);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await B.transport.drain();
    expect(copyRow('plugin-B')).toMatchObject({ stale: true, generation: 'gen-old', held: 0 });
    // A current intent lands; B (a follower) holds it and says so in its row.
    await A.emit('task_append', {
      path: NOTE, date: null, noteTask: true, heading: '## Tasks',
      task: { title: 'Line 27', startTime: null, duration: null, isAllDay: true, date: null, blockId: 'fleet0027' },
    });
    await B.transport.drain();
    expect(copyRow('plugin-B')).toMatchObject({ stale: true, held: 1 });
    // The dayGLANCE device (the laptop the user sits at, whose own copy is
    // current) reads both rows on its next cycle and says the fleet is split.
    await A.sync();
    const copies = JSON.parse(A.store.get('dayglance-bridge-copies') ?? '{}') as Record<string, { stale?: boolean; held?: number }>;
    expect(Object.keys(copies).sort()).toEqual(['plugin-A', 'plugin-B']);
    expect(copies['plugin-B']).toMatchObject({ stale: true, held: 1 });
    expect(A.log.some((l) => l.startsWith('error:') && l.includes('hold an older pairing'))).toBe(true);
    // MUTATION: drop the copy row capture from fetchBridgeObservations and
    // the laptop never learns; drop the alarm from finishObsidianCycle and
    // it learns silently.
    const errorsBefore = A.log.filter((l) => l.startsWith('error:') && !l.startsWith('error:null')).length;
    await A.sync();                                  // said once: quiet, and not "Synced"
    expect(A.log.filter((l) => l.startsWith('error:') && !l.startsWith('error:null')).length).toBe(errorsBefore);
    expect(A.log.slice(-3).some((l) => l.startsWith('status:success'))).toBe(false);
    // B catches up (the synced settings arrive): its row flips, the alarm clears.
    B.data.pairing = s.pairing;
    await B.transport.drain();
    expect(copyRow('plugin-B')).toMatchObject({ stale: false, held: 0 });
    await A.sync();
    expect(A.log.slice(-4).some((l) => l.startsWith('status:success'))).toBe(true);
    expect(A.log.filter((l) => l.startsWith('error:') && !l.startsWith('error:null')).length).toBe(errorsBefore);
    warn.mockRestore();
    B.shutdown();
  });

  it('28. THE DELIVERY CHECK (2026-09-29, the safety net): a change of this device left unconsumed for ten minutes while a copy is applying is said, whatever the cause; consumed, it clears', async () => {
    await bootWithScopedNote();
    // The cause here: this device seals under a pairing the vault rotated
    // away from (a meta cache five minutes behind a re-pair). The current
    // copy cannot read the row and holds it (scenario 26).
    const revoked = await makePairing({ generation: 'gen-revoked', pairedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(), saltByte: 11 });
    A.store.set('dayglance-bridge-pairing-meta', JSON.stringify({
      meta: { v: 1, kind: 'pairing-meta', generation: revoked.generation, pairingSalt: revoked.pairingSalt, pairedAt: revoked.pairedAt }, fetchedAt: Date.now(),
    }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await A.emit('task_append', {
      path: NOTE, date: null, noteTask: true, heading: '## Tasks',
      task: { title: 'Line 28', startTime: null, duration: null, isAllDay: true, date: null, blockId: 'deliv0028' },
    });
    await s.plugin.transport.drain();
    const ghosts = () => s.vault.live(BRIDGE_VAULT_APP).filter((r) => r.entityId.startsWith('int:'));
    expect(ghosts()).toHaveLength(1);
    // Under ten minutes: nothing to say yet, whatever the plugin is doing.
    await A.sync();
    expect(A.log.some((l) => l.includes('waiting more than 10 minutes'))).toBe(false);
    // Ten minutes on, with the plugin still applying (its lease renewed), the
    // change is still there: the device says so, once.
    await advanceFake(610_000, 2000);        // coarse steps: nothing here is timing-sensitive below a second
    await s.plugin.transport.drain();
    await A.sync();
    expect(A.log.filter((l) => l.startsWith('error:') && l.includes('waiting more than 10 minutes'))).toHaveLength(1);
    expect(JSON.parse(A.store.get('dayglance-bridge-delivery') ?? '{}')).toMatchObject({ waiting: 1, leaseLive: true });
    // MUTATION: skip the probe (or the lease read) in checkBridgeDelivery and
    // this never fires; alarm on a dead lease and every phone's overnight
    // queue would fire it.
    // A copy that can read it drains it away (here: the row is consumed);
    // the next due check finds it gone and the alarm clears.
    s.vault.handle('DELETE', `${VAULT_URL}/sync/${BRIDGE_VAULT_APP}/${encodeURIComponent(ghosts()[0].entityId)}`, undefined, 'Bearer device-token');
    await advanceFake(610_000, 2000);        // coarse steps: nothing here is timing-sensitive below a second
    await s.plugin.transport.drain();
    await A.sync();
    expect(JSON.parse(A.store.get('dayglance-bridge-delivery') ?? '{}')).toMatchObject({ waiting: 0 });
    expect(A.log.slice(-4).some((l) => l.startsWith('status:success'))).toBe(true);
    warn.mockRestore();
  }, 30_000);

  it('29. THE EMPTY-KEY INTENTS (2026-10-10): a device whose sync key fails the account check sends the plugin nothing it cannot read; its change waits on the device and applies once the passphrase is entered again', async () => {
    await bootWithScopedNote();
    const syncPkg = await import('@glance-apps/sync');
    // The incident's key: the Direct Access record, {rawKey, salt}, read as a
    // root key record. rootBytes is undefined, so the key is EMPTY, yet a key
    // is in memory; the bridge used to seal under it.
    await syncPkg.initDbRootKey({ nativeGetSyncKey: async () => btoa(JSON.stringify({ rawKey: [1, 2, 3], salt: new Array(16).fill(7) })) });
    expect(syncPkg.hasDbRootKey()).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const append = {
      path: NOTE, date: null, noteTask: true, heading: '## Tasks',
      task: { title: 'Line 29', startTime: null, duration: null, isAllDay: true, date: null, blockId: 'empty0029' },
    };
    await A.emit('task_append', append);
    const intents = () => s.vault.live(BRIDGE_VAULT_APP).filter((r) => r.entityId.startsWith('int:'));
    expect(intents()).toHaveLength(0);                                   // nothing sealed under the empty key
    expect(JSON.parse(A.store.get('dayglance-bridge-outbox')!)).toHaveLength(1); // held on the device
    await s.plugin.transport.drain();
    expect(s.plugin.transport.heldIntents()).toBe(0);                    // nothing for the plugin to hold
    expect(s.text(NOTE)).not.toContain('Line 29');

    // The passphrase entered again: the key every device holds.
    await syncPkg.setupDbRootKey('harness-passphrase', new Uint8Array(16).fill(7), { nativeGetSyncKey: async () => null, nativeStoreSyncKey: () => {} });
    await A.writeback();
    expect(intents()).toHaveLength(1);
    await s.plugin.transport.drain();
    expect(s.plugin.transport.heldIntents()).toBe(0);
    expect(s.text(NOTE)).toContain('Line 29 ^dg-empty0029');
    warn.mockRestore();
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

// THE SCOPE TAG REMOVED (companion §6, the tag-removal record): a note that
// leaves the scope through its own metadata is withdrawn (ruling C) once it
// has been out continuously for the leaving hold, two minutes, and never
// for a transient (a tag being retyped, a frontmatter edit half done).
describe('the scope tag removed: withdrawal after the leaving hold', () => {
  const TNOTE = 'Areas/Garden.md';
  const ROSES = 'Water the roses';
  const tagged = (extra = '') => `---\n${extra}tags: [work]\n---\n# Garden\n\n- [ ] ${ROSES}\n`;
  const withoutTag = (path: string) => s.write(path, s.text(path)!.replace('tags: [work]', 'tags: []'));
  const withTag = (path: string) => s.write(path, s.text(path)!.replace('tags: []', 'tags: [work]'));
  const tombstones = () => JSON.parse(A.store.get('day-planner-deleted-obsidian-keys') ?? '{}') as Record<string, unknown>;
  const withdrawnNotes = () => JSON.parse(A.store.get('day-planner-withdrawn-obsidian-notes') ?? '{}') as Record<string, unknown>;
  const adoptedScope = () => s.plugin.data.bridge!.adoptedScope ?? [];
  // Calls through: the spy only counts which paths the transport withdrew.
  const spyWithdrawals = () => vi.spyOn(s.plugin.transport as any, 'emitWithdrawal');
  const withdrawalsOf = (spy: ReturnType<typeof spyWithdrawals>, path: string) => spy.mock.calls.filter(([p]) => p === path).length;

  /** The folder-scoped boot, then the scope gains the tag `work` and a note carrying it is written, stamped and imported. */
  async function bootWithTaggedNote(path = TNOTE, content = tagged()): Promise<void> {
    await bootWithScopedNote();
    await s.plugin.setScope({ folders: ['Projects'], tags: ['work'] });
    await s.write(path, content);
    await s.settle();
    await A.sync();
    expect(s.text(path)).toMatch(new RegExp(`${ROSES} \\^dg-[a-z0-9]{8}`));
    expect(A.byPath(path)).toHaveLength(1);
    // Entering by its own metadata adopts it on the spot (persisted).
    expect(adoptedScope()).toContain(path);
  }

  it('T1. a note in scope only by its tag loses the tag: nothing changes for two minutes; then it is withdrawn, the app drops its tasks (the tombstone class), the stamps stay; the tag back re-imports under the same ids', async () => {
    await bootWithTaggedNote();
    const id = A.byPath(TNOTE)[0].id;
    const stamped = s.text(TNOTE)!.match(/\^dg-[a-z0-9]{8}/)![0];
    const spy = spyWithdrawals();
    await withoutTag(TNOTE);
    // Inside the hold: still adopted, nothing withdrawn, the task stands.
    await s.advance(100_000);
    await A.sync();
    expect(withdrawalsOf(spy, TNOTE)).toBe(0);
    expect(adoptedScope()).toContain(TNOTE);
    expect(A.byPath(TNOTE).map((t) => t.id)).toEqual([id]);
    expect(tombstones()[id]).toBeUndefined();
    // Past it: withdrawn once, as every other way of leaving withdraws.
    await s.advance(30_000);
    expect(withdrawalsOf(spy, TNOTE)).toBe(1);
    expect(adoptedScope()).not.toContain(TNOTE);
    await A.sync();
    expect(A.byPath(TNOTE)).toHaveLength(0);
    expect(tombstones()[id]).toBeTruthy();
    expect(withdrawnNotes()[TNOTE]).toBeTruthy();
    expect(s.text(TNOTE)).toContain(stamped);   // a withdrawal deletes nothing in the vault
    // Nothing more: one withdrawal, however long it stays out.
    await s.advance(300_000);
    expect(withdrawalsOf(spy, TNOTE)).toBe(1);

    // The tag back: adopted at once, re-imported under the same id.
    await withTag(TNOTE);
    expect(adoptedScope()).toContain(TNOTE);
    await s.settle();
    await A.sync();
    expect(A.byPath(TNOTE).map((t) => t.id)).toEqual([id]);
    expect(s.text(TNOTE)!.match(/\^dg-[a-z0-9]{8}/g)).toEqual([stamped]);
  });

  it('T2. a tag removed and restored inside the hold: no withdrawal, and the task is untouched on the app', async () => {
    await bootWithTaggedNote();
    const id = A.byPath(TNOTE)[0].id;
    const before = JSON.parse(JSON.stringify(A.byPath(TNOTE)[0]));
    const spy = spyWithdrawals();
    await withoutTag(TNOTE);          // #work → #wor → … : the retype passes through no tag
    await s.advance(60_000);
    await withTag(TNOTE);
    await s.advance(180_000);          // well past where the first hold would have run out
    await A.sync();
    expect(withdrawalsOf(spy, TNOTE)).toBe(0);
    expect(adoptedScope()).toContain(TNOTE);
    expect(A.byPath(TNOTE).map((t) => t.id)).toEqual([id]);
    expect(JSON.parse(JSON.stringify(A.byPath(TNOTE)[0]))).toEqual(before);
    expect(tombstones()[id]).toBeUndefined();
    expect(withdrawnNotes()[TNOTE]).toBeUndefined();
  });

  it('T2b. the hold measures time out CONTINUOUSLY: back in scope restarts the clock, so a second removal waits its own two minutes', async () => {
    await bootWithTaggedNote();
    const spy = spyWithdrawals();
    await withoutTag(TNOTE);
    await s.advance(60_000);
    await withTag(TNOTE);
    await s.advance(40_000);
    await withoutTag(TNOTE);           // out again at 100s
    await s.advance(40_000);           // 140s after the FIRST removal, 40s into this one
    expect(withdrawalsOf(spy, TNOTE)).toBe(0);
    expect(adoptedScope()).toContain(TNOTE);
    await s.advance(90_000);           // this removal's own two minutes have passed
    expect(withdrawalsOf(spy, TNOTE)).toBe(1);
  });

  it('T2c. back in scope another way during the hold (its folder added to the scope setting): the re-check at expiry keeps it', async () => {
    await bootWithTaggedNote();
    const id = A.byPath(TNOTE)[0].id;
    const spy = spyWithdrawals();
    await withoutTag(TNOTE);
    await s.advance(30_000);
    await s.plugin.setScope({ folders: ['Projects', 'Areas'], tags: ['work'] });
    await s.advance(300_000);
    await A.sync();
    expect(withdrawalsOf(spy, TNOTE)).toBe(0);
    expect(adoptedScope()).toContain(TNOTE);
    expect(A.byPath(TNOTE).map((t) => t.id)).toEqual([id]);
  });

  it('T3. frontmatter briefly broken (no tags parse) and fixed inside the hold: no withdrawal', async () => {
    await bootWithTaggedNote();
    const id = A.byPath(TNOTE)[0].id;
    const good = s.text(TNOTE)!;
    const spy = spyWithdrawals();
    // The closing fence deleted mid-edit: no frontmatter, so no tags at all.
    await s.write(TNOTE, good.replace('tags: [work]\n---\n', 'tags: [work]\n'));
    const file = s.file(TNOTE);
    expect(s.plugin.app.metadataCache.getFileCache(file)?.frontmatter).toBeUndefined();
    await s.advance(45_000);
    await s.write(TNOTE, good);
    await s.advance(180_000);
    await A.sync();
    expect(withdrawalsOf(spy, TNOTE)).toBe(0);
    expect(adoptedScope()).toContain(TNOTE);
    expect(A.byPath(TNOTE).map((t) => t.id)).toEqual([id]);
    expect(tombstones()[id]).toBeUndefined();
  });

  it('T4. a note in scope by a folder AND the tag loses the tag: the folder keeps it, nothing is withdrawn', async () => {
    const SHED = 'Projects/Shed.md';
    await bootWithTaggedNote(SHED);
    const id = A.byPath(SHED)[0].id;
    const spy = spyWithdrawals();
    await withoutTag(SHED);
    await s.advance(300_000);
    await A.sync();
    expect(withdrawalsOf(spy, SHED)).toBe(0);
    expect(adoptedScope()).toContain(SHED);
    expect(A.byPath(SHED).map((t) => t.id)).toEqual([id]);
    expect(tombstones()[id]).toBeUndefined();
  });

  it('T5. a LINKED project note loses the tag: the link is the scope (companion §4.3), nothing is withdrawn', async () => {
    const PLAN = 'Areas/Plan.md';
    await bootWithTaggedNote(PLAN, tagged('dayglance-id: p1\n'));
    expect(s.plugin.transport.linkedNotes().has(PLAN)).toBe(true);
    const id = A.byPath(PLAN)[0].id;
    const spy = spyWithdrawals();
    await withoutTag(PLAN);
    await s.advance(300_000);
    await A.sync();
    expect(s.plugin.transport.linkedNotes().has(PLAN)).toBe(true);
    expect(withdrawalsOf(spy, PLAN)).toBe(0);
    expect(adoptedScope()).toContain(PLAN);
    expect(A.byPath(PLAN).map((t) => t.id)).toEqual([id]);
    expect(tombstones()[id]).toBeUndefined();
  });

  it('T6a. a note DELETED during the hold is reported deleted, never withdrawn: no stray withdrawal when the hold would have run out', async () => {
    await bootWithTaggedNote();
    const spy = spyWithdrawals();
    await withoutTag(TNOTE);
    await s.advance(30_000);
    await s.plugin.app.vault.delete(s.file(TNOTE));
    await s.advance(300_000);
    expect(withdrawalsOf(spy, TNOTE)).toBe(0);
    await A.sync();
    expect(withdrawnNotes()[TNOTE]).toBeUndefined();
    // The deletion path did its own job: the task goes after its hold.
    await s.advance(95_000);
    await A.sync();
    expect(A.byPath(TNOTE)).toHaveLength(0);
    // A new note at the same path, untagged, inherits nothing.
    await s.write(TNOTE, '# Garden again\n');
    await s.advance(300_000);
    expect(withdrawalsOf(spy, TNOTE)).toBe(0);
  });

  it('T6b. a note RENAMED during the hold: the rename path withdraws the old path once, and the hold adds nothing for either path', async () => {
    await bootWithTaggedNote();
    const spy = spyWithdrawals();
    await withoutTag(TNOTE);
    await s.advance(30_000);
    const MOVED = 'Areas/Garden (old).md';
    await s.plugin.app.vault.rename(s.file(TNOTE), MOVED);
    await s.advance(1_000);
    expect(withdrawalsOf(spy, TNOTE)).toBe(1);   // the rename's own re-classification (still out of scope)
    await s.advance(300_000);
    expect(withdrawalsOf(spy, TNOTE)).toBe(1);
    expect(withdrawalsOf(spy, MOVED)).toBe(0);
    expect(adoptedScope()).not.toContain(TNOTE);
    expect(adoptedScope()).not.toContain(MOVED);
    await A.sync();
    expect(A.all().filter((t) => t.title.startsWith(ROSES))).toHaveLength(0);
  });

  it('T7. the plugin disposed during the hold: no withdrawal', async () => {
    await bootWithTaggedNote();
    const id = A.byPath(TNOTE)[0].id;
    const spy = spyWithdrawals();
    await withoutTag(TNOTE);
    await s.advance(30_000);
    s.plugin.shutdown();
    await s.advance(300_000);
    expect(withdrawalsOf(spy, TNOTE)).toBe(0);
    await A.sync();
    expect(A.byPath(TNOTE).map((t) => t.id)).toEqual([id]);
    expect(tombstones()[id]).toBeUndefined();
  });

  it('T8. a reload during the hold (or a tag gone while Obsidian was closed): the first adoption walk re-arms the hold; a note whose metadata is not parsed yet waits rather than reading as untagged', async () => {
    await bootWithTaggedNote();
    const id = A.byPath(TNOTE)[0].id;
    await withoutTag(TNOTE);
    await s.advance(30_000);
    s.plugin.reload();                     // the hold is memory-only: lost here
    const spy = spyWithdrawals();
    // The metadata cache is still indexing the note when the walk runs, and
    // stays so past the re-armed hold: no information, so no withdrawal.
    const cache = s.plugin.app.metadataCache;
    const real = cache.getFileCache.bind(cache);
    const unparsed = vi.spyOn(cache, 'getFileCache').mockImplementation((f) => (f.path === TNOTE ? null : real(f)));
    s.plugin.transport.adoptTick();        // main.ts: at layout ready
    await s.advance(130_000);
    expect(withdrawalsOf(spy, TNOTE)).toBe(0);
    expect(adoptedScope()).toContain(TNOTE);
    await A.sync();
    expect(A.byPath(TNOTE).map((t) => t.id)).toEqual([id]);
    // Parsed: the waiting hold re-checks and withdraws.
    unparsed.mockRestore();
    await s.advance(130_000);
    expect(withdrawalsOf(spy, TNOTE)).toBe(1);
    await A.sync();
    expect(A.byPath(TNOTE)).toHaveLength(0);
    expect(tombstones()[id]).toBeTruthy();
  });

  it('T9. a note that BECOMES a daily note (the daily-notes path moved onto its folder) is never withdrawn when it loses the tag', async () => {
    const DAY = 'Areas/2026-09-20.md';
    await bootWithTaggedNote(DAY);
    const spy = spyWithdrawals();
    // dayGLANCE's config row now puts daily notes in Areas/.
    const t = s.plugin.transport as any;
    t.config = { ...t.config, dailyNotesPath: 'Areas' };
    await withoutTag(DAY);
    await s.advance(300_000);
    expect(withdrawalsOf(spy, DAY)).toBe(0);
  });
});

describe('plugin resilience (the post-soak audit batch)', () => {
  const intentRows = () => s.vault.live(BRIDGE_VAULT_APP).filter((r) => r.entityId.startsWith('int:')).map((r) => r.entityId);

  it('R1 (M4): an edit whose report was still debouncing when the plugin reloaded is reported after the reload', async () => {
    await bootWithScopedNote();
    const stamped = s.text(NOTE)!;
    await s.write(NOTE, `${stamped}- [ ] Fix the gate\n`);
    // The report is armed (2s debounce) and the pending path persisted...
    expect(s.plugin.data.bridge!.pendingObservations).toEqual([NOTE]);
    // ...then the plugin reloads before it fires (an update, a webview kill).
    s.plugin.reload();
    await s.settle();
    await A.sync();
    expect(A.byPath(NOTE).map((t) => String(t.title).replace(/ #obsidian$/, '')).sort()).toEqual(['Call the plumber', 'Fix the gate']);
    expect(s.plugin.data.bridge!.pendingObservations).toEqual([]);
  });

  it('R1b (M4): a report that FAILED and was waiting to retry survives the reload too', async () => {
    await bootWithScopedNote();
    const stamped = s.text(NOTE)!;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      s.vault.failNextBatches = 1; // the observation's write meets a 502
      await s.write(NOTE, `${stamped}- [ ] Fix the gate\n`);
      // Debounce, settle floor, re-arm, then the report (~14s): attempted and
      // failed, its 5s retry armed — and the plugin reloads before that fires.
      await s.advance(16_000);
      expect(s.vault.failNextBatches).toBe(0);
      expect(s.plugin.data.bridge!.pendingObservations).toEqual([NOTE]);
      s.plugin.reload();
      await s.settle();
      await A.sync();
      expect(A.byPath(NOTE)).toHaveLength(2);
    } finally { errSpy.mockRestore(); }
  });

  it('R2 (M12): a deleted report for a path that EXISTS reports the note as it stands, never as gone', async () => {
    await bootWithScopedNote();
    // A stale deleted-report retry firing after the file was recreated: the
    // event said "deleted", the vault says the note is there.
    s.plugin.transport.reportDeleted(NOTE);
    await s.settle();
    await A.sync();
    await s.advance(95_000);
    await A.sync();
    await A.sync();
    expect(A.byPath(NOTE)).toHaveLength(1);
    expect(JSON.parse(A.store.get('day-planner-deleted-obsidian-keys') ?? '{}')).toEqual({});
  });

  it('R3: an UNSUPPORTED intent row re-listed under a retryFloor clamp is left for a newer build, not deleted', async () => {
    await bootWithScopedNote();
    const token = /\^dg-([a-z0-9]{8})/.exec(s.text(NOTE)!)![1];
    // A dirty editor on the note DEFERS the first intent (retryFloor below it)...
    s.plugin.app.workspace.openEditor(s.file(NOTE), `${s.text(NOTE)}typing…`);
    await A.emit('task_state', { path: NOTE, blockId: token, obsidianRawTitle: LINE, completed: true });
    // ...and the second row, an intent type this build does not know, sits above it.
    await A.emit('frobnicate', { path: NOTE });
    const before = intentRows();
    expect(before).toHaveLength(2);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (let i = 0; i < 3; i++) { await s.plugin.transport.drain(); await s.advance(500); }
    } finally { warnSpy.mockRestore(); }
    // Both rows still stand: the deferred one for the retry, the unsupported one for a newer build.
    expect(intentRows().sort()).toEqual(before.sort());
    expect(s.plugin.data.bridge!.unsupportedIds).toHaveLength(1);
  });

  it('R4: the linked-note map survives an intent persist (the drain\'s save used to replace the state without it)', async () => {
    await bootWithScopedNote();
    s.plugin.data.bridge = { ...s.plugin.data.bridge!, linkedNotes: { 'Projects/Plan.md': 'proj-1' } };
    s.plugin.reload();
    const token = /\^dg-([a-z0-9]{8})/.exec(s.text(NOTE)!)![1];
    await A.emit('task_state', { path: NOTE, blockId: token, obsidianRawTitle: LINE, completed: true });
    await s.plugin.transport.drain();
    await s.advance(500);
    expect(s.text(NOTE)).toMatch(/- \[x\] Call the plumber/);
    expect(s.plugin.data.bridge!.linkedNotes).toEqual({ 'Projects/Plan.md': 'proj-1' });
  });

  it('R5: the pairing-meta publish\'s ack is recorded as our own, so its SSE echo does not wake a drain', async () => {
    await s.plugin.transport.drain(); // publishes meta:pairing
    const meta = s.vault.all(BRIDGE_VAULT_APP).find((r) => r.entityId === BRIDGE_PAIRING_META_ID)!;
    expect(meta).toBeDefined();
    const gate = (s.plugin.transport as any).sseGate as { handleEvent(evt: { seq: number; app?: string }): boolean };
    expect(gate.handleEvent({ seq: meta.seq, app: BRIDGE_VAULT_APP })).toBe(false);
  });
});
