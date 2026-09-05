// Pure line rules for the editor hiding extension (editorHiding.ts). No
// Obsidian or CodeMirror imports, so the harness can pin them directly.
//
// Both rules are DISPLAY ONLY: they classify text; nothing here writes.

/** A well-formed dayGLANCE block id token: `^dg-` plus eight base-36 chars. */
export const DG_BLOCK_ID_TOKEN_RE = /\^dg-[a-z0-9]{8}$/g;

/**
 * The span of a dayGLANCE block id at the END of a line, as [from, to)
 * offsets into `line`, or null. Only a token in block-id position counts —
 * preceded by whitespace (or the whole line) and ending the line. A token
 * anywhere else is a damaged line (the stamper refuses those, §3.10) and
 * stays visible: hiding the evidence of corruption is the one thing this
 * rule must never do.
 */
export function ownBlockIdSpan(line: string): { from: number; to: number } | null {
  const m = /(^|\s)(\^dg-[a-z0-9]{8})$/.exec(line);
  if (!m) return null;
  const from = m.index + m[1].length;
  return { from, to: from + m[2].length };
}

/**
 * A checked task line in the plugin's own grammar (taskLines.js): a dash
 * checkbox with `x` or `X`. Other checkbox states are not dayGLANCE
 * completions and are left alone.
 */
export function isCompletedTaskLine(line: string): boolean {
  return /^\s*- \[[xX]\]\s/.test(line);
}

/** Reading view exposes the checkbox char as `data-task`; same rule. */
export function isCompletedTaskMarker(task: string | undefined | null): boolean {
  return task === 'x' || task === 'X';
}

export interface EditorHidingSettings {
  hideBlockIds: boolean;
  hideCompletedInLinkedNotes: boolean;
}

export const EDITOR_HIDING_DEFAULTS: EditorHidingSettings = {
  // Only ever hides dayGLANCE's own tokens, so on by default.
  hideBlockIds: true,
  // Off by default: without Dataview a linked note has no Done list, so a
  // hidden line would be gone from view everywhere except dayGLANCE.
  hideCompletedInLinkedNotes: false,
};

export function normalizeEditorHidingSettings(s: Partial<EditorHidingSettings> | undefined | null): EditorHidingSettings {
  return {
    hideBlockIds: typeof s?.hideBlockIds === 'boolean' ? s.hideBlockIds : EDITOR_HIDING_DEFAULTS.hideBlockIds,
    hideCompletedInLinkedNotes: typeof s?.hideCompletedInLinkedNotes === 'boolean'
      ? s.hideCompletedInLinkedNotes
      : EDITOR_HIDING_DEFAULTS.hideCompletedInLinkedNotes,
  };
}
