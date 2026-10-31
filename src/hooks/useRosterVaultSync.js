// The household roster on GLANCEvault (sync/rosterVault.js): builds the engine
// once the vault is on and the data has loaded, runs it on the same cadence as
// the dayGLANCE vault tier (initial, focus, every five minutes; the SSE drain
// runs it through the returned ref), and pushes a local roster change after a
// short debounce. A changed roster from the vault lands through setUsers.

import { useEffect, useRef } from 'react';
import { isVaultEnabled } from '../sync/vaultConfig.js';
import { createRosterDbEngine, registerRosterEngine, scheduleRosterPush } from '../sync/rosterVault.js';

/**
 * @param {object} p
 * @param {boolean} p.active          false in the tray window
 * @param {boolean} p.dataLoaded
 * @param {object[]} p.users          re-read to push a local change
 * @param {boolean} p.multiUserEnabled
 * @param {(users: object[]) => void} p.setUsers
 * @param {{current: object|null}} [p.engineRef]
 * @param {Function} [p.createEngine] test seam
 */
export default function useRosterVaultSync({ active = true, dataLoaded, users, multiUserEnabled, setUsers, engineRef: givenRef, createEngine = createRosterDbEngine }) {
  const ownRef = useRef(null);
  const engineRef = givenRef ?? ownRef;
  const setUsersRef = useRef(setUsers);
  setUsersRef.current = setUsers;

  useEffect(() => {
    if (!active || !dataLoaded || !isVaultEnabled()) return;
    const engine = createEngine({
      onUsersApplied: (next) => setUsersRef.current?.(next),
      onError: (msg, code) => { if (msg) console.warn('[dayglance] roster vault sync error:', code || '', msg); },
      onUnsupported: () => console.warn('[dayglance] vault does not know glance-users yet; the roster syncs on the file roads only'),
    });
    if (!engine) return;
    engineRef.current = engine;
    registerRosterEngine(engine);
    const runCycle = () => engine.dbSyncCycle().catch(() => { /* surfaced via onError */ });
    runCycle();
    const onVisible = () => { if (document.visibilityState === 'visible') runCycle(); };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(runCycle, 5 * 60 * 1000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
      registerRosterEngine(null);
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, dataLoaded, createEngine]);

  // A member added, renamed or removed (or multi-user just turned on): the
  // cycle's diff decides what moves.
  useEffect(() => {
    if (dataLoaded) scheduleRosterPush();
  }, [users, multiUserEnabled, dataLoaded]);

  return engineRef;
}
