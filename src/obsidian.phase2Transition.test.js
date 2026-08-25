import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2 cross-device transition (legacy content-derived id → ^dg- block id).
//
// The single-device path is covered by obsidian.blockIds.test.js. These tests
// cover the MULTI-DEVICE transition — the territory of the resurrection and
// duplication bugs from PRs #1146–#1148 — by driving the REAL sync pipeline:
// the actual useObsidianSync.performObsidianSync (captured-hook pattern from
// useObsidianSync.retry.test.js) over the real obsidian.js, merge utils, and
// deletion detector, against an in-memory vault and per-device localStorage.
// Each simulated device runs the same code a real device runs; "Obsidian Sync"
// is modeled as devices scanning the same (or a stale copy of the) vault, and
// cloud row/tombstone exchange is modeled at the documented seams.
//
// One block below pins a FINDING — file-tier union resurrection of the
// transitioned-away legacy row — reported for a decision, NOT fixed here.
// Those tests assert CURRENT (wrong) behavior on purpose; do not "fix" the
// tests without the accompanying behavior decision.
// ═══════════════════════════════════════════════════════════════════════════

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));
vi.mock('./native.js', () => ({
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

const { default: useObsidianSync } = await import('./hooks/useObsidianSync.js');
const { legacyObsidianId, appIdForBlockId, parseTasksFromMarkdown } = await import('./obsidian.js');
const { mergeObsidianTasks } = await import('./utils/mergeObsidianTasks.js');
const { addObsidianTombstones } = await import('./utils/obsidianDeletions.js');
const { mergeTaskArrays } = await import('./mergeSync.js');

// ── In-memory FSA vault (same shape as obsidian.blockIds.test.js) ───────────
function nfe() {
  const e = new Error('A requested file or directory could not be found.');
  e.name = 'NotFoundError';
  return e;
}
function makeFile(parent, name) {
  return {
    kind: 'file',
    name,
    async getFile() { return { text: async () => parent[name], lastModified: 1 }; },
    async createWritable() {
      let buf = '';
      return { write: async (c) => { buf += c; }, close: async () => { parent[name] = buf; } };
    },
  };
}
function makeDir(node, name = '') {
  return {
    kind: 'directory',
    name,
    async getFileHandle(n, opts) {
      if (typeof node[n] === 'string') return makeFile(node, n);
      if (opts?.create) { node[n] = ''; return makeFile(node, n); }
      throw nfe();
    },
    async getDirectoryHandle(n, opts) {
      if (node[n] && typeof node[n] === 'object') return makeDir(node[n], n);
      if (opts?.create) { node[n] = {}; return makeDir(node[n], n); }
      throw nfe();
    },
    async *entries() {
      for (const [n, v] of Object.entries(node)) {
        yield [n, typeof v === 'string' ? makeFile(node, n) : makeDir(v, n)];
      }
    },
    [Symbol.asyncIterator]() { return this.entries(); },
  };
}

// ── Per-device state + localStorage ─────────────────────────────────────────
function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    _dump: () => Object.fromEntries(map),
  };
}
function makeDevice({ tasks = [], inbox = [], storage = {} } = {}) {
  return { tasks, inbox, dailyNotes: {}, storage: makeStorage(storage) };
}
const json = (v) => JSON.stringify(v);
const readJson = (device, key, fallback) => JSON.parse(device.storage.getItem(key) ?? json(fallback));
const tombstonesOf = (d) => readJson(d, 'day-planner-deleted-obsidian-keys', {});
const lastScannedOf = (d) => readJson(d, 'day-planner-obsidian-last-scanned', []);
const sidecarOf = (d) => readJson(d, 'day-planner-obsidian-last-scanned-dates', {});

// Run one REAL vault sync for [device] against [vaultFs]. This is the exact
// per-device pipeline useObsidianSync wires: syncObsidianVault → deletion
// detection (with the legacy-id hints and the keyDates sidecar) →
// mergeObsidianDailyNotes / mergeObsidianTasks → snapshot rebuild.
async function runVaultSync(device, vaultFs) {
  globalThis.localStorage = device.storage;
  effects.length = 0;
  const bind = (key) => (v) => { device[key] = typeof v === 'function' ? v(device[key]) : v; };
  const noop = () => {};
  const { performObsidianSync } = useObsidianSync({
    isTrayMode: false,
    dataLoaded: true,
    tasks: device.tasks, setTasks: bind('tasks'),
    unscheduledTasks: device.inbox, setUnscheduledTasks: bind('inbox'),
    setDailyNotes: bind('dailyNotes'),
    setWikilinkCandidates: noop,
    setUnportableVaultFiles: noop,
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd', taskHeading: '## Tasks' },
    setObsidianConfig: noop,
    obsidianLaunchOnWrite: null,
    setObsidianSyncStatus: noop, setObsidianSyncError: noop, setObsidianLastSynced: noop,
    obsidianVaultHandleRef: { current: makeDir(vaultFs) },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: { current: device.tasks },
    obsidianInboxRef: { current: device.inbox },
  });
  const p = performObsidianSync();
  // performObsidianSync pads the visible "syncing" state to 2s; skip the wait.
  await vi.advanceTimersByTimeAsync(2500);
  await p;
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Local "today" so the daily note is always inside the 90-day scan window.
const now = new Date();
const TODAY = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const NOTE = `${TODAY}.md`;
const TITLE = 'Pay invoices';
const LEGACY_ID = legacyObsidianId(TODAY, TITLE);
const DG_ID = appIdForBlockId('aaaaaaaa');
const legacyRow = (extra = {}) => ({
  id: LEGACY_ID, importSource: 'obsidian',
  obsidianRawTitle: TITLE, obsidianFileDate: TODAY,
  title: `${TITLE} #obsidian`, completed: false,
  notes: 'call accounting first', color: 'bg-red-500', duration: 45,
  projectId: 'proj-1', deadline: '2099-01-01',
  lastModified: '2026-08-20T10:00:00.000Z',
  ...extra,
});

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); delete globalThis.localStorage; });

// ═══ (a) A stamped; warm B still holds the legacy-keyed row ═════════════════
describe('transition (a): warm device with the legacy row scans the freshly-tagged vault', () => {
  it('converges to ONE dg task; app-only fields survive; the legacy id is NOT tombstoned', async () => {
    const vault = { [NOTE]: `## Tasks\n- [ ] ${TITLE} ^dg-aaaaaaaa` };
    const b = makeDevice({
      inbox: [legacyRow()],
      storage: {
        'day-planner-obsidian-last-scanned': json([TODAY, LEGACY_ID]),
        'day-planner-obsidian-last-scanned-dates': json({}),
      },
    });
    await runVaultSync(b, vault);

    const obsidian = [...b.tasks, ...b.inbox].filter(t => t.importSource === 'obsidian');
    expect(obsidian).toHaveLength(1);
    const t = obsidian[0];
    expect(t.id).toBe(DG_ID);
    // Fields preserved across the id switch — both layers: the sync merge
    // (notes/color/duration) and preserveObsidianAppFields (projectId/deadline).
    expect(t.notes).toBe('call accounting first');
    expect(t.color).toBe('bg-red-500');
    expect(t.duration).toBe(45);
    expect(t.projectId).toBe('proj-1');
    expect(t.deadline).toBe('2099-01-01');
    // A rename is not a deletion: the legacy id must NOT be tombstoned…
    expect(tombstonesOf(b)).toEqual({});
    // …because the scanned-keys assembly accounts for it via the hint,
    // and the sidecar dates the new dg key for future deletion detection.
    expect(lastScannedOf(b)).toEqual(expect.arrayContaining([TODAY, DG_ID, LEGACY_ID]));
    expect(sidecarOf(b)[DG_ID]).toBe(TODAY);
  });

  it("cloud delivered A's dg row before B scanned: still exactly one task, no tombstone", async () => {
    const vault = { [NOTE]: `## Tasks\n- [ ] ${TITLE} ^dg-aaaaaaaa` };
    const cloudDgRow = legacyRow({ id: DG_ID, obsidianBlockId: 'aaaaaaaa', notes: "A's notes" });
    const b = makeDevice({
      inbox: [legacyRow(), cloudDgRow],
      storage: { 'day-planner-obsidian-last-scanned': json([TODAY, LEGACY_ID]) },
    });
    await runVaultSync(b, vault);

    const obsidian = [...b.tasks, ...b.inbox].filter(t => t.importSource === 'obsidian');
    expect(obsidian).toHaveLength(1);
    expect(obsidian[0].id).toBe(DG_ID);
    // Direct id match takes precedence over the legacy bridge.
    expect(obsidian[0].notes).toBe("A's notes");
    expect(tombstonesOf(b)).toEqual({});
  });
});

// ═══ (b) The offline-for-a-week variant ═════════════════════════════════════
describe('transition (b): device offline for a week comes back to a tagged vault', () => {
  it('a stale lastScanned with aged-out entries neither false-tombstones nor ghosts', async () => {
    const vault = { [NOTE]: `## Tasks\n- [ ] ${TITLE} ^dg-aaaaaaaa` };
    // The stale baseline also remembers a note+task that aged out of the
    // 90-day window while B was away — window exclusion must eat those, and
    // the transitioned task must bridge exactly as in the warm case.
    const OLD = '2020-01-01';
    const b = makeDevice({
      inbox: [legacyRow()],
      storage: {
        'day-planner-obsidian-last-scanned': json([TODAY, LEGACY_ID, OLD, `obsidian-${OLD}-zzz`]),
      },
    });
    await runVaultSync(b, vault);

    const obsidian = [...b.tasks, ...b.inbox].filter(t => t.importSource === 'obsidian');
    expect(obsidian).toHaveLength(1);
    expect(obsidian[0].id).toBe(DG_ID);
    expect(obsidian[0].projectId).toBe('proj-1');
    expect(tombstonesOf(b)).toEqual({}); // no aged-out false deletions, no legacy tombstone
  });

  // FINDING (b2), reported for decision — see the PR discussion: if the task's
  // daily note ages PAST the 90-day window before the offline device ever
  // scans again, that device retains the legacy-keyed row (correct detector
  // conservatism) while stamped devices hold the dg-keyed row, and no scan can
  // ever reconcile them — the union-style file-tier merge then carries BOTH
  // rows fleet-wide. Not testable as correct behavior until the decision.
  it.todo('(b2) note ages out of the window before the offline device rescans — permanent id split (reported)');
});

// ═══ (c) Both devices stamp the same task independently ═════════════════════
describe('transition (c): independent double-stamp before Obsidian Sync propagates', () => {
  it('distinct ids are guaranteed (crypto-random)— see obsidian.blockIds.test.js; two tagged twins parse as two tasks', () => {
    // If Obsidian Sync's file merge keeps BOTH stamped lines, they are two
    // distinct tasks by design (same rule as a user copy-pasting a line and
    // editing the id) — deterministic, identical on every device.
    const { inboxTasks } = parseTasksFromMarkdown(
      `- [ ] Race task ^dg-aaaaaaaa\n- [ ] Race task ^dg-bbbbbbbb`, TODAY,
    );
    expect(inboxTasks.map(t => t.id)).toEqual([appIdForBlockId('aaaaaaaa'), appIdForBlockId('bbbbbbbb')]);
  });

  it("one line survives the file merge: the loser's device converges to the winner's id via the sidecar", async () => {
    // B stamped ^dg-bbbbbbbb on its copy; Obsidian Sync resolved the file to
    // A's ^dg-aaaaaaaa. B's dg-B row must not ghost: its key is dateless, so
    // WITHOUT the sidecar it could never be tombstoned and would be retained
    // forever. With the sidecar it is tombstoned and dropped in one scan.
    const vault = { [NOTE]: `## Tasks\n- [ ] Race task ^dg-aaaaaaaa` };
    const DG_B = appIdForBlockId('bbbbbbbb');
    const raceLegacy = legacyObsidianId(TODAY, 'Race task');
    const b = makeDevice({
      inbox: [{
        id: DG_B, importSource: 'obsidian', obsidianBlockId: 'bbbbbbbb',
        obsidianRawTitle: 'Race task', obsidianFileDate: TODAY,
        title: 'Race task #obsidian', completed: false, notes: 'b-side notes',
        lastModified: '2026-08-20T10:00:00.000Z',
      }],
      storage: {
        'day-planner-obsidian-last-scanned': json([TODAY, DG_B, raceLegacy]),
        'day-planner-obsidian-last-scanned-dates': json({ [DG_B]: TODAY }),
      },
    });
    await runVaultSync(b, vault);

    const obsidian = [...b.tasks, ...b.inbox].filter(t => t.importSource === 'obsidian');
    expect(obsidian).toHaveLength(1);
    expect(obsidian[0].id).toBe(appIdForBlockId('aaaaaaaa'));
    // dg-B is tombstoned (sidecar-dated) so it can't ghost back via retention…
    expect(tombstonesOf(b)[DG_B]).toBeTruthy();
    // …at the cost of B's app-side fields on the losing row (fresh import);
    // the winner's fields arrive via cloud from A. Current, accepted behavior.
    expect(obsidian[0].notes).toBe('');
  });
});

// ═══ (d) A stamps; B deletes the (legacy-keyed) task in the app ═════════════
describe('transition (d): app-side delete crossed with a stamp', () => {
  it('the legacy-keyed app tombstone does not match the dg row, and the vault line re-imports (existence is vault-owned — pre-existing semantics)', async () => {
    // B deleted the task in dayGLANCE (row removed; deletedTaskIds[LEGACY_ID]
    // recorded). The vault line — now stamped by A — remains, and the vault
    // owns task EXISTENCE: the next scan re-imports it. That resurrection
    // predates Phase 2 (an untagged line re-imports identically); the id
    // change only means the app tombstone can no longer graze the new row.
    const vault = { [NOTE]: `## Tasks\n- [ ] ${TITLE} ^dg-aaaaaaaa` };
    const b = makeDevice({
      inbox: [],
      storage: { 'day-planner-obsidian-last-scanned': json([TODAY, LEGACY_ID]) },
    });
    await runVaultSync(b, vault);

    const obsidian = [...b.tasks, ...b.inbox].filter(t => t.importSource === 'obsidian');
    expect(obsidian).toHaveLength(1);
    expect(obsidian[0].id).toBe(DG_ID);

    // And at the file-tier merge, the legacy-keyed deletedTaskIds tombstone
    // leaves the dg row untouched (different key — no accidental kill).
    const { merged } = mergeTaskArrays(obsidian, [], { [LEGACY_ID]: new Date().toISOString() });
    expect(merged.map(t => t.id)).toEqual([DG_ID]);
  });
});

// ═══ (d2/e) Vault-line deletion crossed with the transition ═════════════════
describe('transition (d2/e): the stamped line is deleted from the vault', () => {
  it('a warm stamped device tombstones BOTH the dg id (via the sidecar) and the legacy hint', async () => {
    const a = makeDevice({
      inbox: [legacyRow({ id: DG_ID, obsidianBlockId: 'aaaaaaaa' })],
      storage: {
        'day-planner-obsidian-last-scanned': json([TODAY, DG_ID, LEGACY_ID]),
        'day-planner-obsidian-last-scanned-dates': json({ [DG_ID]: TODAY }),
      },
    });
    // The daily note still exists but the task line is gone.
    await runVaultSync(a, { [NOTE]: `## Tasks\n- [ ] some other task` });

    expect([...a.tasks, ...a.inbox].filter(t => t.id === DG_ID)).toHaveLength(0);
    const tombs = tombstonesOf(a);
    // Both keys tombstoned: dg for devices already transitioned, the legacy
    // hint for devices that never saw the stamp (offline since before it).
    expect(tombs[DG_ID]).toBeTruthy();
    expect(tombs[LEGACY_ID]).toBeTruthy();
  });

  it('(e) a fresh device is conservative — it tombstones nothing and converges via the warm device\'s synced tombstones', async () => {
    // Fresh B: no lastScanned, no sidecar; holds the dg row from cloud.
    const cloudRow = legacyRow({ id: DG_ID, obsidianBlockId: 'aaaaaaaa' });
    const b = makeDevice({ inbox: [cloudRow] });
    await runVaultSync(b, { [NOTE]: `## Tasks\n- [ ] some other task` });

    // Conservative: B invents no deletions (empty baseline ⇒ nothing missing)…
    expect(tombstonesOf(b)).toEqual({});
    // …and RETAINS the cloud row for now (it might belong to another vault).
    expect(b.inbox.map(t => t.id)).toContain(DG_ID);

    // A's tombstones arrive via sync (deletedObsidianKeys is a synced bundle):
    const deletedAt = new Date(Date.now() + 60_000).toISOString();
    const merged = addObsidianTombstones(tombstonesOf(b), [DG_ID, LEGACY_ID], deletedAt);
    // The next merge honors them: the dg row is dropped — and so would a
    // legacy-keyed row be on a device offline since before the stamp.
    const preserve = (old) => ({ ...(old.archived !== undefined ? { archived: old.archived } : {}) });
    // (b.inbox also holds the unrelated "some other task" import — assert on
    // the transitioned task's ids, not on every obsidian row.)
    const afterTasks = mergeObsidianTasks(b.inbox, [], new Set(), preserve, merged);
    expect(afterTasks.filter(t => t.id === DG_ID || t.id === LEGACY_ID)).toHaveLength(0);
    const offlineC = mergeObsidianTasks([legacyRow()], [], new Set(), preserve, merged);
    expect(offlineC.filter(t => t.id === DG_ID || t.id === LEGACY_ID)).toHaveLength(0);
  });
});

// ═══ FINDING PINS — reported wrong behavior, NOT fixed in this pass ═════════
// The transitioned-away legacy row is removed from the stamping device's
// arrays with NO tombstone in ANY channel (the hint deliberately suppresses
// the deletion detector so a rename isn't treated as a deletion). But the
// file-tier task merge (@glance-apps/sync mergeArrayById via mergeTaskArrays)
// is a UNION consulting only deletedTaskIds: a row absent locally but present
// in the remote file is resurrected into the merged set. Consequences:
// vault devices oscillate (legacy row reappears on every pull, dropped by the
// next scan); vaultless file-tier devices keep it PERMANENTLY; the row is
// immortal in the remote file. The same union also ignores deletedObsidianKeys
// entirely — a PRE-EXISTING gap that today's rename churn and vault deletions
// also fall into; the transition widens exposure to every task, once.
// These tests PIN the current behavior so the failure is visible; the fix
// direction is a decision for the PR review, not this pass.
describe('FINDING: file-tier union resurrects the transitioned-away legacy row', () => {
  const dgRow = legacyRow({ id: DG_ID, obsidianBlockId: 'aaaaaaaa' });

  it('with no tombstone in any channel, the remote copy of the legacy row unions back', () => {
    const { merged } = mergeTaskArrays(
      [dgRow],              // local: device already transitioned
      [legacyRow(), dgRow], // remote file: still carries the legacy row
      {},                   // deletedTaskIds: nothing — the transition writes none
    );
    expect(merged.map(t => t.id).sort()).toEqual([DG_ID, LEGACY_ID].sort()); // ← the duplicate
  });

  it('a deletedObsidianKeys tombstone would not help either — the file-tier merge never sees that map', () => {
    // The call sites pass only deletedTaskIds (mergeSync.js allDeletedIds);
    // deletedObsidianKeys is honored solely by the vault-scan merge and the
    // rescue gate. Passing the obsidian map through the parameter that IS
    // consulted removes the row — proving it is a channel gap, not an LWW gap.
    const obsidianTombs = { [LEGACY_ID]: new Date(Date.now() + 60_000).toISOString() };
    const { merged } = mergeTaskArrays([dgRow], [legacyRow(), dgRow], obsidianTombs);
    expect(merged.map(t => t.id)).toEqual([DG_ID]);
  });
});
