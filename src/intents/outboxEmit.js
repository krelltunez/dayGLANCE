// Shared emit→outbox bridge used by all three emit sites.
//
// Enqueues each built RAW intent durably, then triggers a flush. Returns whether
// EVERY intent was durably enqueued — the caller (the notify hooks) advances its
// change-snapshot ONLY when this is true, so a failed enqueue never consumes a
// change (it gets re-detected and re-enqueued next time). Encryption is NOT done
// here: it happens at flush, inside each per-target deliverer.
//
// Dependencies are injectable so the emit sites are testable without IndexedDB.

import { enqueue as defaultEnqueue, flush as defaultFlush } from './outbox.js';
import { deliverers as defaultDeliverers } from './deliverers.js';

/**
 * @param {Array<{intent:object, onOk?:Function, onError?:(err:Error)=>void}>} items
 * @param {Array<'webdav'|'icloud'|'vault'>} targets
 * @param {object} [deps] - { enqueue, flush, deliverers } (defaults to the real ones)
 * @returns {Promise<boolean>} true iff every intent was durably enqueued
 */
export async function enqueueAndFlush(items, targets, deps = {}) {
  const enqueue = deps.enqueue ?? defaultEnqueue;
  const flush = deps.flush ?? defaultFlush;
  const deliverers = deps.deliverers ?? defaultDeliverers;

  let allEnqueued = true;
  for (const item of items) {
    try {
      await enqueue(item.intent, targets);   // durable before return
      item.onOk?.();
    } catch (err) {
      // A failed ENQUEUE (rare) must NOT advance the caller's snapshot.
      allEnqueued = false;
      item.onError?.(err);
    }
  }

  // Trigger delivery; the outbox's in-flight lock serializes overlapping flushes.
  await flush(deliverers);
  return allEnqueued;
}
