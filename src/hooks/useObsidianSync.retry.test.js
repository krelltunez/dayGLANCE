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
  probeVaultAccess: vi.fn(async () => 'ok'),
  getVaultAccess: (...a) => getVaultAccess(...a),
  syncObsidianVault: vi.fn(async () => null),
  syncObsidianVaultNative: vi.fn(async () => null),
  writeTaskStateToFile: vi.fn(async () => false),
  writeTaskStateNative: vi.fn(() => false),
  simpleHash: vi.fn(() => 'h'),
  deriveBlockId: vi.fn(() => 'testblok0'),
  appIdForBlockId: vi.fn((b) => `obsidian-dg-${b}`),
  readWikiNote: vi.fn(async () => null),
  writeWikiNote: vi.fn(async () => {}),
  scanVaultNotes: vi.fn(async () => ({ names: [], unportable: [] })),
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
  nativeListNotesAsync: async () => null,
  nativeSetVaultSettings: vi.fn(),
  nativeSetLaunchOnWrite: vi.fn(),
}));

const { default: useObsidianSync } = await import('./useObsidianSync.js');

function useMountedObsidianSync({ obsidianConfig = { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' } } = {}) {
  effects.length = 0;
  const obsidianVaultHandleRef = { current: null };
  const setObsidianSyncStatus = vi.fn();
  const hook = useObsidianSync({
    isTrayMode: false,
    dataLoaded: true,
    tasks: [], setTasks: vi.fn(),
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(),
    setWikilinkCandidates: vi.fn(),
    obsidianConfig,
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
  return { obsidianVaultHandleRef, interval, listeners, setObsidianSyncStatus, performObsidianSync: hook.performObsidianSync };
}

beforeEach(() => {
  getVaultAccess.mockReset();
  vi.unstubAllGlobals();
});

describe('restore retry — poll and visibility ticks are not gated on a handle', () => {
  it('failed restore, then vault reachable: the next poll tick reconnects without user action', async () => {
    const { obsidianVaultHandleRef, interval } = useMountedObsidianSync();
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
    const { obsidianVaultHandleRef, listeners } = useMountedObsidianSync();
    expect(listeners.visibilitychange).toBeTypeOf('function');

    const handle = { kind: 'directory', name: 'Vault' };
    getVaultAccess.mockResolvedValueOnce(handle);
    await listeners.visibilitychange();
    expect(getVaultAccess).toHaveBeenCalledTimes(1);
    expect(obsidianVaultHandleRef.current).toBe(handle);
  });

  // A configured vault this device cannot reach used to be entirely silent,
  // so it read as connected (and a stream-side cycle as "Synced") while
  // every note read and vault write failed. Now it is said ONCE, as an error
  // on the way in, and then stays quiet: still one attempt per tick, no loop,
  // no error re-raised per poll. MUTATION: drop sayVaultLost and the first
  // expectation fails; drop the once-guard and the call count does.
  it('a genuinely missing vault is said once, then costs one quiet attempt per tick, with no loop', async () => {
    const { obsidianVaultHandleRef, interval, setObsidianSyncStatus } = useMountedObsidianSync();
    getVaultAccess.mockResolvedValue(null);
    await interval.cb();
    await interval.cb();
    await interval.cb();
    expect(getVaultAccess).toHaveBeenCalledTimes(3); // exactly one per tick
    expect(obsidianVaultHandleRef.current).toBeNull();
    expect(setObsidianSyncStatus).toHaveBeenCalledTimes(1); // said once: never 'syncing', never a second 'error'
    expect(setObsidianSyncStatus).toHaveBeenCalledWith('error');
  });
});

// Most users never set up Obsidian. Coming back to the window used to run a
// sync anyway, find no vault and raise "Can't reach your Obsidian vault" on
// a device that never had one (v5.4.2). MUTATION: drop the visibility gate
// and getVaultAccess is called; drop the null-handle gate too and the error
// is raised.
describe('a device with Obsidian not set up', () => {
  it('coming back to the window does nothing: no vault lookup, no error', async () => {
    const { listeners, setObsidianSyncStatus } = useMountedObsidianSync({ obsidianConfig: {} });
    getVaultAccess.mockResolvedValue(null);
    await listeners.visibilitychange?.();
    expect(getVaultAccess).not.toHaveBeenCalled();
    expect(setObsidianSyncStatus).not.toHaveBeenCalled();
  });

  // Turned off in Settings, with the vault still open in this session: the
  // window coming back must not sync it.
  it('coming back to the window after turning Obsidian off does not sync', async () => {
    const { obsidianVaultHandleRef, listeners, setObsidianSyncStatus } = useMountedObsidianSync({ obsidianConfig: { enabled: false } });
    obsidianVaultHandleRef.current = { kind: 'directory', name: 'Vault' };
    await listeners.visibilitychange?.();
    expect(setObsidianSyncStatus).not.toHaveBeenCalled();
  });

  it('a sync reached some other way says nothing either', async () => {
    const { setObsidianSyncStatus, performObsidianSync } = useMountedObsidianSync({ obsidianConfig: { enabled: false } });
    getVaultAccess.mockResolvedValue(null);
    await performObsidianSync();
    expect(setObsidianSyncStatus).not.toHaveBeenCalledWith('error');
  });
});
