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
 * PER-TASK grouping key: the single entity an op reverses. The per-task undo
 * partition rests on every op touching exactly one task — true for all five
 * current kinds (verified against taskMutations.js: no forward write cascades
 * to another task), and a task's id is stable across scheduling, so taskId
 * and blockId are the same key for the same task. Recurring completions group
 * per INSTANCE (template::date): undoing "Tuesday's completion" must not drag
 * Wednesday's along.
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
      return String(op.taskId);
    case 'restore_block_fields':
      return String(op.blockId);
    case 'restore_recurring_completion':
      return `${op.templateId}::${op.dateStr}`;
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
 * The task title inside a journal summary. Titles live only in summaries —
 * the op payloads mostly lack them — always wrapped in “ ” by the renderer's
 * summary builder. First “ to LAST ” is exactly the title in every summary
 * shape (nothing after the closing quote contains ”: dates, times, and
 * fixed words only), so titles with embedded quotes survive intact.
 */
export function summaryTitle(summary: string): string | null {
  const start = summary.indexOf('“');
  const end = summary.lastIndexOf('”');
  return start !== -1 && end > start ? summary.slice(start + 1, end) : null;
}

export interface JournalGroup {
  key: string;
  label: string;
  count: number;
  /** seq of the group's newest entry, for newest-activity-first ordering. */
  latestSeq: number;
}

/**
 * Per-task groups computed over the FULL journal — never the display trim,
 * whose last-50 window would undercount a busy task — ordered by newest
 * activity first. The label is the quoted title from the group's latest
 * entry (no MCP write renames a task, so every entry agrees), with the
 * instance date appended for recurring completions so two dates on the same
 * series stay tellable apart. Falls back to the raw summary if no quoted
 * title is found.
 */
export function journalGroups(entries: JournalEntry[]): JournalGroup[] {
  const groups = new Map<string, JournalGroup>();
  for (const e of entries) {
    const key = undoGroupKey(e.op);
    const title = summaryTitle(e.summary);
    const label = e.op.kind === 'restore_recurring_completion'
      ? `${title ?? e.op.templateId} (${e.op.dateStr})`
      : (title ?? e.summary);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.latestSeq = e.seq;
      existing.label = label;
    } else {
      groups.set(key, { key, label, count: 1, latestSeq: e.seq });
    }
  }
  return [...groups.values()].sort((a, b) => b.latestSeq - a.latestSeq);
}

/**
 * The display snapshot pushed to the tray and main windows: newest first,
 * bounded so a long agent session cannot flood the 320px popup — the TOTAL
 * always reports the full session count, so "Undo all (N)" stays honest even
 * when the list is trimmed for display. Each display row carries its
 * groupKey, and `groups` (counts, labels) is computed over the FULL journal
 * so per-task counts stay honest past the trim too.
 */
export function journalSnapshot(entries: JournalEntry[], displayLimit = 50): {
  total: number;
  entries: Array<Omit<JournalEntry, 'op'> & { groupKey: string }>;
  groups: JournalGroup[];
} {
  return {
    total: entries.length,
    groups: journalGroups(entries),
    entries: entries
      .slice(-displayLimit)
      .reverse()
      // The op carries a full before-task for schedule entries; the display
      // surface has no use for it and no business holding user data copies.
      .map(({ op, ...display }) => ({ ...display, groupKey: undoGroupKey(op) })),
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
