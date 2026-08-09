// Idempotency for MCP writes (spec §5.2): agents retry, and a replayed
// idempotency_key must not produce a second mutation. Pure factory with an
// injectable clock, same idiom as calendarCache.ts.
//
// WHAT THIS STORES: the finished tool result of the first attempt, keyed by
// (token, tool, idempotency_key). A replay inside the TTL returns that stored
// result verbatim — the renderer mutation is never re-invoked. The key also
// travels INTO the mutation as its GLANCEintents transitionId (§5.2: map onto
// the existing mechanism, don't invent a second one), so the emitted event
// stream carries the same correlation id the client chose.
//
// Keys are scoped per (token, tool): the same key on a different tool is a
// different operation, and another client (different token) can never replay
// — or poison — this client's results.
//
// TTL exists because agents retry on the seconds-to-minutes scale; remembering
// keys forever would make the map an unbounded leak (§3.7: module scope, but
// bounded). LRU cap is the backstop against a key-generating runaway loop.

import { createHash } from 'node:crypto';

export const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60_000;
export const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 500;

export interface IdempotencyStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

/** A caller-supplied key must be shaped like an id, not a payload. */
export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[\w.:-]+$/.test(value);
}

export function makeStoreKey(token: string, tool: string, idempotencyKey: string): string {
  // Length-prefixed segments so no crafted key can collide across fields
  // (("a","b:c") and ("a:b","c") must not meet at "a:b:c").
  return [token, tool, idempotencyKey].map((s) => `${s.length}.${s}`).join('|');
}

/**
 * Deterministic UUIDv4-shaped id from a seed — the handleIntent.js
 * deterministicTaskId precedent (SHA-256, version/variant bits forced),
 * synchronous via node:crypto since this runs in the main process. Used by
 * create_task: the task id derives from the idempotency key, so a replayed
 * create finds its own id already in state and no-ops (mutation-level
 * idempotency by construction — the create-shaped reuse §5.2 r5 describes).
 */
export function deterministicTaskIdFromSeed(seed: string): string {
  const hash = createHash('sha256').update(seed, 'utf8').digest();
  hash[6] = (hash[6]! & 0x0f) | 0x40; // version 4
  hash[8] = (hash[8]! & 0x3f) | 0x80; // variant
  const h = hash.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createIdempotencyStore<T>(opts: IdempotencyStoreOptions = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  const maxEntries = opts.maxEntries ?? DEFAULT_IDEMPOTENCY_MAX_ENTRIES;
  const now = opts.now ?? Date.now;

  // Map iteration order is insertion order — delete+set on write keeps it LRU.
  const entries = new Map<string, { value: T; storedAt: number }>();

  return {
    /** The stored first-attempt result, or null when absent/expired. */
    get(storeKey: string): T | null {
      const e = entries.get(storeKey);
      if (!e) return null;
      const age = now() - e.storedAt;
      if (age >= ttlMs || age < 0) {
        // Negative age = clock jumped backwards. Expire rather than trust a
        // timestamp from the future: the cost is one re-executed mutation,
        // bounded by the write gate; a never-expiring entry is unbounded.
        entries.delete(storeKey);
        return null;
      }
      return e.value;
    },

    put(storeKey: string, value: T): void {
      entries.delete(storeKey);
      entries.set(storeKey, { value, storedAt: now() });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string;
        entries.delete(oldest);
      }
    },

    size(): number {
      return entries.size;
    },

    reset(): void {
      entries.clear();
    },
  };
}
