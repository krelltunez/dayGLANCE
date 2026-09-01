import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// BIN-VERSUS-VAULT wiring (§3.10 ruling 5): the sync cycle un-bins a task
// whose line the vault still holds, in BOTH inbound modes — the direct scan
// and the plugin-mode observation stream — with the durable record on
// task.notes and the one-shot toast on the shared notice channel. Capture-
// harness pattern (see the arbitration test).

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const TASK_ID = 'obsidian-2026-08-29-abc123';
const scannedTask = () => ({
  id: TASK_ID, title: 'Water the plants #obsidian', importSource: 'obsidian',
  obsidianRawTitle: 'Water the plants', completed: false,
  date: '2026-08-29', obsidianFileDate: '2026-08-29', startTime: '09:00', duration: null,
  lastModified: new Date(0).toISOString(),
});
const binnedTask = () => ({
  ...scannedTask(),
  color: 'bg-purple-500', notes: 'my note',
  _deletedFrom: 'calendar',
  deletedAt: '2026-08-30T10:00:00.000Z', lastModified: '2026-08-30T10:00:00.000Z',
});

const syncObsidianVault = vi.fn(async () => ({ dailyNotes: {}, scheduledTasks: [scannedTask()], inboxTasks: [] }));
const readVaultHeartbeat = vi.fn(async () => null);
vi.mock('../obsidian.js', () => ({
  tryRestoreVaultAccess: vi.fn(async () => null),
  getVaultAccess: vi.fn(async () => null),
  syncObsidianVault: (...a) => syncObsidianVault(...a),
  syncObsidianVaultNative: vi.fn(async () => null),
  writeTaskStateToFile: vi.fn(async () => true),
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
vi.mock('../utils/obsidianBridgeStream.js', () => ({
  emitBridgeIntent: vi.fn(() => true),
  flushBridgeOutbox: vi.fn(async () => true),
  publishBridgeConfig: vi.fn(async () => {}),
  getBridgePairingMeta: vi.fn(async () => null),
}));
const fetchBridgeObservations = vi.fn(async () => ({ observations: [], maxSeq: 0 }));
const applyBridgeObservations = vi.fn(() => ({ dailyNotes: {}, scheduledTasks: [], inboxTasks: [], scannedIds: new Set(), unapplied: [] }));
vi.mock('../utils/obsidianBridgeInbound.js', () => ({
  fetchBridgeObservations: (...a) => fetchBridgeObservations(...a),
  applyBridgeObservations: (...a) => applyBridgeObservations(...a),
  commitBridgeObservationCursor: vi.fn(),
}));
vi.mock('../utils/obsidianBridgeMode.js', () => ({
  recordBridgeMode: vi.fn(),
  reconcileArchivedBaseline: vi.fn(() => null),
}));

const { default: useObsidianSync } = await import('./useObsidianSync.js');
const { binRestoreNoteLine } = await import('../utils/obsidianBinRestore.js');

const setObsidianSyncNotice = vi.fn();

function useMountedHook() {
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
  // Live state so the functional updaters actually apply.
  const state = { tasks: [], inbox: [], bin: [binnedTask()] };
  const setTasks = (up) => { state.tasks = typeof up === 'function' ? up(state.tasks) : up; };
  const setUnscheduledTasks = (up) => { state.inbox = typeof up === 'function' ? up(state.inbox) : up; };
  const setRecycleBin = (up) => { state.bin = typeof up === 'function' ? up(state.bin) : up; };
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
    setObsidianSyncNotice,
    obsidianVaultHandleRef: { current: {} },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: { current: state.tasks }, obsidianInboxRef: { current: state.inbox },
    recycleBin: state.bin, setRecycleBin,
  });
  return { api, state };
}

beforeEach(() => {
  syncObsidianVault.mockClear();
  readVaultHeartbeat.mockReset(); readVaultHeartbeat.mockResolvedValue(null);
  fetchBridgeObservations.mockClear(); applyBridgeObservations.mockClear();
  setObsidianSyncNotice.mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('bin-versus-vault through the DIRECT scan', () => {
  it('a scanned line whose task sits in the bin restores it: bin emptied, task live with the record, one neutral toast', async () => {
    const { api, state } = useMountedHook();
    await api.performObsidianSync();

    expect(state.bin).toHaveLength(0);
    expect(state.tasks).toHaveLength(1);
    const t = state.tasks[0];
    expect(t.id).toBe(TASK_ID);
    // App fields carried from the bin copy; the durable record appended.
    expect(t.color).toBe('bg-purple-500');
    expect(t.notes).toBe(`my note\n${binRestoreNoteLine('2026-08-29')}`);
    // Fresher than the delete stamp, so peers keep the restore.
    expect(Date.parse(t.lastModified)).toBeGreaterThan(Date.parse('2026-08-30T10:00:00.000Z'));
    expect(setObsidianSyncNotice).toHaveBeenCalledWith(
      'Restored "Water the plants" from the recycle bin. Its line still exists in your 2026-08-29 daily note.',
    );
  });

  it('a bin entry the scan does NOT produce stays binned, silently', async () => {
    syncObsidianVault.mockResolvedValueOnce({ dailyNotes: {}, scheduledTasks: [], inboxTasks: [] });
    const { api, state } = useMountedHook();
    await api.performObsidianSync();
    expect(state.bin).toHaveLength(1);
    expect(state.tasks).toHaveLength(0);
    expect(setObsidianSyncNotice).not.toHaveBeenCalled();
  });
});

describe('bin-versus-vault through the OBSERVATION stream (plugin mode)', () => {
  it('an observed line restores the binned task exactly like a scanned one', async () => {
    readVaultHeartbeat.mockResolvedValue({ paired: true, accountId: 'acct-1', deviceId: 'dev', tsMs: Date.now() });
    fetchBridgeObservations.mockResolvedValue({ observations: [{ path: '2026-08-29.md', content: 'x' }], maxSeq: 7 });
    applyBridgeObservations.mockReturnValue({
      dailyNotes: {}, scheduledTasks: [scannedTask()], inboxTasks: [],
      scannedIds: new Set([TASK_ID]), unapplied: [],
    });
    const { api, state } = useMountedHook();
    await api.performObsidianSync();

    expect(syncObsidianVault).not.toHaveBeenCalled(); // plugin mode: no scan
    expect(state.bin).toHaveLength(0);
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].notes).toContain('Restored from the recycle bin.');
    expect(setObsidianSyncNotice).toHaveBeenCalledWith(expect.stringContaining('Restored "Water the plants"'));
  });
});
