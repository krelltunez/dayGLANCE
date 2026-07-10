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
