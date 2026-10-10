import { useCallback, useEffect, useRef } from 'react';
import { directAccessTransport } from '../sync/directAccessTransport.js';
import { sweepConflictCopies, SWEEP_INTERVAL_MS } from '../sync/conflictCopies.js';
import { mergeSyncData } from '../mergeSync.js';
import { decryptData, isEncryptedEnvelope } from '../utils/crypto.js';
import useDirectAccessStatus from './useDirectAccessStatus.js';

/**
 * Runs the conflict copy sweep (sync/conflictCopies.js) over the Direct
 * Access folder: once when the folder connects, then every SWEEP_INTERVAL_MS
 * while it is, and on demand (`sweepNow`, the diagnostics panel's button).
 * Inert without the bridge, while disconnected, while the device's own sync
 * switch is off, and in the tray. `io` is read through a ref so App's
 * callbacks may close over state.
 */
export default function useConflictCopySweep({ transport = directAccessTransport, active, dataLoaded, io }) {
  const status = useDirectAccessStatus(transport);
  const ioRef = useRef(io);
  ioRef.current = io;
  const runningRef = useRef(false);
  const enabled = !!active && transport.isSupported() && status.connected && status.enabled !== false && !!dataLoaded;

  const sweepNow = useCallback(async () => {
    if (runningRef.current || !transport.isSupported() || !transport.isAvailable()) return null;
    runningRef.current = true;
    try {
      return await sweepConflictCopies({
        transport,
        io: { ...ioRef.current, mergeSyncData, isEncryptedEnvelope, decryptData, storage: localStorage },
      });
    } catch (err) {
      console.warn('[direct-access] conflict sweep failed:', err?.message ?? err);
      return null;
    } finally {
      runningRef.current = false;
    }
  }, [transport]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(sweepNow, SWEEP_INTERVAL_MS);
    // Let the first cycle apply the live file before the copies are looked at.
    const first = setTimeout(sweepNow, 30 * 1000);
    return () => { clearInterval(timer); clearTimeout(first); };
  }, [enabled, sweepNow]);

  return { sweepNow };
}
