// GLANCEvault credential pre-save verification (Test Connection).
//
// Verifies entered vault credentials BEFORE the user saves/enables, closing the
// gap where bad vault credentials saved silently and only failed (invisibly) at
// first sync. The probe is an authenticated GET /salt/:accountId — the exact call
// the vault intents key setup already uses (setupVaultIntentsEncryption) — issued
// through the SAME vault client + native-safe fetch path the vault SYNC/intents
// transports use. It does NOT use a plain global fetch (which fails inside the
// native WebView), and it does NOT save, activate, or derive any key.
//
// This is React-free and fully injectable so it works on every platform and tests
// can drive each outcome without network/IndexedDB.

import { createVaultClient } from '@glance-apps/sync';
import { defaultVaultFetch } from '../intents/dbIntentsTransport.js';
import { adaptFetchForVaultClient } from '../intents/vaultIntentsSetup.js';

// Typed, DISTINCT outcomes. `ok: true` means the credentials are good enough to
// save — that includes SALT_NOT_ESTABLISHED, which is a FRESH account before its
// first sync (the vault legitimately has no salt yet). Reporting that as an error
// would wrongly block first-device setup, so it is ACCEPTABLE, not a failure.
export const VAULT_TEST_OUTCOMES = {
  SUCCESS: 'SUCCESS',
  SALT_NOT_ESTABLISHED: 'SALT_NOT_ESTABLISHED',
  AUTH_FAILURE: 'AUTH_FAILURE',
  FORBIDDEN: 'FORBIDDEN',
  NETWORK: 'NETWORK',
  SERVER_ERROR: 'SERVER_ERROR',
  BAD_INPUT: 'BAD_INPUT',
};

/**
 * Probe the vault with the entered credentials and classify the result.
 *
 * @param {{vaultUrl?:string, vaultToken?:string, accountId?:string}} credentials
 * @param {object} [opts] - injection seams for tests/wiring:
 *   vaultClient (default createVaultClient(...) over the native-safe fetch),
 *   fetchImpl   (positional raw fetch; default defaultVaultFetch())
 * @returns {Promise<{ok:boolean, code:string, message:string, status?:number}>}
 *   never rejects — every failure mode is classified into a typed outcome.
 */
export async function testVaultConnection(credentials = {}, opts = {}) {
  const vaultUrl = (credentials.vaultUrl || '').trim();
  const vaultToken = (credentials.vaultToken || '').trim();
  const accountId = (credentials.accountId || '').trim();

  if (!vaultUrl || !vaultToken || !accountId) {
    return {
      ok: false,
      code: VAULT_TEST_OUTCOMES.BAD_INPUT,
      message: 'Enter the vault URL, device token, and account ID first.',
    };
  }

  let client;
  try {
    // SAME client + native-safe transport the vault intents setup uses, so the
    // probe rides the working native/electron/browser fetch path (no plain
    // global fetch that would fail inside the native WebView).
    client = opts.vaultClient
      ?? createVaultClient({
        vaultUrl,
        vaultToken,
        fetchImpl: adaptFetchForVaultClient(opts.fetchImpl ?? defaultVaultFetch()),
      });
  } catch {
    // createVaultClient throws synchronously only on a missing url/token (guarded
    // above) or no fetch implementation — treat as unreachable.
    return {
      ok: false,
      code: VAULT_TEST_OUTCOMES.NETWORK,
      message: 'Could not reach the vault at this URL.',
    };
  }

  try {
    const salt = await client.getSalt(accountId);
    if (salt) {
      return { ok: true, code: VAULT_TEST_OUTCOMES.SUCCESS, message: 'Connected.' };
    }
    // getSalt returns null on a 404 OR an empty salt body: the account has no
    // salt registered yet. This is a brand-new account before its first sync —
    // ACCEPTABLE, not a failure. Do NOT invent a salt and do NOT block setup.
    return {
      ok: true,
      code: VAULT_TEST_OUTCOMES.SALT_NOT_ESTABLISHED,
      message: 'Connected — this account will be initialized on first sync.',
    };
  } catch (err) {
    // createVaultClient.getSalt throws a VaultError carrying the HTTP `status` on
    // any non-OK, non-404 response; the transport throws a plain TypeError
    // ('Failed to fetch') with NO status on a network/DNS/bad-URL failure.
    const status = err?.status;
    if (status === 401) {
      return {
        ok: false,
        code: VAULT_TEST_OUTCOMES.AUTH_FAILURE,
        message: 'Device token is incorrect.',
        status,
      };
    }
    if (status === 403) {
      return {
        ok: false,
        code: VAULT_TEST_OUTCOMES.FORBIDDEN,
        message: 'Account ID not found or not permitted for this token.',
        status,
      };
    }
    if (typeof status === 'number' && status >= 500) {
      // 5xx — the server errored. A vault too old to support this app surfaces
      // here (or only at real sync, via key verification); flag it clearly.
      return {
        ok: false,
        code: VAULT_TEST_OUTCOMES.SERVER_ERROR,
        message: `The vault returned a server error (${status}). It may be misconfigured or need updating.`,
        status,
      };
    }
    if (typeof status === 'number') {
      // Any other unexpected HTTP status from the salt endpoint.
      return {
        ok: false,
        code: VAULT_TEST_OUTCOMES.SERVER_ERROR,
        message: `The vault rejected the request (status ${status}).`,
        status,
      };
    }
    // No status → network unreachable, bad URL, DNS failure, CORS, etc.
    return {
      ok: false,
      code: VAULT_TEST_OUTCOMES.NETWORK,
      message: 'Could not reach the vault at this URL.',
    };
  }
}
