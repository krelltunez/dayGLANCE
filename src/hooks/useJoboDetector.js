import { useEffect, useRef, useReducer } from 'react';
import { snapshotJoboState, planJoboTransitions, buildJoboRecords, advanceJoboReopenReceipts } from '../jobo/detector.js';
import { isTrayMode } from '../utils/trayMode.js';

// JOBO completion detector (slice 4). Watches task state for completion
// transitions and writes Do records through recordJobo, the ledger's only
// writer. The planning is pure and lives in src/jobo/detector.js; this hook
// owns the snapshot, the in-flight guard and the write, in the shape of
// useCompletionLog.
//
// One-shot, like the completion log: the snapshot advances after the write
// attempt, so a transition is handed over exactly once. That is safe because
// the ledger owns the record from then on: a write that fails is held there
// and retried with backoff (ledger.js), and a device that observes the same
// completion through sync produces the same id.
//
// Records are built against the ledger's WORKING SET, read at effect time,
// not the committed `joboRecords`: a completion still held for retry is
// otherwise invisible, and an uncheck that follows it finds nothing to
// reassess, so the retry later persists `completed` for a reopened task
// (#1826). Reading the ledger directly also means no render lag between one
// write and the next edge.
export default function useJoboDetector({
  tasks, unscheduledTasks, recurringTasks,
  readJoboWorkingSet, joboLoaded, joboWritable, recordJobo,
  isRemoteApply,
  enabled,
}) {
  const prevRef = useRef(null);
  const inFlightRef = useRef(false);
  // Not persisted or exposed to the view: proof of our own accepted uncheck.
  const reopenReceiptsRef = useRef(new Map());
  const receiptEpochRef = useRef(0);
  const [, bump] = useReducer((x) => x + 1, 0);

  useEffect(() => {
    if (isTrayMode) return;
    if (!enabled || !joboLoaded || joboWritable === false) {
      reopenReceiptsRef.current.clear();
      receiptEpochRef.current += 1;
    }
    const nextSnap = snapshotJoboState(tasks, unscheduledTasks, recurringTasks);
    const { edges, advanceTo } = planJoboTransitions(prevRef.current, nextSnap, {
      tasks, unscheduledTasks, recurringTasks,
      isRemoteApply: !!isRemoteApply?.(),
      enabled: !!enabled,
      loaded: !!joboLoaded,
      writable: joboWritable !== false,
      inFlight: inFlightRef.current,
    });
    if (!edges) {
      if (advanceTo !== null) prevRef.current = advanceTo;
      return;
    }
    const records = buildJoboRecords(edges, readJoboWorkingSet?.(), {
      observedAt: new Date().toISOString(), reopenReceipts: reopenReceiptsRef.current,
    });
    const nextReceipts = advanceJoboReopenReceipts(reopenReceiptsRef.current, edges, records);
    const receiptEpoch = receiptEpochRef.current;
    if (!records.length) {
      reopenReceiptsRef.current = nextReceipts;
      prevRef.current = nextSnap; // every edge was already present, or unusable
      return;
    }
    inFlightRef.current = true;
    Promise.resolve()
      .then(() => recordJobo(records))
      .then((result) => {
        // Held means the ledger has it and will retry; refused means it does
        // not (not loaded, read-only), which the gate should have prevented.
        // Disabling/read-only/reset while this write was in flight must not
        // let its eventual receipt re-arm a completion on enable.
        if (receiptEpoch === receiptEpochRef.current && (result?.ok || result?.held)) {
          reopenReceiptsRef.current = nextReceipts;
        } else reopenReceiptsRef.current.clear();
        if (result && result.ok === false && !result.held) console.warn('[jobo] ledger write refused:', result.error);
      })
      .catch((err) => { reopenReceiptsRef.current.clear(); console.error('[jobo] ledger write failed:', err); })
      .finally(() => {
        prevRef.current = nextSnap;
        inFlightRef.current = false;
        bump(); // catch transitions that arrived during the in-flight window
      });
  });
}
