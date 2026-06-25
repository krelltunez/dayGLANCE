// Durable outbound INTENTS OUTBOX (stage 1: standalone core, not yet wired).
//
// WHY THIS EXISTS
// Intents are currently built in memory and fired fire-and-forget: any failure
// (no encryption key yet, a failed POST/PUT, no connection, an app restart
// mid-send) drops them silently, and the emit-site change-snapshot advances
// before the async send resolves — so the change is forgotten and the intent is
// lost forever. This outbox makes the OUTBOUND side durable: an intent is
// persisted BEFORE any transmit is attempted, retried across flushes and app
// restarts, and only ever leaves the outbox once every target is delivered (or
// genuinely given up).
//
// ENCRYPTION BOUNDARY (hard requirement)
// The outbox persists the RAW intent (action + payload + emit metadata), NEVER a
// built envelope. Envelope construction AND encryption happen inside the injected
// deliverer at flush time — the outbox never builds, sees, or stores an envelope.
// This keeps "encrypt at flush" and "never persist a plaintext envelope to disk"
// structural rather than a convention that could drift.
//
// SELF-CONTAINED
// This module imports NOTHING from the emit sites, the live transports, or
// @glance-apps/intents / @glance-apps/sync. It depends only on a persistent store
// (IndexedDB by default, injectable for tests) and a set of injected deliverer
// functions. It is local-only and never crosses an app boundary, so it needs no
// shared protocol package. Stage 2 wires it into the emit sites and transports.

// ─── delivery result contract ───────────────────────────────────────────────
//
// A deliverer is `(intent) => DeliveryResult | Promise<DeliveryResult>`, where a
// result is one of these constants (or an object carrying `.status`). The
// deliverer is the ONLY place an envelope is built and encrypted; it reports back
// only how the attempt went:
//
//   DELIVERED  — the row/file landed on the remote. Mark that target delivered.
//   TRANSIENT  — a maybe-temporary failure: no network, a 5xx, the vault
//                ENCRYPTION KEY NOT READY (sync not unlocked yet), etc. Leave the
//                target pending and retry on a later flush. This is the bucket
//                that guarantees we never lose an intent just because the key or
//                connection wasn't ready at send time.
//   PERMANENT  — this target will NEVER accept this intent (e.g. a malformed
//                payload the server rejects with 4xx). Give the target up now.
//
// A deliverer that THROWS is treated as TRANSIENT — a thrown POST is exactly the
// "maybe-temporary" case, and defaulting to retry (never drop) is the safe bias.
// Any unrecognized return value is also treated as TRANSIENT for the same reason.
export const DELIVERED = 'delivered';
export const TRANSIENT = 'transient';
export const PERMANENT = 'permanent';

// A deliverer may return { status: TRANSIENT, reason: HELD_NO_KEY_REASON } to
// signal that it held the intent specifically because its encryption key isn't
// set up yet (vs. a network/server transient). flush() surfaces these ids so the
// activity log can show a "waiting for the intents key" state instead of a
// silent stall. Purely observational — it does not change retry behaviour.
export const HELD_NO_KEY_REASON = 'intents_key_not_ready';

// Per-target delivery statuses stored on an entry.
const PENDING = 'pending';
const GIVEN_UP = 'given-up';

// Give-up bound. Deliberately MUCH higher than the receive-side
// MAX_INTENT_RETRIES (5): losing OUTBOUND data is worse than re-attempting, so we
// retry generously and only ever give up on a target that is genuinely
// undeliverable. A target hitting this many consecutive transient failures is
// abandoned (logged loudly) so the outbox can't grow unbounded on a dead target.
export const MAX_OUTBOX_ATTEMPTS = 50;

// ─── IndexedDB-backed default store ──────────────────────────────────────────
//
// Mirrors the storage shape of intentsKeyStore.js (a dedicated DB, a single
// object store). Opened lazily so importing this module never requires a DOM /
// IndexedDB — tests inject their own store and never reach this path.
const DB_NAME = 'dayglance-intents-outbox';
const DB_VERSION = 1;
const STORE = 'entries';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath 'id' === the intent's event_id, so a re-enqueue of the same
        // intent targets the same record (idempotency at the storage layer too).
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txStore(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

/**
 * The persistent store interface the outbox depends on. Any object implementing
 * these four async methods can be injected (tests pass an in-memory fake):
 *
 *   getAll(): Promise<Entry[]>          — all entries (fresh copies)
 *   get(id):  Promise<Entry|undefined>  — one entry by id (a fresh copy)
 *   put(entry): Promise<void>           — insert or overwrite by entry.id
 *   delete(id): Promise<void>           — remove by id
 *
 * IndexedDB inherently structured-clones on read, so callers safely own and may
 * mutate whatever getAll/get returns; in-memory fakes must clone to match.
 */
export function createIndexedDbStore() {
  return {
    async getAll() {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const req = txStore(db, 'readonly').getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
      });
    },
    async get(id) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const req = txStore(db, 'readonly').get(id);
        req.onsuccess = () => resolve(req.result ?? undefined);
        req.onerror = () => reject(req.error);
      });
    },
    async put(entry) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async delete(id) {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

// Lazily-created singleton default store, so module import is side-effect-free.
let _defaultStore = null;
function defaultStore() {
  if (!_defaultStore) _defaultStore = createIndexedDbStore();
  return _defaultStore;
}
function resolveStore(opts) {
  return opts?.store ?? defaultStore();
}

// ─── entry helpers ───────────────────────────────────────────────────────────
//
// Entry shape:
//   {
//     id:        string,                       // === intent.event_id (idempotency key)
//     intent:    object,                       // RAW intent — NEVER an envelope
//     createdAt: number,                       // ms epoch
//     targets:   { [name]: 'pending'|'delivered'|'given-up' },  // per-transport status
//     attempts:  { [name]: number },           // per-transport failure counter
//   }
//
// `attempts` is keyed PER TARGET (not a single entry-wide number) because the
// give-up rule is per-target — "stop retrying THAT target" — so each target's
// failures must be counted independently. An entry that delivered to webdav but
// keeps transient-failing on vault must count only the vault attempts toward the
// vault give-up bound.

function normalizeResult(result) {
  const status = typeof result === 'object' && result !== null ? result.status : result;
  if (status === DELIVERED || status === PERMANENT || status === TRANSIENT) return status;
  // Unknown / undefined (e.g. a deliverer that forgot to return) → retry, never
  // drop. The give-up bound still bounds this at MAX_OUTBOX_ATTEMPTS.
  return TRANSIENT;
}

// True once no target is still 'pending' — every target is delivered or given-up,
// so the entry is as done as it will ever get and can be removed.
function isEntryDone(entry) {
  return Object.values(entry.targets).every((s) => s !== PENDING);
}

function hasPending(entry) {
  return Object.values(entry.targets).some((s) => s === PENDING);
}

// Accept targets as an array of transport names (['webdav','vault']) or as a
// map/object whose keys are the transport names ({ webdav: ..., vault: ... }).
function targetNames(targets) {
  if (Array.isArray(targets)) return [...new Set(targets)];
  if (targets && typeof targets === 'object') return Object.keys(targets);
  return [];
}

// ─── API ─────────────────────────────────────────────────────────────────────

/**
 * Persist a new outbound intent with every target marked 'pending'. Durable
 * before this resolves (the store write has completed).
 *
 * IDEMPOTENT: keyed on intent.event_id. If an entry with that id already exists,
 * this is a no-op and the existing entry is returned unchanged — re-emitting the
 * same intent (retry, double-render) never resets in-flight delivery state.
 *
 * @param {object} intent  - RAW intent; must carry event_id (the idempotency key)
 * @param {string[]|object} targets - enabled transports, e.g. ['webdav','vault']
 * @param {{store?:object}} [opts]
 * @returns {Promise<object>} the stored (or pre-existing) entry
 */
export async function enqueue(intent, targets, opts) {
  const store = resolveStore(opts);
  const id = intent?.event_id;
  if (!id) throw new Error('[outbox] intent.event_id is required as the outbox id');

  const names = targetNames(targets);
  if (names.length === 0) throw new Error('[outbox] at least one target is required');

  const existing = await store.get(id);
  if (existing) return existing; // idempotent no-op — do NOT clobber in-flight state

  const entry = {
    id,
    intent,
    createdAt: Date.now(),
    targets: Object.fromEntries(names.map((n) => [n, PENDING])),
    attempts: Object.fromEntries(names.map((n) => [n, 0])),
  };
  await store.put(entry);
  return entry;
}

// Module-level lock: prevents two overlapping flushes (e.g. a cadence tick racing
// a unlock-triggered flush) from both delivering the same pending target. Mirrors
// the receive drain's dbPollLock. Coarse on purpose — a skipped concurrent flush
// just runs on the next trigger; nothing is lost.
let _flushLock = false;

/**
 * Attempt delivery of every pending target of every entry.
 *
 * For each entry, for each STILL-'pending' target, calls deliverers[target](intent):
 *   - DELIVERED  → mark target 'delivered'.
 *   - TRANSIENT  → leave 'pending', increment that target's attempt counter; if it
 *                  reaches MAX_OUTBOX_ATTEMPTS, give the target up (logged loudly).
 *   - PERMANENT  → give the target up immediately (logged loudly).
 *   - (throws)   → treated as TRANSIENT.
 * A target with no deliverer supplied this flush is left untouched (not a failure,
 * not counted) — it simply wasn't attempted.
 *
 * When an entry has no pending target left (all delivered or given-up), it is
 * removed. An ALREADY-'delivered' target is never re-delivered (idempotent).
 *
 * Overlapping calls are guarded: a flush already in progress makes this a no-op.
 *
 * @param {Record<string, (intent:object)=>any>} deliverers - transportName → deliverer
 * @param {{store?:object}} [opts]
 * @returns {Promise<{attempted:number, delivered:number, gaveUp:number, removed:number, skipped:boolean}>}
 */
export async function flush(deliverers, opts) {
  const store = resolveStore(opts);
  if (_flushLock) return { attempted: 0, delivered: 0, gaveUp: 0, removed: 0, skipped: true };
  _flushLock = true;

  // `delivered`/`gaveUp`/etc. are counts (back-compat). `deliveredIds` and
  // `heldNoKeyIds` carry the event_ids that transitioned this flush so callers
  // can reconcile the activity log (queued → delivered, or queued → held).
  const stats = { attempted: 0, delivered: 0, gaveUp: 0, removed: 0, skipped: false, deliveredIds: [], heldNoKeyIds: [] };
  try {
    const entries = await store.getAll();
    for (const entry of entries) {
      let changed = false;

      for (const target of Object.keys(entry.targets)) {
        if (entry.targets[target] !== PENDING) continue; // delivered or given-up
        const deliver = deliverers?.[target];
        if (typeof deliver !== 'function') continue; // not attempted this flush

        stats.attempted++;
        let raw;
        try {
          raw = await deliver(entry.intent);
        } catch {
          raw = TRANSIENT; // a thrown send is a maybe-transient failure
        }
        const result = normalizeResult(raw);

        if (result === DELIVERED) {
          entry.targets[target] = DELIVERED;
          stats.delivered++;
          if (!stats.deliveredIds.includes(entry.id)) stats.deliveredIds.push(entry.id);
          changed = true;
          continue;
        }

        // Held specifically because the encryption key isn't ready — record it so
        // the activity log can show "waiting for the intents key" rather than a
        // silent stall. (Only while the target is still pending/transient.)
        if (result === TRANSIENT && raw && typeof raw === 'object' && raw.reason === HELD_NO_KEY_REASON) {
          if (!stats.heldNoKeyIds.includes(entry.id)) stats.heldNoKeyIds.push(entry.id);
        }

        // Both transient and permanent count an attempt against the target.
        entry.attempts[target] = (entry.attempts[target] ?? 0) + 1;
        changed = true;

        if (result === PERMANENT) {
          entry.targets[target] = GIVEN_UP;
          stats.gaveUp++;
          console.error(
            `[outbox] GIVING UP on intent ${entry.id} target '${target}': permanent failure (no retry).`,
          );
          continue;
        }

        // TRANSIENT: stay pending unless we've hit the bound.
        if (entry.attempts[target] >= MAX_OUTBOX_ATTEMPTS) {
          entry.targets[target] = GIVEN_UP;
          stats.gaveUp++;
          console.error(
            `[outbox] GIVING UP on intent ${entry.id} target '${target}': ` +
            `${entry.attempts[target]} consecutive transient failures (bound ${MAX_OUTBOX_ATTEMPTS}).`,
          );
        }
      }

      if (isEntryDone(entry)) {
        await store.delete(entry.id);
        stats.removed++;
      } else if (changed) {
        await store.put(entry);
      }
    }
    return stats;
  } finally {
    _flushLock = false;
  }
}

/**
 * Number of entries still holding at least one pending target. For diagnostics
 * and tests; an entry whose targets are all delivered/given-up is not counted
 * (it is removed at flush time anyway).
 * @param {{store?:object}} [opts]
 * @returns {Promise<number>}
 */
export async function pendingCount(opts) {
  const entries = await resolveStore(opts).getAll();
  return entries.filter(hasPending).length;
}

/**
 * All current outbox entries (fresh copies). For diagnostics and tests.
 * @param {{store?:object}} [opts]
 * @returns {Promise<object[]>}
 */
export async function list(opts) {
  return resolveStore(opts).getAll();
}

// Exported for tests.
export { PENDING, GIVEN_UP };
