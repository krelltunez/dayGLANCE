import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Arbitration (Phase 6 PR 3, §3.2): a fresh AND paired heartbeat makes the
// plugin authoritative on this device — the writeback's intent emission IS
// the write (gate a: emit-in-same-tick, no "skipped write" state exists),
// the direct scan is replaced by the observation stream, and the mode
// transition clears the deletion detector's baseline (gate b). Capture-
// harness pattern (see the completionMeta test).

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const writeTaskStateToFile = vi.fn();
const syncObsidianVault = vi.fn(async () => ({ dailyNotes: {}, scheduledTasks: [], inboxTasks: [] }));
const readVaultHeartbeat = vi.fn(async () => null);
const probeVaultAccess = vi.fn(async () => 'ok');
vi.mock('../obsidian.js', () => ({
  tryRestoreVaultAccess: vi.fn(async () => null),
  probeVaultAccess: (...a) => probeVaultAccess(...a),
  getVaultAccess: vi.fn(async () => null),
  syncObsidianVault: (...a) => syncObsidianVault(...a),
  syncObsidianVaultNative: vi.fn(async () => null),
  writeTaskStateToFile: (...a) => writeTaskStateToFile(...a),
  writeTaskStateNative: vi.fn(() => false),
  simpleHash: vi.fn(() => 'h'),
  deriveBlockId: vi.fn(() => 'testblok0'),
  appIdForBlockId: vi.fn((b) => `obsidian-dg-${b}`),
  readWikiNote: vi.fn(async () => null),
  writeWikiNote: vi.fn(async () => {}),
  scanVaultNotes: vi.fn(async () => ({ names: [], unportable: [] })),
  vaultHasTasksPlugin: vi.fn(async () => false),
  detectTasksPluginNative: vi.fn(() => null),
  readVaultHeartbeat: (...a) => readVaultHeartbeat(...a),
  readVaultHeartbeatNative: vi.fn(() => null),
  OBSIDIAN_IMPORT_WINDOW_DAYS: 90,
  // Real implementation (pure): the hook resolves intent paths through it (audit fix H1).
  dailyNoteFilename: (dateStr, pattern) => {
    if (!pattern || pattern === 'yyyy-MM-dd') return `${dateStr}.md`;
    const [y, m, d] = dateStr.split('-');
    return `${pattern.replace('yyyy', y).replace('MM', m).replace('dd', d)}.md`;
  },
  obsidianWindowCutoffDate: vi.fn(() => null),
}));
const nativeAndroid = { value: false };
vi.mock('../native.js', () => ({
  isNativeAndroid: () => nativeAndroid.value,
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
const publishBridgeConfig = vi.fn(async () => {});
const getBridgePairingMeta = vi.fn(async () => null);
vi.mock('../utils/obsidianBridgeStream.js', () => ({
  cachedBridgePairingMeta: () => null,
  emitBridgeIntent: (...a) => emitBridgeIntent(...a),
  flushBridgeOutbox: vi.fn(async () => true),
  publishBridgeConfig: (...a) => publishBridgeConfig(...a),
  publishBridgeCalendarProjection: vi.fn(async () => {}),
  getBridgePairingMeta: (...a) => getBridgePairingMeta(...a),
}));
const fetchBridgeObservations = vi.fn(async () => ({ observations: [], maxSeq: 0 }));
vi.mock('../utils/obsidianBridgeInbound.js', () => ({
  fetchBridgeObservations: (...a) => fetchBridgeObservations(...a),
  applyBridgeObservations: vi.fn(() => ({ dailyNotes: {}, scheduledTasks: [], inboxTasks: [], scannedIds: new Set(), unapplied: [] })),
  commitBridgeObservationCursor: vi.fn(),
}));
const recordBridgeMode = vi.fn();
const reconcileArchivedBaseline = vi.fn(() => null);
vi.mock('../utils/obsidianBridgeMode.js', () => ({
  recordBridgeMode: (...a) => recordBridgeMode(...a),
  reconcileArchivedBaseline: (...a) => reconcileArchivedBaseline(...a),
}));

const { default: useObsidianSync } = await import('./useObsidianSync.js');

const TASK_ID = 'obsidian-dg-aaaa1111';
const completedTask = () => ({
  id: TASK_ID, title: 'Alpha #obsidian', obsidianRawTitle: 'Alpha',
  obsidianBlockId: 'aaaa1111', importSource: 'obsidian',
  completed: true, completedAt: null,
  date: '2026-08-30', obsidianFileDate: '2026-08-30', startTime: null, duration: null,
});
const prevUncompleted = () => ({
  [TASK_ID]: { completed: false, startTime: null, duration: null, title: 'Alpha #obsidian', date: '2026-08-30' },
});

const setObsidianSyncError = vi.fn();
const setObsidianSyncStatus = vi.fn();
const setObsidianVaultAccess = vi.fn();

function useMountedHook({ authoritative, defaultTaskHeading, taskHeading }) {
  effects.length = 0;
  vi.stubGlobal('setTimeout', (cb, ms) => { if (!ms || ms < 3000) cb(); return 1; });
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('window', {});
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  const tasks = [completedTask()];
  const prevRef = { current: prevUncompleted() };
  const api = useObsidianSync({
    defaultTaskHeading,
    isTrayMode: false, dataLoaded: true,
    tasks, setTasks: vi.fn(),
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd', taskHeading },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null,
    obsidianCompletionDates: false,
    obsidianSyncError: null,
    setObsidianSyncStatus, setObsidianSyncError, setObsidianLastSynced: vi.fn(),
    setObsidianSyncNotice: vi.fn(), setObsidianVaultAccess,
    obsidianVaultHandleRef: { current: {} },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: prevRef,
    obsidianTasksRef: { current: tasks }, obsidianInboxRef: { current: [] },
  });
  // The writeback reads authority from the hook's own heartbeat ref —
  // seed it the way refreshBridgeHeartbeat would have.
  api.bridgeHeartbeatRef.current = { obsidianRunning: authoritative, pluginAuthoritative: authoritative };
  return { api, prevRef };
}

const runWritebackEffect = () => {
  // The writeback is the effect keyed on [tasks, unscheduledTasks, enabled].
  for (const e of effects) if (e.deps?.length === 3) e.fn();
};

beforeEach(() => {
  publishBridgeConfig.mockClear();
  writeTaskStateToFile.mockReset(); writeTaskStateToFile.mockResolvedValue(true);
  emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true);
  syncObsidianVault.mockClear(); fetchBridgeObservations.mockClear();
  recordBridgeMode.mockClear(); setObsidianSyncError.mockClear();
  reconcileArchivedBaseline.mockClear(); reconcileArchivedBaseline.mockReturnValue(null);
  getBridgePairingMeta.mockClear(); getBridgePairingMeta.mockResolvedValue(null);
  readVaultHeartbeat.mockReset(); readVaultHeartbeat.mockResolvedValue(null);
  probeVaultAccess.mockReset(); probeVaultAccess.mockResolvedValue('ok');
  setObsidianSyncStatus.mockClear(); setObsidianVaultAccess.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); nativeAndroid.value = false; });

// The Android splash is held until the startup sync's work is done. The cycle
// then waits out a 2 s floor for the Sync button's spinner, and the splash
// used to wait it out too: on a warm start that was half the time to the UI.
describe('the Android splash', () => {
  const pairedBeat = { paired: true, accountId: 'acct-1', deviceId: 'dev', tsMs: Date.now() };

  // MUTATION: drop notifyNativeReady() from finishObsidianCycle and the splash
  // is released only after the floor.
  it('is released when the cycle finishes its work, before the spinner floor', async () => {
    nativeAndroid.value = true;
    readVaultHeartbeat.mockResolvedValue(pairedBeat);
    const { api } = useMountedHook({ authoritative: true });
    const notifyAppReady = vi.fn();
    globalThis.window.DayGlanceNative = { notifyAppReady };
    const floor = [];
    vi.stubGlobal('setTimeout', (cb, ms) => {
      if (ms >= 1000 && ms <= 2000) floor.push(cb);
      else if (!ms || ms < 3000) cb();
      return 1;
    });

    const cycle = api.performObsidianSync();
    for (let i = 0; i < 200 && !floor.length; i++) await new Promise(r => setImmediate(r));
    expect(floor).toHaveLength(1);
    expect(notifyAppReady).toHaveBeenCalledTimes(1);

    floor[0]();
    await cycle;
    expect(notifyAppReady).toHaveBeenCalledTimes(1); // once per session, not again from the finally
  });
});

describe('writeback under plugin authority (gate a: emit-in-same-tick)', () => {
  it.each([[undefined, '## 任务'], ['## My Tasks', '## My Tasks']])('shares the localized heading with Bridge config and writeback (custom: %s)', async (taskHeading, expected) => {
    const { api } = useMountedHook({ authoritative: true, defaultTaskHeading: '## 任务', taskHeading });
    await api.performObsidianSync();
    expect(publishBridgeConfig).toHaveBeenCalledWith(expect.objectContaining({ taskHeading: expected }));
    emitBridgeIntent.mockClear();
    useMountedHook({ authoritative: true, defaultTaskHeading: '## 任务', taskHeading });
    runWritebackEffect();
    expect(emitBridgeIntent).toHaveBeenCalledWith('task_state', expect.objectContaining({ taskHeading: expected }));
  });

  it('authoritative: the intent is emitted, NO direct write runs, and the snapshot advances', () => {
    const { prevRef } = useMountedHook({ authoritative: true });
    runWritebackEffect();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    expect(emitBridgeIntent.mock.calls[0][0]).toBe('task_state');
    expect(emitBridgeIntent.mock.calls[0][1]).toMatchObject({ obsidianRawTitle: 'Alpha', completed: true });
    expect(writeTaskStateToFile).not.toHaveBeenCalled();
    // The advance is backed by the emission — no skipped-write state exists.
    expect(prevRef.current[TASK_ID].completed).toBe(true);
  });

  it('authoritative + enqueue FAILURE latches the task-write error (never a silent loss)', () => {
    emitBridgeIntent.mockReturnValue(false);
    useMountedHook({ authoritative: true });
    runWritebackEffect();
    expect(writeTaskStateToFile).not.toHaveBeenCalled();
    expect(setObsidianSyncError).toHaveBeenCalledWith(expect.stringContaining("Couldn't write to your Obsidian vault"));
  });

  it('not authoritative: the direct write runs exactly as before, alongside the emission', () => {
    useMountedHook({ authoritative: false });
    runWritebackEffect();
    expect(writeTaskStateToFile).toHaveBeenCalledTimes(1);
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    expect(setObsidianSyncError).not.toHaveBeenCalled();
  });
});

describe('sync cycle under plugin authority', () => {
  const pairedBeat = { paired: true, accountId: 'acct-1', deviceId: 'dev', tsMs: Date.now() };

  it('authoritative: the direct scan is REPLACED by the observation stream; mode recorded as plugin; meta refresh FORCED past its TTL (the rising-edge fix)', async () => {
    readVaultHeartbeat.mockResolvedValue(pairedBeat);
    const { api } = useMountedHook({ authoritative: true });
    await api.performObsidianSync();
    expect(syncObsidianVault).not.toHaveBeenCalled();
    expect(fetchBridgeObservations).toHaveBeenCalledTimes(1);
    expect(recordBridgeMode).toHaveBeenCalledWith('plugin');
    // Forced: a stale pre-pairing NEGATIVE cache must not gate emits off
    // while direct writes are already stopped.
    expect(getBridgePairingMeta).toHaveBeenCalledWith({ force: true });
  });

  it('stale/unpaired heartbeat: the direct scan runs; mode recorded as direct (§3.3 one revert path); meta refresh unforced', async () => {
    readVaultHeartbeat.mockResolvedValue(null);
    const { api } = useMountedHook({ authoritative: false });
    await api.performObsidianSync();
    expect(syncObsidianVault).toHaveBeenCalledTimes(1);
    expect(fetchBridgeObservations).not.toHaveBeenCalled();
    expect(recordBridgeMode).toHaveBeenCalledWith('direct');
    expect(getBridgePairingMeta).toHaveBeenCalledWith({ force: false });
  });

  it('direct mode reconciles a pending baseline archive: deletions tombstoned at the ARCHIVE time, before the merges', async () => {
    readVaultHeartbeat.mockResolvedValue(null);
    reconcileArchivedBaseline.mockReturnValue({
      skipped: false, deletions: ['obsidian-dg-gone0001'], archivedAt: '2026-07-29T00:00:00.000Z',
    });
    const { api } = useMountedHook({ authoritative: false });
    await api.performObsidianSync();
    expect(reconcileArchivedBaseline).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(globalThis.localStorage.getItem('day-planner-deleted-obsidian-keys'));
    expect(stored['obsidian-dg-gone0001']).toBe('2026-07-29T00:00:00.000Z'); // archive time, never now
  });

  it('plugin mode never touches the archive — reconcile runs only where scans do', async () => {
    readVaultHeartbeat.mockResolvedValue(pairedBeat);
    const { api } = useMountedHook({ authoritative: true });
    await api.performObsidianSync();
    expect(reconcileArchivedBaseline).not.toHaveBeenCalled();
  });
});

// A paired device syncs its tasks through GLANCEvault whether or not it can
// reach its own vault, so a cycle used to report "Synced" on a device whose
// every note read and vault write was failing. The cycle still runs (the
// stream side is real), but it never reports success while the vault is
// unreachable, and it says so once, not on every poll.
describe('a vault this device cannot reach', () => {
  const pairedBeat = { paired: true, accountId: 'acct-1', deviceId: 'dev', tsMs: Date.now() };
  const statuses = () => setObsidianSyncStatus.mock.calls.map(([s]) => (typeof s === 'function' ? s('syncing') : s));

  // MUTATION: drop the lost branch in finishObsidianCycle and 'success' returns.
  it('still syncs the stream side, but never reports success, and says why once', async () => {
    readVaultHeartbeat.mockResolvedValue(pairedBeat);
    probeVaultAccess.mockResolvedValue('lost');
    const { api } = useMountedHook({ authoritative: true });
    await api.performObsidianSync();
    expect(fetchBridgeObservations).toHaveBeenCalledTimes(1);
    expect(setObsidianVaultAccess).toHaveBeenLastCalledWith('lost');
    expect(statuses()).not.toContain('success');
    expect(statuses()).toContain('error');
    expect(setObsidianSyncError).toHaveBeenCalledWith(expect.stringContaining("Can't reach your Obsidian vault"));
  });

  it('a second cycle while still lost stays quiet: no second error, still no success', async () => {
    readVaultHeartbeat.mockResolvedValue(pairedBeat);
    probeVaultAccess.mockResolvedValue('lost');
    const { api } = useMountedHook({ authoritative: true });
    await api.performObsidianSync();
    setObsidianSyncError.mockClear(); setObsidianSyncStatus.mockClear();
    await api.performObsidianSync();
    expect(setObsidianSyncError).not.toHaveBeenCalled();
    expect(statuses()).not.toContain('success');
    expect(statuses()).not.toContain('error');
  });

  it('a reachable vault reports success exactly as before', async () => {
    readVaultHeartbeat.mockResolvedValue(pairedBeat);
    const { api } = useMountedHook({ authoritative: true });
    await api.performObsidianSync();
    expect(setObsidianVaultAccess).toHaveBeenLastCalledWith('ok');
    expect(statuses()).toContain('success');
  });
});
