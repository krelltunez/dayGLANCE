// Completion markers — moved verbatim from dayGLANCE src/obsidian.js.
// Format, never policy: the app-wins merge rule for completedAt lives in
// dayGLANCE, not here.

import { hasForeignBlockId } from './identity.js';

// ---------------------------------------------------------------------------
// Completion markers (docs/obsidian-buildout-spec.md — completion timestamps)
//
// When dayGLANCE completes a task it writes the completion date to the vault
// line, in whichever of two formats fits the vault: the Tasks plugin's
// `✅ YYYY-MM-DD` when that plugin is enabled (vault-level detection via
// .obsidian/community-plugins.json), else a Dataview inline field
// `[completed:: <ISO date or datetime>]`. The marker is a REGENERATED SUFFIX —
// like the ^dg- token, it is never part of the stored title on either side —
// which is what makes re-completion replace rather than append, and
// uncompletion remove, with no dedicated machinery.
//
// IDENTITY SCOPING (the slice of the identity-freeze design this feature
// needs): the marker is split off at parse time on ^dg--TAGGED LINES ONLY.
// An untagged line stays byte-frozen exactly as today — a hand-written
// `✅ 2026-08-10` there remains part of the title. Every line dayGLANCE
// writes a marker to is tagged (writes stamp), so the strip covers exactly
// the lines that need it. BOTH formats are always recognised at parse,
// regardless of current plugin detection — otherwise toggling the Tasks
// plugin would turn previously-written markers into title text and
// manufacture title divergence.
// ---------------------------------------------------------------------------

const TASKS_DONE_MARKER_RE = /\s+✅\s*(\d{4}-\d{2}-\d{2})\s*$/u;
const DATAVIEW_COMPLETED_RE = /\s+\[completed::\s*([^\]]*?)\s*\]\s*$/;

/**
 * Split a trailing completion marker (either format) off a task-line body
 * that has already had its ^dg- token removed.
 * @returns {{ text: string, completedAt: string|null }} completedAt is the
 *   marker's value when it is ISO-shaped (starts YYYY-MM-DD), else null even
 *   when a marker was stripped.
 */
export function splitCompletionMarker(text) {
  let m = TASKS_DONE_MARKER_RE.exec(text);
  if (m) return { text: text.slice(0, m.index), completedAt: m[1] };
  m = DATAVIEW_COMPLETED_RE.exec(text);
  if (m) {
    return {
      text: text.slice(0, m.index),
      completedAt: /^\d{4}-\d{2}-\d{2}/.test(m[1]) ? m[1] : null,
    };
  }
  return { text, completedAt: null };
}

/**
 * The completion-marker suffix for a written line, or ''.
 *
 * Emission is DETERMINISTIC from the stored completedAt string — the ✅ date
 * is completedAt.slice(0, 10) and the Dataview value is the stored string
 * verbatim — never recomputed from "now" or a local timezone at write time,
 * so every device regenerating the same state emits identical bytes (the
 * no-op write skip depends on this). A date-only historical completedAt
 * emits as a date rather than fabricating a midnight time.
 *
 * `format` null means no marker is written (setting off, or a caller that
 * predates the feature): combined with the unconditional strip in the
 * rewrite paths, turning the setting OFF converges lines clean on their
 * next touch — never via a sweep.
 *
 * Like blockIdSuffix: never append after a user-authored trailing block
 * reference — an Obsidian block id must be the last thing on its line.
 */
export function completionMarkerSuffix(completed, completedAt, format, writtenTitle) {
  if (!completed || !completedAt || !format) return '';
  if (hasForeignBlockId(writtenTitle)) return '';
  if (format === 'tasks') return ` ✅ ${String(completedAt).slice(0, 10)}`;
  return ` [completed:: ${completedAt}]`;
}
