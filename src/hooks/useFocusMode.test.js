import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFocusSession } from '../jobo/focusSession.js';

// The real hook and native polling, with React's state/effect slots driven
// explicitly. Timer commands, including batched commands, cross the actual
// synchronous boundary rather than a test-only approximation of the timer.
let slots, cursor, effects, queued;
vi.mock('react', () => ({
  useState: init => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
    return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }];
  },
  useRef: init => { const i = cursor++; return slots[i] ??= { current: init }; },
  useCallback: fn => fn,
  useEffect: (fn, deps) => {
    const i = cursor++, previous = effects[i];
    if (!previous || deps.some((value, index) => value !== previous.deps[index])) {
      queued.push(() => { previous?.cleanup?.(); effects[i] = { deps, cleanup: fn() }; });
    }
  },
}));
const native = vi.hoisted(() => ({ android: false, action: null, show: vi.fn(), dismiss: vi.fn() }));
vi.mock('../native.js', () => ({
  isNativeAndroid: () => native.android,
  nativeShowFocusTimerNotification: (...args) => native.show(...args),
  nativeDismissFocusTimerNotification: (...args) => native.dismiss(...args),
  nativeGetFocusPendingAction: () => { const action = native.action; native.action = null; return action; },
}));
const { default: useFocusMode } = await import('./useFocusMode.js');
const task = { id: 'a', title: 'Task', date: '2026-10-09', startTime: '09:00', duration: 25 };
let hook, session, review, recordJobo;
function useRenderedHook() {
  cursor = 0; queued = [];
  hook = useFocusMode({ onTimerTransition: event => session.transition(event) });
  queued.forEach(effect => effect());
}
function useStartedHook() {
  session.begin([task]);
  hook.setShowFocusMode(true); hook.setFocusShowSettings(false);
  hook.setFocusTimerSeconds(1500); hook.setFocusTimerRunning(true); useRenderedHook();
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T09:00:00Z'));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() });
  slots = []; effects = []; native.android = false; native.action = null;
  native.show.mockClear(); native.dismiss.mockClear();
  recordJobo = vi.fn(async () => ({ ok: true }));
  session = createFocusSession({ getState: () => ({ enabled: true, loaded: true, writable: true, records: [], resolveBlock: block => block, recordJobo, complete: vi.fn() }),
    publish: value => { review = value; }, makeId: () => 'test' });
  useRenderedHook();
});
afterEach(() => { effects.forEach(effect => effect?.cleanup?.()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Focus timer command boundary', () => {
  it('batched pause/resume closes two real spans, without a pause settlement', async () => {
    useStartedHook();
    vi.setSystemTime(new Date('2026-10-09T09:01:00Z')); hook.setFocusTimerRunning(false);
    vi.setSystemTime(new Date('2026-10-09T09:03:00Z')); hook.setFocusTimerRunning(true);
    vi.setSystemTime(new Date('2026-10-09T09:04:00Z')); hook.setFocusTimerRunning(false);
    expect(review).toBeNull(); session.settle(vi.fn()); await session.save('a', false);
    expect(recordJobo.mock.calls[0][0].map(row => [row.startTime, row.endTime])).toEqual([['09:00', '09:01'], ['09:03', '09:04']]);
  });
  it('Android notification pause/resume/stop passes through the same capture boundary', async () => {
    native.android = true; useStartedHook();
    hook.exitFocusModeRef.current = () => { hook.setFocusTimerRunning(false); session.settle(vi.fn()); };
    vi.setSystemTime(new Date('2026-10-09T09:01:00Z'));
    native.action = 'focus-pause'; await vi.advanceTimersByTimeAsync(500); useRenderedHook();
    vi.setSystemTime(new Date('2026-10-09T09:02:00Z'));
    native.action = 'focus-resume'; await vi.advanceTimersByTimeAsync(500); useRenderedHook();
    vi.setSystemTime(new Date('2026-10-09T09:04:00Z'));
    native.action = 'focus-stop'; await vi.advanceTimersByTimeAsync(500); useRenderedHook();
    expect(review.capture.segments).toHaveLength(2);
    native.action = 'focus-resume'; await vi.advanceTimersByTimeAsync(500); useRenderedHook();
    expect(hook.focusTimerRunning).toBe(false);
    await session.save('a', false);
    expect(recordJobo.mock.calls[0][0].map(row => [row.startTime, row.endTime])).toEqual([['09:00', '09:01'], ['09:02', '09:04']]);
  });
  it('timer expiry closes work before calling the real end-handler ref', async () => {
    useStartedHook();
    hook.handleFocusTimerEndRef.current = () => session.settle(vi.fn());
    vi.setSystemTime(new Date('2026-10-09T09:25:00Z'));
    hook.setFocusTimerSeconds(0); useRenderedHook(); useRenderedHook();
    expect(hook.focusTimerRunning).toBe(false);
    expect(review.summary.recordedMinutes).toBe(25);
    await session.save('a', false);
    expect(recordJobo.mock.calls[0][0][0].endTime).toBe('09:25');
  });
  it('break-to-work and functional toggles use the current synchronous phase', async () => {
    useStartedHook();
    vi.setSystemTime(new Date('2026-10-09T09:01:00Z'));
    hook.setFocusTimerRunning(previous => !previous); session.settle(vi.fn()); await session.save('a', false);
    hook.setFocusPhase('shortBreak'); hook.setFocusTimerRunning(true);
    vi.setSystemTime(new Date('2026-10-09T09:06:00Z')); hook.setFocusPhase('work');
    vi.setSystemTime(new Date('2026-10-09T09:07:00Z')); hook.setFocusTimerRunning(previous => !previous);
    session.settle(vi.fn()); await session.save('a', false);
    expect(recordJobo.mock.calls[1][0][0]).toMatchObject({ startTime: '09:06', endTime: '09:07' });
  });
});
