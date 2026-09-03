// Vault task scope (companion spec §6, rulings D and E). Pure.
//
// Which non-daily notes dayGLANCE treats as task sources is OPT-IN: the
// user picks folders and/or tags in the plugin, on equal footing ("two
// separate ways to organize a vault and neither is right or wrong"). A note
// is in scope when it sits under an included folder OR carries an included
// tag. Daily notes are always in scope and are classified elsewhere; this
// module never sees them.
//
// The classifier lives in the shared package so the plugin (which decides
// what to stamp and report) and dayGLANCE (which reads the scope from the
// pairing-meta row) can never disagree about a path.

export const SCOPE_WINDOW_MIN_DAYS = 7;
export const SCOPE_WINDOW_MAX_DAYS = 90;
export const SCOPE_WINDOW_DEFAULT_DAYS = 30;

const trimSlashes = (s) => String(s ?? '').normalize('NFC').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
const normTag = (t) => String(t ?? '').normalize('NFC').trim().replace(/^#+/, '').replace(/^\/+|\/+$/g, '').toLowerCase();

/**
 * Canonical scope: trimmed folders (no leading/trailing slash), lowercased
 * tags without `#`, window clamped to [7, 90] (ruling E). Empty entries drop.
 */
export function normalizeScope(scope) {
  const folders = [...new Set((scope?.folders || []).map(trimSlashes).filter(Boolean))];
  const tags = [...new Set((scope?.tags || []).map(normTag).filter(Boolean))];
  const raw = Number(scope?.completionWindowDays);
  const completionWindowDays = Number.isFinite(raw)
    ? Math.min(SCOPE_WINDOW_MAX_DAYS, Math.max(SCOPE_WINDOW_MIN_DAYS, Math.round(raw)))
    : SCOPE_WINDOW_DEFAULT_DAYS;
  return { folders, tags, completionWindowDays };
}

/** True when the scope names at least one folder or tag. */
export function scopeIsActive(scope) {
  const s = normalizeScope(scope);
  return s.folders.length > 0 || s.tags.length > 0;
}

/**
 * Is a non-daily note in scope? `tags` are the note's tags (frontmatter and
 * inline, with or without `#`); a tag matches when it equals an included tag
 * or is nested under it (`project/house` is under `project`).
 */
export function noteInScope(path, tags, scope) {
  const s = normalizeScope(scope);
  const p = trimSlashes(path);
  if (!p.endsWith('.md') || p.startsWith('.')) return false;
  if (s.folders.some((f) => p.startsWith(`${f}/`))) return true;
  if (!s.tags.length) return false;
  const noteTags = (tags || []).map(normTag).filter(Boolean);
  return noteTags.some((t) => s.tags.some((inc) => t === inc || t.startsWith(`${inc}/`)));
}

/**
 * The earliest completion date (YYYY-MM-DD) a non-daily note's completed
 * lines must carry to be tracked: `today - window`. Older completed lines,
 * and completed lines with no completion date at all, are neither stamped
 * nor imported (ruling E).
 */
export function completedSinceFor(scope, today) {
  const { completionWindowDays } = normalizeScope(scope);
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - completionWindowDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
