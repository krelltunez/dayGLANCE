import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { SOURCE_APPS } from '@glance-apps/intents';

// Capture what the emit site hands to the outbox bridge.
vi.mock('./outboxEmit.js', () => ({ enqueueAndFlush: vi.fn(async () => true) }));

import { emitGoalCreate } from './emitGoalCreate.js';
import { enqueueAndFlush } from './outboxEmit.js';

function memLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

beforeEach(() => {
  global.localStorage = memLocalStorage();
  enqueueAndFlush.mockClear();
  // WebDAV intents configured + GLANCEvault intents enabled (vault connection present).
  localStorage.setItem('dayglance-intent-config', JSON.stringify({ webdavUrl: 'https://dav', username: 'u', appPassword: 'p' }));
  localStorage.setItem('dayglance-db-intents-config', JSON.stringify({ enabled: true }));
  localStorage.setItem('dayglance-vault-config', JSON.stringify({ enabled: true, vaultUrl: 'https://v', vaultToken: 't', accountId: 'a' }));
});
afterAll(() => { delete global.localStorage; });

describe('emitGoalCreate → outbox (stage 2b-ii)', () => {
  it('(a) enqueues a RAW intent (not an envelope) with a stable event_id and the enabled targets', async () => {
    const goal = { id: 'goal-1', title: 'My Goal', targetDate: '2026-08-01', createdAt: '2026-06-07T01:49:53.123Z' };
    await emitGoalCreate(goal);

    expect(enqueueAndFlush).toHaveBeenCalledTimes(1);
    const [items, targets] = enqueueAndFlush.mock.calls[0];
    const intent = items[0].intent;

    // RAW intent shape.
    expect(intent.action).toBe('create');
    expect(intent.emitted_by).toBe(SOURCE_APPS.DAYGLANCE);
    expect(intent.payload).toBeDefined();
    expect(intent.payload.title).toBe('My Goal');
    expect(intent.payload.source_entity_id).toBe('goal-1');

    // Stable event_id in the required compact format, used as the outbox id.
    expect(intent.event_id).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{6}$/);

    // NOT an envelope — no envelope/ciphertext fields are present.
    expect(intent).not.toHaveProperty('encrypted');
    expect(intent).not.toHaveProperty('payload_ciphertext');
    expect(intent).not.toHaveProperty('salt');
    expect(intent).not.toHaveProperty('iv');
    expect(intent).not.toHaveProperty('schema_version');

    // Enabled targets: WebDAV + vault (iCloud unavailable in this environment).
    expect(targets).toEqual(['webdav', 'vault']);
  });

  it('emits the SAME stable event_id on a repeat emit (idempotency key is deterministic)', async () => {
    const goal = { id: 'goal-1', title: 'My Goal', createdAt: '2026-06-07T01:49:53.123Z' };
    await emitGoalCreate(goal);
    await emitGoalCreate(goal);
    const id1 = enqueueAndFlush.mock.calls[0][0][0].intent.event_id;
    const id2 = enqueueAndFlush.mock.calls[1][0][0].intent.event_id;
    expect(id1).toBe(id2);
  });

  it('no-ops when no transport target is enabled', async () => {
    localStorage.clear();
    await emitGoalCreate({ id: 'g', title: 'x', createdAt: '2026-06-07T01:49:53.123Z' });
    expect(enqueueAndFlush).not.toHaveBeenCalled();
  });
});
