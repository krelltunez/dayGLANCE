import { describe, it, expect, vi } from 'vitest';
import { testVaultConnection, VAULT_TEST_OUTCOMES } from './vaultConnectionTest.js';

// ─────────────────────────────────────────────────────────────────────────────
// Pre-save vault credential check. Exercises the typed-outcome classifier with
// the vault client injected (opts.vaultClient) — no network — and one end-to-end
// case that drives the REAL createVaultClient + adaptFetchForVaultClient over an
// injected POSITIONAL fetch shaped exactly like defaultVaultFetch()'s native
// bridge result, confirming the probe rides the native-safe transport.
// ─────────────────────────────────────────────────────────────────────────────

const CREDS = { vaultUrl: 'https://vault.example.com', vaultToken: 'tok-123', accountId: 'acct-1' };
const SALT = new Uint8Array(16).fill(5);

// A VaultError-like throw: createVaultClient.getSalt throws with an HTTP `status`.
function httpError(status) {
  const e = new Error(`get salt failed: ${status}`);
  e.status = status;
  return e;
}

describe('testVaultConnection', () => {
  it('SUCCESS: salt returned → ok, Connected.', async () => {
    const vaultClient = { getSalt: vi.fn(async () => SALT) };
    const res = await testVaultConnection(CREDS, { vaultClient });

    expect(vaultClient.getSalt).toHaveBeenCalledWith('acct-1');
    expect(res.ok).toBe(true);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.SUCCESS);
    expect(res.message).toBe('Connected.');
  });

  it('SALT-NOT-ESTABLISHED: null salt (fresh account) → ACCEPTABLE, not an error', async () => {
    const vaultClient = { getSalt: vi.fn(async () => null) }; // 404 / empty salt body
    const res = await testVaultConnection(CREDS, { vaultClient });

    // The one outcome easy to get wrong: a brand-new account legitimately has no
    // salt yet. Must be ok:true so it does not block first-device setup.
    expect(res.ok).toBe(true);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.SALT_NOT_ESTABLISHED);
    expect(res.message).toBe('Connected — this account will be initialized on first sync.');
  });

  it('AUTH FAILURE: 401 → device token is incorrect', async () => {
    const vaultClient = { getSalt: vi.fn(async () => { throw httpError(401); }) };
    const res = await testVaultConnection(CREDS, { vaultClient });

    expect(res.ok).toBe(false);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.AUTH_FAILURE);
    expect(res.message).toBe('Device token is incorrect.');
  });

  it('FORBIDDEN: 403 → account id not found / not permitted', async () => {
    const vaultClient = { getSalt: vi.fn(async () => { throw httpError(403); }) };
    const res = await testVaultConnection(CREDS, { vaultClient });

    expect(res.ok).toBe(false);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.FORBIDDEN);
    expect(res.message).toBe('Account ID not found or not permitted for this token.');
  });

  it('NETWORK: a thrown TypeError with no status → unreachable', async () => {
    const vaultClient = { getSalt: vi.fn(async () => { throw new TypeError('Failed to fetch'); }) };
    const res = await testVaultConnection(CREDS, { vaultClient });

    expect(res.ok).toBe(false);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.NETWORK);
    expect(res.message).toBe('Could not reach the vault at this URL.');
  });

  it('SERVER_ERROR: 5xx → clear server/needs-updating message', async () => {
    const vaultClient = { getSalt: vi.fn(async () => { throw httpError(503); }) };
    const res = await testVaultConnection(CREDS, { vaultClient });

    expect(res.ok).toBe(false);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.SERVER_ERROR);
    expect(res.message).toMatch(/503/);
  });

  it('BAD_INPUT: missing fields → never hits the network', async () => {
    const vaultClient = { getSalt: vi.fn() };
    const res = await testVaultConnection({ vaultUrl: '', vaultToken: '', accountId: '' }, { vaultClient });

    expect(res.ok).toBe(false);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.BAD_INPUT);
    expect(vaultClient.getSalt).not.toHaveBeenCalled();
  });

  it('native-safe transport: builds the real client over a POSITIONAL fetch and GETs /salt/:accountId', async () => {
    // Mirrors defaultVaultFetch()'s native/electron contract:
    //   (method, url, headers, body) -> { status, ok, body } (body a JSON string).
    // Passing this through adaptFetchForVaultClient + createVaultClient (NO
    // vaultClient injected) proves the probe reaches the vault via the same
    // native-safe path vault sync uses — not a plain global fetch.
    const fetchImpl = vi.fn(async (method, url) => ({
      status: 200,
      ok: true,
      body: JSON.stringify({ salt: 'AAAA' }), // valid base64 → non-null salt
      _method: method,
      _url: url,
    }));

    const res = await testVaultConnection(CREDS, { fetchImpl });

    expect(res.ok).toBe(true);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.SUCCESS);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [method, url] = fetchImpl.mock.calls[0];
    expect(method).toBe('GET');
    expect(url).toBe('https://vault.example.com/salt/acct-1');
  });

  it('native-safe transport: a positional fetch that throws → NETWORK', async () => {
    // defaultVaultFetch throws TypeError('Failed to fetch') when the native bridge
    // can't complete the request; the probe must classify that as unreachable.
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const res = await testVaultConnection(CREDS, { fetchImpl });

    expect(res.ok).toBe(false);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.NETWORK);
  });
});
