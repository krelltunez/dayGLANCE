import { describe, it, expect } from 'vitest';
import { acquireWakeLock, releaseWakeLock } from './wakeLock.js';

// The Wake Lock API doesn't exist in the test environment — the wrapper's
// contract is that everything no-ops gracefully there.
describe('wakeLock', () => {
  it('acquire resolves without throwing when the API is unsupported', async () => {
    await expect(acquireWakeLock()).resolves.toBeUndefined();
  });

  it('release without a held lock is a no-op', () => {
    expect(() => releaseWakeLock()).not.toThrow();
  });
});
