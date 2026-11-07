// Tasks added from Obsidian (companion spec 4.2.1): the consumer of the
// plugin's task_create action rows, on EVERY paired device that holds the
// account key, with or without the vault folder. The rules are in
// utils/obsidianBridgeCreates.js; this hook is the cadence and the state.
//
// WHY NOT INSIDE THE OBSIDIAN CYCLE. performObsidianSync returns before it
// does anything on a device with no vault folder handle, so a phone paired
// only through GLANCEvault would never apply a create. The pass needs only
// what fetchBridgeActionRows gates on (vault on, paired, the verified
// account key), so it runs on its own cadence:
//  • once when the data has loaded, then every five minutes while open, and
//    when the app becomes visible again (the poll floor, as for Obsidian);
//  • on a GLANCEvault nudge for the bridge namespace (App wires the SSE
//    hook's drainObsidian to `nudgeBridgeTaskCreates` too), leading-edge,
//    at most one pass per NUDGE_MIN_GAP_MS, trailing-coalesced: one list
//    request per pass, the same pacing as the Obsidian probe;
//  • a FOLLOW-UP pass FOLLOW_UP_MS after a pass that created something, to
//    delete the rows once the tasks read back from the saved lists (and the
//    push-on-write debounce has run). See DELETE AFTER SAVE.
// Passes are serialised: one in flight, a request during it runs after it.
//
// THE CAPABILITY ANNOUNCEMENT (companion spec 4.2.2). Each pass first makes
// sure this app's capability rows (APP_BRIDGE_CAPABILITIES, task_create
// among them) are on the stream: the plugin sends a create only once it can
// read that row, so a fleet of older apps makes it say "update dayGLANCE"
// rather than "sent". It rides this pass because this pass is the consumer:
// it runs on exactly the devices that can apply a create (paired, holding
// the account key, folder or not; never the tray), behind the same gates.
// Written once per session per pairing generation (the publisher's guard),
// so every later pass costs nothing.
//
// The headless refresh root does not compose this hook (its allowlist,
// CLAUDE.md "Headless refresh"): a create waits for the app, or another
// device, to open.

import { useEffect, useRef, useCallback } from 'react';
import { runBridgeTaskCreatePass, addBridgeCreatedTasks } from '../utils/obsidianBridgeCreates.js';
import { publishBridgeCapabilities, APP_BRIDGE_CAPABILITIES } from '../utils/obsidianBridgeStream.js';

export const BRIDGE_CREATES_POLL_MS = 5 * 60 * 1000;
export const NUDGE_MIN_GAP_MS = 20_000;
export const FOLLOW_UP_MS = 10_000;

/**
 * @param {object} p
 * @param {boolean} p.dataLoaded
 * @param {boolean} [p.isTrayMode]
 * @param {object[]} p.tasks @param {object[]} p.unscheduledTasks
 * @param {object[]} p.recurringTasks @param {object[]} p.recycleBin
 * @param {object[]} p.projects @param {object[]} p.users
 * @param {boolean} p.multiUserEnabled
 * @param {Function} p.setUnscheduledTasks
 * @param {number|null} [p.followUpMs]  the follow-up delay; null: none (the
 *   bridge harness runs each device's passes itself)
 * @returns {{ consumeBridgeTaskCreates: () => Promise<object|null>, nudgeBridgeTaskCreates: () => void }}
 */
export default function useBridgeTaskCreates({
  dataLoaded, isTrayMode = false,
  tasks, unscheduledTasks, recurringTasks, recycleBin, projects, users, multiUserEnabled,
  setUnscheduledTasks, followUpMs = FOLLOW_UP_MS,
}) {
  // The live state, read at pass time (a pass awaits the network).
  const stateRef = useRef(null);
  stateRef.current = { tasks, unscheduledTasks, recurringTasks, recycleBin, projects, users, multiUserEnabled };
  const setterRef = useRef(setUnscheduledTasks);
  setterRef.current = setUnscheduledTasks;
  const runRef = useRef({ inFlight: null, again: false, followUp: null, nudge: null, lastNudgeAt: 0, disposed: false });

  const consumeBridgeTaskCreates = useCallback(async () => {
    const st = runRef.current;
    if (st.disposed || isTrayMode) return null;
    if (st.inFlight) { st.again = true; return st.inFlight; }
    st.inFlight = (async () => {
      let result = null;
      try {
        // Fail-silent and independent of the pass: a failed announcement is
        // retried by the next pass, and never holds a create back.
        await publishBridgeCapabilities(APP_BRIDGE_CAPABILITIES);
      } catch { /* retried next pass */ }
      try {
        result = await runBridgeTaskCreatePass({
          read: () => {
            const s = stateRef.current || {};
            return {
              tasks: s.tasks || [], unscheduledTasks: s.unscheduledTasks || [],
              recurringTasks: s.recurringTasks || [], recycleBin: s.recycleBin || [],
              projects: s.projects || [], users: s.users || [], multiUserEnabled: !!s.multiUserEnabled,
            };
          },
          addToInbox: (created) => setterRef.current?.((prev) => addBridgeCreatedTasks(prev, created)),
        });
      } catch (e) {
        console.warn('[Obsidian] add-task pass failed (retried next pass):', e);
      }
      if (result?.applied && followUpMs != null && !st.disposed && !st.followUp) {
        st.followUp = setTimeout(() => { st.followUp = null; void consumeBridgeTaskCreates(); }, followUpMs);
      }
      return result;
    })();
    try {
      return await st.inFlight;
    } finally {
      st.inFlight = null;
      if (st.again && !st.disposed) { st.again = false; void consumeBridgeTaskCreates(); }
    }
  }, [isTrayMode, followUpMs]);

  const nudgeBridgeTaskCreates = useCallback(() => {
    const st = runRef.current;
    if (st.disposed || isTrayMode || !dataLoaded || st.nudge) return;
    const wait = Math.max(0, st.lastNudgeAt + NUDGE_MIN_GAP_MS - Date.now());
    st.nudge = setTimeout(() => {
      st.nudge = null;
      st.lastNudgeAt = Date.now();
      void consumeBridgeTaskCreates();
    }, wait);
  }, [consumeBridgeTaskCreates, dataLoaded, isTrayMode]);

  useEffect(() => {
    if (isTrayMode || !dataLoaded) return undefined;
    const st = runRef.current;
    st.disposed = false;
    void consumeBridgeTaskCreates();
    const poll = setInterval(() => { void consumeBridgeTaskCreates(); }, BRIDGE_CREATES_POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') void consumeBridgeTaskCreates(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      st.disposed = true;
      clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
      if (st.followUp) { clearTimeout(st.followUp); st.followUp = null; }
      if (st.nudge) { clearTimeout(st.nudge); st.nudge = null; }
    };
  }, [dataLoaded, isTrayMode, consumeBridgeTaskCreates]);

  return { consumeBridgeTaskCreates, nudgeBridgeTaskCreates };
}
