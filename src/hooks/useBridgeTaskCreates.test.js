import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The cadence of the task-create consumer (useBridgeTaskCreates). The pass
// itself (utils/obsidianBridgeCreates.js) is mocked: its rules have their own
// tests, and the walk over a real stream is the bridge harness's
// addTask.scenarios.test.ts.

const effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useCallback: (fn) => fn,
  useRef: (init) => ({ current: init }),
}));
const pass = vi.fn();
vi.mock('../utils/obsidianBridgeCreates.js', () => ({
  runBridgeTaskCreatePass: (...args) => pass(...args),
  addBridgeCreatedTasks: (list, created) => [...list, ...created],
}));

const { default: useBridgeTaskCreates, FOLLOW_UP_MS, NUDGE_MIN_GAP_MS, BRIDGE_CREATES_POLL_MS } = await import('./useBridgeTaskCreates.js');

const mount = (over = {}) => {
  effects.length = 0;
  const inbox = { list: [] };
  const api = useBridgeTaskCreates({
    dataLoaded: true, isTrayMode: false,
    tasks: [], unscheduledTasks: inbox.list, recurringTasks: [], recycleBin: [], projects: [], users: [], multiUserEnabled: false,
    setUnscheduledTasks: (up) => { inbox.list = typeof up === 'function' ? up(inbox.list) : up; },
    ...over,
  });
  return { api, inbox, effects: [...effects] };
};

beforeEach(() => {
  vi.useFakeTimers();
  pass.mockReset();
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('useBridgeTaskCreates', () => {
  it('a pass that created something is followed by one more pass, which deletes the rows once the tasks are saved', async () => {
    pass.mockResolvedValueOnce({ applied: 1, held: 1, consumed: 0 }).mockResolvedValue({ applied: 0, held: 0, consumed: 1 });
    const { api } = mount();
    await api.consumeBridgeTaskCreates();
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(FOLLOW_UP_MS - 1);
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pass).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(FOLLOW_UP_MS * 3);
    expect(pass).toHaveBeenCalledTimes(2); // nothing created: no further follow-up
  });

  it('the pass adds the created tasks through the inbox setter', async () => {
    pass.mockImplementation(async ({ addToInbox, read }) => {
      expect(read()).toMatchObject({ unscheduledTasks: [], multiUserEnabled: false });
      addToInbox([{ id: 'bridge-add-x' }]);
      return { applied: 1, held: 1, consumed: 0 };
    });
    const { api, inbox } = mount({ followUpMs: null });
    await api.consumeBridgeTaskCreates();
    expect(inbox.list).toEqual([{ id: 'bridge-add-x' }]);
  });

  it('passes are serialised: a request during one runs once after it', async () => {
    let release;
    pass.mockImplementationOnce(() => new Promise((r) => { release = r; })).mockResolvedValue({ applied: 0, held: 0, consumed: 0 });
    const { api } = mount();
    const first = api.consumeBridgeTaskCreates();
    const second = api.consumeBridgeTaskCreates();
    const third = api.consumeBridgeTaskCreates();
    expect(pass).toHaveBeenCalledTimes(1);
    release({ applied: 0, held: 0, consumed: 0 });
    await Promise.all([first, second, third]);
    await vi.advanceTimersByTimeAsync(0);
    expect(pass).toHaveBeenCalledTimes(2);
  });

  it('nudges are paced: the first runs at once, a burst after it collapses into one pass at the gap', async () => {
    pass.mockResolvedValue({ applied: 0, held: 0, consumed: 0 });
    const { api } = mount();
    api.nudgeBridgeTaskCreates();
    await vi.advanceTimersByTimeAsync(0);
    expect(pass).toHaveBeenCalledTimes(1);
    api.nudgeBridgeTaskCreates();
    api.nudgeBridgeTaskCreates();
    await vi.advanceTimersByTimeAsync(NUDGE_MIN_GAP_MS - 1);
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pass).toHaveBeenCalledTimes(2);
  });

  it('runs at load and on the poll once the data has loaded, never in the tray, and stops on unmount', async () => {
    pass.mockResolvedValue({ applied: 0, held: 0, consumed: 0 });
    const { effects: fx } = mount();
    const cleanup = fx[0].fn();
    await vi.advanceTimersByTimeAsync(0);
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(BRIDGE_CREATES_POLL_MS);
    expect(pass).toHaveBeenCalledTimes(2);
    cleanup();
    await vi.advanceTimersByTimeAsync(BRIDGE_CREATES_POLL_MS * 2);
    expect(pass).toHaveBeenCalledTimes(2);

    pass.mockClear();
    const tray = mount({ isTrayMode: true });
    expect(tray.effects[0].fn()).toBeUndefined();
    expect(await tray.api.consumeBridgeTaskCreates()).toBe(null);
    expect(pass).not.toHaveBeenCalled();
  });
});
