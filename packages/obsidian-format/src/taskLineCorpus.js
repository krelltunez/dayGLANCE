// THE MARKER CORPUS — one line per shape the task-line grammar recognises.
//
// This is the fixture the line-owned-fields contract runs over
// (taskLines.contract.test.js here; dayGLANCE's obsidian.lineOwnedFields
// test on the app side). The contract asserts that the keys the parser emits
// over THESE lines equal LINE_OWNED_TASK_FIELDS exactly — so the corpus is
// the mechanism's own dependency: a marker the grammar learns must gain a
// line here, or the contract cannot see the key it emits and fails on the
// list side instead (a listed key no line produces). Either way a new
// marker cannot ship without this file learning it, which is the point.
//
// Each entry: the line as it sits in a note, the note it sits in (a daily
// note by default; `notePath` for a scoped note), and the shape it pins.
export const DAILY_NOTE_DATE = '2026-09-06';

export const TASK_LINE_CORPUS = Object.freeze([
  { pins: 'plain inbox line (legacy content-derived id)', line: '- [ ] Call the plumber' },
  { pins: 'stamped inbox line (block id + legacy hint)', line: '- [ ] Call the plumber ^dg-8w230vhc' },
  { pins: 'timed line', line: '- [ ] 14:00 Call the plumber ^dg-8w230vhc' },
  { pins: 'timed line with a duration range', line: '- [ ] 14:00-15:30 Call the plumber ^dg-8w230vhc' },
  { pins: 'inline date prefix', line: '- [ ] 2026-09-08 14:00 Call the plumber ^dg-8w230vhc' },
  { pins: 'all-day via scheduled metadata (⏳)', line: '- [ ] Call the plumber ⏳ 2026-09-08 ^dg-8w230vhc' },
  { pins: 'all-day via Dataview scheduled field', line: '- [ ] Call the plumber [scheduled:: 2026-09-08] ^dg-8w230vhc' },
  { pins: 'checked with a completion marker (✅)', line: '- [x] 14:00 Call the plumber ✅ 2026-09-06 ^dg-8w230vhc' },
  { pins: 'due metadata (📅 → deadline)', line: '- [ ] Call the plumber 📅 2026-09-10 ^dg-8w230vhc' },
  { pins: 'priority emoji (⏫)', line: '- [ ] Call the plumber ⏫ ^dg-8w230vhc' },
  { pins: 'Dataview priority field', line: '- [ ] Call the plumber [priority:: high] ^dg-8w230vhc' },
  { pins: 'recurrence flag (🔁, recognised never mapped)', line: '- [ ] Call the plumber 🔁 every week ^dg-8w230vhc' },
  { pins: 'project field ([project:: …])', line: '- [ ] Call the plumber [project:: Home] ^dg-8w230vhc' },
  { pins: 'notes and subtasks beneath the line', line: '- [ ] Call the plumber ^dg-8w230vhc\n  some indented note\n  - [ ] sub one' },
  { pins: 'scoped (non-daily) note: path key, no file date', line: '- [ ] Call the plumber ^dg-8w230vhc', notePath: 'Projects/House.md' },
  { pins: 'scoped note, checked inside the completion window', line: '- [x] Call the plumber ✅ 2026-09-05 ^dg-8w230vhc', notePath: 'Projects/House.md', completedSince: '2026-08-01' },
]);

/** Parse one corpus entry the way the app does. */
export function parseCorpusEntry(parseTasksFromMarkdown, entry) {
  const opts = {};
  if (entry.notePath) opts.notePath = entry.notePath;
  if (entry.completedSince) opts.completedSince = entry.completedSince;
  const parsed = parseTasksFromMarkdown(`# Tasks\n${entry.line}\n`, DAILY_NOTE_DATE, new Set(), opts);
  return [...parsed.scheduledTasks, ...parsed.inboxTasks];
}
