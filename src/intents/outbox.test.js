import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  enqueue,
  flush,
  pendingCount,
  list,
  DELIVERED,
  TRANSIENT,
  PERMANENT,
  MAX_OUTBOX_ATTEMPTS,
  PENDING,
  GIVEN_UP,
} from './outbox.js';

// ─────────────────────────────────────────────────────────────────────────────
// Durable outbound intents outbox. These exercise the REAL outbox core against
// an in-memory fake store and fake deliverers (no network, no IndexedDB, no DOM),
// mirroring how dbIntentsTransport.test.js injects an in-memory server.
//
// The fake store deep-clones on read and write to match IndexedDB's
// structured-clone semantics — so a value handed back by getAll/get is the
// caller's to own and mutate, and a put captures a snapshot (no aliasing).
// ─────────────────────────────────────────────────────────────────────────────

function createMemoryStore() {
  const m = new Map(); // id -> serialized entry
  const clone = (v) => JSON.parse(JSON.stringify(v));
  return {
    async getAll() { return [...m.values()].map(clone); },
    async get(id) { return m.has(id) ? clone(m.get(id)) : undefined; },
    async put(entry) { m.set(entry.id, clone(entry)); },
    async delete(id) { m.delete(id); },
    // test-only peek
    _size: () => m.size,
  };
}

// A RAW intent (action + payload + emit metadata) — NEVER an envelope. event_id
// is the outbox id / idempotency key.
function makeIntent(eventId, overrides = {}) {
  return {
    event_id: eventId,
    action: 'notify',
    emitted_by: 'app.dayglance',
    payload: { event: 'completed', title: 'Task ' + eventId, source_app: 'app.testGLANCE' },
    ...overrides,
  };
}

// Deliverer factories. Each returns a vi.fn so call counts are assertable.
const ok = () => vi.fn(async () => DELIVERED);
const transient = () => vi.fn(async () => TRANSIENT);
const permanent = () => vi.fn(async () => PERMANENT);
const throwing = () => vi.fn(async () => { throw new Error('network down'); });

let store;
beforeEach(() => {
  store = createMemoryStore();
  vi.restoreAllMocks();
});

// (a) enqueue persists durably; a simulated reload re-reads pending entries.
describe('enqueue durability', () => {
  it('persists an entry that survives a simulated reload', async () => {
    const intent = makeIntent('evt-a');
    await enqueue(intent, ['webdav', 'vault'], { store });

    // "Reload": a brand-new run reads from the same underlying store. We model
    // that by reading through the same store object (its Map is the persistence).
    const entries = await list({ store });
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('evt-a');
    expect(entries[0].intent).toEqual(intent);          // RAW intent persisted
    expect(entries[0].intent.payload).toBeDefined();    // not an opaque envelope
    expect(entries[0].targets).toEqual({ webdav: PENDING, vault: PENDING });
    expect(entries[0].attempts).toEqual({ webdav: 0, vault: 0 });
    expect(typeof entries[0].createdAt).toBe('number');
    expect(await pendingCount({ store })).toBe(1);
  });

  it('stores the raw intent, never a built envelope', async () => {
    await enqueue(makeIntent('evt-raw'), ['vault'], { store });
    const [entry] = await list({ store });
    // The persisted shape is the raw intent: it has action/payload, and NO
    // ciphertext/envelope fields. Encryption happens only at flush in the deliverer.
    expect(entry.intent.action).toBe('notify');
    expect(entry.intent).not.toHaveProperty('ciphertext');
    expect(entry.intent).not.toHaveProperty('envelope');
    expect(entry.intent).not.toHaveProperty('encrypted');
  });
});

// (b) a transient-failing target stays pending and is retried; succeeds later
//     and is then removed.
describe('transient retry then success', () => {
  it('keeps the target pending across flushes, then delivers and removes', async () => {
    await enqueue(makeIntent('evt-b'), ['vault'], { store });

    const failing = transient();
    const r1 = await flush({ vault: failing }, { store });
    expect(r1.delivered).toBe(0);
    expect(failing).toHaveBeenCalledTimes(1);

    let [entry] = await list({ store });
    expect(entry.targets.vault).toBe(PENDING);
    expect(entry.attempts.vault).toBe(1);
    expect(await pendingCount({ store })).toBe(1); // still there, still pending

    // Second flush still transient — attempts keeps climbing, stays pending.
    await flush({ vault: failing }, { store });
    [entry] = await list({ store });
    expect(entry.attempts.vault).toBe(2);
    expect(entry.targets.vault).toBe(PENDING);

    // Later flush: the key/connection is ready now, delivery succeeds → removed.
    const succeeding = ok();
    const r3 = await flush({ vault: succeeding }, { store });
    expect(r3.delivered).toBe(1);
    expect(r3.removed).toBe(1);
    expect(await list({ store })).toHaveLength(0);
    expect(await pendingCount({ store })).toBe(0);
  });

  it('treats a thrown deliverer (failed POST) as transient, not a drop', async () => {
    await enqueue(makeIntent('evt-throw'), ['vault'], { store });
    const t = throwing();
    await flush({ vault: t }, { store });
    const [entry] = await list({ store });
    expect(entry.targets.vault).toBe(PENDING); // retained for retry
    expect(entry.attempts.vault).toBe(1);
  });

  it('treats "key not ready" (a transient signal from the deliverer) as retryable', async () => {
    // The deliverer is where encryption happens; if the vault key isn't loaded it
    // returns TRANSIENT and the outbox simply holds the intent for a later flush.
    await enqueue(makeIntent('evt-nokey'), ['vault'], { store });
    const keyNotReady = vi.fn(async () => ({ status: TRANSIENT, reason: 'key-not-ready' }));
    await flush({ vault: keyNotReady }, { store });
    expect(await pendingCount({ store })).toBe(1);
    const [entry] = await list({ store });
    expect(entry.targets.vault).toBe(PENDING);
  });
});

// (c) multi-target: webdav delivered + vault pending -> entry stays, only vault
//     retried; webdav NOT re-delivered; vault later delivers -> removed.
describe('multi-target partial delivery', () => {
  it('does not re-deliver an already-delivered target and removes once all done', async () => {
    await enqueue(makeIntent('evt-c'), ['webdav', 'vault'], { store });

    const webdav1 = ok();
    const vault1 = transient();
    const r1 = await flush({ webdav: webdav1, vault: vault1 }, { store });
    expect(r1.delivered).toBe(1);   // webdav only
    expect(webdav1).toHaveBeenCalledTimes(1);
    expect(vault1).toHaveBeenCalledTimes(1);

    let [entry] = await list({ store });
    expect(entry.targets.webdav).toBe(DELIVERED);
    expect(entry.targets.vault).toBe(PENDING);
    expect(await pendingCount({ store })).toBe(1); // still pending on vault

    // Next flush: webdav deliverer is still provided, but must NOT be called
    // again (already delivered). Only vault is retried — and now succeeds.
    const webdav2 = ok();
    const vault2 = ok();
    const r2 = await flush({ webdav: webdav2, vault: vault2 }, { store });
    expect(webdav2).not.toHaveBeenCalled();        // idempotent: already delivered
    expect(vault2).toHaveBeenCalledTimes(1);
    expect(r2.removed).toBe(1);
    expect(await list({ store })).toHaveLength(0);
  });
});

// (d) duplicate enqueue (same event_id) is a no-op.
describe('idempotent enqueue', () => {
  it('does not create a second entry or reset in-flight state', async () => {
    await enqueue(makeIntent('evt-d'), ['webdav', 'vault'], { store });

    // Deliver webdav so the entry has in-flight state worth protecting.
    await flush({ webdav: ok(), vault: transient() }, { store });
    let [entry] = await list({ store });
    expect(entry.targets.webdav).toBe(DELIVERED);
    expect(entry.attempts.vault).toBe(1);

    // Re-enqueue the SAME event_id (a retry / double render). No-op: must not
    // add a row, must not reset webdav back to pending or zero the counters.
    const before = await list({ store });
    await enqueue(makeIntent('evt-d', { payload: { event: 'updated' } }), ['webdav', 'vault'], { store });
    const after = await list({ store });

    expect(after).toHaveLength(1);
    expect(after).toEqual(before);                 // entirely unchanged
    expect(after[0].targets.webdav).toBe(DELIVERED);
    expect(after[0].attempts.vault).toBe(1);
  });
});

// (e) a target that fails MAX_OUTBOX_ATTEMPTS times, or returns permanent-fail,
//     is given up with a loud log and stops retrying; entry removed when all
//     targets are delivered-or-given-up.
describe('give-up bound', () => {
  it('gives up a target after MAX_OUTBOX_ATTEMPTS transient failures', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await enqueue(makeIntent('evt-e1'), ['vault'], { store });

    const failing = transient();
    // Flush MAX_OUTBOX_ATTEMPTS - 1 times: still pending, not yet given up.
    for (let i = 0; i < MAX_OUTBOX_ATTEMPTS - 1; i++) {
      await flush({ vault: failing }, { store });
    }
    let [entry] = await list({ store });
    expect(entry.targets.vault).toBe(PENDING);
    expect(entry.attempts.vault).toBe(MAX_OUTBOX_ATTEMPTS - 1);
    expect(errSpy).not.toHaveBeenCalled();

    // One more failure hits the bound: target given up, entry removed (sole target).
    const r = await flush({ vault: failing }, { store });
    expect(r.gaveUp).toBe(1);
    expect(r.removed).toBe(1);
    expect(await list({ store })).toHaveLength(0);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toContain('evt-e1');  // loud: event_id
    expect(errSpy.mock.calls[0][0]).toContain('vault');   // loud: transport
  });

  it('gives up immediately on a permanent-fail result', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await enqueue(makeIntent('evt-e2'), ['vault'], { store });

    const r = await flush({ vault: permanent() }, { store });
    expect(r.gaveUp).toBe(1);
    expect(r.removed).toBe(1);
    expect(await list({ store })).toHaveLength(0);
    expect(errSpy.mock.calls[0][0]).toContain('evt-e2');
    expect(errSpy.mock.calls[0][0]).toContain('vault');
  });

  it('removes an entry when one target delivered and the other is given up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await enqueue(makeIntent('evt-e3'), ['webdav', 'vault'], { store });

    // webdav delivers; vault permanently fails → both terminal → entry removed.
    const r = await flush({ webdav: ok(), vault: permanent() }, { store });
    expect(r.delivered).toBe(1);
    expect(r.gaveUp).toBe(1);
    expect(r.removed).toBe(1);
    expect(await list({ store })).toHaveLength(0);
  });

  it('keeps retrying other targets after one is given up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await enqueue(makeIntent('evt-e4'), ['webdav', 'vault'], { store });

    // vault permanently fails (given up); webdav transient (still pending).
    await flush({ webdav: transient(), vault: permanent() }, { store });
    let [entry] = await list({ store });
    expect(entry.targets.vault).toBe(GIVEN_UP);
    expect(entry.targets.webdav).toBe(PENDING);
    expect(await pendingCount({ store })).toBe(1); // entry survives for webdav

    // A later flush: vault deliverer must NOT be retried; webdav delivers → done.
    const vaultAgain = ok();
    const r = await flush({ webdav: ok(), vault: vaultAgain }, { store });
    expect(vaultAgain).not.toHaveBeenCalled();     // given-up target is not retried
    expect(r.removed).toBe(1);
    expect(await list({ store })).toHaveLength(0);
  });
});

// (f) overlapping flush calls don't double-deliver or corrupt state.
describe('concurrent flush guard', () => {
  it('a flush already in progress makes a concurrent flush a no-op', async () => {
    await enqueue(makeIntent('evt-f1'), ['vault'], { store });
    await enqueue(makeIntent('evt-f2'), ['vault'], { store });

    // A deliverer that blocks until we release it, so two flushes truly overlap.
    let release;
    const gate = new Promise((res) => { release = res; });
    const slow = vi.fn(async () => { await gate; return DELIVERED; });

    const first = flush({ vault: slow }, { store });
    // Second flush starts while the first holds the lock → should skip entirely.
    const second = await flush({ vault: slow }, { store });
    expect(second.skipped).toBe(true);
    expect(second.delivered).toBe(0);

    release();
    const firstResult = await first;
    expect(firstResult.delivered).toBe(2);         // first flush did all the work
    expect(slow).toHaveBeenCalledTimes(2);         // exactly once per entry, no double
    expect(await list({ store })).toHaveLength(0);
  });

  it('releases the lock so a later flush runs normally', async () => {
    await enqueue(makeIntent('evt-f3'), ['vault'], { store });
    await flush({ vault: transient() }, { store });   // completes, releases lock
    const r = await flush({ vault: ok() }, { store }); // not skipped
    expect(r.skipped).toBe(false);
    expect(r.removed).toBe(1);
  });
});
