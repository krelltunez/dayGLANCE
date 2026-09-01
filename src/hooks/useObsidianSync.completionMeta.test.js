import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The writeback's completion-marker meta: built from the SYNCED setting
// (obsidianCompletionDates) + the persisted Tasks-plugin detection, passed as
// writeTaskStateToFile's final argument. Pinned here because the whole
// setting gate lives in this one ternary: OFF must pass NULL (strip, never
// regenerate), ON must carry the task's stored completedAt verbatim and the
// detected format. Capture-harness pattern (see the titleConflict test).

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
  vaultHasTasksPlugin: vi.fn(async () => false),
  detectTasksPluginNative: vi.fn(() => null),
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

const { default: useObsidianSync } = await import('./useObsidianSync.js');

const TASK_ID = 'obsidian-dg-aaaa1111';
const ISO_LOCAL = '2026-09-02T20:15:30-05:00';
const completedTask = () => ({
  id: TASK_ID, title: 'Alpha #obsidian', obsidianRawTitle: 'Alpha',
  obsidianBlockId: 'aaaa1111', importSource: 'obsidian',
  completed: true, completedAt: ISO_LOCAL,
  date: '2026-08-30', obsidianFileDate: '2026-08-30', startTime: null, duration: null,
});
const prevUncompleted = () => ({
  [TASK_ID]: { completed: false, startTime: null, duration: null, title: 'Alpha #obsidian', date: '2026-08-30' },
});

function useMountedWriteback({ completionDates, storedDetection }) {
  effects.length = 0;
  vi.stubGlobal('setTimeout', (cb, ms) => { if (!ms || ms < 3000) cb(); return 1; });
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('window', {});
  const store = new Map();
  if (storedDetection !== undefined) store.set('day-planner-obsidian-tasks-plugin', storedDetection);
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  const tasks = [completedTask()];
  useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks, setTasks: vi.fn(),
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null,
    obsidianCompletionDates: completionDates,
    obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError: vi.fn(), setObsidianLastSynced: vi.fn(),
    setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: {} },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: { current: prevUncompleted() },
    obsidianTasksRef: { current: tasks }, obsidianInboxRef: { current: [] },
  });
  for (const e of effects) e.fn();
}

beforeEach(() => { writeTaskStateToFile.mockReset(); writeTaskStateToFile.mockResolvedValue(true); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const metaArg = () => writeTaskStateToFile.mock.calls[0][12];

describe('completionMeta threading', () => {
  it('setting ON + Tasks plugin detected → { completedAt (verbatim), format: tasks }', () => {
    useMountedWriteback({ completionDates: true, storedDetection: 'true' });
    expect(writeTaskStateToFile).toHaveBeenCalledTimes(1);
    expect(metaArg()).toEqual({ completedAt: ISO_LOCAL, format: 'tasks' });
  });

  it('setting ON + no detection stored → the Dataview default', () => {
    useMountedWriteback({ completionDates: true });
    expect(metaArg()).toEqual({ completedAt: ISO_LOCAL, format: 'dataview' });
  });

  it('setting OFF → meta is NULL (strip-without-regenerate), regardless of detection', () => {
    useMountedWriteback({ completionDates: false, storedDetection: 'true' });
    expect(metaArg()).toBe(null);
  });
});
