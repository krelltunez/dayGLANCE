import { webdavFetch } from '../utils/cloudSyncProviders.js';
import * as icloudFileTransport from './icloudFileTransport.js';

const USERS_FILENAME = 'glance-users.json';
const DEFAULT_USERS_PATH = '/GLANCE/users/';

/**
 * Derive the WebDAV base URL and auth from a cloudSyncConfig object.
 * Supports both 'nextcloud' and 'generic' provider shapes.
 * Returns null if the config is missing required fields.
 */
function resolveWebDAV(cloudSyncConfig) {
  if (!cloudSyncConfig?.enabled) return null;
  const provider = cloudSyncConfig.provider || 'nextcloud';
  if (provider === 'nextcloud') {
    const { nextcloudUrl, username, appPassword } = cloudSyncConfig;
    if (!nextcloudUrl || !username || !appPassword) return null;
    const base = nextcloudUrl.replace(/\/+$/, '');
    const user = encodeURIComponent(username);
    return { baseUrl: `${base}/remote.php/dav/files/${user}`, username, appPassword };
  } else {
    const { webdavUrl, username, appPassword } = cloudSyncConfig;
    if (!webdavUrl || !username || !appPassword) return null;
    return { baseUrl: webdavUrl.replace(/\/+$/, ''), username, appPassword };
  }
}

function usersDir(baseUrl, usersPath) {
  const path = (usersPath ?? DEFAULT_USERS_PATH).replace(/\/+$/, '') + '/';
  return `${baseUrl}${path}`;
}

function authHeaders(username, appPassword) {
  const cred = btoa(`${username}:${appPassword}`);
  return { 'X-WebDAV-Auth': `Basic ${cred}` };
}

// lastGLANCE's SharedUser schema: { id: sync_id, name, updatedAt, deleted? }
// dayGLANCE's user schema:        { id: local_id, syncId: sync_id, name, ... }
//
// At the WebDAV boundary we use lastGLANCE's schema (id = sync_id) so both apps
// read/write the same field. These helpers translate between the two shapes.

function toWireFormat(u) {
  return { id: u.syncId ?? u.id, name: u.name, updatedAt: u.updatedAt, ...(u.deleted ? { deleted: true } : {}) };
}

// Given a wire entry { id: sync_id, ... } and the matching local user (if any),
// reconstruct a dayGLANCE user shape so the local id is preserved.
function fromWireFormat(entry, localUser) {
  if (localUser) {
    // Keep the local user but update mutable fields from the wire entry.
    return { ...localUser, name: entry.name, updatedAt: entry.updatedAt, ...(entry.deleted ? { deleted: true } : { deleted: undefined }) };
  }
  // New user introduced by another app: wire id IS the syncId; no local id yet.
  return { id: entry.id, syncId: entry.id, name: entry.name, updatedAt: entry.updatedAt, ...(entry.deleted ? { deleted: true } : {}) };
}

// Merge remote wire entries into the local user list.
// Remote entries are keyed by sync_id (entry.id). Local users are keyed by syncId ?? id.
// Last-write-wins by updatedAt.
function mergeUsers(localUsers, remoteWire) {
  // Index local users by their sync_id (syncId field, falling back to id).
  const bySyncId = new Map(localUsers.map(u => [u.syncId ?? u.id, u]));

  const result = new Map(localUsers.map(u => [u.syncId ?? u.id, u]));

  for (const entry of remoteWire) {
    const syncId = entry.id; // wire format: id = sync_id
    const local = bySyncId.get(syncId);
    const existing = result.get(syncId);
    if (!existing || entry.updatedAt > existing.updatedAt) {
      result.set(syncId, fromWireFormat(entry, local));
    }
  }

  return [...result.values()];
}

/**
 * Sync the local user list with glance-users.json on WebDAV using the
 * cloud sync credentials (default path: GLANCE/users/glance-users.json).
 * - If the file doesn't exist, write local users (this app is first).
 * - If it exists, merge remote + local (last-write-wins by updatedAt per syncId)
 *   and write the merged result back.
 * usersPath is read from the intent config (config.usersPath).
 * Returns the merged user array, or null if cloud sync is not configured.
 */
export async function syncSharedUsers(cloudSyncConfig, usersPath, localUsers) {
  const webdav = resolveWebDAV(cloudSyncConfig);
  if (!webdav) return null;

  const { baseUrl, username, appPassword } = webdav;
  const dir = usersDir(baseUrl, usersPath);
  const fileUrl = `${dir}${USERS_FILENAME}`;
  const headers = authHeaders(username, appPassword);
  const putHeaders = { ...headers, 'Content-Type': 'application/json' };

  const getRes = await webdavFetch('GET', fileUrl, headers);

  let merged;
  if (getRes.ok) {
    let remoteWire = [];
    try {
      const data = await getRes.json();
      remoteWire = Array.isArray(data.users) ? data.users : [];
    } catch {
      remoteWire = [];
    }
    merged = mergeUsers(localUsers, remoteWire);
  } else if (getRes.status === 404) {
    merged = localUsers;
  } else {
    console.warn('[shared-users] GET failed:', getRes.status);
    return null;
  }

  // Write using lastGLANCE's wire format so both apps share the same schema.
  const wire = merged.map(toWireFormat);
  const body = JSON.stringify({ version: 1, users: wire, updated_at: new Date().toISOString() });

  let putRes = await webdavFetch('PUT', fileUrl, putHeaders, body);
  if (putRes.status === 403 || putRes.status === 404 || putRes.status === 409) {
    await webdavFetch('MKCOL', dir, headers);
    putRes = await webdavFetch('PUT', fileUrl, putHeaders, body);
  }
  if (!putRes.ok) {
    console.warn('[shared-users] PUT failed:', putRes.status);
  }

  return merged;
}

/**
 * Sync the local user list with glance-users.json on iCloud Drive, using the
 * same directory structure as WebDAV: GLANCE/users/glance-users.json under
 * the Documents/ folder of the iCloud container.
 *
 * Returns the merged user array, or null if iCloud is not available or the
 * file is still downloading (caller should retry on next sync cycle).
 */
export async function syncSharedUsersViaICloud(usersPath, localUsers) {
  if (!icloudFileTransport.isAvailable()) return null;

  // Build relative path: strip leading / from usersPath, append filename.
  const dirPath = (usersPath ?? DEFAULT_USERS_PATH).replace(/^\//, '').replace(/\/*$/, '') + '/';
  const filePath = dirPath + USERS_FILENAME;

  let remoteRaw;
  try {
    remoteRaw = await icloudFileTransport.readFile(filePath);
  } catch (err) {
    console.warn('[shared-users/icloud] readFile error:', err.message);
    return null;
  }

  // Still downloading — caller should retry
  if (remoteRaw && typeof remoteRaw === 'string') {
    try {
      const parsed = JSON.parse(remoteRaw);
      if (parsed?.downloading === true) return null;
    } catch { /* not JSON — treat as content */ }
  }

  let merged;
  if (remoteRaw === null || remoteRaw === 'null') {
    // File doesn't exist yet — this app is first
    merged = localUsers;
  } else {
    let remoteWire = [];
    try {
      const data = JSON.parse(remoteRaw);
      remoteWire = Array.isArray(data.users) ? data.users : [];
    } catch {
      remoteWire = [];
    }
    merged = mergeUsers(localUsers, remoteWire);
  }

  const wireUsers = merged.map(toWireFormat);
  const body = JSON.stringify({ version: 1, users: wireUsers, updated_at: new Date().toISOString() });

  let ok = await icloudFileTransport.writeFile(filePath, body);
  if (!ok) {
    // Directory may not exist — create it and retry
    await icloudFileTransport.makeDir(dirPath);
    ok = await icloudFileTransport.writeFile(filePath, body);
  }
  if (!ok) {
    console.warn('[shared-users/icloud] writeFile failed');
  }

  return merged;
}
