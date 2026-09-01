import { describe, it, expect, vi, afterEach } from 'vitest';

// loadWikiNote's absence contract — the fix for the wikilink-creation dead
// end. The creation transport (saveWikiNote → wiki_note_write / writeWikiNote,
// creation frontmatter, newNotesFolder) has existed since Phase 6, but the
// linked-note panel could never reach it: loadWikiNote reported a MISSING note
// with the same null it uses for "vault unavailable / read failed", so the
// panel rendered a dead-end error instead of an editor. The contract now:
//
//   { notFound: true }  — PROVEN absence (desktop FSA only: readWikiNote
//                         returns null exactly on NotFound, throws otherwise).
//                         The panel turns this into an empty editor whose
//                         save creates the note.
//   null                — vault unavailable, read failure, or NATIVE absence.
//                         Native stays null on purpose: nativeGetNote
//                         collapses "no such note" and "read failed" into one
//                         null (read contract), so absence is never proven
//                         there, and a create editor over an unreadable
//                         existing note would invite an overwrite.
//
// Capture-harness pattern (the titleConflict/renameWar shape).

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const readWikiNote = vi.fn();
vi.mock('../obsidian.js', () => ({
  tryRestoreVaultAccess: vi.fn(async () => null),
  getVaultAccess: vi.fn(async () => null),
  syncObsidianVault: vi.fn(async () => null),
  syncObsidianVaultNative: vi.fn(async () => null),
  writeTaskStateToFile: vi.fn(async () => false),
  writeTaskStateNative: vi.fn(() => false),
  simpleHash: vi.fn(() => 'h'),
  deriveBlockId: vi.fn(() => 'testblok0'),
  appIdForBlockId: vi.fn((b) => `obsidian-dg-${b}`),
  readWikiNote: (...a) => readWikiNote(...a),
  writeWikiNote: vi.fn(async () => {}),
  scanVaultNotes: vi.fn(async () => ({ names: [], unportable: [] })),
  OBSIDIAN_IMPORT_WINDOW_DAYS: 90,
  dailyNoteFilename: (dateStr) => `${dateStr}.md`,
  obsidianWindowCutoffDate: vi.fn(() => null),
}));
const nativeGetNote = vi.fn();
vi.mock('../native.js', () => ({
  isNativeAndroid: () => false,
  isNativeApp: () => false,
  nativeGetVaultConfig: vi.fn(() => null),
  nativeGetNote: (...a) => nativeGetNote(...a),
  nativeWriteNote: vi.fn(),
  nativeOpenNote: vi.fn(),
  nativeListNotes: vi.fn(() => []),
  nativeSetVaultSettings: vi.fn(),
  nativeSetLaunchOnWrite: vi.fn(),
}));

const { default: useObsidianSync } = await import('./useObsidianSync.js');

// Calls the hook (effects captured, never run — loadWikiNote is a plain
// callback) and returns its API.
function useMountedSync(vaultHandle) {
  effects.length = 0;
  vi.stubGlobal('setTimeout', () => 1);
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
  return useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: [], setTasks: vi.fn(),
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null,
    obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError: vi.fn(), setObsidianLastSynced: vi.fn(),
    setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: vaultHandle },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: { current: [] }, obsidianInboxRef: { current: [] },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  readWikiNote.mockReset();
  nativeGetNote.mockReset();
});

describe('loadWikiNote — proven absence is creatable (desktop FSA)', () => {
  it('THE FIX PIN: a missing note reports { notFound: true }, not the error null', async () => {
    readWikiNote.mockResolvedValue(null); // readWikiNote null = NotFound, by its own contract
    const { loadWikiNote } = useMountedSync({ kind: 'directory' });
    await expect(loadWikiNote('TV Series')).resolves.toEqual({ notFound: true });
    expect(readWikiNote).toHaveBeenCalledWith({ kind: 'directory' }, 'TV Series');
  });

  it('an existing note passes through untouched', async () => {
    const note = { text: 'watchlist', lastModified: '2026-08-31T10:00:00.000Z' };
    readWikiNote.mockResolvedValue(note);
    const { loadWikiNote } = useMountedSync({ kind: 'directory' });
    await expect(loadWikiNote('TV Series')).resolves.toBe(note);
  });

  it('the [[Note#Heading]] fragment is stripped before the read, so absence is judged on the FILE', async () => {
    readWikiNote.mockResolvedValue(null);
    const { loadWikiNote } = useMountedSync({ kind: 'directory' });
    await expect(loadWikiNote('TV Series#Watchlist')).resolves.toEqual({ notFound: true });
    expect(readWikiNote).toHaveBeenCalledWith({ kind: 'directory' }, 'TV Series');
  });
});

describe('loadWikiNote — unproven absence stays the error null (fail closed)', () => {
  it('a READ FAILURE (readWikiNote throws) is null, never notFound — an unreadable note must not offer a create editor', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    readWikiNote.mockRejectedValue(new Error('permission revoked'));
    const { loadWikiNote } = useMountedSync({ kind: 'directory' });
    await expect(loadWikiNote('TV Series')).resolves.toBe(null);
    expect(errSpy).toHaveBeenCalled();
  });

  it('no vault handle is null — nothing to create into', async () => {
    const { loadWikiNote } = useMountedSync(null);
    await expect(loadWikiNote('TV Series')).resolves.toBe(null);
    expect(readWikiNote).not.toHaveBeenCalled();
  });

  it('NATIVE absence stays null: nativeGetNote cannot distinguish missing from read-failed, so absence is never proven there', async () => {
    nativeGetNote.mockReturnValue(null);
    const { loadWikiNote } = useMountedSync('native');
    await expect(loadWikiNote('TV Series')).resolves.toBe(null);
    expect(readWikiNote).not.toHaveBeenCalled();
  });

  it('a native EXISTING note still passes through (control)', async () => {
    const note = { text: 'body', lastModified: '2026-08-31T10:00:00.000Z' };
    nativeGetNote.mockReturnValue(note);
    const { loadWikiNote } = useMountedSync('native');
    await expect(loadWikiNote('TV Series')).resolves.toBe(note);
  });
});
