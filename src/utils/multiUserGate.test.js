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
    // A Direct Access folder is a shared destination too (docs/direct-access-sync.md).
    expect(canEnableMultiUser({ cloudSyncEnabled: false, vaultEnabled: false, directAccessEnabled: true })).toBe(true);
    expect(canEnableMultiUser({ directAccessEnabled: false })).toBe(false);
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

  it('stays unlocked with only a Direct Access folder, which the reason also counts as sync', () => {
    expect(multiUserToggleLocked({ cloudSyncConfigured: false, directAccessConnected: true, multiUserEnabled: false })).toBe(false);
    // The lock and the explanation agree: locked exactly when there is a reason to show.
    for (const cloudSyncConfigured of [false, true]) {
      for (const directAccessConnected of [false, true]) {
        const locked = multiUserToggleLocked({ cloudSyncConfigured, directAccessConnected, multiUserEnabled: false });
        const reason = multiUserUnavailableReason({ cloudSyncConfigured, directAccessConnected, icloudAvailable: false });
        expect(locked).toBe(reason !== 'none');
      }
    }
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

  // GLANCEvault carries the roster inside the synced data, so a vault-only
  // device gets the button (its Sync now runs a vault cycle).
  it('is shown with multi-user on and GLANCEvault the only transport', () => {
    expect(canSyncUserRoster({ multiUserEnabled: true, cloudSyncEnabled: false, vaultEnabled: true })).toBe(true);
    expect(canSyncUserRoster({ multiUserEnabled: false, vaultEnabled: true })).toBe(false);
  });

  // iCloud is per Apple ID: it cannot carry a household roster, so it is not a
  // roster transport even on a never-trapped device (multi-user on, nothing else).
  it('is hidden when iCloud is the only sync', () => {
    expect(canSyncUserRoster({ multiUserEnabled: true, cloudSyncEnabled: false, icloudAvailable: true })).toBe(false);
  });

  it('is hidden with multi-user on but no transport at all', () => {
    expect(canSyncUserRoster({ multiUserEnabled: true, cloudSyncEnabled: false, vaultEnabled: false })).toBe(false);
  });

  it('defaults to hidden with no arguments', () => {
    expect(canSyncUserRoster()).toBe(false);
  });

  // Phase 5 of docs/direct-access-sync.md: a connected folder carries the roster.
  it('is shown with multi-user on and a Direct Access folder connected, and nothing else', () => {
    expect(canSyncUserRoster({ multiUserEnabled: true, directAccessConnected: true })).toBe(true);
    expect(canSyncUserRoster({ multiUserEnabled: false, directAccessConnected: true })).toBe(false);
  });
});

describe('multiUserUnavailableReason with a Direct Access folder', () => {
  it('a connected folder is a shared destination: no reason to show', () => {
    expect(multiUserUnavailableReason({ cloudSyncConfigured: false, icloudAvailable: true, directAccessConnected: true })).toBe('none');
    expect(multiUserUnavailableReason({ cloudSyncConfigured: false, icloudAvailable: true, directAccessConnected: false })).toBe('icloud-only');
  });
});
