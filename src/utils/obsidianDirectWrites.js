// Direct-tier vault writes that SURFACE their failure (audit fix M3).
//
// App.jsx fires two direct writes outside the sync hook: the append that puts
// a new #obsidian task into today's daily note, and the daily-note write
// behind the note modal. The plugin-mode branch of each already reports a
// dropped emit through the sync error channel; the direct branches did not —
// an FSA/Electron failure landed in console.error only, and the native
// append's boolean was ignored outright. The task then kept
// importSource:'obsidian' plus a block id no vault line carried, forever,
// with no signal. Nothing re-emits an append, so this was a silent loss.
//
// These wrappers run the same writers and hand a user-facing message to
// `onFailure` when the write does not reach the vault. Writers are injected
// (defaulting to the real ones) so the failure paths are unit-testable
// without a vault handle.

import {
  appendTaskToDailyNote,
  appendTaskToDailyNoteNative,
  writeDailyNoteFile,
  writeDailyNoteNative,
} from '../obsidian.js';

export const directAppendFailureMessage = (title) =>
  `Task "${title}" was not written to your vault: the daily note write failed. The task is saved in dayGLANCE.`;

export const directDailyNoteFailureMessage = (dateStr) =>
  `Daily note ${dateStr} was not written to your vault: the vault write failed. It will be written the next time you edit it.`;

const REAL_WRITERS = { appendTaskToDailyNote, appendTaskToDailyNoteNative, writeDailyNoteFile, writeDailyNoteNative };

/**
 * Append a task line to today's daily note over the direct tier.
 * @param {object} args
 * @param {object|'native'} args.handle   the vault handle ('native' on Android/iOS)
 * @param {string} args.dailyNotesPath
 * @param {string} args.dateStr
 * @param {object} args.task
 * @param {string} args.heading
 * @param {string} args.template
 * @param {string} args.pattern
 * @param {(message: string) => void} args.onFailure
 * @param {object} [writers]  test seam
 * @returns {Promise<boolean>} whether the write reached the vault
 */
export async function appendTaskDirect({ handle, dailyNotesPath, dateStr, task, heading, template, pattern, onFailure }, writers = REAL_WRITERS) {
  const title = task?.title ?? '';
  if (handle === 'native') {
    let ok = false;
    try { ok = writers.appendTaskToDailyNoteNative(dateStr, task, heading, template) === true; } catch (err) {
      console.error('[Obsidian] Failed to write task to daily note:', err);
    }
    if (!ok) onFailure?.(directAppendFailureMessage(title));
    return ok;
  }
  try {
    await writers.appendTaskToDailyNote(handle, dailyNotesPath || '', dateStr, task, heading, template, pattern);
    return true;
  } catch (err) {
    console.error('[Obsidian] Failed to write task to daily note:', err);
    onFailure?.(directAppendFailureMessage(title));
    return false;
  }
}

/**
 * Write a daily note's text over the direct tier. The native write is
 * synchronous (the JavascriptInterface blocks the JS thread during the SAF
 * write), so it is deferred one macrotask — the note modal closes before the
 * I/O runs — exactly as before; the deferral now also checks the result.
 * @returns {Promise<boolean>} whether the write reached the vault
 */
export function writeDailyNoteDirect({ handle, dailyNotesPath, dateStr, text, pattern, onFailure }, writers = REAL_WRITERS) {
  const content = text || '';
  if (handle === 'native') {
    return new Promise((resolve) => {
      setTimeout(() => {
        let ok = false;
        try { ok = writers.writeDailyNoteNative(dateStr, content) === true; } catch (err) {
          console.error('Obsidian: failed to write daily note', err);
        }
        if (!ok) onFailure?.(directDailyNoteFailureMessage(dateStr));
        resolve(ok);
      }, 0);
    });
  }
  return writers.writeDailyNoteFile(handle, dailyNotesPath || '', dateStr, content, pattern)
    .then(() => true)
    .catch((err) => {
      console.error('Obsidian: failed to write daily note', err);
      onFailure?.(directDailyNoteFailureMessage(dateStr));
      return false;
    });
}
