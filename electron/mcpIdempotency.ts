// dayGLANCE's create-side idempotency (spec §5.2). The replay store, the key
// validation and the scoped store key live in @glance-apps/mcp-host; what
// stays here is how a create tool derives its new entity's id from the
// caller's idempotency key, which is dayGLANCE's (the handleIntent.js
// precedent).

import { createHash } from 'node:crypto';

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
