import { webdavFetch } from '../utils/cloudSyncProviders.js';

const USERS_FILENAME = 'glance-users.json';
const DEFAULT_USERS_PATH = '/GLANCE/users/';

function usersDir(config) {
  const base = (config.webdavUrl ?? '').replace(/\/+$/, '');
  const path = (config.usersPath ?? DEFAULT_USERS_PATH).replace(/\/+$/, '') + '/';
  return `${base}${path}`;
}

function authHeaders(config) {
  const cred = btoa(`${config.username}:${config.appPassword}`);
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
 * Sync the local user list with glance-users.json in the configured users
 * directory on WebDAV (default: GLANCE/users/glance-users.json).
 * - If the file doesn't exist, write local users (this app is first).
 * - If it exists, merge remote + local (last-write-wins by updatedAt per syncId)
 *   and write the merged result back.
 * Returns the merged user array, or null if WebDAV is not configured.
 */
export async function syncSharedUsers(config, localUsers) {
  if (!config?.webdavUrl || !config?.username || !config?.appPassword) return null;

  const dir = usersDir(config);
  const fileUrl = `${dir}${USERS_FILENAME}`;
  const headers = authHeaders(config);
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
    // This app is first — write local list as the canonical source
    merged = localUsers;
  } else {
    console.warn('[shared-users] GET failed:', getRes.status);
    return null;
  }

  const body = JSON.stringify({ version: 1, users: merged, updated_at: new Date().toISOString() });

  let putRes = await webdavFetch('PUT', fileUrl, putHeaders, body);
  if (putRes.status === 404 || putRes.status === 409) {
    await webdavFetch('MKCOL', dir, headers);
    putRes = await webdavFetch('PUT', fileUrl, putHeaders, body);
  }
  if (!putRes.ok) {
    console.warn('[shared-users] PUT failed:', putRes.status);
  }

  return merged;
}
