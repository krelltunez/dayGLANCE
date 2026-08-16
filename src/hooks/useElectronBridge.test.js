import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture what useElectronBridge passes to useEffect (house pattern, see
// useSaveOnChange.test.js) and run the effects by hand against a mocked
// window.electronAPI. The payload build itself is covered in
// utils/streamDeckPayload.test.js; here we cover the wiring the hook kept:
// the tray-mode guards, the build -> badge -> push sequence, and the
// background-action listener the tray ack relay depends on.

const captured = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { captured.push({ fn, deps }); },
  useRef: (init) => ({ current: init }),
  useState: (init) => [init, vi.fn()],
}));

// Getter so each test can flip tray mode; the hook reads it inside effect
// bodies, which run after the flag is set.
let trayMode = false;
vi.mock('../utils/trayMode.js', () => ({ get isTrayMode() { return trayMode; } }));

const buildSpy = vi.fn(() => ({ payload: { fake: true }, badgeCount: 2 }));
vi.mock('../utils/streamDeckPayload.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildStreamDeckState: (...args) => buildSpy(...args) };
});

const { default: useElectronBridge } = await import('./useElectronBridge.js');

let api;
beforeEach(() => {
  trayMode = false;
  buildSpy.mockClear();
  api = {
    onCommand: vi.fn(() => () => {}),
    onBackgroundAction: vi.fn(() => () => {}),
    pushState: vi.fn(),
    setBadgeCount: vi.fn(),
  };
  globalThis.window = { electronAPI: api };
});

function useBridge(props = {}) {
  captured.length = 0;
  useElectronBridge(props);
  for (const { fn } of captured) fn();
}

describe('push effect wiring', () => {
  it('main window: builds once, sets the badge, pushes the built payload', () => {
    const tasks = [{ id: 't1' }];
    const currentTime = new Date(2026, 7, 16, 14, 30);
    useBridge({ tasks, currentTime });

    expect(buildSpy).toHaveBeenCalledTimes(1);
    // The props flow into the builder by identity, not copies.
    expect(buildSpy.mock.calls[0][0].tasks).toBe(tasks);
    expect(buildSpy.mock.calls[0][0].currentTime).toBe(currentTime);
    expect(api.setBadgeCount).toHaveBeenCalledWith(2);
    expect(api.pushState).toHaveBeenCalledWith({ fake: true });
  });

  it('tray mode: the guard sits above the build, so no payload work happens at all', () => {
    // PR #1300: the tray used to build the entire payload on its 15 s clock
    // tick only to discard it. The behavioral contract is that tray mode
    // skips the build itself, not just the send.
    trayMode = true;
    useBridge({ tasks: [], currentTime: new Date() });

    expect(buildSpy).not.toHaveBeenCalled();
    expect(api.pushState).not.toHaveBeenCalled();
    expect(api.setBadgeCount).not.toHaveBeenCalled();
  });

  it('web build (no electronAPI): every effect is a safe no-op', () => {
    globalThis.window = {};
    expect(() => useBridge({})).not.toThrow();
    expect(buildSpy).not.toHaveBeenCalled();
  });
});

describe('background-action listener (the tray ack relay endpoint)', () => {
  it('main window registers exactly one listener and routes payloads to live handlers', () => {
    const toggleComplete = vi.fn();
    const snoozeReminder = vi.fn();
    useBridge({ toggleComplete, snoozeReminder, currentTime: new Date() });

    expect(api.onBackgroundAction).toHaveBeenCalledTimes(1);
    const listener = api.onBackgroundAction.mock.calls[0][0];
    // The preload stamps an ackId on every relayed action (PR #1381) and acks
    // after this listener returns; the ackId must not disturb routing.
    listener({ action: 'toggle-complete', taskId: 't9', ackId: 'uuid-1' });
    expect(toggleComplete).toHaveBeenCalledWith('t9', false);
    listener({ action: 'snooze-reminder', reminder: { id: 'rem1' }, ackId: 'uuid-2' });
    expect(snoozeReminder).toHaveBeenCalledWith({ id: 'rem1' });
  });

  it('tray mode never registers the listener', () => {
    // The receiving preload acks each delivered background action. If the
    // tray registered this listener it would ack its own sends, and the
    // dead-main-window failure that tray:action-applied exists to surface
    // (revert + reload notice) would never fire.
    trayMode = true;
    useBridge({ toggleComplete: vi.fn(), currentTime: new Date() });
    expect(api.onBackgroundAction).not.toHaveBeenCalled();
  });
});

describe('push effect dependencies', () => {
  it('re-pushes when the data slices the payload reads change identity', () => {
    const tasks = [{ id: 't1' }];
    const goals = [{ id: 'g1' }];
    const projects = [{ id: 'p1' }];
    const activeHabits = [{ id: 'h1' }];
    const routineCompletions = { r1: true };
    useBridge({ tasks, goals, projects, activeHabits, routineCompletions, currentTime: new Date() });

    const pushEffect = captured.find(e => Array.isArray(e.deps) && e.deps.includes(tasks));
    expect(pushEffect).toBeDefined();
    for (const slice of [goals, projects, activeHabits, routineCompletions]) {
      expect(pushEffect.deps).toContain(slice);
    }
  });
});
