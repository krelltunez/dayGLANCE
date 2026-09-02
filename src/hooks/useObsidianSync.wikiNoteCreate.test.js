import { describe, it, expect, vi, afterEach } from 'vitest';

// loadWikiNote's absence contract — the fix for the wikilink-creation dead
// end. The creation transport (saveWikiNote → wiki_note_write / writeWikiNote,
// creation frontmatter, newNotesFolder) has existed since Phase 6, but the
// linked-note panel could never reach it: loadWikiNote reported a MISSING note
// with the same null it uses for "vault unavailable / read failed", so the
// panel rendered a dead-end error instead of an editor. The contract now, on
// BOTH platforms:
//
//   { notFound: true }  — absence the vault actually reported: desktop FSA
//                         (readWikiNote returns null exactly on NotFound,
//                         throws otherwise) and native ("" on the wire — both
//                         bridges return it only after looking; a failed read
//                         is the distinct {"error":…} envelope instead). The
//                         panel turns this into an empty editor whose save
//                         creates the note.
//   null                — unproven absence, fail closed: no vault handle, a
//                         desktop read failure, or the native readFailed
//                         sentinel. A create editor over an unreadable
//                         EXISTING note would invite an overwrite.
//
// saveWikiNote's native branch shares the sentinel: a failed existence read
// REFUSES the write (visible sync error) instead of guessing an arm — the old
// collapsed null guessed CREATION, decorating and overwriting a note that
// exists but couldn't be read.
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
const nativeWriteNote = vi.fn();
vi.mock('../native.js', () => ({
  isNativeAndroid: () => false,
  isNativeApp: () => false,
  nativeGetVaultConfig: vi.fn(() => null),
  nativeGetNote: (...a) => nativeGetNote(...a),
  nativeWriteNote: (...a) => nativeWriteNote(...a),
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

const { default: useObsidianSync } = await import('./useObsidianSync.js');

// Calls the hook (effects captured, never run — loadWikiNote/saveWikiNote are
// plain callbacks) and returns its API plus the error-surfacing spies.
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
  const setObsidianSyncError = vi.fn();
  const setObsidianSyncStatus = vi.fn();
  const api = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: [], setTasks: vi.fn(),
    unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null,
    obsidianSyncError: null,
    setObsidianSyncStatus, setObsidianSyncError, setObsidianLastSynced: vi.fn(),
    setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: vaultHandle },
    obsidianSyncInProgressRef: { current: false },
    obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: { current: [] }, obsidianInboxRef: { current: [] },
  });
  return { ...api, setObsidianSyncError, setObsidianSyncStatus };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  readWikiNote.mockReset();
  nativeGetNote.mockReset();
  nativeWriteNote.mockReset();
  emitBridgeIntent.mockReset();
  emitBridgeIntent.mockReturnValue(true);
});

describe('loadWikiNote — reported absence is creatable', () => {
  it('THE FIX PIN (desktop): a missing note reports { notFound: true }, not the error null', async () => {
    readWikiNote.mockResolvedValue(null); // readWikiNote null = NotFound, by its own contract
    const { loadWikiNote } = useMountedSync({ kind: 'directory' });
    await expect(loadWikiNote('TV Series')).resolves.toEqual({ notFound: true });
    expect(readWikiNote).toHaveBeenCalledWith({ kind: 'directory' }, 'TV Series');
  });

  it('THE FIX PIN (native): reported absence (wrapper null, from "" on the wire) is { notFound: true }', async () => {
    nativeGetNote.mockReturnValue(null);
    const { loadWikiNote } = useMountedSync('native');
    await expect(loadWikiNote('TV Series')).resolves.toEqual({ notFound: true });
    expect(readWikiNote).not.toHaveBeenCalled();
  });

  it('an existing note passes through untouched (desktop and native)', async () => {
    const note = { text: 'watchlist', lastModified: '2026-08-31T10:00:00.000Z' };
    readWikiNote.mockResolvedValue(note);
    const desktop = useMountedSync({ kind: 'directory' });
    await expect(desktop.loadWikiNote('TV Series')).resolves.toBe(note);
    nativeGetNote.mockReturnValue(note);
    const native = useMountedSync('native');
    await expect(native.loadWikiNote('TV Series')).resolves.toBe(note);
  });

  it('the [[Note#Heading]] fragment is stripped before the read, so absence is judged on the FILE', async () => {
    readWikiNote.mockResolvedValue(null);
    const { loadWikiNote } = useMountedSync({ kind: 'directory' });
    await expect(loadWikiNote('TV Series#Watchlist')).resolves.toEqual({ notFound: true });
    expect(readWikiNote).toHaveBeenCalledWith({ kind: 'directory' }, 'TV Series');
  });
});

describe('loadWikiNote — unproven absence stays the error null (fail closed)', () => {
  it('a desktop READ FAILURE (readWikiNote throws) is null, never notFound — an unreadable note must not offer a create editor', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    readWikiNote.mockRejectedValue(new Error('permission revoked'));
    const { loadWikiNote } = useMountedSync({ kind: 'directory' });
    await expect(loadWikiNote('TV Series')).resolves.toBe(null);
    expect(errSpy).toHaveBeenCalled();
  });

  it('the native readFailed sentinel is null, never notFound — same rule, native wire', async () => {
    nativeGetNote.mockReturnValue({ readFailed: true });
    const { loadWikiNote } = useMountedSync('native');
    await expect(loadWikiNote('TV Series')).resolves.toBe(null);
  });

  it('no vault handle is null — nothing to create into', async () => {
    const { loadWikiNote } = useMountedSync(null);
    await expect(loadWikiNote('TV Series')).resolves.toBe(null);
    expect(readWikiNote).not.toHaveBeenCalled();
  });
});

describe('saveWikiNote (native) — the existence read decides the arm, so a FAILED read refuses the write', () => {
  it('readFailed → no write, visible sync error (the old collapsed null picked the CREATION arm and overwrote)', async () => {
    nativeGetNote.mockReturnValue({ readFailed: true });
    const { saveWikiNote, setObsidianSyncError, setObsidianSyncStatus } = useMountedSync('native');
    await saveWikiNote('TV Series', 'typed content');
    expect(nativeWriteNote).not.toHaveBeenCalled();
    expect(setObsidianSyncError).toHaveBeenCalledWith(expect.stringContaining('could not be read'));
    expect(setObsidianSyncStatus).toHaveBeenCalledWith('error');
  });

  it('reported absence → CREATION arm: validated name, creation frontmatter, write goes through', async () => {
    nativeGetNote.mockReturnValue(null);
    nativeWriteNote.mockReturnValue(true);
    const { saveWikiNote, setObsidianSyncError } = useMountedSync('native');
    await saveWikiNote('TV Series', 'typed content');
    expect(nativeWriteNote).toHaveBeenCalledTimes(1);
    const [path, content] = nativeWriteNote.mock.calls[0];
    expect(path).toBe('TV Series');
    expect(content.startsWith('---\n')).toBe(true); // creation frontmatter
    expect(content).toContain('typed content');
    expect(setObsidianSyncError).not.toHaveBeenCalled();
  });

  it('existing note → OVERWRITE arm: content as-is, never re-decorated', async () => {
    nativeGetNote.mockReturnValue({ text: 'old body', lastModified: 'x' });
    nativeWriteNote.mockReturnValue(true);
    const { saveWikiNote } = useMountedSync('native');
    await saveWikiNote('TV Series', 'edited body');
    expect(nativeWriteNote).toHaveBeenCalledWith('TV Series', 'edited body');
  });
});
