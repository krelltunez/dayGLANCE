import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { enqueue, flush, DELIVERED, TRANSIENT, HELD_NO_KEY_REASON } from './outbox.js';
import {
  logActivity,
  getActivityLog,
  clearActivityLog,
  setDeliveryStatus,
  reconcileOutboxActivity,
} from './intentLog.js';

// ─────────────────────────────────────────────────────────────────────────────
// Outbound delivery-status observability: flush() reports which event_ids were
// delivered / held-for-key this pass, and the activity log folds those outcomes
// into the matching 'queued' entries (queued → delivered, queued → held).
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

function createMemoryStore() {
  const m = new Map();
  const clone = (v) => JSON.parse(JSON.stringify(v));
  return {
    async getAll() { return [...m.values()].map(clone); },
    async get(id) { return m.has(id) ? clone(m.get(id)) : undefined; },
    async put(entry) { m.set(entry.id, clone(entry)); },
    async delete(id) { m.delete(id); },
  };
}

const makeIntent = (eventId) => ({
  event_id: eventId,
  action: 'notify',
  emitted_by: 'app.dayglance',
  payload: { event: 'completed', title: 'Task ' + eventId },
});

const heldNoKey = () => async () => ({ status: TRANSIENT, reason: HELD_NO_KEY_REASON });
const delivers = () => async () => DELIVERED;

afterAll(() => { delete global.localStorage; });

beforeEach(() => {
  global.localStorage = memLocalStorage();
});

describe('flush() delivery reporting', () => {
  it('reports deliveredIds when a target delivers', async () => {
    const store = createMemoryStore();
    await enqueue(makeIntent('evt-1'), ['vault'], { store });

    const r = await flush({ vault: delivers() }, { store });

    expect(r.delivered).toBe(1);
    expect(r.deliveredIds).toEqual(['evt-1']);
    expect(r.heldNoKeyIds).toEqual([]);
  });

  it('reports heldNoKeyIds when the deliverer holds for a missing key', async () => {
    const store = createMemoryStore();
    await enqueue(makeIntent('evt-2'), ['vault'], { store });

    const r = await flush({ vault: heldNoKey() }, { store });

    expect(r.delivered).toBe(0);
    expect(r.deliveredIds).toEqual([]);
    expect(r.heldNoKeyIds).toEqual(['evt-2']);
  });
});

describe('setDeliveryStatus', () => {
  beforeEach(() => {
    clearActivityLog();
    logActivity({ direction: 'out', action: 'notify', event_id: 'evt-x', delivery: 'queued', status: 'ok' });
  });

  it('advances queued → delivered', () => {
    expect(setDeliveryStatus('evt-x', 'delivered')).toBe(true);
    expect(getActivityLog()[0].delivery).toBe('delivered');
  });

  it('advances queued → held', () => {
    expect(setDeliveryStatus('evt-x', 'held')).toBe(true);
    expect(getActivityLog()[0].delivery).toBe('held');
  });

  it('is forward-only: never downgrades delivered → held', () => {
    setDeliveryStatus('evt-x', 'delivered');
    expect(setDeliveryStatus('evt-x', 'held')).toBe(false);
    expect(getActivityLog()[0].delivery).toBe('delivered');
  });

  it('no-ops (returns false) when no entry matches the event_id', () => {
    expect(setDeliveryStatus('missing', 'delivered')).toBe(false);
  });

  it('only matches OUTBOUND entries', () => {
    clearActivityLog();
    logActivity({ direction: 'in', action: 'notify', event_id: 'evt-in', delivery: 'queued', status: 'ok' });
    expect(setDeliveryStatus('evt-in', 'delivered')).toBe(false);
  });
});

describe('reconcileOutboxActivity', () => {
  it('folds a flush result into the matching queued entries', () => {
    clearActivityLog();
    logActivity({ direction: 'out', action: 'notify', event_id: 'd-1', delivery: 'queued', status: 'ok' });
    logActivity({ direction: 'out', action: 'notify', event_id: 'h-1', delivery: 'queued', status: 'ok' });

    reconcileOutboxActivity({ deliveredIds: ['d-1'], heldNoKeyIds: ['h-1'] });

    const byId = Object.fromEntries(getActivityLog().map(e => [e.event_id, e.delivery]));
    expect(byId['d-1']).toBe('delivered');
    expect(byId['h-1']).toBe('held');
  });

  it('tolerates a missing/empty result without throwing', () => {
    expect(() => reconcileOutboxActivity(undefined)).not.toThrow();
    expect(() => reconcileOutboxActivity({})).not.toThrow();
  });
});
