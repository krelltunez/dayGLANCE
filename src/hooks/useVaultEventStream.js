// React lifecycle wrapper for the GLANCEvault SSE push client.
//
// Opens the authenticated /events stream when the vault is enabled AND the app is
// active, turns nudges into instant drains of the EXISTING sync/intents drains
// (debounced), reconnects with backoff on any drop, reconciles via the initial
// {seq, kind:'connected'} on (re)connect, and tears the connection down cleanly
// on background / unmount / vault-disabled. The pure transport lives in
// ../sync/vaultEventStream.js; this file only wires it to React + the app.
//
// CORE INVARIANT: this is purely ADDITIVE. It never starts, stops, or slows the
// existing poll cadences (the DB sync 5-min interval + focus in App.jsx, and the
// DB intents 2-min interval + focus in useDbIntentPoller). Those keep running as
// the correctness backstop, so a missed nudge or an SSE-down window is always
// caught by the next poll. If SSE is unavailable (native/electron/none) or throws,
// the app degrades to exactly today's polling behavior.

import { useEffect, useRef } from 'react';
import { isVaultEnabled, getVaultConfig } from '../sync/vaultConfig.js';
import {
  createNudgeCoalescer,
  createVaultEventClient,
  detectSseTransport,
  openWebSseStream,
} from '../sync/vaultEventStream.js';

const isTrayMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('tray');

/**
 * @param {object} p
 * @param {boolean}  p.dataLoaded    gate: don't connect before initial load
 * @param {() => (void|Promise<any>)} p.drainSync     triggers the EXISTING vault sync drain (dbSyncCycle)
 * @param {() => (void|Promise<any>)} p.drainIntents  triggers the EXISTING vault intents drain (drainDbIntents)
 */
export function useVaultEventStream({ dataLoaded, drainSync, drainIntents }) {
  // Keep the drain callbacks fresh without re-running the effect (which would tear
  // down and re-open the connection on every render).
  const drainSyncRef = useRef(drainSync);
  drainSyncRef.current = drainSync;
  const drainIntentsRef = useRef(drainIntents);
  drainIntentsRef.current = drainIntents;

  useEffect(() => {
    if (isTrayMode || !dataLoaded || !isVaultEnabled()) return undefined;

    const transport = detectSseTransport();
    if (transport !== 'web') {
      // Native WebView / SSR: the vault HTTP path is fully buffered and cannot
      // stream frames, so SSE is unavailable — degrade cleanly to polling (which
      // is already running). Nothing to open, nothing to clean up. (Electron is
      // NOT here — it reports 'web' and streams directly from the app:// origin.)
      if (import.meta.env?.DEV) {
        console.info('[vault-sse] streaming unavailable on', transport, '— polling backstop only');
      }
      return undefined;
    }

    const coalescer = createNudgeCoalescer({
      onDrain: (kind) => {
        if (kind === 'sync') drainSyncRef.current?.();
        else if (kind === 'intents') drainIntentsRef.current?.();
      },
      onDrainError: (msg, err) => console.warn('[vault-sse]', msg, err?.message || err),
    });

    const client = createVaultEventClient({
      supported: true,
      getConnection: () => {
        const c = getVaultConfig();
        return c && c.vaultUrl && c.vaultToken && c.accountId
          ? { vaultUrl: c.vaultUrl, vaultToken: c.vaultToken, accountId: c.accountId }
          : null;
      },
      openStream: openWebSseStream,
      onEvent: coalescer.handleEvent,
      onStateChange: (state) => {
        if (import.meta.env?.DEV) console.debug('[vault-sse]', state);
      },
    });

    // Drop SSE on background, reopen on foreground. The (re)connect delivers a
    // fresh {seq, kind:'connected'} that reconciles anything missed while hidden;
    // polling/foreground-drain covers the gap regardless.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') client.start();
      else client.stop();
    };
    document.addEventListener('visibilitychange', onVisibility);

    if (document.visibilityState !== 'hidden') client.start();

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      client.stop();
      coalescer.cancel();
    };
    // Keyed on dataLoaded only: a vault enable/disable reloads the app (see
    // CloudSyncSettingsForm), so the isVaultEnabled() read at mount stays current,
    // mirroring the DB sync engine effect in App.jsx.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataLoaded]);
}
