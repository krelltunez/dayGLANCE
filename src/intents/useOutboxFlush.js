// Drives the durable outbox: periodically (and on mount / focus) flushes any
// queued outbound intents through their deliverers. This is the "background
// drain" half of the outbox — the emit sites also flush immediately on enqueue,
// but this hook guarantees anything persisted from a PREVIOUS session (or held
// because a transport/key wasn't ready) eventually goes out.
//
// Cadence mirrors the WebDAV intents poller's foreground interval + focus
// trigger. flush() has its own in-flight lock, so overlapping triggers (mount +
// focus + interval, or a racing emit-time flush) collapse to one drain.

import { useEffect } from 'react';
import { flush } from './outbox.js';
import { deliverers } from './deliverers.js';
import { reconcileOutboxActivity } from './intentLog.js';

const isTrayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tray');

// Match the WebDAV poller's foreground cadence (2 minutes).
const FLUSH_INTERVAL_MS = 2 * 60 * 1000;

async function drain() {
  try {
    const result = await flush(deliverers);
    // Reflect delivered / held-for-key outcomes back into the activity log,
    // including intents carried over (held) from a previous session.
    reconcileOutboxActivity(result);
  } catch (err) {
    console.warn('[outbox] flush error:', err?.message);
  }
}

/**
 * Mounts the outbox background drain. No-ops in tray mode (the tray must never
 * consume/send intents — it mirrors the read-only snapshot poller guard).
 */
export function useOutboxFlush() {
  useEffect(() => {
    if (isTrayMode) return;

    let timerId = null;
    let destroyed = false;

    const scheduleNext = () => {
      if (destroyed) return;
      timerId = setTimeout(runDrain, FLUSH_INTERVAL_MS);
    };
    const runDrain = async () => {
      if (destroyed) return;
      await drain();
      scheduleNext();
    };
    const onVisibilityChange = () => {
      if (!document.hidden) {
        clearTimeout(timerId);
        runDrain();
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    runDrain(); // mount drain — clears anything held from a previous session

    return () => {
      destroyed = true;
      clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}

// Exported so callers (e.g. the vault-intents enable flow) can request an
// immediate drain after a key becomes available, without mounting the hook.
export { drain as flushOutboxNow };
