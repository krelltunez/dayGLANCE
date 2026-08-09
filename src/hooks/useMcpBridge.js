import { useEffect, useRef } from 'react';
import { isTrayMode } from '../utils/trayMode.js';
import { handleMcpRequest } from '../utils/mcpReadModel.js';
import { handleMcpWrite, isWriteMethod } from '../utils/mcpWriteModel.js';

// The renderer half of the MCP IPC channel (docs/mcp-server-spec.md §10
// Phase 2), following the useTrayPopupVisible precedent from PR #1302: this
// hook is a thin subscription and nothing else — every decision lives in the
// unit-tested pure module src/utils/mcpReadModel.js. Deliberately NOT in
// useElectronBridge.js, which has no test coverage (§11 risk register).
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
export default function useMcpBridge(state, setters) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const settersRef = useRef(setters);
  settersRef.current = setters;

  useEffect(() => {
    if (isTrayMode) return undefined;
    if (!window.electronAPI?.onMcpRequest) return undefined;
    return window.electronAPI.onMcpRequest((request) => {
      let response;
      try {
        // Writes route through the shared pure-mutation module (spec §3.1 r5)
        // and reply immediately after the setters are invoked: the mutation is
        // committed by React's batch in this same task, and the save pass
        // (useSaveOnChange → saveData → tray:data-changed) follows on the
        // commit. Reads stay synchronous against the current state ref.
        response = isWriteMethod(request?.method)
          ? handleMcpWrite(stateRef.current, settersRef.current ?? {}, request)
          : handleMcpRequest(stateRef.current, request);
      } catch (err) {
        // A throwing model must still answer — silence here would read as a
        // dead renderer and turn one bad request into "dayGLANCE unavailable".
        response = { ok: false, error: { code: 'internal', message: String(err?.message ?? err) } };
      }
      window.electronAPI.mcpRespond({ id: request?.id, ...response });
    });
  }, []);
}
