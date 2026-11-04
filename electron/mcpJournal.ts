// dayGLANCE's half of the §4.3 write journal, and the §6.5 tray indicator, as
// pure functions (startupQuit.ts style). The journal itself (append, display
// snapshot, per-entity groups, undo plan) is generic and lives in
// @glance-apps/mcp-host; what is dayGLANCE's is the undo op vocabulary, how
// each op groups, and the group label. The journal is SESSION-SCOPED BY
// DESIGN: it lives in a module-scope array in main.ts (never on the McpServer
// instance, §3.7, and never on disk) — it covers the runaway-agent case, not
// audit history, so a restart wiping it is correct behavior, not a limitation.
//
// Undo works from per-entry before-state captured by the renderer at write
// time, because the journal alone cannot reverse everything: scheduling a
// task DESTROYS its inbox-only fields (applyScheduleTask strips priority and
// deadline), and move/resize/completion overwrite values nothing else
// remembers. Each entry therefore carries exactly the fields its reversal
// needs — a full before-task for schedule, touched fields otherwise.

import {
  journalGroups as hostJournalGroups,
  journalSnapshot as hostJournalSnapshot,
  defaultGroupLabel,
  summaryTitle,
  type JournalEntry as HostJournalEntry,
  type JournalRecord as HostJournalRecord,
  type JournalGroup,
  type JournalGrouping,
  type JournalSnapshot,
} from '@glance-apps/mcp-host';

/** Reversal instruction, applied by taskMutations.js applyUndoOps in the renderer. */
export type UndoOp =
  | { kind: 'remove_created'; taskId: string }
  | { kind: 'restore_unscheduled'; taskId: string; beforeTask: Record<string, unknown> }
  | { kind: 'restore_block_fields'; blockId: string; before: Record<string, unknown> }
  | { kind: 'restore_completion'; taskId: string; before: { completed: boolean; completedAt?: string | null } }
  | { kind: 'restore_recurring_completion'; templateId: string | number; dateStr: string; wasCompleted: boolean }
  // A repeating series (#2066): created, or edited for one occurrence or all.
  // The edit's undo carries the template fields and the exception dates it
  // changed; completions are never part of it.
  | { kind: 'remove_created_series'; templateId: string | number }
  | {
      kind: 'restore_series_fields';
      templateId: string | number;
      before: Record<string, unknown>;
      absentBefore?: string[];
      exceptionsBefore?: Record<string, unknown>;
    }
  /**
   * Reverses an update_task edit, inbox or scheduled. `before` holds the
   * prior values of the touched fields; `absentBefore` names touched fields
   * that did not exist pre-edit, so undo deletes them (a spread cannot
   * un-set a deadline the edit added).
   */
  | { kind: 'restore_task_fields'; taskId: string; before: Record<string, unknown>; absentBefore?: string[] }
  /** Subtask writes (2026-10-04) touch their host task only, so they group with it. */
  | { kind: 'remove_created_subtask'; taskId: string; subtaskId: string }
  | { kind: 'restore_subtask_fields'; taskId: string; subtaskId: string; before: Record<string, unknown> }
  /** Goal and project writes (2026-10-04): each op touches exactly one goal or one project. */
  | { kind: 'remove_created_goal'; goalId: string }
  | { kind: 'restore_goal_fields'; goalId: string; before: Record<string, unknown>; absentBefore?: string[] }
  | { kind: 'remove_created_project'; projectId: string }
  | { kind: 'restore_project_fields'; projectId: string; before: Record<string, unknown>; absentBefore?: string[] }
  /**
   * A description written into a linked Obsidian note (2026-10-04): the
   * previous section goes back through the same refuse-on-change save, under
   * the hash of what was written; `fields` carries the record half of the
   * same call, when it had one.
   */
  | { kind: 'restore_note_description'; entityKind: 'goal' | 'project'; entityId: string; path: string; before: string; afterBase?: string; fields?: UndoOp };

/**
 * A journal entry whose op is one of dayGLANCE's undo ops: `at` is the
 * main-process clock, `tool` e.g. 'dayglance_create_task', and `summary` is
 * built by the renderer.
 */
export type JournalEntry = HostJournalEntry<UndoOp>;
export type JournalRecord = HostJournalRecord<UndoOp>;

/**
 * PER-TASK grouping key: the single entity an op reverses. The per-task undo
 * partition rests on every op touching exactly one task — true for all six
 * current kinds (verified against taskMutations.js: no forward write cascades
 * to another task), and a task's id is stable across scheduling AND across
 * renames (update_task edits fields in place, never the id), so taskId and
 * blockId are the same key for the same task for the whole session. Recurring
 * completions group per INSTANCE (template::date): undoing "Tuesday's
 * completion" must not drag Wednesday's along.
 *
 * THROWS on an unknown kind, deliberately: a future multi-task op would break
 * the partition property, and it must fail visibly at the grouping seam — a
 * loud error when its first write is journaled — never silently group wrong.
 */
export function undoGroupKey(op: UndoOp): string {
  switch (op?.kind) {
    case 'remove_created':
    case 'restore_unscheduled':
    case 'restore_completion':
    case 'restore_task_fields':
    case 'remove_created_subtask':
    case 'restore_subtask_fields':
      return String(op.taskId);
    case 'restore_block_fields':
      return String(op.blockId);
    // Goals and projects are their own entities; the prefix keeps a goal and a
    // task that happen to share an id apart.
    case 'remove_created_goal':
    case 'restore_goal_fields':
      return `goal:${op.goalId}`;
    case 'remove_created_project':
    case 'restore_project_fields':
      return `project:${op.projectId}`;
    case 'restore_note_description':
      return `${op.entityKind}:${op.entityId}`;
    case 'restore_recurring_completion':
      return `${op.templateId}::${op.dateStr}`;
    // The series as a whole: an occurrence edit lives on the template too, so
    // it groups with the series rather than with that date's completion.
    case 'remove_created_series':
    case 'restore_series_fields':
      return `series:${op.templateId}`;
    default: {
      const kind = (op as { kind?: unknown } | null | undefined)?.kind;
      throw new Error(
        `undoGroupKey: unknown undo op kind ${JSON.stringify(kind)}. ` +
        'Per-task undo assumes every op touches exactly one task; teach this function the new kind (and verify that property) before journaling it.',
      );
    }
  }
}

/**
 * The group label, taken from the group's LATEST entry (the kit's rule, BY
 * DESIGN: update_task can rename a task mid-session, and the group represents
 * the task as it now exists, so the newest entry's title must win; this
 * replaces an earlier assumption that no MCP write renames a task). The
 * quoted title, with the instance date appended for recurring completions so
 * two dates on the same series stay tellable apart. Falls back to the raw
 * summary if no quoted title is found.
 */
export function journalGroupLabel(entry: JournalEntry): string {
  if (entry.op.kind === 'restore_recurring_completion') {
    return `${summaryTitle(entry.summary) ?? entry.op.templateId} (${entry.op.dateStr})`;
  }
  return defaultGroupLabel(entry);
}

const GROUPING: JournalGrouping<UndoOp> = { groupKey: undoGroupKey, groupLabel: journalGroupLabel };

/**
 * Per-task groups over the FULL journal — never the display trim, whose
 * last-50 window would undercount a busy task — newest activity first.
 */
export function journalGroups(entries: JournalEntry[]): JournalGroup[] {
  return hostJournalGroups(entries, GROUPING);
}

/**
 * The display snapshot pushed to the tray and main windows: newest first,
 * bounded so a long agent session cannot flood the 320px popup. The total and
 * the per-task groups are computed over the FULL journal, and the display rows
 * never carry the op (a full before-task for schedule entries).
 */
export function journalSnapshot(entries: JournalEntry[], displayLimit = 50): JournalSnapshot {
  return hostJournalSnapshot(entries, GROUPING, displayLimit);
}

/**
 * §6.5 tier-to-indicator mapping. The label names the current tier in the
 * tray icon's right-click menu and the expandable status panels. The glyph
 * is UNUSED as of the presentation restructure — the menu-bar title carries
 * no MCP state (glanceable state moved to the in-app bolt button, whose dot
 * follows the settings-cluster convention); kept, not deleted, because the
 * mapping itself is the tested §6.3→§6.5 tier translation and the label half
 * is load-bearing.
 */
export function mcpIndicator(gates: { bound: boolean; includeNative: boolean; includeWrites: boolean }): {
  glyph: string;
  label: string;
} {
  if (!gates.bound) return { glyph: '', label: 'MCP server off' };
  const reads = gates.includeNative ? 'reads incl. device calendar' : 'reads dayGLANCE data';
  if (gates.includeWrites) return { glyph: '⚡', label: `MCP on: ${reads} + writes` };
  return { glyph: '⌁', label: `MCP on: ${reads}` };
}

/**
 * Menu-bar title composition: focus countdown first, else the reminder dot.
 * Deliberately carries NO MCP state — the tier glyph was removed in the
 * presentation restructure (it competed with focus/reminder state in a
 * surface that exists only on macOS; the bolt button in the app and tray
 * popup is the ambient §6.5 signal on every platform).
 */
export function composeTrayTitle(parts: { focusTitle: string; reminderOn: boolean }): string {
  return parts.focusTitle || (parts.reminderOn ? '●' : '');
}
