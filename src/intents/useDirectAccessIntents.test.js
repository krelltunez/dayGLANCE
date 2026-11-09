/* eslint-disable react-hooks/rules-of-hooks -- React is mocked below; the hook
   is called as a plain function, as useSnapshotFileSync.test.js does. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let effects = [];
vi.mock('react', () => ({
  useEffect: (fn, deps) => { effects.push({ fn, deps }); },
  useRef: (init) => ({ current: init }),
}));
vi.mock('../utils/trayMode.js', () => ({ isTrayMode: false }));
let drainAllowed = true;
vi.mock('./intentDrainGate.js', () => ({ intentDrainAllowed: () => drainAllowed, INTENT_DRAIN_RETRY_MS: 1000 }));
const handled = [];
vi.mock('./handleIntent.js', () => ({ handleIntent: vi.fn(async (action, payload) => { handled.push(payload.title); return { success: true }; }) }));
vi.mock('./intentLog.js', () => ({ logActivity: vi.fn() }));

const { useDirectAccessIntents } = await import('./useDirectAccessIntents.js');
const { buildEnvelope } = await import('@glance-apps/intents');
const { DIRECT_ACCESS_INTENTS_ENABLED_KEY } = await import('./directAccessIntentsConfig.js');
const { DIRECT_ACCESS_INTENT_CURSOR_KEY } = await import('./folderIntents.js');

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// Fake timers are on: let the cycle's promise chain (lock → read → handle → log) run out.
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve(); };
// Each envelope a second later than the last: event ids are time-ordered at
// second granularity, and the cursor is the highest id handled, so two built
// in one second would be ordered by their random suffix.
// The clock is pinned beside them (beforeEach): the folder reader drops
// envelopes past the retention window (30 days by default, retentionMsFrom),
// so against the real clock these fixed dates aged out on 2026-11-09.
const START = Date.parse('2026-10-10T12:00:00.000Z');
let emitted = START;
const foreign = (title) => buildEnvelope({ action: 'notify', emittedBy: 'app.testglance', emittedAt: new Date(emitted += 1000), payload: {
  event_id: 'evt', source_app: 'app.testglance', source_entity_id: 'se-1', event: 'completed', task_id: 'task-1', title, timestamp: '2026-10-01T00:00:00.000Z', entity_type: 'task',
} });

const fakeTransport = (folder, over = {}) => {
  const t = {
    pollMs: 15_000,
    writeThrottleMs: 0,
    isSupported: () => true,
    isAvailable: () => true,
    eventsSupported: () => true,
    eventsRead: vi.fn(async () => folder.text),
    eventsWrite: vi.fn(async (rel, text) => { folder.text = text; return true; }),
    changed: null,
    onChanged: vi.fn((cb) => { t.changed = cb; return () => { t.changed = null; }; }),
    ...over,
  };
  return t;
};

const mount = (transport) => {
  effects = [];
  useDirectAccessIntents({ ctx: true }, { transport });
  const cleanups = effects.map((e) => e.fn()).filter((c) => typeof c === 'function');
  return () => cleanups.forEach((c) => c());
};

describe('useDirectAccessIntents', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // An hour after the first envelope: every one is well inside retention.
    vi.setSystemTime(START + 60 * 60 * 1000);
    global.localStorage = mem();
    global.document = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    handled.length = 0;
    drainAllowed = true;
  });
  afterEach(() => { vi.useRealTimers(); delete global.localStorage; delete global.document; });

  it('is inert without the opt-in or the bridge: no read, no timer, no watcher', () => {
    const folder = { text: JSON.stringify({ version: 1, events: [foreign('a')] }) };
    const t = fakeTransport(folder);
    mount(t)();
    expect(t.eventsRead).not.toHaveBeenCalled();
    expect(t.onChanged).not.toHaveBeenCalled();
    localStorage.setItem(DIRECT_ACCESS_INTENTS_ENABLED_KEY, 'true');
    const noBridge = fakeTransport(folder, { isSupported: () => false });
    mount(noBridge)();
    expect(noBridge.eventsRead).not.toHaveBeenCalled();
  });

  it('with the opt-in: reads at mount, handles what is new, then on the poll and on the change signal; cleanup stops all three', async () => {
    localStorage.setItem(DIRECT_ACCESS_INTENTS_ENABLED_KEY, 'true');
    const a = foreign('a');
    const folder = { text: JSON.stringify({ version: 1, events: [a] }) };
    const t = fakeTransport(folder);
    const unmount = mount(t);
    await flush();
    expect(handled).toEqual(['a']);
    expect(localStorage.getItem(DIRECT_ACCESS_INTENT_CURSOR_KEY)).toBe(a.event_id);
    expect(t.eventsWrite).not.toHaveBeenCalled();                     // a receiver never writes for what it read
    const b = foreign('b');
    folder.text = JSON.stringify({ version: 1, events: [a, b] });
    t.changed();                                                      // the file changed under us
    await flush();
    expect(handled).toEqual(['a', 'b']);
    const c = foreign('c');
    folder.text = JSON.stringify({ version: 1, events: [a, b, c] });
    await vi.advanceTimersByTimeAsync(15_000);                        // the poll
    await flush();
    expect(handled).toEqual(['a', 'b', 'c']);
    expect(document.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    unmount();
    expect(t.changed).toBeNull();
    expect(document.removeEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    folder.text = JSON.stringify({ version: 1, events: [a, b, c, foreign('d')] });
    await vi.advanceTimersByTimeAsync(30_000);
    await flush();
    expect(handled).toEqual(['a', 'b', 'c']);
  });

  it('waits for the drain gate and for the folder, and lets the poll retry', async () => {
    localStorage.setItem(DIRECT_ACCESS_INTENTS_ENABLED_KEY, 'true');
    const folder = { text: JSON.stringify({ version: 1, events: [foreign('a')] }) };
    drainAllowed = false;
    const t = fakeTransport(folder);
    const unmount = mount(t);
    await flush();
    expect(t.eventsRead).not.toHaveBeenCalled();
    drainAllowed = true;
    t.isAvailable = () => false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(t.eventsRead).not.toHaveBeenCalled();
    t.isAvailable = () => true;
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(handled).toEqual(['a']);
    unmount();
  });
});
