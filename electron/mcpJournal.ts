// The §4.3 write journal and §6.5 tray indicator, extracted as pure functions
// (startupQuit.ts style). The journal is SESSION-SCOPED BY DESIGN: it lives in
// a module-scope array in main.ts (never on the McpServer instance, §3.7, and
// never on disk) — it covers the runaway-agent case, not audit history, so a
// restart wiping it is correct behavior, not a limitation.
//
// Undo works from per-entry before-state captured by the renderer at write
// time, because the journal alone cannot reverse everything: scheduling a
// task DESTROYS its inbox-only fields (applyScheduleTask strips priority and
// deadline), and move/resize/completion overwrite values nothing else
// remembers. Each entry therefore carries exactly the fields its reversal
// needs — a full before-task for schedule, touched fields otherwise.

/** Reversal instruction, applied by taskMutations.js applyUndoOps in the renderer. */
export type UndoOp =
  | { kind: 'remove_created'; taskId: string }
  | { kind: 'restore_unscheduled'; taskId: string; beforeTask: Record<string, unknown> }
  | { kind: 'restore_block_fields'; blockId: string; before: Record<string, unknown> }
  | { kind: 'restore_completion'; taskId: string; before: { completed: boolean; completedAt?: string | null } }
  | { kind: 'restore_recurring_completion'; templateId: string | number; dateStr: string; wasCompleted: boolean };

export interface JournalEntry {
  seq: number;
  /** ISO timestamp of the write (main-process clock). */
  at: string;
  /** MCP tool that performed the write, e.g. 'dayglance_create_task'. */
  tool: string;
  /** Display-ready description of what changed, built by the renderer. */
  summary: string;
  /** The caller's idempotency key, when it sent one. */
  idempotencyKey?: string;
  op: UndoOp;
}

export interface JournalRecord {
  tool: string;
  summary: string;
  idempotencyKey?: string;
  op: UndoOp;
}

/**
 * Append one write to the journal. Immutable (returns a new array) so the
 * main-process store is a plain reassigned variable, and seq is monotonically
 * increasing within the session regardless of any future trimming.
 */
export function appendEntry(entries: JournalEntry[], record: JournalRecord, nowIso: string): JournalEntry[] {
  const seq = entries.length > 0 ? entries[entries.length - 1].seq + 1 : 1;
  const entry: JournalEntry = {
    seq,
    at: nowIso,
    tool: record.tool,
    summary: record.summary,
    ...(record.idempotencyKey !== undefined ? { idempotencyKey: record.idempotencyKey } : {}),
    op: record.op,
  };
  return [...entries, entry];
}

/**
 * The display snapshot pushed to the tray and main windows: newest first,
 * bounded so a long agent session cannot flood the 320px popup — the TOTAL
 * always reports the full session count, so "Undo all (N)" stays honest even
 * when the list is trimmed for display.
 */
export function journalSnapshot(entries: JournalEntry[], displayLimit = 50): {
  total: number;
  entries: Array<Omit<JournalEntry, 'op'>>;
} {
  return {
    total: entries.length,
    entries: entries
      .slice(-displayLimit)
      .reverse()
      // The op carries a full before-task for schedule entries; the display
      // surface has no use for it and no business holding user data copies.
      .map(({ op: _op, ...display }) => display),
  };
}

/**
 * Bulk-undo reconstruction: every session write reversed in REVERSE
 * chronological order, so compound histories unwind correctly — e.g.
 * create → schedule → move unwinds as restore-fields, restore-to-inbox,
 * remove-created, each op finding the state its own write produced.
 */
export function buildUndoPlan(entries: JournalEntry[]): { count: number; ops: UndoOp[] } {
  const ops = entries.slice().reverse().map((e) => e.op);
  return { count: entries.length, ops };
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
