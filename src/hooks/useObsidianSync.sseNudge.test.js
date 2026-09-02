import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// SSE → OBSIDIAN CYCLE pacing (Phase 7 groundwork). The route from a vault
// /events nudge to performObsidianSync, with every damping layer pinned:
// the probe gates the wake (a nudge for DB-tier activity runs no cycle),
// the min gap coalesces bursts (one cycle, not one per nudge), plugin
// authority gates the whole thing, and a nudge landing mid-cycle schedules
// a retry instead of being dropped OR stacking a concurrent cycle. The
// coalescer's own-echo suppression and the probe's obs:-prefix check are
// pinned in vaultEventStream.test.js / obsidianBridgeInbound.test.js.

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const heartbeatMock = vi.fn(async () => null);
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
    readVaultHeartbeat: (...a) => heartbeatMock(...a),
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
vi.mock('../utils/obsidianBridgeStream.js', () => ({
  cachedBridgePairingMeta: () => null,
  emitBridgeIntent: vi.fn(() => true),
  flushBridgeOutbox: vi.fn(async () => true),
  publishBridgeConfig: vi.fn(async () => {}),
  getBridgePairingMeta: vi.fn(async () => null),
}));
vi.mock('../utils/obsidianBridgeMode.js', () => ({
  recordBridgeMode: vi.fn(),
  reconcileArchivedBaseline: vi.fn(() => null),
}));
const probeMock = vi.fn(async () => false);
const fetchMock = vi.fn(async () => null);
vi.mock('../utils/obsidianBridgeInbound.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    pendingBridgeObservations: (...a) => probeMock(...a),
    fetchBridgeObservations: (...a) => fetchMock(...a),
  };
});

const { default: useObsidianSync } = await import('./useObsidianSync.js');
const { legacyObsidianId } = await import('@glance-apps/obsidian-format');

const D = '2026-08-30';
const NOTE = '## Tasks\n- [ ] Nudged task\n';
const LEGACY_ID = legacyObsidianId(D, 'Nudged task');

let scheduledTimers;
function useMountedNudgeHook() {
  effects.length = 0;
  scheduledTimers = [];
  // <3000ms timers fire on the microtask queue (so setTimeout RETURNS before
  // its callback runs, like a real timer — the nudge stores the returned id
  // and its callback clears it, an ordering a synchronous stub would
  // invert); anything longer is only RECORDED — a scheduled-but-not-run 5s
  // timer is exactly what the coalescing pins assert on.
  vi.stubGlobal('setTimeout', (cb, ms) => {
    if (!ms || ms < 3000) { queueMicrotask(cb); return 1; }
    scheduledTimers.push(ms);
    return scheduledTimers.length;
  });
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('window', {});
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  const state = { tasks: [], inbox: [] };
  const syncRef = { current: false };
  const tasksRef = { current: state.tasks };
  const inboxRef = { current: state.inbox };
  const setTasks = (up) => { state.tasks = typeof up === 'function' ? up(state.tasks) : up; tasksRef.current = state.tasks; };
  const setUnscheduledTasks = (up) => { state.inbox = typeof up === 'function' ? up(state.inbox) : up; inboxRef.current = state.inbox; };
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
    obsidianSyncInProgressRef: syncRef,
    obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: tasksRef, obsidianInboxRef: inboxRef,
    recycleBin: [], setRecycleBin: vi.fn(),
  });
  api.bridgeHeartbeatRef.current = { obsidianRunning: true, pluginAuthoritative: true };
  return { state, api, syncRef };
}

// The nudge is deliberately fire-and-forget; settle its async chain.
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };

beforeEach(() => {
  probeMock.mockReset(); probeMock.mockResolvedValue(false);
  fetchMock.mockReset(); fetchMock.mockResolvedValue(null);
  heartbeatMock.mockReset(); heartbeatMock.mockResolvedValue({ paired: true, tsMs: Date.now(), accountId: 'a', deviceId: 'd' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('nudgeObsidianObservations (SSE → Obsidian cycle pacing)', () => {
  it('a nudge with pending observations runs ONE cycle and applies them — the inbound leg at SSE speed', async () => {
    const h = useMountedNudgeHook();
    probeMock.mockResolvedValue(true);
    fetchMock.mockResolvedValue({
      observations: [{ path: `${D}.md`, content: NOTE, mtime: Date.parse('2026-08-30T10:00:00Z') }],
      maxSeq: 3,
    });
    h.api.nudgeObsidianObservations();
    await settle();
    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect([...h.state.tasks, ...h.state.inbox].map(t => String(t.id))).toEqual([LEGACY_ID]);
  });

  it('a nudge whose probe finds nothing runs NO cycle — foreign DB-tier activity costs one probe, never a sync', async () => {
    const h = useMountedNudgeHook();
    probeMock.mockResolvedValue(false);
    h.api.nudgeObsidianObservations();
    await settle();
    expect(probeMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('MIN GAP: nudges after a run coalesce into one trailing timer — never a cycle per nudge', async () => {
    const h = useMountedNudgeHook();
    probeMock.mockResolvedValue(false);
    h.api.nudgeObsidianObservations(); // runs immediately (no prior run)
    await settle();
    expect(probeMock).toHaveBeenCalledTimes(1);

    h.api.nudgeObsidianObservations(); // inside the gap → trailing timer
    h.api.nudgeObsidianObservations(); // coalesces into the SAME timer
    await settle();
    expect(probeMock).toHaveBeenCalledTimes(1); // no extra probe ran yet
    expect(scheduledTimers).toHaveLength(1); // exactly one trailing run scheduled
  });

  it('no plugin authority → no probe, no cycle (observations are only consumed while paired-and-fresh)', async () => {
    const h = useMountedNudgeHook();
    h.api.bridgeHeartbeatRef.current = { obsidianRunning: false, pluginAuthoritative: false };
    probeMock.mockResolvedValue(true);
    h.api.nudgeObsidianObservations();
    await settle();
    expect(probeMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a nudge landing while a cycle is in flight schedules a RETRY after the gap — dropped nudges were the old way a burst tail waited for the poll', async () => {
    const h = useMountedNudgeHook();
    h.syncRef.current = true; // a cycle is mid-flight
    probeMock.mockResolvedValue(true);
    h.api.nudgeObsidianObservations();
    await settle();
    expect(probeMock).not.toHaveBeenCalled(); // deferred, not raced
    expect(scheduledTimers).toEqual([5000]); // one retry armed at the gap
  });
});
