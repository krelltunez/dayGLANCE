import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// TRANSCRIPTION PINS between taskMutations.js and the UI write paths.
//
// PR #1354 (Option C) gave MCP its own pure implementations of the task
// mutations, each transcribed from a cited UI call site. The UI call sites
// still write inline (useDragDrop.js drag/resize handlers, useTaskActions.js),
// and converting them was considered and deliberately rejected: useDragDrop.js
// is the riskiest interaction code in the app. These tests are the cheaper
// protection: for the same input, the UI path and the taskMutations function
// must produce the same task object, and every DELIBERATE divergence is
// asserted explicitly so it fails when either side moves.
//
// The failure these exist to catch: someone changes a drag handler's shape
// without mirroring it in taskMutations.js. Failures name the drifted field.
//
// CANONICAL SOURCE FOR THE SCHEDULE SHAPE. The schedule transition has TWO
// UI sources which already disagree with each other:
//   1. useTaskActions.js scheduleDeadlineTaskAt: stamps lastModified, applies
//      a duration || 30 fallback, no transitionId.
//   2. useDragDrop.js handleDropOnCalendar inbox branch: stamps NOTHING extra,
//      preserves duration verbatim, no transitionId.
// applyScheduleTask matches its cited source, scheduleDeadlineTaskAt (it
// stamps lastModified and falls back on duration). If a schedule pin fails,
// scheduleDeadlineTaskAt is the shape taskMutations must follow; the drop
// branch's differences are pinned below as documented divergences.
//
// THE duration: 0 EDGE IS REAL, NOT STYLISTIC. scheduleDeadlineTaskAt uses
// `task.duration || 30` (a 0 becomes 30); applyScheduleTask uses
// `durationMinutes ?? task.duration ?? 30` (a 0 stays 0, matching the drop
// branch's verbatim spread instead of its cited source). No UI flow creates a
// duration-0 inbox task today, so this is pinned as a known three-way split
// rather than papered over. See 'duration 0' test below.
//
// HOW THE UI SHAPES ARE REACHED. useTaskActions is a pure deps-object hook
// (no React internals), so its actions are called directly with mocked
// setters and the written object is captured from the functional updater.
// useDragDrop holds drag state in useState, so the react mock below makes
// useState stateful (cells persist across hook invocations): render, drive
// the real handleDragStart, render again, drop. Guards that the UI computes
// from DOM geometry (conflict adjustment, column cap) are stubbed to
// pass-through: the pin covers the WRITE SHAPE of a permitted, unadjusted
// gesture, not the guards themselves. No line of useDragDrop.js is modified.

const capturedEffects = [];
const stateCells = [];
const refCells = [];
let hookCursor = { state: 0, ref: 0 };
vi.mock('react', () => ({
  useEffect: (fn, deps) => { capturedEffects.push({ fn, deps }); },
  useState: (init) => {
    const i = hookCursor.state++;
    if (!(i in stateCells)) stateCells[i] = typeof init === 'function' ? init() : init;
    return [stateCells[i], (v) => { stateCells[i] = typeof v === 'function' ? v(stateCells[i]) : v; }];
  },
  useRef: (init) => {
    const i = hookCursor.ref++;
    if (!(i in refCells)) refCells[i] = { current: init };
    return refCells[i];
  },
}));

// handleResizeStart registers its listeners on document; capture them so the
// test can feed synthetic mouse positions through the real resize math.
const docListeners = {};
globalThis.document = {
  addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
  removeEventListener: (type, fn) => {
    docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn);
  },
};

const { default: useTaskActions } = await import('../hooks/useTaskActions.js');
const { default: useDragDrop } = await import('../hooks/useDragDrop.js');
const {
  applyCreateTask, applyScheduleTask, applyMoveBlock, applyResizeBlock,
  applySetCompletion, parseRecurringInstanceId, WRITE_ERROR_CODES,
} = await import('./taskMutations.js');
const { dateToString } = await import('./taskUtils.js');

const NOW = new Date(2026, 7, 16, 14, 30, 0);
const NOW_ISO = NOW.toISOString();
const TODAY_STR = dateToString(NOW);
const UUID = 'uuid-fixed';

// Sentinel for "the key is not present on the object" in divergence maps and
// failure messages. Distinct from undefined, which a shape could really hold.
const ABSENT = '<absent>';

/**
 * Field-by-field pin. Undocumented differences fail with a message naming the
 * field and both values. Documented divergences are asserted EXACTLY on both
 * sides, so they fail too when either implementation moves.
 */
function pinShapes(label, uiTask, mcpTask, divergences = {}) {
  const keys = [...new Set([
    ...Object.keys(uiTask), ...Object.keys(mcpTask), ...Object.keys(divergences),
  ])].sort();
  for (const key of keys) {
    const uiVal = Object.prototype.hasOwnProperty.call(uiTask, key) ? uiTask[key] : ABSENT;
    const mcpVal = Object.prototype.hasOwnProperty.call(mcpTask, key) ? mcpTask[key] : ABSENT;
    const d = divergences[key];
    if (d) {
      expect(uiVal, `${label}: documented divergence on "${key}" (${d.why}) - the UI side moved`).toEqual(d.ui);
      expect(mcpVal, `${label}: documented divergence on "${key}" (${d.why}) - the taskMutations side moved`).toEqual(d.mcp);
    } else {
      expect(mcpVal,
        `${label}: field "${key}" diverged - UI wrote ${JSON.stringify(uiVal)}, taskMutations wrote ${JSON.stringify(mcpVal)}. ` +
        'If this difference is intentional, add it to this pin\'s documented divergences with a why',
      ).toEqual(uiVal);
    }
  }
}

/** Run a list of captured functional updaters against a starting array. */
const applyUpdaters = (updaters, prev) =>
  updaters.reduce((acc, u) => (typeof u === 'function' ? u(acc) : u), prev);

function capture() {
  const calls = { tasks: [], unscheduled: [], recurring: [] };
  return {
    calls,
    setTasks: (u) => calls.tasks.push(u),
    setUnscheduledTasks: (u) => calls.unscheduled.push(u),
    setRecurringTasks: (u) => calls.recurring.push(u),
  };
}

// Conflict adjuster stubbed to identity: the pin covers the write shape of an
// unadjusted gesture. MCP takes exact times by design (no adjustment at all),
// which is a documented behavioral divergence, not a shape one.
const identityAdjust = (id, requested) =>
  ({ conflicted: false, adjustedStartTime: requested, conflictingEvent: null });

// All onboarding flags set so the handlers skip their onboarding writes.
const ONBOARDED = {
  hasDraggedToTimeline: true, hasCompletedTask: true, hasAddedInboxTask: true,
  hasAddedScheduledTask: true, hasUsedTags: true, hasCreatedRecurring: true,
  hasUsedActionButtons: true,
};

function useTaskActionsSetup(over = {}) {
  const cap = capture();
  const deps = {
    tasks: [], setTasks: cap.setTasks,
    unscheduledTasks: [], setUnscheduledTasks: cap.setUnscheduledTasks,
    recurringTasks: [], setRecurringTasks: cap.setRecurringTasks,
    recycleBin: [], setRecycleBin: vi.fn(),
    completedTaskUids: new Set(), setCompletedTaskUids: vi.fn(),
    selectedDate: NOW,
    onboardingProgress: ONBOARDED, setOnboardingProgress: vi.fn(),
    pushUndo: vi.fn(), playUISound: vi.fn(),
    // App.jsx's parseRecurringId lives inside the App component and is not
    // importable; taskMutations.parseRecurringInstanceId is its documented
    // mirror. The recurring pin therefore covers the WRITE SHAPE given an
    // agreed parse, not the parse itself.
    parseRecurringId: parseRecurringInstanceId,
    getAdjustedTimeForImportedConflicts: identityAdjust,
    newTask: {}, setNewTask: vi.fn(),
    setShowAddTask: vi.fn(), setShowRecurrencePicker: vi.fn(),
    expandedNotesTaskId: null, setExpandedNotesTaskId: vi.fn(),
    setSyncNotification: vi.fn(), setUndoToast: vi.fn(),
    setShowColorPicker: vi.fn(), setShowDeadlinePicker: vi.fn(),
    recurringDeleteConfirm: null, setRecurringDeleteConfirm: vi.fn(),
    hoverPreviewTime: null, hoverPreviewDate: null,
    setHoverPreviewTime: vi.fn(), setHoverPreviewDate: vi.fn(),
    swipeSchedulingInboxTaskId: { current: null },
    syncTaskCompletionToCalDAV: vi.fn(),
    computeAvailableSlots: vi.fn(),
    activeFrameNudgeKey: null, setFrameNudgeDismissedKey: vi.fn(),
    frameScheduleModal: null, setFrameScheduleModal: vi.fn(),
    focusBlockTasks: [], setFocusBlockTasks: vi.fn(),
    focusCompletedTasks: new Set(), setFocusCompletedTasks: vi.fn(),
    exitFocusModeRef: { current: null }, playFocusSound: vi.fn(),
    getObsidianTaskMeta: undefined, onWriteObsidianTask: undefined,
    ...over,
  };
  return { cap, actions: useTaskActions(deps), deps };
}

function dragDropSetup(over = {}) {
  const cap = capture();
  const deps = {
    calendarRef: { current: null }, timeGridRef: { current: null },
    setNewTask: vi.fn(), setShowAddTask: vi.fn(), selectedDate: NOW,
    setExpandedNotesTaskId: vi.fn(),
    tasks: [], setTasks: cap.setTasks, setUnscheduledTasks: cap.setUnscheduledTasks,
    setRecurringTasks: cap.setRecurringTasks, setRecycleBin: vi.fn(), setTodayRoutines: vi.fn(),
    pushUndo: vi.fn(), parseRecurringId: parseRecurringInstanceId,
    getAdjustedTimeForImportedConflicts: identityAdjust,
    wouldExceedMaxColumns: () => false,
    playUISound: vi.fn(), setSyncNotification: vi.fn(),
    onboardingProgress: ONBOARDED, setOnboardingProgress: vi.fn(),
    moveToRecycleBinRef: { current: null }, clearDeadlineRef: { current: null },
    gtdFrames: [], setGtdFrames: vi.fn(),
    unscheduledTasks: [], setMobileEditingTask: vi.fn(),
    expandedRecurringTasksRef: { current: [] }, moveToInboxRef: { current: null },
    openMobileEditTaskRef: { current: null }, openMobileEditNativeEventRef: { current: null },
    ...over,
  };
  const useRender = () => { hookCursor = { state: 0, ref: 0 }; return useDragDrop(deps); };
  return { cap, render: useRender, deps };
}

/** Drive the real drag lifecycle: render, dragStart, re-render, drop. */
function dragAndDrop({ task, source, targetDate, overrideTime, header = false, depsOver = {} }) {
  const { cap, render } = dragDropSetup(depsOver);
  let dd = render();
  dd.handleDragStart(task, source, { dataTransfer: {} });
  dd = render(); // second render: handlers close over the updated drag state
  if (header) dd.handleDropOnDateHeader({ preventDefault() {} }, targetDate);
  else dd.handleDropOnCalendar({ preventDefault() {} }, targetDate, overrideTime);
  return cap;
}

const inboxTaskFixture = () => ({
  id: 't-inbox', title: 'Deadline task', duration: 45, color: 'bg-green-500',
  completed: false, isAllDay: false, notes: 'keep these notes', subtasks: [{ id: 's1', title: 'sub', done: false }],
  priority: 1, deadline: '2026-08-22',
});

const blockFixture = (over = {}) => ({
  id: 'b1', title: 'Block', date: TODAY_STR, startTime: '09:00', duration: 60,
  color: 'bg-red-500', completed: false, isAllDay: false, notes: '', subtasks: [],
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(UUID);
  stateCells.length = 0;
  refCells.length = 0;
  capturedEffects.length = 0;
  for (const k of Object.keys(docListeners)) delete docListeners[k];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── CREATE ──────────────────────────────────────────────────────────────────
// Cited source: useTaskActions.js addTask, inbox branch and scheduled branch.

describe('create pin: applyCreateTask vs addTask', () => {
  const newTaskFor = (over = {}) => ({
    title: 'Write the report', duration: 45, color: '', startTime: '09:00',
    date: TODAY_STR, isAllDay: false, recurrence: null, keepUnscheduled: false,
    priority: 2, deadline: '2026-08-20', nlSpans: undefined,
    ...over,
  });

  it('inbox create: same shape, with the documented id/lastModified divergences', () => {
    const { cap, actions } = useTaskActionsSetup({ newTask: newTaskFor() });
    actions.addTask(true);
    const uiTask = applyUpdaters(cap.calls.unscheduled, [])[0];

    const res = applyCreateTask({ unscheduledTasks: [], tasks: [] }, {
      taskId: UUID, title: 'Write the report', durationMinutes: 45,
      priority: 2, deadline: '2026-08-20', nowIso: NOW_ISO,
    });
    expect(res.ok).toBe(true);

    // id agrees here only because crypto.randomUUID is pinned: the UI mints a
    // random id, MCP derives a deterministic one from its idempotency key.
    pinShapes('create(inbox)', uiTask, res.task, {
      lastModified: {
        ui: ABSENT, mcp: NOW_ISO,
        why: 'MCP stamps lastModified explicitly; the UI leaves inbox creates to the save pass (stampTaskTimestamps)',
      },
    });
  });

  it('inbox create defaults: priority 0 and no deadline key on both sides', () => {
    const { cap, actions } = useTaskActionsSetup({
      newTask: newTaskFor({ priority: undefined, deadline: null }),
    });
    actions.addTask(true);
    const uiTask = applyUpdaters(cap.calls.unscheduled, [])[0];

    const res = applyCreateTask({ unscheduledTasks: [], tasks: [] }, {
      taskId: UUID, title: 'Write the report', durationMinutes: 45, nowIso: NOW_ISO,
    });
    pinShapes('create(inbox defaults)', uiTask, res.task, {
      lastModified: { ui: ABSENT, mcp: NOW_ISO, why: 'save pass vs explicit stamp, as above' },
    });
    expect(res.task.priority, 'MCP priority default drifted from the UI\'s ?? 0').toBe(0);
    expect(uiTask.priority, 'UI priority default drifted from ?? 0').toBe(0);
  });

  it('scheduled create: same shape (UI conflict auto-adjust stubbed to identity; MCP takes exact times by design)', () => {
    const { cap, actions } = useTaskActionsSetup({ newTask: newTaskFor() });
    actions.addTask(false);
    const uiTask = applyUpdaters(cap.calls.tasks, [])[0];

    const res = applyCreateTask({ unscheduledTasks: [], tasks: [] }, {
      taskId: UUID, title: 'Write the report',
      schedule: { date: TODAY_STR, startTime: '09:00', durationMinutes: 45, allDay: false },
      nowIso: NOW_ISO,
    });

    pinShapes('create(scheduled)', uiTask, res.task, {
      lastModified: {
        ui: ABSENT, mcp: NOW_ISO,
        why: 'MCP stamps lastModified explicitly; the UI leaves scheduled creates to the save pass',
      },
    });
  });

  it('all-day create: both store startTime 00:00 with isAllDay true', () => {
    const { cap, actions } = useTaskActionsSetup({ newTask: newTaskFor({ isAllDay: true, startTime: '13:00' }) });
    actions.addTask(false);
    const uiTask = applyUpdaters(cap.calls.tasks, [])[0];
    expect(uiTask.startTime, 'UI all-day create no longer stores startTime 00:00').toBe('00:00');

    const res = applyCreateTask({ unscheduledTasks: [], tasks: [] }, {
      taskId: UUID, title: 'Write the report',
      schedule: { date: TODAY_STR, startTime: '00:00', durationMinutes: 45, allDay: true },
      nowIso: NOW_ISO,
    });
    pinShapes('create(all-day)', uiTask, res.task, {
      lastModified: { ui: ABSENT, mcp: NOW_ISO, why: 'save pass vs explicit stamp, as above' },
    });
  });

  it('documented divergence: UI strips sigils via cleanTitle, MCP trims verbatim', () => {
    const { cap, actions } = useTaskActionsSetup({ newTask: newTaskFor({ title: '  Pay rent $fri  ' }) });
    actions.addTask(true);
    const uiTask = applyUpdaters(cap.calls.unscheduled, [])[0];
    expect(uiTask.title, 'UI title pipeline (stripSpans + cleanTitle) stopped stripping sigil text').toBe('Pay rent');

    const res = applyCreateTask({ unscheduledTasks: [], tasks: [] }, {
      taskId: UUID, title: '  Pay rent $fri  ', nowIso: NOW_ISO,
    });
    expect(res.task.title,
      'MCP title handling changed: an agent writing "$fri" means the literal text (documented in taskMutations.js)',
    ).toBe('Pay rent $fri');
  });

  it('documented divergence: MCP stamps transitionId when given one; addTask never does', () => {
    const { cap, actions } = useTaskActionsSetup({ newTask: newTaskFor() });
    actions.addTask(true);
    const uiTask = applyUpdaters(cap.calls.unscheduled, [])[0];
    expect('transitionId' in uiTask, 'addTask started stamping transitionId; update this pin and taskMutations').toBe(false);

    const res = applyCreateTask({ unscheduledTasks: [], tasks: [] }, {
      taskId: UUID, title: 'Write the report', transitionId: 'tx-1', nowIso: NOW_ISO,
    });
    expect(res.task.transitionId).toBe('tx-1');
  });
});

// ── SCHEDULE ────────────────────────────────────────────────────────────────
// Cited (canonical) source: useTaskActions.js scheduleDeadlineTaskAt. The
// second UI source, useDragDrop's inbox-drop branch, already disagrees with
// it; both comparisons are pinned. See the file header.

describe('schedule pin: applyScheduleTask vs scheduleDeadlineTaskAt (canonical) and the inbox drop', () => {
  it('matches scheduleDeadlineTaskAt exactly: strip priority/deadline, stamp lastModified', () => {
    // isAllDay: true origin so the explicit isAllDay: false write is
    // observable on both sides (a false origin would mask its removal).
    const inboxTask = { ...inboxTaskFixture(), isAllDay: true };
    const { cap, actions } = useTaskActionsSetup({ unscheduledTasks: [inboxTask] });
    actions.scheduleDeadlineTaskAt('t-inbox', '2026-08-20', '10:00');
    const uiTask = applyUpdaters(cap.calls.tasks, [])[0];
    expect(applyUpdaters(cap.calls.unscheduled, [inboxTask]), 'UI stopped removing the scheduled task from the inbox').toEqual([]);

    const res = applyScheduleTask({ unscheduledTasks: [inboxTask], tasks: [] }, {
      taskId: 't-inbox', date: '2026-08-20', startTime: '10:00', nowIso: NOW_ISO,
    });
    expect(res.unscheduledTasks, 'MCP stopped removing the scheduled task from the inbox').toEqual([]);

    pinShapes('schedule(vs scheduleDeadlineTaskAt)', uiTask, res.task, {});
  });

  it('matches the inbox-drop branch except the documented lastModified stamp', () => {
    const inboxTask = { ...inboxTaskFixture(), isAllDay: true };
    const cap = dragAndDrop({
      task: inboxTask, source: 'inbox',
      targetDate: new Date(2026, 7, 20), overrideTime: '10:00',
      depsOver: { unscheduledTasks: [inboxTask] },
    });
    const uiTask = applyUpdaters(cap.calls.tasks, [])[0];

    const res = applyScheduleTask({ unscheduledTasks: [inboxTask], tasks: [] }, {
      taskId: 't-inbox', date: '2026-08-20', startTime: '10:00', nowIso: NOW_ISO,
    });

    pinShapes('schedule(vs inbox drop)', uiTask, res.task, {
      lastModified: {
        ui: ABSENT, mcp: NOW_ISO,
        why: 'applyScheduleTask follows its canonical source scheduleDeadlineTaskAt, which stamps lastModified; ' +
             'the drop branch leaves it to the save pass',
      },
    });
  });

  it('duration 0: the || vs ?? split is real, pinned as-is', () => {
    // scheduleDeadlineTaskAt: task.duration || 30 -> a 0 becomes 30.
    // applyScheduleTask: durationMinutes ?? task.duration ?? 30 -> a 0 stays 0.
    // The inbox drop spreads duration verbatim -> 0 stays 0.
    // So at duration 0, MCP matches the drop branch, NOT its cited source. No
    // UI flow creates a duration-0 inbox task today; if one appears, decide
    // which behavior is right and collapse this three-way split.
    const zeroTask = { ...inboxTaskFixture(), duration: 0 };

    const { cap: uiCap, actions } = useTaskActionsSetup({ unscheduledTasks: [zeroTask] });
    actions.scheduleDeadlineTaskAt('t-inbox', '2026-08-20', '10:00');
    expect(applyUpdaters(uiCap.calls.tasks, [])[0].duration,
      'scheduleDeadlineTaskAt no longer applies its || 30 fallback at duration 0').toBe(30);

    const dropCap = dragAndDrop({
      task: zeroTask, source: 'inbox',
      targetDate: new Date(2026, 7, 20), overrideTime: '10:00',
      depsOver: { unscheduledTasks: [zeroTask] },
    });
    expect(applyUpdaters(dropCap.calls.tasks, [])[0].duration,
      'the inbox drop no longer preserves duration verbatim').toBe(0);

    const res = applyScheduleTask({ unscheduledTasks: [zeroTask], tasks: [] }, {
      taskId: 't-inbox', date: '2026-08-20', startTime: '10:00', nowIso: NOW_ISO,
    });
    expect(res.task.duration,
      'applyScheduleTask changed its ?? fallback behavior at duration 0').toBe(0);
  });

  it('documented divergence: MCP stamps transitionId; the deadline path predates it', () => {
    const inboxTask = inboxTaskFixture();
    const { cap, actions } = useTaskActionsSetup({ unscheduledTasks: [inboxTask] });
    actions.scheduleDeadlineTaskAt('t-inbox', '2026-08-20', '10:00');
    const uiTask = applyUpdaters(cap.calls.tasks, [])[0];
    expect('transitionId' in uiTask, 'scheduleDeadlineTaskAt started stamping transitionId; update this pin').toBe(false);

    const res = applyScheduleTask({ unscheduledTasks: [inboxTask], tasks: [] }, {
      taskId: 't-inbox', date: '2026-08-20', startTime: '10:00', transitionId: 'tx-2', nowIso: NOW_ISO,
    });
    expect(res.task.transitionId).toBe('tx-2');
  });
});

// ── MOVE ────────────────────────────────────────────────────────────────────
// Cited source: useDragDrop.js handleDropOnCalendar, calendar branch (the
// canonical drop shape: { ...t, startTime, date, isAllDay: false,
// transitionId }). Both sides leave lastModified to the save pass.

describe('move pin: applyMoveBlock vs the canonical drop shape', () => {
  it('timed drop of an all-day block: identical shape, including transitionId and no lastModified', () => {
    // An all-day-origin block makes the isAllDay: false write observable on
    // both sides (a timed-origin block would mask its removal).
    const block = blockFixture({ isAllDay: true, startTime: '00:00' });
    const cap = dragAndDrop({
      task: block, source: 'calendar',
      targetDate: new Date(2026, 7, 20), overrideTime: '11:30',
      depsOver: { tasks: [block] },
    });
    const uiTask = applyUpdaters(cap.calls.tasks, [block])[0];

    const res = applyMoveBlock({ tasks: [block] }, {
      blockId: 'b1', date: '2026-08-20', startTime: '11:30', transitionId: UUID,
    });

    pinShapes('move', uiTask, res.task, {});
  });

  it('the all-day move (date-header drop) has no MCP counterpart: move_block always writes timed', () => {
    const block = blockFixture();
    const cap = dragAndDrop({
      task: block, source: 'calendar',
      targetDate: new Date(2026, 7, 20), header: true,
      depsOver: { tasks: [block] },
    });
    const uiTask = applyUpdaters(cap.calls.tasks, [block])[0];
    // Pin the header shape itself so a change there is noticed even though
    // MCP cannot produce it.
    expect(uiTask, 'the date-header drop shape changed; move_block deliberately has no all-day variant, ' +
      'but this pin keeps the header shape visible').toEqual({
      ...block, startTime: '00:00', date: '2026-08-20', isAllDay: true, transitionId: UUID,
    });

    const res = applyMoveBlock({ tasks: [block] }, {
      blockId: 'b1', date: '2026-08-20', startTime: '00:00', transitionId: UUID,
    });
    expect(res.task.isAllDay, 'applyMoveBlock stopped forcing isAllDay: false').toBe(false);
  });
});

// ── RESIZE ──────────────────────────────────────────────────────────────────
// Cited source: useDragDrop.js handleResizeStart's mousemove write
// ({ ...t, duration }). The real snapping math runs: +80px = +60 minutes.
// The UI's 15-minute floor lives in the delta math and MCP's minimum in tool
// layer validation, so neither is part of the written shape.

describe('resize pin: applyResizeBlock vs the resize-loop write', () => {
  function uiResize(block, deltaPx) {
    const { cap, render } = dragDropSetup({ tasks: [block] });
    const dd = render();
    dd.handleResizeStart(block, { stopPropagation() {}, preventDefault() {}, clientY: 100 });
    const mousemove = docListeners.mousemove.at(-1);
    mousemove({ clientY: 100 + deltaPx });
    docListeners.mouseup.at(-1)(); // real cleanup path (no nativeEventId, so no device-calendar sync)
    return applyUpdaters(cap.calls.tasks, [block])[0];
  }

  it('same shape for the same final duration (no transitionId passed)', () => {
    const block = blockFixture();
    const uiTask = uiResize(block, 80); // 60 -> 120 minutes through the real snap math
    expect(uiTask.duration, 'the resize snap math changed (80px no longer means +60 minutes)').toBe(120);

    const res = applyResizeBlock({ tasks: [block] }, { blockId: 'b1', durationMinutes: 120 });
    pinShapes('resize', uiTask, res.task, {});
  });

  it('documented divergence: MCP stamps transitionId; the UI resize does not', () => {
    const block = blockFixture();
    const uiTask = uiResize(block, 80);
    expect('transitionId' in uiTask, 'the resize write started stamping transitionId; update this pin and taskMutations').toBe(false);

    const res = applyResizeBlock({ tasks: [block] }, { blockId: 'b1', durationMinutes: 120, transitionId: 'tx-3' });
    expect(res.task.transitionId).toBe('tx-3');
  });
});

// ── COMPLETION ──────────────────────────────────────────────────────────────
// Cited source: useTaskActions.js toggleComplete's three branches. MCP is a
// SETTER rather than a toggle (documented, spec 5.1), so each pin drives the
// toggle from the state whose flip equals the set.

describe('completion pin: applySetCompletion vs toggleComplete', () => {
  it('inbox complete: completed + completedAt(local-offset ISO datetime) + transitionId', () => {
    // completedAt was a bare YYYY-MM-DD here for years; the completion-
    // timestamp feature upgraded NEW stamps to full local-offset ISO
    // datetimes on both branches (historical bare dates stay as they are).
    const inboxTask = { ...inboxTaskFixture(), completed: false };
    const { cap, actions } = useTaskActionsSetup({ unscheduledTasks: [inboxTask] });
    actions.toggleComplete('t-inbox', true);
    const uiTask = applyUpdaters(cap.calls.unscheduled, [inboxTask])[0];
    expect(uiTask.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

    const res = applySetCompletion({ unscheduledTasks: [inboxTask], tasks: [] }, {
      taskId: 't-inbox', completed: true, transitionId: UUID, nowIso: NOW_ISO,
    });
    pinShapes('completion(inbox, complete)', uiTask, res.task, {});
  });

  it('inbox un-complete: completedAt cleared to null on both sides', () => {
    const inboxTask = { ...inboxTaskFixture(), completed: true, completedAt: '2026-08-10' };
    const { cap, actions } = useTaskActionsSetup({ unscheduledTasks: [inboxTask] });
    actions.toggleComplete('t-inbox', true);
    const uiTask = applyUpdaters(cap.calls.unscheduled, [inboxTask])[0];

    const res = applySetCompletion({ unscheduledTasks: [inboxTask], tasks: [] }, {
      taskId: 't-inbox', completed: false, transitionId: UUID, todayStr: TODAY_STR, nowIso: NOW_ISO,
    });
    pinShapes('completion(inbox, un-complete)', uiTask, res.task, {});
  });

  it('scheduled complete: completed + completedAt(ISO datetime) + transitionId — the completion-timestamp contract flip', () => {
    // FLIPPED PIN (deliberate, Obsidian completion timestamps): for years the
    // scheduled branch wrote NO completedAt and this test asserted the
    // absence. The marker feature requires the app to record what it writes
    // to the vault, so BOTH branches now stamp a full local-offset ISO
    // datetime. This pin now fails loudly if either side stops.
    const block = blockFixture();
    const { cap, actions } = useTaskActionsSetup({ tasks: [block] });
    actions.toggleComplete('b1', false);
    const uiTask = applyUpdaters(cap.calls.tasks, [block])[0];
    expect(uiTask.completedAt,
      'the scheduled toggleComplete branch stopped writing completedAt; the Obsidian completion marker regenerates from it')
      .toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);

    const res = applySetCompletion({ unscheduledTasks: [], tasks: [block] }, {
      taskId: 'b1', completed: true, transitionId: UUID, nowIso: NOW_ISO,
    });
    pinShapes('completion(scheduled)', uiTask, res.task, {});
  });

  it('recurring instance: completedDates membership + per-date timestamp + lastModified on the template', () => {
    const template = {
      id: 7, title: 'Standup', startTime: '09:30', duration: 15, color: 'bg-blue-500',
      recurrence: { type: 'daily' }, completedDates: ['2026-08-14'],
      completedDatesTimestamps: { '2026-08-14': '2026-08-14T09:31:00.000Z' },
    };
    const instanceId = `recurring-7-${TODAY_STR}`;

    const { cap, actions } = useTaskActionsSetup({ recurringTasks: [template] });
    actions.toggleComplete(instanceId);
    const uiTemplate = applyUpdaters(cap.calls.recurring, [template])[0];

    const res = applySetCompletion({ unscheduledTasks: [], tasks: [], recurringTasks: [template] }, {
      taskId: instanceId, completed: true, transitionId: UUID, todayStr: TODAY_STR, nowIso: NOW_ISO,
    });
    pinShapes('completion(recurring)', uiTemplate, res.recurringTasks[0], {});
  });

  it('documented divergence: CalDAV task-calendar tasks are flipped+synced by the UI, rejected by MCP', () => {
    const caldavTask = blockFixture({ id: 'c1', isTaskCalendar: true, icalUid: 'uid-1' });
    const syncSpy = vi.fn();
    const { cap, actions } = useTaskActionsSetup({ tasks: [caldavTask], syncTaskCompletionToCalDAV: syncSpy });
    actions.toggleComplete('c1', false);
    expect(syncSpy, 'the UI stopped pairing the CalDAV flip with the network write; ' +
      'if that pairing is gone, applySetCompletion\'s rejection rationale needs revisiting').toHaveBeenCalledTimes(1);
    expect(applyUpdaters(cap.calls.tasks, [caldavTask])[0].completed).toBe(true);

    const res = applySetCompletion({ unscheduledTasks: [], tasks: [caldavTask] }, {
      taskId: 'c1', completed: true, todayStr: TODAY_STR, nowIso: NOW_ISO,
    });
    expect(res.ok, 'applySetCompletion started accepting CalDAV tasks; the pure module cannot do the network half').toBe(false);
    expect(res.error.code).toBe(WRITE_ERROR_CODES.VALIDATION);
  });
});

// Out of scope, noted for the record: the mobile long-press deadline drop
// (useDragDrop.js handleMobileLongPressEnd, isDeadlineDrag branch) REBUILDS
// the task from an explicit field whitelist instead of spreading, so it
// already diverges from the desktop inbox-drop (it drops fields like
// projectId and assignedUserSyncIds). That is a UI-vs-UI inconsistency, not
// an MCP drift, and is not pinned here.
