import { describe, it, expect, vi } from 'vitest';

// sharedUsers.js pulls in webdavFetch (window-dependent) and the iCloud
// transport at module level; neither is exercised by resolveWebDAV, so stub
// them out to keep this a pure node test.
vi.mock('../utils/cloudSyncProviders.js', () => ({ webdavFetch: vi.fn() }));
vi.mock('./icloudFileTransport.js', () => ({ isAvailable: () => false }));

import { resolveWebDAV } from './sharedUsers.js';

// ─────────────────────────────────────────────────────────────────────────────
// resolveWebDAV derives the shared-users WebDAV endpoint from cloudSyncConfig.
// Each provider stores its server location under a DIFFERENT key (nextcloudUrl /
// webdavUrl / none at all for Koofr), so a gate written against one provider's
// key silently disables the feature for the others — the lastGLANCE class-5
// bug family. These pin the per-provider shapes, especially Koofr's fixed root.
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveWebDAV', () => {
  it('returns null when sync is disabled, whatever else is set', () => {
    expect(resolveWebDAV({ enabled: false, provider: 'nextcloud', nextcloudUrl: 'https://nc.example.com', username: 'u', appPassword: 'p' })).toBeNull();
    expect(resolveWebDAV(null)).toBeNull();
    expect(resolveWebDAV(undefined)).toBeNull();
  });

  it('builds the Nextcloud files path (default provider when key is absent)', () => {
    const config = { enabled: true, nextcloudUrl: 'https://nc.example.com/', username: 'user@host', appPassword: 'p' };
    expect(resolveWebDAV(config)).toEqual({
      baseUrl: 'https://nc.example.com/remote.php/dav/files/user%40host',
      username: 'user@host',
      appPassword: 'p',
    });
    expect(resolveWebDAV({ ...config, provider: 'nextcloud' })).toEqual(resolveWebDAV(config));
  });

  it('returns null for a Nextcloud config missing any required field', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'nextcloud', username: 'u', appPassword: 'p' })).toBeNull();
    expect(resolveWebDAV({ enabled: true, provider: 'nextcloud', nextcloudUrl: 'https://nc', appPassword: 'p' })).toBeNull();
    expect(resolveWebDAV({ enabled: true, provider: 'nextcloud', nextcloudUrl: 'https://nc', username: 'u' })).toBeNull();
  });

  it('uses the fixed Koofr WebDAV root — Koofr configs carry no URL key', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'koofr', username: 'u@example.com', appPassword: 'p' })).toEqual({
      baseUrl: 'https://app.koofr.net/dav/Koofr',
      username: 'u@example.com',
      appPassword: 'p',
    });
  });

  it('returns null for a Koofr config missing credentials', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'koofr', username: 'u' })).toBeNull();
    expect(resolveWebDAV({ enabled: true, provider: 'koofr', appPassword: 'p' })).toBeNull();
  });

  it('uses webdavUrl for the generic webdav provider, stripping trailing slashes', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'webdav', webdavUrl: 'https://dav.example.com//', username: 'u', appPassword: 'p' })).toEqual({
      baseUrl: 'https://dav.example.com',
      username: 'u',
      appPassword: 'p',
    });
  });

  it('returns null for a generic config missing webdavUrl', () => {
    expect(resolveWebDAV({ enabled: true, provider: 'webdav', username: 'u', appPassword: 'p' })).toBeNull();
  });
});
