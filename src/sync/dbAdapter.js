// dayGLANCE → GLANCEvault entity-to-row adapter (cutover STAGE 1 of 2).
//
// NON-DESTRUCTIVE. This module is pure shred/reassemble logic. It performs no
// network I/O, touches no transport, writes nothing to a real server, and is
// not yet wired into App.jsx. It exists so stage 1 can prove that dayGLANCE's
// full sync payload is losslessly representable as the row-grained rows the
// GLANCEvault DB engine (createDbSyncEngine, @glance-apps/sync@1.3.2) exchanges.
//
// It mirrors lastGLANCE's src/sync/dbEngine.ts mapping (getLocalEntity /
// applyRemoteEntity / isInsertOnly / getEntityLastModified) with ONE deliberate
// divergence, forced by dayGLANCE's data model:
//
//   The reference derives entity kind by STRUCTURAL SNIFFING of field names
//   (entityKind), because lastGLANCE had only 4 well-separated types. dayGLANCE
//   has a dozen-plus types and five of them — tasks, unscheduledTasks,
//   recurringTasks, recycleBin, todayRoutines — are the IDENTICAL task shape
//   (App.jsx stamps all five through the same stampTaskTimestamps path,
//   useDataPersistence.js:177-181). No structural sniff can tell a scheduled
//   task from an inbox task from a today-routine: they carry the same fields.
//   So this adapter carries an EXPLICIT `_kind` discriminator INSIDE the
//   encrypted envelope and routes on it. encryptEntity (dbCrypto.js:274)
//   JSON-stringifies the whole entity before AES-GCM, so `_kind` is sealed in
//   the per-entity ciphertext — the server still sees only opaque bytes, so the
//   transport stays zero-knowledge. See docs/glancevault-stage1.md for the full
//   discrimination decision and proof.
//
// SCOPING (rule 4 of the stage-1 brief): this is a faithful TRANSPORT shred,
// NOT a data-model change. Bundled structures keep their current shape —
// recurringTasks.completedDates stays an array inside its row, habitLogs stays
// a keyed map carried whole in a single row. Finer per-completion remodeling is
// a separate future enhancement and is intentionally NOT done here.

// ── Collection kinds: each ARRAY element becomes one row, keyed by a stable id.
// idField  — the row's stable entityId source (the same id the file-tier merge
//            keys on in @glance-apps/sync merge.js).
// tsField  — the entity-grain last-writer-wins tiebreaker the merge compares.
//            Evidence (file:line) is tabulated in docs/glancevault-stage1.md.
export const COLLECTION_KINDS = {
  // Task-shaped lists. All five share { id, title, duration, color, completed,
  // lastModified, ... }; only `_kind` distinguishes them on the wire.
  tasks:            { idField: 'id',     tsField: 'lastModified' },
  unscheduledTasks: { idField: 'id',     tsField: 'lastModified' },
  recurringTasks:   { idField: 'id',     tsField: 'lastModified' }, // completedDates[] stays inside the row
  recycleBin:       { idField: 'id',     tsField: 'lastModified' },
  todayRoutines:    { idField: 'id',     tsField: 'lastModified' },
  // Non-task collections.
  habits:           { idField: 'id',     tsField: 'lastModified' }, // falls back to createdAt (merge.js:299)
  goals:            { idField: 'id',     tsField: 'updatedAt'    },
  projects:         { idField: 'id',     tsField: 'updatedAt'    },
  gtdFrames:        { idField: 'id',     tsField: 'lastModified' },
  users:            { idField: 'syncId', tsField: 'updatedAt'    }, // falls back to id (merge.js:843)
};

// dailyNotes is a MAP keyed by 'YYYY-MM-DD' → { text, lastModified, deleted? }.
// The merge resolves it per-date (merge.js:217), so each date is its own row.
export const DATE_MAP_KIND = 'dailyNotes';

// Wire `_kind` value for every other top-level payload key — the bundles and
// scalar/config values that have no per-item id and must NOT be split into
// finer rows (rule 4). Each becomes exactly one singleton row.
export const SINGLETON_KIND = 'singleton';

// Entity kinds that are insert-only (immutable, never collide on merge). In the
// reference these are completionEvents. dayGLANCE has NONE in stage 1: completion
// remodeling is explicitly out of scope (rule 4), so every kind mutable-upserts
// at its grain.
const INSERT_ONLY_KINDS = new Set();

// ── Read the discriminator the engine routes on (replaces the reference's
// structural entityKind sniff). The kind is an explicit field, never inferred.
export function entityKind(entity) {
  if (!entity || typeof entity !== 'object') return null;
  return typeof entity._kind === 'string' ? entity._kind : null;
}

// ── isInsertOnly: engine callback. Stage 1 has no insert-only per-item type.
export function isInsertOnly(entity) {
  return INSERT_ONLY_KINDS.has(entityKind(entity));
}

// ── getEntityLastModified: engine callback. Entity-grain LWW tiebreaker.
// Reads the per-kind tsField from the wrapped value. Singletons/date-map rows
// surface a best-effort timestamp where the bundle carries one, else undefined
// (flagged in the stampTaskTimestamps / dirtiness report — some bundles have no
// timestamp; that is a known stage-2 concern, not a losslessness blocker).
export function getEntityLastModified(entity) {
  const kind = entityKind(entity);
  if (!kind) return undefined;
  const value = entity.value;
  if (kind === DATE_MAP_KIND) {
    return value && typeof value === 'object' ? value.lastModified : undefined;
  }
  if (kind === SINGLETON_KIND) {
    // Bundles rarely carry their own timestamp. The *enabled flags travel with a
    // sibling *UpdatedAt singleton; obsidianConfig likewise. Surface a string
    // value when the bundle itself is an ISO stamp (e.g. tombstonePrunedBefore),
    // otherwise undefined — the engine treats undefined as epoch-0.
    return typeof value === 'string' ? value : undefined;
  }
  const cfg = COLLECTION_KINDS[kind];
  if (!cfg || !value || typeof value !== 'object') return undefined;
  return value[cfg.tsField]
    ?? value.lastModified
    ?? value.updatedAt
    ?? value.createdAt;
}

// ── entityId scheme. The kind is ALWAYS part of the id so two different kinds
// that share a numeric id never collide on one vault row. This matters for
// dayGLANCE specifically: a task mid cross-list move exists in BOTH `tasks` and
// `unscheduledTasks` with the SAME id (the file-tier merge reconciles that —
// merge.js:556-601). Keyed by `${kind}:${id}` those become two distinct rows,
// which is exactly what losslessness requires (both copies survive the
// roundtrip). Stage 2 must apply the same cross-list reconciliation on pull.
export function makeEntityId(kind, id) {
  return `${kind}:${id}`;
}

// Build one wire row. `entity` is the plaintext object handed to encryptEntity;
// it wraps the original value so the user payload is never polluted with adapter
// fields and round-trips byte-for-byte. `_kind`/`_key` live alongside `value`,
// all sealed inside the per-entity ciphertext.
function makeRow(kind, entityId, value, extra = {}) {
  return { entityId, kind, entity: { _kind: kind, ...extra, value } };
}

/**
 * SHRED: full payload `.data` → array of rows.
 *
 * @param {object} data - the `.data` object from buildSyncPayload (App.jsx:5382)
 * @returns {Array<{ entityId: string, kind: string, entity: object }>}
 */
export function shredState(data) {
  if (!data || typeof data !== 'object') return [];
  const rows = [];
  const handled = new Set([DATE_MAP_KIND]);

  // Per-item collection rows.
  for (const [kind, cfg] of Object.entries(COLLECTION_KINDS)) {
    handled.add(kind);
    const arr = Array.isArray(data[kind]) ? data[kind] : [];
    for (const item of arr) {
      const id = item == null ? undefined : (item[cfg.idField] ?? item.id);
      rows.push(makeRow(kind, makeEntityId(kind, id), item));
    }
  }

  // dailyNotes: one row per date key.
  const notes = data[DATE_MAP_KIND];
  if (notes && typeof notes === 'object') {
    for (const dateKey of Object.keys(notes)) {
      rows.push(makeRow(DATE_MAP_KIND, makeEntityId(DATE_MAP_KIND, dateKey), notes[dateKey], { _key: dateKey }));
    }
  }

  // Everything else (bundles + scalar/config) → one singleton row each, carried
  // in its CURRENT shape. Iterating every remaining key guarantees no field is
  // dropped even if the payload gains a key the registry above doesn't name.
  for (const key of Object.keys(data)) {
    if (handled.has(key)) continue;
    rows.push(makeRow(SINGLETON_KIND, makeEntityId(SINGLETON_KIND, key), data[key], { _key: key }));
  }

  return rows;
}

/**
 * REASSEMBLE: rows → full payload `.data`.
 *
 * Reconstructs the canonical skeleton (every collection key present, even when
 * empty — buildSyncPayload always emits all of them) and routes each row by its
 * explicit `_kind`. Order within a collection follows row order.
 *
 * @param {Array<{ entity: object }>} rows
 * @returns {object} the rebuilt `.data`
 */
export function reassembleState(rows) {
  const data = {};
  // Canonical skeleton: every collection is always present in buildSyncPayload.
  for (const kind of Object.keys(COLLECTION_KINDS)) data[kind] = [];
  data[DATE_MAP_KIND] = {};

  for (const row of rows || []) {
    const entity = row && row.entity;
    const kind = entityKind(entity);
    if (kind === SINGLETON_KIND) {
      data[entity._key] = entity.value;
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
