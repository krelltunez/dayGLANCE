import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The completion-log detector's load-bearing claims: only false→true EDGES
// log (first sight never does), engine echoes are suppressed, recurring
// instance completions log against the INSTANCE date with [recurring:: true],
// disabled consumption is silent (no retro-logging on enable), and the hook
// glue emits the completion_log_append intent with the formatter's exact
// line. Slot-based react mock so refs survive re-renders.

const effects = [];
let refSlots = [];
let refCursor = 0;
vi.mock('react', () => ({
  useEffect: (fn) => { effects.push(fn); },
  useRef: (init) => {
    if (refCursor >= refSlots.length) refSlots.push({ current: init });
    return refSlots[refCursor++];
  },
  useReducer: (r, init) => [init, () => {}],
  useCallback: (fn) => fn,
}));

const emitBridgeIntent = vi.fn(() => true);
vi.mock('../utils/obsidianBridgeStream.js', () => ({
  emitBridgeIntent: (...a) => emitBridgeIntent(...a),
}));
const readDailyNoteFresh = vi.fn();
const writeDailyNoteFile = vi.fn();
const readDailyNoteNative = vi.fn();
const writeDailyNoteNative = vi.fn();
vi.mock('../obsidian.js', () => ({
  readDailyNoteFresh: (...a) => readDailyNoteFresh(...a),
  writeDailyNoteFile: (...a) => writeDailyNoteFile(...a),
  readDailyNoteNative: (...a) => readDailyNoteNative(...a),
  writeDailyNoteNative: (...a) => writeDailyNoteNative(...a),
}));
vi.mock('../utils/trayMode.js', () => ({ isTrayMode: false }));

const { default: useCompletionLog, planCompletionLog, snapshotCompletionState, buildCompletionLogWrite } =
  await import('./useCompletionLog.js');

const flush = () => new Promise((r) => setTimeout(r, 0));

const CFG = {
  enabled: true, completionLogEnabled: true, dailyNotesPath: 'Daily',
  dailyNotePattern: 'yyyy-MM-dd', completionLogHeading: '',
};

function useRenderedHook(props) {
  effects.length = 0;
  refCursor = 0; // same slots, fresh cursor — refs persist across renders
  useCompletionLog(props);
  for (const e of effects) e();
}

beforeEach(() => {
  refSlots = [];
  emitBridgeIntent.mockReset();
  emitBridgeIntent.mockReturnValue(true);
  readDailyNoteFresh.mockReset();
  writeDailyNoteFile.mockReset();
  readDailyNoteNative.mockReset();
  writeDailyNoteNative.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('planCompletionLog (pure)', () => {
  const snap = (tasks = [], unsched = [], rec = []) => snapshotCompletionState(tasks, unsched, rec);

  it('a false→true edge is a candidate; first sight and already-completed are not', () => {
    const prev = snap([{ id: 'a', completed: false }, { id: 'b', completed: true }]);
    const tasks = [
      { id: 'a', completed: true, title: 'A', completedAt: '2026-09-02T10:00:00-05:00' },
      { id: 'b', completed: true, title: 'B' },
      { id: 'new', completed: true, title: 'arrived completed' },
    ];
    const { candidates } = planCompletionLog(prev, snap(tasks), { tasks });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ title: 'A', completedAt: '2026-09-02T10:00:00-05:00', recurring: false });
  });

  it('THE APPLY HOLD (2026-09-01 field fix): a remote apply DEFERS the diff — the edge logs on the next quiet render, never silently dies', () => {
    // The first shape consumed the snapshot on isRemoteApply, and a
    // cross-list delete/resupply war (applies firing continuously) swallowed
    // LOCAL completions landing in the apply windows — the field-test
    // "nothing logs anymore" incident. A hold keeps the edge in the diff.
    const prev = snap([{ id: 'a', completed: false }]);
    const tasks = [{ id: 'a', completed: true, title: 'A', completedAt: '2026-09-01T19:50:03-06:00' }];
    const next = snap(tasks);
    expect(planCompletionLog(prev, next, { tasks, isRemoteApply: true }))
      .toEqual({ candidates: [], advanceTo: null });
    // Quiet render: same prev (held), edge still there → logs.
    const { candidates } = planCompletionLog(prev, next, { tasks, isRemoteApply: false });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ title: 'A' });
  });

  it('disabled consumption is silent too: transitions while the log is off are never retro-logged on enable', () => {
    const prev = snap([{ id: 'a', completed: false }]);
    const tasks = [{ id: 'a', completed: true, title: 'A' }];
    const next = snap(tasks);
    expect(planCompletionLog(prev, next, { tasks, enabled: false })).toEqual({ candidates: [], advanceTo: next });
    // And the NEXT render (task still completed) sees no edge.
    expect(planCompletionLog(next, next, { tasks, enabled: true }).candidates).toEqual([]);
  });

  it('recurring: a new completedDates entry logs against the INSTANCE date with its timestamp', () => {
    const recPrev = [{ id: 'r1', title: 'Meditate', completedDates: ['2026-09-01'] }];
    const recNext = [{
      id: 'r1', title: 'Meditate',
      completedDates: ['2026-09-01', '2026-09-02'],
      completedDatesTimestamps: { '2026-09-02': '2026-09-02T12:15:00.000Z' },
    }];
    const { candidates } = planCompletionLog(
      snap([], [], recPrev), snap([], [], recNext), { recurringTasks: recNext });
    expect(candidates).toEqual([expect.objectContaining({
      title: 'Meditate', recurring: true, bucketOverride: '2026-09-02',
      completedAt: '2026-09-02T12:15:00.000Z',
    })]);
    // Un-completing a date is NOT an edge (the log never removes).
    const { candidates: none } = planCompletionLog(
      snap([], [], recNext), snap([], [], recPrev), { recurringTasks: recPrev });
    expect(none).toEqual([]);
  });

  it('in-flight holds the snapshot so the window is re-diffed after the fire', () => {
    const prev = snap([{ id: 'a', completed: false }]);
    const tasks = [{ id: 'a', completed: true, title: 'A' }];
    expect(planCompletionLog(prev, snap(tasks), { tasks, inFlight: true }))
      .toEqual({ candidates: [], advanceTo: null });
  });
});

describe('buildCompletionLogWrite (pure)', () => {
  it('resolves the project name, the patterned path, and the ruled default heading', () => {
    const write = buildCompletionLogWrite(
      { title: 'Ship it #dev', completedAt: '2026-09-02T18:05:00-05:00', projectId: 'p1', priority: 2, deadline: null, recurring: false, bucketOverride: null },
      {
        // Projects carry their display name in `title` (17 UI sites render
        // project.title; `name` is the AREA field) — the field-test bug was
        // this fixture and the lookup agreeing on the WRONG field.
        projects: [{ id: 'p1', title: 'Acme migration', name: 'wrong-field decoy' }],
        obsidianConfig: { ...CFG, dailyNotePattern: 'dd.MM.yyyy' },
        dailyNoteTemplate: '# Day\n', localToday: '2026-09-03',
      },
    );
    expect(write).toEqual({
      path: 'Daily/02.09.2026.md',
      date: '2026-09-02',
      heading: '## Completed',
      template: '# Day\n',
      entry: '- ✅ 18:05 Ship it [completion:: 2026-09-02T18:05:00-05:00] [project:: Acme migration] [priority:: 2] #dev',
    });
  });

  it('a configured heading wins; a missing completedAt buckets to local today, deterministically', () => {
    const write = buildCompletionLogWrite(
      { title: 'Voice thing', completedAt: null, projectId: null, priority: 0, deadline: null, recurring: false, bucketOverride: null },
      { projects: [], obsidianConfig: { ...CFG, completionLogHeading: '## Done' }, dailyNoteTemplate: '', localToday: '2026-09-02' },
    );
    expect(write.heading).toBe('## Done');
    expect(write.date).toBe('2026-09-02');
    expect(write.entry).toBe('- ✅ Voice thing [completion:: 2026-09-02]');
  });
});

describe('the hook glue', () => {
  const baseProps = (tasks, over = {}) => ({
    tasks, unscheduledTasks: [], recurringTasks: [], projects: [],
    obsidianConfig: CFG, dailyNoteTemplate: '# T\n',
    obsidianVaultHandleRef: { current: { kind: 'directory' } },
    bridgeHeartbeatRef: { current: { pluginAuthoritative: false } },
    setObsidianSyncError: vi.fn(), setObsidianSyncStatus: vi.fn(),
    isRemoteApply: () => false,
    ...over,
  });

  it('a completion edge emits the intent AND applies the direct write (convergent, same entry)', async () => {
    readDailyNoteFresh.mockResolvedValue({ text: '# Day\n' });
    useRenderedHook(baseProps([{ id: 'a', completed: false, title: 'A' }]));
    useRenderedHook(baseProps([{ id: 'a', completed: true, title: 'A', completedAt: '2026-09-02T10:00:00-05:00' }]));
    await flush();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    const [type, fields] = emitBridgeIntent.mock.calls[0];
    expect(type).toBe('completion_log_append');
    expect(fields).toMatchObject({
      path: 'Daily/2026-09-02.md', date: '2026-09-02', heading: '## Completed',
      entry: '- ✅ 10:00 A [completion:: 2026-09-02T10:00:00-05:00]',
    });
    expect(writeDailyNoteFile).toHaveBeenCalledTimes(1);
    expect(writeDailyNoteFile.mock.calls[0][3]).toContain(`## Completed\n${fields.entry}`);
    // Third render, no new edge → nothing more.
    useRenderedHook(baseProps([{ id: 'a', completed: true, title: 'A', completedAt: '2026-09-02T10:00:00-05:00' }]));
    await flush();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
  });

  it('multi-user: only completions the current user would see are logged (unassigned, or assigned to me)', async () => {
    readDailyNoteFresh.mockResolvedValue({ text: '# Day\n' });
    const me = 'u-me';
    const isVisibleForUser = (t) => !(t.assignedUserSyncIds?.length) || t.assignedUserSyncIds.includes(me);
    const before = [
      { id: 'mine', completed: false, title: 'Mine', assignedUserSyncIds: [me] },
      { id: 'hers', completed: false, title: 'Hers', assignedUserSyncIds: ['u-wife'] },
      { id: 'shared', completed: false, title: 'Shared' },
    ];
    const done = (t) => ({ ...t, completed: true, completedAt: '2026-09-02T10:00:00-05:00' });
    useRenderedHook(baseProps(before, { isVisibleForUser }));
    useRenderedHook(baseProps(before.map(done), { isVisibleForUser }));
    await flush();
    const logged = emitBridgeIntent.mock.calls.map(([, f]) => f.entry);
    expect(logged).toHaveLength(2);
    expect(logged.join('\n')).toContain('Mine');
    expect(logged.join('\n')).toContain('Shared');
    expect(logged.join('\n')).not.toContain('Hers');
  });

  it('plugin authoritative: the intent is the write; a dropped emit latches the visible error', async () => {
    emitBridgeIntent.mockReturnValue(false);
    const props = baseProps([{ id: 'a', completed: false, title: 'A' }], {
      bridgeHeartbeatRef: { current: { pluginAuthoritative: true } },
    });
    useRenderedHook(props);
    useRenderedHook({ ...props, tasks: [{ id: 'a', completed: true, title: 'A', completedAt: '2026-09-02T10:00:00-05:00' }] });
    await flush();
    expect(props.setObsidianSyncError).toHaveBeenCalledWith(expect.stringContaining('was not logged'));
    expect(props.setObsidianSyncStatus).toHaveBeenCalledWith('error');
    expect(writeDailyNoteFile).not.toHaveBeenCalled();
  });

  it('NO ROUTE HOLDS (2026-09-01 field fix): a completion made while the vault handle is restoring logs when it arrives, never silently dies', async () => {
    readDailyNoteFresh.mockResolvedValue({ text: '# Day\n' });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const noRoute = (tasks) => baseProps(tasks, { obsidianVaultHandleRef: { current: null } });
    useRenderedHook(noRoute([{ id: 'a', completed: false, title: 'A' }]));
    // Completion lands while the handle is still null (post-launch restore).
    useRenderedHook(noRoute([{ id: 'a', completed: true, title: 'A', completedAt: '2026-09-02T10:00:00-05:00' }]));
    await flush();
    expect(emitBridgeIntent).not.toHaveBeenCalled();
    expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining('waiting for vault access'));
    // The handle restores on a later render: the HELD edge logs now.
    useRenderedHook(baseProps([{ id: 'a', completed: true, title: 'A', completedAt: '2026-09-02T10:00:00-05:00' }]));
    await flush();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    expect(emitBridgeIntent.mock.calls[0][1].entry).toContain('10:00 A');
  });

  it('plugin-authoritative with NO local handle still logs — the emit route needs none (the iOS/plugin-only shape)', async () => {
    const props = (tasks) => baseProps(tasks, {
      obsidianVaultHandleRef: { current: null },
      bridgeHeartbeatRef: { current: { pluginAuthoritative: true } },
    });
    useRenderedHook(props([{ id: 'a', completed: false, title: 'A' }]));
    useRenderedHook(props([{ id: 'a', completed: true, title: 'A', completedAt: '2026-09-02T10:00:00-05:00' }]));
    await flush();
    expect(emitBridgeIntent).toHaveBeenCalledTimes(1);
    expect(writeDailyNoteFile).not.toHaveBeenCalled();
  });

  it('native read contract: a FAILED read (null) skips the entry rather than recreating the note', async () => {
    readDailyNoteNative.mockReturnValue(null);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const props = baseProps([{ id: 'a', completed: false, title: 'A' }], {
      obsidianVaultHandleRef: { current: 'native' },
    });
    useRenderedHook(props);
    useRenderedHook({ ...props, tasks: [{ id: 'a', completed: true, title: 'A', completedAt: '2026-09-02T10:00:00-05:00' }] });
    await flush();
    expect(writeDailyNoteNative).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalled();
  });
});
