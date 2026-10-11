import { describe, it, expect, vi } from 'vitest';
import { createProviders } from '@glance-apps/sync';
import {
  inspectPrivateAddress,
  providerServerUrl,
  testFileTierConnection,
  BLOCKED_PRIVATE_ADDRESS,
} from './proxyTrustPreflight.js';

// Desktop pre-flight in front of the file-tier Test Connection (#2024). The
// Electron proxy refuses a private-network server until its origin is granted
// and answers with a synthetic 400 the server never saw; the pre-flight reports
// that instead and hands the form what it needs to offer the grant.

// The real provider definitions, so a renamed URL field fails here rather than
// silently turning the pre-flight off.
const providers = createProviders({ appFolderName: 'GLANCE/dayglance', syncFilename: 'dayglance-sync.json' });

const LAN = 'https://10.10.10.2:18800/webdav/';
const webdavConfig = { provider: 'webdav', webdavUrl: LAN, username: 'u', appPassword: 'p' };
const grantable = { blocked: true, canGrant: true, origin: 'https://10.10.10.2:18800', addresses: ['10.10.10.2'] };

describe('providerServerUrl', () => {
  it('reads the typed server URL for WebDAV and Nextcloud, and none for Koofr', () => {
    expect(providerServerUrl(providers.webdav, webdavConfig)).toBe(LAN);
    expect(providerServerUrl(providers.nextcloud, { nextcloudUrl: ' http://nas.local ' })).toBe('http://nas.local');
    expect(providerServerUrl(providers.koofr, { username: 'a', appPassword: 'b' })).toBeNull();
    expect(providerServerUrl(providers.webdav, { webdavUrl: '' })).toBeNull();
  });
});

describe('inspectPrivateAddress', () => {
  it('reports a refused origin and whether it can be granted', async () => {
    expect(await inspectPrivateAddress(LAN, async () => grantable))
      .toEqual({ canGrant: true, origin: 'https://10.10.10.2:18800' });
    expect(await inspectPrivateAddress('http://0.0.0.0', async () => ({ blocked: true, canGrant: false, origin: 'http://0.0.0.0' })))
      .toEqual({ canGrant: false, origin: 'http://0.0.0.0' });
  });

  it('is a diagnostic, never a gate: no inspector, a pass, or a throw all read as not blocked', async () => {
    expect(await inspectPrivateAddress(LAN, null)).toBeNull();
    expect(await inspectPrivateAddress(LAN, async () => ({ blocked: false }))).toBeNull();
    expect(await inspectPrivateAddress(LAN, async () => { throw new Error('ipc gone'); })).toBeNull();
  });

  it('off desktop (no electronAPI) there is no inspector', async () => {
    expect(await inspectPrivateAddress(LAN)).toBeNull();
  });
});

describe('testFileTierConnection', () => {
  it('a private WebDAV server without a grant is reported as blocked and never probed', async () => {
    const probe = vi.fn();
    const inspect = vi.fn(async () => grantable);
    const res = await testFileTierConnection(webdavConfig, { provider: providers.webdav, probe, inspectProxyTrust: inspect });
    expect(inspect).toHaveBeenCalledWith(LAN);
    expect(probe).not.toHaveBeenCalled();
    expect(res).toEqual({ success: false, code: BLOCKED_PRIVATE_ADDRESS, canGrant: true, origin: 'https://10.10.10.2:18800' });
  });

  it('Nextcloud inspects its own server URL', async () => {
    const inspect = vi.fn(async () => grantable);
    const config = { provider: 'nextcloud', nextcloudUrl: 'https://10.10.10.2:18800', username: 'u', appPassword: 'p' };
    const res = await testFileTierConnection(config, { provider: providers.nextcloud, probe: vi.fn(), inspectProxyTrust: inspect });
    expect(inspect).toHaveBeenCalledWith('https://10.10.10.2:18800');
    expect(res.code).toBe(BLOCKED_PRIVATE_ADDRESS);
  });

  it('a granted or public server goes straight to the real probe, whose result is returned as is', async () => {
    const probe = vi.fn(async () => ({ success: true }));
    const res = await testFileTierConnection(webdavConfig, { provider: providers.webdav, probe, inspectProxyTrust: async () => ({ blocked: false }) });
    expect(probe).toHaveBeenCalledWith(webdavConfig);
    expect(res).toEqual({ success: true });
  });

  it('Koofr, a fixed public host, skips the pre-flight', async () => {
    const inspect = vi.fn();
    const probe = vi.fn(async () => ({ success: true }));
    await testFileTierConnection({ provider: 'koofr', username: 'a', appPassword: 'b' }, { provider: providers.koofr, probe, inspectProxyTrust: inspect });
    expect(inspect).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalled();
  });

  it('without an inspector (browser, mobile) it probes exactly as before', async () => {
    const probe = vi.fn(async () => ({ success: false, error: 'Unexpected response: 500' }));
    const res = await testFileTierConnection(webdavConfig, { provider: providers.webdav, probe });
    expect(probe).toHaveBeenCalledWith(webdavConfig);
    expect(res).toEqual({ success: false, error: 'Unexpected response: 500' });
  });
});
