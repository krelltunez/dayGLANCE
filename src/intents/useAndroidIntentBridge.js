import { useEffect, useRef } from 'react';
import { isNativeAndroid, nativeGetPendingIntent, nativeReportIntentResult } from '../native';
import { handleIntent } from './handleIntent.js';

/**
 * Android intent transport bridge.
 *
 * On mount and on every visibilitychange (when the document becomes visible),
 * checks for a pending intent stored by IntentReceiver or MainActivity.onNewIntent,
 * dispatches it through handleIntent, and reports the result back to native via
 * NativeBridge.reportIntentResult so Tasker/other apps can receive it as a
 * app.dayglance.RESULT broadcast.
 *
 * No-ops on non-Android platforms.
 *
 * @param {object} context  The handleIntent context (same shape as useIntentPoller's context).
 */
export function useAndroidIntentBridge(context) {
  // Keep a ref so the visibilitychange handler always sees the latest context
  // without needing to be re-registered every render.
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (!isNativeAndroid()) return;

    const checkPending = async () => {
      const intent = nativeGetPendingIntent();
      if (!intent) return;

      const { action, payload = {} } = intent;
      let result;
      try {
        result = await handleIntent(action, payload, contextRef.current);
      } catch (err) {
        result = { success: false, error: err?.message ?? String(err) };
      }

      console.log('[intent-bridge]', action, result);
      nativeReportIntentResult(action, JSON.stringify(result));
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkPending();
      }
    };

    // Check immediately on mount (app may have been opened via intent)
    checkPending();

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
