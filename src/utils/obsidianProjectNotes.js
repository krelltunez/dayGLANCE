// Project and goal notes: the LINK (companion spec §4.3, rulings A and F).
// Pure.
//
// A project (or goal) links to ONE vault note. The durable identity is the
// `dayglance-id` frontmatter key in the note, holding the entity's UUID; the
// synced locator is `obsidianNotePath` on the entity record. The plugin owns
// the vault side (it writes the key, watches renames and deletes, re-finds a
// note by its key) and reports link OBSERVATIONS; this module turns those
// observations into record updates, and shapes the link for the UI.
//
// Record fields:
//   obsidianNotePath       vault-relative path of the linked note, or null
//   obsidianNoteMissingAt  ISO time the note was observed deleted (ruling F:
//                          the project keeps its path so a relink can prefill,
//                          but everything that reads the link treats it as
//                          absent while this is set)

import { noteKeyForPath } from '@glance-apps/obsidian-format';

/** A user-typed note reference → a normalized vault path ending in .md, or ''. */
export function normalizeNotePath(input) {
  let s = String(input ?? '').trim();
  if (!s) return '';
  s = s.replace(/^\[\[|\]\]$/g, '').trim();
  const hashIdx = s.indexOf('#');
  if (hashIdx > 0) s = s.slice(0, hashIdx).trim();
  if (!s) return '';
  if (!/\.md$/i.test(s)) s = `${s}.md`;
  return noteKeyForPath(s);
}

/** The note as Obsidian names it: the path without the .md extension. */
export function noteDisplayName(path) {
  return String(path ?? '').replace(/\.md$/i, '');
}

/**
 * The entity's link for display, or null when unlinked.
 * @returns {{ path: string, name: string, missing: boolean } | null}
 */
export function noteLinkOf(entity) {
  const path = typeof entity?.obsidianNotePath === 'string' ? entity.obsidianNotePath : '';
  if (!path) return null;
  return { path, name: noteDisplayName(path), missing: !!entity.obsidianNoteMissingAt };
}

/**
 * Turn the plugin's link observations into record updates.
 *
 * Each observation names a target id and a path, and is one of:
 *   • a link      → the note at `path` carries the id: set the locator, clear
 *                   any missing mark (a trash restore or a relink lands here)
 *   • deleted     → the linked note is gone (ruling F): keep the path, mark
 *                   missing at the observation time; ignored when the record
 *                   already points elsewhere (a newer link won)
 *   • unlinked    → the key was removed from the note: clear both fields when
 *                   the record still points at that path
 *
 * @param {Array<{targetId: string, path: string, deleted?: boolean, unlinked?: boolean, observedAt?: string}>} links
 * @param {{ projects?: object[], goals?: object[] }} lists
 * @returns {{ projects: Array<{id: string, updates: object}>, goals: Array<{id: string, updates: object}> }}
 */
export function planNoteLinkUpdates(links, { projects = [], goals = [] } = {}) {
  const out = { projects: [], goals: [] };
  if (!Array.isArray(links) || links.length === 0) return out;
  const working = new Map(); // `${kind}:${id}` → current view of the entity
  const find = (id) => {
    const key = String(id);
    for (const [kind, list] of [['projects', projects], ['goals', goals]]) {
      const hit = (list || []).find((e) => e && String(e.id) === key);
      if (hit) {
        const k = `${kind}:${key}`;
        if (!working.has(k)) working.set(k, { kind, id: key, entity: { ...hit }, updates: null });
        return working.get(k);
      }
    }
    return null;
  };
  const ordered = [...links].sort((a, b) => String(a.observedAt ?? '').localeCompare(String(b.observedAt ?? '')));
  for (const link of ordered) {
    if (!link || typeof link.targetId !== 'string' || typeof link.path !== 'string') continue;
    const slot = find(link.targetId);
    if (!slot) continue;
    const cur = slot.entity;
    let updates = null;
    if (link.unlinked) {
      if (cur.obsidianNotePath && cur.obsidianNotePath === link.path) {
        updates = { obsidianNotePath: null, obsidianNoteMissingAt: null };
      }
    } else if (link.deleted) {
      if (cur.obsidianNotePath === link.path && !cur.obsidianNoteMissingAt) {
        updates = { obsidianNoteMissingAt: link.observedAt || new Date().toISOString() };
      }
    } else if (cur.obsidianNotePath !== link.path || cur.obsidianNoteMissingAt) {
      updates = { obsidianNotePath: link.path, obsidianNoteMissingAt: null };
    }
    if (!updates) continue;
    slot.entity = { ...cur, ...updates };
    slot.updates = { ...(slot.updates || {}), ...updates };
  }
  for (const slot of working.values()) {
    if (slot.updates) out[slot.kind].push({ id: slot.id, updates: slot.updates });
  }
  return out;
}
