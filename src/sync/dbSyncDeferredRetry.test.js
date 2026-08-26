import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { setSyncPassphrase } from '@glance-apps/sync';
import { createDbEngine } from './dbEngine.js';
import { setVaultConfig } from './vaultConfig.js';
import { createSyncCycleBreaker } from './syncBrakes.js';

// ─────────────────────────────────────────────────────────────────────────────
// DEFERRED RETRY AFTER A COOLDOWN — a trigger gated by the cycle breaker must
// be DELAYED, never LOST.
//
// The regression this pins: with the breaker alone, an SSE nudge that fired
// during a cooldown was consumed and dropped — the gated cycle returned
// {throttled}, the drain wrapper ignores the return value, and the nudge
// coalescer's seq cursor had already advanced past that nudge. A single
// isolated 429 could therefore cost a peer edit up to five minutes (the poll
// backstop) instead of single-digit seconds.
//
// The fix under test (dbEngine.js armDeferredRetry): the first gated trigger
// arms ONE one-shot timer for the cooldown's expiry; further gated triggers
// coalesce into it; a completed cycle cancels it (its pull already served the
// trigger); a torn-down engine cancels it and neuters stray firings; and a
// deferred retry that fails goes through the normal breaker.onFailure path, so
// storm damping is unchanged — at most one attempted cycle per cooldown
// window, with escalating windows.
//
// Real @glance-apps/sync engine + real crypto over the in-memory vault (the
// same harness as the phase2TransitionSyncLoop repro), with two injections for
// determinism: the REAL breaker built with random()=0 (delays become exactly
// base/2 · 2^attempt: 7500ms, 15000ms, 30000ms… on the 429 path), and manual
// retry timers (captured, fired by the test at the moment the mocked clock
// says they would fire).
// ─────────────────────────────────────────────────────────────────────────────

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

function createMemoryVault() {
  const salts = new Map();
  const log = new Map();
  let seq = 0;
  return {
    async getSalt(accountId) { return salts.get(accountId) || null; },
    async putSalt(accountId, fresh) { if (!salts.has(accountId)) salts.set(accountId, fresh); return salts.get(accountId); },
    async batch(app, { rows }) {
      for (const r of rows) log.set(r.entityId, { entityId: r.entityId, seq: ++seq, envelope: r.envelope, deleted: false });
      return { maxSeq: seq };
    },
    async deleteRow(app, entityId) { log.set(entityId, { entityId, seq: ++seq, envelope: null, deleted: true }); return { seq }; },
    async list(app, { since }) {
      const rows = [...log.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq);
      return { rows, hasMore: false };
    },
    async device() { return { updated: true }; },
  };
}

// Manual one-shot timers: armDeferredRetry's setTimeout/clearTimeout, captured
// so the test decides when a timer "fires" (in step with the mocked Date).
function manualRetryTimers() {
  const armed = []; // { fn, ms, cleared, fired }
  return {
    setTimeoutFn: (fn, ms) => { const h = { fn, ms, cleared: false, fired: false }; armed.push(h); return h; },
    clearTimeoutFn: (h) => { if (h) h.cleared = true; },
    armed,
    pending: () => armed.filter((h) => !h.cleared && !h.fired),
    // Fire a pending timer as the runtime would: mark it consumed, run its
    // callback, await the deferred cycle the callback returns.
    async fire(h) { h.fired = true; await h.fn(); },
  };
}

// One-shot failure wrapper: the next list() call throws a 429, then the real
// implementation is restored (so a shared vault only fails the caller under test).
function failNextListWith429(vault) {
  const real = vault.list;
  vault.list = async (...args) => {
    vault.list = real;
    const e = new Error('list failed: 429');
    e.status = 429;
    throw e;
  };
}

const FIXTURE_NOW = new Date('2026-07-10T12:00:00.000Z');
const atOffset = (ms) => new Date(FIXTURE_NOW.getTime() + ms);

let warnSpy;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXTURE_NOW);
  global.localStorage = memLocalStorage();
  setVaultConfig({ enabled: true, vaultUrl: 'https://vault.test', vaultToken: 't', accountId: 'acct' });
  setSyncPassphrase('correct horse battery staple');
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { warnSpy.mockRestore(); vi.useRealTimers(); });
afterAll(() => { delete global.localStorage; });

const clone = (x) => JSON.parse(JSON.stringify(x));
const EMPTY = {
  tasks: [], unscheduledTasks: [], recurringTasks: [], recycleBin: [], todayRoutines: [],
  habits: [], goals: [], projects: [], gtdFrames: [], users: [], dailyNotes: {},
  completedTaskUids: [], deletedTaskIds: {},
};
const task = (id, lastModified, extra = {}) => ({
  id, title: `task ${id}`, duration: 30, color: 'bg-blue-500', completed: false,
  notes: '', subtasks: [], lastModified, ...extra,
});

function makeDevice(name, vault, initial, engineOverrides = {}) {
  let data = clone(initial);
  let nativeKey = null;
  const engine = createDbEngine({
    vaultClient: vault,
    storageKeyPrefix: `dev-${name}`,
    deviceId: `device-${name}`,
    nativeGetSyncKey: () => nativeKey,
    nativeStoreSyncKey: (v) => { nativeKey = v; },
    getData: () => clone(data),
    commitData: (d) => { data = d; },
    ...engineOverrides,
  });
  return {
    engine,
    get data() { return data; },
    set data(d) { data = d; },
  };
}

// A converged mac+peer pair sharing one vault, with the mac carrying the real
// breaker (deterministic jitter) and manual retry timers.
async function seedConverged(vault, timers) {
  const mac = makeDevice('mac', vault, { ...EMPTY, tasks: [task('t1', '2026-07-08T10:00:00.000Z')] }, {
    cycleBreaker: createSyncCycleBreaker({ random: () => 0 }),
    retryTimers: timers,
  });
  const peer = makeDevice('peer', vault, EMPTY);
  await mac.engine.dbSyncCycle();
  await peer.engine.dbSyncCycle();
  await mac.engine.dbSyncCycle();
  expect(peer.data.tasks.map((t) => t.id)).toEqual(['t1']);
  return { mac, peer };
}

const macTitle = (mac, id) => mac.data.tasks.find((t) => t.id === id)?.title;

describe('deferred retry — a nudge gated by a cooldown lands at cooldown expiry, not at the next poll', () => {
  it('429 → peer edit + nudge during cooldown → the edit lands when the deferred retry fires; gated triggers coalesce into one timer', async () => {
    const vault = createMemoryVault();
    const timers = manualRetryTimers();
    const { mac, peer } = await seedConverged(vault, timers);

    // One isolated 429 on the mac's pull → attempt-0 rate-limit cooldown of
    // exactly 7500ms (random()=0 halves the 15s base).
    failNextListWith429(vault);
    const failed = await mac.engine.dbSyncCycle();
    expect(failed.error).toMatch(/429/);

    // A peer edits the task during the mac's cooldown…
    peer.data = { ...peer.data, tasks: [{ ...peer.data.tasks[0], title: 'edited on peer', lastModified: '2026-07-10T12:00:01.000Z' }] };
    vi.setSystemTime(atOffset(2000));
    await peer.engine.dbSyncCycle();

    // …and its SSE nudge drains into the mac's dbSyncCycle mid-cooldown. The
    // cycle is gated, but the trigger is NOT lost: a deferred retry is armed
    // for the cooldown's remainder (5500ms left + the 250ms pad).
    const gated = await mac.engine.dbSyncCycle();
    expect(gated.throttled).toBe(true);
    expect(gated.retryPending).toBe(true);
    expect(timers.pending()).toHaveLength(1);
    expect(timers.pending()[0].ms).toBe(5750);
    expect(macTitle(mac, 't1')).toBe('task t1'); // not yet — still cooling down

    // Coalescing (a): more gated triggers during the same cooldown do NOT
    // queue further retries.
    await mac.engine.dbSyncCycle();
    await mac.engine.dbSyncCycle();
    expect(timers.pending()).toHaveLength(1);

    // The timer fires at cooldown expiry → the deferred cycle runs and pulls
    // the peer edit. Single-digit seconds after the 429, not the 5-minute poll.
    vi.setSystemTime(atOffset(2000 + 5750));
    await timers.fire(timers.pending()[0]);
    expect(macTitle(mac, 't1')).toBe('edited on peer');
    expect(timers.pending()).toHaveLength(0); // completed cycle left nothing armed
  });

  it('(c) a cycle that completes before the timer fires cancels the pending retry — no extra cycle', async () => {
    const vault = createMemoryVault();
    const timers = manualRetryTimers();
    const { mac, peer } = await seedConverged(vault, timers);

    failNextListWith429(vault);
    await mac.engine.dbSyncCycle();
    peer.data = { ...peer.data, tasks: [{ ...peer.data.tasks[0], title: 'edited on peer', lastModified: '2026-07-10T12:00:01.000Z' }] };
    await peer.engine.dbSyncCycle();
    await mac.engine.dbSyncCycle(); // gated → arms the retry
    const handle = timers.pending()[0];
    expect(handle).toBeDefined();

    // The cooldown expires naturally and something else triggers first — a
    // foreground flip / manual "Sync now". That cycle completes and serves the
    // trigger, so it must CANCEL the pending retry rather than leave it to run
    // an extra cycle.
    vi.setSystemTime(atOffset(8000));
    const manual = await mac.engine.dbSyncCycle();
    expect(manual.throttled).toBeUndefined();
    expect(macTitle(mac, 't1')).toBe('edited on peer');
    expect(handle.cleared).toBe(true);
    expect(timers.pending()).toHaveLength(0);
  });

  it('(d) + storm: sustained 429s with continuous nudges → one attempted cycle per cooldown window, windows escalate', async () => {
    const vault = createMemoryVault();
    const timers = manualRetryTimers();
    const { mac } = await seedConverged(vault, timers);

    // The vault rate-limits every pull from now on.
    const realList = vault.list;
    let listCalls = 0;
    vault.list = async () => { listCalls += 1; const e = new Error('list failed: 429'); e.status = 429; throw e; };

    let now = 0;
    const windowDelays = [];
    await mac.engine.dbSyncCycle(); // strike 1 — cooldown 7500ms
    for (let window = 0; window < 3; window++) {
      // Continuous nudges throughout the cooldown: every one is gated and
      // coalesces into the single pending retry.
      for (let i = 0; i < 4; i++) {
        const gated = await mac.engine.dbSyncCycle();
        expect(gated.throttled).toBe(true);
      }
      expect(timers.pending()).toHaveLength(1);
      const handle = timers.pending()[0];
      windowDelays.push(handle.ms);

      // The retry fires at expiry, attempts ONE cycle, fails again (429) — and
      // that failure goes through the normal breaker path: the next cooldown
      // is longer.
      now += handle.ms;
      vi.setSystemTime(atOffset(now));
      await timers.fire(handle);
    }

    // Exactly one vault attempt per window (plus the initial strike): the
    // storm stays damped even under continuous nudges.
    expect(listCalls).toBe(1 + 3);
    // Escalation through breaker.onFailure: 7500 → 15000 → 30000 (+250ms pad).
    expect(windowDelays).toEqual([7750, 15250, 30250]);

    vault.list = realList;
  });

  it('(b) dispose cancels the pending retry, and a stray already-dequeued firing is a no-op against the dead engine', async () => {
    const vault = createMemoryVault();
    const timers = manualRetryTimers();
    const { mac } = await seedConverged(vault, timers);

    failNextListWith429(vault);
    await mac.engine.dbSyncCycle();
    await mac.engine.dbSyncCycle(); // gated → arms the retry
    const handle = timers.pending()[0];
    expect(handle).toBeDefined();

    mac.engine.dispose();
    expect(handle.cleared).toBe(true);

    // Simulate the worst case: the timer callback already left the runtime's
    // queue before clearTimeout landed. The disposed guard makes it inert.
    const listSpy = vi.spyOn(vault, 'list');
    vi.setSystemTime(atOffset(60000));
    await timers.fire(handle);
    expect(listSpy.mock.calls.length).toBe(0);

    // And any later direct call is equally inert.
    const dead = await mac.engine.dbSyncCycle();
    expect(dead).toBeUndefined();
    expect(listSpy.mock.calls.length).toBe(0);
  });
});
