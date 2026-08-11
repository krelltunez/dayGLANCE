// Vault filename validation for the Obsidian integration, extracted as pure
// functions (trayFetchGate.js style) so the rules are unit-testable.
//
// WHY REFUSE, AND ON WHAT GROUNDS: dayGLANCE derives some vault filenames from
// user-typed text — [[wikilink]] targets in task titles become "<name>.md",
// and the dailyNotePattern / newNotesFolder settings flow into filenames and
// folder names. The refused set below is the UNION of what is unusable on ANY
// platform an Obsidian vault might sync to, so that a note dayGLANCE creates
// on one OS never breaks the same vault on another:
//
//   [ ] # ^ |    — forbidden by Obsidian itself on every platform (they
//                  collide with wikilink/tag/block-ID syntax; ^ is the
//                  block-ID sigil dayGLANCE plans to use as ^dg-<id>)
//   * " : ? < >  — filesystem-illegal on Windows (and Android forbids
//                  * ? " as well); PERFECTLY LEGAL on macOS/Linux, and
//                  Obsidian on those platforms will happily create such
//                  notes — we refuse them anyway purely for portability,
//                  NOT because Obsidian would
//   \ /          — path separators ('/' is a legal FOLDER separator in a
//                  wikilink like [[Folder/Name]]; callers split on it first
//                  and validate each segment, so a bare segment never
//                  legitimately contains either)
//   0x00-0x1F    — control characters, illegal on Windows, unusable anywhere
//   leading dot  — hidden file; Obsidian refuses on every platform
//   trailing dot/space — Windows strips these at the Win32 layer, silently
//                  creating a DIFFERENTLY-named file rather than erroring
//   CON PRN AUX NUL COM1-9 LPT1-9 — Windows reserved device names,
//                  case-insensitive, and reserved WITH an extension too
//                  ("CON.md" is still CON; the stem before the first dot is
//                  what Windows reserves)

const INVALID_CHAR_RE = /[[\]#^|*"\\/:?<>]/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f]/;
const RESERVED_STEM_RE = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * Validate ONE filename segment (a note name without folders, or one folder
 * name). Returns null when acceptable, or a human-readable reason naming the
 * offending character — callers prepend context ("edit the task title").
 */
export function validateVaultNameSegment(segment) {
  if (typeof segment !== 'string' || segment.length === 0) {
    return 'name is empty';
  }
  const control = segment.match(CONTROL_CHAR_RE);
  if (control) {
    return `name contains a control character (0x${control[0].charCodeAt(0).toString(16).padStart(2, '0')})`;
  }
  const bad = segment.match(INVALID_CHAR_RE);
  if (bad) {
    return `name contains "${bad[0]}" — not portable across the platforms an Obsidian vault can sync to`;
  }
  if (segment.startsWith('.')) {
    return 'name starts with "." (hidden file)';
  }
  if (segment.endsWith('.') || segment.endsWith(' ')) {
    return `name ends with a ${segment.endsWith('.') ? 'dot' : 'space'} — Windows silently strips it, creating a differently-named file`;
  }
  const stem = segment.split('.')[0];
  if (RESERVED_STEM_RE.test(stem)) {
    return `"${stem}" is a reserved device name on Windows (reserved even with an extension)`;
  }
  return null;
}

/**
 * Validate a wikilink target, which may contain '/' folder separators
 * ([[Folder/Name]]). Each segment is validated separately, preserving the
 * existing Folder/Name support. Returns null or a reason.
 */
export function validateWikiNoteName(name) {
  if (typeof name !== 'string' || name.split('/').filter(Boolean).length === 0) {
    return 'note name is empty';
  }
  for (const segment of name.split('/').filter(Boolean)) {
    const reason = validateVaultNameSegment(segment);
    if (reason) return reason;
  }
  return null;
}

/**
 * Validate the newNotesFolder setting: zero or more '/'-separated folder
 * segments. Empty means vault root and is valid.
 */
export function validateVaultFolderSetting(folder) {
  if (!folder) return null;
  for (const segment of String(folder).split('/').filter(Boolean)) {
    const reason = validateVaultNameSegment(segment);
    if (reason) return reason;
  }
  return null;
}

/**
 * Validate a dailyNotePattern by validating its RENDERED output, since the
 * pattern itself contains format tokens ("yyyy-MM-dd" is not a filename).
 * The rendered stem must also be a single segment: a '/' in the output would
 * silently nest daily notes into subfolders on one code path and throw on
 * another.
 *
 * @param pattern            the user-typed pattern
 * @param formatDatePattern  injected from obsidian.js (keeps this module pure)
 */
export function validateDailyNotePattern(pattern, formatDatePattern) {
  if (!pattern) return null; // empty falls back to the yyyy-MM-dd default
  let rendered;
  try {
    // A date with double-digit month and day, so padding differences can't
    // mask an illegal literal character in the pattern.
    rendered = String(formatDatePattern(new Date(2026, 11, 31), pattern));
  } catch {
    return 'pattern could not be rendered';
  }
  return validateVaultNameSegment(rendered);
}
