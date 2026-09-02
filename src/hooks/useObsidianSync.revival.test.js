import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// REVIVAL STAMPING, end to end (§3.10 ruling 6 — see
// utils/mergeObsidianTasks.revival.test.js for the merge-level pins and the
// two guardrails). The founding symptom: delete a task line in Obsidian,
// change your mind past the confirmation hold, retype it verbatim — the
// same content hash (or, for a stamped task, the deterministic deriveBlockId
// re-minting the tombstoned token) collided with the tombstone, and the
// epoch lastModified on fresh imports meant the documented re-creation
// revival never fired: gone until the 60-day GC, with the line sitting in
// the note. These pins drive the real sync entry points — the observation
// path, the direct scan, and the worst variant, the come-back-then-vanish
// flicker where stamp-on-sight re-derives the tombstoned dg id.

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const heartbeatMock = vi.fn(async () => null);
const directScanMock = vi.fn(async () => ({ dailyNotes: {}, scheduledTasks: [], inboxTasks: [] }));
vi.mock('../obsidian.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    tryRestoreVaultAccess: vi.fn(async () => null),
    getVaultAccess: vi.fn(async () => null),
    syncObsidianVault: (...a) => directScanMock(...a),
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
const { legacyObsidianId, deriveBlockId, appIdForBlockId, applyBridgeIntent } =
  await import('@glance-apps/obsidian-format');
const { dropTombstonedObsidianTasks } = await import('../utils/obsidianDeletions.js');
const { __setBlockIdWritesForTests } = await import('../utils/obsidianWritePolicy.js');

const D = '2026-08-30';
const RAW = 'Retype me exactly';
const L = legacyObsidianId(D, RAW);
const B = deriveBlockId(D, RAW);
const DG = appIdForBlockId(B);
const NOTE = `# Day\n\n## Tasks\n- [ ] ${RAW}\n`;
const T1_ISO = '2026-08-30T10:00:00.000Z'; // tombstone (deletion statement)
const T2 = new Date('2026-08-30T11:00:00.000Z').getTime(); // retyped note mtime
const T2_ISO = new Date(T2).toISOString();
const T3 = new Date('2026-08-30T11:05:00.000Z').getTime(); // stamp-echo mtime
const T3_ISO = new Date(T3).toISOString();

let store;
function useMountedRevivalHook({ tasks = [], inbox = [], prevSnap = null, freshStore = true } = {}) {
  effects.length = 0;
  vi.stubGlobal('setTimeout', (cb, ms) => { if (!ms || ms < 3000) cb(); return 1; });
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('window', {});
  if (freshStore || !store) store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  const state = { tasks, inbox };
  const syncRef = { current: false };
  const tasksRef = { current: state.tasks };
  const inboxRef = { current: state.inbox };
  const setTasks = (up) => {
    state.tasks = typeof up === 'function' ? up(state.tasks) : up;
    tasksRef.current = state.tasks;
  };
  const setUnscheduledTasks = (up) => {
    state.inbox = typeof up === 'function' ? up(state.inbox) : up;
    inboxRef.current = state.inbox;
  };
  const prevRef = { current: prevSnap ?? {} };
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
    obsidianPrevTaskStateRef: prevRef,
    obsidianTasksRef: tasksRef, obsidianInboxRef: inboxRef,
    recycleBin: [], setRecycleBin: vi.fn(),
  });
  api.bridgeHeartbeatRef.current = { obsidianRunning: true, pluginAuthoritative: true };
  return { state, prevRef, api };
}

const runWritebackEffect = () => {
  for (const e of effects) if (e.deps?.length === 3) e.fn();
};
const allTasks = (state) => [...state.tasks, ...state.inbox];
const pairedHeartbeat = () => ({ paired: true, tsMs: Date.now(), accountId: 'acc', deviceId: 'dev' });
const seedTombstone = (id, atIso) => store.set('day-planner-deleted-obsidian-keys', JSON.stringify({ [id]: atIso }));

beforeEach(() => {
  emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true);
  fetchMock.mockReset(); fetchMock.mockResolvedValue(null);
  heartbeatMock.mockReset(); heartbeatMock.mockResolvedValue(null);
  directScanMock.mockReset(); directScanMock.mockResolvedValue({ dailyNotes: {}, scheduledTasks: [], inboxTasks: [] });
});
afterEach(() => { __setBlockIdWritesForTests(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('revival stamping, end to end (§3.10 ruling 6)', () => {
  it('verbatim retype revives on the next OBSERVATION: admitted at the note mtime, no pending deletion, survives a second device’s apply gate', async () => {
    __setBlockIdWritesForTests(false); // isolate revival from the stamp
    heartbeatMock.mockResolvedValue(pairedHeartbeat());
    const h = useMountedRevivalHook({});
    seedTombstone(L, T1_ISO);
    fetchMock.mockResolvedValue({
      observations: [{ path: `${D}.md`, content: NOTE, mtime: T2 }], maxSeq: 3,
    });
    await h.api.performObsidianSync();

    const revived = allTasks(h.state).find(t => String(t.id) === L);
    expect(revived).toBeDefined();
    expect(revived.lastModified).toBe(T2_ISO); // lifted — this is what propagates
    // The revived id was scanned, so note-scoped inference has nothing pending.
    expect(JSON.parse(store.get('day-planner-obsidian-pending-note-deletions') ?? '{}').entries ?? {}).toEqual({});
    // Second device: the same row passes the apply gate against the same tombstone.
    expect(dropTombstonedObsidianTasks([revived], { [L]: T1_ISO })).toEqual([revived]);
  });

  it('verbatim retype revives on the next DIRECT SCAN too', async () => {
    __setBlockIdWritesForTests(false);
    heartbeatMock.mockResolvedValue(null); // stale heartbeat → direct mode
    const h = useMountedRevivalHook({});
    seedTombstone(L, T1_ISO);
    directScanMock.mockResolvedValue({
      dailyNotes: { [D]: { text: NOTE, lastModified: T2_ISO, fromObsidian: true } },
      scheduledTasks: [{
        id: L, importSource: 'obsidian', obsidianRawTitle: RAW, obsidianFileDate: D,
        title: `${RAW} #obsidian`, completed: false, lastModified: '1970-01-01T00:00:00.000Z',
      }],
      inboxTasks: [],
    });
    await h.api.performObsidianSync();
    const revived = allTasks(h.state).find(t => String(t.id) === L);
    expect(revived).toBeDefined();
    expect(revived.lastModified).toBe(T2_ISO);
  });

  it('the FLICKER variant: retype of a formerly-stamped task imports, restamps to the tombstoned dg id, and the stamp’s own echo revives it instead of vanishing', async () => {
    __setBlockIdWritesForTests(true);
    heartbeatMock.mockResolvedValue(pairedHeartbeat());
    // The task was stamped once, then its line deleted: the tombstone sits on
    // the dg id. The retyped line has no token, so it imports under the
    // legacy id — then stamp-on-sight re-derives the SAME token.
    const h1 = useMountedRevivalHook({});
    seedTombstone(DG, T1_ISO);
    fetchMock.mockResolvedValue({
      observations: [{ path: `${D}.md`, content: NOTE, mtime: T2 }], maxSeq: 5,
    });
    await h1.api.performObsidianSync();
    expect(allTasks(h1.state).map(t => String(t.id))).toEqual([L]);

    // The nudged writeback pass stamps it back onto the tombstoned identity.
    const h2 = useMountedRevivalHook({
      tasks: h1.state.tasks, inbox: h1.state.inbox,
      prevSnap: h1.prevRef.current, freshStore: false,
    });
    runWritebackEffect();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    const [type, fields] = emitBridgeIntent.mock.calls[0];
    expect(fields.blockId).toBe(B);
    expect(allTasks(h2.state).map(t => String(t.id))).toEqual([DG]); // the collision is real

    // The stamp's own write echo: the plugin applies the intent (REAL
    // applier) and the tagged note comes back as the next observation.
    // Pre-ruling-6 this merge DROPPED the task (epoch loses to the
    // tombstone) — the come-back-then-vanish flicker. Now the note mtime
    // outdates the deletion statement and the task stays, durably.
    const echoed = applyBridgeIntent(NOTE, { type, ...fields });
    expect(echoed.text).toContain(`^dg-${B}`);
    fetchMock.mockResolvedValue({
      observations: [{ path: `${D}.md`, content: echoed.text, mtime: T3 }], maxSeq: 6,
    });
    await h2.api.performObsidianSync();

    const alive = allTasks(h2.state).find(t => String(t.id) === DG);
    expect(alive).toBeDefined();
    expect(alive.lastModified).toBe(T3_ISO);
    expect(allTasks(h2.state)).toHaveLength(1); // one task, one identity — no orphan pair
    expect(dropTombstonedObsidianTasks([alive], { [DG]: T1_ISO })).toEqual([alive]);
  });
});
