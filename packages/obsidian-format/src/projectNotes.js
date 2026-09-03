// Project and goal note WORKSPACES (companion spec §4.3, rulings D and E).
// Pure: where a note born in dayGLANCE goes, what it is called, and the
// template subset. The plugin applies these; dayGLANCE only asks.
//
// Layouts (a plugin setting, default `note`):
//   note    — one note per project under the projects folder
//             (Projects/House.md); goals likewise under the goals folder
//   folder  — a folder per project with an index note of the same name
//             (Projects/House/House.md)
//   nested  — the E amendment: a goal gets a folder under the goals folder
//             and a project WITH a goal gets its folder inside the goal's
//             (Goals/Home/House/House.md); a standalone project falls back
//             to the folder layout under the projects folder
// Placement happens at creation time only; nothing is ever moved.

import { validateVaultNameSegment } from './filename.js';

export const PROJECT_NOTE_LAYOUTS = ['note', 'folder', 'nested'];

const trimFolder = (s, fallback) => {
  const t = String(s ?? '').normalize('NFC').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').trim();
  return t || fallback;
};

/** Canonical settings: a known layout, non-empty folders, template paths as typed. */
export function normalizeProjectNoteSettings(s) {
  const layout = PROJECT_NOTE_LAYOUTS.includes(s?.layout) ? s.layout : 'note';
  return {
    layout,
    projectsFolder: trimFolder(s?.projectsFolder, 'Projects'),
    goalsFolder: trimFolder(s?.goalsFolder, 'Goals'),
    projectTemplate: String(s?.projectTemplate ?? '').trim(),
    goalTemplate: String(s?.goalTemplate ?? '').trim(),
  };
}

/**
 * A portable note name from a title: characters no platform can carry become
 * a hyphen, whitespace collapses, leading dots and trailing dots/spaces go,
 * a Windows-reserved stem gets a suffix, and nothing is ever empty.
 */
export function noteNameFromTitle(title) {
  let name = String(title ?? '').normalize('NFC')
    .replace(/[[\]#^|*"\\/:?<>]/g, '-')
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  if (!name) name = 'Untitled';
  if (validateVaultNameSegment(name)) name = `${name} note`; // the reserved-stem case
  return name;
}

/**
 * The path of a NEW note for a project or goal.
 * @param {{ kind: 'project'|'goal', title: string, layout?: string, projectsFolder?: string, goalsFolder?: string, goalFolder?: string|null }} a
 *   goalFolder: for a project with a goal under the nested layout, the goal's
 *   folder (its linked note's parent, or the folder the goal would get).
 */
export function projectNotePath({ kind, title, layout, projectsFolder, goalsFolder, goalFolder = null }) {
  const s = normalizeProjectNoteSettings({ layout, projectsFolder, goalsFolder });
  const name = noteNameFromTitle(title);
  const base = kind === 'goal' ? s.goalsFolder : s.projectsFolder;
  if (s.layout === 'note') return `${base}/${name}.md`;
  if (s.layout === 'nested' && kind === 'project' && goalFolder) return `${trimFolder(goalFolder, s.projectsFolder)}/${name}/${name}.md`;
  return `${base}/${name}/${name}.md`;
}

/** `path` untouched, or `… 2`, `… 3` while `exists(path)` says it is taken (a bounded search). */
export function uniqueNotePath(path, exists) {
  if (!exists(path)) return path;
  const m = /^(.*?)(\.md)$/.exec(path);
  const stem = m ? m[1] : path;
  const ext = m ? m[2] : '';
  for (let n = 2; n < 100; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!exists(candidate)) return candidate;
  }
  return `${stem} ${Date.now()}${ext}`;
}

/** True when a template makes an interactive Templater call (the §4.4 guard: never delegate those). */
export function templateNeedsUser(text) {
  return /\btp\.system\./.test(String(text ?? ''));
}

/**
 * The template subset dayGLANCE renders itself (§4.4 fallback): `{{title}}`,
 * `{{date}}` (YYYY-MM-DD) and `{{goal}}`. Everything else, Templater's
 * `<% %>` included, stays visible verbatim, which is Templater's own
 * on-create behavior and what lets a user notice and fix it.
 */
export function renderNoteTemplateSubset(text, { title = '', date = '', goal = '' } = {}) {
  return String(text ?? '')
    .replace(/\{\{\s*title\s*\}\}/gi, title)
    .replace(/\{\{\s*date\s*\}\}/gi, date)
    .replace(/\{\{\s*goal\s*\}\}/gi, goal);
}
