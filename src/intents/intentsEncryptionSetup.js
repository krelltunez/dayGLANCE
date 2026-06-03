import { deriveIntentsRootKey } from '@glance-apps/intents';
import { webdavFetch } from '../utils/cloudSyncProviders.js';
import { storeIntentsRootKey } from './intentsKeyStore.js';

const SALT_FILENAME = 'intents-encryption-salt.json';

function eventsDir(config) {
  const base = (config.webdavUrl ?? '').replace(/\/+$/, '');
  const path = (config.eventsPath ?? '/GLANCE/events/').replace(/\/+$/, '') + '/';
  return `${base}${path}`;
}

function authHeaders(config) {
  const cred = btoa(`${config.username}:${config.appPassword}`);
  return { 'X-WebDAV-Auth': `Basic ${cred}` };
}

async function fetchOrCreateRootSalt(config) {
  const dir = eventsDir(config);
  const saltUrl = `${dir}${SALT_FILENAME}`;
  const headers = authHeaders(config);

  const getRes = await webdavFetch('GET', saltUrl, headers);
  if (getRes.ok) {
    const data = await getRes.json();
    return Uint8Array.from(atob(data.salt), c => c.charCodeAt(0));
  }

  if (getRes.status !== 404) {
    throw new Error(`Failed to fetch salt file: HTTP ${getRes.status}`);
  }

  // Salt file doesn't exist yet — this app is first. Generate and write it.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = btoa(String.fromCharCode(...salt));
  const body = JSON.stringify({ version: 1, salt: saltB64, created_at: new Date().toISOString() });
  const putHeaders = { ...headers, 'Content-Type': 'application/json' };

  let putRes = await webdavFetch('PUT', saltUrl, putHeaders, body);
  if (putRes.status === 403 || putRes.status === 404 || putRes.status === 409) {
    await webdavFetch('MKCOL', dir, headers);
    putRes = await webdavFetch('PUT', saltUrl, putHeaders, body);
  }
  if (!putRes.ok) {
    throw new Error(`Failed to write salt file: HTTP ${putRes.status}`);
  }

  return salt;
}

/**
 * Derive and cache the intents root key for the given WebDAV endpoint.
 * Fetches the shared salt from WebDAV (writing it if this app is first),
 * derives an HKDF root key, and stores it in IndexedDB.
 *
 * Caller must supply the cloud sync passphrase — this is the only time
 * intents needs it. After this returns, the cached root key is sufficient
 * for all emit/poll operations.
 *
 * @param {object} config - intent WebDAV config (webdavUrl, username, appPassword, eventsPath)
 * @param {string} passphrase - the cloud sync passphrase
 */
export async function setupIntentsEncryption(config, passphrase) {
  const sharedRootSalt = await fetchOrCreateRootSalt(config);
  const rootKey = await deriveIntentsRootKey(passphrase, sharedRootSalt);
  await storeIntentsRootKey(rootKey);
}
