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
// The RETIRED localStorage key of the old persisted publish-once guard —
// kept only so publishBridgeConfig can clean it up (see the guard below).
const LEGACY_CONFIG_HASH_KEY = 'dayglance-bridge-config-hash';
const META_TTL_MS = 5 * 60 * 1000;
const OUTBOX_CAP = 500;

// Subkey cache, keyed by generation so a re-pair (new salt) re-derives.
let cachedSubkey = null;
let cachedSubkeyGeneration = null;
let flushInFlight = null; // the running flush's promise — callers coalesce
let metaFetchInFlight = null;
// The publish-once guard for the config row — SESSION-SCOPED ON PURPOSE
// (2026-08-31 config-null incident). The first shape persisted this hash in
// localStorage, which quietly made "restart dayGLANCE" incapable of ever
// republishing the row: a plugin that lost its config (memory-only cache, a
// reload, a row seq below its cursor) had NO reachable recovery short of the
// user hand-deleting the key — and config-null on the plugin side silently
// skipped the entire normalize-then-observe block, turning fail-closed
// stamping into fail-open unstamped reporting (the fragment factory).
// Module memory means every app session republishes once per distinct
// (generation, value) — one cheap sealed row per launch, a reachable
// recovery lever, and no republish storm (the per-cycle caller still
// coalesces on this guard within the session). Keyed on the pairing
// GENERATION as well as the payload: a re-pair rotates the subkey, and a
// row sealed under the old generation is unreadable garbage to the new
// stream even when the VALUES never changed.
let publishedConfigHash = null;

// ── THE BRAKE (now inside the client) ────────────────────────────────────────
// Born here as the bridge brake (#1481, decay semantics from the 2026-08-30
// live bug), extracted app-wide for item 3, and lifted into
// @glance-apps/sync 1.11.0 for item 4: every createVaultClient call is now
// gated, armed, and decayed at module scope inside the package — one brake
// per bundle realm, protection by construction. This module keeps only the
// PRE-FLIGHT reads (isVaultRateLimited) for the paths that prefer to sit a
// whole cycle out rather than fire a call and catch RATE_LIMITED; the
// arming/decay bookkeeping calls are gone — the client does both on the
// real responses. A braked client call throws VaultError { status: 429,
// code: 'RATE_LIMITED' } BEFORE the network; the catch blocks below treat
// that identically to a real 429 (both are "not now"), which err.status
// already covers.
import { isVaultRateLimited, resetVaultDiagnostics } from '@glance-apps/sync';

/** True when the error is the server's rate limiter (or the client's own
 *  braked-call throw — same status, same meaning: not now). */
export const isRateLimitError = (err) => err?.status === 429;
export const bridgeRateLimited = () => isVaultRateLimited();

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
      writeJson(META_CACHE_KEY, { meta, fetchedAt: Date.now() });
      return meta;
    } catch {
      // Unreachable vault or rate-limited (the client armed the brake on a
      // real 429 itself): keep whatever we knew; do not thrash.
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
    // Only entries we actually sent leave the queue — an emit that raced in
    // during the network call stays for the next flush.
    const sent = new Set(outbox.map((i) => i.intentId));
    const remaining = readJson(OUTBOX_KEY, []).filter((i) => !sent.has(i.intentId));
    writeJson(OUTBOX_KEY, remaining);
    return remaining.length === 0;
  } catch {
    // Rate-limited (the client armed on a real 429; a braked retry throws
    // before the wire) or unreachable — queued intents survive either way.
    return false;
  }
}

/**
 * Publish the meta:config row the plugin's observation scope needs, when
 * the values changed since last publish. Sealed like any stream row.
 *
 * blockIdWrites carries the §3.9 block-id WRITE release to the plugin: it
 * gates normalize-then-observe (§3.10 ruling 7) — the plugin stamps
 * untagged task lines before reporting a daily note ONLY when this is
 * exactly true. The plugin's fail-closed contract: no config row seen, or a
 * row from a build predating this field, means NO stamping — not stamping
 * is recoverable (the dayGLANCE-side backstop still covers it), stamping
 * against the user's setting is not.
 */
export async function publishBridgeConfig({ dailyNotesPath, dailyNotePattern, taskHeading, blockIdWrites = false }) {
  try {
    if (bridgeRateLimited()) return; // the unadvanced hash retries next cycle
    const payload = {
      v: 1, kind: 'config',
      dailyNotesPath: dailyNotesPath || '',
      dailyNotePattern: dailyNotePattern || 'yyyy-MM-dd',
      taskHeading: taskHeading || '## Tasks',
      blockIdWrites: blockIdWrites === true,
    };
    const meta = await getBridgePairingMeta();
    // Once per (pairing generation, value) per SESSION — see the
    // publishedConfigHash comment for why this must not be persisted, and
    // why the generation is part of the key (a re-pair's rotated subkey
    // makes the old sealed row unreadable even with identical values).
    const hash = `${meta?.generation ?? ''}|${JSON.stringify(payload)}`;
    if (publishedConfigHash === hash) return;
    const ctx = vaultClientOrNull();
    if (!ctx) return;
    const subkey = await getBridgeSubkey(meta);
    if (!subkey) return;
    const ack = await ctx.client.batch(BRIDGE_VAULT_APP, {
      accountId: ctx.accountId,
      rows: [{ entityId: BRIDGE_CONFIG_META_ID, envelope: await sealBridgeEnvelope(subkey, payload), createdAt: Date.now() }],
    });
    recordOwnWriteSeq(ack?.maxSeq);
    publishedConfigHash = hash;
    // Retire the old persisted guard so no stale key lingers to confuse a
    // future diagnosis (it is never read any more).
    try { localStorage.removeItem(LEGACY_CONFIG_HASH_KEY); } catch { /* storage unavailable */ }
  } catch {
    /* next cycle retries — the hash was not advanced */
  }
}

/** Test seam: reset module caches (subkey, in-flight flags) + the client's
 *  module-scope diagnostics (brake/meter/write-history). */
export function __resetBridgeStreamForTests() {
  cachedSubkey = null;
  cachedSubkeyGeneration = null;
  flushInFlight = null;
  metaFetchInFlight = null;
  publishedConfigHash = null;
  resetVaultDiagnostics();
}
