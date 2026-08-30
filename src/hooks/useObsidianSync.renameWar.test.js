import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// THE RENAME-WHILE-PAIRED WAR (gate (a) completion — the corrected ruling;
// see the writeback's GATE (a) COMPLETION comment and the spec's Phase 6
// build-record correction). Reproduces the 2026-08-30 production reconcile
// war end to end: a LEGACY-ID task (content-derived id, no ^dg- token) is
// renamed from dayGLANCE while the plugin is authoritative. The first gate
// (a) shape ran no commit() in plugin mode, so the retirement was never
// recorded — the old-id copy lingered, the renamed line came back from the
// observation stream as a SECOND task, and the cross-list reconciler then
// deleted a loser every cycle while sync resupplied it (#1455's second
// instance). These tests mount the REAL hook writeback (transports stubbed,
// identity/parse/merge real), capture the emitted task_retitle intent, run
// it through the REAL applyBridgeIntent, feed the resulting note through the
// REAL applyBridgeObservations, and assert the round trip converges on ONE
// task — with the retirement recorded at enqueue time.

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

// Partial mock: transports (file/native/heartbeat access) are stubbed, but
// every identity, parse, and merge function is the REAL implementation —
// the whole point is exercising the actual id derivations end to end.
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
// Real inbound pipeline — applyBridgeObservations routes through the same
// parse + merge the scan uses.
const { applyBridgeObservations } = await import('../utils/obsidianBridgeInbound.js');
const { mergeObsidianTasks } = await import('../utils/mergeObsidianTasks.js');
const { RETIRED_TASK_IDS_STORAGE_KEY } = await import('../utils/retiredTaskIds.js');
const { __setBlockIdWritesForTests } = await import('../utils/obsidianWritePolicy.js');

const DATE = '2026-08-30';
const OLD_RAW = 'Call the plumber';
const NEW_RAW = 'Call the electrician';
const OLD_ID = legacyObsidianId(DATE, OLD_RAW);      // the war's lingering copy
const NEW_LEGACY_ID = legacyObsidianId(DATE, NEW_RAW); // the renamed line's id
const NOTE = `# Day\n\n## Tasks\n- [ ] 09:00 ${OLD_RAW}\n`;

// The task as it sits in app state right after the user renamed it in
// dayGLANCE: display title already new, obsidianRawTitle still what the
// vault line says (the merge base), id still content-derived from OLD_RAW.
const renamedLegacyTask = () => ({
  id: OLD_ID, title: `${NEW_RAW} #obsidian`, obsidianRawTitle: OLD_RAW,
  importSource: 'obsidian', completed: false,
  date: DATE, obsidianFileDate: DATE, startTime: '09:00', duration: null,
  lastModified: '2026-08-30T09:00:00.000Z',
});

let store;
function useMountedWarHook() {
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
  // LIVE task state: the commit's setTasks/setUnscheduledTasks updaters are
  // applied for real, so the round trip below sees post-commit app state.
  const state = { tasks: [renamedLegacyTask()], inbox: [] };
  const setTasks = (up) => { state.tasks = typeof up === 'function' ? up(state.tasks) : up; };
  const setUnscheduledTasks = (up) => { state.inbox = typeof up === 'function' ? up(state.inbox) : up; };
  const prevRef = {
    current: {
      [OLD_ID]: { completed: false, startTime: '09:00', duration: null, title: `${OLD_RAW} #obsidian`, date: DATE },
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

// Writeback → captured intent → REAL vault-line application → REAL
// observation parse → REAL merge, exactly the hook's plugin-mode inbound.
function roundTrip(state) {
  expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
  const [type, fields] = emitBridgeIntent.mock.calls[0];
  expect(type).toBe('task_retitle');
  const applied = applyBridgeIntent(NOTE, { type, ...fields });
  expect(applied.changed).toBe(true);
  expect(applied.text).toContain(NEW_RAW);
  expect(applied.text).not.toContain(OLD_RAW);
  const obs = applyBridgeObservations(
    [{ path: `${DATE}.md`, content: applied.text, mtime: 1756500000000, observedAt: '2026-08-30T12:00:00Z' }],
    { existingTasks: state.tasks, existingInbox: state.inbox, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
  );
  const merged = mergeObsidianTasks(state.tasks, obs.scheduledTasks, obs.scannedIds, (old) => ({ color: old.color }), {});
  return { merged, obs };
}

beforeEach(() => { emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true); });
afterEach(() => { __setBlockIdWritesForTests(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the rename-while-paired war (gate (a) completion)', () => {
  it('EXACT WAR SHAPE (untagged line, block-id writes off): rename → intent → observation round-trips to ONE task, retirement recorded at enqueue', () => {
    __setBlockIdWritesForTests(false);
    const { state, prevRef } = useMountedWarHook();
    runWritebackEffect();

    // Commit ran on successful enqueue: the app task moved to the new
    // content-derived id, rawTitle advanced, snapshot entry moved with it.
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe(NEW_LEGACY_ID);
    expect(state.tasks[0].obsidianRawTitle).toBe(NEW_RAW);
    expect(prevRef.current[NEW_LEGACY_ID]).toBeDefined();
    expect(prevRef.current[OLD_ID]).toBeUndefined();

    // The retirement is on record BEFORE any observation returns — the id
    // bookkeeping rode the enqueue, like a real other device's write.
    const retired = JSON.parse(store.get(RETIRED_TASK_IDS_STORAGE_KEY));
    expect(retired[OLD_ID]).toMatchObject({ successor: NEW_LEGACY_ID });

    // Observation round trip: ONE task, under the committed identity.
    const { merged } = roundTrip(state);
    const obsidianTasks = merged.filter(t => t.importSource === 'obsidian');
    expect(obsidianTasks).toHaveLength(1);
    expect(obsidianTasks[0].id).toBe(NEW_LEGACY_ID);
    // App-side identity (lastModified etc.) survived the round trip — the
    // observed copy merged INTO the existing task, it did not replace it
    // with a stranger.
    expect(obsidianTasks[0].title).toBe(`${NEW_RAW} #obsidian`);
  });

  it('COUNTERFACTUAL (the war fuel): without the commit, the same round trip yields TWO tasks', () => {
    __setBlockIdWritesForTests(false);
    const { state } = useMountedWarHook();
    runWritebackEffect();
    // Rebuild the pre-fix world: app state still holding the OLD id (no
    // titleUpdate applied, no retirement recorded) receiving the same
    // observation. This is exactly what every cycle of the production war
    // saw — and why the reconciler had a loser to delete forever.
    const preFixState = { tasks: [renamedLegacyTask()], inbox: [] };
    const { merged } = roundTrip(preFixState);
    const obsidianTasks = merged.filter(t => t.importSource === 'obsidian');
    expect(obsidianTasks).toHaveLength(2);
    expect(new Set(obsidianTasks.map(t => t.id))).toEqual(new Set([OLD_ID, NEW_LEGACY_ID]));
  });

  it('WRITE-RELEASE VARIANT (block-id writes on): the rename stamps a ^dg- token and both retired ids map to the block identity', () => {
    __setBlockIdWritesForTests(true);
    const blockId = deriveBlockId(DATE, NEW_RAW);
    const dgId = appIdForBlockId(blockId);
    const { state, prevRef } = useMountedWarHook();
    runWritebackEffect();

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe(dgId);
    expect(state.tasks[0].obsidianBlockId).toBe(blockId);
    expect(prevRef.current[dgId]).toBeDefined();

    // The whole rename chain collapses onto the final id.
    const retired = JSON.parse(store.get(RETIRED_TASK_IDS_STORAGE_KEY));
    expect(retired[OLD_ID]).toMatchObject({ successor: dgId });
    expect(retired[NEW_LEGACY_ID]).toMatchObject({ successor: dgId });

    const { merged, obs } = roundTrip(state);
    // The applied line carries the token, so the observation parses to the
    // dg identity with the legacy hint alongside.
    expect(obs.scannedIds.has(dgId)).toBe(true);
    expect(obs.scannedIds.has(NEW_LEGACY_ID)).toBe(true);
    const obsidianTasks = merged.filter(t => t.importSource === 'obsidian');
    expect(obsidianTasks).toHaveLength(1);
    expect(obsidianTasks[0].id).toBe(dgId);
  });

  it('failed enqueue: NO commit, no retirement — the latch discipline holds', () => {
    __setBlockIdWritesForTests(false);
    emitBridgeIntent.mockReturnValue(false);
    const { state } = useMountedWarHook();
    runWritebackEffect();
    expect(state.tasks[0].id).toBe(OLD_ID);
    expect(state.tasks[0].obsidianRawTitle).toBe(OLD_RAW);
    expect(store.get(RETIRED_TASK_IDS_STORAGE_KEY)).toBeUndefined();
  });
});
