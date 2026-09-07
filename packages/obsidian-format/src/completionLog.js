// COMPLETION LOG entry formatting (companion spec 4.1, Phase 8).
//
// Every task completion in dayGLANCE gets one line appended to the daily
// note for the completion date, under a configurable heading. The entry is
// permanent, append-only history: it is never rewritten and never removed,
// including on uncomplete (ruled: the completion happened; a historical
// record that gets rewritten is not a historical record).
//
// THE RULED LINE SHAPE — the scan-collision constraint. The entry is a
// NON-TASK line: `- ✅ …`, never `- [x] …`. Both the task parser
// (parseTasksFromMarkdown) and the stamp-on-sight planner
// (planStampInsertions) are heading-blind and match every checkbox line in
// a daily note, so a checkbox-shaped log entry would be stamped on sight
// (minting identity) and re-imported as a duplicate completed task. The
// `- ✅ ` prefix cannot match their `- [([ xX])]` shape, making the log
// safe BY CONSTRUCTION rather than by exclusion rules. What is lost:
// checkbox rendering and Dataview TASK-typed queries; the inline fields on
// the list item stay fully queryable (LIST/TABLE).
//
// DETERMINISM: the entry is formatted ONCE, by the device that observes the
// completion transition, and carried whole in the completion_log_append
// intent; the applier and the direct routes dedupe by exact line. Engine
// echoes of the completed task on other devices are suppressed at the
// detector (the remote-apply guard), so cross-device duplicate entries
// require the same transition to be independently observed — which the
// deterministic field rules below make byte-identical anyway whenever
// completedAt is present.

/** The default log heading; the stored setting overrides it. */
export const DEFAULT_COMPLETION_LOG_HEADING = '## Completed';

// Mirrors extractTags in src/utils/taskUtils.js (the app-side source of
// truth for what counts as an inline tag): letters/digits/_/-// after a
// leading letter. Kept in sync BY HAND — the package cannot import from the
// app. Case is preserved here (display), where the app util lowercases
// (filter keys).
const TAG_RE = /#(\p{L}[\p{L}\p{N}_/-]*)/gu;

/**
 * Format one completion-log line.
 *
 * @param {object} f
 * @param {string} f.title        task title, possibly carrying inline #tags
 * @param {string|null} f.completedAt  the stored completion timestamp:
 *   local-offset ISO (completionTimestamp()), UTC ISO (intent/bucket
 *   paths), a bare YYYY-MM-DD, or absent. Written into [completion:: …]
 *   verbatim when present; the caller passes its date-bucket fallback via
 *   `fallbackDate` for the absent case so the line stays deterministic
 *   across devices.
 * @param {string} f.fallbackDate YYYY-MM-DD used when completedAt is absent
 * @param {string} [f.projectName]
 * @param {number} [f.priority]   1-3 rendered; 0/absent omitted (ruled)
 * @param {string} [f.deadline]   YYYY-MM-DD → [due:: …]
 * @param {boolean} [f.recurring] true only for recurrence-template instances
 * @returns {string} single line, `- ✅ …`, never task-shaped
 */
export function formatCompletionLogEntry({ title, completedAt, fallbackDate, projectName, priority, deadline, recurring }) {
  const rawTitle = String(title ?? '').replace(/\s*\n+\s*/g, ' ').trim();
  // Strip inline tags from the label; re-render them after the fields so
  // the label reads cleanly and the tags stay standard Obsidian tags.
  const tags = rawTitle.match(TAG_RE) || [];
  let label = rawTitle.replace(TAG_RE, '').replace(/\s{2,}/g, ' ').trim();
  if (!label) label = rawTitle; // a tags-only title keeps its tags as the label

  // Display time: the wall-clock HH:mm of the completion. An offset-bearing
  // or offsetless ISO string carries its own wall clock (slice it — never
  // reinterpret through Date, which would shift it in other timezones); a
  // Z-suffixed instant is converted to THIS device's wall clock, which is
  // the completing device's by construction (only the observer formats).
  let time = null;
  const completion = completedAt || fallbackDate || null;
  if (typeof completedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(completedAt)) {
    if (/[zZ]$/.test(completedAt)) {
      const d = new Date(completedAt);
      if (!Number.isNaN(d.getTime())) {
        time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    } else {
      time = completedAt.slice(11, 16);
    }
  }

  const parts = [`- ✅${time ? ` ${time}` : ''} ${label}`];
  if (completion) parts.push(`[completion:: ${completion}]`);
  if (projectName && String(projectName).trim()) parts.push(`[project:: ${String(projectName).replace(/\s*\n+\s*/g, ' ').trim()}]`);
  if (Number.isInteger(priority) && priority >= 1 && priority <= 3) parts.push(`[priority:: ${priority}]`);
  if (deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) parts.push(`[due:: ${deadline}]`);
  if (recurring === true) parts.push('[recurring:: true]');
  if (tags.length) parts.push(tags.join(' '));
  return parts.join(' ');
}

/**
 * The daily-note date bucket the entry belongs to: the completion
 * timestamp's own date part when it has one, else the caller's local today.
 * completedAt strings from completionTimestamp() are local-offset ISO, so
 * slice(0,10) IS the user's local completion date (the Phase 4 rationale).
 */
export function completionLogDate(completedAt, localToday) {
  if (typeof completedAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(completedAt)) {
    return completedAt.slice(0, 10);
  }
  return localToday;
}
