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

    // Observability: a live, inspectable snapshot so SSE health can be checked in
    // a packaged/MAS build with no devtools — run `window.__glanceVaultSse` in the
    // console (or read it from a diagnostics panel). Counters make a reconnect
    // STORM (many connects, few events) immediately obvious. Logging is always-on
    // (not DEV-gated) but low-volume: one line per lifecycle transition, not per
    // heartbeat.
    const diag = {
      state: 'idle',
      connects: 0,
      events: 0,
      drains: 0,
      lastEventSeq: null,
      lastEventKind: null,
      lastError: null,
      lastConnectedAt: null,
      transport,
    };
    if (typeof window !== 'undefined') window.__glanceVaultSse = diag;

    const coalescer = createNudgeCoalescer({
      // THROTTLE: never drain more than once every 5s, no matter how fast nudges
      // arrive. A nudge for our OWN write echoes back from the server, and if a
      // drain pushes again (or a backlog of intents keeps landing) that would loop
      // and hammer the UI. The throttle caps it; polling remains the backstop and
      // an idle account still drains near-instantly (debounce only).
      minIntervalMs: 5000,
      onDrain: (kind) => {
        diag.drains += 1;
        console.info('[vault-sse] drain →', kind);
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
      onEvent: (evt) => {
        diag.events += 1;
        if (evt && typeof evt.seq === 'number') { diag.lastEventSeq = evt.seq; diag.lastEventKind = evt.kind; }
        coalescer.handleEvent(evt);
      },
      onStateChange: (state, detail) => {
        diag.state = state;
        if (state === 'connecting') diag.connects += 1;
        if (state === 'open') diag.lastConnectedAt = new Date().toISOString();
        if (state === 'error') { diag.lastError = detail?.message || String(detail || 'error'); console.warn('[vault-sse] error:', diag.lastError); }
        else console.info('[vault-sse]', state, `(connects=${diag.connects} events=${diag.events} drains=${diag.drains})`);
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
