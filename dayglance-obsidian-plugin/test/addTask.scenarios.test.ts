// Bridge scenario harness: "Add to dayGLANCE" (companion spec 4.2.1). The
// real plugin (addSelectionAsTask, the agenda store's emit, the transport's
// reports and stamps) against the real app (useBridgeTaskCreates on devices
// with and without the vault folder, useObsidianSync for the completion path
// and the task's note), over one in-memory GLANCEvault.
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
const { default: useBridgeTaskCreates } = await import('../../src/hooks/useBridgeTaskCreates.js');
const { __resetBridgeStreamForTests } = await import('../../src/utils/obsidianBridgeStream.js');
const { extractWikilinks } = await import('../../src/utils/taskUtils.js');
const { mergeTaskArrays } = await import('../../src/mergeSync.js');
const { dropResurrectedTasks } = await import('../../src/utils/dropResurrectedTasks.js');
const { AgendaStore } = await import('../src/agenda');
const { addSelectionAsTask, titleFromSelection } = await import('../src/addTask');
const { StubEditor } = await import('obsidian');
const { importBridgeSubkey, openBridgeEnvelope, BRIDGE_VAULT_APP, BRIDGE_ACTION_PREFIX, BRIDGE_CREATE_ACTION_PREFIX } = await import('@glance-apps/obsidian-format');
const { encryptEntity } = await import('@glance-apps/sync/src/dbCrypto.js');

type Row = Record<string, any>;
const OBSIDIAN_CONFIG = { enabled: true, dailyNotesPath: 'Daily', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks' };
const DELETED = 'day-planner-deleted-task-ids';

/**
 * One dayGLANCE device. `folder: false` cannot read the vault folder (a
 * phone paired only through GLANCEvault): no Obsidian cycle can run there.
 * Every device runs the create consumer. The setters stand in for the
 * persist pass: while `saving`, a list change is written to the device's
 * storage as useDataPersistence writes it; turned off, the app "dies" before
 * its save.
 */
function mountDevice(name: string, { folder = false, projects = [] as Row[], users = [] as Row[], multiUserEnabled = false } = {}) {
  const store = new Map<string, string>();
  const ls = { getItem: (k: string) => (store.has(k) ? store.get(k)! : null), setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); }, clear: () => store.clear() };
  const activate = () => { (globalThis as any).localStorage = ls; };
  const run = async <T,>(fn: () => Promise<T> | T): Promise<T> => { activate(); const out = await fn(); await advanceFake(300); return out; };
  ls.setItem('dayglance-vault-config', JSON.stringify({ enabled: true, vaultUrl: VAULT_URL, vaultToken: `token-${name}`, accountId: ACCOUNT_ID }));
  const dev = { saving: true };
  const state = { tasks: [] as Row[], inbox: [] as Row[], recycleBin: [] as Row[], recurring: [] as Row[], projects, users };
  const replace = (arr: Row[], next: Row[]) => { arr.splice(0, arr.length, ...next); };
  const save = () => {
    if (!dev.saving) return;
    store.set('day-planner-tasks', JSON.stringify(state.tasks));
    store.set('day-planner-unscheduled', JSON.stringify(state.inbox));
  };
  const setTasks = (up: Row[] | ((p: Row[]) => Row[])) => { replace(state.tasks, typeof up === 'function' ? up([...state.tasks]) : up); save(); };
  const setUnscheduledTasks = (up: Row[] | ((p: Row[]) => Row[])) => { replace(state.inbox, typeof up === 'function' ? up([...state.inbox]) : up); save(); };
  effects.length = 0;
  activate();
  const handle = folder ? { name: 'Vault' } : null;
  const obs = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: state.tasks, setTasks, unscheduledTasks: state.inbox, setUnscheduledTasks,
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: OBSIDIAN_CONFIG,
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null, obsidianCompletionDates: false, obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError: vi.fn(), setObsidianLastSynced: vi.fn(), setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: handle }, obsidianSyncInProgressRef: { current: false }, obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: { current: state.tasks }, obsidianInboxRef: { current: state.inbox },
    recycleBin: state.recycleBin, setRecycleBin: vi.fn(),
    projects: state.projects, goals: [], updateProject: vi.fn(), updateGoal: vi.fn(),
  });
  if (folder) obs.bridgeHeartbeatRef.current = { obsidianRunning: true, pluginAuthoritative: true };
  const creates = useBridgeTaskCreates({
    dataLoaded: true, isTrayMode: false,
    tasks: state.tasks, unscheduledTasks: state.inbox, recurringTasks: state.recurring, recycleBin: state.recycleBin,
    projects: state.projects, users: state.users, multiUserEnabled,
    setUnscheduledTasks,
    // Each device's passes are run by the test, under that device's storage.
    followUpMs: null,
  });
  return {
    name, dev, state, store, run, obs,
    /** One create pass, under this device's storage. */
    consume: () => run(() => until(creates.consumeBridgeTaskCreates())),
    /** One Obsidian cycle (a folder device: the completion path lives there). */
    sync: () => run(() => until(obs.performObsidianSync())),
    all: () => [...state.tasks, ...state.inbox],
    /** The app restarts: state is what its storage holds. */
    restart: () => {
      replace(state.tasks, JSON.parse(store.get('day-planner-tasks') ?? '[]'));
      replace(state.inbox, JSON.parse(store.get('day-planner-unscheduled') ?? '[]'));
    },
    /** The user deletes a task for good here: gone from the lists, tombstoned now. */
    deleteForGood: (id: string) => {
      setUnscheduledTasks((p) => p.filter((t) => t.id !== id));
      setTasks((p) => p.filter((t) => t.id !== id));
      const tombs = JSON.parse(store.get(DELETED) ?? '{}');
      tombs[id] = new Date().toISOString();
      store.set(DELETED, JSON.stringify(tombs));
    },
  };
}
type Device = ReturnType<typeof mountDevice>;

let s: Awaited<ReturnType<typeof createScenario>>;
let F: Device; // the desktop with the vault folder
let agenda: InstanceType<typeof AgendaStore>;
let viewer: string | null;

async function boot(): Promise<void> {
  await s.plugin.transport.drain();
  F = mountDevice('F', { folder: true });
  await F.sync();
  for (let i = 0; i < 5 && s.plugin.transport.stampingState() !== 'armed'; i++) { await s.advance(1000); await s.plugin.transport.drain(); }
  if (s.plugin.transport.stampingState() !== 'armed') throw new Error('boot: plugin not armed');
  await s.advance(2500);
}

/** Select [from, to] in a note's editor and press Add with `values` (the title is the form's prefill unless given). */
async function addFromObsidian(path: string, sel: { from: { line: number; ch: number }; to: { line: number; ch: number } }, values: Row = {}, { linkToBlock = false } = {}) {
  const file = s.file(path);
  const editor = new StubEditor(file, s.text(path)!, sel);
  const prefill = titleFromSelection(editor.getSelection());
  const r = await until(addSelectionAsTask({
    app: s.plugin.app as any, editor: editor as any, file: file as any,
    from: editor.getCursor('from'), to: editor.getCursor('to'),
    values: { title: prefill, deadline: null, priority: 0, projectId: null, ...values },
    linkToBlock,
    emit: (input) => agenda.createTask(input),
  }));
  return { r, editor, prefill };
}

const subkeyP = () => importBridgeSubkey(s.pairing.subkeyB64);
async function liveRows(prefix: string): Promise<Array<{ entityId: string; payload: any }>> {
  const subkey = await subkeyP();
  const out: Array<{ entityId: string; payload: any }> = [];
  for (const row of s.vault.live(BRIDGE_VAULT_APP)) {
    if (!row.entityId.startsWith(prefix) || !row.envelope) continue;
    out.push({ entityId: row.entityId, payload: await openBridgeEnvelope(subkey, row.envelope) });
  }
  return out;
}
const idFor = (actionId: string) => `bridge-add-${actionId}`;

beforeEach(async () => {
  vi.useFakeTimers({ now: new Date('2026-11-06T12:00:00.000Z') });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { cb(); return 1; });
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  __resetBridgeStreamForTests();
  s = await createScenario();
  viewer = null;
  agenda = new AgendaStore({
    app: s.plugin.app as any,
    getPairing: () => s.pairing,
    getViewer: () => viewer,
    getWriteGate: () => s.plugin.transport,
  });
});
afterEach(() => { agenda.dispose(); s.plugin.shutdown(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('Add to dayGLANCE: a selection in Obsidian becomes one inbox task', () => {
  it('1. selection → form → action row → a FOLDERLESS device creates the inbox task with the title and the link; the row goes only once the task is saved; the task panel finds the note from the stream', async () => {
    await boot();
    const DAILY = 'Daily/2026-11-06.md';
    await s.write(DAILY, '# Thursday\n\nRemember to call the\nplumber about the leak.\n');
    await s.settle();

    const { r, editor, prefill } = await addFromObsidian(DAILY, { from: { line: 2, ch: 12 }, to: { line: 3, ch: 23 } }, { deadline: '2026-11-10', priority: 2 });
    expect(prefill).toBe('call the plumber about the leak.');
    expect(r).toMatchObject({ ok: true, title: 'call the plumber about the leak. [[2026-11-06]]' });
    // The setting is off: the note was not touched.
    expect(editor.edits).toEqual([]);

    const rows = await liveRows(BRIDGE_CREATE_ACTION_PREFIX);
    expect(rows).toHaveLength(1);
    const action = rows[0].payload;
    expect(action).toMatchObject({
      v: 1, kind: 'action', type: 'task_create', title: 'call the plumber about the leak. [[2026-11-06]]',
      notePath: DAILY, deadline: '2026-11-10', priority: 2,
    });
    expect(rows[0].entityId).toBe(`${BRIDGE_CREATE_ACTION_PREFIX}${action.actionId}`);
    expect(Date.parse(action.createdAt)).toBeLessThanOrEqual(Date.now());
    // Not an `act:` row: an app built before task_create would delete it.
    expect(await liveRows(BRIDGE_ACTION_PREFIX)).toEqual([]);

    // The phone: no folder, no Obsidian cycle; the create pass alone.
    const P = mountDevice('P');
    await P.consume();
    expect(P.state.inbox).toHaveLength(1);
    const task = P.state.inbox[0];
    expect(task).toMatchObject({
      id: idFor(action.actionId), title: 'call the plumber about the leak. [[2026-11-06]]',
      completed: false, priority: 2, deadline: '2026-11-10', duration: 30, createdAt: action.createdAt,
    });
    for (const k of ['importSource', 'obsidianBlockId', 'obsidianNotePath', 'obsidianFileDate']) expect(task).not.toHaveProperty(k);
    // Created and saved, but the row is still there: it is deleted by the NEXT pass, which finds it saved.
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toHaveLength(1);
    await P.consume();
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toEqual([]);
    expect(P.state.inbox).toHaveLength(1);

    // The task panel on the phone: the [[link]] resolves to the plugin's report of the note.
    const [link] = extractWikilinks(task.title);
    expect(await P.run(() => P.obs.loadTaskNote(link))).toMatchObject({ path: DAILY, source: 'report', text: s.text(DAILY) });
  });

  it('1b. the app dies between the create and its save: the row stays, and the restarted app creates the task again', async () => {
    await boot();
    await s.write('Inbox.md', 'Renew the passport\n');
    await s.settle();
    await addFromObsidian('Inbox.md', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 18 } });
    const P = mountDevice('P');
    P.dev.saving = false;
    await P.consume();
    expect(P.state.inbox).toHaveLength(1);
    await P.consume(); // still unsaved: held, not created twice
    expect(P.state.inbox).toHaveLength(1);
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toHaveLength(1);
    P.restart();
    expect(P.state.inbox).toEqual([]);
    P.dev.saving = true;
    await P.consume();
    expect(P.state.inbox.map((t) => t.title)).toEqual(['Renew the passport [[Inbox]]']);
    await P.consume();
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toEqual([]);
  });

  it('2. two devices race the same action: both build the SAME task, sync merges them into one, and the row goes once', async () => {
    await boot();
    await s.write('Ideas.md', 'Build a bird feeder\n');
    await s.settle();
    await addFromObsidian('Ideas.md', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 19 } });
    const P = mountDevice('P');
    const Q = mountDevice('Q');
    await P.consume();
    await Q.consume();
    expect(P.state.inbox).toHaveLength(1);
    expect(Q.state.inbox).toHaveLength(1);
    expect(Q.state.inbox[0]).toEqual(P.state.inbox[0]);
    const merged = mergeTaskArrays(P.state.inbox, Q.state.inbox, {});
    expect(merged.merged).toHaveLength(1);
    expect(merged.localChanged || merged.remoteChanged).toBe(false);
    await P.consume();
    await Q.consume();
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toEqual([]);
    expect(P.all()).toHaveLength(1);
    expect(Q.all()).toHaveLength(1);
  });

  it('3. NO RESURRECTION: deleted on device A, the action applied late on device B never brings the task back', async () => {
    await boot();
    await s.write('Chores.md', 'Clean the gutters\n\nSort the garage\n');
    await s.settle();
    const A = mountDevice('A');
    const B = mountDevice('B');

    // (a) B has heard of the deletion: consumed without creating.
    await addFromObsidian('Chores.md', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 17 } });
    const [first] = await liveRows(BRIDGE_CREATE_ACTION_PREFIX);
    await A.consume(); // created and saved on A; A closes before its next pass, so the row stays
    await advanceFake(60_000);
    A.deleteForGood(idFor(first.payload.actionId));
    B.store.set(DELETED, A.store.get(DELETED)!); // synced to B
    await B.consume();
    expect(B.all()).toEqual([]);
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toEqual([]);
    // A, back, does not recreate it either (its row is gone, and its tombstone stands).
    await A.consume();
    expect(A.all()).toEqual([]);

    // (b) B has NOT heard of it yet: B creates its copy, but the copy is
    // stamped at the action, older than the deletion, so it loses everywhere.
    await addFromObsidian('Chores.md', { from: { line: 2, ch: 0 }, to: { line: 2, ch: 15 } });
    const [second] = await liveRows(BRIDGE_CREATE_ACTION_PREFIX);
    const id2 = idFor(second.payload.actionId);
    await A.consume();
    await advanceFake(60_000);
    A.deleteForGood(id2);
    await B.consume();
    expect(B.state.inbox.map((t) => t.id)).toEqual([id2]);
    const tombs = JSON.parse(A.store.get(DELETED)!);
    expect(Date.parse(B.state.inbox[0].lastModified)).toBeLessThan(Date.parse(tombs[id2]));
    expect(mergeTaskArrays(B.state.inbox, A.state.inbox, tombs).merged.map((t: Row) => t.id)).not.toContain(id2);
    expect(dropResurrectedTasks(B.state.inbox, tombs)).toEqual([]);
    // Once the tombstone reaches B, B's next pass consumes the row instead of creating anything.
    B.store.set(DELETED, A.store.get(DELETED)!);
    B.deleteForGood(id2);
    await B.consume();
    expect(B.all()).toEqual([]);

    // (c) In the recycle bin (not yet tombstoned): not created again either.
    await addFromObsidian('Chores.md', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 5 } });
    const [third] = await liveRows(BRIDGE_CREATE_ACTION_PREFIX);
    const id3 = idFor(third.payload.actionId);
    await A.consume();
    const binned = A.state.inbox.find((t) => t.id === id3)!;
    A.state.recycleBin.push({ ...binned, deletedAt: new Date().toISOString() });
    A.state.inbox.splice(A.state.inbox.indexOf(binned), 1);
    await A.consume();
    expect(A.all().map((t) => t.id)).not.toContain(id3);
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toEqual([]);
  });

  it('4. PROJECTS: the form offers the active projects from the mirror (not goals, not archived or completed ones); a known project is set, an unknown one is dropped and the task still created; the vault viewer owns it in a multi-user account', async () => {
    await boot();
    const rows: Array<{ entityId: string; envelope: string }> = [];
    const put = async (kind: string, value: Row) => {
      const entityId = `${kind}:${value.id}`;
      rows.push({ entityId, envelope: await encryptEntity({ _kind: kind, value }, entityId) });
    };
    await put('goals', { id: 'g1', title: 'Home', status: 'active' });
    await put('projects', { id: 'p1', title: 'House', status: 'active', goalId: 'g1' });
    await put('projects', { id: 'p2', title: 'Old shed', status: 'archived' });
    await put('projects', { id: 'p3', title: 'Paint fence', status: 'completed' });
    await put('projects', { id: 'p9', title: 'Garden', status: 'active' });
    s.vault.handle('POST', `${VAULT_URL}/sync/dayglance/batch`, JSON.stringify({ rows }));
    await until(agenda.refresh());
    expect(agenda.projectChoices()).toEqual([
      { id: 'p9', title: 'Garden', goalTitle: undefined },
      { id: 'p1', title: 'House', goalTitle: 'Home' },
    ]);

    await s.write('House.md', 'Fix the gutter\n\nPlant tulips\n');
    await s.settle();
    viewer = 'u-ann';
    await addFromObsidian('House.md', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 14 } }, { projectId: 'p1' });
    // p9 was deleted in dayGLANCE since the mirror last read it.
    await addFromObsidian('House.md', { from: { line: 2, ch: 0 }, to: { line: 2, ch: 12 } }, { projectId: 'p9', priority: 3 });
    const P = mountDevice('P', {
      projects: [{ id: 'p1', title: 'House', status: 'active', goalId: 'g1' }],
      users: [{ syncId: 'u-ann', name: 'Ann' }, { syncId: 'u-bob', name: 'Bob' }],
      multiUserEnabled: true,
    });
    await P.consume();
    const byTitle = Object.fromEntries(P.state.inbox.map((t) => [t.title, t]));
    expect(byTitle['Fix the gutter [[House]]']).toMatchObject({ projectId: 'p1', assignedUserSyncIds: ['u-ann'] });
    expect(byTitle['Plant tulips [[House]]']).toMatchObject({ priority: 3, assignedUserSyncIds: ['u-ann'] });
    expect(byTitle['Plant tulips [[House]]']).not.toHaveProperty('projectId');

    // Without the passphrase on this device there is no mirror: no project field.
    await agenda.forgetKey();
    expect(agenda.projectChoices()).toBe(null);
  });

  it('5. "Link to the exact paragraph": off, a plain link and the note untouched; on, a block id added once (through the editor, selection kept) and reused by a second task from the same paragraph; a stamped task line links to the note, never by its ^dg- stamp, and nothing is added; an unstamped task line is never given one; the app parses the note as before', async () => {
    await boot();
    const DAILY = 'Daily/2026-11-06.md';
    await s.write(DAILY, '# Thursday\n\nThe boiler makes a noise\nwhen the heating starts.\n\n## Tasks\n- [ ] Book the service\n- [ ] Buy filters\n');
    await s.settle();
    await F.sync();
    const stampedText = s.text(DAILY)!;
    const stamp = /Book the service \^dg-([a-z0-9]+)/.exec(stampedText)?.[1];
    expect(stamp).toBeTruthy();
    const parsedBefore = F.all().map((t) => ({ id: t.id, title: t.title })).sort((a, b) => a.id.localeCompare(b.id));
    expect(parsedBefore.length).toBe(2);
    const lineOf = (needle: string) => s.text(DAILY)!.split('\n').findIndex((l) => l.includes(needle));

    // Off: a plain link, nothing written.
    const off = await addFromObsidian(DAILY, { from: { line: 2, ch: 4 }, to: { line: 2, ch: 10 } });
    expect(off.r.title).toBe('boiler [[2026-11-06]]');
    expect(off.editor.edits).toEqual([]);
    expect(s.text(DAILY)).toBe(stampedText);

    // On: one id at the end of the paragraph's last line, through the editor.
    const on = await addFromObsidian(DAILY, { from: { line: 2, ch: 4 }, to: { line: 2, ch: 10 } }, {}, { linkToBlock: true });
    expect(on.editor.edits).toHaveLength(1);
    const minted = /#\^([a-z0-9]{6})\]\]$/.exec(on.r.title!)?.[1];
    expect(minted).toBeTruthy();
    expect(on.r.title).toBe(`boiler [[2026-11-06#^${minted}]]`);
    expect(on.editor.getLine(3)).toBe(`when the heating starts. ^${minted}`);
    expect(on.editor.listSelections()).toEqual([{ anchor: { line: 2, ch: 4 }, head: { line: 2, ch: 10 } }]);
    // No dayGLANCE id was minted: the buffer holds exactly the stamps the plugin wrote.
    const dgTokens = (t: string) => (t.match(/\^dg-/g) || []).length;
    expect(dgTokens(on.editor.getValue())).toBe(dgTokens(stampedText));
    // Nothing reached the file yet (the buffer is Obsidian's); its autosave writes it.
    expect(s.text(DAILY)).toBe(stampedText);
    await on.editor.save();
    await s.settle();

    // A second task from the same paragraph reuses the id: nothing added.
    const again = await addFromObsidian(DAILY, { from: { line: 3, ch: 0 }, to: { line: 3, ch: 8 } }, {}, { linkToBlock: true });
    expect(again.editor.edits).toEqual([]);
    expect(again.r.title).toBe(`when the [[2026-11-06#^${minted}]]`);
    expect((s.text(DAILY)!.match(new RegExp(`\\^${minted}`, 'g')) || []).length).toBe(1);

    // A stamped task line: linked to the note, never by its ^dg- stamp (a
    // title holding one is refused a stamp by the writeback); nothing is added.
    const onTask = await addFromObsidian(DAILY, { from: { line: lineOf('Book the service'), ch: 6 }, to: { line: lineOf('Book the service'), ch: 22 } }, {}, { linkToBlock: true });
    expect(onTask.editor.edits).toEqual([]);
    expect(onTask.r.title).toBe('Book the service [[2026-11-06]]');
    expect(onTask.r.title).not.toContain('^dg-');

    // Every task line in this note is stamped by now; an unstamped one in an
    // unscoped note is never given an id, and the notice says so.
    await s.write('Loose.md', '- [ ] Water the plants\n');
    await s.settle();
    const loose = await addFromObsidian('Loose.md', { from: { line: 0, ch: 6 }, to: { line: 0, ch: 22 } }, {}, { linkToBlock: true });
    expect(loose.editor.edits).toEqual([]);
    expect(loose.r).toMatchObject({ ok: true, title: 'Water the plants [[Loose]]' });
    expect(loose.r.message).toContain('a task line gets its id from dayGLANCE');

    // The app's parse of the daily note is what it was before the id: same tasks, same titles.
    await F.sync();
    const parsedAfter = F.all().filter((t) => t.importSource === 'obsidian').map((t) => ({ id: t.id, title: t.title })).sort((a, b) => a.id.localeCompare(b.id));
    expect(parsedAfter).toEqual(parsedBefore);
    expect(s.text(DAILY)).toContain(`- [ ] Book the service ^dg-${stamp}`);

    // A folderless device resolves the block link to the note.
    const P = mountDevice('P');
    await P.consume();
    const blockTask = P.state.inbox.find((t) => t.title === `boiler [[2026-11-06#^${minted}]]`)!;
    expect(blockTask).toBeTruthy();
    expect(await P.run(() => P.obs.loadTaskNote(extractWikilinks(blockTask.title)[0]))).toMatchObject({ path: DAILY, source: 'report' });
  });

  it('6. a note in a subfolder whose name another note shares: a PATH link, which the folderless device resolves to the right note; "Open in Obsidian" names the file without the block part', async () => {
    await boot();
    await s.plugin.setScope({ folders: ['Projects', 'Areas'] });
    await s.write('Projects/House/Plan.md', 'Replace the kitchen tap\n');
    await s.write('Areas/Plan.md', 'Another plan entirely\n');
    await s.settle();
    const { r } = await addFromObsidian('Projects/House/Plan.md', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 23 } });
    expect(r.title).toBe('Replace the kitchen tap [[Projects/House/Plan]]');
    const withBlock = await addFromObsidian('Projects/House/Plan.md', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 7 } }, {}, { linkToBlock: true });
    const id = /#\^([a-z0-9]{6})\]\]$/.exec(withBlock.r.title!)?.[1];
    expect(withBlock.r.title).toBe(`Replace [[Projects/House/Plan#^${id}]]`);

    const P = mountDevice('P');
    await P.consume();
    expect(P.state.inbox).toHaveLength(2);
    for (const t of P.state.inbox) {
      expect(await P.run(() => P.obs.loadTaskNote(extractWikilinks(t.title)[0]))).toMatchObject({ path: 'Projects/House/Plan.md', source: 'report', text: 'Replace the kitchen tap\n' });
    }

    const open = vi.fn();
    (globalThis as any).open = open;
    F.obs.openInObsidian(`Projects/House/Plan#^${id}`);
    expect(open).toHaveBeenCalledWith('obsidian://open?vault=Vault&file=Projects%2FHouse%2FPlan', '_blank');
  });

  it('7. a task_complete on the same stream is still applied by the folder device, whichever device consumes first: the create consumer never moves the completion cursor or deletes a completion, and the completion consumer never touches a create', async () => {
    await boot();
    await s.write('Errands.md', 'Post the parcel\n\nPick up the dry cleaning\n');
    await s.settle();
    const item = (id: string): any => ({ id, title: id, startTime: null, duration: 30, color: null, isAllDay: false, completed: false, recurring: false, date: '2026-11-06' });

    // Order A: the folderless device consumes the create first.
    F.state.inbox.push({ id: 't1', title: 'Call mum', completed: false, lastModified: '2026-11-01T00:00:00.000Z' });
    expect((await until(agenda.complete(item('t1')))).ok).toBe(true);
    await addFromObsidian('Errands.md', { from: { line: 0, ch: 0 }, to: { line: 0, ch: 15 } });
    const P = mountDevice('P');
    await P.consume();
    await P.consume();
    expect(P.state.inbox.map((t) => t.title)).toEqual(['Post the parcel [[Errands]]']);
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toEqual([]);
    // The completion is still on the stream, and P's completion cursor is untouched.
    expect((await liveRows(BRIDGE_ACTION_PREFIX)).map((r) => r.payload.taskId)).toEqual(['t1']);
    expect(P.store.get('dayglance-bridge-act-hwm')).toBeUndefined();
    await F.sync();
    expect(F.state.inbox.find((t) => t.id === 't1')).toMatchObject({ completed: true });
    expect(await liveRows(BRIDGE_ACTION_PREFIX)).toEqual([]);

    // Order B: the folder device's Obsidian cycle runs first.
    F.state.inbox.push({ id: 't2', title: 'Water plants', completed: false, lastModified: '2026-11-01T00:00:00.000Z' });
    expect((await until(agenda.complete(item('t2')))).ok).toBe(true);
    await addFromObsidian('Errands.md', { from: { line: 2, ch: 0 }, to: { line: 2, ch: 24 } });
    await F.sync();
    expect(F.state.inbox.find((t) => t.id === 't2')).toMatchObject({ completed: true });
    // Its completion cursor passed the create row, which it neither applied nor deleted.
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toHaveLength(1);
    expect(F.all().map((t) => t.title)).not.toContain('Pick up the dry cleaning [[Errands]]');
    await P.consume();
    await P.consume();
    expect(P.state.inbox.map((t) => t.title)).toEqual(['Post the parcel [[Errands]]', 'Pick up the dry cleaning [[Errands]]']);
    expect(await liveRows(BRIDGE_CREATE_ACTION_PREFIX)).toEqual([]);
  });
});
