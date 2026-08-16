import { describe, it, expect } from 'vitest';
import { addPending, resolvePending, expirePending, ACK_TIMEOUT_MS } from './trayActionAcks.js';

// The contract: an acked action settles and never expires; an unacked action
// expires once its age reaches the timeout; late acks after expiry are
// harmless no-ops; and everything is pure (inputs untouched).

const T0 = 50_000;

describe('trayActionAcks', () => {
  it('add, ack, and the acked action never expires', () => {
    let pending = addPending([], 'a1', T0);
    pending = resolvePending(pending, 'a1');
    const { expired, remaining } = expirePending(pending, T0 + ACK_TIMEOUT_MS + 1);
    expect(expired).toEqual([]);
    expect(remaining).toEqual([]);
  });

  it('an unacked action expires exactly at the timeout boundary, not before', () => {
    const pending = addPending([], 'a1', T0);
    expect(expirePending(pending, T0 + ACK_TIMEOUT_MS - 1).expired).toEqual([]);
    expect(expirePending(pending, T0 + ACK_TIMEOUT_MS - 1).remaining).toHaveLength(1);
    const at = expirePending(pending, T0 + ACK_TIMEOUT_MS);
    expect(at.expired).toEqual(['a1']);
    expect(at.remaining).toEqual([]);
  });

  it('the default timeout errs long: 3 seconds', () => {
    expect(ACK_TIMEOUT_MS).toBe(3000);
  });

  it('mixed ages split correctly and preserve waiting entries', () => {
    let pending = addPending([], 'old', T0);
    pending = addPending(pending, 'new', T0 + 2500);
    const { expired, remaining } = expirePending(pending, T0 + 3200);
    expect(expired).toEqual(['old']);
    expect(remaining.map((p) => p.id)).toEqual(['new']);
  });

  it('acking an unknown id (late ack after expiry) is a no-op', () => {
    const pending = addPending([], 'a1', T0);
    expect(resolvePending(pending, 'ghost')).toEqual(pending);
    expect(resolvePending([], 'a1')).toEqual([]);
  });

  it('is pure: inputs are never mutated, null/undefined tolerated', () => {
    const pending = [{ id: 'a1', at: T0 }];
    addPending(pending, 'a2', T0 + 1);
    resolvePending(pending, 'a1');
    expirePending(pending, T0 + 10_000);
    expect(pending).toEqual([{ id: 'a1', at: T0 }]);
    expect(addPending(null, 'x', 1)).toHaveLength(1);
    expect(expirePending(undefined, 1)).toEqual({ expired: [], remaining: [] });
  });
});
