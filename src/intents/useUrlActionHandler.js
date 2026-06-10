import { useEffect, useRef } from 'react';
import { ACTIONS } from '@glance-apps/intents';
import { handleIntent } from './handleIntent.js';

/**
 * Returns a user-friendly success message for a completed intent action.
 *
 * @param {string} action  The action that was handled (e.g. "app.dayglance.CREATE")
 * @param {object} result  The handleIntent result object
 * @returns {string}
 */
function intentSuccessMessage(action, result) {
  switch (action) {
    case ACTIONS.CREATE: {
      const suffix = result.task_id ? `: ${result.task_id.slice(0, 8)}…` : '';
      return `Task created${suffix}`;
    }
    case ACTIONS.COMPLETE: {
      const warning = result.warning ? ` (${result.warning})` : '';
      return `Task completed${warning}`;
    }
    case ACTIONS.OPEN:
      return 'Opened';
    default:
      return 'Done';
  }
}

/**
 * Parses a query-param value string into a JS primitive when the value looks
 * like a number, boolean, or JSON object/array. Falls back to the raw string.
 */
function parseParamValue(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  // Only coerce to number when the round-trip is lossless. This prevents large integers
  // (e.g. source_entity_id="123456789012345678") from silently losing precision.
  const n = Number(value);
  if (value.trim() !== '' && !isNaN(n) && String(n) === value) return n;
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === 'object' || Array.isArray(parsed)) return parsed;
  } catch {
    // not JSON — fall through
  }
  return value;
}

/**
 * URL action handler hook.
 *
 * Runs once on mount. If a `?action=` query param is present it extracts the
 * remaining params as the payload, dispatches the intent through handleIntent,
 * and shows a toast with the outcome. Cleans up the URL afterwards so reloads
 * don't re-trigger the action.
 *
 * Special case: `action=query` shows a static toast instead of calling handleIntent
 * (per the locked decision that web query is no-op + UI).
 *
 * Note: on a cold start, tasks may not have loaded from persistence by the time this
 * effect fires. Actions that read task state (complete, query) may therefore see empty
 * lists. This is an inherent limitation of deep-linking into a not-yet-loaded app.
 *
 * @param {{ contextRef: React.RefObject<object>, setUndoToast: function }} param0
 */
export function useUrlActionHandler({ contextRef, setUndoToast }) {
  // Stable ref so the async run() always reads the latest context, including tasks that
  // loaded from persistence after the initial render.
  const setUndoToastRef = useRef(setUndoToast);
  setUndoToastRef.current = setUndoToast;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const action = params.get('action');
    if (!action) return;

    // Clean up the URL immediately so reloads don't re-trigger
    window.history.replaceState(null, '', window.location.pathname);

    // Build payload from remaining query params
    const payload = {};
    for (const [key, value] of params.entries()) {
      if (key === 'action') continue;
      payload[key] = parseParamValue(value);
    }

    if (action === 'query' || action === ACTIONS.QUERY) {
      // Web query is no-op + UI — just navigate to the glance tab and show a hint
      contextRef.current?.navigate?.('glance');
      setUndoToastRef.current?.({ message: 'Query: open dayGLANCE to see your task counts', actionable: false });
      return;
    }

    const run = async () => {
      let result;
      try {
        result = await handleIntent(action, payload, contextRef.current ?? {});
      } catch (err) {
        result = { success: false, error: err?.message ?? String(err) };
      }

      const message = result.success
        ? intentSuccessMessage(action, result)
        : `Intent error: ${result.error}`;

      setUndoToastRef.current?.({ message, actionable: false });
    };

    run();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
