const LOG_KEY = 'dayglance-intent-activity-log';
const MAX_ENTRIES = 100;

/**
 * Append one activity entry to the log. Thread-safe at the JS single-thread
 * level; trimmed to MAX_ENTRIES on every write.
 */
export function logActivity(entry) {
  const existing = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
  const updated = [{ ...entry, id: crypto.randomUUID() }, ...existing].slice(0, MAX_ENTRIES);
  localStorage.setItem(LOG_KEY, JSON.stringify(updated));
}

export function getActivityLog() {
  return JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
}

export function clearActivityLog() {
  localStorage.removeItem(LOG_KEY);
}

// ─── delivery reconciliation ─────────────────────────────────────────────────
//
// Outbound entries are logged at ENQUEUE time with delivery:'queued'. The actual
// vault/WebDAV POST happens later, in the outbox flush. These helpers let the
// flush callers fold that later outcome back into the matching log entry so the
// UI can show queued → delivered (or queued → held, waiting for the intents key)
// instead of a permanently optimistic "sent".

// Forward-only ordering: a higher index means a later delivery state. We never
// move an entry backwards (e.g. a stray held signal must not un-deliver a row).
const DELIVERY_ORDER = { queued: 0, held: 1, delivered: 2 };

/**
 * Set the delivery state of the most recent OUTBOUND log entry for `eventId`.
 * No-op (returns false) if there is no matching entry, or if the change would
 * move the state backwards or leave it unchanged — so repeated flushes don't
 * rewrite the log or spam it. Only mutates the matched entry.
 *
 * @param {string} eventId
 * @param {'queued'|'held'|'delivered'} delivery
 * @returns {boolean} true iff an entry was updated
 */
export function setDeliveryStatus(eventId, delivery) {
  if (!eventId) return false;
  const entries = getActivityLog();
  const idx = entries.findIndex(e => e.direction === 'out' && e.event_id === eventId);
  if (idx === -1) return false;

  const entry = entries[idx];
  const current = entry.delivery ?? 'queued';
  if ((DELIVERY_ORDER[delivery] ?? 0) <= (DELIVERY_ORDER[current] ?? 0)) return false;

  // 'held' is rendered from the delivery state itself (a known, single reason),
  // so it deliberately does NOT touch `error` — that field stays reserved for
  // genuine failures and their red treatment.
  entries[idx] = { ...entry, delivery };
  localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  return true;
}

/**
 * Fold a flush() result into the activity log: mark delivered ids 'delivered',
 * and ids held for a missing key 'held'. Safe to call after every flush; the
 * forward-only / no-op-on-unchanged guard in setDeliveryStatus keeps it cheap.
 *
 * @param {{deliveredIds?: string[], heldNoKeyIds?: string[]}} [result]
 */
export function reconcileOutboxActivity(result) {
  if (!result) return;
  for (const id of result.deliveredIds ?? []) {
    setDeliveryStatus(id, 'delivered');
  }
  for (const id of result.heldNoKeyIds ?? []) {
    setDeliveryStatus(id, 'held');
  }
}
