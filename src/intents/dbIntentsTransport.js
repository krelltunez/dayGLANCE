// App-owned GLANCEvault DB INTENTS transport.
//
// @glance-apps/intents is a CODEC library, not a transport: its src/vault/ codec
// (buildIntentRow, parseIntentRow, parseSince, formatSince) only does
// envelope<->row encoding and cursor formatting. This module is the dayGLANCE-OWNED
// transport that uses those codec helpers to talk to the GLANCEvault intents
// server — exactly mirroring how the existing WebDAV intents transport
// (useIntentPoller.js) is app-owned and uses the package only for the codec.
//
// It runs ALONGSIDE the WebDAV intents transport (which stays the default and is
// untouched), is per-user opt-in, and INHERITS the vault connection from the SYNC
// config (see dbIntentsConfig.js).
//
// Server contract (identical to what lastGLANCE talks to):
//
//   WRITE  POST {vaultUrl}/intents/batch
//     body: { accountId, events: [ { eventId, envelope (base64), expiresAt (ISO) } ] }
//     resp: { written, maxSeq }      — insert-only; a re-sent eventId is a no-op.
//
//   LIST   GET {vaultUrl}/intents/list?accountId=&since=&limit=
//     resp: { rows: [ { eventId, envelope (base64), seq, expiresAt, serverMtime } ], hasMore }
//     seq > since, ascending. Server returns only NON-EXPIRED rows. Page size 500.
//
//   Auth: the same device-token bearer the vault SYNC transport already uses.

import { useEffect, useRef } from 'react';
import {
  parseEncryptedEnvelope,
  deriveEnvelopeKey,
  NoKeyError,
  WrongKeyError,
  NotEncryptedError,
  MalformedEnvelopeError,
  ACTIONS,
  buildIntentRow,
  parseIntentRow,
  parseSince,
  formatSince,
} from '@glance-apps/intents';
import { loadVaultIntentsRootKey } from './intentsKeyStore.js';
import { handleIntent } from './handleIntent.js';
import { logActivity } from './intentLog.js';
import { MULTI_USER_CONFIG_KEY } from './useIntentPoller.js';
import {
  getDbIntentsConfig,
  getDbIntentsConnection,
  isDbIntentsEnabled,
  DEFAULT_DB_INTENTS_TTL_MS,
  DEFAULT_DB_INTENTS_POLL_MINUTES,
} from './dbIntentsConfig.js';

// The RECEIVE cursor lives in its OWN app-owned key, completely separate from the
// send path. It is a seq (number) and advances ONLY from intents actually
// received/processed — sending NEVER touches it (see the advance site below).
const DB_CURSOR_KEY = 'dayglance-db-intent-cursor';
// Per-seq consecutive-failure counters for the bounded-retry model. PERSISTED
// next to the receive cursor because retries span poll cycles (and app reloads):
// an in-memory counter would reset on every reload and never reach the cap.
const DB_RETRY_KEY = 'dayglance-db-intent-retries';
// A row whose handler THROWS this many consecutive times is treated as poison:
// we give up, log loudly, and advance past it so the channel can't wedge forever.
// (Name and value match lastGLANCE.)
const MAX_INTENT_RETRIES = 5;
const PAGE_LIMIT = 500;
const APP_EMITTER = 'app.dayglance';

// The tray popup holds a read-only snapshot and must never poll — processing an
// event would consume it before the main window can act (mirrors useIntentPoller).
const isTrayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tray');

// Module-level lock: prevents React StrictMode's double-mount from running two
// concurrent polls, which would both read the same cursor and double-process.
let dbPollLock = false;

// ─── receive cursor ──────────────────────────────────────────────────────────

// parseSince turns the stored string (or null) into a seq number|null.
function getReceiveCursor() {
  return parseSince(localStorage.getItem(DB_CURSOR_KEY));
}
function setReceiveCursor(seq) {
  localStorage.setItem(DB_CURSOR_KEY, String(seq));
}

// ─── per-seq failure counters (persisted) ────────────────────────────────────

// Map of { [seq]: consecutiveFailureCount }. Only ACTIVELY-failing seqs hold an
// entry — counters are cleared on success and on give-up, so the map never grows
// unbounded for every seq ever seen.
function loadRetries() {
  try { return JSON.parse(localStorage.getItem(DB_RETRY_KEY) || '{}'); } catch { return {}; }
}
function saveRetries(map) {
  if (!map || Object.keys(map).length === 0) localStorage.removeItem(DB_RETRY_KEY);
  else localStorage.setItem(DB_RETRY_KEY, JSON.stringify(map));
}
// Bump and persist the failure count for a seq; returns the new count.
function bumpFailure(seq) {
  const map = loadRetries();
  const next = (map[String(seq)] || 0) + 1;
  map[String(seq)] = next;
  saveRetries(map);
  return next;
}
// Drop a seq's counter (on success or give-up) so the map doesn't leak.
function clearFailure(seq) {
  const map = loadRetries();
  if (map[String(seq)] !== undefined) {
    delete map[String(seq)];
    saveRetries(map);
  }
}

// ─── HTTP (native vs electron vs browser) ────────────────────────────────────

// Mirrors the platform routing the vault SYNC transport uses (dbEngine.js): the
// native bridge and electron proxy both take POSITIONAL (method, url, headers,
// body) and return a plain { status, ok, body } object; the browser path uses
// global fetch and is normalized to the same shape. Returns a function
// (method, url, headers, body) => Promise<{ status, ok, body }>.
export function defaultVaultFetch() {
  const bridge = typeof window !== 'undefined' ? window.DayGlanceNative : null;
  const isNativeApp = !!bridge?.httpRequest;
  const electronProxyFetch = typeof window !== 'undefined' && window.electronAPI?.isElectron
    ? (...args) => window.electronAPI.proxyFetch(...args)
    : null;

  if (isNativeApp) {
    // The native bridge is synchronous and returns a JSON string.
    return async (method, url, headers, body) => {
      let r;
      try { r = JSON.parse(bridge.httpRequest(method, url, JSON.stringify(headers), body ?? '')); }
      catch { throw new TypeError('Failed to fetch'); }
      if (!r) throw new TypeError('Failed to fetch');
      return r;
    };
  }
  if (electronProxyFetch) {
    return async (method, url, headers, body) => {
      let r;
      try { r = await electronProxyFetch(method, url, headers, body ?? null); }
      catch { throw new TypeError('Failed to fetch'); }
      if (!r) throw new TypeError('Failed to fetch');
      return r;
    };
  }
  // Browser / PWA: global fetch, normalized to { status, ok, body }.
  return async (method, url, headers, body) => {
    const res = await globalThis.fetch(url, { method, headers, body: body ?? undefined });
    const text = await res.text();
    return { status: res.status, ok: res.ok, body: text };
  };
}

function authHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

function parseBody(res) {
  if (res == null || res.body == null) return undefined;
  if (typeof res.body !== 'string') return res.body;
  try { return JSON.parse(res.body); } catch { return undefined; }
}

// ─── SEND ─────────────────────────────────────────────────────────────────────

/**
 * POST a batch of outgoing intents to {vaultUrl}/intents/batch.
 *
 * Each envelope is encoded to a row via buildIntentRow (the codec), then wrapped
 * in the server's batch shape { accountId, events: [...] }. Insert-only: re-sending
 * the same eventId is a server-side no-op, so this is safe to retry.
 *
 * Connection/config are inherited from the vault SYNC config + DB intents config
 * unless injected (tests). Returns the parsed server response { written, maxSeq }.
 *
 * IMPORTANT: sending NEVER touches the receive cursor.
 */
export async function sendIntentsDb(envelopes, opts = {}) {
  const connection = opts.connection ?? getDbIntentsConnection();
  if (!connection) return undefined;

  const cfg = opts.config ?? getDbIntentsConfig() ?? {};
  const ttlMs = cfg.ttlMs ?? DEFAULT_DB_INTENTS_TTL_MS;
  const vaultFetch = opts.vaultFetch ?? defaultVaultFetch();

  const list = Array.isArray(envelopes) ? envelopes : [envelopes];
  const events = list.map((envelope) => {
    // Codec: envelope -> { eventId, envelope (opaque base64), expiresAt (ISO) }.
    // The envelope is opaque on the wire; we never decrypt or inspect it here.
    const row = buildIntentRow(envelope, { ttlMs });
    return { eventId: row.eventId, envelope: row.envelope, expiresAt: row.expiresAt };
  });
  if (!events.length) return undefined;

  const body = { accountId: connection.accountId, events };
  const url = connection.vaultUrl.replace(/\/+$/, '') + '/intents/batch';
  const headers = authHeaders(connection.vaultToken, { 'Content-Type': 'application/json' });

  const res = await vaultFetch('POST', url, headers, JSON.stringify(body));
  if (!res || !res.ok) {
    console.warn('[db-intent] batch POST failed:', res?.status);
    return undefined;
  }
  return parseBody(res); // { written, maxSeq }
}

/**
 * Gated single-envelope send for the emit sites. No-ops unless DB intents is
 * enabled. Fire-and-forget; mirrors how writeEventFile no-ops without WebDAV.
 */
export async function sendIntentDb(envelope) {
  if (!isDbIntentsEnabled()) return;
  try {
    await sendIntentsDb(envelope);
  } catch (err) {
    console.warn('[db-intent] send failed:', err.message);
  }
}

// ─── RECEIVE ───────────────────────────────────────────────────────────────────

// Route ONE decoded envelope object (parseIntentRow already base64-decoded it)
// into the app. This mirrors the WebDAV path in useIntentPoller._poll exactly —
// same emitted_by loopback guard, same encrypted-flag branch through the SAME
// envelope parsers (parseEnvelope / parseEncryptedEnvelope), same multi-user
// visibility filter, and into the SAME handler (handleIntent) the WebDAV path
// feeds. It is duplicated rather than shared only to keep the WebDAV transport
// byte-for-byte intact per the change's constraints.
//
// Return contract drives the drain's three-way failure model:
//   'ok'        — consumed cleanly (loopback/multi-user skip, or handleIntent
//                 succeeded). The drain advances the cursor and clears counters.
//   'permanent' — this row will NEVER succeed (decode/decrypt failure, missing
//                 root key, or a SOFT handler failure result.success===false —
//                 the handler deciding it can't process this intent). The drain
//                 advances past it; retrying is pointless.
// A THROWN exception is NOT returned — it propagates to the caller, which treats
// it as a maybe-transient handler error subject to bounded retry.
async function routeIncoming(raw, context, opts = {}) {
  // Skip our own events (loopback). Checked on the raw object before parsing
  // because our notify envelopes use a schema parseEnvelope rejects as malformed.
  if (raw?.emitted_by === APP_EMITTER) return 'ok';

  // Vault rows are decrypted with the VAULT intents key slot (distinct from the
  // WebDAV intents key) — the vault encrypts with that key, so it decrypts with
  // it too. Injectable for tests; defaults to the real vault-slot loader.
  const loadKey = opts.loadKey ?? loadVaultIntentsRootKey;

  let envelope;
  try {
    if (raw?.encrypted === true) {
      const rootKey = await loadKey();
      if (!rootKey) {
        console.warn('[db-intent] Skipping encrypted event — intents encryption not set up');
        logActivity({
          direction: 'in', action: 'unknown', event: null, source_app: null,
          title: null, timestamp: new Date().toISOString(), status: 'error', error: 'no_root_key',
        });
        return 'permanent';
      }
      envelope = await parseEncryptedEnvelope(raw, (salt) => deriveEnvelopeKey(rootKey, salt));
    } else {
      // ZERO-KNOWLEDGE ENFORCEMENT: the vault must ONLY ever carry ciphertext.
      // A row that is not encrypted is a contract violation — REJECT it. Never
      // parse or route it. Treat as permanent-bad so the drain advances past it
      // (no wedge), exactly like an undecodable row.
      console.error(
        '[db-intent] REJECTING plaintext row on vault (zero-knowledge violation); eventId:',
        raw?.event_id ?? null,
      );
      logActivity({
        direction: 'in', action: 'unknown', event: null, source_app: null,
        title: null, timestamp: new Date().toISOString(), status: 'error', error: 'plaintext_rejected',
      });
      return 'permanent';
    }
  } catch (parseErr) {
    let errorCode = parseErr.name ?? 'parse_error';
    // MalformedEnvelopeError = decrypted/parsed fine but failed schema validation
    // (protocol mismatch) — amber, not a genuine key/network failure.
    let logStatus = 'error';
    if (parseErr instanceof NoKeyError) {
      console.warn('[db-intent] Skipping encrypted event (no key)');
    } else if (parseErr instanceof WrongKeyError) {
      console.warn('[db-intent] Skipping encrypted event (wrong key)');
    } else if (parseErr instanceof MalformedEnvelopeError) {
      console.warn('[db-intent] Skipping malformed envelope:', parseErr.message);
      logStatus = 'warn';
    } else if (parseErr instanceof NotEncryptedError) {
      console.warn('[db-intent] Skipping malformed envelope');
    } else {
      console.warn('[db-intent] Unparseable envelope, skipping');
      errorCode = 'parse_error';
    }
    logActivity({
      direction: 'in', action: 'unknown', event: null, source_app: null,
      title: null, timestamp: new Date().toISOString(), status: logStatus, error: errorCode,
    });
    return 'permanent';
  }

  if (envelope.emitted_by === APP_EMITTER) return 'ok';

  // Multi-user visibility filter: skip CREATE intents not assigned to this user.
  if (envelope.action === ACTIONS.CREATE) {
    const multiUserEnabled = JSON.parse(localStorage.getItem('dayglance-multi-user-enabled') || 'false');
    const muRaw = localStorage.getItem(MULTI_USER_CONFIG_KEY);
    const meUserSyncId = muRaw ? JSON.parse(muRaw).meUserSyncId : null;
    if (multiUserEnabled && meUserSyncId) {
      const assigned = envelope.payload.assigned_user_ids ?? [];
      if (assigned.length > 0 && !assigned.includes(meUserSyncId)) {
        logActivity({
          direction: 'in', action: envelope.action, event: null,
          source_app: envelope.payload.source_app ?? envelope.emitted_by ?? null,
          title: envelope.payload.title ?? null, timestamp: envelope.emitted_at,
          status: 'ok', error: null,
        });
        return 'ok';
      }
    }
  }

  // A THROW here propagates to the caller (transient → bounded retry). A returned
  // result.success===false is a SOFT failure: the handler refusing this intent,
  // which won't change on retry → permanent.
  const result = await handleIntent(envelope.action, envelope.payload, { ...context, eventId: envelope.event_id });
  logActivity({
    direction: 'in', action: envelope.action, event: envelope.payload.event ?? null,
    source_app: envelope.payload.source_app ?? envelope.emitted_by ?? null,
    title: envelope.payload.title ?? null, timestamp: envelope.emitted_at,
    status: result.success ? 'ok' : 'error', error: result.success ? null : result.error,
  });
  return result.success ? 'ok' : 'permanent';
}

/**
 * Drain GLANCEvault intents into the app, paginating until the backlog is
 * exhausted. MANDATORY pagination loop: the response is { rows, hasMore } with a
 * page size of 500, so a >500 backlog spans multiple pages. We list from the
 * receive cursor, process every row, advance the cursor to the last consumed
 * row's seq, and — while hasMore is true — list again from the new cursor. We
 * never read .rows just once.
 *
 * Per-row failure handling is three-way:
 *   (1) DECODE / PERMANENT-BAD (unparseable row, decrypt failure, or a SOFT
 *       handler result.success===false) → advance past it; retrying is pointless.
 *   (2) HANDLER THREW (maybe-transient) → do NOT advance; bump a persisted
 *       per-seq counter. At MAX_INTENT_RETRIES consecutive failures the row is
 *       poison: give up, log loudly, advance past it. Below the cap, HOLD —
 *       stop the whole drain (cursor unchanged) so the next poll retries here.
 *   (3) SUCCESS → advance and clear the seq's counter.
 *
 * Connection is inherited from the vault SYNC config unless injected (tests).
 */
export async function pollDbIntents(context, opts = {}) {
  const connection = opts.connection ?? getDbIntentsConnection();
  if (!connection) return;

  const vaultFetch = opts.vaultFetch ?? defaultVaultFetch();
  // Test seam: lets tests drive the three-way model deterministically. Defaults
  // to the real router in production.
  const route = opts.routeIncoming ?? routeIncoming;
  const headers = authHeaders(connection.vaultToken);
  const base = connection.vaultUrl.replace(/\/+$/, '');

  let since = getReceiveCursor(); // seq number|null
  let hasMore = true;

  while (hasMore) {
    const qs = new URLSearchParams({
      accountId: connection.accountId,
      since: formatSince(since), // null -> "0"; otherwise the seq as a string
      limit: String(PAGE_LIMIT),
    }).toString();
    const url = `${base}/intents/list?${qs}`;

    let res;
    try {
      res = await vaultFetch('GET', url, headers);
    } catch (err) {
      console.warn('[db-intent] list error:', err.message);
      return;
    }
    if (!res || !res.ok) {
      console.warn('[db-intent] list returned', res?.status);
      return;
    }

    const payload = parseBody(res);
    if (!payload) {
      console.warn('[db-intent] list: unparseable response body');
      return;
    }
    const rows = Array.isArray(payload.rows) ? payload.rows : [];

    for (const rawRow of rows) {
      // ── (1) DECODE / PERMANENT-BAD ──────────────────────────────────────────
      let parsed;
      try {
        // Codec: decodes the base64 envelope back to an object on parsed.envelope.
        parsed = parseIntentRow(rawRow);
      } catch (err) {
        // Malformed server row — it will never decode. Advance past it (using its
        // seq if available) so the loop can't wedge on a single bad row.
        console.warn('[db-intent] Skipping unparseable row:', err.message);
        logActivity({
          direction: 'in', action: 'unknown', event: null, source_app: null,
          title: null, timestamp: new Date().toISOString(), status: 'error', error: 'row_parse_error',
        });
        if (typeof rawRow?.seq === 'number') {
          clearFailure(rawRow.seq);
          setReceiveCursor(rawRow.seq);
          since = rawRow.seq;
        }
        continue;
      }

      // ── (2) ROUTE: success / permanent / THROW (maybe-transient) ────────────
      let outcome;
      try {
        // 'ok' or 'permanent'; a THROW means a maybe-transient handler error.
        outcome = await route(parsed.envelope, context);
      } catch (err) {
        // HANDLER THREW — treat as maybe-transient. Do NOT advance yet; bump the
        // PERSISTED per-seq counter so the cap is reached even across reloads.
        const failures = bumpFailure(parsed.seq);
        if (failures >= MAX_INTENT_RETRIES) {
          // Poison: it has failed MAX_INTENT_RETRIES times running. Give up so the
          // channel doesn't wedge forever — log loudly, clear the counter, advance.
          console.error(
            `[db-intent] Giving up on intent ${parsed.eventId} (seq ${parsed.seq}) after ${failures} consecutive failures:`,
            err.message,
          );
          logActivity({
            direction: 'in', action: 'unknown', event: null, source_app: null,
            title: null, timestamp: new Date().toISOString(), status: 'error', error: `gave_up_after_${failures}`,
          });
          clearFailure(parsed.seq);
          setReceiveCursor(parsed.seq);
          since = parsed.seq;
          continue;
        }
        // Under the cap: HOLD. Stop the whole drain for this poll (this page AND
        // any further pages), leaving the cursor unadvanced so the next poll
        // retries from here. End cleanly — no uncaught throw.
        console.warn(
          `[db-intent] Holding intent ${parsed.eventId} (seq ${parsed.seq}) for retry ${failures}/${MAX_INTENT_RETRIES}:`,
          err.message,
        );
        return;
      }

      // ── (3) ADVANCE (success or permanent) ──────────────────────────────────
      // Advance ONLY from a row actually received/processed (its seq). Sending
      // never reaches here. Clear any failure counter for this seq on success AND
      // on permanent give-up so the counter map never leaks. NOTE: the server
      // returns only NON-EXPIRED rows, so this cursor can legitimately jump past
      // the seq of an intent that expired (TTL) before this device listed it.
      // That gap is correct/intended, NOT the sync cursor-skip bug — there is
      // simply no row to deliver for that seq.
      void outcome; // 'ok' and 'permanent' both advance; distinction was logged inside routeIncoming
      clearFailure(parsed.seq);
      setReceiveCursor(parsed.seq);
      since = parsed.seq;
    }

    hasMore = payload.hasMore === true;
  }
}

// Serialize concurrent polls (StrictMode double-mount / overlapping triggers).
async function poll(context, opts) {
  if (dbPollLock) return;
  dbPollLock = true;
  try {
    await pollDbIntents(context, opts);
  } finally {
    dbPollLock = false;
  }
}

// ─── hook ──────────────────────────────────────────────────────────────────────

/**
 * Mounts the DB intents RECEIVE poller alongside the WebDAV poller. No-ops unless
 * DB intents is enabled (its own flag + an inherited vault connection). Matches
 * the WebDAV intents cadence: poll on startup, on focus (visibilitychange), and
 * on an interval. Receive-only — there is no push; sends happen at the emit sites.
 *
 * context shape: same as useIntentPoller (tasks, setters, goals, navigate, …).
 */
export function useDbIntentPoller(context) {
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (isTrayMode) return;
    if (!isDbIntentsEnabled()) return;

    const cfg = getDbIntentsConfig() ?? {};
    const intervalMs = (cfg.pollIntervalMinutes ?? DEFAULT_DB_INTENTS_POLL_MINUTES) * 60 * 1000;
    let timerId = null;
    let destroyed = false;

    const scheduleNext = () => {
      if (destroyed) return;
      timerId = setTimeout(runPoll, intervalMs);
    };

    const runPoll = async () => {
      if (destroyed) return;
      try {
        await poll(contextRef.current);
      } catch (err) {
        console.warn('[db-intent] poll error:', err.message);
      }
      scheduleNext();
    };

    const onVisibilityChange = () => {
      if (!document.hidden) {
        clearTimeout(timerId);
        runPoll();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    runPoll(); // initial poll on mount

    return () => {
      destroyed = true;
      clearTimeout(timerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);
}

// Exported for tests.
export { DB_CURSOR_KEY, DB_RETRY_KEY, MAX_INTENT_RETRIES, routeIncoming };
