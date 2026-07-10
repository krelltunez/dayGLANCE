// iCloud INTENTS opt-in gate.
//
// The iCloud file transport is available on Apple platforms whenever an iCloud
// container is reachable, but ACTIVATING the intents path (emitting to iCloud +
// polling the iCloud event log) must be an explicit user choice — matching the
// WebDAV transport (gated on configured creds) and the GLANCEvault DB transport
// (gated on isDbIntentsEnabled()). Without this opt-in the privacy claim that
// "GLANCEintents is opt-in and off by default" would be false for the iCloud path.
//
// This module is deliberately tiny: a single persisted boolean flag, default
// FALSE. isIcloudIntentsEnabled() returns true ONLY when the platform supports
// iCloud AND the user has flipped the flag on — both must hold. The iCloud
// transport's own file operations (icloudFileTransport.js) remain callable
// regardless; this gates ACTIVATION, not the transport itself.

import { isAvailable as isICloudAvailable } from './icloudFileTransport.js';

export const ICLOUD_INTENTS_ENABLED_KEY = 'dayglance-icloud-intents-enabled';

/** The raw opt-in flag, independent of platform availability. @returns {boolean} */
export function getIcloudIntentsEnabledFlag() {
  try {
    return localStorage.getItem(ICLOUD_INTENTS_ENABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

/** Persist the opt-in flag. Removes the key when disabling. */
export function setIcloudIntentsEnabled(enabled) {
  try {
    if (enabled) localStorage.setItem(ICLOUD_INTENTS_ENABLED_KEY, 'true');
    else localStorage.removeItem(ICLOUD_INTENTS_ENABLED_KEY);
  } catch {
    /* ignore persistence failures (private mode, quota, etc.) */
  }
}

// True only when iCloud is available on this platform AND the user has opted in.
// Both the emit target and the poller are gated on this; when false the iCloud
// intents path is fully inert (no send, no poll).
export function isIcloudIntentsEnabled() {
  return isICloudAvailable() && getIcloudIntentsEnabledFlag();
}
