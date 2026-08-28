// FRONTMATTER ON dayGLANCE-CREATED NOTES (Phase 4, step 1).
//
// dayGLANCE emits a minimal YAML frontmatter block on notes it CREATES — and
// only those — so they are queryable from Dataview and Bases:
//
//     ---
//     created: 2026-09-01
//     source: dayGLANCE
//     ---
//
// `source: dayGLANCE` is the query handle (`WHERE source = "dayGLANCE"`, or a
// Bases filter on the property); `created` is the creation date. Deliberately
// nothing else: frontmatter on a note the user will own and edit should be a
// courtesy, not a schema.
//
// THE OWNERSHIP RULE: never add frontmatter to a note dayGLANCE didn't
// create. A user's existing notes, their daily-note template's own
// frontmatter, and anything already carrying a `---` block are left entirely
// alone — no merging, no appended fields, no reformatting. Emission happens
// exclusively at the CREATION branches (writeWikiNote's create path; the
// desktop daily-note instantiation from a template), guarded by
// hasFrontmatter so a template that already opens with `---` keeps its own.
//
// THE SAFETY RULE (tested, not observed): the emitted block must never
// contain a task-shaped line. The task parser has no `---` awareness — on
// every client version, old and current, a literal `- [ ]` line inside YAML
// would parse as a task. Today's fixed field set can't produce one, but that
// is a property of these fields, not a guarantee: the test suite runs the
// emitted block through the real parser and asserts zero tasks, so a future
// field addition that breaks the property fails loudly.
//
// Read support is deliberately absent: dayGLANCE has no note-querying
// features, so "read support" means not corrupting frontmatter — which the
// parser (skips non-task lines), the section sort (bounded to the task
// heading's section), and the daily-note editor (opaque wholesale text
// round-trip) already guarantee, and which the tests now pin.

/** True when the text already opens with a frontmatter fence. */
export function hasFrontmatter(text) {
  return typeof text === 'string' && text.startsWith('---\n');
}

/**
 * The frontmatter block for a note dayGLANCE creates today (or on the given
 * ISO date). Trailing newline included — callers prepend it verbatim.
 */
export function dgFrontmatter(dateIso = new Date().toISOString().slice(0, 10)) {
  return `---\ncreated: ${dateIso}\nsource: dayGLANCE\n---\n`;
}

/**
 * Prepend dayGLANCE's frontmatter to content being written into a NOTE BEING
 * CREATED — the only call sites are creation branches. Content that already
 * opens with a frontmatter fence (a user template with its own frontmatter, a
 * note body authored starting with `---`) is returned untouched: theirs wins.
 */
export function withCreationFrontmatter(content, dateIso) {
  const body = typeof content === 'string' ? content : '';
  return hasFrontmatter(body) ? body : `${dgFrontmatter(dateIso)}${body}`;
}
