// Audit-side classification of EXISTING vault entry names against the same
// portability union the creation gate enforces (utils/obsidianFilename.js,
// PR #1357): [ ] # ^ | * " \ / : ? < >, control characters, leading dot,
// trailing dot or space (including before the extension), and Windows
// reserved device names (case-insensitive, with or without an extension).
//
// The creation gate stops dayGLANCE from bringing NEW unportable names into
// being; this module powers the read-only Settings -> Obsidian listing of
// names already present in the vault (issue #1358), including names
// dayGLANCE itself created before the validator existed. The listing is
// phrased as "may not sync to Windows or Android devices", never as an
// error: a macOS-only user has no actual problem, and the harm is
// conditional on multi-platform sync that dayGLANCE cannot detect. It is
// read-only by design: renaming a note breaks every other link to it across
// the vault, and updating backlinks is Obsidian's job, not ours.
//
// HIDDEN ENTRIES ARE DELIBERATELY EXCLUDED from the audit even though the
// union set refuses leading dots. Obsidian treats dot-entries (.obsidian,
// .trash, .DS_Store) as invisible and does not sync them, so they cannot
// break a sync that never carries them, and reporting .DS_Store on every
// macOS vault would bury the real findings in noise. The creation gate still
// refuses leading dots: a note dayGLANCE creates must be visible to
// Obsidian. (Hidden DIRECTORIES are additionally never traversed by the
// vault scan, unchanged behavior.)

import { validateVaultNameSegment } from './obsidianFilename.js';

export function isHiddenName(name) {
  return typeof name === 'string' && name.startsWith('.');
}

/**
 * Why one vault entry name is unportable, or null when it is fine (or hidden,
 * see the header). `kind` is 'file' or 'directory', matching the
 * FileSystemHandle kinds the vault scan iterates.
 *
 * Files get one check beyond the plain segment rules: a trailing dot or
 * space BEFORE the extension ("Meeting notes .md"). The creation gate never
 * sees that shape because it validates the stem before composing ".md" onto
 * it; here the on-disk name arrives already composed, so the stem is
 * re-derived from the LAST dot (multi-dot names like "Draft v1.2 .md" must
 * flag on the space before ".md", not resolve the stem at the first dot).
 */
export function unportableEntryReason(name, kind) {
  if (typeof name !== 'string' || name.length === 0) return null;
  if (isHiddenName(name)) return null;
  const plain = validateVaultNameSegment(name);
  if (plain) return plain;
  if (kind === 'directory') return null;
  const lastDot = name.lastIndexOf('.');
  if (lastDot > 0) {
    const stem = name.slice(0, lastDot);
    if (stem.endsWith('.') || stem.endsWith(' ')) {
      return `name has a ${stem.endsWith('.') ? 'dot' : 'space'} just before its extension, which Windows and sync tools can silently mishandle`;
    }
  }
  return null;
}

/**
 * Classify a flat list of vault-relative paths ("Folder/Note.md"), the shape
 * the native (Android/iOS) vault index returns. Folder segments are checked
 * as directories and the final segment as a file; a path under any hidden
 * segment is skipped entirely (Obsidian-invisible, see the header). Returns
 * [{ path, reason }] sorted by path, one entry per offending path, with the
 * FIRST offending segment's reason.
 */
export function classifyVaultPaths(paths) {
  const out = [];
  for (const p of paths ?? []) {
    if (typeof p !== 'string' || p.length === 0) continue;
    const segments = p.split('/').filter(Boolean);
    if (segments.length === 0 || segments.some(isHiddenName)) continue;
    let reason = null;
    for (let i = 0; i < segments.length - 1 && !reason; i++) {
      reason = unportableEntryReason(segments[i], 'directory');
    }
    if (!reason) reason = unportableEntryReason(segments[segments.length - 1], 'file');
    if (reason) out.push({ path: p, reason });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
