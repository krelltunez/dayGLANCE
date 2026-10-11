import { webdavFetch } from '../utils/cloudSyncProviders.js';
import * as icloudFileTransport from './icloudFileTransport.js';
import { directAccessTransport } from '../sync/directAccessTransport.js';
import { canonicalJson } from '../sync/snapshotMergeExplain.js';
import { RELAY_CONFIRM_MS } from '../sync/snapshotFileSync.js';

/**
 * When the household roster was last edited ON THIS DEVICE (a member added,
 * renamed or removed in Settings), as opposed to merged in from a transport.
 * The Direct Access roster sync writes at once for a change made here and
 * waits for the folder to catch up with one that arrived by another road,
 * the rule the snapshot cycle follows (sync/snapshotFileSync.js).
 */
export const ROSTER_EDIT_KEY = 'dayglance-users-local-edit-at';

export function markRosterEdited(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
  try { storage?.setItem(ROSTER_EDIT_KEY, new Date().toISOString()); } catch { /* storage unavailable */ }
}

const USERS_FILENAME = 'glance-users.json';
const DEFAULT_USERS_PATH = '/GLANCE/users/';

/**
 * Derive the WebDAV base URL and auth from a cloudSyncConfig object.
 * Supports the 'nextcloud', 'koofr', and 'webdav' provider shapes.
 * Returns null if the config is missing required fields.
 */
export function resolveWebDAV(cloudSyncConfig) {
  if (!cloudSyncConfig?.enabled) return null;
  const provider = cloudSyncConfig.provider || 'nextcloud';
  if (provider === 'nextcloud') {
    const { nextcloudUrl, username, appPassword } = cloudSyncConfig;
    if (!nextcloudUrl || !username || !appPassword) return null;
    const base = nextcloudUrl.replace(/\/+$/, '');
    const user = encodeURIComponent(username);
    return { baseUrl: `${base}/remote.php/dav/files/${user}`, username, appPassword };
  } else if (provider === 'koofr') {
    // Koofr configs carry no URL key — the WebDAV root is fixed (mirrors the
    // koofr provider in @glance-apps/sync providers.js).
    const { username, appPassword } = cloudSyncConfig;
    if (!username || !appPassword) return null;
    return { baseUrl: 'https://app.koofr.net/dav/Koofr', username, appPassword };
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

// Encode credentials as Base64 for Basic auth. btoa() alone throws
// InvalidCharacterError on codepoints > 255 (accented chars, CJK, emoji), so
// UTF-8-encode first — matching toBase64() used everywhere else in the app.
function authHeaders(username, appPassword) {
  const raw = `${username}:${appPassword}`;
  const cred = btoa(String.fromCharCode(...new TextEncoder().encode(raw)));
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

/** The roster's directory and file, relative to a folder root (no leading slash). */
export function relativeRosterPaths(usersPath) {
  const dirPath = (usersPath ?? DEFAULT_USERS_PATH).replace(/^\//, '').replace(/\/*$/, '') + '/';
  return { dirPath, filePath: dirPath + USERS_FILENAME };
}

/**
 * What a folder-based roster sync does with what it read: the merged roster
 * and the body to write back, or null when the file is still downloading and
 * the caller should retry next cycle. `remoteRaw` follows the snapshot read
 * contract: null for an absent file, '{"downloading":true}', or the text.
 * Shared by the iCloud and Direct Access roster syncs.
 */
export function reconcileRoster(remoteRaw, localUsers) {
  if (remoteRaw && typeof remoteRaw === 'string') {
    try {
      const parsed = JSON.parse(remoteRaw);
      if (parsed?.downloading === true) return null;
    } catch { /* not JSON — treat as content */ }
  }
  let merged;
  if (remoteRaw === null || remoteRaw === undefined || remoteRaw === 'null') {
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
  const body = JSON.stringify({ version: 1, users: merged.map(toWireFormat), updated_at: new Date().toISOString() });
  return { merged, body };
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

  const { dirPath, filePath } = relativeRosterPaths(usersPath);

  let remoteRaw;
  try {
    remoteRaw = await icloudFileTransport.readFile(filePath);
  } catch (err) {
    console.warn('[shared-users/icloud] readFile error:', err.message);
    return null;
  }

  const r = reconcileRoster(remoteRaw, localUsers);
  if (!r) return null; // still downloading — caller should retry
  const { merged, body } = r;

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

/** The roster entries a file holds, for the write question; [] when absent or unreadable. */
function wireUsersOf(remoteRaw) {
  if (!remoteRaw || remoteRaw === 'null') return [];
  try {
    const data = JSON.parse(remoteRaw);
    return Array.isArray(data?.users) ? data.users : [];
  } catch { return []; }
}
const rosterKey = (users) => canonicalJson([...users].sort((a, b) => String(a.id).localeCompare(String(b.id))));

// Per-transport bookkeeping for the write rules: the last successful write,
// the previous read (the baseline a local edit has to be newer than before
// any write), and the pending relay look.
const rosterSyncState = new Map();
const stateFor = (transport) => {
  const id = transport?.id ?? 'direct-access';
  if (!rosterSyncState.has(id)) rosterSyncState.set(id, { lastWrittenAt: 0, previousReadAt: 0, pending: null });
  return rosterSyncState.get(id);
};
export function _resetRosterSyncStateForTests() { rosterSyncState.clear(); }

/**
 * Sync the local user list with glance-users.json in the Direct Access folder
 * (docs/direct-access-sync.md, Phase 5), at the same relative path WebDAV
 * uses, through the transport's roster slot: files by path on desktop and
 * Android, the roster's own bookmarked file on an iPhone.
 *
 * Unlike the WebDAV and iCloud roster syncs, which rewrite the file on every
 * run, this one follows the snapshot cycle's rules, because two devices
 * rewriting one file in a syncing folder is a conflict copy per run (two Macs,
 * 2026-10-09): it writes only when the roster the file holds would change,
 * at once for a change made on this device (ROSTER_EDIT_KEY newer than this
 * device's last write, or before any write its previous read), and for a
 * change that arrived by another road only once the file has sat unchanged,
 * still lacking it, for RELAY_CONFIRM_MS. The merged roster is returned and
 * applied locally either way.
 *
 * Returns the merged user array, or null when no folder is connected, the
 * folder or roster is unreachable (nothing is written then), or the file is
 * still being delivered (retry next cycle).
 */
export async function syncSharedUsersViaDirectAccess(usersPath, localUsers, transport = directAccessTransport, deps = {}) {
  if (!transport?.isSupported?.() || !transport.rosterSupported?.()) return null;
  if (!transport.isAvailable()) return null;
  const now = deps.now ?? Date.now;
  const storage = deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const st = deps.state ?? stateFor(transport);

  const { filePath } = relativeRosterPaths(usersPath);

  let remoteRaw;
  try {
    remoteRaw = await transport.rosterRead(filePath);
  } catch (err) {
    console.warn('[shared-users/direct-access] read error:', err?.message ?? err);
    return null;
  }
  // An error object (the folder went away, a roster that cannot be reached):
  // say nothing and write nothing. Seeding over a folder we cannot read would
  // be the resurrection the snapshot cycle guards against.
  let remoteStamp = 'absent';
  if (remoteRaw && typeof remoteRaw === 'string') {
    try {
      const parsed = JSON.parse(remoteRaw);
      if (parsed && typeof parsed === 'object' && parsed.error) {
        console.warn('[shared-users/direct-access] roster unavailable:', parsed.error);
        return null;
      }
      if (parsed && typeof parsed === 'object' && parsed.updated_at) remoteStamp = String(parsed.updated_at);
    } catch { /* content */ }
  }

  const r = reconcileRoster(remoteRaw, localUsers);
  if (!r) return null;
  const { merged, body } = r;
  const readAt = now();
  const previousReadAt = st.previousReadAt;
  st.previousReadAt = readAt;

  // The write question: would the roster the file holds change?
  const changed = rosterKey(merged.map(toWireFormat)) !== rosterKey(wireUsersOf(remoteRaw));
  if (!changed) { st.pending = null; return merged; }

  // Made here, or relayed.
  let editedAt = 0;
  try { const v = storage?.getItem(ROSTER_EDIT_KEY); const t = v ? new Date(v).getTime() : NaN; editedAt = Number.isFinite(t) ? t : 0; } catch { editedAt = 0; }
  const baseline = st.lastWrittenAt || previousReadAt;
  const ownEdits = editedAt > baseline;
  const fingerprint = `${remoteStamp}\u0000${rosterKey(merged.map(toWireFormat))}`;
  if (!ownEdits) {
    if (!(st.pending && st.pending.fingerprint === fingerprint && readAt - st.pending.at >= RELAY_CONFIRM_MS)) {
      if (!st.pending || st.pending.fingerprint !== fingerprint) st.pending = { fingerprint, at: readAt };
      return merged;
    }
  }

  const ok = await transport.rosterWrite(filePath, body);
  if (!ok) console.warn('[shared-users/direct-access] write failed');
  else { st.lastWrittenAt = readAt; st.pending = null; }
  return merged;
}
