// "Add to dayGLANCE" (companion spec 4.2.1): text selected in a note becomes
// ONE inbox task in dayGLANCE, titled with the selection and linked back to
// the note with a wikilink.
//
// The plugin still never writes the data plane. It emits a `task_create`
// ACTION row on the bridge stream (sealed under the pairing subkey, the
// sidebar completion's family, under its own BRIDGE_CREATE_ACTION_PREFIX)
// and a running dayGLANCE builds the task through its own state. Emitting
// needs only the pairing: the passphrase only adds the project list.
//
// THE LINK. Obsidian's own link text for the note (a bare name while it is
// unique, a path otherwise), always as a wikilink, whatever the user's
// markdown-link setting. With "Link to the exact paragraph" on, the link
// names the block holding the selection's start: an id of the user's already
// at the end of that block is reused, and otherwise a short random one is
// added there, through the editor so undo works and the open buffer is not
// overwritten.
//
// NEVER A `^dg-` ID, NOT EVEN IN A LINK. dayGLANCE's stamps are block ids,
// and the plugin reads `^dg-` content as a dayGLANCE note, so it never writes
// one (a minted id is six lowercase letters and digits, so it cannot). Nor
// does a link name one: a title holding `^dg-` is one the writeback refuses
// to stamp (blockIdSuffix), so a task put into its project's linked note
// would land there unstamped and could be imported twice. A stamped task
// line therefore links to the note, as an unstamped one does.
//
// NEVER AN ID ON AN UNSTAMPED TASK LINE. dayGLANCE's parser keeps a block id
// it does not own as part of a task's title, and the stamper refuses a line
// that ends in one (identity.js, hasForeignBlockId), so an id added to
// `- [ ] Buy milk` would retitle the task and keep its line unstamped for
// good. Such a selection links to the note instead, and the notice says so.

import type { App, Editor, EditorPosition, TFile } from 'obsidian';

export interface AddTaskValues {
  title: string;
  /** YYYY-MM-DD, or null. */
  deadline: string | null;
  /** dayGLANCE's scale: 0 none, 1 low, 2 medium, 3 high. */
  priority: number;
  projectId: string | null;
}

/** The priority choices, in the app's order and words. */
export const PRIORITY_LABELS = ['None', 'Low', 'Medium', 'High'] as const;

// A list item, its checkbox, a heading, a quote marker: the line's syntax,
// not the task's words.
const LINE_SYNTAX = /^\s*(?:>\s*)*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?)?/;
const TRAILING_BLOCK_ID = /(?:^|\s)\^[A-Za-z0-9-]+\s*$/;

/** The modal's prefill: the selection's words, one line, without list or heading syntax or a trailing block id. */
export function titleFromSelection(text: string): string {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(LINE_SYNTAX, '').replace(TRAILING_BLOCK_ID, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The title as submitted: line breaks become spaces; trimmed. */
export function normalizeTitle(text: string): string {
  return String(text ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** A YYYY-MM-DD that names a real day, or null. */
export function validDeadline(value: string | null | undefined): string | null {
  const s = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

// ── the block ────────────────────────────────────────────────────────────

export type BlockPlan =
  | { kind: 'reuse'; id: string }
  | { kind: 'mint'; line: number }
  | { kind: 'none'; reason: 'task-line' | 'unsupported' | 'empty' };

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;
const TASK_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]/;
const HEADING = /^\s{0,3}#{1,6}(?:\s|$)/;
const FENCE = /^\s*(```|~~~)/;
const QUOTE = /^\s*>/;
const TABLE = /^\s*\|/;
const MATH = /^\s*\$\$/;
const BLOCK_ID_AT_END = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;
const blank = (s: string | undefined): boolean => s === undefined || s.trim() === '';
// Lines that start a block of their own, so a paragraph or list item ends before them.
const startsOwnBlock = (s: string): boolean => LIST_ITEM.test(s) || HEADING.test(s) || FENCE.test(s) || QUOTE.test(s) || TABLE.test(s) || MATH.test(s);

/**
 * Where the block id for a selection goes (pure). `from`/`to` are the
 * selection's lines; the block is the one holding its first non-blank line.
 * A paragraph or a list item (with its continuation lines) takes its id at
 * the end of its last line, as Obsidian puts one. Frontmatter, code, math,
 * tables, quotes and headings are left alone: those link to the note.
 */
export function planBlockLink(lines: string[], from: number, to: number): BlockPlan {
  let start = -1;
  for (let i = Math.max(0, from); i <= Math.min(to, lines.length - 1); i++) {
    if (!blank(lines[i])) { start = i; break; }
  }
  if (start < 0) return { kind: 'none', reason: 'empty' };
  // Frontmatter and fenced code, from the top of the note.
  let inFrontmatter = lines[0] === '---';
  let inFence = false;
  for (let i = 0; i <= start; i++) {
    const s = lines[i];
    if (inFrontmatter) {
      if (i > 0 && (s === '---' || s === '...')) { inFrontmatter = false; if (i === start) return { kind: 'none', reason: 'unsupported' }; }
      continue;
    }
    if (FENCE.test(s)) { inFence = !inFence; continue; }
  }
  if (inFrontmatter || inFence || FENCE.test(lines[start])) return { kind: 'none', reason: 'unsupported' };
  const line = lines[start];
  if (HEADING.test(line) || QUOTE.test(line) || TABLE.test(line) || MATH.test(line)) return { kind: 'none', reason: 'unsupported' };

  // The block's first line: a list item, or the top of a paragraph (which
  // may be the continuation of a list item above it).
  let first = start;
  if (!LIST_ITEM.test(line)) {
    while (first > 0 && !blank(lines[first - 1]) && !HEADING.test(lines[first - 1]) && !FENCE.test(lines[first - 1])
      && !QUOTE.test(lines[first - 1]) && !TABLE.test(lines[first - 1])) {
      first -= 1;
      if (LIST_ITEM.test(lines[first])) break;
    }
  }
  let last = first;
  while (last + 1 < lines.length && !blank(lines[last + 1]) && !startsOwnBlock(lines[last + 1])) last += 1;

  const existing = BLOCK_ID_AT_END.exec(lines[last]);
  if (existing && existing[1].startsWith('dg-')) return { kind: 'none', reason: 'task-line' };
  if (existing) return { kind: 'reuse', id: existing[1] };
  if (TASK_ITEM.test(lines[first])) return { kind: 'none', reason: 'task-line' };
  return { kind: 'mint', line: last };
}

/**
 * A fresh block id: six lowercase letters and digits, Obsidian's own shape,
 * not one `taken` already holds. Never `dg-…` (it cannot contain a hyphen).
 */
export function mintBlockId(taken: (id: string) => boolean, random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  for (;;) {
    let id = '';
    for (let i = 0; i < 6; i++) id += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
    if (!taken(id)) return id;
  }
}

/** `[[linktext]]` or `[[linktext#^id]]`. */
export function wikilinkFor(linktext: string, blockId: string | null): string {
  return `[[${linktext}${blockId ? `#^${blockId}` : ''}]]`;
}

/** The task title: `<title> [[<link>]]`. */
export function buildTaskTitle(title: string, link: string): string {
  return `${normalizeTitle(title)} ${link}`;
}

export interface TaskCreateInput {
  actionId: string;
  title: string;
  notePath: string;
  deadline: string | null;
  priority: number;
  projectId: string | null;
  viewer: string | null;
  createdAt: string;
}

/** The action payload (companion spec 4.2.1). Optional fields only when set. */
export function buildTaskCreatePayload(input: TaskCreateInput): Record<string, unknown> {
  const deadline = validDeadline(input.deadline);
  const priority = Number.isInteger(input.priority) && input.priority >= 1 && input.priority <= 3 ? input.priority : 0;
  return {
    v: 1, kind: 'action', type: 'task_create',
    actionId: input.actionId,
    title: input.title,
    notePath: input.notePath,
    ...(deadline ? { deadline } : {}),
    ...(priority ? { priority } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.viewer ? { viewer: input.viewer } : {}),
    createdAt: input.createdAt,
  };
}

// ── the whole step, on a live editor ────────────────────────────────────

export interface AddSelectionContext {
  app: App;
  editor: Editor;
  file: TFile;
  /** The selection as it was when the modal opened. */
  from: EditorPosition;
  to: EditorPosition;
  values: AddTaskValues;
  linkToBlock: boolean;
  /** Seal and send the payload (AgendaStore.createTask). */
  emit: (input: Omit<TaskCreateInput, 'actionId' | 'createdAt' | 'viewer'>) => Promise<{ ok: boolean; message: string }>;
}

export interface AddSelectionResult { ok: boolean; message: string; title?: string }

/**
 * Build the link (adding a block id first when the setting asks for one and
 * the block has none) and emit the action. The id is written before the
 * emit, so a failed send leaves an id the retry reuses rather than a task
 * that links to a block that does not exist.
 */
export async function addSelectionAsTask(ctx: AddSelectionContext): Promise<AddSelectionResult> {
  const words = normalizeTitle(ctx.values.title);
  if (!words) return { ok: false, message: 'Enter a title for the task.' };
  const linktext = ctx.app.metadataCache.fileToLinktext(ctx.file, '', true);
  let blockId: string | null = null;
  let fallback: string | null = null;
  if (ctx.linkToBlock) {
    const lines = ctx.editor.getValue().split('\n');
    const plan = planBlockLink(lines, ctx.from.line, ctx.to.line);
    if (plan.kind === 'reuse') {
      blockId = plan.id;
    } else if (plan.kind === 'mint') {
      const text = ctx.editor.getValue();
      blockId = mintBlockId((id) => text.includes(`^${id}`));
      const lineText = ctx.editor.getLine(plan.line);
      const end = lineText.replace(/\s+$/, '').length;
      const selections = ctx.editor.listSelections();
      ctx.editor.replaceRange(` ^${blockId}`, { line: plan.line, ch: end }, { line: plan.line, ch: lineText.length });
      ctx.editor.setSelections(selections);
    } else {
      fallback = plan.reason === 'task-line'
        ? 'Linked to the note: a task line gets its id from dayGLANCE.'
        : 'Linked to the note: this kind of block cannot hold an id.';
    }
  }
  const title = buildTaskTitle(words, wikilinkFor(linktext, blockId));
  const sent = await ctx.emit({
    title,
    notePath: ctx.file.path,
    deadline: validDeadline(ctx.values.deadline),
    priority: ctx.values.priority,
    projectId: ctx.values.projectId,
  });
  if (!sent.ok) return { ok: false, message: sent.message };
  return { ok: true, message: fallback ? `${sent.message} ${fallback}` : sent.message, title };
}
