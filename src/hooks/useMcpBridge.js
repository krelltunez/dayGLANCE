import { useEffect, useRef } from 'react';
import { isTrayMode } from '../utils/trayMode.js';
import { handleMcpRequest, goalItem, projectItem } from '@glance-apps/dayglance-mcp/model';
import { handleMcpWrite, isWriteMethod, progressTasksOf } from '../utils/mcpWriteModel.js';
import { readRetiredTaskIds } from '../utils/retiredTaskIds.js';
import {
  enrichGoalTreeDescriptions, splitDescriptionWrite, writeLinkedDescription,
  noteDescriptionUndoOp, undoNoteDescriptionOps, NOTE_DESCRIPTION_UNDO_KIND,
} from '../utils/mcpNoteDescriptions.js';
import { noteTextHash } from '@glance-apps/obsidian-format';
import { readDefaultTaskDuration } from '../utils/defaultTaskDuration.js';

// The renderer half of the MCP IPC channel (docs/mcp-server-spec.md §10
// Phase 2), following the useTrayPopupVisible precedent from PR #1302: this
// hook is a thin subscription and nothing else — every decision lives in the
// unit-tested pure modules: the read model (@glance-apps/dayglance-mcp, which
// a GLANCEvault-client host answers through too), src/utils/mcpWriteModel.js
// and mcpNoteDescriptions.js. Deliberately NOT in useElectronBridge.js, which
// has no test coverage (§11 risk register).
//
// MAIN WINDOW ONLY. The tray popup runs this same App tree but holds a
// snapshot as of its last reload — answering from it would serve stale data.
// The main process also drops responses from any sender other than the main
// window (electron/mcpRendererBridge.ts), so this bail is the second of two
// independent guards.
//
// Requests are answered synchronously from a ref of the CURRENT state slices
// — live React state, exactly what the user sees — inside the IPC callback
// itself. No setState, no render round-trip, so hidden-window throttling
// cannot delay the reply: if this renderer is alive, the answer is immediate,
// which is what makes the main process's short ping timeout (§3.3 health
// check, not existence check) safe.
//
// THE ONE ASYNC EXCEPTION (2026-10-04): a linked goal's or project's
// description lives in its Obsidian note, so the goal tree read opens the
// notes to fill it in, and a description write on a linked entity goes
// through the planner's own section save (refuse-on-change included). Both
// await the vault and reply when done; the main process gives those calls a
// longer timeout. Everything else stays synchronous.
export default function useMcpBridge(state, setters, notes) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const settersRef = useRef(setters);
  settersRef.current = setters;
  const notesRef = useRef(notes);
  notesRef.current = notes;

  // Multi-user is a per-device toggle living in RENDERER state; the main
  // process needs it to gate assignee_id / list_users in the per-request
  // tool schemas. Pushed on mount and on every change (never polled), so a
  // toggle while an MCP client is connected updates the schema the client
  // sees on its very next request. Only the flag crosses the boundary —
  // the user roster stays here and is read over the bridge like any read.
  const multiUserEnabled = !!state.multiUserEnabled;
  useEffect(() => {
    if (isTrayMode) return;
    window.electronAPI?.mcpPushMultiUser?.(multiUserEnabled);
  }, [multiUserEnabled]);

  useEffect(() => {
    if (isTrayMode) return undefined;
    if (!window.electronAPI?.onMcpRequest) return undefined;
    return window.electronAPI.onMcpRequest((request) => {
      const respond = (response) => window.electronAPI.mcpRespond({ id: request?.id, ...response });
      try {
        const method = request?.method;
        if (method === 'goal_progress') {
          const base = handleMcpRequest(stateRef.current, request);
          if (!base.ok) { respond(base); return; }
          enrichGoalTreeDescriptions(base.data, notesRef.current ?? {})
            .then((data) => respond({ ok: true, data }), () => respond(base));
          return;
        }
        if (isWriteMethod(method)) {
          // Writes route through the shared pure-mutation module (spec §3.1 r5)
          // and reply immediately after the setters are invoked: the mutation is
          // committed by React's batch in this same task, and the save pass
          // (useSaveOnChange → saveData → tray:data-changed) follows on the
          // commit. The id-retirement record is read fresh per write, not
          // carried in state: it lives in localStorage, and the Obsidian commit
          // that re-keys a task writes it there (useObsidianSync recordRetirements).
          // The default task duration (#2367) is read the same way: a per-device
          // setting in localStorage, taken by a create or schedule given no duration.
          const live = { ...stateRef.current, retiredTaskIds: readRetiredTaskIds(), defaultTaskDuration: readDefaultTaskDuration() };
          const params = request?.params ?? {};
          const split = splitDescriptionWrite(live, method, params);
          if (split) {
            writeSplit(live, settersRef.current ?? {}, notesRef.current ?? {}, method, params, split).then(respond, (err) => respond({ ok: false, error: { code: 'internal', message: String(err?.message ?? err) } }));
            return;
          }
          if (method === 'undo_mcp_writes' && (params.ops ?? []).some((op) => op?.kind === NOTE_DESCRIPTION_UNDO_KIND)) {
            undoWithNotes(live, settersRef.current ?? {}, notesRef.current ?? {}, params).then(respond, (err) => respond({ ok: false, error: { code: 'internal', message: String(err?.message ?? err) } }));
            return;
          }
          respond(handleMcpWrite(live, settersRef.current ?? {}, request));
          return;
        }
        respond(handleMcpRequest(stateRef.current, request));
      } catch (err) {
        // A throwing model must still answer — silence here would read as a
        // dead renderer and turn one bad request into "dayGLANCE unavailable".
        respond({ ok: false, error: { code: 'internal', message: String(err?.message ?? err) } });
      }
    });
  }, []);
}

/**
 * A description write on a LINKED goal or project: the note half through the
 * section save, then the record half (title, dates, status...) through the
 * pure write model when the call carried one. One undo descriptor covers
 * both: the previous section goes back under the hash of what was written,
 * and the record fields ride along as `fields`.
 */
async function writeSplit(live, setters, notes, method, params, split) {
  const read = typeof notes.loadNoteDescription === 'function'
    ? await Promise.resolve().then(() => notes.loadNoteDescription(split.link.path)).catch(() => null)
    : null;
  const before = read && !read.notFound && typeof read.text === 'string' ? read.text : '';
  const note = await writeLinkedDescription({ ...split, before }, notes);
  if (!note.ok) return note;
  let rest = null;
  if (split.rest) {
    rest = handleMcpWrite(live, setters, { method, params: split.rest });
    if (!rest.ok) return { ...rest, data: undefined, error: { ...rest.error, message: `${rest.error.message} (the description was already ${note.mode === 'queued' ? 'queued for' : 'written to'} the note)` } };
  }
  const q = (t) => `“${t ?? ''}”`;
  const entityKey = split.kind === 'goal' ? 'goal' : 'project';
  let item = rest?.data?.[entityKey];
  if (!item) {
    item = split.kind === 'goal' ? goalItem(split.entity, live, progressTasksOf(live)) : projectItem(split.entity, progressTasksOf(live));
  }
  const afterBase = noteTextHash(split.text);
  const data = {
    [entityKey]: { ...item, description: split.text, description_source: 'obsidian_note', description_base: afterBase, note_write: note.mode },
    replayed: false,
  };
  const touched = ['description', ...(rest?.undo?.summary ? rest.undo.summary.replace(/^.*\((.*)\)$/, '$1').split(', ') : [])];
  const undo = {
    summary: `Edited ${entityKey} ${q(item.title)} (${touched.join(', ')})`,
    op: { ...noteDescriptionUndoOp({ ...split, before }, afterBase), ...(rest?.undo?.op ? { fields: rest.undo.op } : {}) },
  };
  return { ok: true, data, undo };
}

/** Bulk undo with note-description ops in the batch: notes first, in order, then everything else in one sync pass. */
async function undoWithNotes(live, setters, notes, params) {
  const ops = params.ops ?? [];
  const noteOps = ops.filter((op) => op?.kind === NOTE_DESCRIPTION_UNDO_KIND);
  const other = ops.filter((op) => op?.kind !== NOTE_DESCRIPTION_UNDO_KIND);
  const fieldOps = noteOps.map((op) => op.fields).filter(Boolean);
  const n = await undoNoteDescriptionOps(noteOps, notes);
  const r = handleMcpWrite(live, setters, { method: 'undo_mcp_writes', params: { ...params, ops: [...other, ...fieldOps] } });
  if (!r.ok) return r;
  return { ok: true, data: { undone: r.data.undone + n.undone, skipped: r.data.skipped + n.skipped } };
}
