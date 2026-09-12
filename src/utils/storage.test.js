import { describe, it, expect, afterEach, vi } from 'vitest';
import { getIndexedDbUsage } from './storage.js';

// navigator.storage.estimate() reports every storage bucket at once, and for
// dayGLANCE that total is dominated by the service worker precache: roughly 4 MB
// of application bundle. Reporting it as app data would be worse than reporting
// nothing, so only the `usageDetails` breakdown counts, and its absence means
// "unknown" rather than "zero".
const withNavigator = (storage) => vi.stubGlobal('navigator', storage ? { storage } : {});

afterEach(() => vi.unstubAllGlobals());

describe('getIndexedDbUsage', () => {
  it('reports the IndexedDB figure when the browser breaks it out', async () => {
    withNavigator({ estimate: async () => ({ usage: 5_000_000, usageDetails: { indexedDB: 1_400_000, caches: 3_600_000 } }) });
    expect(await getIndexedDbUsage()).toBe(1_400_000);
  });

  it('returns null rather than the all-bucket total when usageDetails is missing', async () => {
    // Safari and Firefox. Returning `usage` here would show ~4 MB of app bundle
    // as though it were the user's data.
    withNavigator({ estimate: async () => ({ usage: 4_200_000, quota: 10_000_000_000 }) });
    expect(await getIndexedDbUsage()).toBeNull();
  });

  it('returns null when usageDetails omits IndexedDB specifically', async () => {
    withNavigator({ estimate: async () => ({ usage: 4_200_000, usageDetails: { caches: 4_200_000 } }) });
    expect(await getIndexedDbUsage()).toBeNull();
  });

  it('distinguishes a genuine zero from unknown', async () => {
    withNavigator({ estimate: async () => ({ usageDetails: { indexedDB: 0 } }) });
    expect(await getIndexedDbUsage()).toBe(0);
  });

  it('returns null where the Storage API is absent entirely', async () => {
    withNavigator(null);
    expect(await getIndexedDbUsage()).toBeNull();
  });

  it('returns null instead of rejecting when estimate throws', async () => {
    withNavigator({ estimate: async () => { throw new Error('SecurityError'); } });
    expect(await getIndexedDbUsage()).toBeNull();
  });
});
