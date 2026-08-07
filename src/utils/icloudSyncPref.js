/**
 * Per-device iCloud sync preference, and the first-run decision behind it.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * iCloud sync is zero-config and always-on for Apple builds, which is the right
 * default and stays the default here. The problem it caused is narrower: when a
 * user deletes the iOS app and reinstalls it, iOS grants the iCloud entitlement
 * afresh and the per-app iCloud toggle comes back ON — the "off" they had chosen
 * lived in iOS's per-app state for an app that no longer exists. Meanwhile
 * dayglance-sync.json survived in the ubiquity container (it lives outside the
 * sandbox, and any Mac running dayGLANCE keeps writing to it), so the app finds
 * it, merges it, and every task returns. Confirmed on-device: the same install
 * reported `container: unavailable` before deletion and `AVAILABLE` after
 * reinstall, with nothing touched in between.
 *
 * Nothing in the app can stop that toggle resetting — it is OS state we do not
 * own, and the user's preference cannot be remembered because localStorage goes
 * with the app. What the app CAN stop doing is restoring silently. So the first
 * launch that finds cloud data and no local data asks, and this module is where
 * the answer lives.
 *
 * ── Tri-state, deliberately ────────────────────────────────────────────────
 * The stored value is absent / 'true' / 'false', and absence is NOT "off":
 *
 *   absent  — no decision yet. iCloud sync runs (preserving zero-config for every
 *             existing user), and the first-run prompt may ask if this looks like
 *             a fresh install facing populated cloud data.
 *   'true'  — the user chose to restore, or re-enabled sync later.
 *   'false' — the user chose to start fresh on this device. Sync is fully inert:
 *             no read applied, no write. The container copy is left alone, so
 *             other devices are unaffected.
 *
 * Treating absence as "on" is what keeps this from becoming a breaking change for
 * everyone already syncing.
 */

export const ICLOUD_SYNC_PREF_KEY = 'dayglance-icloud-sync-enabled';

const read = (storage) => {
  try {
    return storage?.getItem(ICLOUD_SYNC_PREF_KEY) ?? null;
  } catch {
    return null;
  }
};

/**
 * The raw stored decision.
 * @returns {'true'|'false'|null} null when the user has not decided.
 */
export function getICloudSyncPref(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  const v = read(storage);
  return v === 'true' || v === 'false' ? v : null;
}

/**
 * Whether iCloud sync should run on this device.
 * Absence means yes — zero-config is the default and must stay it.
 */
export function isICloudSyncEnabled(storage = typeof window !== 'undefined' ? window.localStorage : null) {
  return getICloudSyncPref(storage) !== 'false';
}

/** Records the decision. Persisting `true` matters: it also marks the prompt answered. */
export function setICloudSyncEnabled(enabled, storage = typeof window !== 'undefined' ? window.localStorage : null) {
  try {
    storage?.setItem(ICLOUD_SYNC_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    /* private mode / quota — the in-memory choice still holds for this session */
  }
}

/**
 * Whether to interrupt this launch and ask.
 *
 * All four conditions are load-bearing:
 *
 *   • no decision recorded — asking twice would be nagging, and a user who chose
 *     'restore' must not be re-asked on every launch;
 *   • the container holds real data — nothing to offer otherwise;
 *   • this device has NO local data — the case being fixed is a fresh install
 *     facing a surviving cloud copy. A device with its own data is an ordinary
 *     merge, and prompting there would interrupt every existing user exactly once
 *     for no reason, which is the main risk this guard exists to avoid;
 *   • iCloud is actually reachable — otherwise there is no restore to decline.
 *
 * @param {{decided: boolean, remoteHasData: boolean, localHasData: boolean, icloudAvailable: boolean}} s
 * @returns {boolean}
 */
export function shouldPromptFirstRun({ decided, remoteHasData, localHasData, icloudAvailable } = {}) {
  return !!(!decided && remoteHasData && !localHasData && icloudAvailable);
}

/**
 * Does this payload carry anything worth restoring?
 *
 * Counts tasks and inbox items only. A snapshot can carry settings, tombstones and
 * empty collections while holding no actual content — offering to "restore" that
 * is a prompt with nothing behind it.
 */
export function payloadHasData(data) {
  if (!data || typeof data !== 'object') return false;
  const n = (v) => (Array.isArray(v) ? v.length : 0);
  return n(data.tasks) + n(data.unscheduledTasks) > 0;
}
