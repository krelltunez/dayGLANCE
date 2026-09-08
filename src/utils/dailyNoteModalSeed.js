// What the daily-note modal shows on open, and whether closing it should
// write anything back. Pure so the rules are tested where they live.
//
// Field incident, 2026-09-08 (buildout spec 2.7): a tablet with no vault
// and no copy of today's note yet opened the modal, was seeded with the
// template, and saved that template on close as the note's record, stamped
// with the moment of closing. That stamp outranked the real note on every
// other device, and the app's own copy of a note it never held became the
// fleet's newest word on it. Two rules follow.
//
// 1. Seeding order: the vault's text, then the app's own copy, then the
//    template. An empty or absent vault read is not evidence of absence
//    when the app holds content for the date (the completion log has
//    followed this since the 2026-09-07 empty-note incident; the modal did
//    not).
// 2. Closing persists only a change. An untouched seed, template or
//    otherwise, is not the user's word and is never written back; neither is
//    an empty note for a date that had no content to begin with.

const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * @param {{ fresh?: string|null, known?: string|null, template?: string|null }} src
 *   fresh: the vault read ('' or null when absent or unreadable);
 *   known: the app's own copy for the date; template: the rendered template.
 * @returns {{ text: string, fromTemplate: boolean, hadContent: boolean }}
 */
export function seedDailyNoteText({ fresh = null, known = null, template = null } = {}) {
  if (hasText(fresh)) return { text: fresh, fromTemplate: false, hadContent: true };
  if (hasText(known)) return { text: known, fromTemplate: false, hadContent: true };
  return { text: template || '', fromTemplate: !!template, hadContent: false };
}

/**
 * Whether a save path (blur, shortcut, close, unmount) should write `text`.
 * `baseline` is what the modal last loaded or saved; `hadContent` is whether
 * the date had real content when the modal opened.
 */
export function shouldPersistDailyNote(text, baseline, hadContent) {
  const next = typeof text === 'string' ? text : '';
  if (next === (typeof baseline === 'string' ? baseline : '')) return false;
  if (!hasText(next) && !hadContent) return false;
  return true;
}
