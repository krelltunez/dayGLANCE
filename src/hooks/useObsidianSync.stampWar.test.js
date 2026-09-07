import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// THE SCHEDULE-WHILE-PAIRED DUPLICATE (gate (a), the GENERAL RULE — third
// form; see the writeback's comment and the spec's twice-corrected record).
// Reproduces the 2026-08-30 duplicate: an UNTAGGED task, title unchanged,
// scheduled from dayGLANCE while the plugin is authoritative. The write is a
// plain task_state intent — but it carries the OPPORTUNISTIC BLOCK-ID STAMP,
// which is an identity move (legacy → ^dg-) exactly like a retitle. Shape 2
// (#1482) committed bookkeeping for retitles only; these tests pin the
// general rule: EVERY identity move commits its retirement on enqueue,
// regardless of what triggered the write.
//
// The counterfactual here is LAYERED, because that subtlety is the bug:
// without the commit, the observation-merge STILL collapses the copies (the
// legacy hint works — pinned below), but the DB tier's snapshot-delete guard
// sees the legacy id vanish with NO retirement on record, classifies the
// drop as a glitch, and heals the old copy back from the vault. The merge
// was fine; the missing record one layer down made the duplicate permanent.

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

vi.mock('../obsidian.js', async (importOriginal) => {
  const actual = await importOriginal();
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
    readVaultHeartbeat: vi.fn(async () => null),
    readVaultHeartbeatNative: vi.fn(() => null),
  };
});
vi.mock('../native.js', () => ({
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
const emitBridgeIntent = vi.fn(() => true);
vi.mock('../utils/obsidianBridgeStream.js', () => ({
  cachedBridgePairingMeta: () => null,
  emitBridgeIntent: (...a) => emitBridgeIntent(...a),
  flushBridgeOutbox: vi.fn(async () => true),
  publishBridgeConfig: vi.fn(async () => {}),
  getBridgePairingMeta: vi.fn(async () => null),
}));
vi.mock('../utils/obsidianBridgeMode.js', () => ({
  recordBridgeMode: vi.fn(),
  reconcileArchivedBaseline: vi.fn(() => null),
}));

const { default: useObsidianSync } = await import('./useObsidianSync.js');
const { legacyObsidianId, deriveBlockId, appIdForBlockId, applyBridgeIntent } =
  await import('@glance-apps/obsidian-format');
const { applyBridgeObservations } = await import('../utils/obsidianBridgeInbound.js');
const { mergeObsidianTasks } = await import('../utils/mergeObsidianTasks.js');
const { RETIRED_TASK_IDS_STORAGE_KEY } = await import('../utils/retiredTaskIds.js');
const { __setBlockIdWritesForTests } = await import('../utils/obsidianWritePolicy.js');
const { partitionSnapshotDeletes } = await import('../sync/snapshotDeleteGuard.js');

const DATE = '2026-08-30';
const RAW = 'Testing latest updates';
const LEGACY_ID = legacyObsidianId(DATE, RAW);
const BLOCK = deriveBlockId(DATE, RAW);
const DG_ID = appIdForBlockId(BLOCK);
const NOTE = `# Day\n\n## Tasks\n- [ ] ${RAW}\n`;

// The task as it sits in app state right after the user SCHEDULED the
// imported untagged task: same title, same legacy id, new time — the
// state change that fires the writeback and, with it, the stamp.
const scheduledLegacyTask = () => ({
  id: LEGACY_ID, title: `${RAW} #obsidian`, obsidianRawTitle: RAW,
  importSource: 'obsidian', completed: false,
  date: DATE, obsidianFileDate: DATE, startTime: '11:30', duration: 15,
  lastModified: '2026-08-30T17:26:06.657Z',
});

let store;
function useMountedStampHook() {
  effects.length = 0;
  vi.stubGlobal('setTimeout', (cb, ms) => { if (!ms || ms < 3000) cb(); return 1; });
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('window', {});
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  const state = { tasks: [scheduledLegacyTask()], inbox: [] };
  const setTasks = (up) => { state.tasks = typeof up === 'function' ? up(state.tasks) : up; };
  const setUnscheduledTasks = (up) => { state.inbox = typeof up === 'function' ? up(state.inbox) : up; };
  const prevRef = {
    current: {
      // Pre-schedule snapshot: same title, no time → stateChanged, NOT titleChanged.
      [LEGACY_ID]: { completed: false, startTime: null, duration: null, title: `${RAW} #obsidian`, date: DATE },
    },
  };
  const api = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: state.tasks, setTasks,
    unscheduledTasks: state.inbox, setUnscheduledTasks,
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null,
    obsidianCompletionDates: false,
    obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError: vi.fn(), setObsidianLastSynced: vi.fn(),
    setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: {} },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: prevRef,
    obsidianTasksRef: { current: state.tasks }, obsidianInboxRef: { current: state.inbox },
  });
  api.bridgeHeartbeatRef.current = { obsidianRunning: true, pluginAuthoritative: true };
  return { state, prevRef };
}

const runWritebackEffect = () => {
  for (const e of effects) if (e.deps?.length === 3) e.fn();
};

// Captured intent → REAL vault-line application → REAL observation parse →
// REAL merge — the hook's plugin-mode inbound, end to end.
function roundTrip(state) {
  expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
  const [type, fields] = emitBridgeIntent.mock.calls[0];
  expect(type).toBe('task_state'); // NOT a retitle — the trigger was a schedule
  expect(fields.blockId).toBe(BLOCK); // …but it carries the identity move
  const applied = applyBridgeIntent(NOTE, { type, ...fields });
  expect(applied.changed).toBe(true);
  expect(applied.text).toContain(`^dg-${BLOCK}`);
  const obs = applyBridgeObservations(
    [{ path: `${DATE}.md`, content: applied.text, mtime: 1756575000000, observedAt: '2026-08-30T17:26:59Z' }],
    { existingTasks: state.tasks, existingInbox: state.inbox, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
  );
  const merged = mergeObsidianTasks(state.tasks, obs.scheduledTasks, obs.scannedIds, (old) => ({ color: old.color }), {});
  return { merged, obs };
}

// The DB tier's snapshot-delete guard, fed the shape it sees when the
// observation merge drops the legacy copy: legacy id vanished, dg id live.
function guardVerdict(retiredRecord) {
  const wantDelete = [`tasks:${LEGACY_ID}`];
  const cur = { [`tasks:${DG_ID}`]: 'live' };
  const mirror = { retiredTaskIds: retiredRecord };
  const getPrev = () => ({ _kind: 'tasks', value: { ...scheduledLegacyTask() } });
  const { propagate, skipped, reasons } = partitionSnapshotDeletes(wantDelete, cur, mirror, getPrev);
  return { propagate, skipped, reason: reasons[`tasks:${LEGACY_ID}`] };
}

beforeEach(() => { emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true); });
afterEach(() => { __setBlockIdWritesForTests(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the schedule-while-paired duplicate (gate (a), the general rule)', () => {
  it('a non-retitle write that STAMPS commits on enqueue: app task moves to the dg id, retirement recorded, round-trip yields ONE task', () => {
    __setBlockIdWritesForTests(true);
    const { state, prevRef } = useMountedStampHook();
    runWritebackEffect();

    // The identity move committed at enqueue — not deferred to a round-trip.
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe(DG_ID);
    expect(state.tasks[0].obsidianBlockId).toBe(BLOCK);
    expect(prevRef.current[DG_ID]).toBeDefined();
    expect(prevRef.current[LEGACY_ID]).toBeUndefined();

    // The retirement record — the thing shape 2 skipped for this trigger.
    const retired = JSON.parse(store.get(RETIRED_TASK_IDS_STORAGE_KEY));
    expect(retired[LEGACY_ID]).toMatchObject({ successor: DG_ID });

    // Round trip converges on the same identity: one task.
    const { merged } = roundTrip(state);
    const obsidianTasks = merged.filter(t => t.importSource === 'obsidian');
    expect(obsidianTasks).toHaveLength(1);
    expect(obsidianTasks[0].id).toBe(DG_ID);

    // And the snapshot-delete guard now AUTHORIZES the legacy id's vanish —
    // superseded, successor live — instead of healing it back.
    const verdict = guardVerdict(retired);
    expect(verdict.reason).toBe('retired');
    expect(verdict.propagate).toEqual([`tasks:${LEGACY_ID}`]);
  });

  it('COUNTERFACTUAL, layer 1 (the subtle truth the record now states): WITHOUT the commit, the MERGE still collapses the copies — the legacy hint works', () => {
    __setBlockIdWritesForTests(true);
    useMountedStampHook();
    runWritebackEffect();
    // Pre-fix app state: the task still under its legacy id, no commit applied.
    const preFixState = { tasks: [scheduledLegacyTask()], inbox: [] };
    const { merged, obs } = roundTrip(preFixState);
    expect(obs.scannedIds.has(LEGACY_ID)).toBe(true); // the hint really is there
    const obsidianTasks = merged.filter(t => t.importSource === 'obsidian');
    expect(obsidianTasks).toHaveLength(1); // the merge layer was NEVER the bug
  });

  it('COUNTERFACTUAL, layer 2 (the actual mechanism): with NO retirement on record, the snapshot-delete guard classifies the drop as a glitch and heals the duplicate back', () => {
    // The world shape 2 produced: legacy copy dropped by the merge, dg copy
    // live, retiredTaskIds EMPTY (commit never ran for the stamp).
    const verdict = guardVerdict({});
    expect(verdict.reason).toBe('glitch');
    expect(verdict.skipped).toEqual([`tasks:${LEGACY_ID}`]); // kept → heal-fetched → permanent duplicate
  });

  it('failed enqueue: NO commit, no retirement, task untouched — the latch discipline holds for the stamp exactly as for a retitle', () => {
    __setBlockIdWritesForTests(true);
    emitBridgeIntent.mockReturnValue(false);
    const { state } = useMountedStampHook();
    runWritebackEffect();
    expect(state.tasks[0].id).toBe(LEGACY_ID);
    expect(state.tasks[0].obsidianBlockId).toBeUndefined();
    expect(store.get(RETIRED_TASK_IDS_STORAGE_KEY)).toBeUndefined();
  });

  it('read-release build (block-id writes off): no stamp, no identity move, no commit — nothing changes for identity-neutral writes', () => {
    __setBlockIdWritesForTests(false);
    const { state } = useMountedStampHook();
    runWritebackEffect();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    expect(emitBridgeIntent.mock.calls[0][1].blockId).toBe(null);
    expect(state.tasks[0].id).toBe(LEGACY_ID);
    expect(store.get(RETIRED_TASK_IDS_STORAGE_KEY)).toBeUndefined();
  });
});
