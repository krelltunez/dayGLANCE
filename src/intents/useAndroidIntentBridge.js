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

    // Expose an unconditional entry point for the native side to invoke directly
    // (from MainActivity's INTENT_RECEIVED forward receiver and onResume). This
    // must NOT be gated on document.visibilityState: the WebView is never paused
    // (webView.onPause() is intentionally skipped so the GPU surface stays live),
    // so its visibilityState stays 'visible' even while the app is backgrounded —
    // but we don't want to depend on that invariant to process background intents.
    window.__dayglanceCheckPendingIntent = checkPending;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkPending();
      }
    };

    // Check immediately on mount (app may have been opened via intent)
    checkPending();

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      if (window.__dayglanceCheckPendingIntent === checkPending) {
        delete window.__dayglanceCheckPendingIntent;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
