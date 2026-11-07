// Idempotency for MCP writes (dayGLANCE MCP spec §5.2): agents retry, and a
// replayed idempotency_key must not produce a second mutation. Pure factory
// with an injectable clock.
//
// WHAT THIS STORES: the finished tool result of the first attempt, keyed by
// (token, tool, idempotency_key). A replay inside the TTL returns that stored
// result verbatim — the mutation is never re-invoked.
//
// Keys are scoped per (token, tool): the same key on a different tool is a
// different operation, and another client (different token) can never replay
// — or poison — this client's results.
//
// TTL exists because agents retry on the seconds-to-minutes scale; remembering
// keys forever would make the map an unbounded leak (§3.7: module scope, but
// bounded). LRU cap is the backstop against a key-generating runaway loop.

export const DEFAULT_IDEMPOTENCY_TTL_MS = 10 * 60_000;
export const DEFAULT_IDEMPOTENCY_MAX_ENTRIES = 500;

/**
 * A caller-supplied key must be shaped like an id, not a payload.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidIdempotencyKey(value) {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[\w.:-]+$/.test(value);
}

/**
 * @param {string} token
 * @param {string} tool
 * @param {string} idempotencyKey
 * @returns {string}
 */
export function makeStoreKey(token, tool, idempotencyKey) {
  // Length-prefixed segments so no crafted key can collide across fields
  // (("a","b:c") and ("a:b","c") must not meet at "a:b:c").
  return [token, tool, idempotencyKey].map((s) => `${s.length}.${s}`).join('|');
}

/**
 * @param {{ ttlMs?: number, maxEntries?: number, now?: () => number }} [opts]
 */
export function createIdempotencyStore(opts = {}) {
  const ttlMs = opts.ttlMs ?? DEFAULT_IDEMPOTENCY_TTL_MS;
  const maxEntries = opts.maxEntries ?? DEFAULT_IDEMPOTENCY_MAX_ENTRIES;
  const now = opts.now ?? Date.now;

  // Map iteration order is insertion order — delete+set on write keeps it LRU.
  const entries = new Map();

  return {
    /** The stored first-attempt result, or null when absent/expired. */
    get(storeKey) {
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

    put(storeKey, value) {
      entries.delete(storeKey);
      entries.set(storeKey, { value, storedAt: now() });
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        entries.delete(oldest);
      }
    },

    size() {
      return entries.size;
    },

    reset() {
      entries.clear();
    },
  };
}
