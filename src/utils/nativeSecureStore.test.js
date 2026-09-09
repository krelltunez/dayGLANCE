import { describe, it, expect, vi, afterEach } from 'vitest';
import { SECURE_SLOT, secureGet, secureSet, secureStoreAvailable } from './nativeSecureStore.js';

const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
const origWindow = hadWindow ? globalThis.window : undefined;

function iosWindow(bridge = {}) {
  globalThis.window = { DayGlanceIOS: true, DayGlanceNative: bridge };
}

describe('nativeSecureStore', () => {
  afterEach(() => {
    if (hadWindow) globalThis.window = origWindow;
    else delete globalThis.window;
  });

  it('is unavailable off iOS: every call is an inert no-op', () => {
    globalThis.window = { DayGlanceNative: { secureGet: vi.fn(), secureSet: vi.fn() } }; // Android shape
    expect(secureStoreAvailable()).toBe(false);
    expect(secureGet(SECURE_SLOT.vaultConfig)).toBeNull();
    expect(secureSet(SECURE_SLOT.vaultConfig, 'x')).toBe(false);
    expect(globalThis.window.DayGlanceNative.secureGet).not.toHaveBeenCalled();
    expect(globalThis.window.DayGlanceNative.secureSet).not.toHaveBeenCalled();
  });

  it('reads a value on iOS and treats the empty string as absent', () => {
    const secureGetFn = vi.fn((slot) => (slot === 'vault-config' ? '{"enabled":true}' : ''));
    iosWindow({ secureGet: secureGetFn });
    expect(secureStoreAvailable()).toBe(true);
    expect(secureGet(SECURE_SLOT.vaultConfig)).toBe('{"enabled":true}');
    expect(secureGet(SECURE_SLOT.syncKey)).toBeNull();
    expect(secureGetFn).toHaveBeenCalledWith('vault-config');
  });

  it('writes a value and clears with null; the bridge answers "true"', () => {
    const secureSetFn = vi.fn(() => 'true');
    iosWindow({ secureSet: secureSetFn });
    expect(secureSet(SECURE_SLOT.cloudSyncConfig, '{"enabled":true}')).toBe(true);
    expect(secureSet(SECURE_SLOT.cloudSyncConfig, null)).toBe(true);
    expect(secureSetFn.mock.calls).toEqual([
      ['cloud-sync-config', '{"enabled":true}'],
      ['cloud-sync-config', null],
    ]);
  });

  it('a throwing bridge reads as absent and a failed write as false', () => {
    iosWindow({ secureGet: () => { throw new Error('boom'); }, secureSet: () => { throw new Error('boom'); } });
    expect(secureGet(SECURE_SLOT.dbRootKey)).toBeNull();
    expect(secureSet(SECURE_SLOT.dbRootKey, 'v')).toBe(false);
  });
});
