/**
 * Intents over Direct Access: the event-set file (docs/direct-access-sync.md,
 * Phase 7).
 *
 * The WebDAV and iCloud intents transports are built on a directory: one file
 * per event, found by listing. An iPhone on Nextcloud, Drive or Dropbox holds
 * bookmarks to files and cannot list a directory or create a file by name, so
 * this transport is built on the one primitive every platform has, a single
 * file, and is the same on desktop, Android and iPhone:
 *
 *   GLANCE/events/glance-events.json = { version: 1, events: [envelope, …] }
 *
 * holding every live envelope, plaintext or encrypted exactly as the WebDAV
 * transport builds them. The file is a SET keyed by event_id:
 *
 *   • The merge is a union that drops envelopes past retention, order-
 *     independent and idempotent, so any two copies converge whichever order
 *     they are merged in. A syncing tool's last-writer-wins on a collision
 *     loses an append, and a conflicted copy is inert; the next merge repairs
 *     both.
 *   • A sender writes its own events and keeps them until they stick: the
 *     ledger holds what this device emitted within retention, and a copy of
 *     the file that lost one gets it back from here. Nobody re-adds another
 *     device's events: the sender is the one responsible for them.
 *   • A receiver reads, never writes for what it read: it handles the
 *     envelopes above its cursor that it did not emit, and advances the
 *     cursor, exactly as the directory loops do over a listing.
 *   • Garbage collection is the merge: expired envelopes fall out of the
 *     union, and the device that drops them writes only under the relay rule
 *     (sync/snapshotFileSync.js relayDecision), so an idle fleet does not take
 *     turns rewriting the file. A sender's own write carries pending drops.
 *
 * Everything here is pure over an injected transport (`eventsRead`,
 * `eventsWrite`: by path on desktop and Android, a bookmarked file on iOS)
 * and storage; the React side is useDirectAccessIntents.js.
 */

import {
  parseEnvelope, parseEncryptedEnvelope, deriveEnvelopeKey,
  NoKeyError, WrongKeyError, NotEncryptedError, MalformedEnvelopeError, ACTIONS,
} from '@glance-apps/intents';
import { classifySnapshotText, relayDecision, relayWaitMs, noteWriter } from '../sync/snapshotFileSync.js';
import { loadIntentsRootKey } from './intentsKeyStore.js';
import { handleIntent as defaultHandleIntent } from './handleIntent.js';
import { logActivity as defaultLogActivity } from './intentLog.js';
import { INTENT_CONFIG_KEY, MULTI_USER_CONFIG_KEY } from './useIntentPoller.js';

export const EVENTS_FILENAME = 'glance-events.json';
export const DEFAULT_EVENTS_PATH = '/GLANCE/events/';
export const DEFAULT_RETENTION_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
/** This app, as envelopes name it: its own events are never handled. */
export const SELF = 'app.dayglance';
/** Per-transport cursor (the WebDAV and iCloud loops share theirs). */
export const DIRECT_ACCESS_INTENT_CURSOR_KEY = 'dayglance-direct-access-intent-cursor';
/** The sender ledger: { [event_id]: envelope } this device emitted, within retention. */
export const DIRECT_ACCESS_INTENT_LEDGER_KEY = 'dayglance-direct-access-intent-ledger';

const defaultStorage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

/** 'GLANCE/events/glance-events.json', relative to the folder, from the WebDAV-style eventsPath. */
export const relativeEventsPath = (eventsPath) =>
  `${(eventsPath ?? DEFAULT_EVENTS_PATH).replace(/^\/+/, '').replace(/\/+$/, '')}/${EVENTS_FILENAME}`;

/** Retention from the shared intents config (gcRetentionDays), default 30 days. */
export function retentionMsFrom(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(INTENT_CONFIG_KEY);
    const days = raw ? JSON.parse(raw)?.gcRetentionDays : null;
    return (Number.isFinite(days) && days > 0 ? days : DEFAULT_RETENTION_DAYS) * ONE_DAY_MS;
  } catch {
    return DEFAULT_RETENTION_DAYS * ONE_DAY_MS;
  }
}

// ─── the set ─────────────────────────────────────────────────────────────────

/** When an envelope was emitted: its stamp, else the timestamp its id starts with; null when neither parses. */
export function eventTime(envelope) {
  const stamp = Date.parse(envelope?.emitted_at ?? '');
  if (Number.isFinite(stamp)) return stamp;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/.exec(envelope?.event_id ?? '');
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return Number.isFinite(t) ? t : null;
}

export const isLive = (envelope, now, retentionMs) => {
  const t = eventTime(envelope);
  return t !== null && now - t <= retentionMs;
};

/**
 * The union of two sets, keyed by event_id, without expired envelopes, in id
 * order. Order-independent and idempotent: merge(a, b) = merge(b, a), and
 * merge(merge(a, b), b) = merge(a, b). Copies of one id are the same envelope
 * (ids are unique at emit), so the first seen is kept.
 */
export function mergeEventSets(a, b, { now, retentionMs }) {
  const byId = new Map();
  for (const e of [...(a ?? []), ...(b ?? [])]) {
    if (!e || typeof e !== 'object' || typeof e.event_id !== 'string') continue;
    if (!isLive(e, now, retentionMs)) continue;
    if (!byId.has(e.event_id)) byId.set(e.event_id, e);
  }
  return [...byId.values()].sort((x, y) => x.event_id.localeCompare(y.event_id));
}

/** What a write would change: the ids, in order. */
export const eventSetKey = (events) => events.map((e) => e.event_id).join('\n');
export const serializeEventSet = (events, writtenBy = null) =>
  JSON.stringify(writtenBy ? { version: 1, writtenBy, events } : { version: 1, events });

/**
 * The file's text as the cycle reads it: the snapshot classification (absent,
 * downloading, unparseable, error) plus 'set' with the envelopes, or
 * 'no-data' for JSON that is not an event set.
 */
export function parseEventSetText(text) {
  const read = classifySnapshotText(text);
  if (read.kind !== 'snapshot') return read;
  const events = read.remote?.events;
  if (!Array.isArray(events)) return { kind: 'no-data' };
  return { kind: 'set', events, writtenBy: typeof read.remote.writtenBy === 'string' ? read.remote.writtenBy : null };
}

// ─── the ledger and the cursor ───────────────────────────────────────────────

export function readLedger(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem(DIRECT_ACCESS_INTENT_LEDGER_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLedger(ledger, storage = defaultStorage()) {
  try {
    if (Object.keys(ledger).length === 0) storage?.removeItem(DIRECT_ACCESS_INTENT_LEDGER_KEY);
    else storage?.setItem(DIRECT_ACCESS_INTENT_LEDGER_KEY, JSON.stringify(ledger));
  } catch { /* storage unavailable: the outbox still holds the intent */ }
}

/** Records an envelope this device emitted. Idempotent by event_id. */
export function ledgerAppend(envelope, storage = defaultStorage()) {
  if (!envelope || typeof envelope.event_id !== 'string') return;
  const ledger = readLedger(storage);
  if (!ledger[envelope.event_id]) {
    ledger[envelope.event_id] = envelope;
    writeLedger(ledger, storage);
  }
}

/** The live ledger entries, in id order; expired ones are pruned on the way. */
export function ledgerLive(storage, now, retentionMs) {
  const ledger = readLedger(storage);
  const live = {};
  let pruned = false;
  for (const [id, e] of Object.entries(ledger)) {
    if (isLive(e, now, retentionMs)) live[id] = e;
    else pruned = true;
  }
  if (pruned) writeLedger(live, storage);
  return Object.values(live).sort((x, y) => x.event_id.localeCompare(y.event_id));
}

export const getCursor = (storage) => { try { return storage?.getItem(DIRECT_ACCESS_INTENT_CURSOR_KEY) || null; } catch { return null; } };
export const setCursor = (storage, id) => { try { storage?.setItem(DIRECT_ACCESS_INTENT_CURSOR_KEY, id); } catch { /* ignore */ } };

// ─── receiving one envelope ──────────────────────────────────────────────────

const logSkip = (log, status, error) => log({
  direction: 'in', action: 'unknown', event: null, source_app: null, title: null,
  timestamp: new Date().toISOString(), status, error,
});

/**
 * Handles one raw envelope from the set the way the WebDAV loop handles one
 * file: never this app's own; an encrypted one through the WebDAV intents
 * root key (none → logged, skipped); the multi-user visibility filter; then
 * handleIntent, with the outcome in the activity log. Never throws for a bad
 * envelope: the cycle advances the cursor past it either way.
 *
 * @returns {Promise<{handled: boolean, skipped?: string, success?: boolean}>}
 */
export async function receiveEnvelope(raw, context, deps = {}) {
  const handle = deps.handleIntent ?? defaultHandleIntent;
  const log = deps.logActivity ?? defaultLogActivity;
  const loadKey = deps.loadKey ?? loadIntentsRootKey;
  const storage = deps.storage ?? defaultStorage();

  if (raw?.emitted_by === SELF) return { handled: false, skipped: 'own' };

  let envelope;
  try {
    if (raw?.encrypted === true) {
      const rootKey = await loadKey();
      if (!rootKey) {
        console.warn('[intent/direct-access] Skipping encrypted event — intents encryption not set up:', raw?.event_id);
        logSkip(log, 'error', 'no_root_key');
        return { handled: false, skipped: 'no_root_key' };
      }
      envelope = await parseEncryptedEnvelope(raw, (salt) => deriveEnvelopeKey(rootKey, salt));
    } else {
      envelope = parseEnvelope(raw);
    }
  } catch (parseErr) {
    let errorCode = parseErr?.name ?? 'parse_error';
    let logStatus = 'error';
    if (parseErr instanceof NoKeyError || parseErr instanceof WrongKeyError) {
      console.warn('[intent/direct-access] Skipping encrypted event:', parseErr.name, raw?.event_id);
    } else if (parseErr instanceof MalformedEnvelopeError) {
      console.warn('[intent/direct-access] Skipping malformed envelope:', raw?.event_id, parseErr.message);
      logStatus = 'warn';
    } else if (parseErr instanceof NotEncryptedError) {
      console.warn('[intent/direct-access] Skipping malformed envelope:', raw?.event_id);
    } else {
      console.warn('[intent/direct-access] Unparseable envelope, skipping:', raw?.event_id);
      errorCode = 'parse_error';
    }
    logSkip(log, logStatus, errorCode);
    return { handled: false, skipped: errorCode };
  }

  if (envelope.emitted_by === SELF) return { handled: false, skipped: 'own' };

  // Multi-user visibility filter: a CREATE assigned to other users is not ours.
  if (envelope.action === ACTIONS.CREATE) {
    let multiUserEnabled = false;
    let meUserSyncId = null;
    try {
      multiUserEnabled = JSON.parse(storage?.getItem('dayglance-multi-user-enabled') || 'false');
      const muRaw = storage?.getItem(MULTI_USER_CONFIG_KEY);
      meUserSyncId = muRaw ? JSON.parse(muRaw).meUserSyncId : null;
    } catch { /* unreadable config: no filter */ }
    if (multiUserEnabled && meUserSyncId) {
      const assigned = envelope.payload.assigned_user_ids ?? [];
      if (assigned.length > 0 && !assigned.includes(meUserSyncId)) {
        log({
          direction: 'in', action: envelope.action, event: null,
          source_app: envelope.payload.source_app ?? envelope.emitted_by ?? null,
          title: envelope.payload.title ?? null, timestamp: envelope.emitted_at, status: 'ok', error: null,
        });
        return { handled: false, skipped: 'not-assigned' };
      }
    }
  }

  const result = await handle(envelope.action, envelope.payload, { ...context, eventId: envelope.event_id });
  log({
    direction: 'in', action: envelope.action, event: envelope.payload.event ?? null,
    source_app: envelope.payload.source_app ?? envelope.emitted_by ?? null,
    title: envelope.payload.title ?? null, timestamp: envelope.emitted_at,
    status: result.success ? 'ok' : 'error', error: result.success ? null : result.error,
  });
  return { handled: true, success: !!result.success };
}

// ─── the cycle ───────────────────────────────────────────────────────────────

/**
 * One cycle over the event-set file: read, merge (file ∪ this device's
 * ledger, minus expired), receive what is new and not ours, write when the
 * merged set differs from the file and the write is this device's to make
 * (an event of its own the file lacks goes out now; anything else, which can
 * only be a drop, waits for the relay rule).
 *
 * @param {object} args
 * @param {object} args.transport  eventsSupported, eventsRead(relPath), eventsWrite(relPath, text), writeThrottleMs?, id?
 * @param {object} args.io
 * @param {Storage} [args.io.storage]
 * @param {number} [args.io.retentionMs]
 * @param {string} [args.io.eventsPath]   the WebDAV-style events directory ('/GLANCE/events/')
 * @param {(raw: object) => Promise<void>} [args.io.receive]  absent: a sender-only cycle (the deliverer), no cursor moves
 * @param {string|(() => string)} [args.io.deviceId]  stamped as `writtenBy`; ranks this device's relay (sync/snapshotFileSync.js relayWaitMs)
 * @param {string} [args.io.writersKey]  where the writers seen are kept (default: the snapshot cycle's key for this transport, so the fleet is ranked once)
 * @param {() => number} [args.io.now]
 * @param {Console} [args.io.log]
 * @param {{lastWriteAt: number, pendingWrite: object|null}} args.state
 * @returns {Promise<{state: object, outcome: object}>}
 *   outcome.kind: 'skipped' (reason: 'unsupported' | 'downloading' | 'unparseable' | 'no-data')
 *                 'error'   (reason: 'unavailable', error)
 *                 'merged'  (received, wrote, deferred, own, confirmed: string[], dropped)
 *                 own: an event of this device's was missing from the file
 *                 confirmed: this device's ledger events the file already held
 */
export async function runEventSetCycle({ transport, io = {}, state }) {
  const now = io.now ?? Date.now;
  const log = io.log ?? console;
  const storage = io.storage ?? defaultStorage();
  const retentionMs = io.retentionMs ?? DEFAULT_RETENTION_DAYS * ONE_DAY_MS;
  const next = { lastWriteAt: state?.lastWriteAt ?? 0, pendingWrite: state?.pendingWrite ?? null };
  if (!transport?.eventsSupported?.()) return { state: next, outcome: { kind: 'skipped', reason: 'unsupported' } };

  const relPath = relativeEventsPath(io.eventsPath);
  const read = parseEventSetText(await transport.eventsRead(relPath));
  if (read.kind === 'error') return { state: next, outcome: { kind: 'error', reason: 'unavailable', error: read.error } };
  if (read.kind !== 'set' && read.kind !== 'absent') return { state: next, outcome: { kind: 'skipped', reason: read.kind } };
  const fileEvents = read.kind === 'absent' ? [] : read.events;
  const deviceId = (() => {
    try { const v = typeof io.deviceId === 'function' ? io.deviceId() : io.deviceId; return typeof v === 'string' && v ? v : null; }
    catch { return null; }
  })();
  const writersKey = io.writersKey ?? `${transport.lastSyncedKey ?? transport.id ?? 'direct-access'}:writers`;
  if (read.kind === 'set' && read.writtenBy !== deviceId) noteWriter(storage, writersKey, read.writtenBy);

  const own = ledgerLive(storage, now(), retentionMs);
  const merged = mergeEventSets(fileEvents, own, { now: now(), retentionMs });
  const fileIds = new Set(fileEvents.map((e) => e?.event_id));

  // Receive: above the cursor, not ours, in id order; the cursor moves past
  // every envelope looked at, handled or not, as the directory loops do.
  let received = 0;
  if (typeof io.receive === 'function') {
    const cursor = getCursor(storage);
    for (const e of merged) {
      if (cursor && e.event_id <= cursor) continue;
      if (e.emitted_by !== SELF) {
        try { await io.receive(e); received++; }
        catch (err) { log.warn(`[${transport.id ?? 'direct-access'}] intent handling failed:`, err?.message ?? err); }
      }
      setCursor(storage, e.event_id);
    }
  }

  // Write: own additions now; drops under the relay rule.
  const fileKey = eventSetKey(fileEvents.filter((e) => e && typeof e.event_id === 'string'));
  const mergedKey = eventSetKey(merged);
  const changed = mergedKey !== fileKey;
  const ownMissing = own.some((e) => !fileIds.has(e.event_id));
  const confirmed = own.filter((e) => fileIds.has(e.event_id)).map((e) => e.event_id);
  const throttledWrite = async () => {
    if (now() - next.lastWriteAt < (transport.writeThrottleMs ?? 0)) return false;
    next.lastWriteAt = now();
    const ok = await transport.eventsWrite(relPath, serializeEventSet(merged, deviceId));
    if (!ok) log.error(`[${transport.id ?? 'direct-access'}] event set write failed`);
    return ok;
  };
  let wrote = false;
  let deferred = false;
  if (changed && ownMissing) {
    wrote = await throttledWrite();
    next.pendingWrite = null;
  } else if (changed) {
    const decision = relayDecision(next.pendingWrite, `${fileKey}\u0000${mergedKey}`, now(), relayWaitMs(storage, writersKey, deviceId));
    next.pendingWrite = decision.pending;
    if (decision.write) wrote = await throttledWrite();
    else deferred = true;
  } else {
    next.pendingWrite = null;
  }
  const dropped = fileEvents.length - merged.filter((e) => fileIds.has(e.event_id)).length;
  return { state: next, outcome: { kind: 'merged', received, wrote, deferred, own: ownMissing, confirmed, dropped } };
}

// One cycle at a time per process: the deliverer's sender cycle and the
// poller's receive cycle both read and write the same file. The union makes
// an interleaving safe (a lost append is re-added from the ledger), but
// serialising them spares the collision.
let chain = Promise.resolve();
export function withEventsLock(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * The deliverer's half: record the envelope in this device's ledger, run a
 * sender-only cycle (no receive), and report whether the file holds the event
 * once read back. The ledger keeps it until retention either way, so a copy
 * of the file that loses it gets it back on a later cycle.
 *
 * @returns {Promise<boolean>} true once the file has been read back with the event in it
 */
export async function publishOwnEvent(transport, envelope, io = {}) {
  const storage = io.storage ?? defaultStorage();
  ledgerAppend(envelope, storage);
  return withEventsLock(async () => {
    const { outcome } = await runEventSetCycle({ transport, io: { ...io, storage, receive: undefined }, state: io.state ?? { lastWriteAt: 0, pendingWrite: null } });
    if (outcome.kind !== 'merged') return false;
    if (outcome.confirmed.includes(envelope.event_id)) return true;
    if (!outcome.wrote) return false;
    const back = parseEventSetText(await transport.eventsRead(relativeEventsPath(io.eventsPath)));
    return back.kind === 'set' && back.events.some((e) => e?.event_id === envelope.event_id);
  });
}
