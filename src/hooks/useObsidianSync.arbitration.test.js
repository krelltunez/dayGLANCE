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
vi.mock('../obsidian.js', () => ({
  tryRestoreVaultAccess: vi.fn(async () => null),
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
const getBridgePairingMeta = vi.fn(async () => null);
vi.mock('../utils/obsidianBridgeStream.js', () => ({
  emitBridgeIntent: (...a) => emitBridgeIntent(...a),
  flushBridgeOutbox: vi.fn(async () => true),
  publishBridgeConfig: vi.fn(async () => {}),
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

function useMountedHook({ authoritative }) {
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
    isTrayMode: false, dataLoaded: true,
    tasks, setTasks: vi.fn(),
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null,
    obsidianCompletionDates: false,
    obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError, setObsidianLastSynced: vi.fn(),
    setObsidianSyncNotice: vi.fn(),
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
  writeTaskStateToFile.mockReset(); writeTaskStateToFile.mockResolvedValue(true);
  emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true);
  syncObsidianVault.mockClear(); fetchBridgeObservations.mockClear();
  recordBridgeMode.mockClear(); setObsidianSyncError.mockClear();
  reconcileArchivedBaseline.mockClear(); reconcileArchivedBaseline.mockReturnValue(null);
  getBridgePairingMeta.mockClear(); getBridgePairingMeta.mockResolvedValue(null);
  readVaultHeartbeat.mockReset(); readVaultHeartbeat.mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('writeback under plugin authority (gate a: emit-in-same-tick)', () => {
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
