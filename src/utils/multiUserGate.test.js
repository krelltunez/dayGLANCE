import { describe, it, expect } from 'vitest';
import {
  canEnableMultiUser,
  multiUserToggleLocked,
  multiUserUnavailableReason,
  canSyncUserRoster,
} from './multiUserGate.js';

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

describe('multiUserUnavailableReason', () => {
  it('shows nothing when sync is configured', () => {
    expect(multiUserUnavailableReason({ cloudSyncConfigured: true, icloudAvailable: false })).toBe('none');
    // Configured wins even on an Apple device that also has iCloud.
    expect(multiUserUnavailableReason({ cloudSyncConfigured: true, icloudAvailable: true })).toBe('none');
  });

  // The case this exists for: telling an iCloud user they have no sync is wrong
  // and sends them hunting for a setting that would not help.
  it('distinguishes an iCloud-only device from a device with no sync', () => {
    expect(multiUserUnavailableReason({ cloudSyncConfigured: false, icloudAvailable: true })).toBe('icloud-only');
    expect(multiUserUnavailableReason({ cloudSyncConfigured: false, icloudAvailable: false })).toBe('no-sync');
  });

  it('defaults to no-sync with no arguments', () => {
    expect(multiUserUnavailableReason()).toBe('no-sync');
    expect(multiUserUnavailableReason({})).toBe('no-sync');
  });
});

describe('canSyncUserRoster', () => {
  // The contradiction being fixed: a working roster-sync button rendered
  // directly beneath a locked toggle saying sync was not configured.
  it('is hidden on an iCloud-only device with multi-user off', () => {
    expect(canSyncUserRoster({ multiUserEnabled: false, cloudSyncEnabled: false, icloudAvailable: true })).toBe(false);
  });

  it('is hidden whenever multi-user is off, even with WebDAV configured', () => {
    expect(canSyncUserRoster({ multiUserEnabled: false, cloudSyncEnabled: true, icloudAvailable: false })).toBe(false);
  });

  it('is shown with multi-user on and WebDAV configured', () => {
    expect(canSyncUserRoster({ multiUserEnabled: true, cloudSyncEnabled: true, icloudAvailable: false })).toBe(true);
  });

  // Never-trapped device: multi-user on, WebDAV off, iCloud reachable. The iCloud
  // roster transport is the only way to reconcile users here, so keep it.
  it('is shown for a never-trapped device where iCloud is the only transport', () => {
    expect(canSyncUserRoster({ multiUserEnabled: true, cloudSyncEnabled: false, icloudAvailable: true })).toBe(true);
  });

  it('is hidden with multi-user on but no transport at all', () => {
    expect(canSyncUserRoster({ multiUserEnabled: true, cloudSyncEnabled: false, icloudAvailable: false })).toBe(false);
  });

  it('defaults to hidden with no arguments', () => {
    expect(canSyncUserRoster()).toBe(false);
  });
});
