import { useCallback, useEffect, useRef, useState } from 'react';
import { runSnapshotFileCycle } from '../sync/snapshotFileSync.js';
import { mergeSyncData } from '../mergeSync.js';
import { stripHealthSourcedLogs } from '../utils/healthLogFilter.js';
import { decryptData, encryptData, isEncryptedEnvelope, hasEncryptionReady, getSyncPassphrase, initSessionKey } from '../utils/crypto.js';
import { getDeviceId } from '../sync/deviceId.js';

/**
 * Schedules snapshot-file sync (sync/snapshotFileSync.js) for one transport.
 *
 * One instance per transport: iCloud today (sync/icloudSnapshotTransport.js),
 * Direct Access next (docs/direct-access-sync.md). The hook owns what needs
 * React — the poll, the foreground and change-event kicks, the first-run
 * prompt state — and the guards that must be synchronous:
 *
 *   • `cloudSyncInProgressRef` is the file-transport mutex. It is shared
 *     across instances so two snapshot transports never merge into state at
 *     once; the WebDAV engine has its own lock and is NOT gated on this one,
 *     so a WebDAV retry loop (a persistent 412) can never block iCloud.
 *   • `startedAtRef` records when the mutex was taken, so a foreground resume
 *     can tell a live cycle from one iOS stranded by suspending the app
 *     mid-sync (App.jsx clearStrandedSyncGuards releases a stale lock).
 *   • `pendingRef` is raised when a cycle is skipped under the lock, and the
 *     skipped instance retries on its own two seconds later. Two instances
 *     poll on the same cadence from timers started in the same render, so
 *     without the retry the second one's tick found the lock held by the
 *     first's read on EVERY tick: on a Mac running iCloud and Direct Access
 *     together, Direct Access wrote once at the pick and never again
 *     (2026-10-05). A retry that finds the lock still held does not chain;
 *     the next poll tick is the next attempt, so a lock stranded by iOS
 *     suspending the app mid-cycle cannot spin this.
 *   • the first-run prompt gates the loop through a ref, because state lands a
 *     render too late to stop the next poll tick, and merging then is exactly
 *     the silent restore the prompt exists to offer a way out of.
 *
 * `io` is read through a latest-value ref, so the callbacks App passes may
 * close over state freely; `buildSyncPayload`/`applyEngineData` should still be
 * thunks when they are declared later in the component than the hook call.
 *
 * @param {object} args
 * @param {object}  args.transport           see sync/snapshotFileSync.js and icloudSnapshotTransport.js
 * @param {boolean} args.active              false in the tray popup, which never syncs
 * @param {boolean} args.dataLoaded
 * @param {{current: boolean}} args.cloudSyncInProgressRef
 * @param {{current: boolean}} [args.pendingRef]
 * @param {{current: number}}  [args.startedAtRef]
 * @param {object}  args.io
 * @param {() => object} args.io.buildSyncPayload
 * @param {(data: object, opts: object) => void} args.io.applyEngineData
 * @param {() => string|null} [args.io.lastLocalEditAt]  when this device itself last changed its data
 * @param {Array}   args.io.habits
 * @param {number}  args.io.syncRetentionDays
 * @param {() => boolean} [args.io.isResetInProgress]
 * @param {(error: string) => void} [args.io.onUnavailable]  transport reported an error object
 * @param {() => void} [args.io.onEncryptedUnreadable]  the file is encrypted, this device cannot read it, and the transport forbids writing over it
 * @param {() => void} [args.io.onKeyNeeded]  the file is an envelope, or the device wants to write one, and no key or passphrase is in memory, and the cached key could not be restored: prompt
 * @param {() => Promise<boolean>} [args.io.restoreKey]  loads the file-tier key this device cached (default: crypto initSessionKey); tried once per session before any prompt
 * @param {() => number} [args.io.now]
 * @returns {{
 *   runSync: () => Promise<void>,
 *   firstRun: null | {taskCount: number, inboxCount: number, lastModified: string|null},
 *   acceptFirstRun: () => void,
 *   declineFirstRun: () => void,
 * }}
 */
/** How long a cycle skipped under the shared mutex waits before its one retry. */
export const SKIPPED_RETRY_MS = 2000;

export default function useSnapshotFileSync({
  transport, active, dataLoaded,
  cloudSyncInProgressRef, pendingRef, startedAtRef,
  io,
}) {
  const enabled = !!active && transport.isSupported();

  const ioRef = useRef(io);
  ioRef.current = io;
  const dataLoadedRef = useRef(dataLoaded);
  dataLoadedRef.current = dataLoaded;

  const internalPendingRef = useRef(false);
  const internalStartedAtRef = useRef(0);
  const pending = pendingRef ?? internalPendingRef;
  const startedAt = startedAtRef ?? internalStartedAtRef;
  // The one-shot retry armed by a cycle skipped under the mutex.
  const retryRef = useRef(null);

  // Carried between cycles: the eviction clock and the write throttle stamp.
  const cycleStateRef = useRef({ missingSince: 0, lastWriteAt: 0 });
  // The cached key is tried once per session before the passphrase is ever
  // asked for. The launch gate (hooks/useCloudSync.js) restores the file-tier
  // key only for the transports it knows need it (WebDAV encryption, this
  // device's own encrypt switch); a device whose folder holds an envelope
  // another device sealed has the key cached from its first unlock and
  // nothing else to say so, and was asked again on every launch (2026-10-10).
  const keyRestoreTriedRef = useRef(false);
  // Ref gates the loop synchronously; state drives the modal.
  const firstRunPendingRef = useRef(false);
  const [firstRun, setFirstRun] = useState(null);

  const runCycle = async (isRetry = false) => {
    if (!enabled) return;
    if (!dataLoadedRef.current) return;
    // A reset in flight has already deleted the snapshot (scope 'everywhere')
    // or deliberately left it alone (scope 'device'). React state still holds
    // the pre-reset data, so seeding or merging now would write every task
    // straight back. Cleared by the reload.
    if (ioRef.current.isResetInProgress?.()) return;
    // Switched off on this device: fully inert, nothing read is applied and
    // nothing is written, so the remote copy and other devices are untouched.
    if (!transport.isEnabled()) return;
    if (firstRunPendingRef.current) return;
    if (cloudSyncInProgressRef.current) {
      // The other snapshot transport (or this one, kicked twice) holds the
      // lock. Come back once, shortly: a cycle is local file I/O and is over
      // in milliseconds, so the retry almost always runs. A retry that still
      // finds the lock leaves it to the next poll tick rather than chaining.
      pending.current = true;
      if (!isRetry && retryRef.current === null) {
        retryRef.current = setTimeout(() => {
          retryRef.current = null;
          runCycleRef.current(true);
        }, SKIPPED_RETRY_MS);
      }
      return;
    }
    if (!transport.isAvailable()) return;

    pending.current = false;
    cloudSyncInProgressRef.current = true;
    startedAt.current = Date.now();
    // A key is wanted and none is in memory: load the cached one before
    // asking, and if it was there, run again at once with it.
    const keyWanted = async () => {
      if (keyRestoreTriedRef.current) return false;
      keyRestoreTriedRef.current = true;
      try { return !!(await (ioRef.current.restoreKey ?? initSessionKey)()); }
      catch { return false; }
    };
    let rerunWithKey = false;
    try {
      const { state, outcome } = await runSnapshotFileCycle({
        transport,
        io: {
          buildSyncPayload: ioRef.current.buildSyncPayload,
          applyEngineData: ioRef.current.applyEngineData,
          lastLocalEditAt: ioRef.current.lastLocalEditAt,
          deviceId: ioRef.current.deviceId ?? getDeviceId,
          habits: ioRef.current.habits,
          syncRetentionDays: ioRef.current.syncRetentionDays,
          mergeSyncData,
          stripHealthSourcedLogs,
          isEncryptedEnvelope,
          decryptData,
          encryptData,
          // encryptData derives the key lazily from a passphrase in memory.
          encryptionReady: () => hasEncryptionReady() || !!getSyncPassphrase(),
          storage: localStorage,
          now: ioRef.current.now,
        },
        state: cycleStateRef.current,
      });
      cycleStateRef.current = state;
      if (outcome.kind === 'prompted') {
        firstRunPendingRef.current = true;
        setFirstRun(outcome.info);
      } else if (outcome.kind === 'error') {
        console.error(`[${transport.id}] unavailable:`, outcome.error);
        ioRef.current.onUnavailable?.(outcome.error);
      } else if (outcome.kind === 'skipped' && outcome.reason === 'encrypted-unreadable') {
        // Nothing was written over the file we cannot read; the user has to
        // know, because nothing else will happen until they act. With no key
        // in memory at all, acting means the cached key first, then the
        // passphrase.
        if (!outcome.needsKey) ioRef.current.onEncryptedUnreadable?.();
        else if (await keyWanted()) rerunWithKey = true;
        else ioRef.current.onKeyNeeded?.();
      } else if ((outcome.kind === 'skipped' && outcome.reason === 'key-needed') || outcome.keyNeeded) {
        if (await keyWanted()) rerunWithKey = true;
        else ioRef.current.onKeyNeeded?.();
      }
    } catch (err) {
      // A transport that throws (rather than returning an error object) must
      // not surface as an unhandled rejection from a timer; the next poll
      // retries exactly as it does for a skipped cycle.
      console.error(`[${transport.id}] sync cycle failed:`, err?.message ?? err);
    } finally {
      cloudSyncInProgressRef.current = false;
    }
    if (rerunWithKey) await runCycleRef.current();
  };

  // Stable entry point: timers and the foreground listeners in App.jsx call
  // through it and always reach the latest closure.
  const runCycleRef = useRef(runCycle);
  runCycleRef.current = runCycle;
  const runSync = useCallback(() => runCycleRef.current(), []);

  // Both choices record a decision so the prompt never returns; recording
  // `true` on the restore path is what marks it answered.
  const acceptFirstRun = useCallback(() => {
    transport.setEnabled(true);
    setFirstRun(null);
    firstRunPendingRef.current = false;
    // Run now rather than waiting up to a poll interval.
    runCycleRef.current();
  }, [transport]);

  const declineFirstRun = useCallback(() => {
    transport.setEnabled(false);
    setFirstRun(null);
    firstRunPendingRef.current = false;
    // Nothing else to do: the isEnabled gate now returns early, so the remote
    // copy is never read or written from this device. Reversible in Settings.
  }, [transport]);

  // Once on startup, after data is loaded.
  useEffect(() => {
    if (!enabled || !dataLoaded) return;
    runSync();
  }, [enabled, dataLoaded, runSync]);

  // Poll. The daemon handles the network; we read and write the local file.
  // The cadence keeps changes prompt even when the real-time watchers don't
  // fire, which is common for daemon-managed files.
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(runSync, transport.pollMs);
    return () => clearInterval(timer);
  }, [enabled, transport, runSync]);

  // Re-sync when the window comes back to the foreground, where the transport
  // asks for it (desktop; iOS routes its foreground event through App.jsx).
  useEffect(() => {
    if (!enabled || !transport.kicksOnVisibility?.()) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') runSync();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, transport, runSync]);

  // Push signal from the native side (the file changed under us). A cycle
  // already running makes this a skip, and the skip's own retry picks the
  // change up two seconds later.
  useEffect(() => {
    if (!enabled || !transport.onChanged) return;
    return transport.onChanged(runSync);
  }, [enabled, transport, runSync]);

  // A retry armed just before unmount must not run against a dead instance.
  useEffect(() => {
    if (!enabled) return;
    return () => {
      if (retryRef.current !== null) clearTimeout(retryRef.current);
      retryRef.current = null;
    };
  }, [enabled]);

  return { runSync, firstRun, acceptFirstRun, declineFirstRun };
}
