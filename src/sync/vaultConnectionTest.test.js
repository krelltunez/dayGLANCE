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

  // #2445: the Android/iOS bridge and the desktop proxy answer "never
  // connected" with a status-0 RESULT, not a throw. Through the real vault
  // client that used to become "The vault rejected the request (status 0)".
  it('native bridge failure shape (status 0, error) → NETWORK with the bridge reason', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 0, ok: false, body: '', error: 'Failed to connect to /10.10.10.11:19991',
    }));
    const res = await testVaultConnection(CREDS, { fetchImpl });

    expect(res.ok).toBe(false);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.NETWORK);
    expect(res.message).toBe('Could not reach the vault at this URL (Failed to connect to /10.10.10.11:19991).');
    expect(res.message).not.toContain('rejected');
  });

  it('desktop proxy failure shape (status 0, statusText) → NETWORK with the reason', async () => {
    const fetchImpl = vi.fn(async () => ({
      status: 0, ok: false, statusText: 'connect ECONNREFUSED 127.0.0.1:8080', body: '', headers: { etag: null },
    }));
    const res = await testVaultConnection(CREDS, { fetchImpl });

    expect(res.code).toBe(VAULT_TEST_OUTCOMES.NETWORK);
    expect(res.message).toContain('ECONNREFUSED');
  });

  it('a status-0 error from an injected client is NETWORK, never SERVER_ERROR', async () => {
    const vaultClient = { getSalt: vi.fn(async () => { throw Object.assign(new Error('get salt failed: 0'), { status: 0 }); }) };
    const res = await testVaultConnection(CREDS, { vaultClient });

    expect(res.code).toBe(VAULT_TEST_OUTCOMES.NETWORK);
    expect(res.message).toBe('Could not reach the vault at this URL.');
  });

  it('a real HTTP status the bridge carries is still the vault answering', async () => {
    const fetchImpl = vi.fn(async () => ({ status: 418, ok: false, body: '' }));
    const res = await testVaultConnection(CREDS, { fetchImpl });

    expect(res.code).toBe(VAULT_TEST_OUTCOMES.SERVER_ERROR);
    expect(res.status).toBe(418);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Issue #1642: on desktop the Electron proxy refuses a private address before
// the request leaves the machine. That refusal used to surface as the proxy's
// synthetic 400, which the classifier reported as "The vault rejected the
// request (status 400)" — pointing the user at a server that never saw the
// call. The pre-flight inspector gives it its own outcome instead.
// ─────────────────────────────────────────────────────────────────────────────
describe('testVaultConnection — private address block (desktop)', () => {
  it('BLOCKED: a grantable private address reports canGrant and never probes', async () => {
    const vaultClient = { getSalt: vi.fn(async () => SALT) };
    const inspectProxyTrust = vi.fn(async () => ({
      blocked: true, canGrant: true, origin: 'https://vault.example.com', addresses: ['100.101.102.103'],
    }));

    const res = await testVaultConnection(CREDS, { vaultClient, inspectProxyTrust });

    expect(inspectProxyTrust).toHaveBeenCalledWith('https://vault.example.com');
    // The credentials must NOT go out to a host the proxy will refuse anyway.
    expect(vaultClient.getSalt).not.toHaveBeenCalled();
    expect(res.ok).toBe(false);
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.BLOCKED_PRIVATE_ADDRESS);
    expect(res.canGrant).toBe(true);
    expect(res.origin).toBe('https://vault.example.com');
    expect(res.message).toContain('private network');
  });

  it('BLOCKED: a reserved address that cannot be granted reports canGrant false', async () => {
    const inspectProxyTrust = vi.fn(async () => ({
      blocked: true, canGrant: false, origin: 'https://169.254.169.254', reason: 'Private/reserved address',
    }));
    const res = await testVaultConnection(CREDS, { vaultClient: { getSalt: vi.fn() }, inspectProxyTrust });

    expect(res.code).toBe(VAULT_TEST_OUTCOMES.BLOCKED_PRIVATE_ADDRESS);
    expect(res.canGrant).toBe(false);
  });

  it('an unblocked URL falls straight through to the normal probe', async () => {
    const vaultClient = { getSalt: vi.fn(async () => SALT) };
    const inspectProxyTrust = vi.fn(async () => ({ blocked: false }));
    const res = await testVaultConnection(CREDS, { vaultClient, inspectProxyTrust });

    expect(vaultClient.getSalt).toHaveBeenCalledWith('acct-1');
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.SUCCESS);
  });

  it('a throwing inspector is a diagnostic, not a gate — the probe still runs', async () => {
    const vaultClient = { getSalt: vi.fn(async () => SALT) };
    const inspectProxyTrust = vi.fn(async () => { throw new Error('ipc gone'); });
    const res = await testVaultConnection(CREDS, { vaultClient, inspectProxyTrust });

    expect(vaultClient.getSalt).toHaveBeenCalled();
    expect(res.code).toBe(VAULT_TEST_OUTCOMES.SUCCESS);
  });
});
