// dayGLANCE → GLANCEvault entity-to-row adapter.
//
// Stage 1 (representability): pure shred/reassemble — proven lossless on one
// device. Stage 2 (merge correctness): per-row APPLY logic that merges one
// pulled row into a device's live state without losing concurrent edits made on
// another device. App-side only; @glance-apps/sync is never modified.
//
// The GLANCEvault DB engine (createDbSyncEngine, dbEngine.js) is data-shape
// agnostic. It calls these app-side callbacks:
//   getLocalEntity(entityId)        -> wrapped entity | null   (shred one)
//   applyRemoteEntity(entityId, e)  -> merge one pulled row
//   applyRemoteDelete(entityId)     -> remove one row
//   isInsertOnly(entity)            -> always-apply (merge) vs LWW
//   getEntityLastModified(entity)   -> entity-grain LWW tiebreaker
// On pull the engine applies a row only when the local copy is absent, the kind
// is insert-only, or the remote's lastModified wins (dbEngine.js:262-280).
//
// DISCRIMINATION: explicit in-envelope `_kind`, not structural sniffing —
// dayGLANCE's five task-shaped collections (tasks / unscheduledTasks /
// recurringTasks / recycleBin / todayRoutines) are field-for-field identical and
// cannot be told apart structurally. encryptEntity JSON-stringifies the whole
// entity before AES-GCM (dbCrypto.js:274), so `_kind` rides inside the per-entity
// ciphertext and the server still sees only opaque bytes (zero-knowledge).
//
// SCOPING (rule 4): bundles keep their current shape — completedDates stays an
// array inside its row, habitLogs stays a keyed map carried whole. No finer
// per-completion remodeling.

import { mergeHabitLogs, mergeRoutineDefinitions, mergeRoutineCompletions } from '../mergeSync.js';

// ── Collection kinds: each array element is one row, keyed by a stable id, with
// entity-grain last-writer-wins on tsField (the same grain the file-tier merge
// in @glance-apps/sync merge.js resolves). Evidence: docs/glancevault-stage1.md.
export const COLLECTION_KINDS = {
  tasks:            { idField: 'id',     tsField: 'lastModified' },
  unscheduledTasks: { idField: 'id',     tsField: 'lastModified' },
  recurringTasks:   { idField: 'id',     tsField: 'lastModified' }, // completedDates[] stays inside
  recycleBin:       { idField: 'id',     tsField: 'lastModified' },
  todayRoutines:    { idField: 'id',     tsField: 'lastModified' },
  habits:           { idField: 'id',     tsField: 'lastModified' }, // falls back to createdAt
  goals:            { idField: 'id',     tsField: 'updatedAt'    },
  projects:         { idField: 'id',     tsField: 'updatedAt'    },
  gtdFrames:        { idField: 'id',     tsField: 'lastModified' },
  users:            { idField: 'syncId', tsField: 'updatedAt'    }, // falls back to id
};

// The five task-shaped kinds. A task keeps its `id` while moving between these
// lists, so cross-list reconciliation operates over exactly this set.
export const TASK_KINDS = ['tasks', 'unscheduledTasks', 'recurringTasks', 'recycleBin', 'todayRoutines'];

// Deterministic tie-break order when the same id is live under multiple kinds
// with equal lastModified: earlier in the list wins. recycleBin first so an
// explicit delete beats a same-instant live edit (mirrors merge.js:540-543,
// where a recycle entry wins on a non-older timestamp).
export const CROSS_LIST_PRIORITY = ['recycleBin', 'recurringTasks', 'tasks', 'unscheduledTasks', 'todayRoutines'];

// dailyNotes is a MAP keyed by 'YYYY-MM-DD' → { text, lastModified, deleted? }.
// Each date is its own LWW row (merge.js:217). NOT insert-only: concurrent edits
// to different dates are different entityIds, so neither is lost; same-date edits
// resolve by lastModified, exactly as today.
export const DATE_MAP_KIND = 'dailyNotes';

// Every other top-level payload key → one singleton row carrying the whole
// structure in its current shape. Singletons are INSERT-ONLY (always applied) so
// the per-bundle merge below runs on every pull — a plain LWW upsert of a whole
// bundle row would silently drop the other device's concurrent edit to a
// different entry (the spec-5.3 risk Part A exists to close).
export const SINGLETON_KIND = 'singleton';

// Bundle pairings. A few bundles only merge correctly together: habitLogs needs
// its per-(date,habitId) timestamps, and each *Enabled / config flag needs its
// *UpdatedAt sibling for last-writer-wins. The owner row carries the siblings in
// `_extra`, so a single insert-only apply has everything it needs and stays
// order-independent. This is COARSER grouping, not finer remodeling (rule 4).
export const BUNDLE_OWNS = {
  habitLogs:            ['habitLogTimestamps'],
  routineCompletions:   ['routineCompletionTimestamps'],
  habitsEnabled:        ['habitsEnabledUpdatedAt'],
  routinesEnabled:      ['routinesEnabledUpdatedAt'],
  goalsProjectsEnabled: ['goalsProjectsEnabledUpdatedAt'],
  obsidianConfig:       ['obsidianConfigUpdatedAt'],
  multiUserEnabled:     ['multiUserEnabledUpdatedAt'],
};
const OWNED_KEYS = new Set(Object.values(BUNDLE_OWNS).flat());

// ── small helpers ────────────────────────────────────────────────────────────
const ts = (v) => {
  if (v == null) return 0;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? 0 : t;
};
const newerIso = (a, b) => (ts(a) >= ts(b) ? a : b);
// Key-order-independent deep equality, used to detect when a bundle merge left
// our local copy richer than the row we just pulled (→ re-push the superset).
const deepEqual = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== typeof b) return a === b;
  if (typeof a !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
};
// Last-writer-wins for a single config value via paired updatedAt timestamps;
// remote wins ties (mirrors merge.js pickConfigByTs:12-17).
const pickByTs = (localVal, localTs, remoteVal, remoteTs) =>
  (ts(remoteTs) >= ts(localTs) ? remoteVal : localVal);

// ── kind / mutability / tiebreaker (engine callbacks) ──────────────────────────
export function entityKind(entity) {
  if (!entity || typeof entity !== 'object') return null;
  return typeof entity._kind === 'string' ? entity._kind : null;
}

// Singletons (bundles) are insert-only: always applied so their merge runs.
// Collections and per-date dailyNotes use normal entity-grain LWW.
export function isInsertOnly(entity) {
  return entityKind(entity) === SINGLETON_KIND;
}

export function getEntityLastModified(entity) {
  const kind = entityKind(entity);
  if (!kind) return undefined;
  const value = entity.value;
  if (kind === DATE_MAP_KIND) {
    return value && typeof value === 'object' ? value.lastModified : undefined;
  }
  if (kind === SINGLETON_KIND) {
    // Insert-only, so the engine ignores this; surface an ISO bundle value
    // (e.g. tombstonePrunedBefore) for completeness, else undefined.
    return typeof value === 'string' ? value : undefined;
  }
  const cfg = COLLECTION_KINDS[kind];
  if (!cfg || !value || typeof value !== 'object') return undefined;
  return value[cfg.tsField] ?? value.lastModified ?? value.updatedAt ?? value.createdAt;
}

// ── entityId scheme: kind is always part of the id so two kinds that share a
// numeric id never collide on one vault row (a cross-list-moving task is the
// case that matters — see TASK_KINDS / reconcileCrossList).
export function makeEntityId(kind, id) {
  return `${kind}:${id}`;
}
function splitEntityId(entityId) {
  const s = String(entityId);
  const i = s.indexOf(':');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

function makeRow(kind, entityId, value, extra = {}) {
  return { entityId, kind, entity: { _kind: kind, ...extra, value } };
}

// Build the wrapped entity for one singleton, pulling its owned siblings into
// `_extra`. Returns null when the bundle is genuinely absent.
function makeSingletonEntity(data, key) {
  if (!(key in data) && !BUNDLE_OWNS[key]) return null;
  const entity = { _kind: SINGLETON_KIND, _key: key, value: data[key] };
  const owned = BUNDLE_OWNS[key];
  if (owned) {
    const extra = {};
    for (const k of owned) extra[k] = data[k];
    entity._extra = extra;
  }
  return entity;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHRED: full payload `.data` → rows
// ─────────────────────────────────────────────────────────────────────────────
export function shredState(data) {
  if (!data || typeof data !== 'object') return [];
  const rows = [];
  const handled = new Set([DATE_MAP_KIND]);

  for (const [kind, cfg] of Object.entries(COLLECTION_KINDS)) {
    handled.add(kind);
    for (const item of (Array.isArray(data[kind]) ? data[kind] : [])) {
      const id = item == null ? undefined : (item[cfg.idField] ?? item.id);
      rows.push(makeRow(kind, makeEntityId(kind, id), item));
    }
  }

  const notes = data[DATE_MAP_KIND];
  if (notes && typeof notes === 'object') {
    for (const dateKey of Object.keys(notes)) {
      rows.push(makeRow(DATE_MAP_KIND, makeEntityId(DATE_MAP_KIND, dateKey), notes[dateKey], { _key: dateKey }));
    }
  }

  // Remaining keys → one singleton row each. Owned siblings ride inside their
  // owner's `_extra`, so skip emitting them standalone.
  for (const key of Object.keys(data)) {
    if (handled.has(key) || OWNED_KEYS.has(key)) continue;
    rows.push({ entityId: makeEntityId(SINGLETON_KIND, key), kind: SINGLETON_KIND, entity: makeSingletonEntity(data, key) });
  }

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// REASSEMBLE: rows → full payload `.data` (single-device, lossless)
// ─────────────────────────────────────────────────────────────────────────────
export function reassembleState(rows) {
  const data = {};
  for (const kind of Object.keys(COLLECTION_KINDS)) data[kind] = [];
  data[DATE_MAP_KIND] = {};

  for (const row of rows || []) {
    const entity = row && row.entity;
    const kind = entityKind(entity);
    if (kind === SINGLETON_KIND) {
      data[entity._key] = entity.value;
      if (entity._extra) Object.assign(data, entity._extra);
    } else if (kind === DATE_MAP_KIND) {
      data[DATE_MAP_KIND][entity._key] = entity.value;
    } else if (COLLECTION_KINDS[kind]) {
      data[kind].push(entity.value);
    } else {
      throw new Error(`reassembleState: unroutable row _kind=${JSON.stringify(kind)}`);
    }
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-ROW APPLY / MERGE (stage 2)
//
// These mutate `data` in place — the same contract as the reference's Dexie
// appliers (write directly, never through the dirty-tracked path, so a pulled
// row never bounces back as a push).
// ─────────────────────────────────────────────────────────────────────────────

// Shred one entity by id (engine getLocalEntity). Returns null on absence, which
// the engine treats as a soft-delete on push.
export function getLocalEntity(data, entityId) {
  const [kind, id] = splitEntityId(entityId);
  if (COLLECTION_KINDS[kind]) {
    const cfg = COLLECTION_KINDS[kind];
    const item = (data[kind] || []).find((x) => x != null && String(x[cfg.idField] ?? x.id) === id);
    return item ? { _kind: kind, value: item } : null;
  }
  if (kind === DATE_MAP_KIND) {
    const v = (data[DATE_MAP_KIND] || {})[id];
    return v ? { _kind: DATE_MAP_KIND, _key: id, value: v } : null;
  }
  if (kind === SINGLETON_KIND) {
    if (OWNED_KEYS.has(id)) return null;
    return makeSingletonEntity(data, id);
  }
  return null;
}

function upsertCollection(data, kind, value) {
  const cfg = COLLECTION_KINDS[kind];
  if (!Array.isArray(data[kind])) data[kind] = [];
  const idOf = (x) => String(x[cfg.idField] ?? x.id);
  const id = idOf(value);
  const idx = data[kind].findIndex((x) => x != null && idOf(x) === id);
  if (idx >= 0) data[kind][idx] = value;
  else data[kind].push(value);
}

// Apply one pulled row, merging it into `data`. Returns an array of entityIds
// the device should re-mark dirty (re-push). This is non-empty only for a bundle
// whose per-key/union merge left our local copy richer than the row we pulled:
// because the vault stores ONE row per entityId (upsert, last-write-wins), a
// device that pushes before pulling clobbers the other device's concurrent
// bundle edit at the vault. Re-pushing the merged superset is what lets union /
// key-recency bundles still converge at the vault (mirrors the file-tier
// `remoteChanged` → "remote needs this" flag in merge.js). It terminates: once
// the vault holds the full superset, the merge changes nothing and no re-push
// is emitted. Collections and per-date dailyNotes never need this — independent
// edits there already land on distinct entityIds.
export function applyRemoteEntity(data, entity) {
  const kind = entityKind(entity);
  if (COLLECTION_KINDS[kind]) {
    upsertCollection(data, kind, entity.value);
    return [];
  }
  if (kind === DATE_MAP_KIND) {
    if (!data[DATE_MAP_KIND] || typeof data[DATE_MAP_KIND] !== 'object') data[DATE_MAP_KIND] = {};
    data[DATE_MAP_KIND][entity._key] = entity.value;
    return [];
  }
  if (kind === SINGLETON_KIND) {
    const key = entity._key;
    mergeBundle(data, key, entity.value, entity._extra || {});
    if (keptLocalBundle(data, key)) return []; // kept local, never re-pushed
    const merged = makeSingletonEntity(data, key);
    const same = deepEqual(merged.value, entity.value) && deepEqual(merged._extra || {}, entity._extra || {});
    return same ? [] : [makeEntityId(SINGLETON_KIND, key)];
  }
  return [];
}

export function applyRemoteDelete(data, entityId) {
  const [kind, id] = splitEntityId(entityId);
  if (COLLECTION_KINDS[kind]) {
    const cfg = COLLECTION_KINDS[kind];
    data[kind] = (data[kind] || []).filter((x) => x == null || String(x[cfg.idField] ?? x.id) !== id);
  } else if (kind === DATE_MAP_KIND) {
    if (data[DATE_MAP_KIND]) delete data[DATE_MAP_KIND][id];
  }
  // singletons are never row-deleted
}

// ── Per-bundle merge: the spec-5.3 fix. Each bundle merges by its own strategy
// so concurrent edits to DIFFERENT entries are never lost. See the strategy
// table in docs/glancevault-stage2.md.
const MERGE = {
  // {key → ISO}: keep the newer timestamp per key (grow-only set-union).
  unionNewerIso(local = {}, remote = {}) {
    const out = { ...local };
    for (const [k, v] of Object.entries(remote)) out[k] = newerIso(out[k], v);
    return out;
  },
  // string[]: set-union (grow-only).
  unionArray(local = [], remote = []) {
    return [...new Set([...(local || []), ...(remote || [])])];
  },
};

const TOMBSTONE_BUNDLES = new Set([
  'deletedTaskIds', 'deletedRoutineChipIds', 'deletedFrameIds', 'removedTodayRoutineIds',
  'deletedHabitIds', 'deletedGoalIds', 'deletedProjectIds',
]);
// Device-local prefs: the file-tier merge keeps the local value (merge.js:900-901
// / weather not in merge output), so a pulled value never overwrites it. Listed
// so the default branch doesn't LWW-clobber them. obsidianConfig is here
// unconditionally because the Obsidian vault genuinely differs per machine
// (installed or not, different path).
const ALWAYS_DEVICE_LOCAL = new Set([
  'minimizedSections', 'use24HourClock', 'weatherZip', 'weatherTempUnit', 'multiUserEnabled',
  'obsidianConfig',
]);
// Feature-enablement toggles and the calendar-subscription URLs are device-local
// ONLY when multi-user is on. For the toggles, so one household member hiding a
// feature does not hide it for everyone; for the URLs, because each user's
// calendar config travels per-user via the calendarConfigByUser map instead (so
// it never leaks to other users on the same account). A single-user install
// keeps both syncing across that user's own devices — the gate reads the LOCAL
// multiUserEnabled flag (itself device-local, so stable regardless of merge order).
const MULTIUSER_DEVICE_LOCAL = new Set([
  'habitsEnabled', 'routinesEnabled', 'goalsProjectsEnabled', 'syncUrl', 'taskCalendarUrl',
]);
// True when `key` must keep the local value rather than accept the pulled one,
// given this device's multi-user state. Used by both the merge and the re-push
// guard so they stay in lockstep.
const keptLocalBundle = (data, key) =>
  ALWAYS_DEVICE_LOCAL.has(key) || (MULTIUSER_DEVICE_LOCAL.has(key) && !!data.multiUserEnabled);

function mergeBundle(data, key, value, extra) {
  if (TOMBSTONE_BUNDLES.has(key)) {
    data[key] = MERGE.unionNewerIso(data[key] || {}, value || {});
    return;
  }
  switch (key) {
    case 'habitLogs': {
      // per-(date,habitId) recency merge; timestamps ride in _extra so the merge
      // is self-contained and order-independent.
      const res = mergeHabitLogs(
        data.habitLogs || {}, value || {},
        data.habitLogTimestamps || {}, extra.habitLogTimestamps || {},
      );
      data.habitLogs = res.merged;
      data.habitLogTimestamps = res.mergedTimestamps;
      return;
    }
    case 'routineDefinitions': {
      // per-chip merge, claim-aware, respecting chip tombstones (which converge
      // separately as their own union bundle).
      const res = mergeRoutineDefinitions(
        data.routineDefinitions || {}, value || {}, data.deletedRoutineChipIds || {},
      );
      data.routineDefinitions = res.merged;
      return;
    }
    case 'routineCompletions': {
      // Per-routine LWW on the timestamp sibling (rides in _extra) so an
      // un-complete propagates instead of being resurrected by a grow-union.
      const res = mergeRoutineCompletions(
        data.routineCompletions || {}, value || {},
        data.routineCompletionTimestamps || {}, extra.routineCompletionTimestamps || {},
      );
      data.routineCompletions = res.merged;
      data.routineCompletionTimestamps = res.mergedTimestamps;
      return;
    }
    case 'completedTaskUids':
      data.completedTaskUids = MERGE.unionArray(data.completedTaskUids || [], value || []);
      return;
    case 'routinesDate':
      data.routinesDate = (data.routinesDate && data.routinesDate > value) ? data.routinesDate : value;
      return;
    case 'unscheduledOrderTimestamp':
    case 'tombstonePrunedBefore':
      data[key] = newerIso(data[key], value);
      return;
    case 'syncUrl':
    case 'taskCalendarUrl':
      // Multi-user: keep local — the per-user calendarConfigByUser map carries
      // each user's URL instead, so it never leaks across users on one account.
      if (data.multiUserEnabled) return;
      // prefer a non-empty value; don't let an unconfigured device clear a URL
      // (mirrors merge.js:810-815).
      data[key] = value || data[key] || '';
      return;
    case 'calendarConfigByUser': {
      // {syncId → {syncUrl, taskCalendarUrl, auth?, updatedAt}}: union by syncId,
      // keep the newer entry per user (LWW). Each device reads only its own
      // syncId's entry, so concurrent edits by different users never collide.
      const local = data.calendarConfigByUser || {};
      const remote = value || {};
      const out = { ...local };
      for (const [sid, entry] of Object.entries(remote)) {
        if (!out[sid] || ts(entry?.updatedAt) > ts(out[sid]?.updatedAt)) out[sid] = entry;
      }
      data.calendarConfigByUser = out;
      return;
    }
    case 'habitsEnabled':
    case 'routinesEnabled':
    case 'goalsProjectsEnabled': {
      // Multi-user: keep local (device-local). Single-user: LWW across own devices.
      if (data.multiUserEnabled) return;
      const tsKey = `${key}UpdatedAt`;
      data[key] = pickByTs(data[key], data[tsKey], value, extra[tsKey]);
      data[tsKey] = newerIso(data[tsKey], extra[tsKey]);
      return;
    }
    default:
      // obsidianConfig (and the clock/weather/minimized prefs) are kept local —
      // see ALWAYS_DEVICE_LOCAL for why these are per-device, not last-writer-wins.
      if (ALWAYS_DEVICE_LOCAL.has(key)) return; // keep local
      // Unknown bundle: fall back to LWW overwrite, but make it visible so a new
      // bundle type isn't silently subjected to a loss window.
      // eslint-disable-next-line no-console
      console.warn(`[dbAdapter] bundle '${key}' has no merge strategy — LWW overwrite (possible loss window)`);
      data[key] = value;
  }
}

// ── Cross-list reconciliation (spec 5.2). A task can be live under more than one
// kind after concurrent moves on two devices. Keep exactly one copy — newest
// lastModified, ties broken by CROSS_LIST_PRIORITY — and report each removed
// copy via onLoser so the caller can soft-delete its stale ${kind}:${id} row,
// converging the vault. Deterministic, so every device picks the same winner.
export function reconcileCrossList(data, onLoser) {
  const byId = new Map();
  for (const kind of TASK_KINDS) {
    for (const item of (data[kind] || [])) {
      if (item == null) continue;
      const id = String(item.id);
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push({ kind, item });
    }
  }
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => {
      const d = ts(b.item.lastModified) - ts(a.item.lastModified);
      if (d !== 0) return d;
      return CROSS_LIST_PRIORITY.indexOf(a.kind) - CROSS_LIST_PRIORITY.indexOf(b.kind);
    });
    for (const loser of entries.slice(1)) {
      data[loser.kind] = (data[loser.kind] || []).filter((x) => String(x.id) !== id);
      if (onLoser) onLoser(makeEntityId(loser.kind, id));
    }
  }
}
