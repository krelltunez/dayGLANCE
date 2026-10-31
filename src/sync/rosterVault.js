// The household roster on GLANCEvault: the glance-users app, which every GLANCE
// app (dayGLANCE, lastGLANCE, lifeGLANCE) reads and writes, so a member added
// in one app reaches the others on an account that syncs through the vault
// alone. glance-users.json on WebDAV or in a Direct Access folder is the same
// roster over the file roads (intents/sharedUsers.js).
//
// The wire contract, shared with the sibling apps:
//   app       glance-users
//   entityId  the member's sync id
//   entity    { id: sync id, name, updatedAt: ISO string }  (glance-users.json's
//             wire shape, without `deleted`)
//   delete    the engine's soft-delete; nothing else marks a member gone.
// Entities are encrypted under the account's root key, which every app on the
// account already shares (the salt is per account), so nothing new is set up.
//
// The roster lives in localStorage ('dayglance-users'), the one place every
// writer already goes through, so this engine reads and writes it there and
// hands a changed list to the app (onUsersApplied). Dirty tracking is a diff
// against the roster last handed to the engine, as in sync/dbEngine.js; the
// engine's own persisted dirty set carries a failed push to the next cycle.
//
// A vault server that predates glance-users answers 400 "unknown app": the
// engine stands down for the session and the roster keeps to the file roads.

import { createDbSyncEngine } from '@glance-apps/sync';
import { getVaultConfig, isVaultEnabled } from './vaultConfig.js';
import { getDeviceId } from './deviceId.js';
import { nativeKeyConfig, vaultFetchImpl } from './dbEngine.js';

export const ROSTER_VAULT_APP = 'glance-users';
const USERS_KEY = 'dayglance-users';
const MULTI_USER_KEY = 'dayglance-multi-user-enabled';
// Per-app local state (cursor, dirty set, diff baseline); the vault app is shared.
const STORAGE_PREFIX = `dayglance-${ROSTER_VAULT_APP}`;
const SNAPSHOT_KEY = `${STORAGE_PREFIX}-db-sync-snapshot`;
const CRYPTO_DB_NAME = 'dayglance-db-crypto';
const DELETED = '\u0000deleted';
const PUSH_DEBOUNCE_MS = 3000;

const syncIdOf = (u) => String(u?.syncId ?? u?.id ?? '');

export function isRosterEntity(entity) {
  return !!entity && typeof entity === 'object'
    && typeof entity.id === 'string' && !!entity.id
    && typeof entity.name === 'string' && !!entity.name.trim()
    && typeof entity.updatedAt === 'string';
}

export const toRosterEntity = (u) => ({ id: syncIdOf(u), name: u.name, updatedAt: u.updatedAt });

function readJson(storage, key, fallback) {
  try { const raw = storage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
const readUsers = (storage) => { const v = readJson(storage, USERS_KEY, []); return Array.isArray(v) ? v : []; };
const writeUsers = (storage, users) => storage.setItem(USERS_KEY, JSON.stringify(users));

// What the engine should hold for each member: the wire entity, or DELETED.
function rosterHashes(users) {
  const out = {};
  for (const u of users) {
    const id = syncIdOf(u);
    if (!id) continue;
    out[id] = u.deleted ? DELETED : JSON.stringify(toRosterEntity(u));
  }
  return out;
}

export function getLocalRosterEntity(storage, entityId) {
  const u = readUsers(storage).find((x) => syncIdOf(x) === entityId);
  return u && !u.deleted && u.name ? toRosterEntity(u) : null;
}

/**
 * Upsert a member from the vault, last-writer-wins on updatedAt. A local copy
 * as new or newer wins, a local deletion included (its soft-delete is on the
 * way up). Returns true when the roster changed.
 */
export function applyRosterEntity(storage, entityId, entity) {
  if (!isRosterEntity(entity) || entity.id !== entityId) return false;
  const users = readUsers(storage);
  const i = users.findIndex((u) => syncIdOf(u) === entityId);
  if (i >= 0) {
    const local = users[i];
    if (local.updatedAt && local.updatedAt >= entity.updatedAt) return false;
    const { deleted: _gone, ...rest } = local;
    users[i] = { ...rest, name: entity.name, updatedAt: entity.updatedAt };
  } else {
    users.push({ id: entityId, syncId: entityId, name: entity.name, updatedAt: entity.updatedAt });
  }
  writeUsers(storage, users);
  return true;
}

/** Tombstone a member deleted in another app or on another device. */
export function applyRosterDelete(storage, entityId, now = () => new Date().toISOString()) {
  const users = readUsers(storage);
  const i = users.findIndex((u) => syncIdOf(u) === entityId);
  if (i < 0 || users[i].deleted) return false;
  users[i] = { ...users[i], deleted: true, updatedAt: now() };
  writeUsers(storage, users);
  return true;
}

// True when an error is the vault refusing the app name (a server that predates
// glance-users answers 400 "unknown app"; the client keeps only the status).
export function isUnknownAppError(message) {
  return !!message && (/unknown app/i.test(message) || /failed: 400\b/.test(message));
}

const EMPTY_RESULT = { applied: 0, skipped: 0, skippedEntityIds: [] };

/**
 * Build the roster engine, or null when the vault is off. A cycle is a no-op
 * while multi-user mode is off on this device: there is no household to share.
 *
 * @param {object} [opts]
 * @param {(users: object[]) => void} [opts.onUsersApplied]  the roster after a cycle changed it
 * @param {(message: string|null, code: string|null) => void} [opts.onError]
 * @param {() => void} [opts.onUnsupported]  the vault does not know glance-users
 * @param {Storage} [opts.storage]           test seam
 * @param {Function} [opts.createEngine]     test seam for createDbSyncEngine
 */
export function createRosterDbEngine(opts = {}) {
  const createEngine = opts.createEngine ?? createDbSyncEngine;
  if (!opts.createEngine && !isVaultEnabled()) return null;
  const storage = opts.storage ?? localStorage;
  const cfg = getVaultConfig() || {};
  let unsupported = false;
  let changed = false;

  const engine = createEngine({
    storageKeyPrefix: STORAGE_PREFIX,
    appId: ROSTER_VAULT_APP,
    vaultApp: ROSTER_VAULT_APP,
    cryptoDBName: CRYPTO_DB_NAME,
    ...nativeKeyConfig(),
    vaultUrl: cfg.vaultUrl,
    vaultToken: cfg.vaultToken,
    accountId: cfg.accountId,
    fetchImpl: vaultFetchImpl(),
    deviceId: `${getDeviceId()}-roster`,
    getLocalEntity: (entityId) => getLocalRosterEntity(storage, entityId),
    applyRemoteEntity: (entityId, entity) => { if (applyRosterEntity(storage, entityId, entity)) changed = true; },
    applyRemoteDelete: (entityId) => { if (applyRosterDelete(storage, entityId)) changed = true; },
    isInsertOnly: () => false,
    getEntityLastModified: (entity) => (isRosterEntity(entity) ? entity.updatedAt : undefined),
    pullCursorCommit: 'per-page',
    onStatusChange: opts.onStatusChange,
    onError: (message, code) => {
      if (isUnknownAppError(message)) {
        if (!unsupported) { unsupported = true; opts.onUnsupported?.(); }
        return;
      }
      opts.onError?.(message, code);
    },
  });

  const runCycle = engine.dbSyncCycle.bind(engine);
  const dbSyncCycle = async () => {
    if (unsupported || readJson(storage, MULTI_USER_KEY, false) !== true) return EMPTY_RESULT;
    // Mark what changed since the roster last handed to the engine (the first
    // cycle on a device has no baseline, so it seeds the whole roster), then
    // move the baseline: the engine's own dirty set keeps them until acked.
    const baseline = readJson(storage, SNAPSHOT_KEY, {});
    const current = rosterHashes(readUsers(storage));
    for (const id of new Set([...Object.keys(baseline), ...Object.keys(current)])) {
      if (baseline[id] !== current[id] && !(baseline[id] === undefined && current[id] === DELETED)) engine.markDirty(id);
    }
    changed = false;
    const result = await runCycle();
    // A server without glance-users: keep the baseline, so the roster is
    // offered again once the server knows the app (next app start).
    if (unsupported) return EMPTY_RESULT;
    // Remote applies are what the vault already holds: fold them into the
    // baseline so they never bounce back up. A local edit made during the
    // network window is in neither and diffs dirty next cycle.
    const after = rosterHashes(readUsers(storage));
    const nextBaseline = { ...current };
    for (const [id, h] of Object.entries(after)) if (current[id] !== h) nextBaseline[id] = h;
    storage.setItem(SNAPSHOT_KEY, JSON.stringify(nextBaseline));
    if (changed) { changed = false; opts.onUsersApplied?.(readUsers(storage)); }
    return result;
  };

  return { ...engine, dbSyncCycle, sync: dbSyncCycle };
}

// ── The running engine, for writes and an explicit Sync now ─────────────────

let rosterEngine = null;
let pushTimer = null;

export function registerRosterEngine(engine) {
  if (pushTimer != null) { clearTimeout(pushTimer); pushTimer = null; }
  rosterEngine = engine;
}

/** A debounced cycle after the roster changed locally (no-op without an engine). */
export function scheduleRosterPush() {
  if (!rosterEngine) return;
  if (pushTimer != null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    rosterEngine?.dbSyncCycle().catch(() => { /* surfaced via onError */ });
  }, PUSH_DEBOUNCE_MS);
}

/** One cycle now; 'off' without an engine, else judged by the last-synced stamp. */
export async function syncRosterNow() {
  const engine = rosterEngine;
  if (!engine) return 'off';
  if (pushTimer != null) { clearTimeout(pushTimer); pushTimer = null; }
  const before = engine.getLastSynced?.() ?? null;
  try { await engine.dbSyncCycle(); } catch { return 'failed'; }
  const after = engine.getLastSynced?.() ?? null;
  return after && after !== before ? 'ok' : 'failed';
}
