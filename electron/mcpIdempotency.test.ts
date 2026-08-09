import { describe, it, expect } from 'vitest';
import {
  createIdempotencyStore,
  isValidIdempotencyKey,
  makeStoreKey,
  deterministicTaskIdFromSeed,
  DEFAULT_IDEMPOTENCY_TTL_MS,
} from './mcpIdempotency.js';

// §5.2 under test: a replayed idempotency_key returns the FIRST attempt's
// result and never re-executes the mutation; keys are scoped so tools and
// tokens cannot collide; the store is bounded in both time and size.

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; }, rewind: (ms: number) => { t -= ms; } };
}

describe('isValidIdempotencyKey', () => {
  it('accepts id-shaped keys', () => {
    for (const k of ['retry-1', 'a', 'A_b.c:d-e', '0'.repeat(128)]) {
      expect(isValidIdempotencyKey(k), k).toBe(true);
    }
  });
  it('rejects empty, oversized, spaced, and non-string keys', () => {
    for (const k of ['', '0'.repeat(129), 'has space', 'pipe|char', 'né', 42, null, undefined, {}]) {
      expect(isValidIdempotencyKey(k), String(k)).toBe(false);
    }
  });
});

describe('makeStoreKey', () => {
  it('scopes by token and tool', () => {
    expect(makeStoreKey('t1', 'create_task', 'k')).not.toBe(makeStoreKey('t2', 'create_task', 'k'));
    expect(makeStoreKey('t1', 'create_task', 'k')).not.toBe(makeStoreKey('t1', 'move_block', 'k'));
  });
  it('is collision-proof across segment boundaries (length-prefixed)', () => {
    expect(makeStoreKey('ab', 'c', 'k')).not.toBe(makeStoreKey('a', 'bc', 'k'));
    expect(makeStoreKey('a', 'b.c', 'k')).not.toBe(makeStoreKey('a.b', 'c', 'k'));
    // Even a separator character INSIDE a segment cannot realign boundaries —
    // this is what the length prefix is for (tokens/tools are not run through
    // isValidIdempotencyKey, so the store key must not trust their alphabet).
    expect(makeStoreKey('a|b', 'c', 'k')).not.toBe(makeStoreKey('a', 'b|c', 'k'));
  });
});

describe('deterministicTaskIdFromSeed', () => {
  it('is stable, seed-sensitive, and UUIDv4-shaped (the handleIntent precedent)', () => {
    const a = deterministicTaskIdFromSeed('token|create_task|k1');
    expect(a).toBe(deterministicTaskIdFromSeed('token|create_task|k1'));
    expect(a).not.toBe(deterministicTaskIdFromSeed('token|create_task|k2'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('createIdempotencyStore', () => {
  it('returns the stored first-attempt result on replay', () => {
    const clock = fakeClock();
    const store = createIdempotencyStore<{ id: string }>({ now: clock.now });
    expect(store.get('k')).toBeNull();
    store.put('k', { id: 'task-1' });
    expect(store.get('k')).toEqual({ id: 'task-1' });
    clock.advance(DEFAULT_IDEMPOTENCY_TTL_MS - 1);
    expect(store.get('k')).toEqual({ id: 'task-1' }); // still inside the TTL
  });

  it('expires entries at the TTL', () => {
    const clock = fakeClock();
    const store = createIdempotencyStore({ ttlMs: 1000, now: clock.now });
    store.put('k', 'result');
    clock.advance(1000);
    expect(store.get('k')).toBeNull();
  });

  it('expires on a backwards clock jump rather than trusting a future timestamp', () => {
    const clock = fakeClock();
    const store = createIdempotencyStore({ ttlMs: 1000, now: clock.now });
    store.put('k', 'result');
    clock.rewind(5000);
    expect(store.get('k')).toBeNull();
  });

  it('evicts the least recently WRITTEN entry beyond the cap', () => {
    const clock = fakeClock();
    const store = createIdempotencyStore({ maxEntries: 2, now: clock.now });
    store.put('a', 1);
    store.put('b', 2);
    store.put('a', 10);   // rewrite refreshes a's position
    store.put('c', 3);    // evicts b, the oldest
    expect(store.get('b')).toBeNull();
    expect(store.get('a')).toBe(10);
    expect(store.get('c')).toBe(3);
    expect(store.size()).toBe(2);
  });

  it('reset() drops everything (token rotation)', () => {
    const store = createIdempotencyStore({ now: fakeClock().now });
    store.put('k', 'v');
    store.reset();
    expect(store.get('k')).toBeNull();
    expect(store.size()).toBe(0);
  });
});
