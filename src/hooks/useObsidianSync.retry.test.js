import { describe, it, expect, vi, beforeEach } from 'vitest';

// The restore-retry seam: a vault that failed restore at startup (unmounted
// drive, sleeping network share, stale bookmark) must reconnect on the next
// sync tick WITHOUT user action. The 5-minute poll and the visibility-change
// handler are deliberately not gated on a connected handle — they call
// performObsidianSync unconditionally, and its null-handle branch re-acquires
// the vault via getVaultAccess. These tests pin exactly that seam with the
// useSaveOnChange.test.js capture pattern (no DOM renderer): capture the
// hook's effects, run the poll/visibility effect, and watch getVaultAccess.

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const getVaultAccess = vi.fn();
vi.mock('../obsidian.js', () => ({
  tryRestoreVaultAccess: vi.fn(async () => null),
  getVaultAccess: (...a) => getVaultAccess(...a),
  syncObsidianVault: vi.fn(async () => null),
  syncObsidianVaultNative: vi.fn(async () => null),
  writeTaskStateToFile: vi.fn(async () => {}),
  writeTaskStateNative: vi.fn(() => {}),
  simpleHash: vi.fn(() => 'h'),
  readWikiNote: vi.fn(async () => null),
  writeWikiNote: vi.fn(async () => {}),
  listVaultNotes: vi.fn(async () => []),
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
}));

const { default: useObsidianSync } = await import('./useObsidianSync.js');

function mountHook() {
  effects.length = 0;
  const obsidianVaultHandleRef = { current: null };
  const setObsidianSyncStatus = vi.fn();
  useObsidianSync({
    isTrayMode: false,
    dataLoaded: true,
    tasks: [], setTasks: vi.fn(),
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(),
    setWikilinkCandidates: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    setObsidianConfig: vi.fn(),
    setObsidianSyncStatus,
    setObsidianSyncError: vi.fn(),
    setObsidianLastSynced: vi.fn(),
    obsidianVaultHandleRef,
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: { current: null },
    obsidianTasksRef: { current: [] },
    obsidianInboxRef: { current: [] },
  });
  // Identify the effects by what they install rather than by ordinal position.
  const interval = { cb: null };
  const listeners = {};
  vi.stubGlobal('setInterval', (cb) => { interval.cb = cb; return 1; });
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('document', {
    addEventListener: (type, cb) => { listeners[type] = cb; },
    removeEventListener: () => {},
    visibilityState: 'visible',
  });
  for (const e of effects) e.fn();
  return { obsidianVaultHandleRef, interval, listeners, setObsidianSyncStatus };
}

beforeEach(() => {
  getVaultAccess.mockReset();
  vi.unstubAllGlobals();
});

describe('restore retry — poll and visibility ticks are not gated on a handle', () => {
  it('failed restore, then vault reachable: the next poll tick reconnects without user action', async () => {
    const { obsidianVaultHandleRef, interval } = mountHook();
    expect(interval.cb).toBeTypeOf('function');

    // Vault still unreachable: tick retries restore, stays disconnected, silently.
    getVaultAccess.mockResolvedValueOnce(null);
    await interval.cb();
    expect(getVaultAccess).toHaveBeenCalledTimes(1); // the old gate would have made this 0
    expect(obsidianVaultHandleRef.current).toBeNull();

    // Vault came back: the very next tick reconnects.
    const handle = { kind: 'directory', name: 'Vault' };
    getVaultAccess.mockResolvedValueOnce(handle);
    await interval.cb();
    expect(obsidianVaultHandleRef.current).toBe(handle);
  });

  it('visibility-change tick does the same', async () => {
    const { obsidianVaultHandleRef, listeners } = mountHook();
    expect(listeners.visibilitychange).toBeTypeOf('function');

    const handle = { kind: 'directory', name: 'Vault' };
    getVaultAccess.mockResolvedValueOnce(handle);
    await listeners.visibilitychange();
    expect(getVaultAccess).toHaveBeenCalledTimes(1);
    expect(obsidianVaultHandleRef.current).toBe(handle);
  });

  it('a genuinely missing vault costs one silent attempt per tick — no error state, no loop', async () => {
    const { obsidianVaultHandleRef, interval, setObsidianSyncStatus } = mountHook();
    getVaultAccess.mockResolvedValue(null);
    await interval.cb();
    await interval.cb();
    await interval.cb();
    expect(getVaultAccess).toHaveBeenCalledTimes(3); // exactly one per tick
    expect(obsidianVaultHandleRef.current).toBeNull();
    expect(setObsidianSyncStatus).not.toHaveBeenCalled(); // silent: no 'syncing', no 'error'
  });
});
