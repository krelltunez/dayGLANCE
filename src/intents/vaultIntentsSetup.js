// GLANCEvault INTENTS key setup (stage 2b-i).
//
// Creates the cached VAULT intents root key that the vault deliverer (stage 2a)
// reads via loadVaultIntentsRootKey. The key is derived ONCE — from the sync
// passphrase and the vault's server-stored salt — and cached in its own slot so
// it survives reloads without the passphrase (exactly like the WebDAV intents
// key). This mirrors setupIntentsEncryption (the WebDAV path) byte-for-byte; the
// ONLY difference is the salt source: the vault's /salt/:accountId value instead
// of the WebDAV salt file. Same passphrase + same salt ⇒ identical key across
// GLANCE apps.
//
// This module is React-free and fully injectable so the enable-toggle handler
// can call it before reload, and tests can drive it without network/IndexedDB.

import { deriveIntentsRootKey } from '@glance-apps/intents';
import { createVaultClient } from '@glance-apps/sync';
import { getSyncPassphrase } from '../utils/crypto.js';
import { getDbIntentsConnection } from './dbIntentsConfig.js';
import { defaultVaultFetch } from './dbIntentsTransport.js';
import { loadVaultIntentsRootKey, storeVaultIntentsRootKey } from './intentsKeyStore.js';

export class VaultIntentsSetupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'VaultIntentsSetupError';
    this.code = code;
  }
}

// createVaultClient's fetchImpl uses the (url, init) -> Response-like signature,
// but defaultVaultFetch (the native/electron-safe fetch the DB transport uses)
// is POSITIONAL: (method, url, headers, body) -> { status, ok, body }. Adapt the
// latter to the former — the same shaping src/sync/dbEngine.js does for the sync
// vault client — so getSalt routes through the exact transport the DB intents
// path already uses on every platform.
export function adaptFetchForVaultClient(rawFetch) {
  return async (url, { method = 'GET', headers = {}, body } = {}) => {
    const r = await rawFetch(method, url, headers, body ?? null);
    if (!r) throw new TypeError('Failed to fetch');
    return {
      status: r.status,
      ok: r.ok,
      json: async () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? '')),
    };
  };
}

/**
 * Derive and cache the vault intents root key from the passphrase + the vault's
 * server-stored salt. Must be called while the passphrase is in memory (before
 * the enable-toggle reload).
 *
 * @param {string} passphrase - the sync passphrase
 * @param {object} [opts] - injection seams for tests/wiring:
 *   connection  (default getDbIntentsConnection()),
 *   fetchImpl   (positional raw fetch; default defaultVaultFetch()),
 *   vaultClient (default createVaultClient(...) over the adapted fetch),
 *   storeKey    (default storeVaultIntentsRootKey)
 * @returns {Promise<CryptoKey>} the derived (and now cached) root key
 * @throws {VaultIntentsSetupError} NO_CONNECTION / NO_VAULT_SALT
 */
export async function setupVaultIntentsEncryption(passphrase, opts = {}) {
  const connection = opts.connection ?? getDbIntentsConnection();
  if (!connection) {
    throw new VaultIntentsSetupError('No GLANCEvault connection configured.', 'NO_CONNECTION');
  }
  const { vaultUrl, vaultToken, accountId } = connection;

  const client = opts.vaultClient
    ?? createVaultClient({
      vaultUrl,
      vaultToken,
      fetchImpl: adaptFetchForVaultClient(opts.fetchImpl ?? defaultVaultFetch()),
    });

  // The vault's account salt is SERVER-OWNED and created by sync. If it's absent,
  // sync hasn't established it yet — surface that rather than inventing a salt: a
  // fabricated salt would derive a key that diverges from every other device and
  // never decrypt sibling apps' rows.
  const salt = await client.getSalt(accountId);
  if (!salt) {
    throw new VaultIntentsSetupError(
      'GLANCEvault has no encryption salt yet. Run GLANCEvault sync once to establish it, then enable vault intents.',
      'NO_VAULT_SALT',
    );
  }

  // EXACT same derivation as the WebDAV intents path (setupIntentsEncryption),
  // only the salt differs. Cache into the vault slot (distinct from WebDAV).
  const rootKey = await deriveIntentsRootKey(passphrase, salt);
  await (opts.storeKey ?? storeVaultIntentsRootKey)(rootKey);
  return rootKey;
}

/**
 * Ensure a vault intents key is cached, deriving it now if the passphrase is
 * available. Distinguishes "passphrase missing" (the caller must prompt) from
 * "already set up" and from real errors.
 *
 * @param {object} [opts] - loadKey (default loadVaultIntentsRootKey),
 *   getSyncPassphrase (default getSyncPassphrase), plus all setup opts.
 * @returns {Promise<{ok:true, alreadySetUp?:true} | {ok:false, needsPassphrase:true}>}
 * @throws {VaultIntentsSetupError} on a real setup error (no connection / no salt)
 */
export async function ensureVaultIntentsKey(opts = {}) {
  // 1. Already cached? Nothing to do.
  const existing = await (opts.loadKey ?? loadVaultIntentsRootKey)();
  if (existing) return { ok: true, alreadySetUp: true };

  // 2. Passphrase available? (DISTINCT from "connection present" — the connection
  //    can be configured while the passphrase is null after a reload.)
  const passphrase = (opts.getSyncPassphrase ?? getSyncPassphrase)();
  if (!passphrase) return { ok: false, needsPassphrase: true };

  // 3-4. Derive + cache now, while the passphrase is in memory.
  await setupVaultIntentsEncryption(passphrase, opts);
  return { ok: true };
}

/**
 * Best-effort self-heal wrapper around ensureVaultIntentsKey for the app's
 * unlock/drain wiring. NEVER throws — so it can be called before an intents drain,
 * on passphrase unlock, or after the file://→app:// origin migration (which starts
 * with an empty, origin-partitioned IndexedDB store) without risking sync, unlock,
 * or the drain itself. Idempotent: a no-op when the vault intents key is already
 * cached. Returns true iff the key is present after the call.
 *
 * @param {object} [opts] passed through to ensureVaultIntentsKey (injection seams)
 * @returns {Promise<boolean>}
 */
export async function ensureVaultIntentsKeyReady(opts = {}) {
  try {
    const res = await ensureVaultIntentsKey(opts);
    if (res.ok) {
      if (!res.alreadySetUp) {
        console.info('[vault-intents] root key derived + cached into the vault-root-key slot (inbound intents can now decrypt)');
      }
      return true;
    }
    // needsPassphrase — can't derive yet (passphrase not in memory). A later unlock
    // or drain retries; the intents drain holds harmlessly until then.
    return false;
  } catch (err) {
    // NO_CONNECTION / NO_VAULT_SALT / transient network — defer, never break.
    console.warn('[vault-intents] key derivation deferred:', err?.code || err?.message || err);
    return false;
  }
}
