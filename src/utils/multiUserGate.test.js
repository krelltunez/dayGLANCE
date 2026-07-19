import { describe, it, expect } from 'vitest';
import { canEnableMultiUser, multiUserToggleLocked } from './multiUserGate.js';

describe('canEnableMultiUser', () => {
  it('is false when neither sync tier is configured', () => {
    expect(canEnableMultiUser({ cloudSyncEnabled: false, vaultEnabled: false })).toBe(false);
    expect(canEnableMultiUser({})).toBe(false);
    expect(canEnableMultiUser()).toBe(false);
  });

  it('is true when the WebDAV file tier is enabled', () => {
    expect(canEnableMultiUser({ cloudSyncEnabled: true, vaultEnabled: false })).toBe(true);
  });

  it('is true when the GLANCEvault tier is enabled', () => {
    expect(canEnableMultiUser({ cloudSyncEnabled: false, vaultEnabled: true })).toBe(true);
  });
});

describe('multiUserToggleLocked (never-trap rule)', () => {
  it('locks the toggle only when sync is unconfigured and multi-user is off', () => {
    expect(multiUserToggleLocked({ cloudSyncConfigured: false, multiUserEnabled: false })).toBe(true);
  });

  it('stays unlocked when sync is configured', () => {
    expect(multiUserToggleLocked({ cloudSyncConfigured: true, multiUserEnabled: false })).toBe(false);
    expect(multiUserToggleLocked({ cloudSyncConfigured: true, multiUserEnabled: true })).toBe(false);
  });

  it('never traps: stays unlocked when multi-user is already on despite unconfigured sync', () => {
    expect(multiUserToggleLocked({ cloudSyncConfigured: false, multiUserEnabled: true })).toBe(false);
  });
});
