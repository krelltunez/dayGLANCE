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
  createBridgeSseClient,
  detectSseTransport,
  openWebSseStream,
} from '../sync/vaultEventStream.js';

// The global the native shell invokes to push SSE messages into the renderer
// (see the BRIDGE CONTRACT in vaultEventStream.js). Kept as a named constant so
// the Android/iOS shells and this file can't drift.
const NATIVE_SSE_RECEIVE = '__glanceVaultSseReceive';

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
    if (transport !== 'web' && transport !== 'native-bridge') {
      // 'native-unsupported' (older native shell) / 'none' (SSR): the vault HTTP
      // path is fully buffered / absent and cannot stream frames, so SSE is
      // unavailable — degrade cleanly to polling (already running). Nothing to
      // open, nothing to clean up. (Electron is NOT here — it reports 'web' and
      // streams directly from the app:// origin.)
      if (import.meta.env?.DEV) {
        console.info('[vault-sse] streaming unavailable on', transport, '— polling backstop only');
      }
      return undefined;
    }

    // Observability: a live, inspectable snapshot so SSE health can be checked in
    // a packaged/MAS/native build with no devtools — run `window.__glanceVaultSse`
    // in the console (or read it from a diagnostics panel). Counters make a
    // reconnect STORM (many connects, few events) immediately obvious. Logging is
    // always-on (not DEV-gated) but low-volume: one line per lifecycle transition,
    // not per heartbeat.
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
      // Debounce-only (no throttle). The self-nudge loop is fixed at the root — a
      // no-content sync cycle no longer pushes/nudges (utils/tombstoneHorizon.js) —
      // so drains fire near-instantly on real changes, restoring SSE's low latency.
      onDrain: (kind) => {
        diag.drains += 1;
        console.info('[vault-sse] drain →', kind);
        if (kind === 'sync') drainSyncRef.current?.();
        else if (kind === 'intents') drainIntentsRef.current?.();
      },
      onDrainError: (msg, err) => console.warn('[vault-sse]', msg, err?.message || err),
    });

    // The frame → coalescer funnel is identical for both transports; only the
    // socket owner differs (JS fetch loop vs native shell).
    const onEvent = (evt) => {
      diag.events += 1;
      if (evt && typeof evt.seq === 'number') { diag.lastEventSeq = evt.seq; diag.lastEventKind = evt.kind; }
      coalescer.handleEvent(evt);
    };
    const onStateChange = (state, detail) => {
      diag.state = state;
      if (state === 'connecting') diag.connects += 1;
      if (state === 'open') diag.lastConnectedAt = new Date().toISOString();
      if (state === 'error') { diag.lastError = detail?.message || String(detail || 'error'); console.warn('[vault-sse] error:', diag.lastError); }
      else console.info('[vault-sse]', state, `(connects=${diag.connects} events=${diag.events} drains=${diag.drains})`);
    };
    const getConnection = () => {
      const c = getVaultConfig();
      return c && c.vaultUrl && c.vaultToken && c.accountId
        ? { vaultUrl: c.vaultUrl, vaultToken: c.vaultToken, accountId: c.accountId }
        : null;
    };

    // ── NATIVE-BRIDGE: the native shell owns the socket + reconnect + fg/bg ──────
    if (transport === 'native-bridge') {
      const bridge = window.DayGlanceNative;
      const client = createBridgeSseClient({
        getConnection,
        // JS → native: hand over the connection and say "SSE desired on".
        startNative: (c) => bridge.startVaultSse(c.vaultUrl, c.vaultToken, c.accountId),
        stopNative: () => bridge.stopVaultSse?.(),
        onEvent,
        onStateChange,
      });
      // native → JS push target. The shell calls window.__glanceVaultSseReceive(msg)
      // per the bridge contract; route it into the client.
      window[NATIVE_SSE_RECEIVE] = client.receive;
      // No visibilitychange wiring here: the native shell owns foreground/background
      // (Activity lifecycle) and reconnect. The renderer only declares intent (on)
      // and hands over the connection; native connects when it's actually visible.
      client.start();

      return () => {
        client.stop();
        if (window[NATIVE_SSE_RECEIVE] === client.receive) delete window[NATIVE_SSE_RECEIVE];
        coalescer.cancel();
      };
    }

    // ── WEB / ELECTRON: JS owns the fetch stream + reconnect/backoff ────────────
    const client = createVaultEventClient({
      supported: true,
      getConnection,
      openStream: openWebSseStream,
      onEvent,
      onStateChange,
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
