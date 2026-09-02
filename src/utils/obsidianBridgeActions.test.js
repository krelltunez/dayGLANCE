import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupDbRootKey, clearDbRootKey } from '@glance-apps/sync';
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import {
  deriveBridgeSubkey,
  sealBridgeEnvelope,
  encodePlainBridgeRow,
  BRIDGE_ACTION_PREFIX,
} from '@glance-apps/obsidian-format';
import {
  fetchBridgeActions,
  commitBridgeActionCursor,
  deleteBridgeActions,
  planBridgeActions,
  applyActionsToTasks,
  applyActionsToRecurring,
  ACTION_STALE_MS,
} from './obsidianBridgeActions.js';

// The sidebar's one write (companion spec 4.2): the plugin emits `act:`
// rows; dayGLANCE — the single data-plane writer — applies them through its
// own state, holds the ones whose target hasn't synced here yet (the cursor
// never passes a held row), consumes stale ones, and deletes what it
// consumed.

const VAULT_CONFIG_KEY = 'dayglance-vault-config';
const ACT_HWM_KEY = 'dayglance-bridge-act-hwm';
const SALT = new Uint8Array(16).fill(5);
const SALT_B64 = btoa(String.fromCharCode(...SALT));
const META = { v: 1, kind: 'pairing-meta', generation: SALT_B64, pairingSalt: SALT_B64, pairedAt: '2026-08-29T00:00:00Z' };
const nativeStub = { get: () => null, store: () => {} };

const action = (over = {}) => ({
  v: 1, kind: 'action', type: 'task_complete', actionId: over.actionId || 'a1',
  completedAt: '2026-09-02T09:15:00-06:00', createdAt: '2026-09-02T15:15:00.000Z', ...over,
});

beforeEach(async () => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  localStorage.setItem(VAULT_CONFIG_KEY, JSON.stringify({
    enabled: true, vaultUrl: 'https://vault.example', vaultToken: 'tok', accountId: 'acct-1',
  }));
  const { __resetBridgeStreamForTests } = await import('./obsidianBridgeStream.js');
  __resetBridgeStreamForTests();
  await setupDbRootKey('pw', new Uint8Array(16).fill(9), {
    nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store,
  });
});
afterEach(async () => {
  await clearDbRootKey({ nativeGetSyncKey: nativeStub.get, nativeStoreSyncKey: nativeStub.store });
  delete globalThis.localStorage;
  delete globalThis.fetch;
});

describe('fetchBridgeActions', () => {
  it('decrypts act: rows only, skips tombstoned and unreadable ones, and leaves the cursor alone', async () => {
    const subkey = await deriveBridgeSubkey(getDbRootKey(), SALT);
    const rows = [
      { entityId: 'obs:deadbeef', seq: 1, envelope: await sealBridgeEnvelope(subkey, { v: 1, kind: 'observation', path: 'x.md', content: '' }) },
      { entityId: `${BRIDGE_ACTION_PREFIX}a1`, seq: 2, envelope: await sealBridgeEnvelope(subkey, action({ actionId: 'a1', taskId: 't1' })) },
      { entityId: `${BRIDGE_ACTION_PREFIX}a2`, seq: 3, envelope: await sealBridgeEnvelope(subkey, action({ actionId: 'a2', taskId: 't2' })), deleted: true },
      { entityId: `${BRIDGE_ACTION_PREFIX}a3`, seq: 4, envelope: 'garbage from a rotated generation' },
    ];
    globalThis.fetch = async (url) => {
      if (url.includes('/meta')) return { ok: true, status: 200, json: async () => ({ entityId: 'meta:pairing', envelope: encodePlainBridgeRow(META) }) };
      if (url.includes('/list')) return { ok: true, status: 200, json: async () => ({ rows, hasMore: false }) };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const result = await fetchBridgeActions();
    expect(result.maxSeq).toBe(4);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({ actionId: 'a1', taskId: 't1', entityId: 'act:a1', seq: 2 });
    expect(localStorage.getItem(ACT_HWM_KEY)).toBe(null);
  });

  it('unpaired (no meta row) → null', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchBridgeActions()).toBe(null);
  });
});

describe('commitBridgeActionCursor', () => {
  it('advances to maxSeq when nothing is held, and stops below the oldest held row otherwise; never moves backwards', () => {
    commitBridgeActionCursor(10, []);
    expect(localStorage.getItem(ACT_HWM_KEY)).toBe('10');
    commitBridgeActionCursor(20, [{ seq: 15 }, { seq: 18 }]);
    expect(localStorage.getItem(ACT_HWM_KEY)).toBe('14');
    commitBridgeActionCursor(30, [{ seq: 5 }]); // held row below the cursor: no regression
    expect(localStorage.getItem(ACT_HWM_KEY)).toBe('14');
  });
});

describe('deleteBridgeActions', () => {
  it('deletes each consumed row by entityId and swallows failures', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push([init?.method, url]);
      if (url.includes('act%3Aa2') || url.includes('act:a2')) return { ok: false, status: 500, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ deleted: true }) };
    };
    await deleteBridgeActions([{ entityId: 'act:a1' }, { entityId: 'act:a2' }]);
    expect(calls.filter(([m]) => m === 'DELETE')).toHaveLength(2);
  });
});

describe('planBridgeActions', () => {
  const lists = {
    tasks: [{ id: 't1', completed: false }],
    unscheduledTasks: [{ id: 'u1' }],
    recurringTasks: [{ id: 'r1' }],
  };
  it('applies known targets (either task list, recurring template), holds unknown fresh ones, consumes stale and foreign types', () => {
    const now = Date.parse('2026-09-02T16:00:00Z');
    const { apply, hold, stale } = planBridgeActions([
      action({ actionId: 'a', taskId: 't1' }),
      action({ actionId: 'b', taskId: 'u1' }),
      action({ actionId: 'c', templateId: 'r1', instanceDate: '2026-09-02' }),
      action({ actionId: 'd', taskId: 'missing' }),
      action({ actionId: 'e', taskId: 'missing', createdAt: new Date(now - ACTION_STALE_MS - 1000).toISOString() }),
      action({ actionId: 'f', templateId: 'r1', instanceDate: 'not-a-date' }),
      { v: 1, kind: 'action', type: 'task_reschedule', actionId: 'g', taskId: 't1', createdAt: '2026-09-02T15:00:00Z' },
    ], { ...lists, nowMs: now });
    expect(apply.map((a) => a.actionId)).toEqual(['a', 'b', 'c']);
    expect(hold.map((a) => a.actionId)).toEqual(['d', 'f']);
    expect(stale.map((a) => a.actionId)).toEqual(['e', 'g']);
  });
});

describe('applyActionsToTasks / applyActionsToRecurring', () => {
  it('completes the target with the action stamp, leaves already-completed tasks and unrelated lists untouched (same reference)', () => {
    const tasks = [
      { id: 't1', title: 'A', completed: false },
      { id: 't2', title: 'B', completed: true, completedAt: '2026-09-01T10:00:00-06:00' },
      { id: 't3', title: 'C', completed: false },
    ];
    const out = applyActionsToTasks(tasks, [action({ taskId: 't1' }), action({ actionId: 'x', taskId: 't2' })]);
    expect(out).not.toBe(tasks);
    expect(out[0]).toMatchObject({ completed: true, completedAt: '2026-09-02T09:15:00-06:00' });
    expect(typeof out[0].transitionId).toBe('string');
    expect(out[0].lastModified).toBeTruthy();
    expect(out[1]).toBe(tasks[1]); // already complete: untouched, the action is still consumed by the planner
    expect(out[2]).toBe(tasks[2]);
    // No matching action → identical reference, so setState is a no-op.
    expect(applyActionsToTasks(tasks, [action({ taskId: 'zzz' })])).toBe(tasks);
    // Recurring actions never touch the task lists.
    expect(applyActionsToTasks(tasks, [action({ templateId: 'r1', instanceDate: '2026-09-02' })])).toBe(tasks);
  });

  it('adds the instance date to completedDates with a per-date timestamp, once', () => {
    const recurring = [{ id: 'r1', title: 'Gym', completedDates: ['2026-09-01'], completedDatesTimestamps: { '2026-09-01': '2026-09-01T12:00:00.000Z' } }];
    const out = applyActionsToRecurring(recurring, [
      action({ templateId: 'r1', instanceDate: '2026-09-02' }),
      action({ actionId: 'dup', templateId: 'r1', instanceDate: '2026-09-02' }),
    ]);
    expect(out[0].completedDates).toEqual(['2026-09-01', '2026-09-02']);
    expect(out[0].completedDatesTimestamps['2026-09-02']).toBe('2026-09-02T15:15:00.000Z');
    expect(out[0].completedDatesTimestamps['2026-09-01']).toBe('2026-09-01T12:00:00.000Z');
    expect(out[0].lastModified).toBeTruthy();
    // Replay: nothing new, same reference.
    expect(applyActionsToRecurring(out, [action({ templateId: 'r1', instanceDate: '2026-09-02' })])).toBe(out);
  });
});
