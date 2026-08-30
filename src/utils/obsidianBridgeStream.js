// BRIDGE STREAM, app side — outbound intent emission (Phase 6 PR 2).
//
// Each of the five direct vault-write paths calls emitBridgeIntent alongside
// its write; while the stream is not yet load-bearing (arbitration lands in
// the next PR), a paired vault's plugin applies these intents and the two
// paths CONVERGE — applyBridgeIntent mirrors each transport's composition
// byte-for-byte (pinned by obsidian.bridgeConvergence.test.js), and both
// sides skip byte-identical writes, so double application is a no-op, not a
// double write.
//
// EMISSION IS FIRE-AND-FORGET AND FAIL-SILENT: a stream problem must never
// break a direct vault write. Intents are assigned their id AT WRITE TIME
// and pushed onto a persisted outbox (localStorage) BEFORE any network —
// the GLANCEintents transitionId lesson — then flushed in batches; a failed
// flush leaves them queued for the next emit or sync cycle.
//
// PAIRING META: dayGLANCE devices other than the one that ran pairing never
// saw the pairing salt, so they cannot derive the bridge subkey from the
// root key alone. The plugin publishes the salt as the PLAINTEXT
// meta:pairing row (an HKDF salt is not a secret — the subkey's security
// rests on the root key, which never leaves @glance-apps/sync); this module
// fetches and caches it, and emission simply stays off until it appears —
// "not paired" and "not yet discovered" are the same silent no-op.
//
// meta:config is the mirror-image row THIS side publishes (sealed): the
// few dayGLANCE settings the plugin needs to classify daily notes for its
// outbound observations, refreshed whenever the values change.

import { getVaultConfig } from '../sync/vaultConfig.js';
import { recordOwnWriteSeq } from '../sync/ownWrites.js';
import { hasDbRootKey } from '@glance-apps/sync';
// Sanctioned deep imports (see obsidianBridgePairing.js for the root-key
// rationale; vaultClient keeps the client constructible without the engine).
import { getDbRootKey } from '@glance-apps/sync/src/dbCrypto.js';
import { createVaultClient } from '@glance-apps/sync/src/vaultClient.js';
import {
  deriveBridgeSubkey,
  sealBridgeEnvelope,
  decodePlainBridgeRow,
  mintIntentId,
  BRIDGE_VAULT_APP,
  BRIDGE_PAIRING_META_ID,
  BRIDGE_CONFIG_META_ID,
  BRIDGE_INTENT_PREFIX,
} from '@glance-apps/obsidian-format';

const OUTBOX_KEY = 'dayglance-bridge-outbox';
const META_CACHE_KEY = 'dayglance-bridge-pairing-meta';
const CONFIG_HASH_KEY = 'dayglance-bridge-config-hash';
const META_TTL_MS = 5 * 60 * 1000;
const OUTBOX_CAP = 500;

// Subkey cache, keyed by generation so a re-pair (new salt) re-derives.
let cachedSubkey = null;
let cachedSubkeyGeneration = null;
let flushInFlight = null; // the running flush's promise — callers coalesce
let metaFetchInFlight = null;

// ── THE BRAKE (now device-wide) ──────────────────────────────────────────────
// Born here as the bridge brake (#1481, decay semantics from the 2026-08-30
// live bug), extracted to sync/vaultRequestBrake.js when db-intents — the
// last unbraked GLANCEvault caller — joined it: the server's 600/min budget
// is per IP, one budget for every path on this device, so one brake is the
// honest model (a 429 on any path pauses them all). The names below stay
// exported so this module's callers (and the inbound half) are unchanged;
// noteBridgeRateLimit tags its armings with the bridge's own source label.
import {
  vaultRateLimited,
  isRateLimitError,
  noteVaultRateLimit,
  noteVaultRequestSuccess,
  __resetVaultBrakeForTests,
} from '../sync/vaultRequestBrake.js';

export { isRateLimitError };
export const bridgeRateLimited = (nowMs) => (nowMs === undefined ? vaultRateLimited() : vaultRateLimited(nowMs));
export const noteBridgeRateLimit = () => noteVaultRateLimit('bridge');
export const noteBridgeRequestSuccess = () => noteVaultRequestSuccess();

const readJson = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

const vaultClientOrNull = () => {
  const cfg = getVaultConfig();
  if (!cfg?.enabled || !cfg.vaultUrl || !cfg.vaultToken || !cfg.accountId) return null;
  try {
    return { client: createVaultClient({ vaultUrl: cfg.vaultUrl, vaultToken: cfg.vaultToken }), accountId: cfg.accountId };
  } catch {
    return null;
  }
};

/**
 * The cached pairing meta ({generation, pairingSalt, pairedAt}) or null.
 * Refreshes from the meta:pairing row at most every META_TTL_MS; a vault
 * with no such row (never paired, or unpaired) caches the negative too.
 * `force` bypasses the TTL (still coalescing with an in-flight fetch) —
 * the authority rising edge uses it, because a stale NEGATIVE cached just
 * before pairing completed would otherwise gate emits off for up to a TTL
 * while direct writes have already stopped.
 */
export async function getBridgePairingMeta({ force = false } = {}) {
  const cached = readJson(META_CACHE_KEY, null);
  if (!force && cached && Date.now() - (cached.fetchedAt || 0) < META_TTL_MS) {
    return cached.meta;
  }
  // Under the brake, even a forced refresh serves what we have — the brake
  // exists precisely because more requests won't help right now.
  if (bridgeRateLimited()) return cached?.meta ?? null;
  if (metaFetchInFlight) return metaFetchInFlight;
  const ctx = vaultClientOrNull();
  if (!ctx) return cached?.meta ?? null;
  metaFetchInFlight = (async () => {
    try {
      const row = await ctx.client.getRow(BRIDGE_VAULT_APP, BRIDGE_PAIRING_META_ID, ctx.accountId);
      // The server returns envelope BYTES base64-encoded (see the package's
      // wire note); a malformed/undecodable row reads as not-paired.
      const parsed = row?.envelope ? decodePlainBridgeRow(row.envelope) : null;
      const meta = (parsed?.kind === 'pairing-meta' && parsed.generation && parsed.pairingSalt) ? parsed : null;
      noteBridgeRequestSuccess();
      writeJson(META_CACHE_KEY, { meta, fetchedAt: Date.now() });
      return meta;
    } catch (err) {
      if (isRateLimitError(err)) noteBridgeRateLimit();
      // Unreachable vault: keep whatever we knew; do not thrash.
      return cached?.meta ?? null;
    } finally {
      metaFetchInFlight = null;
    }
  })();
  return metaFetchInFlight;
}

async function getBridgeSubkey(meta) {
  if (!meta || !hasDbRootKey()) return null;
  if (cachedSubkey && cachedSubkeyGeneration === meta.generation) return cachedSubkey;
  try {
    const salt = Uint8Array.from(atob(meta.pairingSalt), (c) => c.charCodeAt(0));
    cachedSubkey = await deriveBridgeSubkey(getDbRootKey(), salt);
    cachedSubkeyGeneration = meta.generation;
    return cachedSubkey;
  } catch {
    return null;
  }
}

/**
 * Queue one intent and kick a flush. Fail-silent by contract; returns
 * whether the intent was durably QUEUED (false = dropped: unpaired vault
 * or storage unavailable) so an authoritative caller — one for which this
 * emission is the write itself — can latch a visible error. The caller
 * passes the type-specific fields; id/timestamps are minted here, before
 * anything that can fail.
 */
export function emitBridgeIntent(type, fields) {
  try {
    // Queue ONLY for a vault known to be paired (the cached meta row, kept
    // fresh by the sync cycle). An unpaired vault must not accrete a
    // backlog: intents queued long before a pairing would apply STALE state
    // to the fresh stream. The cost is at most a few dropped intents right
    // after pairing until the cache refreshes — the direct writes those
    // intents mirrored have already landed, so nothing is lost.
    if (!readJson(META_CACHE_KEY, null)?.meta) return false;
    const outbox = readJson(OUTBOX_KEY, []);
    outbox.push({ v: 1, kind: 'intent', type, intentId: mintIntentId(), createdAt: new Date().toISOString(), ...fields });
    // A vault that unpaired mid-stream must not accrete forever: drop oldest.
    while (outbox.length > OUTBOX_CAP) outbox.shift();
    // Direct setItem, NOT writeJson: a swallowed storage failure would
    // report "queued" for an intent that was never persisted — exactly the
    // silent loss the return value exists to make visible (gate a).
    localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  } catch { return false; }
  void flushBridgeOutbox();
  return true;
}

/**
 * Push everything queued, oldest first, in one batch. Silent no-op unless
 * GLANCEvault is configured, the root key is present, AND the vault is
 * paired (meta row discovered). Returns true when the outbox is empty after
 * the attempt (nothing to send counts).
 */
export async function flushBridgeOutbox() {
  if (flushInFlight) return flushInFlight;
  flushInFlight = doFlush().finally(() => { flushInFlight = null; });
  return flushInFlight;
}

async function doFlush() {
  try {
    if (bridgeRateLimited()) return false; // queued intents wait out the brake
    const outbox = readJson(OUTBOX_KEY, []);
    if (outbox.length === 0) return true;
    const ctx = vaultClientOrNull();
    if (!ctx) return false;
    const meta = await getBridgePairingMeta();
    const subkey = await getBridgeSubkey(meta);
    if (!subkey) return false;
    const rows = [];
    for (const intent of outbox) {
      rows.push({
        entityId: `${BRIDGE_INTENT_PREFIX}${intent.intentId}`,
        envelope: await sealBridgeEnvelope(subkey, intent),
        createdAt: Date.parse(intent.createdAt) || Date.now(),
      });
    }
    const ack = await ctx.client.batch(BRIDGE_VAULT_APP, { accountId: ctx.accountId, rows });
    // Own-echo damping (#1455): bridge writes advance the same per-account
    // seq the engine's do — record the ack so our echo drains nothing.
    recordOwnWriteSeq(ack?.maxSeq);
    noteBridgeRequestSuccess();
    // Only entries we actually sent leave the queue — an emit that raced in
    // during the network call stays for the next flush.
    const sent = new Set(outbox.map((i) => i.intentId));
    const remaining = readJson(OUTBOX_KEY, []).filter((i) => !sent.has(i.intentId));
    writeJson(OUTBOX_KEY, remaining);
    return remaining.length === 0;
  } catch (err) {
    if (isRateLimitError(err)) noteBridgeRateLimit();
    return false; // queued intents survive for the next flush
  }
}

/**
 * Publish the meta:config row the plugin's observation scope needs, when
 * the values changed since last publish. Sealed like any stream row.
 */
export async function publishBridgeConfig({ dailyNotesPath, dailyNotePattern, taskHeading }) {
  try {
    if (bridgeRateLimited()) return; // the unadvanced hash retries next cycle
    const payload = {
      v: 1, kind: 'config',
      dailyNotesPath: dailyNotesPath || '',
      dailyNotePattern: dailyNotePattern || 'yyyy-MM-dd',
      taskHeading: taskHeading || '## Tasks',
    };
    const hash = JSON.stringify(payload);
    if (localStorage.getItem(CONFIG_HASH_KEY) === hash) return;
    const ctx = vaultClientOrNull();
    if (!ctx) return;
    const subkey = await getBridgeSubkey(await getBridgePairingMeta());
    if (!subkey) return;
    const ack = await ctx.client.batch(BRIDGE_VAULT_APP, {
      accountId: ctx.accountId,
      rows: [{ entityId: BRIDGE_CONFIG_META_ID, envelope: await sealBridgeEnvelope(subkey, payload), createdAt: Date.now() }],
    });
    recordOwnWriteSeq(ack?.maxSeq);
    localStorage.setItem(CONFIG_HASH_KEY, hash);
    noteBridgeRequestSuccess();
  } catch (err) {
    if (isRateLimitError(err)) noteBridgeRateLimit();
    /* next cycle retries — the hash was not advanced */
  }
}

/** Test seam: reset module caches (subkey, in-flight flags) + the shared brake. */
export function __resetBridgeStreamForTests() {
  cachedSubkey = null;
  cachedSubkeyGeneration = null;
  flushInFlight = null;
  metaFetchInFlight = null;
  __resetVaultBrakeForTests();
}
