import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { createFocusSession } from './focusSession.js';

// Execute the real App boundary callbacks with render-local state snapshots.
// This covers the App/controller seam without replacing the legacy algorithms.
const source = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.jsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
const names = ['enterFocusMode', 'startFocusTimer', 'captureFocusBoundary', 'exitFocusMode', 'finishExitFocusMode', 'dismissFocusStats', 'skipFocusPhase', 'advanceFocusPhase', 'advanceFocusTimerEnd', 'handleFocusTimerEnd'];
const callbacks = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && names.includes(node.name.getText(ast))) callbacks[node.name.getText(ast)] = node.initializer.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
const start = Date.parse('2026-10-09T09:00:00Z');
const NativeDate = Date;
function setup(ids = ['a'], enabled = true) {
  let now = start, review = null, scope;
  class ClockDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const d = { Date: ClockDate, joboEnabled: enabled, showFocusMode: true, focusShowSettings: false, focusShowStats: false,
    focusEndedRef: { current: false }, focusExitBoundaryRef: { current: null }, focusPhase: 'work', focusTimerRunning: true,
    focusTimerSeconds: 1500, focusWorkMinutes: 25, focusBreakMinutes: 5, focusLongBreakMinutes: 15,
    focusCycleCount: 0, focusSessionStart: new ClockDate(), focusCompletedTasks: new Set(), focusTaskMinutes: {}, focusLog: {},
    focusTimerRef: { current: null }, wakeLockSentinel: { current: null }, FOCUS_SPANS_PER_DAY: 60,
    clearInterval() {}, playFocusSound() {}, triggerHaptic() {}, nativeExitFocusMode() {}, nativeEnterFocusMode() {},
    document: { documentElement: {} }, navigator: {}, onboardingProgress: { hasUsedFocusMode: true },
    dateToString: date => date.toISOString().slice(0, 10),
  };
  d.tasks = ids.map(id => ({ id, title: id, date: '2026-10-09', startTime: '09:00', duration: 60, completed: false, focusMinutes: 0 }));
  d.focusBlockTasks = d.tasks;
  d.computeFocusBlockTasks = d.getTasksForDate = () => d.tasks;
  for (const key of ['Tasks', 'FocusBlockTasks', 'ShowFocusMode', 'FocusShowSettings', 'FocusShowStats', 'FocusSessionStart', 'FocusCompletedTasks', 'FocusTaskMinutes', 'FocusLog', 'FocusTimerSeconds', 'FocusCycleCount', 'FocusWorkMinutes', 'FocusBreakMinutes', 'FocusLongBreakMinutes']) {
    const field = key[0].toLowerCase() + key.slice(1);
    d[`set${key}`] = value => { d[field] = typeof value === 'function' ? value(d[field]) : value; };
  }
  const complete = id => {
    d.tasks = d.tasks.map(task => task.id === id ? { ...task, completed: true } : task);
    d.focusCompletedTasks = new Set([...d.focusCompletedTasks, id]);
    return { allCompleted: d.focusBlockTasks.every(task => task.completed || d.focusCompletedTasks.has(task.id)), completedActionId: id };
  };
  const records = [];
  const state = { enabled, loaded: true, writable: true, records, resolveBlock: block => block, complete,
    recordJobo: async rows => { records.push(...rows); return { ok: true }; } };
  const session = createFocusSession({ getState: () => state, publish: value => { review = value; }, makeId: () => 's', now: () => now });
  d.focusDoRef = { current: session };
  for (const [field, setter] of [['phase', 'setFocusPhase'], ['running', 'setFocusTimerRunning']]) {
    d[setter] = value => {
      const before = { phase: d.focusPhase, running: d.focusTimerRunning }, after = { ...before, [field]: value };
      if (session.transition({ before, after, at: now }) !== false) d[field === 'phase' ? 'focusPhase' : 'focusTimerRunning'] = value;
    };
  }
  function render() {
    scope = { ...d };
    for (const [name, expression] of Object.entries(callbacks)) scope[name] = new Function('deps', `with(deps){return (${expression});}`)(scope);
  }
  session.begin(d.focusBlockTasks);
  session.transition({ before: { phase: 'work', running: false }, after: { phase: 'work', running: true }, at: now });
  render();
  return { d, state, session, records, complete, review: () => review,
    at(minutes, seconds = 0) { now = start + minutes * 60000 + seconds * 1000; },
    call(name, ...args) { render(); return scope[name](...args); },
  };
}
const log = h => h.d.focusLog['2026-10-09'];
describe('Focus settlement preserves the legacy event boundary', () => {
  it('credits a naturally finished cycle before the single task is completed', async () => {
    const h = setup(); h.at(25); h.d.focusTimerSeconds = 0; h.call('handleFocusTimerEnd');
    h.at(30); await h.session.save('a', true);
    expect(h.d.tasks[0].focusMinutes).toBe(25);
    expect(h.d.focusTaskMinutes).toEqual({ a: 25 });
    expect(h.d.focusCycleCount).toBe(1);
    expect(log(h)).toMatchObject({ totalMinutes: 30, cyclesCompleted: 1, tasksCompleted: 1 });
  });
  it('retains the old equal split when the new review completes one of two tasks', async () => {
    const h = setup(['a', 'b']); h.at(25); h.d.focusTimerSeconds = 0; h.call('handleFocusTimerEnd');
    expect(h.d.focusTaskMinutes).toEqual({ a: 12.5, b: 12.5 });
    await h.session.save('b', true);
    expect(h.d.focusTaskMinutes).toEqual({ a: 12.5, b: 12.5 });
    expect(h.d.focusPhase).toBe('shortBreak'); expect(h.d.focusTimerRunning).toBe(true);
  });
  it.each([false, true])('freezes early-exit time and recipients before review (complete=%s)', async completed => {
    const h = setup(); h.at(10); h.d.focusTimerSeconds = 900; h.call('exitFocusMode');
    h.at(15); await h.session.save('a', completed);
    expect(h.d.tasks[0].focusMinutes).toBe(10);
    expect(log(h)).toMatchObject({ totalMinutes: 10, cyclesCompleted: 0, spans: [{ start: 540, end: 550 }] });
  });
  it('retains paused-exit legacy countdown minutes and wall-time log', async () => {
    const h = setup(); h.at(8); h.d.focusTimerSeconds = 1020; h.d.setFocusTimerRunning(false);
    h.at(10); h.call('exitFocusMode'); h.at(15); await h.session.save('a', false);
    expect(h.d.tasks[0].focusMinutes).toBe(8); expect(log(h).totalMinutes).toBe(10);
  });
  it('keeps the old skip cycle without inventing legacy focusMinutes', async () => {
    const h = setup(); h.at(10); h.d.focusTimerSeconds = 900; h.call('skipFocusPhase');
    h.at(15); await h.session.save('a', true);
    expect(h.d.tasks[0].focusMinutes).toBe(0); expect(h.d.focusCycleCount).toBe(1);
    expect(log(h)).toMatchObject({ totalMinutes: 15, cyclesCompleted: 1 });
  });
  it('a native exit during phase review uses that boundary without double credit', async () => {
    const h = setup(); h.at(25); h.d.focusTimerSeconds = 0; h.call('handleFocusTimerEnd');
    h.at(27); h.call('exitFocusMode', false); h.at(30); await h.session.save('a', true);
    expect(h.d.tasks[0].focusMinutes).toBe(25); expect(log(h)).toMatchObject({ totalMinutes: 27, sessions: 1, cyclesCompleted: 1 });
    expect(h.d.showFocusMode).toBe(false);
  });
  it('freezes the work duration when repeated native Stop follows a duration change', async () => {
    const h = setup(); h.at(10); h.d.focusTimerSeconds = 900; h.call('exitFocusMode');
    h.at(12); h.d.focusWorkMinutes = 30; h.call('exitFocusMode', false);
    h.at(15); await h.session.save('a', false);
    expect(h.d.tasks[0].focusMinutes).toBe(10);
    expect(log(h)).toMatchObject({ totalMinutes: 10, sessions: 1 });
  });
  it('does not rewrite the old work-in-progress completion-before-exit allocation', () => {
    const h = setup(); h.at(10); h.d.focusTimerSeconds = 900; h.complete('a');
    h.d.focusBlockTasks = h.d.tasks; h.state.enabled = false; h.call('exitFocusMode');
    expect(h.d.tasks[0].focusMinutes).toBe(0);
  });
  it('JOBO off keeps natural expiry, early exit, skip and repeat start semantics', () => {
    const expiry = setup(['a', 'b'], false); expiry.at(25); expiry.d.focusTimerSeconds = 0; expiry.call('handleFocusTimerEnd');
    expect(expiry.d.focusTaskMinutes).toEqual({ a: 12.5, b: 12.5 }); expect(expiry.d.focusCycleCount).toBe(1); expect(expiry.review()).toBeNull();
    const exit = setup(['a'], false); exit.at(10); exit.d.focusTimerSeconds = 900; exit.call('exitFocusMode');
    expect(exit.d.tasks[0].focusMinutes).toBe(10); expect(log(exit).totalMinutes).toBe(10);
    const skip = setup(['a'], false); skip.at(10); skip.d.focusTimerSeconds = 900; skip.call('skipFocusPhase');
    expect(skip.d.focusTaskMinutes).toEqual({}); expect(skip.d.focusCycleCount).toBe(1);
    const restart = setup(['a'], false); restart.at(10); restart.d.focusTimerSeconds = 900; restart.call('startFocusTimer');
    expect(restart.d.focusTimerSeconds).toBe(1500);
  });
});
