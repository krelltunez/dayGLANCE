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

// ── Default note bodies (companion §4.3, templates ruling of 2026-09-04) ────
//
// Used when no template note is configured. Two variants, chosen ONCE at
// creation by whether Dataview is installed: with it, the live sections are
// queries over what dayGLANCE already writes (the completion log's
// `[project:: [[…]]]` links and the maintained `dayglance.goal` map); without
// it, one plain sentence stands where each query would be, so the note reads
// as finished either way. Nothing here is ever maintained afterwards.

const fence = (query) => '```dataview\n' + query.trim() + '\n```';
const fromDaily = (dailyFolder) => (dailyFolder ? `FROM "${String(dailyFolder).replace(/\/+$/, '')}"\n` : '');

/** Completions logged for this project, newest first (needs the completion-log wikilink). */
export const projectCompletionsQuery = (dailyFolder = '') =>
  `TABLE WITHOUT ID dateformat(item.completion, "yyyy-MM-dd HH:mm") AS "When", regexreplace(item.text, "\\\\s*\\\\[\\\\w+::(?:[^\\\\[\\\\]]|\\\\[\\\\[[^\\\\]]*\\\\]\\\\])*\\\\]", "") AS "Done"\n`
  + fromDaily(dailyFolder)
  + 'FLATTEN file.lists AS item\nWHERE item.project = this.file.link\nSORT item.completion DESC';

/** A goal's projects with status and live open counts from each project note's own tasks. */
export const goalProjectsQuery = () =>
  'TABLE WITHOUT ID file.link AS Project, dayglance.status AS Status, length(filter(file.tasks, (t) => !t.completed)) AS Open\n'
  + 'WHERE dayglance.goal = this.file.link\nSORT dayglance.status, file.name';

/** Completions across a goal's projects, by month. */
export const goalProgressQuery = (dailyFolder = '') =>
  'TABLE WITHOUT ID key AS Month, length(rows) AS Completed\n'
  + fromDaily(dailyFolder)
  + 'FLATTEN file.lists AS item\nWHERE item.project AND item.project.dayglance.goal = this.file.link\n'
  + 'GROUP BY dateformat(item.completion, "yyyy-MM")\nSORT key DESC';

/**
 * The default body of a new PROJECT note (no frontmatter; the caller adds
 * dayGLANCE's creation frontmatter and the plugin the id key and the map).
 */
export function defaultProjectNote({ title, date, hasDataview = false, dailyFolder = '' }) {
  const done = hasDataview
    ? fence(projectCompletionsQuery(dailyFolder))
    : 'With the Dataview plugin installed, this section lists every completion logged for this project in the daily notes, newest first.';
  return [
    `# ${title}`,
    'One line on what done looks like.',
    '',
    '## Tasks',
    '- [ ] ',
    '',
    '## Done',
    done,
    '',
    '## Notes',
    '',
    '## Decisions',
    '',
    '## Log',
    `- ${date} Created`,
    '',
  ].join('\n');
}

/** The default body of a new GOAL note. */
export function defaultGoalNote({ title, date, hasDataview = false, dailyFolder = '' }) {
  const projects = hasDataview
    ? fence(goalProjectsQuery())
    : 'With the Dataview plugin installed, this section lists the projects under this goal with their status and open task counts.';
  const progress = hasDataview
    ? fence(goalProgressQuery(dailyFolder))
    : 'With the Dataview plugin installed, this section shows completions across this goal\'s projects by month.';
  return [
    `# ${title}`,
    'Why this matters, and what finished looks like.',
    '',
    '## Projects',
    projects,
    '',
    '## Progress',
    progress,
    '',
    '## Notes',
    '',
    '## Log',
    `- ${date} Created`,
    '',
  ].join('\n');
}
