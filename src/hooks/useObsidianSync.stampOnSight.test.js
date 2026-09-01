import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// STAMP ON SIGHT + NOTE-SCOPED DELETION INFERENCE (the untagged-rename fix,
// two halves; see the writeback's "STAMP ON SIGHT" comment and
// utils/obsidianNoteScopedDeletions.js).
//
// The founding incident (2026-08-30): an untagged line retitled IN OBSIDIAN.
// An untagged line's only identity is its content hash, so the inbound edit
// is structurally delete+create — the new title imports as a NEW task, and
// with the vault-wide deletion detector deliberately absent in plugin mode,
// the old task became a permanent orphan. Fix 2 (stamp on sight) assigns
// ^dg- identity on FIRST IMPORT so later renames are retitles of one
// durable identity; fix 1 (note-scoped inference) tombstones what an
// observed note's complete parse no longer carries — which also
// retro-cleans orphans the old behavior left behind.

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
const { applyBridgeObservations } = await import('../utils/obsidianBridgeInbound.js');
const { mergeObsidianTasks } = await import('../utils/mergeObsidianTasks.js');
const { RETIRED_TASK_IDS_STORAGE_KEY } = await import('../utils/retiredTaskIds.js');
const { __setBlockIdWritesForTests } = await import('../utils/obsidianWritePolicy.js');
const obsidianMod = await import('../obsidian.js');

const DATE = '2026-08-30';
const RAW = 'Test of dayGLANCE bridge 📅 2026-08-30';
const LEGACY_ID = legacyObsidianId(DATE, RAW);
const BLOCK = deriveBlockId(DATE, RAW);
const DG_ID = appIdForBlockId(BLOCK);
const NOTE = `# Day\n\n## Tasks\n- [ ] ${RAW}\n`;
const MTIME = new Date('2026-08-30T17:00:00.000Z').getTime();
const MTIME_ISO = new Date(MTIME).toISOString();
// A 📅-only line (no time) classifies as an INBOX task — assertions below
// read the list the parse actually lands it in.
const allIds = (state) => [...state.tasks, ...state.inbox].map(t => String(t.id));

const OLD_RAW = 'Another test of dayGLANCE bridge';
const OLD_ID = legacyObsidianId(DATE, OLD_RAW);

// An untagged imported task at rest: snapshot matches state exactly, so the
// writeback has NO change to detect — the stamp is the only trigger left.
const restingLegacyTask = (over = {}) => ({
  id: LEGACY_ID, title: `${RAW} #obsidian`, obsidianRawTitle: RAW,
  importSource: 'obsidian', completed: false,
  date: DATE, obsidianFileDate: DATE, startTime: null, duration: null,
  lastModified: '2026-08-30T12:00:00.000Z',
  ...over,
});
const snapFor = (t) => ({
  completed: t.completed, startTime: t.startTime || null, duration: t.duration || null,
  title: t.title, date: t.date || null,
});

let store;
let setTasksCalls;
function useMountedSightHook({ tasks = [], inbox = [], prevSnap = null, freshStore = true, config = {} } = {}) {
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
  setTasksCalls = [];
  const setTasks = (up) => {
    setTasksCalls.push({ duringSync: syncRef.current });
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
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd', ...config },
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
  return { state, prevRef, api, syncRef };
}

const runWritebackEffect = () => {
  for (const e of effects) if (e.deps?.length === 3) e.fn();
};

const pairedHeartbeat = () => ({ paired: true, tsMs: Date.now(), accountId: 'acc', deviceId: 'dev' });

beforeEach(() => {
  emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true);
  fetchMock.mockReset(); fetchMock.mockResolvedValue(null);
  heartbeatMock.mockReset(); heartbeatMock.mockResolvedValue(null);
});
afterEach(() => { __setBlockIdWritesForTests(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('stamp on sight (fix 2): identity-assignment write fired by import', () => {
  it('an untagged task AT REST — no title/state/date change — emits the stamp, commits on enqueue, and the round-trip converges on one dg task', () => {
    __setBlockIdWritesForTests(true);
    const task = restingLegacyTask();
    const { state, prevRef } = useMountedSightHook({ tasks: [task], prevSnap: { [LEGACY_ID]: snapFor(task) } });
    runWritebackEffect();

    // The stamp is a plain task_state intent carrying the derived block id.
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    const [type, fields] = emitBridgeIntent.mock.calls[0];
    expect(type).toBe('task_state');
    expect(fields.blockId).toBe(BLOCK);

    // Gate (a)'s general rule, unchanged: the identity move committed on
    // enqueue — id, snapshot entry, and retirement record all moved.
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBe(DG_ID);
    expect(state.tasks[0].obsidianBlockId).toBe(BLOCK);
    expect(prevRef.current[DG_ID]).toBeDefined();
    expect(prevRef.current[LEGACY_ID]).toBeUndefined();
    expect(JSON.parse(store.get(RETIRED_TASK_IDS_STORAGE_KEY))[LEGACY_ID]).toMatchObject({ successor: DG_ID });

    // Round trip: REAL intent application → REAL observation parse → REAL
    // merge — one task, under the durable id.
    const applied = applyBridgeIntent(NOTE, { type, ...fields });
    expect(applied.changed).toBe(true);
    expect(applied.text).toContain(`^dg-${BLOCK}`);
    const obs = applyBridgeObservations(
      [{ path: `${DATE}.md`, content: applied.text, mtime: MTIME }],
      { existingTasks: state.tasks, existingInbox: state.inbox, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    );
    const merged = mergeObsidianTasks(state.tasks, obs.scheduledTasks, obs.scannedIds, () => ({}), {});
    const obsidianTasks = merged.filter(t => t.importSource === 'obsidian');
    expect(obsidianTasks).toHaveLength(1);
    expect(obsidianTasks[0].id).toBe(DG_ID);
  });

  it('never fires: on the read release, outside plugin authority, or for an already-tagged task', () => {
    // Read release — no new ids minted, same gate as every stamp.
    __setBlockIdWritesForTests(false);
    const t1 = restingLegacyTask();
    useMountedSightHook({ tasks: [t1], prevSnap: { [LEGACY_ID]: snapFor(t1) } });
    runWritebackEffect();
    expect(emitBridgeIntent).not.toHaveBeenCalled();

    // Direct mode (not authoritative): stamp-on-sight is plugin-mode only —
    // no intent AND no direct write (a machine-initiated direct write would
    // arm launch-on-write with no user action behind it).
    __setBlockIdWritesForTests(true);
    const t2 = restingLegacyTask();
    const { api } = useMountedSightHook({ tasks: [t2], prevSnap: { [LEGACY_ID]: snapFor(t2) } });
    api.bridgeHeartbeatRef.current = { obsidianRunning: false, pluginAuthoritative: false };
    obsidianMod.writeTaskStateToFile.mockClear();
    runWritebackEffect();
    expect(emitBridgeIntent).not.toHaveBeenCalled();
    expect(obsidianMod.writeTaskStateToFile).not.toHaveBeenCalled();

    // Already tagged: identity exists, nothing to assign.
    const tagged = restingLegacyTask({ id: DG_ID, obsidianBlockId: BLOCK });
    useMountedSightHook({ tasks: [tagged], prevSnap: { [DG_ID]: snapFor(tagged) } });
    runWritebackEffect();
    expect(emitBridgeIntent).not.toHaveBeenCalled();
  });

  it('THE RE-MINT REFUSAL (2026-08-31 war): a resurrected legacy task whose retirement already names the derived successor, with that successor TOMBSTONED, is not stamped again — no intent, no identity move, id unchanged', () => {
    __setBlockIdWritesForTests(true);
    const task = restingLegacyTask();
    const { state, prevRef } = useMountedSightHook({ tasks: [task], prevSnap: { [LEGACY_ID]: snapFor(task) } });
    // The war's on-record state: this exact identity move already completed
    // once (retirement names DG_ID) and its outcome is on the record too
    // (DG_ID tombstoned via note-scoped deletion). Re-minting would re-run
    // the loop's dayGLANCE edge every ~2s.
    store.set(RETIRED_TASK_IDS_STORAGE_KEY, JSON.stringify({
      [LEGACY_ID]: { retiredAt: '2026-08-31T04:00:00.000Z', successor: DG_ID },
    }));
    store.set('day-planner-deleted-obsidian-keys', JSON.stringify({ [DG_ID]: '2026-08-31T04:22:12.000Z' }));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let refusalLogged;
    try {
      runWritebackEffect();
      // Loud on purpose: this refusal is the war's dayGLANCE edge being cut.
      refusalLogged = errSpy.mock.calls.some(c => String(c[0]).includes('REFUSING to re-mint'));
    } finally { errSpy.mockRestore(); }
    expect(emitBridgeIntent).not.toHaveBeenCalled();
    expect(state.tasks[0].id).toBe(LEGACY_ID); // no identity move
    expect(prevRef.current[LEGACY_ID]).toBeDefined();
    expect(refusalLogged).toBe(true);

    // The refusal is NARROW: the same retirement WITHOUT the tombstone (an
    // ordinary first stamp whose successor row simply isn't here yet) still
    // stamps — determinism stays the unanimity feature everywhere else.
    emitBridgeIntent.mockClear();
    const again = restingLegacyTask();
    useMountedSightHook({ tasks: [again], prevSnap: { [LEGACY_ID]: snapFor(again) } });
    store.set(RETIRED_TASK_IDS_STORAGE_KEY, JSON.stringify({
      [LEGACY_ID]: { retiredAt: '2026-08-31T04:00:00.000Z', successor: DG_ID },
    }));
    runWritebackEffect();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    expect(emitBridgeIntent.mock.calls[0][1].blockId).toBe(BLOCK);
  });

  it('AUDIT FIX H1: on a custom-pattern vault the emitted intent targets the PATTERNED filename, not `${date}.md`', () => {
    // Pre-fix both the direct writer and this emit hardcoded `${date}.md`,
    // so on a custom-pattern vault the intent targeted a nonexistent file
    // applyBridgeIntent could never change — while commit-on-enqueue had
    // already booked the identity move.
    __setBlockIdWritesForTests(true);
    const task = restingLegacyTask();
    useMountedSightHook({
      tasks: [task], prevSnap: { [LEGACY_ID]: snapFor(task) },
      config: { dailyNotesPath: 'Daily', dailyNotePattern: 'dd.MM.yyyy' },
    });
    runWritebackEffect();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    expect(emitBridgeIntent.mock.calls[0][1].path).toBe('Daily/30.08.2026.md'); // DATE = 2026-08-30
  });

  it('first import: the cycle merges the new untagged task, nudges ONE writeback pass after the in-progress guard drops, and that pass stamps it', async () => {
    __setBlockIdWritesForTests(true);
    heartbeatMock.mockResolvedValue(pairedHeartbeat());
    const h1 = useMountedSightHook({ tasks: [] });
    fetchMock.mockResolvedValue({
      observations: [{ path: `${DATE}.md`, content: NOTE, mtime: MTIME }],
      maxSeq: 7,
    });
    await h1.api.performObsidianSync();

    // Imported under its content-derived id (identity assignment is a WRITE,
    // never invented by the parse), and the nudge fired a setTasks poke
    // AFTER the guard dropped.
    expect(allIds(h1.state)).toEqual([LEGACY_ID]);
    expect(setTasksCalls.some(c => c.duringSync === false)).toBe(true);
    // The observation seeded the snapshot, so the nudged pass has its p.
    expect(h1.prevRef.current[LEGACY_ID]).toBeDefined();

    // The nudged pass (React re-renders on the poke; here we re-mount on the
    // updated state, as the harness family does) emits the stamp.
    const h2 = useMountedSightHook({
      tasks: h1.state.tasks, inbox: h1.state.inbox,
      prevSnap: h1.prevRef.current, freshStore: false,
    });
    runWritebackEffect();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    expect(emitBridgeIntent.mock.calls[0][1].blockId).toBe(BLOCK);
    expect(allIds(h2.state)).toEqual([DG_ID]);
  });
});

describe('mid-cycle writeback re-poke (audit fix M1)', () => {
  it('a task change landing DURING a sync cycle is flushed by the cycle\'s finally — not stranded until the next unrelated task change', async () => {
    // The audit finding: the writeback effect early-returns while a cycle
    // runs (cycles last >=2s and fire on the visibility flip that coincides
    // with the user returning to click a task), and nothing re-ran it
    // afterward — the change waited, unwritten, for the NEXT task change.
    // Now the skipped pass leaves a marker and the finally pokes one pass.
    __setBlockIdWritesForTests(true);
    heartbeatMock.mockResolvedValue(pairedHeartbeat());
    // An already-tagged task: NOTHING stampable, so the stamp nudge cannot
    // be what fires the poke — only the M1 marker can.
    const tagged = restingLegacyTask({ id: DG_ID, obsidianBlockId: BLOCK });
    const h = useMountedSightHook({ tasks: [tagged], prevSnap: { [DG_ID]: snapFor(tagged) } });
    fetchMock.mockImplementation(async () => {
      // Mid-cycle: the user completes a task -> React fires the writeback
      // effect -> the in-progress guard skips it (and, post-fix, marks the
      // skip). Simulated by running the effect while the guard is up.
      expect(h.syncRef.current).toBe(true);
      runWritebackEffect();
      return null;
    });
    setTasksCalls.length = 0;
    await h.api.performObsidianSync();
    // The finally poked one identity-only pass after the guard dropped.
    expect(setTasksCalls.some(c => c.duringSync === false)).toBe(true);

    // CONTRAST — no mid-cycle writeback, nothing stampable: no poke, so the
    // re-poke cannot loop on quiet cycles.
    fetchMock.mockReset(); fetchMock.mockResolvedValue(null);
    setTasksCalls.length = 0;
    await h.api.performObsidianSync();
    expect(setTasksCalls.some(c => c.duringSync === false)).toBe(false);
  });
});

describe('note-scoped deletion inference (fix 1): observed notes are complete at their own grain', () => {
  const observationOf = (content, mtime = MTIME) => ({
    observations: [{ path: `${DATE}.md`, content, mtime }],
    maxSeq: 9,
  });
  const emptyFetch = () => ({ observations: [], maxSeq: 0 });
  // The wall-clock confirmation hold (≥90s) means "the next fetch" only
  // commits when it also lands past the hold — tests advance Date.now for
  // the confirming cycle.
  const REAL_NOW = Date.now();

  it('the founding orphan: a rename-in-Obsidian leaves the old untagged task; one observed cycle pends it, the next confirms — tombstoned at the note mtime, one task remains', async () => {
    __setBlockIdWritesForTests(false); // isolate fix 1 from the stamp
    heartbeatMock.mockResolvedValue(pairedHeartbeat());
    const oldTask = restingLegacyTask({ id: OLD_ID, obsidianRawTitle: OLD_RAW, title: `${OLD_RAW} #obsidian` });
    const h = useMountedSightHook({ tasks: [oldTask], prevSnap: { [OLD_ID]: snapFor(oldTask) } });

    // Cycle 1: the note now carries only the RENAMED line — the old id is
    // absent from a complete parse of its home note → pended, NOT deleted.
    fetchMock.mockResolvedValue(observationOf(NOTE));
    await h.api.performObsidianSync();
    expect(allIds(h.state).sort()).toEqual([LEGACY_ID, OLD_ID].sort());
    expect(JSON.parse(store.get('day-planner-obsidian-pending-note-deletions')).entries).toHaveProperty(OLD_ID);
    expect(store.get('day-planner-deleted-obsidian-keys') ?? '{}').not.toContain(OLD_ID);

    // Cycle 2: a subsequent empty fetch is complete knowledge the id never
    // came back — but only PAST THE WALL-CLOCK HOLD (≥90s of real absence;
    // the 2026-08-31 lesson: at SSE speed "next fetch" alone arrives in ~2s,
    // faster than Obsidian Sync converges). Advance the clock, then commit
    // through deletedObsidianKeys, stamped at the note's mtime.
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(REAL_NOW + 91_000);
    try {
      heartbeatMock.mockResolvedValue(pairedHeartbeat()); // keep the heartbeat fresh under the advanced clock
      fetchMock.mockResolvedValue(emptyFetch());
      await h.api.performObsidianSync();
    } finally { nowSpy.mockRestore(); }
    expect(allIds(h.state)).toEqual([LEGACY_ID]);
    const tombs = JSON.parse(store.get('day-planner-deleted-obsidian-keys'));
    expect(tombs[OLD_ID]).toBe(MTIME_ISO);
    expect(JSON.parse(store.get('day-planner-obsidian-pending-note-deletions')).entries).toEqual({});
  });

  it('LWW protection: an app edit NEWER than the note beats the mtime-stamped tombstone and the task survives', async () => {
    __setBlockIdWritesForTests(false);
    heartbeatMock.mockResolvedValue(pairedHeartbeat());
    const edited = restingLegacyTask({
      id: OLD_ID, obsidianRawTitle: OLD_RAW, title: `${OLD_RAW} #obsidian`,
      lastModified: new Date(MTIME + 60_000).toISOString(),
    });
    const h = useMountedSightHook({ tasks: [edited], prevSnap: { [OLD_ID]: snapFor(edited) } });
    fetchMock.mockResolvedValue(observationOf(NOTE));
    await h.api.performObsidianSync();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(REAL_NOW + 91_000);
    try {
      heartbeatMock.mockResolvedValue(pairedHeartbeat());
      fetchMock.mockResolvedValue(emptyFetch());
      await h.api.performObsidianSync();
    } finally { nowSpy.mockRestore(); }
    // Tombstone recorded — and LOSES to the newer app edit, by the channel's
    // existing rule.
    expect(JSON.parse(store.get('day-planner-deleted-obsidian-keys'))[OLD_ID]).toBe(MTIME_ISO);
    expect(allIds(h.state)).toContain(OLD_ID);
  });

  it('rescue: a pended id that reappears in the next batch (cross-note move landing) is never tombstoned', async () => {
    __setBlockIdWritesForTests(false);
    heartbeatMock.mockResolvedValue(pairedHeartbeat());
    const oldTask = restingLegacyTask({ id: OLD_ID, obsidianRawTitle: OLD_RAW, title: `${OLD_RAW} #obsidian` });
    const h = useMountedSightHook({ tasks: [oldTask], prevSnap: { [OLD_ID]: snapFor(oldTask) } });
    fetchMock.mockResolvedValue(observationOf(NOTE)); // line missing
    await h.api.performObsidianSync();
    // Next batch: the line is back.
    fetchMock.mockResolvedValue(observationOf(`# Day\n\n## Tasks\n- [ ] ${OLD_RAW}\n`, MTIME + 5000));
    await h.api.performObsidianSync();
    expect(store.get('day-planner-deleted-obsidian-keys') ?? '{}').not.toContain(OLD_ID);
    // The rescued id left pending. (The RENAMED line's task, imported in
    // cycle 1 and gone again in cycle 2's note, pends in its place — a
    // genuine vanish, correctly held for its own confirmation.)
    expect(JSON.parse(store.get('day-planner-obsidian-pending-note-deletions')).entries).not.toHaveProperty(OLD_ID);
    expect(allIds(h.state)).toContain(OLD_ID);
  });

  it('a task whose home note was NEVER observed is untouched — the remaining availability gap, held deliberately', async () => {
    __setBlockIdWritesForTests(false);
    heartbeatMock.mockResolvedValue(pairedHeartbeat());
    const other = restingLegacyTask({
      id: legacyObsidianId('2026-08-29', OLD_RAW), obsidianRawTitle: OLD_RAW,
      title: `${OLD_RAW} #obsidian`, obsidianFileDate: '2026-08-29', date: '2026-08-29',
    });
    const h = useMountedSightHook({ tasks: [other], prevSnap: { [other.id]: snapFor(other) } });
    fetchMock.mockResolvedValue(observationOf(NOTE)); // only 2026-08-30 observed
    await h.api.performObsidianSync();
    fetchMock.mockResolvedValue({ observations: [], maxSeq: 0 });
    await h.api.performObsidianSync();
    expect(JSON.parse(store.get('day-planner-obsidian-pending-note-deletions') ?? '{}').entries ?? {}).toEqual({});
    expect(store.get('day-planner-deleted-obsidian-keys') ?? '{}').not.toContain(other.id);
    // Untouched — still present alongside whatever the observed note imported.
    expect(allIds(h.state)).toContain(other.id);
  });

  it('tagged-line deletion is caught too: a ^dg- task vanishing from its observed note tombstones through the same hold', async () => {
    __setBlockIdWritesForTests(false);
    heartbeatMock.mockResolvedValue(pairedHeartbeat());
    const tagged = restingLegacyTask({ id: DG_ID, obsidianBlockId: BLOCK });
    const h = useMountedSightHook({ tasks: [tagged], prevSnap: { [DG_ID]: snapFor(tagged) } });
    fetchMock.mockResolvedValue(observationOf('# Day\n\n## Tasks\n')); // line deleted in the vault
    await h.api.performObsidianSync();
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(REAL_NOW + 91_000);
    try {
      heartbeatMock.mockResolvedValue(pairedHeartbeat());
      fetchMock.mockResolvedValue({ observations: [], maxSeq: 0 });
      await h.api.performObsidianSync();
    } finally { nowSpy.mockRestore(); }
    expect(JSON.parse(store.get('day-planner-deleted-obsidian-keys'))[DG_ID]).toBe(MTIME_ISO);
    expect(h.state.tasks).toEqual([]);
  });
});
