import { describe, it, expect, vi, afterEach } from 'vitest';

// A TASK'S LINKED NOTE from the plugin's report (#2291 follow-up: task
// notes). The hook's half: loadTaskNote finds the note by name (folder, or
// the report the name resolves to), says why when it cannot, and keeps the
// 'plugin' posture's folder-only answer; saveTaskNote refuses on change by
// the same newest-source rule and sends a note shown from a report as the
// wiki_note_write intent under the reported path and the shown text's base.
// Capture-harness pattern (useObsidianSync.noteDescription.test.js).

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));

const readWikiNote = vi.fn();
const writeWikiNote = vi.fn(async () => {});
vi.mock('../obsidian.js', () => ({
  tryRestoreVaultAccess: vi.fn(async () => null),
  probeVaultAccess: vi.fn(async () => 'ok'),
  getVaultAccess: vi.fn(async () => null),
  syncObsidianVault: vi.fn(async () => null),
  syncObsidianVaultNative: vi.fn(async () => null),
  writeTaskStateToFile: vi.fn(async () => false),
  writeTaskStateNative: vi.fn(() => false),
  simpleHash: vi.fn(() => 'h'),
  deriveBlockId: vi.fn(() => 'testblok0'),
  appIdForBlockId: vi.fn((b) => `obsidian-dg-${b}`),
  readWikiNote: (...a) => readWikiNote(...a),
  writeWikiNote: (...a) => writeWikiNote(...a),
  scanVaultNotes: vi.fn(async () => ({ names: [], unportable: [] })),
  OBSIDIAN_IMPORT_WINDOW_DAYS: 90,
  dailyNoteFilename: (dateStr) => `${dateStr}.md`,
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
const emitBridgeIntent = vi.fn(() => true);
vi.mock('../utils/obsidianBridgeStream.js', () => ({
  cachedBridgePairingMeta: () => null,
  emitBridgeIntent: (...a) => emitBridgeIntent(...a),
  flushBridgeOutbox: vi.fn(async () => true),
  publishBridgeConfig: vi.fn(async () => {}),
  getBridgePairingMeta: vi.fn(async () => null),
}));

// The reports: a map path → reading; a path not in it was never reported.
let reports = new Map();
let availability = { status: 'ready', scope: { folders: ['Projects'], tags: [] } };
const fetchReportedNote = vi.fn(async (path) => reports.get(path) ?? { status: 'never' });
const reportedNotesAvailability = vi.fn(async () => availability);
vi.mock('../utils/obsidianBridgeInbound.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchReportedNote: (...a) => fetchReportedNote(...a),
  reportedNotesAvailability: (...a) => reportedNotesAvailability(...a),
}));

const { default: useObsidianSync } = await import('./useObsidianSync.js');
const { noteTextHash } = await import('@glance-apps/obsidian-format');

function useMounted({ folder = true, posture = 'holding', tasks = [], projects = [], newNotesFolder = 'dayGLANCE' } = {}) {
  effects.length = 0;
  vi.stubGlobal('setTimeout', () => 1);
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('window', {});
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  const setObsidianSyncError = vi.fn();
  const api = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks, setTasks: vi.fn(), unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled: true, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd', newNotesFolder },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null, obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError, setObsidianLastSynced: vi.fn(), setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: folder ? { kind: 'directory' } : null },
    obsidianSyncInProgressRef: { current: false }, obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: { current: tasks }, obsidianInboxRef: { current: [] },
    projects, goals: [], updateProject: vi.fn(), updateGoal: vi.fn(),
  });
  // No folder: no cycle, so no posture recorded.
  if (folder) api.bridgeHeartbeatRef.current = { obsidianRunning: posture === 'plugin', pluginAuthoritative: posture !== 'direct', vaultPosture: posture };
  return { ...api, setObsidianSyncError };
}

const NOTE = '---\ncreated: 2026-11-01\n---\nCall the roofer.\n';
const reported = (path, text = NOTE, { mtime = '2026-11-05T10:00:00.000Z', observedAt = '2026-11-05T10:00:05.000Z' } = {}) => (
  { status: 'note', path, text, base: noteTextHash(text), lastModified: mtime, observedAt }
);
const asked = () => fetchReportedNote.mock.calls.map((c) => c[0]);

afterEach(() => {
  vi.unstubAllGlobals();
  readWikiNote.mockReset(); writeWikiNote.mockClear();
  emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true);
  fetchReportedNote.mockClear(); reportedNotesAvailability.mockClear();
  reports = new Map();
  availability = { status: 'ready', scope: { folders: ['Projects'], tags: [] } };
});

describe('loadTaskNote: no folder on this device', () => {
  it('a bare name found once among the notes it can name: the whole note from the report, with its path and times', async () => {
    reports.set('dayGLANCE/Gutter repair.md', reported('dayGLANCE/Gutter repair.md'));
    const { loadTaskNote } = useMounted({ folder: false });
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({
      text: NOTE, base: noteTextHash(NOTE), lastModified: '2026-11-05T10:00:00.000Z', observedAt: '2026-11-05T10:00:05.000Z',
      path: 'dayGLANCE/Gutter repair.md', source: 'report',
    });
    // Bounded: the vault root, the new-notes folder, the scope folder. No list, no folder read.
    expect(asked()).toEqual(['Gutter repair.md', 'dayGLANCE/Gutter repair.md', 'Projects/Gutter repair.md']);
    expect(readWikiNote).not.toHaveBeenCalled();
  });
  it('a link with a folder reads that path alone; heading and alias are not part of the name', async () => {
    reports.set('Projects/House/Gutter repair.md', reported('Projects/House/Gutter repair.md'));
    const { loadTaskNote } = useMounted({ folder: false });
    await expect(loadTaskNote('Projects/House/Gutter repair#Quotes')).resolves.toMatchObject({ source: 'report' });
    expect(asked()).toEqual(['Projects/House/Gutter repair.md']);
  });
  it('AMBIGUOUS: a known note of the name and a reported one elsewhere: neither is shown', async () => {
    reports.set('dayGLANCE/Gutter repair.md', reported('dayGLANCE/Gutter repair.md'));
    const tasks = [{ id: 'o1', title: 'x', obsidianNotePath: 'Projects/House/Gutter repair.md' }];
    const { loadTaskNote } = useMounted({ folder: false, tasks });
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({ unavailable: 'ambiguous' });
    expect(asked()[0]).toBe('Projects/House/Gutter repair.md');
  });
  it('NOT SHARED: nothing of the name reported; says when the new-notes folder is outside the plugin\'s scope', async () => {
    const { loadTaskNote } = useMounted({ folder: false });
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({ unavailable: 'not_shared', newNotesFolderOutsideScope: true, newNotesFolder: 'dayGLANCE' });
    availability = { status: 'ready', scope: { folders: ['dayGLANCE'], tags: [] } };
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({ unavailable: 'not_shared' });
    // A link into another folder is not the new-notes folder's business.
    availability = { status: 'ready', scope: null };
    await expect(loadTaskNote('Archive/Gutter repair')).resolves.toEqual({ unavailable: 'not_shared' });
  });
  it('DELETED is not found; a withdrawn note is not shared (it still exists)', async () => {
    reports.set('Projects/House/Gutter repair.md', { status: 'deleted' });
    reports.set('Archive/Old.md', { status: 'withdrawn' });
    const { loadTaskNote } = useMounted({ folder: false });
    await expect(loadTaskNote('Projects/House/Gutter repair')).resolves.toEqual({ unavailable: 'deleted' });
    await expect(loadTaskNote('Archive/Old')).resolves.toEqual({ unavailable: 'not_shared' });
  });
  it('not paired: the integration is not set up here; paired without the key: unreachable; nothing is read', async () => {
    const { loadTaskNote } = useMounted({ folder: false });
    availability = { status: 'unpaired', scope: null };
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({ unavailable: 'not_set_up' });
    availability = { status: 'locked', scope: null };
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({ unavailable: 'unreachable' });
    expect(fetchReportedNote).not.toHaveBeenCalled();
  });
  it('a request that could not be made: unreachable, not the note that did answer', async () => {
    reports.set('Gutter repair.md', { status: 'unavailable' });
    reports.set('dayGLANCE/Gutter repair.md', reported('dayGLANCE/Gutter repair.md'));
    const { loadTaskNote } = useMounted({ folder: false });
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({ unavailable: 'unreachable' });
  });
});

describe('loadTaskNote: a folder on this device', () => {
  it('THE POSTURE SKIP: Obsidian runs here, so the folder answers alone, found or not, and GLANCEvault is not asked', async () => {
    reports.set('Projects/House/Gutter repair.md', reported('Projects/House/Gutter repair.md', 'Newer.', { mtime: '2026-11-06T00:00:00.000Z' }));
    const { loadTaskNote } = useMounted({ posture: 'plugin' });
    readWikiNote.mockResolvedValue({ text: 'Mine.', lastModified: '2026-11-05T09:00:00.000Z', path: 'Projects/House/Gutter repair.md' });
    await expect(loadTaskNote('Projects/House/Gutter repair')).resolves.toMatchObject({ text: 'Mine.', source: 'file' });
    readWikiNote.mockResolvedValue(null);
    await expect(loadTaskNote('Projects/House/Gutter repair')).resolves.toEqual({ notFound: true });
    expect(fetchReportedNote).not.toHaveBeenCalled();
    expect(reportedNotesAvailability).not.toHaveBeenCalled();
  });
  it('HOLDING: the copy and the report of the same path, the newer by file mtime', async () => {
    reports.set('Projects/House/Gutter repair.md', reported('Projects/House/Gutter repair.md', 'Edited in Obsidian.'));
    const { loadTaskNote } = useMounted({ posture: 'holding' });
    readWikiNote.mockResolvedValue({ text: 'Old copy.', lastModified: '2026-11-04T09:00:00.000Z', path: 'Projects/House/Gutter repair.md' });
    await expect(loadTaskNote('Projects/House/Gutter repair')).resolves.toMatchObject({ text: 'Edited in Obsidian.', source: 'report' });
    readWikiNote.mockResolvedValue({ text: 'Edited here since.', lastModified: '2026-11-05T11:00:00.000Z', path: 'Projects/House/Gutter repair.md' });
    await expect(loadTaskNote('Projects/House/Gutter repair')).resolves.toMatchObject({ text: 'Edited here since.', source: 'file' });
    expect(asked()).toEqual(['Projects/House/Gutter repair.md', 'Projects/House/Gutter repair.md']);
  });
  it('a bare name: the report of where the folder FOUND it; a reader that does not say where (native) keeps its file', async () => {
    reports.set('Areas/Gutter repair.md', reported('Areas/Gutter repair.md', 'Edited in Obsidian.'));
    const { loadTaskNote } = useMounted({ posture: 'holding' });
    readWikiNote.mockResolvedValue({ text: 'Old copy.', lastModified: '2026-11-04T09:00:00.000Z', path: 'Areas/Gutter repair.md' });
    await expect(loadTaskNote('Gutter repair')).resolves.toMatchObject({ text: 'Edited in Obsidian.', source: 'report' });
    expect(asked()).toEqual(['Areas/Gutter repair.md']);
    fetchReportedNote.mockClear();
    readWikiNote.mockResolvedValue({ text: 'Old copy.', lastModified: '2026-11-04T09:00:00.000Z' });
    await expect(loadTaskNote('Gutter repair')).resolves.toMatchObject({ text: 'Old copy.', source: 'file' });
    expect(fetchReportedNote).not.toHaveBeenCalled();
  });
  it('a reported deletion over a copy that still has the note: deleted, no editor', async () => {
    reports.set('Projects/House/Gutter repair.md', { status: 'deleted' });
    const { loadTaskNote } = useMounted({ posture: 'holding' });
    readWikiNote.mockResolvedValue({ text: 'Still here.', lastModified: '2026-11-06T09:00:00.000Z', path: 'Projects/House/Gutter repair.md' });
    await expect(loadTaskNote('Projects/House/Gutter repair')).resolves.toEqual({ unavailable: 'deleted' });
  });
  it('a copy without the note gives way to the report the name finds; with none, the create editor stands', async () => {
    const { loadTaskNote } = useMounted({ posture: 'holding' });
    readWikiNote.mockResolvedValue(null);
    reports.set('dayGLANCE/Gutter repair.md', reported('dayGLANCE/Gutter repair.md'));
    await expect(loadTaskNote('Gutter repair')).resolves.toMatchObject({ source: 'report', path: 'dayGLANCE/Gutter repair.md' });
    reports = new Map();
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({ notFound: true });
    // Unpaired (direct): the folder alone, as always.
    availability = { status: 'unpaired', scope: null };
    fetchReportedNote.mockClear();
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({ notFound: true });
    expect(fetchReportedNote).not.toHaveBeenCalled();
  });
  it('a folder read that failed, with nothing on the stream: today\'s "not found" (read_failed)', async () => {
    const { loadTaskNote } = useMounted({ posture: 'holding' });
    readWikiNote.mockRejectedValue(new Error('EACCES'));
    await expect(loadTaskNote('Gutter repair')).resolves.toEqual({ unavailable: 'read_failed' });
  });
  it('loadWikiNote keeps its contract for every other caller: the folder only, no reasons, no reports', async () => {
    const { loadWikiNote } = useMounted({ posture: 'holding' });
    readWikiNote.mockResolvedValue(null);
    await expect(loadWikiNote('Gutter repair')).resolves.toEqual({ notFound: true });
    readWikiNote.mockRejectedValue(new Error('EACCES'));
    await expect(loadWikiNote('Gutter repair')).resolves.toBe(null);
    expect(fetchReportedNote).not.toHaveBeenCalled();
    // The panel asks for the task-note answer through it.
    await expect(loadWikiNote('Gutter repair', { taskPanel: true })).resolves.toEqual({ unavailable: 'read_failed' });
  });
});

describe('saveTaskNote', () => {
  it('a note shown from the report goes out as wiki_note_write under the REPORTED PATH and the shown text\'s base', async () => {
    reports.set('dayGLANCE/Gutter repair.md', reported('dayGLANCE/Gutter repair.md'));
    const { saveTaskNote } = useMounted({ folder: false });
    await expect(saveTaskNote('Gutter repair', 'Typed on the phone.', { base: noteTextHash(NOTE) })).resolves.toEqual({ ok: true, mode: 'queued' });
    expect(emitBridgeIntent).toHaveBeenCalledWith('wiki_note_write', {
      noteName: 'dayGLANCE/Gutter repair', content: 'Typed on the phone.', newNotesFolder: 'dayGLANCE', base: noteTextHash(NOTE),
    });
    expect(writeWikiNote).not.toHaveBeenCalled();
  });
  it('REFUSED here when the latest report moved since it was shown: nothing queued, the reported text and its time handed back', async () => {
    reports.set('dayGLANCE/Gutter repair.md', reported('dayGLANCE/Gutter repair.md', 'Edited in Obsidian since.'));
    const { saveTaskNote } = useMounted({ folder: false });
    await expect(saveTaskNote('Gutter repair', 'Mine.', { base: noteTextHash(NOTE) })).resolves.toEqual({
      refused: 'changed', text: 'Edited in Obsidian since.', lastModified: '2026-11-05T10:00:00.000Z', source: 'report', observedAt: '2026-11-05T10:00:05.000Z',
    });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
  });
  it('a copy behind the report (holding): a text edited from the report is checked against the report, not the stale copy', async () => {
    reports.set('Projects/House/Gutter repair.md', reported('Projects/House/Gutter repair.md', 'Edited in Obsidian.'));
    readWikiNote.mockResolvedValue({ text: 'Old copy.', lastModified: '2026-11-04T09:00:00.000Z', path: 'Projects/House/Gutter repair.md' });
    const { saveTaskNote } = useMounted({ posture: 'holding' });
    await expect(saveTaskNote('Projects/House/Gutter repair', 'Mine.', { base: noteTextHash('Edited in Obsidian.') })).resolves.toEqual({ ok: true, mode: 'queued' });
    expect(emitBridgeIntent).toHaveBeenCalledWith('wiki_note_write', expect.objectContaining({ noteName: 'Projects/House/Gutter repair', base: noteTextHash('Edited in Obsidian.') }));
    emitBridgeIntent.mockClear();
    await expect(saveTaskNote('Projects/House/Gutter repair', 'Mine.', { base: noteTextHash('Old copy.') })).resolves.toMatchObject({ refused: 'changed', text: 'Edited in Obsidian.' });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
  });
  it('a folder note saves exactly as before (saveWikiNote: the link name, its base)', async () => {
    readWikiNote.mockResolvedValue({ text: 'Mine.', lastModified: 'L', path: 'Areas/Gutter repair.md' });
    const { saveTaskNote } = useMounted({ posture: 'plugin' });
    await saveTaskNote('Gutter repair', 'Mine, edited.', { base: noteTextHash('Mine.') });
    expect(emitBridgeIntent).toHaveBeenCalledWith('wiki_note_write', { noteName: 'Gutter repair', content: 'Mine, edited.', newNotesFolder: 'dayGLANCE', base: noteTextHash('Mine.') });
  });
  it('no folder and the report could not be read to check against: not written, and said', async () => {
    availability = { status: 'locked', scope: null };
    const { saveTaskNote, setObsidianSyncError } = useMounted({ folder: false });
    await expect(saveTaskNote('Gutter repair', 'Mine.', { base: noteTextHash(NOTE) })).resolves.toEqual({ ok: false, unavailable: 'unreachable' });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
    expect(setObsidianSyncError).toHaveBeenCalledWith(expect.stringContaining('was not written'));
  });
});
