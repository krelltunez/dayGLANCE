import { describe, it, expect, vi, afterEach } from 'vitest';

// THE DESCRIPTION SECTION and REFUSE ON CHANGE (owner ruling 2026-10-03).
// The hook's half: loadNoteDescription reads the section out of the note
// the task panel's reader returns; saveNoteDescription and saveWikiNote
// re-read before writing and refuse when the text moved since it was
// loaded; the intents carry the base so the applier can tell too.
// Capture-harness pattern (useObsidianSync.wikiNoteCreate.test.js).

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

// The plugin's report of a note (#2291): one row read on demand. Null (no
// information) unless a test says otherwise.
const fetchReportedNoteDescription = vi.fn(async () => null);
vi.mock('../utils/obsidianBridgeInbound.js', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchReportedNoteDescription: (...a) => fetchReportedNoteDescription(...a),
}));

const { default: useObsidianSync } = await import('./useObsidianSync.js');
const { noteTextHash } = await import('@glance-apps/obsidian-format');

const NOTE = '---\ncreated: 2026-10-03\nsource: dayGLANCE\n---\n# House\nDry roof by spring.\n\n## Tasks\n- [ ] Fix the gutter ^dg-abc12345\n';

function useMountedSync({ stream = true, projects = [], enabled = true, folder = true, posture = undefined } = {}) {
  effects.length = 0;
  vi.stubGlobal('setTimeout', () => 1);
  vi.stubGlobal('setInterval', () => 1);
  vi.stubGlobal('clearInterval', () => {});
  vi.stubGlobal('document', { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' });
  vi.stubGlobal('window', {});
  const store = new Map();
  vi.stubGlobal('localStorage', { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) });
  const updateProject = vi.fn((id, u) => { const p = projects.find((x) => x.id === id); if (p) Object.assign(p, u); });
  const api = useObsidianSync({
    isTrayMode: false, dataLoaded: true,
    tasks: [], setTasks: vi.fn(), unscheduledTasks: [], setUnscheduledTasks: vi.fn(),
    setDailyNotes: vi.fn(), setWikilinkCandidates: vi.fn(), setUnportableVaultFiles: vi.fn(),
    obsidianConfig: { enabled, dailyNotesPath: '', dailyNotePattern: 'yyyy-MM-dd', newNotesFolder: 'dayGLANCE' },
    setObsidianConfig: vi.fn(), obsidianLaunchOnWrite: null, obsidianSyncError: null,
    setObsidianSyncStatus: vi.fn(), setObsidianSyncError: vi.fn(), setObsidianLastSynced: vi.fn(), setObsidianSyncNotice: vi.fn(),
    obsidianVaultHandleRef: { current: folder ? { kind: 'directory' } : null },
    obsidianSyncInProgressRef: { current: false }, obsidianPrevTaskStateRef: { current: {} },
    obsidianTasksRef: { current: [] }, obsidianInboxRef: { current: [] },
    projects, goals: [], updateProject, updateGoal: vi.fn(),
  });
  // No folder: no cycle runs, so no posture is ever recorded (the ref keeps its initial value).
  if (posture !== null) api.bridgeHeartbeatRef.current = { obsidianRunning: stream, pluginAuthoritative: stream, vaultPosture: posture ?? (stream ? 'plugin' : 'direct') };
  return { ...api, updateProject, store };
}
const flushMicrotasks = () => new Promise((r) => setImmediate(r));

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); readWikiNote.mockReset(); writeWikiNote.mockClear(); emitBridgeIntent.mockReset(); emitBridgeIntent.mockReturnValue(true); fetchReportedNoteDescription.mockReset(); fetchReportedNoteDescription.mockResolvedValue(null); });

describe('loadNoteDescription', () => {
  it('returns the section under the title with its hash; absence and an unreadable vault pass through', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: 'L' });
    const { loadNoteDescription } = useMountedSync();
    await expect(loadNoteDescription('Projects/House.md')).resolves.toEqual({ text: 'Dry roof by spring.', base: noteTextHash('Dry roof by spring.'), lastModified: 'L' });
    // THE PATH LOSES ITS EXTENSION on the way to the reader, which appends
    // .md itself (the 2026-10-04 report: "Note.md.md" was looked for, and a
    // linked project's planner said its note was not found).
    expect(readWikiNote).toHaveBeenLastCalledWith({ kind: 'directory' }, 'Projects/House');
    readWikiNote.mockResolvedValue(null);
    await expect(loadNoteDescription('Projects/House.md')).resolves.toEqual({ notFound: true });
    readWikiNote.mockRejectedValue(new Error('boom'));
    await expect(loadNoteDescription('Projects/House.md')).resolves.toBe(null);
  });
});

describe('saveNoteDescription (the editor over the section)', () => {
  it('writes the section as a replace intent carrying the base, when the section is as loaded', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: 'L' });
    const { saveNoteDescription } = useMountedSync();
    const base = noteTextHash('Dry roof by spring.');
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'Dry roof, and gutters.', { base })).resolves.toEqual({ ok: true, mode: 'queued' });
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_description', expect.objectContaining({
      path: 'Projects/House.md', targetId: 'p1', content: 'Dry roof, and gutters.', mode: 'replace', base,
    }));
  });
  it('REFUSES when the section moved since it was loaded: nothing is sent, the current text comes back', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE.replace('Dry roof by spring.', 'Edited in Obsidian.'), lastModified: 'L2' });
    const { saveNoteDescription } = useMountedSync();
    const stale = noteTextHash('Dry roof by spring.');
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'Typed here.', { base: stale }))
      .resolves.toEqual({ refused: 'changed', text: 'Edited in Obsidian.', lastModified: 'L2' });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
  });
  it('direct access writes the whole note with the section replaced', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: 'L' });
    const { saveNoteDescription } = useMountedSync({ stream: false });
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'New text.')).resolves.toEqual({ ok: true, mode: 'written' });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
    expect(writeWikiNote).toHaveBeenCalledWith({ kind: 'directory' }, 'Projects/House', NOTE.replace('Dry roof by spring.', 'New text.'), 'dayGLANCE');
  });
});

// ── THE PLUGIN'S REPORT AS A SECOND SOURCE (#2291) ─────────────────────────
// The owner's rulings: no folder → the report; both → the newer, file mtime
// to file mtime; a reported deletion or withdrawal → not found; a path never
// reported → no information. The save re-reads by the same rule.
const reportOf = (text, { mtime = '2026-11-05T10:00:00.000Z', observedAt = '2026-11-05T10:00:05.000Z' } = {}) => (
  { text, base: noteTextHash(text), observedAt, lastModified: mtime }
);
const fileAt = (section, lastModified) => ({ text: NOTE.replace('Dry roof by spring.', section), lastModified });

describe('loadNoteDescription with the plugin\'s report', () => {
  it('no folder here: the reported section, marked as a report with its time; never reported is no information', async () => {
    fetchReportedNoteDescription.mockResolvedValue(reportOf('From Obsidian.'));
    const { loadNoteDescription } = useMountedSync({ folder: false, posture: null });
    await expect(loadNoteDescription('[[Projects/House]]')).resolves.toEqual({ ...reportOf('From Obsidian.'), source: 'report' });
    expect(fetchReportedNoteDescription).toHaveBeenLastCalledWith('Projects/House.md');
    expect(readWikiNote).not.toHaveBeenCalled();
    fetchReportedNoteDescription.mockResolvedValue(null);
    await expect(loadNoteDescription('Projects/House.md')).resolves.toBe(null);
  });
  it('a failed folder read, and a copy without the note, give way to the report', async () => {
    fetchReportedNoteDescription.mockResolvedValue(reportOf('From Obsidian.'));
    const { loadNoteDescription } = useMountedSync({ posture: 'holding', stream: false });
    readWikiNote.mockRejectedValue(new Error('EACCES'));
    await expect(loadNoteDescription('Projects/House.md')).resolves.toMatchObject({ text: 'From Obsidian.', source: 'report' });
    readWikiNote.mockResolvedValue(null);
    await expect(loadNoteDescription('Projects/House.md')).resolves.toMatchObject({ text: 'From Obsidian.', source: 'report' });
  });
  it('both: the newer wins, the report\'s file mtime against the local file\'s', async () => {
    fetchReportedNoteDescription.mockResolvedValue(reportOf('Edited on the desktop.', { mtime: '2026-11-05T10:00:00.000Z' }));
    const { loadNoteDescription } = useMountedSync({ posture: 'holding', stream: false });
    // A copy that is behind (holding: Obsidian not running here).
    readWikiNote.mockResolvedValue(fileAt('Old copy.', '2026-11-04T09:00:00.000Z'));
    await expect(loadNoteDescription('Projects/House.md')).resolves.toMatchObject({ text: 'Edited on the desktop.', source: 'report' });
    // A copy newer than the report.
    readWikiNote.mockResolvedValue(fileAt('Edited here since.', '2026-11-05T11:00:00.000Z'));
    await expect(loadNoteDescription('Projects/House.md')).resolves.toEqual({ text: 'Edited here since.', base: noteTextHash('Edited here since.'), lastModified: '2026-11-05T11:00:00.000Z' });
  });
  it('a reported deletion or withdrawal is not found, over a copy that still has the note', async () => {
    fetchReportedNoteDescription.mockResolvedValue({ notFound: true });
    readWikiNote.mockResolvedValue(fileAt('Still in my copy.', '2026-11-05T11:00:00.000Z'));
    const { loadNoteDescription } = useMountedSync({ posture: 'holding', stream: false });
    await expect(loadNoteDescription('Projects/House.md')).resolves.toEqual({ notFound: true });
    const noFolder = useMountedSync({ folder: false, posture: null });
    await expect(noFolder.loadNoteDescription('Projects/House.md')).resolves.toEqual({ notFound: true });
  });
});

describe('saveNoteDescription with the plugin\'s report', () => {
  it('no folder, no posture recorded: the save goes out as the replace intent under the base of the shown (reported) text', async () => {
    fetchReportedNoteDescription.mockResolvedValue(reportOf('From Obsidian.'));
    const { saveNoteDescription } = useMountedSync({ folder: false, posture: null });
    const base = noteTextHash('From Obsidian.');
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'Typed on the phone.', { base })).resolves.toEqual({ ok: true, mode: 'queued' });
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_description', expect.objectContaining({
      path: 'Projects/House.md', targetId: 'p1', content: 'Typed on the phone.', mode: 'replace', base,
    }));
    expect(writeWikiNote).not.toHaveBeenCalled();
  });
  it('no folder: a base the latest report no longer matches is refused here, with the reported text and its time', async () => {
    fetchReportedNoteDescription.mockResolvedValue(reportOf('Edited in Obsidian since.'));
    const { saveNoteDescription } = useMountedSync({ folder: false, posture: null });
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'Typed.', { base: noteTextHash('From Obsidian.') }))
      .resolves.toEqual({ refused: 'changed', text: 'Edited in Obsidian since.', lastModified: '2026-11-05T10:00:00.000Z', source: 'report', observedAt: '2026-11-05T10:00:05.000Z' });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
  });
  it('a copy behind the report: a text edited from the report is NOT refused against the stale copy; one edited from the stale copy is', async () => {
    fetchReportedNoteDescription.mockResolvedValue(reportOf('Edited on the desktop.', { mtime: '2026-11-05T10:00:00.000Z' }));
    readWikiNote.mockResolvedValue(fileAt('Old copy.', '2026-11-04T09:00:00.000Z'));
    const { saveNoteDescription } = useMountedSync({ posture: 'holding', stream: false });
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'Mine.', { base: noteTextHash('Edited on the desktop.') })).resolves.toEqual({ ok: true, mode: 'queued' });
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_description', expect.objectContaining({ base: noteTextHash('Edited on the desktop.') }));
    emitBridgeIntent.mockClear();
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'Mine.', { base: noteTextHash('Old copy.') }))
      .resolves.toMatchObject({ refused: 'changed', text: 'Edited on the desktop.' });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
  });
  it('not paired and no folder: unchanged, nothing is written or queued', async () => {
    const { saveNoteDescription } = useMountedSync({ folder: false, posture: null });
    await expect(saveNoteDescription('project', 'p1', 'Projects/House.md', 'Typed.', { base: noteTextHash('x') })).resolves.toEqual({ ok: false });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
    expect(writeWikiNote).not.toHaveBeenCalled();
  });
});

describe('saveWikiNote refuses on change too (task notes)', () => {
  it('a base that no longer matches the note refuses; a matching one writes with the base on the intent', async () => {
    readWikiNote.mockResolvedValue({ text: 'moved', lastModified: 'L' });
    const { saveWikiNote } = useMountedSync();
    await expect(saveWikiNote('TV Series', 'mine', { base: noteTextHash('loaded') })).resolves.toEqual({ refused: 'changed', text: 'moved', lastModified: 'L' });
    expect(emitBridgeIntent).not.toHaveBeenCalled();
    await saveWikiNote('TV Series', 'mine', { base: noteTextHash('moved') });
    expect(emitBridgeIntent).toHaveBeenCalledWith('wiki_note_write', expect.objectContaining({ noteName: 'TV Series', content: 'mine', base: noteTextHash('moved') }));
    // Without a base: the old behaviour, no read, no refusal.
    emitBridgeIntent.mockClear(); readWikiNote.mockClear();
    await saveWikiNote('TV Series', 'again');
    expect(readWikiNote).not.toHaveBeenCalled();
    expect(emitBridgeIntent).toHaveBeenCalledWith('wiki_note_write', expect.not.objectContaining({ base: expect.anything() }));
  });
});

describe('the notes box moves into the note', () => {
  it('on link: merged below the note, journaled, the record emptied on enqueue', async () => {
    const projects = [{ id: 'p1', title: 'House', description: 'Purpose: keep it dry.' }];
    const { linkProjectNote, updateProject, store } = useMountedSync({ projects });
    expect(linkProjectNote('project', 'p1', 'Projects/House.md')).toBe(true);
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_description', { path: 'Projects/House.md', targetId: 'p1', content: 'Purpose: keep it dry.', mode: 'merge' });
    expect(updateProject).toHaveBeenCalledWith('p1', { description: '' });
    expect(JSON.parse(store.get('day-planner-obsidian-notes-sent'))['project:p1']).toMatchObject({ target: 'Projects/House.md', body: 'Purpose: keep it dry.' });
  });
  it('on link of an entity not yet in the lists: the body travels with the call', () => {
    const { linkProjectNote, updateProject } = useMountedSync({ projects: [] });
    expect(linkProjectNote('project', 'p9', 'Projects/New.md', { description: 'Fresh.' })).toBe(true);
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_description', { path: 'Projects/New.md', targetId: 'p9', content: 'Fresh.', mode: 'merge' });
    expect(updateProject).toHaveBeenCalledWith('p9', { description: '' });
  });
  it('at creation: rides the create intent as description, journaled, the record emptied', () => {
    const projects = [{ id: 'p2', title: 'Garden', description: 'Grow food.' }];
    const { createProjectNote, updateProject } = useMountedSync({ projects });
    expect(createProjectNote('project', 'p2', { title: 'Garden', description: 'Grow food.' })).toBe(true);
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_create', expect.objectContaining({ targetId: 'p2', description: 'Grow food.' }));
    expect(updateProject).toHaveBeenCalledWith('p2', { description: '' });
    // A refused enqueue leaves the box where it was.
    emitBridgeIntent.mockReturnValue(false);
    updateProject.mockClear();
    expect(createProjectNote('project', 'p2', { title: 'Garden', description: 'Grow food.' })).toBe(false);
    expect(updateProject).not.toHaveBeenCalled();
  });
});

describe('the link without a stream (owner 2026-10-03: the wikilink in the title, and the note row, on direct access)', () => {
  it('a refused enqueue with the vault enabled links the record alone, marked pending; the stream path clears the mark', () => {
    emitBridgeIntent.mockReturnValue(false);
    const projects = [{ id: 'p1', title: 'House' }];
    const { linkProjectNote, updateProject } = useMountedSync({ stream: false, projects });
    expect(linkProjectNote('project', 'p1', '[[Projects/House]]')).toBe(true);
    expect(updateProject).toHaveBeenCalledWith('p1', { obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: null, obsidianNoteLinkPending: expect.stringMatching(/^\d{4}-/) });
    // With the stream the key goes out and the record carries no mark.
    emitBridgeIntent.mockReturnValue(true);
    updateProject.mockClear();
    expect(linkProjectNote('project', 'p1', 'Projects/House.md')).toBe(true);
    expect(emitBridgeIntent).toHaveBeenCalledWith('project_note_link', { path: 'Projects/House.md', targetId: 'p1' });
    expect(updateProject).toHaveBeenCalledWith('p1', { obsidianNotePath: 'Projects/House.md', obsidianNoteMissingAt: null, obsidianNoteLinkPending: null });
  });
  it('with the vault disabled a refused enqueue is a refusal, as before', () => {
    emitBridgeIntent.mockReturnValue(false);
    const projects = [{ id: 'p1', title: 'House' }];
    const { linkProjectNote, updateProject } = useMountedSync({ stream: false, projects, enabled: false });
    expect(linkProjectNote('project', 'p1', 'Projects/House.md')).toBe(false);
    expect(updateProject).not.toHaveBeenCalled();
  });
  it('the notes box moves into the section through the direct write: merged below the note\'s text, journaled, the record emptied once the write landed', async () => {
    emitBridgeIntent.mockReturnValue(false);
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: 'L' });
    const projects = [{ id: 'p1', title: 'House', description: 'Purpose: keep it dry.' }];
    const { linkProjectNote, updateProject, store } = useMountedSync({ stream: false, projects });
    expect(linkProjectNote('project', 'p1', 'Projects/House.md')).toBe(true);
    await flushMicrotasks();
    expect(writeWikiNote).toHaveBeenCalledWith({ kind: 'directory' }, 'Projects/House', NOTE.replace('Dry roof by spring.', 'Dry roof by spring.\n\nPurpose: keep it dry.'), 'dayGLANCE');
    expect(updateProject).toHaveBeenCalledWith('p1', { description: '' });
    expect(JSON.parse(store.get('day-planner-obsidian-notes-sent'))['project:p1']).toMatchObject({ target: 'Projects/House.md', body: 'Purpose: keep it dry.' });
  });
  it('a note this device cannot find leaves the box on the record for the first pass that can move it', async () => {
    emitBridgeIntent.mockReturnValue(false);
    readWikiNote.mockResolvedValue(null);
    const projects = [{ id: 'p1', title: 'House', description: 'Purpose: keep it dry.' }];
    const { linkProjectNote, updateProject } = useMountedSync({ stream: false, projects });
    expect(linkProjectNote('project', 'p1', 'Projects/Typo.md')).toBe(true);
    await flushMicrotasks();
    expect(writeWikiNote).not.toHaveBeenCalled();
    expect(updateProject).not.toHaveBeenCalledWith('p1', { description: '' });
    expect(projects[0].description).toBe('Purpose: keep it dry.');
  });
  it('unlinking a pending link clears the record and sends no unlink: the vault never carried the key', () => {
    const projects = [{ id: 'p1', title: 'House', obsidianNotePath: 'Projects/House.md', obsidianNoteLinkPending: '2026-10-03T10:00:00.000Z' }];
    const { unlinkProjectNote, updateProject } = useMountedSync({ projects });
    expect(unlinkProjectNote('project', 'p1')).toBe(true);
    expect(updateProject).toHaveBeenCalledWith('p1', { obsidianNotePath: null, obsidianNoteMissingAt: null, obsidianNoteLinkPending: null });
    expect(emitBridgeIntent).not.toHaveBeenCalledWith('project_note_unlink', expect.anything());
  });
});

describe('the plugin\'s report is not read where the folder is the live note (#2291)', () => {
  const reported = { text: 'From another device.', base: noteTextHash('From another device.'), observedAt: '2026-11-05T09:00:00Z', lastModified: '2099-01-01T00:00:00Z' };
  it('plugin posture with a readable file: the file answers alone, no GLANCEvault read', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: '2026-11-01T00:00:00Z' });
    fetchReportedNoteDescription.mockResolvedValue(reported);
    const { loadNoteDescription } = useMountedSync({ posture: 'plugin' });
    await expect(loadNoteDescription('Projects/House.md')).resolves.toMatchObject({ text: 'Dry roof by spring.' });
    expect(fetchReportedNoteDescription).not.toHaveBeenCalled();
  });
  it('plugin posture without the note in the folder still asks for the report', async () => {
    readWikiNote.mockResolvedValue(null);
    fetchReportedNoteDescription.mockResolvedValue(reported);
    const { loadNoteDescription } = useMountedSync({ posture: 'plugin' });
    await expect(loadNoteDescription('Projects/House.md')).resolves.toMatchObject({ text: 'From another device.' });
    expect(fetchReportedNoteDescription).toHaveBeenCalledTimes(1);
  });
  it('holding posture reads both and the newer wins', async () => {
    readWikiNote.mockResolvedValue({ text: NOTE, lastModified: '2026-11-01T00:00:00Z' });
    fetchReportedNoteDescription.mockResolvedValue(reported);
    const { loadNoteDescription } = useMountedSync({ posture: 'holding', stream: false });
    await expect(loadNoteDescription('Projects/House.md')).resolves.toMatchObject({ text: 'From another device.' });
    expect(fetchReportedNoteDescription).toHaveBeenCalledTimes(1);
  });
});

