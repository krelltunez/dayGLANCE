import { beginFocusCapture, resumeFocusCapture, pauseFocusCapture, sealFocusCapture } from './focusCapture.js';
import { buildFocusDoRecords, summarizeFocusCapture } from './focusRecords.js';

/** One in-memory Focus phase, not a pending-write queue or a second ledger. */
export function createFocusSession({ getState, publish, makeId = () => crypto.randomUUID(), now = Date.now }) {
  let sessionId = null, phaseNumber = 0, capture = null, pending = null, busy = false;
  let block = [];
  const reset = () => { sessionId = null; capture = null; pending = null; busy = false; publish(null); };
  const view = (error = null) => publish(pending ? {
    capture: pending.capture, choice: pending.choice, summary: summarizeFocusCapture(pending.capture), busy, error,
  } : null);

  return {
    begin(tasks) {
      // A new entry cannot silently discard a settlement still on screen.
      if (pending || busy) return false;
      reset();
      sessionId = `focus:${makeId()}`;
      phaseNumber = 0;
      block = tasks;
      return true;
    },
    transition({ before, after, at }) {
      if (pending && after.running) return false;
      if (!getState().enabled) { capture = null; return true; }
      if (before.phase === 'work' && before.running && (!after.running || after.phase !== 'work') && capture) {
        // A manual backwards clock adjustment must not break Pause/Stop or
        // fabricate a civil interval. Preserve earlier segments and disclose it.
        if (capture.active && at < capture.active.startedAt) {
          capture = { ...capture, active: null, clockChanged: true };
        } else capture = pauseFocusCapture(capture, at);
      }
      if (after.phase === 'work' && after.running && (!before.running || before.phase !== 'work')) {
        if (!sessionId) return true;
        if (!capture) {
          const tasks = getState().resolveBlock(block);
          capture = beginFocusCapture({ id: `${sessionId}:${phaseNumber++}`, tasks });
        }
        capture = resumeFocusCapture(capture, at);
      }
      return true;
    },
    settle(continuation, { exiting = false } = {}) {
      if (pending) {
        // A native Stop while reviewing a phase ends the session after review.
        if (exiting) pending.continuation = continuation;
        return true;
      }
      if (!getState().enabled || !capture) { capture = null; return false; }
      const sealed = sealFocusCapture(capture, now());
      capture = null;
      if ((!sealed.segments.length && !sealed.clockChanged) || !sealed.candidates.length) return false;
      pending = { capture: sealed, continuation, choice: null };
      view();
      return true;
    },
    async save(actionId, completed) {
      if (!pending || busy) return;
      const state = getState();
      if (!state.enabled || !state.loaded || !state.writable) { view('unavailable'); return; }
      // Once a write was attempted, attribution cannot change under held rows.
      if (pending.choice && String(pending.choice.actionId) !== String(actionId)) return;
      const settlement = pending;
      busy = true;
      view();
      try {
        const records = buildFocusDoRecords(settlement.capture, actionId, state.records);
        settlement.choice = { actionId };
        const result = records.length ? await state.recordJobo(records) : { ok: true };
        if (!result.ok) { busy = false; view(result.held ? 'held' : 'failed'); return; }
        // Clear before native completion/continuation; duplicate events cannot write again.
        pending = null;
        busy = false;
        publish(null);
        const completion = completed ? getState().complete(actionId) : null;
        settlement.continuation({ allCompleted: !!completion?.allCompleted, completedActionId: completion?.completedActionId ?? null });
      } catch {
        busy = false;
        view('failed');
      }
    },
    disable() { capture = null; if (pending) view('unavailable'); },
    dismiss() {
      if (!pending || busy) return;
      const continuation = pending.continuation;
      pending = null;
      publish(null);
      continuation({ allCompleted: false });
    },
    finish: reset,
    isPending: () => pending !== null,
  };
}
