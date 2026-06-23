// Intents DELIVERERS (stage 2a).
//
// A deliverer is the function the durable outbox calls at flush time for one
// transport: `async (intent) => 'delivered' | 'transient' | 'permanent'`. The
// outbox stores and hands over the RAW intent (action + payload + emit metadata,
// keyed by event_id); the deliverer is where the envelope is BUILT and, where
// the transport requires it, ENCRYPTED. So encryption happens at flush, and a
// plaintext envelope is never persisted.
//
// RESULT CONTRACT (never throw to signal an expected failure):
//   'delivered' — landed on the remote (2xx). The outbox drops the target.
//   'transient' — maybe-temporary: no key yet, no connection, network error, 5xx,
//                 429/408. The outbox holds the intent and retries.
//   'permanent' — will never succeed as-is: a 4xx rejecting the row, or a target
//                 that is misconfigured in a way retrying can't fix. The outbox
//                 gives that target up.
// An unexpected throw is also treated as transient by the outbox (never dropped),
// but deliverers should RETURN the result for expected failures, not throw.
//
// This stage builds the deliverers only; wiring them to the outbox and the
// emit-site enqueue is stage 2b. It does NOT derive or cache the vault intents
// key and never prompts for a passphrase — the vault deliverer only LOADS an
// already-cached vault key and returns 'transient' if it is absent.

import {
  buildEnvelope,
  buildEncryptedEnvelope,
  deriveEnvelopeKey,
  buildIntentRow,
} from '@glance-apps/intents';
import { loadIntentsRootKey, loadVaultIntentsRootKey } from './intentsKeyStore.js';
import { writeEventFile, writeEventFileICloud, INTENT_CONFIG_KEY } from './useIntentPoller.js';
import { defaultVaultFetch } from './dbIntentsTransport.js';
import {
  getDbIntentsConnection,
  getDbIntentsConfig,
  DEFAULT_DB_INTENTS_TTL_MS,
} from './dbIntentsConfig.js';
import * as iCloudTransport from './icloudFileTransport.js';

export const DELIVERED = 'delivered';
export const TRANSIENT = 'transient';
export const PERMANENT = 'permanent';

// ─── shared helpers ──────────────────────────────────────────────────────────

// Map a raw outbox intent to the param object the envelope builders expect. The
// event_id is ALWAYS carried through as eventId so the built envelope's id (and
// therefore the vault row's eventId and the WebDAV filename) is stable across
// retries — the vault server is insert-only/idempotent on eventId, so a re-sent
// already-delivered row is a server-side no-op.
function toEnvelopeParams(intent) {
  const eventId = intent.event_id ?? intent.eventId;
  return {
    action: intent.action,
    payload: intent.payload,
    emittedBy: intent.emitted_by ?? intent.emittedBy,
    ...(eventId ? { eventId } : {}),
  };
}

// The WebDAV intents config (shared by the WebDAV and iCloud file tiers). Read
// from localStorage exactly like the existing emit sites do.
function readIntentConfig() {
  try {
    const raw = localStorage.getItem(INTENT_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Map an HTTP-ish status to a deliverer result. 5xx / 429 / 408 are transient
// (retry); other 4xx mean the server rejected the row itself → permanent.
function mapHttpStatus(status) {
  if (status >= 200 && status < 300) return DELIVERED;
  if (status >= 500 || status === 429 || status === 408) return TRANSIENT;
  if (status >= 400) return PERMANENT;
  return TRANSIENT;
}

// ─── file-tier envelope (WebDAV + iCloud share the same encryption policy) ────
//
// Keeps the EXISTING file-tier confidentiality policy unchanged: encrypt iff the
// WebDAV intents config has encryptionEnabled, otherwise plaintext. When
// encryption is on but the WebDAV intents key isn't cached yet (setup
// incomplete / mid-restore), we signal HOLD so the deliverer returns 'transient'
// — never a silent plaintext fallback.
//
// Returns { hold: true } to defer, or { envelope } to send.
async function buildFileTierEnvelope(intent, config, opts) {
  if (config?.encryptionEnabled) {
    const rootKey = await (opts.loadWebdavKey ?? loadIntentsRootKey)();
    if (!rootKey) return { hold: true };
    const deriveKey = (salt) => deriveEnvelopeKey(rootKey, salt);
    return { envelope: await buildEncryptedEnvelope(toEnvelopeParams(intent), deriveKey) };
  }
  return { envelope: buildEnvelope(toEnvelopeParams(intent)) };
}

// ─── 1. VAULT deliverer — ALWAYS ENCRYPTED ───────────────────────────────────

/**
 * Deliver one intent to GLANCEvault. The vault is zero-knowledge: this path is
 * ALWAYS encrypted and has NO plaintext branch. It loads the cached VAULT intents
 * key (its own slot, distinct from the WebDAV key); if that key is absent it
 * sends NOTHING, builds NO envelope, and returns 'transient' so the outbox holds
 * the intent until stage 2b's setup has derived and cached the key.
 *
 * @param {object} intent  - raw outbox intent (action, payload, emit metadata, event_id)
 * @param {object} [opts]  - injection seams for tests (loadKey, connection, config, vaultFetch)
 * @returns {Promise<'delivered'|'transient'|'permanent'>}
 */
export async function vaultDeliverer(intent, opts = {}) {
  const connection = opts.connection ?? getDbIntentsConnection();
  // No vault connection configured yet — hold (may appear); never drop.
  if (!connection) return TRANSIENT;

  // ── load the ALREADY-CACHED vault intents key (its OWN slot) ──
  const rootKey = await (opts.loadKey ?? loadVaultIntentsRootKey)();
  if (!rootKey) {
    // Key not set up yet (or mid-restore). Send nothing, build nothing, hold.
    return TRANSIENT;
  }

  // ── ALWAYS-ENCRYPTED envelope (no plaintext branch, ever) ──
  let envelope;
  try {
    const deriveKey = (salt) => deriveEnvelopeKey(rootKey, salt);
    envelope = await buildEncryptedEnvelope(toEnvelopeParams(intent), deriveKey);
  } catch (err) {
    // Unexpected crypto/build failure — hold rather than drop.
    console.warn('[deliver/vault] envelope build failed:', err?.message);
    return TRANSIENT;
  }

  // ── encode the row and POST /intents/batch (insert-only, idempotent) ──
  const cfg = opts.config ?? getDbIntentsConfig() ?? {};
  const ttlMs = cfg.ttlMs ?? DEFAULT_DB_INTENTS_TTL_MS;
  const row = buildIntentRow(envelope, { ttlMs });
  const body = {
    accountId: connection.accountId,
    events: [{ eventId: row.eventId, envelope: row.envelope, expiresAt: row.expiresAt }],
  };
  const url = connection.vaultUrl.replace(/\/+$/, '') + '/intents/batch';
  const headers = { Authorization: `Bearer ${connection.vaultToken}`, 'Content-Type': 'application/json' };
  const vaultFetch = opts.vaultFetch ?? defaultVaultFetch();

  let res;
  try {
    res = await vaultFetch('POST', url, headers, JSON.stringify(body));
  } catch (err) {
    // Network error — transient.
    console.warn('[deliver/vault] POST network error:', err?.message);
    return TRANSIENT;
  }
  if (!res) return TRANSIENT;
  return mapHttpStatus(res.status);
}

// ─── 2. WEBDAV deliverer — existing encryption policy, durable wrapper ────────

/**
 * Deliver one intent to the WebDAV file tier, preserving WebDAV's EXISTING
 * confidentiality policy (encrypted iff WebDAV encryptionEnabled, else plaintext).
 * This fix changes durability, not WebDAV confidentiality.
 *
 * @param {object} intent
 * @param {object} [opts] - test seams (config, loadWebdavKey, writeEventFile)
 * @returns {Promise<'delivered'|'transient'|'permanent'>}
 */
export async function webdavDeliverer(intent, opts = {}) {
  const config = opts.config ?? readIntentConfig();
  // Not configured for WebDAV — retrying won't write a file. Permanent for this
  // target (the other transports still run independently in the outbox).
  if (!config?.webdavUrl || !config?.username || !config?.appPassword) return PERMANENT;

  const built = await buildFileTierEnvelope(intent, config, opts);
  if (built.hold) return TRANSIENT; // encryption on, key not ready yet

  const put = opts.writeEventFile ?? writeEventFile;
  let res;
  try {
    res = await put(config, built.envelope);
  } catch (err) {
    console.warn('[deliver/webdav] PUT network error:', err?.message);
    return TRANSIENT;
  }
  if (res === undefined) return PERMANENT; // config vanished — won't self-heal
  return mapHttpStatus(res.status);
}

// ─── 3. ICLOUD deliverer — mirrors WebDAV over the iCloud write path ──────────

/**
 * Deliver one intent to the iCloud file tier, same encryption policy as WebDAV.
 * iCloud has no HTTP status: a write either succeeds or doesn't, and both
 * "unavailable" and "write failed" are retryable → 'transient'.
 *
 * @param {object} intent
 * @param {object} [opts] - test seams (config, loadWebdavKey, isAvailable, writeEventFileICloud)
 * @returns {Promise<'delivered'|'transient'|'permanent'>}
 */
export async function icloudDeliverer(intent, opts = {}) {
  const isAvailable = opts.isAvailable ?? iCloudTransport.isAvailable;
  // iCloud not available on this platform/session — may become available; hold.
  if (!isAvailable()) return TRANSIENT;

  const config = opts.config ?? readIntentConfig();
  const built = await buildFileTierEnvelope(intent, config, opts);
  if (built.hold) return TRANSIENT; // encryption on, key not ready yet

  const write = opts.writeEventFileICloud ?? writeEventFileICloud;
  let ok;
  try {
    ok = await write(config, built.envelope);
  } catch (err) {
    console.warn('[deliver/icloud] write error:', err?.message);
    return TRANSIENT;
  }
  return ok ? DELIVERED : TRANSIENT;
}

// Convenience map keyed by the outbox's transport names. Each value is directly
// usable as an outbox deliverer (the second opts arg defaults), so stage 2b can
// pass this straight to flush().
export const deliverers = {
  webdav: webdavDeliverer,
  icloud: icloudDeliverer,
  vault: vaultDeliverer,
};
