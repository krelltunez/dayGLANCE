// Editor hiding: two display-only decorations plus the stylesheet that acts
// on them. Nothing in this file writes to a note, and nothing here reads or
// changes identity — the decorations add CSS classes, the CSS hides.
//
//   1. dayGLANCE's own block id tokens (`^dg-xxxxxxxx` at the end of a
//      line) get a mark class in Live Preview. The user's own block ids
//      are untouched — CSS cannot match on text, which is why this is an
//      editor extension rather than the vault-wide snippet it replaces.
//   2. In a note LINKED to a dayGLANCE project or goal (bridge.ts's linked
//      map, the same map the frontmatter writer keys on), checked task
//      lines get a line class in Live Preview and a list-item class in
//      Reading view. Daily notes and unlinked notes are untouched.
//
// Both rules exempt the cursor line: the CSS keys on Obsidian's `.cm-active`,
// so whatever is hidden reappears the moment the cursor lands on its line.
// That exemption has been the diagnostic window every time a token or a
// line mattered, and it costs nothing here because the extension never
// needs to know where the cursor is.
//
// The two settings toggle BODY classes rather than the decorations: a
// flipped toggle takes effect in every open pane at once, with no editor
// dispatch, and the decoration work stays cheap (visible lines only).

import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, MatchDecorator, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { MarkdownView, editorInfoField, type App } from 'obsidian';
import { isCompletedTaskLine, isCompletedTaskMarker, ownBlockIdSpan, type EditorHidingSettings } from './editorHidingRules';

export interface EditorHidingHost {
  app: App;
  /** True when the path is linked to a dayGLANCE project or goal. */
  isLinkedNote(path: string): boolean;
  getSettings(): EditorHidingSettings;
}

const STYLE_ID = 'dayglance-editor-hiding-styles';
const BODY_HIDE_BLOCK_IDS = 'dg-hide-block-ids';
const BODY_HIDE_COMPLETED = 'dg-hide-completed';
export const BLOCK_ID_CLASS = 'dg-blockid';
export const DONE_LINE_CLASS = 'dg-done';

// `.cm-active` is Obsidian's cursor-line class (the same hook the common
// block-id snippet uses). `display: none` on a `.cm-line` is the shape the
// widely used completed-task snippets take; CodeMirror measures the line
// at zero height and moves on.
const CSS = `
body.${BODY_HIDE_BLOCK_IDS} .markdown-source-view.is-live-preview .cm-line:not(.cm-active) .${BLOCK_ID_CLASS} { display: none; }
body.${BODY_HIDE_COMPLETED} .markdown-source-view.is-live-preview .cm-line.${DONE_LINE_CLASS}:not(.cm-active) { display: none; }
body.${BODY_HIDE_COMPLETED} .markdown-reading-view li.task-list-item.${DONE_LINE_CLASS} { display: none; }
`;

export function injectEditorHidingStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const el = doc.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  doc.head.appendChild(el);
}

export function removeEditorHidingStyles(doc: Document): void {
  doc.getElementById(STYLE_ID)?.remove();
  doc.body.classList.remove(BODY_HIDE_BLOCK_IDS, BODY_HIDE_COMPLETED);
}

/** Reflect the settings as body classes (idempotent; call on load and on change). */
export function applyEditorHidingSettings(doc: Document, s: EditorHidingSettings): void {
  doc.body.classList.toggle(BODY_HIDE_BLOCK_IDS, s.hideBlockIds);
  doc.body.classList.toggle(BODY_HIDE_COMPLETED, s.hideCompletedInLinkedNotes);
}

// ── 1. Own block ids (Live Preview) ────────────────────────────────────────

const blockIdMark = Decoration.mark({ class: BLOCK_ID_CLASS });

// MatchDecorator matches within single lines and maintains its set
// incrementally across viewport and document changes. The regexp finds a
// candidate at the line end; the decorate callback applies the block-id
// position rule (whitespace before, or the whole line) from the pure rules
// module so the two never drift.
const blockIdDecorator = new MatchDecorator({
  regexp: /\^dg-[a-z0-9]{8}$/g,
  decorate: (add, from, to, _match, view) => {
    const line = view.state.doc.lineAt(from);
    const span = ownBlockIdSpan(line.text);
    if (span && line.from + span.from === from && line.from + span.to === to) add(from, to, blockIdMark);
  },
});

const blockIdPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = blockIdDecorator.createDeco(view); }
    update(u: ViewUpdate) { this.decorations = blockIdDecorator.updateDeco(u, this.decorations); }
  },
  { decorations: (v) => v.decorations },
);

// ── 2. Completed lines in linked notes (Live Preview) ──────────────────────

const doneLine = Decoration.line({ class: DONE_LINE_CLASS });

// Dispatched by refreshEditorHiding: "the linked map changed, rebuild".
const refreshEffect = StateEffect.define<null>();

function buildDoneDecorations(view: EditorView, host: EditorHidingHost): DecorationSet {
  const path = view.state.field(editorInfoField, false)?.file?.path;
  if (!path || !host.isLinkedNote(path)) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (line.from > last && isCompletedTaskLine(line.text)) {
        builder.add(line.from, line.from, doneLine);
        last = line.from;
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

function donePlugin(host: EditorHidingHost) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildDoneDecorations(view, host); }
      update(u: ViewUpdate) {
        // Doc and viewport changes cover editing and scrolling; a file
        // switch inside one pane arrives as a doc change. A link change
        // while the note is open is pushed by refreshEditorHiding below.
        const refresh = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshEffect)));
        if (refresh || u.docChanged || u.viewportChanged) this.decorations = buildDoneDecorations(u.view, host);
      }
    },
    { decorations: (v) => v.decorations },
  );
}

export function editorHidingExtension(host: EditorHidingHost): Extension {
  return [blockIdPlugin, donePlugin(host)];
}

/**
 * Re-run the linked-note decoration in every open Markdown pane — for a
 * link made or broken while the note is open. The editor gets a
 * no-change transaction carrying the refresh effect; a pane in Reading
 * view re-renders so the post-processor runs again.
 */
export function refreshEditorHiding(app: App): void {
  app.workspace.iterateAllLeaves((leaf) => {
    const view = leaf.view;
    if (!(view instanceof MarkdownView)) return;
    const cm = (view.editor as unknown as { cm?: EditorView }).cm;
    if (cm) cm.dispatch({ effects: refreshEffect.of(null) });
    if (view.getMode() === 'preview') view.previewMode.rerender(true);
  });
}

// ── 2b. Completed lines in linked notes (Reading view) ─────────────────────

/** Markdown post-processor: tag checked list items in a linked note. */
export function markCompletedInReadingView(host: EditorHidingHost, el: HTMLElement, sourcePath: string): void {
  if (!sourcePath || !host.isLinkedNote(sourcePath)) return;
  for (const li of Array.from(el.querySelectorAll<HTMLElement>('li.task-list-item'))) {
    if (isCompletedTaskMarker(li.dataset.task)) li.classList.add(DONE_LINE_CLASS);
  }
}
