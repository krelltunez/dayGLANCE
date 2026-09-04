// The dayGLANCE-maintained frontmatter map on a linked project or goal note
// (companion spec §4.3, rulings B and C; shrunk 2026-09-04). Pure.
//
// Ruling B: every maintained key lives under ONE map key, `dayglance:`.
// dayGLANCE wins inside it; nothing outside it is ever read or written.
// Ruling C, as amended: the map carries only what Dataview cannot compute
// from the vault itself — `kind`, `status`, and on a project note `goal`,
// the wikilink that lets a goal note query its projects live. Counts and
// dates were write-only output that cost a synced-file write every time a
// task moved; they are gone, and so is the `updated` stamp that turned any
// change into a write. A block now changes only when a status or a goal
// assignment changes.

export const NOTE_BLOCK_KEY = 'dayglance';

/** `[[path|title]]` for a note path (the .md dropped); the title alone when unlinked. */
export function noteWikilink(path, title) {
  const p = String(path ?? '').replace(/\.md$/i, '');
  const t = String(title ?? '').trim();
  if (!p) return t;
  const base = p.split('/').pop();
  return base === t || !t ? `[[${p}]]` : `[[${p}|${t}]]`;
}

/**
 * The map for a project note.
 * @param {object} project
 * @param {{ goal?: object|null, goalNotePath?: string|null }} ctx  the project's goal (when any) and its linked note
 */
export function projectNoteBlock(project, { goal = null, goalNotePath = null } = {}) {
  const block = { kind: 'project', status: project.status || 'active' };
  if (goal) block.goal = goalNotePath ? noteWikilink(goalNotePath, goal.title) : String(goal.title ?? '').trim();
  return block;
}

/** The map for a goal note. */
export function goalNoteBlock(goal) {
  return { kind: 'goal', status: goal.status || 'active' };
}

/** True when the maps differ (key order does not matter). */
export function noteBlockChanged(prev, next) {
  const canon = (o) => (o && typeof o === 'object' ? JSON.stringify(o, Object.keys(o).sort()) : 'null');
  return canon(prev) !== canon(next);
}
