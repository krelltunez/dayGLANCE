// Multi-user gating. Multi-user (users/assignments) only does anything across
// synced devices, so it is useless without cloud sync configured — either the
// WebDAV file tier (cloudSyncConfig.enabled) or the GLANCEvault DB tier
// (isVaultEnabled). These helpers centralize the "requires sync" rule and,
// crucially, the never-trap rule so both settings surfaces behave identically.

/**
 * Whether cloud sync is configured enough to make multi-user meaningful.
 * @param {{cloudSyncEnabled?: boolean, vaultEnabled?: boolean}} opts
 * @returns {boolean}
 */
export function canEnableMultiUser({ cloudSyncEnabled, vaultEnabled } = {}) {
  return !!(cloudSyncEnabled || vaultEnabled);
}

/**
 * Whether the multi-user toggle should be rendered disabled.
 *
 * Disabled only when sync is unconfigured AND multi-user is currently off.
 * Never trap: if multi-user is already on (legacy state, or sync was turned off
 * after enabling it), the toggle stays enabled so the user can turn it back off.
 *
 * @param {{cloudSyncConfigured?: boolean, multiUserEnabled?: boolean}} opts
 * @returns {boolean}
 */
export function multiUserToggleLocked({ cloudSyncConfigured, multiUserEnabled } = {}) {
  return !cloudSyncConfigured && !multiUserEnabled;
}

/**
 * Which explanation to show under a multi-user toggle that cannot be enabled.
 *
 * "Requires cloud sync" is accurate on a device with no sync at all, and it is
 * actionable — go set up WebDAV or GLANCEvault. On an Apple device syncing via
 * iCloud it is simply wrong: that user IS syncing, and telling them otherwise
 * sends them looking for a setting that will not help. iCloud is per-Apple-ID, so
 * it moves one person's data between their own devices; it cannot give two people
 * a shared destination, which is the thing multi-user needs. That is a different
 * sentence, not a missing one — hence a reason code rather than a boolean.
 *
 * Returns:
 *   'none'        — sync is configured; multi-user is available, show nothing.
 *   'icloud-only' — the only transport is iCloud, which cannot back multi-user.
 *   'no-sync'     — no transport at all; setting one up is the fix.
 *
 * @param {{cloudSyncConfigured?: boolean, icloudAvailable?: boolean}} opts
 * @returns {'none'|'icloud-only'|'no-sync'}
 */
export function multiUserUnavailableReason({ cloudSyncConfigured, icloudAvailable } = {}) {
  if (cloudSyncConfigured) return 'none';
  return icloudAvailable ? 'icloud-only' : 'no-sync';
}

/**
 * Whether to offer the "sync users" roster action.
 *
 * Gated on multi-user actually being ON, not merely on a transport existing. The
 * previous condition (WebDAV enabled OR iCloud reachable) put a working
 * household-roster sync button directly beneath a locked toggle that said sync
 * was not configured — an iCloud-only device got both halves of a contradiction
 * on one screen. With multi-user off there is no roster to sync in the first
 * place, so the button has nothing to do.
 *
 * The iCloud transport stays supported for the never-trapped case: multi-user
 * enabled while WebDAV is off, where syncSharedUsersViaICloud is the only way to
 * reconcile the roster.
 *
 * @param {{multiUserEnabled?: boolean, cloudSyncEnabled?: boolean, icloudAvailable?: boolean}} opts
 * @returns {boolean}
 */
export function canSyncUserRoster({ multiUserEnabled, cloudSyncEnabled, icloudAvailable } = {}) {
  return !!(multiUserEnabled && (cloudSyncEnabled || icloudAvailable));
}
