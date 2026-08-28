import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Task-write / restore failure surfacing: the latched sync-error state.
// Uses the retry test's capture pattern (mock React, run effects manually).

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const writeTaskStateToFile = vi.fn();
const writeTaskStateNative = vi.fn();
const syncObsidianVault = vi.fn();
vi.mock('../obsidian.js', () => ({
  tryRestoreVaultAccess: vi.fn(async () => null),
  getVaultAccess: vi.fn(async () => null),
  syncObsidianVault: (...a) => syncObsidianVault(...a),
  syncObsidianVaultNative: vi.fn(async () => null),
  writeTaskStateToFile: (...a) => writeTaskStateToFile(...a),
  writeTaskStateNative: (...a) => writeTaskStateNative(...a),
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

const {
  default: useObsidianSync,
  OBSIDIAN_TASK_WRITE_ERROR,
  obsidianRestoreFailureMessage,
  isVaultAccessLossError,
} = await import('./useObsidianSync.js');

const TASK_ID = 'obsidian-2026-08-28-h1';
const changedTask = () => ({
  id: TASK_ID, title: 'T #obsidian', obsidianRawTitle: 'T', importSource: 'obsidian',
  completed: true, date: '2026-08-28', obsidianFileDate: '2026-08-28', startTime: null, duration: null,
});
const prevSnapshot = () => ({
  [TASK_ID]: { completed: false, startTime: null, duration: null, title: 'T #obsidian', date: '2026-08-28' },
});

// setTimeout stub: sub-3s waits (the scan's 2s minimum-spinner fill) run
// immediately; the 3s/5s status auto-dismiss timers are RECORDED, not run,
// so tests can assert whether a dismiss was scheduled.
let dismissTimers;

function useMountedSurfacing({ handle = {}, tasks = [], prev = {}, displayedError = null, isNative = false } = {}) {
  effects.length = 0;
  dismissTimers = [];
  vi.stubGlobal('setTimeout', (cb, ms) => { if (!ms || ms < 3000) cb(); else dismissTimers.push({ cb, ms }); return 1; });
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

  const setObsidianSyncError = vi.fn();
  const setObsidianSyncStatus = vi.fn();
  const prevRef = { current: prev };
  const api = useObsidianSync({
    isTrayMode: false,
    dataLoaded: true,
    tasks, setTasks: vi.fn(),
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(),
    setWikilinkCandidates: vi.fn(),
    setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    setObsidianConfig: vi.fn(),
    obsidianLaunchOnWrite: null,
    obsidianSyncError: displayedError,
    setObsidianSyncStatus, setObsidianSyncError,
    setObsidianLastSynced: vi.fn(),
    obsidianVaultHandleRef: { current: isNative ? 'native' : handle },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: prevRef,
    obsidianTasksRef: { current: tasks },
    obsidianInboxRef: { current: [] },
  });
  for (const e of effects) e.fn();
  // Re-fires the writeback effect as if the same task changed again: the
  // effect rebuilds the snapshot after each pass, so a plain re-run would see
  // no delta — reset the snapshot to the pre-change state first.
  const rerunWritebackWithChange = () => {
    prevRef.current = JSON.parse(JSON.stringify(prev));
    // The writeback effect: deps [tasks, unscheduledTasks, enabled] — the
    // only THREE-dep effect keyed on the tasks array itself (the tasks-ref
    // mirror has two deps; the restore-event effect's first dep is isTrayMode).
    const writeback = effects.find((e) => Array.isArray(e.deps) && e.deps.length === 3 && e.deps[0] === tasks);
    writeback.fn();
  };
  return { api, setObsidianSyncError, setObsidianSyncStatus, rerunWritebackWithChange };
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  writeTaskStateToFile.mockReset();
  writeTaskStateNative.mockReset();
  syncObsidianVault.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const flush = () => new Promise((r) => process.nextTick(r));

describe('the task-write failure latch', () => {
  it('a failed desktop write surfaces ONCE, persists (no auto-dismiss), and repeated failures stay latched', async () => {
    writeTaskStateToFile.mockRejectedValue(new Error('EIO'));
    const { setObsidianSyncError, setObsidianSyncStatus, rerunWritebackWithChange } = useMountedSurfacing({ tasks: [changedTask()], prev: prevSnapshot() });
    await flush();
    expect(setObsidianSyncError).toHaveBeenCalledTimes(1);
    expect(setObsidianSyncError).toHaveBeenCalledWith(OBSIDIAN_TASK_WRITE_ERROR);
    expect(setObsidianSyncStatus).toHaveBeenCalledWith('error');
    expect(dismissTimers).toEqual([]); // persistent: nothing scheduled to dismiss it

    // Second failing pass while latched: no second transition.
    rerunWritebackWithChange();
    await flush();
    expect(writeTaskStateToFile).toHaveBeenCalledTimes(2); // it really failed again
    expect(setObsidianSyncError).toHaveBeenCalledTimes(1);
  });

  it('a pass failing on several tasks collapses to one transition', async () => {
    writeTaskStateToFile.mockRejectedValue(new Error('EIO'));
    const t2 = { ...changedTask(), id: 'obsidian-2026-08-28-h2', obsidianRawTitle: 'U', title: 'U #obsidian' };
    const prev = { ...prevSnapshot(), 'obsidian-2026-08-28-h2': { completed: false, startTime: null, duration: null, title: 'U #obsidian', date: '2026-08-28' } };
    const { setObsidianSyncError } = useMountedSurfacing({ tasks: [changedTask(), t2], prev });
    await flush();
    expect(writeTaskStateToFile).toHaveBeenCalledTimes(2);
    expect(setObsidianSyncError).toHaveBeenCalledTimes(1);
  });

  it('a later CONFIRMED write clears the error when the displayed error is ours', async () => {
    writeTaskStateToFile.mockRejectedValueOnce(new Error('EIO')).mockResolvedValue(true);
    // Mounted with our message displayed (the mirror the exact-match uses).
    const { setObsidianSyncError, setObsidianSyncStatus, rerunWritebackWithChange } = useMountedSurfacing({
      tasks: [changedTask()], prev: prevSnapshot(), displayedError: OBSIDIAN_TASK_WRITE_ERROR,
    });
    await flush(); // first pass fails and latches
    rerunWritebackWithChange(); // second pass succeeds
    await flush();
    expect(setObsidianSyncError).toHaveBeenLastCalledWith(null);
    expect(setObsidianSyncStatus).toHaveBeenLastCalledWith('idle');
  });

  it('a concurrent wiki-note error is NEVER stomped by a task-write success', async () => {
    writeTaskStateToFile.mockRejectedValueOnce(new Error('EIO')).mockResolvedValue(true);
    // The displayed error is a wiki message, not ours.
    const { setObsidianSyncError, rerunWritebackWithChange } = useMountedSurfacing({
      tasks: [changedTask()], prev: prevSnapshot(), displayedError: 'Note "X" was not written: the vault write failed.',
    });
    await flush();
    rerunWritebackWithChange();
    await flush();
    // The latch released, but no clearing calls were made for the wiki error.
    expect(setObsidianSyncError).not.toHaveBeenCalledWith(null);
  });

  it('native: the onWriteFailure callback is passed and drives the same latch; benign no-match does not', async () => {
    // Genuine failure: the mock invokes the callback (arg index 9), like
    // writeTaskStateNative does on an unreadable note or refused write.
    writeTaskStateNative.mockImplementation((...args) => { args[9]?.(); return false; });
    const { setObsidianSyncError } = useMountedSurfacing({ tasks: [changedTask()], prev: prevSnapshot(), isNative: true });
    await flush();
    expect(setObsidianSyncError).toHaveBeenCalledWith(OBSIDIAN_TASK_WRITE_ERROR);

    // Benign no-match: false WITHOUT the callback → no error surfaced.
    writeTaskStateNative.mockImplementation(() => false);
    const { setObsidianSyncError: quiet } = useMountedSurfacing({ tasks: [changedTask()], prev: prevSnapshot(), isNative: true });
    await flush();
    expect(quiet).not.toHaveBeenCalled();
  });
});

describe('scan interplay', () => {
  it('a successful scan clears the task-write latch (clearing path 2)', async () => {
    writeTaskStateToFile.mockRejectedValue(new Error('EIO'));
    syncObsidianVault.mockResolvedValue({ dailyNotes: {}, scheduledTasks: [], inboxTasks: [] });
    const { api, setObsidianSyncError, setObsidianSyncStatus, rerunWritebackWithChange } = useMountedSurfacing({ tasks: [changedTask()], prev: prevSnapshot() });
    await flush(); // write failure latches
    await api.performObsidianSync();
    expect(setObsidianSyncError).toHaveBeenLastCalledWith(null);
    expect(setObsidianSyncStatus).toHaveBeenLastCalledWith('success');
    // …and the latch is open again: a fresh failure re-reports.
    rerunWritebackWithChange();
    await flush();
    expect(setObsidianSyncError).toHaveBeenLastCalledWith(OBSIDIAN_TASK_WRITE_ERROR);
  });

  it('an access-loss scan error persists; a generic scan error keeps the transient dismiss', async () => {
    syncObsidianVault.mockRejectedValueOnce(new Error('Vault access has been revoked — re-select the vault folder in Settings'));
    const { api, setObsidianSyncError } = useMountedSurfacing({});
    await api.performObsidianSync();
    expect(setObsidianSyncError).toHaveBeenLastCalledWith(expect.stringContaining('revoked'));
    expect(dismissTimers).toEqual([]); // persistent

    syncObsidianVault.mockRejectedValueOnce(new Error('Failed to parse daily notes from vault: boom'));
    await api.performObsidianSync();
    expect(dismissTimers.some((t) => t.ms === 5000)).toBe(true); // transient, as before
  });

  it('isVaultAccessLossError matches exactly the two bridge messages', () => {
    expect(isVaultAccessLossError('Vault access has been revoked — re-select the vault folder in Settings')).toBe(true);
    expect(isVaultAccessLossError('vault access failed — the stored folder bookmark could not be opened')).toBe(true);
    expect(isVaultAccessLossError('Could not read daily note 2026-08-28.md from the vault')).toBe(false);
    expect(isVaultAccessLossError(null)).toBe(false);
  });
});

describe('RESTORE_FAILED surfacing (Android crash-safe writes)', () => {
  it("'failed' surfaces the missing-note message — which never claims the changes are safe in dayGLANCE", () => {
    const { setObsidianSyncError, setObsidianSyncStatus } = useMountedSurfacing({});
    global.window.__dgVaultRestoreEvent('failed', '2026-08-28.md');
    const msg = obsidianRestoreFailureMessage('2026-08-28.md');
    expect(setObsidianSyncError).toHaveBeenCalledWith(msg);
    expect(setObsidianSyncStatus).toHaveBeenCalledWith('error');
    expect(msg).toContain('.2026-08-28.md.dgtmp'); // points at the hidden backup
    expect(msg).not.toMatch(/saved in dayGLANCE/);  // the write message's reassurance would be wrong here
    // Latched: a second 'failed' does not re-transition.
    global.window.__dgVaultRestoreEvent('failed', '2026-08-28.md');
    expect(setObsidianSyncError).toHaveBeenCalledTimes(1);
  });

  it("'restored' clears it when the displayed error is the restore message; a first-try restore is silent", () => {
    const msg = obsidianRestoreFailureMessage('2026-08-28.md');
    const { setObsidianSyncError, setObsidianSyncStatus } = useMountedSurfacing({ displayedError: msg });
    // First-try restore with nothing latched: silent.
    global.window.__dgVaultRestoreEvent('restored', '2026-08-28.md');
    expect(setObsidianSyncError).not.toHaveBeenCalled();
    // Failed → latched → restored → cleared.
    global.window.__dgVaultRestoreEvent('failed', '2026-08-28.md');
    global.window.__dgVaultRestoreEvent('restored', '2026-08-28.md');
    expect(setObsidianSyncError).toHaveBeenLastCalledWith(null);
    expect(setObsidianSyncStatus).toHaveBeenLastCalledWith('idle');
  });

  it('a missing-note error OUTLIVES a successful scan — the scan legitimately completes without the file', async () => {
    syncObsidianVault.mockResolvedValue({ dailyNotes: {}, scheduledTasks: [], inboxTasks: [] });
    const { api, setObsidianSyncError, setObsidianSyncStatus } = useMountedSurfacing({});
    global.window.__dgVaultRestoreEvent('failed', '2026-08-28.md');
    await api.performObsidianSync();
    expect(setObsidianSyncError).toHaveBeenLastCalledWith(obsidianRestoreFailureMessage('2026-08-28.md'));
    expect(setObsidianSyncStatus).toHaveBeenLastCalledWith('error');
  });
});
