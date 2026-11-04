// A project's or goal's link to its Obsidian note, as every reader sees it
// (companion spec §4.3, rulings A and F). Pure. The record fields are
// documented with the rest of the link logic in the app's
// src/utils/obsidianProjectNotes.js; these two are here because the MCP read
// surface (@glance-apps/dayglance-mcp) reports the link too, and must read it
// exactly as the app does.
//
//   obsidianNotePath        vault-relative path of the linked note, or null
//   obsidianNoteMissingAt   set while the note is observed deleted (ruling F)
//   obsidianNoteLinkPending set while the record holds the link alone

/** The note as Obsidian names it: the path without the .md extension. */
export function noteDisplayName(path) {
  return String(path ?? '').replace(/\.md$/i, '');
}

/**
 * The entity's link for display, or null when unlinked. `pending` is a link
 * the record holds alone, the note not yet carrying the key.
 * @returns {{ path: string, name: string, missing: boolean, pending: boolean } | null}
 */
export function noteLinkOf(entity) {
  const path = typeof entity?.obsidianNotePath === 'string' ? entity.obsidianNotePath : '';
  if (!path) return null;
  return { path, name: noteDisplayName(path), missing: !!entity.obsidianNoteMissingAt, pending: !!entity.obsidianNoteLinkPending };
}
