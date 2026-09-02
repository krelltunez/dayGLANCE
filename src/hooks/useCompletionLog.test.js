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

  it('THE ECHO GUARD: a remote apply consumes the edge silently — the completing device already logged', () => {
    const prev = snap([{ id: 'a', completed: false }]);
    const tasks = [{ id: 'a', completed: true, title: 'A' }];
    const next = snap(tasks);
    const out = planCompletionLog(prev, next, { tasks, isRemoteApply: true });
    expect(out).toEqual({ candidates: [], advanceTo: next });
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
