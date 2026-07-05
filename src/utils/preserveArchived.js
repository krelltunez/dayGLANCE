// Preserve the app-only `archived` flag across a sync/merge apply.
//
// `archived` is a dayGLANCE-local flag. A remote row from a device that never
// archived the item — or an older row the whole-entity last-writer-wins merge
// picked without it — arrives with `archived` ABSENT. Applying that copy as-is
// silently un-archives the item AND, because it differs from the healed in-memory
// state, re-stamps `lastModified` on every sync — an endless push/strip churn.
//
// Rule: when the incoming copy OMITS `archived` (value is `undefined`), fall back
// to the current in-memory value. A genuine remote unarchive sends
// `archived: false` EXPLICITLY, which is NOT `undefined`, so it is left untouched
// and still propagates. Items are matched by id.
//
// @param {object[]} incoming  the merged/remote tasks about to be applied
// @param {object[]} existing  the current in-memory tasks (source of the local flag)
// @returns {object[]} incoming with `archived` back-filled where it was absent
export function preserveArchived(incoming, existing) {
  const local = new Map(
    (existing || [])
      .filter((t) => t && t.archived !== undefined)
      .map((t) => [String(t.id), t.archived]),
  );
  return (incoming || []).map((t) => {
    if (!t || t.archived !== undefined) return t;
    const localArchived = local.get(String(t.id));
    return localArchived === undefined ? t : { ...t, archived: localArchived };
  });
}
