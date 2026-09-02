// The vault's USER SCOPE (companion spec 4.2 decision 9, the writeback and
// scan ruling of 2026-09-02). Pure.
//
// A vault belongs to one person (the owner's assumption of record). Two
// rules follow, both keyed on the vault's VIEWER — the user the vault is
// scoped to — never on the importing device's user:
//
//  • IMPORT: a task first seen in the vault is assigned to the viewer. In
//    dayGLANCE "unassigned" means shared with every member, and a personal
//    vault is a personal capture surface, so shared is the wrong default. A
//    task the user wants shared is unassigned in dayGLANCE afterwards.
//    FIRST IMPORT ONLY: a task already known to the app keeps whatever
//    assignment the app holds — assignment is app-owned and the scan never
//    rewrites it (the preserve-app-fields carry already guarantees that for
//    known tasks; this helper simply never touches them).
//  • WRITE: only tasks visible to the viewer are written to the vault, so
//    another member's tasks never land in this person's notes.
//
// WHICH VIEWER. On direct access the vault sits on this device, so the
// viewer is this device's user. On the plugin path every dayGLANCE device
// on the account applies the same observation stream, so the importing
// device's user would be wrong half the time; the viewer comes from the
// plugin's pairing-meta row instead (`userSyncId`: the pairing's default or
// the plugin's "Show tasks for" setting). No viewer (single-user, or a
// plugin predating the field) means the pre-ruling behavior: unassigned on
// import, everything written.

/**
 * @param {{ authoritative: boolean, meta?: { userSyncId?: string|null } | null, multiUserEnabled?: boolean, meUserSyncId?: string|null }} ctx
 * @returns {string|null}
 */
export function vaultViewerFor({ authoritative, meta = null, multiUserEnabled = false, meUserSyncId = null }) {
  if (authoritative) {
    const v = meta && typeof meta.userSyncId === 'string' ? meta.userSyncId : null;
    return v || null;
  }
  return multiUserEnabled && typeof meUserSyncId === 'string' && meUserSyncId ? meUserSyncId : null;
}

/** The app's visibility rule, for a viewer: unassigned, or assigned to the viewer. */
export function visibleToViewer(task, viewer) {
  if (!viewer) return true;
  const assigned = task?.assignedUserSyncIds;
  return !Array.isArray(assigned) || assigned.length === 0 || assigned.includes(viewer);
}

/**
 * Stamp first-import assignment: every task NOT in `knownIds` and carrying no
 * assignment becomes the viewer's. Returns the same array when nothing
 * changes. Known ids (live lists and the recycle bin) are left exactly as
 * scanned, so the app's own assignment survives the merge's carry.
 */
export function assignVaultViewer(tasks, { viewer, knownIds }) {
  if (!viewer || !Array.isArray(tasks) || !tasks.length) return tasks;
  let changed = false;
  const out = tasks.map((t) => {
    if (!t || knownIds.has(String(t.id))) return t;
    if (Array.isArray(t.assignedUserSyncIds) && t.assignedUserSyncIds.length) return t;
    changed = true;
    return { ...t, assignedUserSyncIds: [viewer] };
  });
  return changed ? out : tasks;
}

/** The ids the app already knows: both live lists plus the recycle bin. */
export function knownTaskIds(...lists) {
  const ids = new Set();
  for (const list of lists) for (const t of list || []) if (t && t.id != null) ids.add(String(t.id));
  return ids;
}
