import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The writeback's half of the two-sided retitle guard: when the write signals
// a title conflict, commit() must SKIP the titleUpdate — obsidianRawTitle
// stays the truthful merge base and the DG rename stays in app state (a
// delay of one scan cycle, never a loss). Capture-harness pattern.

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const writeTaskStateToFile = vi.fn();
vi.mock('../obsidian.js', () => ({
  tryRestoreVaultAccess: vi.fn(async () => null),
  getVaultAccess: vi.fn(async () => null),
  syncObsidianVault: vi.fn(async () => null),
  syncObsidianVaultNative: vi.fn(async () => null),
  writeTaskStateToFile: (...a) => writeTaskStateToFile(...a),
  writeTaskStateNative: vi.fn(() => false),
  simpleHash: vi.fn(() => 'h'),
  deriveBlockId: vi.fn(() => 'testblok0'),
  appIdForBlockId: vi.fn((b) => `obsidian-dg-${b}`),
  readWikiNote: vi.fn(async () => null),
  writeWikiNote: vi.fn(async () => {}),
  scanVaultNotes: vi.fn(async () => ({ names: [], unportable: [] })),
  OBSIDIAN_IMPORT_WINDOW_DAYS: 90,
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

const { default: useObsidianSync } = await import('./useObsidianSync.js');

const TASK_ID = 'obsidian-dg-aaaa1111';
// A TAGGED task the user just retitled in dayGLANCE.
const retitledTask = () => ({
  id: TASK_ID, title: 'DG rename #obsidian', obsidianRawTitle: 'Base title',
  obsidianBlockId: 'aaaa1111', importSource: 'obsidian',
  completed: false, date: '2026-08-30', obsidianFileDate: '2026-08-30', startTime: null, duration: null,
});
const prevSnapshot = () => ({
  [TASK_ID]: { completed: false, startTime: null, duration: null, title: 'Base title #obsidian', date: '2026-08-30' },
});

function useMountedWriteback({ tasks, prev }) {
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
  const setTasks = vi.fn();
  const prevRef = { current: prev };
  useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks, setTasks,
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null,
    obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError: vi.fn(), setObsidianLastSynced: vi.fn(),
    setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: {} },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: prevRef,
    obsidianTasksRef: { current: tasks }, obsidianInboxRef: { current: [] },
  });
  for (const e of effects) e.fn();
  return { setTasks, prevRef };
}

beforeEach(() => { writeTaskStateToFile.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const flush = () => new Promise((r) => process.nextTick(r));

describe('the titleUpdate commit skip', () => {
  it('a conflicted write commits nothing: obsidianRawTitle keeps the base, the DG rename stays in state and snapshot', async () => {
    // The write reports success but signals the conflict (arg index 11):
    // the line kept the vault's title, so our retitle did NOT land.
    writeTaskStateToFile.mockImplementation((...args) => { args[11]?.({ lineTitle: 'Vault edit' }); return Promise.resolve(true); });
    const { setTasks, prevRef } = useMountedWriteback({ tasks: [retitledTask()], prev: prevSnapshot() });
    await flush();
    expect(writeTaskStateToFile).toHaveBeenCalledTimes(1);
    // commit() skipped applyTitleUpdate — no state map ever ran, so
    // obsidianRawTitle was never advanced off the base.
    expect(setTasks).not.toHaveBeenCalled();
    // (b) Delay, not loss: the rename is still in app state, and the snapshot
    // advance recorded the DG title — so the writeback will not thrash, and
    // the next scan sees ours='DG rename' vs base='Base title' vs the vault
    // line: a clean two-sided divergence for the scan-time policy.
    expect(prevRef.current[TASK_ID].title).toBe('DG rename #obsidian');
  });

  it('an unconflicted retitle commits normally (control)', async () => {
    writeTaskStateToFile.mockResolvedValue(true);
    const { setTasks } = useMountedWriteback({ tasks: [retitledTask()], prev: prevSnapshot() });
    await flush();
    // applyTitleUpdate ran: the rawTitle bookkeeping mapped over both lists.
    expect(setTasks).toHaveBeenCalled();
  });
});
