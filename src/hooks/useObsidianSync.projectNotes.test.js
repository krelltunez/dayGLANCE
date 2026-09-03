import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// PROJECT AND GOAL NOTES, the link (companion spec §4.3, rulings A and F),
// through the real sync entry point: the plugin's link observations update
// the project record (locator, rename, missing, unlink), and the app-side
// link/unlink actions emit the frontmatter intents the plugin applies.

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
const emitBridgeIntent = vi.fn(() => true);
vi.mock('../utils/obsidianBridgeStream.js', () => ({
  cachedBridgePairingMeta: () => null,
  emitBridgeIntent: (...a) => emitBridgeIntent(...a),
  flushBridgeOutbox: vi.fn(async () => true),
  publishBridgeConfig: vi.fn(async () => {}),
  getBridgePairingMeta: vi.fn(async () => null),
}));
vi.mock('../utils/obsidianBridgeMode.js', () => ({
  recordBridgeMode: vi.fn(),
  reconcileArchivedBaseline: vi.fn(() => null),
}));
const fetchMock = vi.fn(async () => null);
vi.mock('../utils/obsidianBridgeInbound.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, fetchBridgeObservations: (...a) => fetchMock(...a) };
});

const { default: useObsidianSync } = await import('./useObsidianSync.js');

function useMountedHook({ projects = [], goals = [] } = {}) {
  effects.length = 0;
  vi.stubGlobal('setTimeout', (cb, ms) => { if (!ms || ms < 3000) cb(); return 1; });
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
  const state = { projects, goals };
  // In place: the mocked React never re-renders, so the hook's refs keep
  // pointing at these arrays (the app re-renders with fresh lists).
  const updateProject = vi.fn((id, updates) => {
    for (const p of state.projects) if (p.id === id) Object.assign(p, updates);
  });
  const updateGoal = vi.fn((id, updates) => {
    for (const g of state.goals) if (g.id === id) Object.assign(g, updates);
  });
  const api = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: [], setTasks: vi.fn(),
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null,
    obsidianCompletionDates: false,
    obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError: vi.fn(), setObsidianLastSynced: vi.fn(),
    setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: {} },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: { current: [] }, obsidianInboxRef: { current: [] },
    recycleBin: [], setRecycleBin: vi.fn(),
    projects: state.projects, goals: state.goals, updateProject, updateGoal,
  });
  api.bridgeHeartbeatRef.current = { obsidianRunning: true, pluginAuthoritative: true };
  return { state, api, updateProject, updateGoal };
}
const pairedHeartbeat = () => ({ paired: true, tsMs: Date.now(), accountId: 'acc', deviceId: 'dev' });
const linkObs = (fields) => ({ kind: 'observation', link: true, observedAt: '2026-09-03T10:00:00.000Z', ...fields });

beforeEach(() => {
  emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true);
  fetchMock.mockReset(); fetchMock.mockResolvedValue(null);
  heartbeatMock.mockReset(); heartbeatMock.mockResolvedValue(pairedHeartbeat());
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('project notes: link observations → the project record', () => {
  it('a link sets the locator; a rename moves it; a deletion marks it missing and keeps the path; an unlink clears it', async () => {
    const h = useMountedHook({ projects: [{ id: 'p1', title: 'House' }], goals: [{ id: 'g1', title: 'Home' }] });

    fetchMock.mockResolvedValue({ observations: [linkObs({ targetId: 'p1', path: 'Projects/House.md' }), linkObs({ targetId: 'g1', path: 'Goals/Home.md' })], maxSeq: 1 });
    await h.api.performObsidianSync();
    expect(h.updateProject).toHaveBeenCalledWith('p1', { obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: null });
    expect(h.updateGoal).toHaveBeenCalledWith('g1', { obsidianNotePath: 'Goals/Home.md', obsidianNoteMissingAt: null });

    // The hook reads the LIVE lists (refs), so the next cycle sees the update.
    fetchMock.mockResolvedValue({ observations: [linkObs({ targetId: 'p1', path: 'Archive/House.md', previousPath: 'Projects/House.md' })], maxSeq: 2 });
    await h.api.performObsidianSync();
    expect(h.state.projects[0].obsidianNotePath).toBe('Archive/House.md');

    fetchMock.mockResolvedValue({ observations: [linkObs({ targetId: 'p1', path: 'Archive/House.md', deleted: true })], maxSeq: 3 });
    await h.api.performObsidianSync();
    expect(h.state.projects[0]).toMatchObject({ obsidianNotePath: 'Archive/House.md', obsidianNoteMissingAt: '2026-09-03T10:00:00.000Z' });

    fetchMock.mockResolvedValue({ observations: [linkObs({ targetId: 'p1', path: 'Archive/House.md', unlinked: true })], maxSeq: 4 });
    await h.api.performObsidianSync();
    expect(h.state.projects[0]).toMatchObject({ obsidianNotePath: null, obsidianNoteMissingAt: null });
  });
});

describe('project notes: link and unlink from dayGLANCE', () => {
  it('linkProjectNote queues the frontmatter intent FIRST and updates the record only when it queued', () => {
    const h = useMountedHook({ projects: [{ id: 'p1', title: 'House' }] });
    expect(h.api.linkProjectNote('project', 'p1', '[[Projects/House]]')).toBe(true);
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_link', { path: 'Projects/House.md', targetId: 'p1' });
    expect(h.updateProject).toHaveBeenCalledWith('p1', { obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: null });

    emitBridgeIntent.mockReturnValue(false); // unpaired vault: nothing durable to write the key
    h.updateProject.mockClear();
    expect(h.api.linkProjectNote('project', 'p1', 'Elsewhere')).toBe(false);
    expect(h.updateProject).not.toHaveBeenCalled();
    expect(h.api.linkProjectNote('project', 'p1', '   ')).toBe(false);
  });

  it('unlinkProjectNote clears the record and asks the plugin to remove the key from the note it pointed at', () => {
    const h = useMountedHook({ projects: [{ id: 'p1', title: 'House', obsidianNotePath: 'Projects/House.md' }] });
    expect(h.api.unlinkProjectNote('project', 'p1')).toBe(true);
    expect(h.updateProject).toHaveBeenCalledWith('p1', { obsidianNotePath: null, obsidianNoteMissingAt: null });
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_unlink', { path: 'Projects/House.md', targetId: 'p1' });
  });
});
