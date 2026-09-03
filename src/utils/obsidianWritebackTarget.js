// Where a task's vault line lives, for the writeback (companion spec §6,
// build step 1: the locator). Pure.
//
// A DAILY-NOTE task is located by date: the file is the daily note for
// `obsidianFileDate` (or the date baked into a legacy id, or the task's own
// date), named through the configured pattern under the daily-notes folder;
// its lines are sorted under the configured task heading; and its note key
// (the minting namespace, ruling A) is the date.
//
// A NON-DAILY task is located by path: `obsidianNotePath` (already
// normalized by the parser), no section sort (a project note is the user's
// document, not a dayGLANCE-owned section), and the note key is the path.
// Such tasks exist only on the plugin path (ruling F), so their writes are
// intents; the direct writers never see them.

import { dailyNoteFilename } from '@glance-apps/obsidian-format';

/**
 * @returns {{ isNoteTask: boolean, path: string, date: string|null, noteKey: string, taskHeading: string|null } | null}
 *   null when the task names no note at all (nothing to write to).
 */
export function writebackTargetFor(task, obsidianConfig) {
  if (!task) return null;
  const notePath = typeof task.obsidianNotePath === 'string' && task.obsidianNotePath ? task.obsidianNotePath : null;
  if (notePath) {
    return {
      isNoteTask: true,
      path: notePath,
      date: task.date || null,
      noteKey: notePath,
      taskHeading: null,
    };
  }
  const sourceDate = task.obsidianFileDate
    || String(task.id ?? '').match(/^obsidian-(\d{4}-\d{2}-\d{2})/)?.[1]
    || task.date
    || null;
  if (!sourceDate) return null;
  const folder = obsidianConfig?.dailyNotesPath ? `${obsidianConfig.dailyNotesPath.replace(/\/+$/, '')}/` : '';
  return {
    isNoteTask: false,
    path: folder + dailyNoteFilename(sourceDate, obsidianConfig?.dailyNotePattern || 'yyyy-MM-dd'),
    date: sourceDate,
    noteKey: sourceDate,
    taskHeading: obsidianConfig?.taskHeading || '## Tasks',
  };
}
