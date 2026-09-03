// The dayGLANCE-maintained frontmatter block on a linked project or goal
// note (companion spec §4.3, rulings B and C). Pure.
//
// Ruling B: every maintained key lives under ONE map key, `dayglance:`.
// dayGLANCE wins inside it; nothing outside it is ever read or written. The
// block is a rendered view, not an input.
// Ruling C: the PLUGIN renders it from its mirror on its tick and writes only
// when the rendered block differs. `updated` is the time of the last CHANGE,
// carried forward when nothing else changed, so an unchanged block is
// byte-identical and costs no write.

import { projectProgressPercent, calculateGoalProgress } from './progress.js';

export const NOTE_BLOCK_KEY = 'dayglance';

/** `[[path|title]]` for a note path (the .md dropped); the title alone when unlinked. */
export function noteWikilink(path, title) {
  const p = String(path ?? '').replace(/\.md$/i, '');
  const t = String(title ?? '').trim();
  if (!p) return t;
  const base = p.split('/').pop();
  return base === t || !t ? `[[${p}]]` : `[[${p}|${t}]]`;
}

const activeTasksOf = (id, tasks) => (tasks || []).filter((t) => t && t.projectId === id && !t.archived);

/**
 * The block for a project note.
 * @param {object} project
 * @param {{ tasks: object[], today: string }} ctx  tasks: scheduled AND inbox, every user
 */
export function projectNoteBlock(project, { tasks, today }) {
  const mine = activeTasksOf(project.id, tasks);
  const done = mine.filter((t) => t.completed).length;
  const upcoming = mine
    .filter((t) => !t.completed && typeof t.date === 'string' && (!today || t.date >= today))
    .map((t) => t.date)
    .sort();
  return {
    kind: 'project',
    status: project.status || 'active',
    open: mine.length - done,
    done,
    total: mine.length,
    percent: projectProgressPercent(project.id, tasks || []),
    next: upcoming[0] ?? null,
  };
}

/**
 * The block for a goal note: progress plus its projects as wikilinks (linked
 * ones) or bare titles.
 * @param {object} goal
 * @param {{ projects: object[], tasks: object[], notePathOf?: (id: string) => string|null }} ctx
 */
export function goalNoteBlock(goal, { projects, tasks, notePathOf = null }) {
  const children = (projects || []).filter((p) => p && p.goalId === goal.id && p.status !== 'archived');
  const childIds = new Set(children.map((p) => p.id));
  const mine = (tasks || []).filter((t) => t && childIds.has(t.projectId) && !t.archived);
  const done = mine.filter((t) => t.completed).length;
  const percent = children.length ? Math.round(calculateGoalProgress(goal.id, projects || [], tasks || []) * 100) : null;
  return {
    kind: 'goal',
    status: goal.status || 'active',
    projects: children
      .slice()
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.title).localeCompare(String(b.title)))
      .map((p) => noteWikilink(notePathOf?.(p.id) ?? '', p.title)),
    open: mine.length - done,
    done,
    total: mine.length,
    percent,
  };
}

const stripUpdated = (b) => {
  if (!b || typeof b !== 'object') return null;
  const { updated: _u, ...rest } = b;
  return rest;
};

/** True when anything but `updated` differs (key order does not matter). */
export function noteBlockChanged(prev, next) {
  const canon = (o) => JSON.stringify(o, Object.keys(o || {}).sort());
  return canon(stripUpdated(prev)) !== canon(stripUpdated(next));
}

/** `next` with `updated` carried forward from `prev` when nothing changed, else set to `nowIso`. */
export function withUpdatedStamp(prev, next, nowIso) {
  if (!noteBlockChanged(prev, next) && typeof prev?.updated === 'string') return { ...next, updated: prev.updated };
  return { ...next, updated: nowIso };
}
