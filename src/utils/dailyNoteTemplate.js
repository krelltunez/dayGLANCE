export const ENGLISH_DAILY_NOTE_TEMPLATE = '## Quick Notes\n## Thoughts\n## Accomplished\n## Tasks\n';

export function buildLocalizedDailyNoteTemplate(translate) {
  return [
    translate('dailyNotes.quickNotes', { defaultValue: 'Quick Notes' }),
    translate('dailyNotes.thoughts', { defaultValue: 'Thoughts' }),
    translate('dailyNotes.accomplished', { defaultValue: 'Accomplished' }),
    translate('dailyNotes.tasks', { defaultValue: 'Tasks' }),
  ].map(heading => `## ${heading}`).join('\n') + '\n';
}

export function localizeDefaultDailyNoteTemplate(template, previousDefault, localizedDefault) {
  return template === ENGLISH_DAILY_NOTE_TEMPLATE || template === previousDefault
    ? localizedDefault
    : template;
}

export function localizeEmptyDailyNote(text, localizedDefault) {
  return text === ENGLISH_DAILY_NOTE_TEMPLATE ? localizedDefault : text;
}
