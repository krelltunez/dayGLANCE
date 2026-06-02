import { webdavFetch } from '../utils/cloudSyncProviders.js';

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

// Merge two user arrays: last-write-wins per syncId by updatedAt
function mergeUsers(local, remote) {
  const map = new Map();
  for (const u of [...local, ...remote]) {
    const existing = map.get(u.syncId);
    if (!existing || u.updatedAt > existing.updatedAt) {
      map.set(u.syncId, u);
    }
  }
  return [...map.values()];
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
    let remote = [];
    try {
      const data = await getRes.json();
      remote = Array.isArray(data.users) ? data.users : [];
    } catch {
      remote = [];
    }
    merged = mergeUsers(localUsers, remote);
  } else if (getRes.status === 404) {
    merged = localUsers;
  } else {
    console.warn('[shared-users] GET failed:', getRes.status);
    return null;
  }

  const body = JSON.stringify({ version: 1, users: merged, updated_at: new Date().toISOString() });

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
