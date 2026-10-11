import { useEffect, useRef } from 'react';
import { directAccessTransport } from '../sync/directAccessTransport.js';
import { getDirectAccessIntentsEnabledFlag } from './directAccessIntentsConfig.js';
import { runEventSetCycle, receiveEnvelope, withEventsLock, retentionMsFrom } from './folderIntents.js';
import { INTENT_CONFIG_KEY } from './useIntentPoller.js';
import { isTrayMode } from '../utils/trayMode.js';
import { intentDrainAllowed } from './intentDrainGate.js';
import { getDeviceId } from '../sync/deviceId.js';

/**
 * Polls the Direct Access event set (intents/folderIntents.js) on the
 * snapshot cycle's cadence, handling new envelopes through handleIntent, and
 * carries this device's own events back into a copy of the file that lost
 * them. Mounted beside the WebDAV, iCloud and vault pollers with the same
 * context shape; inert unless the Direct Access intents opt-in is on and the
 * platform has the bridge. The opt-in is read at mount, and saving it
 * reloads the app, as the other intents switches do.
 *
 * Kicks: the poll, the window coming to the foreground, and the transport's
 * change signal (the file changed under us). A cycle already running makes a
 * kick a no-op; the next tick is the next attempt. The first cycle of a
 * session waits for the sync drain gate like the other pollers.
 */
export function useDirectAccessIntents(context, { transport = directAccessTransport } = {}) {
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    if (isTrayMode) return;
    if (!getDirectAccessIntentsEnabledFlag() || !transport.isSupported()) return;

    const config = (() => {
      try { const raw = localStorage.getItem(INTENT_CONFIG_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
    })();
    let destroyed = false;
    let running = false;
    let state = { lastWriteAt: 0, pendingWrite: null };

    const run = async () => {
      if (destroyed || running) return;
      if (!intentDrainAllowed()) return;
      if (!transport.isAvailable()) return;
      running = true;
      try {
        const r = await withEventsLock(() => runEventSetCycle({
          transport,
          io: {
            storage: localStorage,
            retentionMs: retentionMsFrom(localStorage),
            eventsPath: config?.eventsPath,
            deviceId: getDeviceId,
            receive: (raw) => receiveEnvelope(raw, contextRef.current),
          },
          state,
        }));
        state = r.state;
        if (r.outcome.kind === 'error') console.warn('[intent/direct-access] unavailable:', r.outcome.error);
      } catch (err) {
        console.warn('[intent/direct-access] cycle failed:', err?.message ?? err);
      } finally {
        running = false;
      }
    };

    const timer = setInterval(run, transport.pollMs);
    const onVisible = () => { if (!document.hidden) run(); };
    document.addEventListener('visibilitychange', onVisible);
    const unsubscribe = transport.onChanged?.(run) ?? null;
    run();

    return () => {
      destroyed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe?.();
    };
  }, [transport]);
}
