// The bridge transport — the plugin half of the Phase 6 intent stream
// (spec §3.6 as amended: semantic INBOUND intents applied to the vault,
// observational OUTBOUND reports of file state; wire format and the pure
// applier live in @glance-apps/obsidian-format's bridgeStream.js).
//
// DRAIN: pull intent rows above the persisted high-water mark, decrypt
// under the stored subkey, apply each through applyBridgeIntent (pure,
// idempotent), write only when the bytes changed, then persist the
// applied-ID set + HWM and delete the applied rows. IDEMPOTENT REPLAY IS
// THE CRASH STORY: dying between applying a batch and persisting the
// cursor replays the batch as no-ops. The applied-ID set, the HWM, and
// row deletion are three independent guards; any one suffices.
//
// data.json note: the bridge cursor state rides Obsidian's settings sync
// like everything else in data.json, so vault copies loosely share it —
// harmless in either direction, because application is idempotent and rows
// are deleted after first application.
//
// OBSERVE: report the latest state of files dayGLANCE cares about — daily
// notes (classified via the meta:config row dayGLANCE publishes) and any
// note carrying dayGLANCE task markers — as per-path upserted rows.
// Observations are debounced per path; a deletion is a flagged row. The
// plugin NEVER interprets an edit; inferring semantics is dayGLANCE's
// scan pipeline's job.

import { App, MarkdownView, Platform, TFile, normalizePath, requestUrl } from 'obsidian';
import {
  applyBridgeIntent,
  openBridgeEnvelope,
  sealBridgeEnvelope,
  encodePlainBridgeRow,
  observationEntityId,
  importBridgeSubkey,
  buildDateParser,
  parseDateFromFilename,
  stampUntaggedTaskLines,
  planStampInsertions,
  partitionStampPlan,
  settleStampPlan,
  bridgeConfigAllowsStamping,
  drainSseBuffer,
  createSseArming,
  createSseNudgeGate,
  sseBackoffMs,
  SSE_READ_TIMEOUT_MS,
  BRIDGE_VAULT_APP,
  BRIDGE_PAIRING_META_ID,
  BRIDGE_CONFIG_META_ID,
  BRIDGE_INTENT_PREFIX,
} from '@glance-apps/obsidian-format';
import { createVaultClient, type VaultClient } from '@glance-apps/sync/src/vaultClient.js';
import type { BridgePairing } from './pairing';

export interface BridgeState {
  appliedIds: string[];
  hwm: number;
  // The last meta:config row seen, persisted since the 2026-08-31 config-null
  // incident: this.config used to be MEMORY-ONLY, refreshed only when a drain
  // paged over the config row — but the row's seq sits below the persisted
  // cursor after the first sighting, so it is never re-listed, and any plugin
  // reload permanently orphaned the config. The dayGLANCE side's
  // once-per-value publish guard (then persisted too) never republished, so
  // the fleet ran config-null indefinitely — and config-null silently skipped
  // the ENTIRE normalize-then-observe block: stamping, the write rule, the
  // cursor gate, AND ruling 7's stamp/observe coupling. Fail-closed for
  // writes had become fail-open for reporting: unstamped mid-typing states
  // shipped at autosave cadence (the fragment factory). Persisting the config
  // beside the cursor it rides under is the structural fix; emitObservation
  // now also HOLDS daily-note reporting while config is null (fail closed on
  // the reporting side), making ruling 7's invariant unconditional.
  config?: BridgeConfigRow | null;
}

const APPLIED_IDS_CAP = 1000;
// (The stamp-deferral CAP that used to live here is deliberately GONE — it
// authorized a vault write into a note with a dirty editor buffer, which is
// how the 2026-08-31 truncation destroyed typed text. Deferral is now
// condition-based — buffer differs from disk — and uncapped; see the write
// rule in emitObservation.)
// Bound on the in-memory-only cursor advance (persist-on-intent-only rule in
// drain): once the unpersisted gap exceeds this many seq, the cursor is
// persisted anyway, capping how many non-intent rows a plugin reload can
// re-list. Large enough that a normal editing day never trips it.
const HWM_PERSIST_GAP = 500;
const OBSERVE_DEBOUNCE_MS = 2000;
// Retry cadence for a daily-note report held on config-null (fail closed —
// see emitObservation). Config arrives within one drain tick of load, so the
// hold usually resolves on the first retry; the timer is local, no network.
const CONFIG_HOLD_RETRY_MS = 15_000;
// 429 backoff (mirrors the dayGLANCE side's bridge brake): the server
// rate-limits per IP, a budget shared with every dayGLANCE device in the
// house — when it trips, retrying at full cadence keeps it tripped.
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 10 * 60_000;

const isRateLimitError = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { status?: number }).status === 429;

interface BridgeConfigRow {
  dailyNotesPath: string;
  dailyNotePattern: string;
  taskHeading: string;
  // The §3.9 block-id WRITE release, carried from dayGLANCE (see
  // publishBridgeConfig there). Gates normalize-then-observe: stamping
  // happens ONLY when this is exactly `true` — a missing config row, or a
  // row from a dayGLANCE build predating the field, means NO stamping.
  // Fail-closed on purpose: not stamping is recoverable (dayGLANCE's own
  // stamp-on-sight backstop still covers the line), stamping against the
  // user's setting is not.
  blockIdWrites?: boolean;
}

export interface BridgeHost {
  app: App;
  getPairing(): BridgePairing | undefined;
  getBridgeState(): BridgeState;
  saveBridgeState(state: BridgeState): Promise<void>;
}

// Same requestUrl-backed fetch shim as pairing.ts (CORS-free everywhere).
const obsidianFetch = async (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) => {
  const resp = await requestUrl({
    url,
    method: init.method ?? 'GET',
    headers: init.headers ?? {},
    body: init.body,
    throw: false,
  });
  return {
    ok: resp.status >= 200 && resp.status < 300,
    status: resp.status,
    json: async () => resp.json,
  };
};

/**
 * Publish (or clear) the plaintext meta:pairing row. PLAINTEXT is the
 * point: it carries the pairing salt that other dayGLANCE devices need
 * BEFORE they can derive the subkey — an HKDF salt is not a secret.
 */
export async function publishPairingMeta(pairing: BridgePairing | null, previous?: BridgePairing): Promise<void> {
  const creds = pairing ?? previous;
  if (!creds) return;
  const client = createVaultClient({
    vaultUrl: creds.vaultUrl, vaultToken: creds.deviceToken, fetchImpl: obsidianFetch,
  });
  if (pairing) {
    await client.batch(BRIDGE_VAULT_APP, {
      accountId: pairing.accountId,
      rows: [{
        entityId: BRIDGE_PAIRING_META_ID,
        // Wire-encoded (base64), NOT encrypted — the server stores envelope
        // bytes; see the format package's wire note.
        envelope: encodePlainBridgeRow({
          v: 1, kind: 'pairing-meta',
          generation: pairing.generation, pairingSalt: pairing.pairingSalt, pairedAt: pairing.pairedAt,
        }),
        createdAt: Date.now(),
      }],
    });
  } else {
    await client.deleteRow(BRIDGE_VAULT_APP, BRIDGE_PAIRING_META_ID, creds.accountId);
  }
}

export class BridgeTransport {
  private host: BridgeHost;
  // THE UNLOAD LATCH (audit fix C2). Obsidian's onunload is not a process
  // exit — the plugin object dies but its closures live on: an in-flight
  // drain finishes AFTER shutdown() and used to re-arm SSE via its success
  // tail (a ghost socket applying intents and writing the OLD instance's
  // data.json over the new one's cursor state after an update), and the
  // observation timers — debounce, config-hold, failure backoff, some
  // self-re-arming — kept reading and WRITING the vault indefinitely after
  // the plugin was disabled. During a plugin update that meant two stampers
  // racing on one vault. `disposed` latches every entry point: new work
  // refuses, in-flight drains stop at the next row and skip their persist
  // and SSE re-arm, and shutdown() clears every pending timer.
  private disposed = false;
  private subkey: CryptoKey | null = null;
  private subkeyGeneration: string | null = null;
  private draining = false;
  // Seeded from persisted BridgeState in the constructor (see the field's
  // comment on BridgeState); refreshed by drains; recovered by a single-row
  // GET when null (see drain). null = fail closed: no stamping AND no
  // daily-note reporting.
  private config: BridgeConfigRow | null = null;
  // One getRow attempt per pairing generation while config is null; reset on
  // failure so the next drain retries.
  private configFetchedGeneration: string | null = null;
  // One loud console line per load for the held-reporting state — the hold
  // itself re-arms silently per path.
  private warnedConfigHold = false;
  private observeTimers = new Map<string, number>();
  // Settle-rule state (§3.10 seventh lesson — the cross-device arm of
  // premature identity assignment): per path, the untagged lines awaiting a
  // byte-identical re-observation ≥ STAMP_SETTLE_FLOOR_MS after first
  // sight, as line-content → firstSeenMs. MEMORY-ONLY by design (nothing
  // rides data.json; a reload restarts in-flight holds — conservative) and
  // pruned every settle pass to lines still in the stamp plan, so it is
  // bounded by each note's untagged-line count. Consulted only in the
  // RECEIVING posture (note closed or unfocused); the authoring posture's
  // cursor gate never touches it.
  private stampSettle = new Map<string, Map<string, number>>();
  private warnedUnsupported = false;
  // Once per plugin load (per generation), the drain re-asserts the
  // meta:pairing row. Normally a no-op overwrite; it is also the self-heal
  // for a row an older build wrote in the pre-base64 wire format (stored
  // as garbage) — without it, dayGLANCE devices could never discover the
  // pairing until the user re-paired.
  private metaAssertedGeneration: string | null = null;
  private backoffMs = 0;
  private backoffUntil = 0;
  // Per-path consecutive observation-failure counts, for the retry backoff
  // below. Reset on the path's first successful report.
  private observeRetryAttempts = new Map<string, number>();
  // In-memory cursor for the persist-on-intent-only rule (see drain): pages
  // that only skipped config/observation/tombstone rows advance the cursor
  // HERE, not in data.json — every data.json save is a vault file write that
  // Obsidian Sync must ship (the ~30s "Download cancelled because file was
  // changed locally" churn of 2026-08-30 was exactly this). Keyed to the
  // pairing generation because a re-pair resets the persisted state to
  // hwm 0 behind our back (main.ts storePairing) and a stale memory cursor
  // would silently skip the new stream's rows.
  private memHwm = 0;
  private memHwmGeneration: string | null = null;

  // ── LIVE SYNC (Phase 7) — desktop SSE, replacing "wait out the 30s timer"
  // for the intent-apply leg. THE INVARIANT: **SSE IS ARMED BY PROOF AND
  // DISARMED BY REFUTATION — the stream opens only after a successful
  // authenticated drain, closes on auth failure or a vanished pairing, and
  // makes ZERO reconnect attempts in between. A de-paired plugin burns
  // nothing.** Between refutation and the next proof, the 30-second drain
  // timer is the only thing running (today's exact polling posture), and
  // the first drain that succeeds re-arms the stream — so a dead
  // credential's total cost is one failed drain per tick, the same benign
  // failure mode polling always had. Built for an observed failure, not a
  // hypothetical: Obsidian Sync's plugin-settings toggle flipped off on one
  // device (2026-08-31) and silently stripped the pairing out of data.json.
  //
  // All DECISIONS are pure and pinned in @glance-apps/obsidian-format's
  // bridgeSse.js (arm/disarm machine, own-ack skip, debounce/cursor gate,
  // backoff schedule, frame parsers — the same parsers dayGLANCE's stream
  // uses). This class holds only the wiring: the Node https plumbing and
  // the connection lifecycle.
  private sseArming = createSseArming();
  private sseGate = createSseNudgeGate({ onDrain: () => this.drainFromNudge() });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sseReq: any = null; // in-flight Node http(s) request, when connected/connecting
  private sseReconnectTimer: number | null = null;
  private sseReadTimer: number | null = null;
  private sseFailures = 0;
  // A nudge that lands while a drain is in flight must RE-RUN after it —
  // the `draining` guard silently drops overlapping calls, and a dropped
  // nudge strands the burst's tail until the 30s timer (the exact hazard
  // dayGLANCE's #1494 fixed on its side with the same flag).
  private pendingRedrain = false;

  private rateLimited(): boolean {
    return Date.now() < this.backoffUntil;
  }

  private noteRateLimit(): void {
    // One arming per burst (matches the dayGLANCE side): concurrent 429s
    // don't compound; failing again after a brake lifted is what escalates.
    if (this.rateLimited()) return;
    this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : BACKOFF_BASE_MS, BACKOFF_MAX_MS);
    this.backoffUntil = Date.now() + this.backoffMs;
    console.info(`dayGLANCE bridge: rate-limited (429) — pausing bridge requests for ~${Math.round(this.backoffMs / 1000)}s.`);
  }

  // DECAY, never amnesty — the live lesson of 2026-08-30. The first shape
  // zeroed the escalation on ANY success, and successes were silent. On a
  // per-IP budget saturated by OTHER traffic, an occasional cheap request
  // slips into a fresh limiter window and succeeds; each lucky 200 then
  // wiped the whole 30→480s escalation, so the observed log read
  // "escalates, forgets, starts over at 30s" — never settling at the
  // ceiling while the storm lasted. Now a success clears the GATE (the
  // window demonstrably has room) but only HALVES the memory, so the next
  // 429 re-arms at the storm's level; a genuine recovery drains the memory
  // to zero within a few quiet successes. Both transitions log, so the
  // interleaving that misled the first diagnosis is visible in the console.
  private noteSuccess(): void {
    this.backoffUntil = 0;
    if (this.backoffMs === 0) return;
    this.backoffMs = Math.floor(this.backoffMs / 2);
    if (this.backoffMs < BACKOFF_BASE_MS) {
      this.backoffMs = 0;
      console.info('dayGLANCE bridge: request succeeded — brake released.');
    } else {
      console.info(`dayGLANCE bridge: request succeeded — brake decaying (a new 429 would pause ~${Math.round(Math.min(this.backoffMs * 2, BACKOFF_MAX_MS) / 1000)}s).`);
    }
  }

  constructor(host: BridgeHost) {
    this.host = host;
    // Config survives plugin reloads via data.json (the 2026-08-31 fix): a
    // reloaded plugin resumes with the stamping decision it last knew instead
    // of silently reverting to config-null. Drains keep it fresh.
    const persisted = host.getBridgeState().config;
    if (persisted && typeof persisted === 'object') {
      this.config = persisted;
      console.info(`dayGLANCE bridge: config restored from settings — stamping ${this.stampingState()}.`);
    }
  }

  /** The normalize-then-observe arming tri-state, for the heartbeat and the
   *  console: 'armed' (config present, blockIdWrites true), 'off' (config
   *  present, writes gated off), 'no-config' (nothing known — daily-note
   *  reporting is HELD until a config row arrives). */
  stampingState(): 'armed' | 'off' | 'no-config' {
    if (this.config === null) return 'no-config';
    return bridgeConfigAllowsStamping(this.config) ? 'armed' : 'off';
  }

  /** Adopt a (freshly decrypted) config row: update memory, log arming
   *  transitions, persist beside the cursor when the VALUE changed (an
   *  identical republish costs no data.json write — Obsidian Sync churn). */
  private async adoptConfig(cfg: BridgeConfigRow): Promise<void> {
    if (this.disposed) return; // unload latch — never persist on a dead instance
    const before = this.stampingState();
    const changed = JSON.stringify(cfg) !== JSON.stringify(this.config);
    this.config = cfg;
    if (!changed) return;
    const after = this.stampingState();
    console.info(`dayGLANCE bridge: config ${before === 'no-config' ? 'received' : 'updated'} — stamping ${after}.`);
    try {
      const state = this.host.getBridgeState();
      await this.host.saveBridgeState({ ...state, config: cfg });
    } catch (e) {
      // Memory still holds the config; the next drain's persist site (or the
      // next config change) retries. Never let bookkeeping break a drain.
      console.error('dayGLANCE bridge: config persist failed', e);
    }
  }

  private client(pairing: BridgePairing): VaultClient {
    return createVaultClient({
      vaultUrl: pairing.vaultUrl, vaultToken: pairing.deviceToken, fetchImpl: obsidianFetch,
    });
  }

  // Best-effort intent-row cleanup, fire-and-forget by design (the applied-ID
  // set and the HWM each independently prevent re-application) — but never
  // SILENT: a swallowed 429 here is how the tombstone loop burned the budget
  // for hours with a quiet console. Rate limits arm the brake like any other
  // bridge request; other failures get one console line.
  private deleteIntentRow(client: VaultClient, entityId: string, accountId: string): void {
    void client.deleteRow(BRIDGE_VAULT_APP, entityId, accountId).then((res) => {
      // Own-ack capture (Phase 7): the soft-delete's resulting seq nudges
      // every SSE client, us included — record it so our own echo never
      // wakes an idle drain.
      const seq = Number((res as { seq?: unknown } | null)?.seq);
      if (Number.isFinite(seq)) this.sseGate.recordOwnSeq(seq);
    }).catch((e) => {
      if (isRateLimitError(e)) this.noteRateLimit();
      else console.error('dayGLANCE bridge: intent row cleanup failed', e);
    });
  }

  // ── LIVE SYNC lifecycle (Phase 7) — wiring only; decisions in bridgeSse.js

  private sseDesktop(): boolean {
    return Platform.isDesktopApp === true;
  }

  /** The nudge → drain route, with the rerun flag (see the field comment). */
  private drainFromNudge(): void {
    if (this.disposed) return;
    if (!this.host.getPairing()) {
      this.sseArming.noteUnpaired();
      this.stopSse();
      return;
    }
    if (this.draining) {
      this.pendingRedrain = true;
      return;
    }
    void this.drain();
  }

  /** Called after every successful drain — the PROOF site of the invariant. */
  private maybeStartSse(): void {
    // The unload latch, load-bearing HERE above all (audit fix C2): an
    // in-flight drain completing after shutdown() used to re-arm the stream
    // on the dead instance — a ghost socket, applying intents and fighting
    // the reloaded instance's data.json indefinitely.
    if (this.disposed) return;
    if (!this.sseArming.shouldConnect({ desktop: this.sseDesktop(), paired: !!this.host.getPairing() })) return;
    if (this.sseReq || this.sseReconnectTimer !== null) return;
    if (this.rateLimited()) return; // brake gates connects too; the next drain re-attempts
    this.connectSse();
  }

  /** Tear the stream down and cancel every pending SSE timer. Idempotent. */
  private stopSse(): void {
    if (this.sseReconnectTimer !== null) { window.clearTimeout(this.sseReconnectTimer); this.sseReconnectTimer = null; }
    this.clearSseReadTimer();
    this.sseGate.cancel();
    if (this.sseReq) {
      try { this.sseReq.destroy(); } catch { /* already dead */ }
      this.sseReq = null;
    }
    this.sseFailures = 0;
  }

  /** Plugin unload. Latches the instance dead (see the disposed field):
   *  after this, no timer fires work, no drain starts or resumes its side
   *  effects, and nothing persists to data.json. */
  shutdown(): void {
    this.disposed = true;
    this.stopSse();
    for (const timer of this.observeTimers.values()) window.clearTimeout(timer);
    this.observeTimers.clear();
  }

  private clearSseReadTimer(): void {
    if (this.sseReadTimer !== null) { window.clearTimeout(this.sseReadTimer); this.sseReadTimer = null; }
  }

  // ~60s with the server heartbeating every ~20s: three missed heartbeats
  // means the socket is dead even when TCP never said so — laptop sleep,
  // silent network loss on a weeks-open machine.
  private armSseReadTimeout(): void {
    this.clearSseReadTimer();
    this.sseReadTimer = window.setTimeout(() => {
      this.sseReadTimer = null;
      console.info('dayGLANCE bridge: live sync went quiet (3 missed heartbeats) — reconnecting.');
      this.failSse();
    }, SSE_READ_TIMEOUT_MS);
  }

  /** Non-auth failure path: reconnect with backoff — but ONLY while armed. */
  private failSse(): void {
    this.clearSseReadTimer();
    if (this.sseReq) {
      try { this.sseReq.destroy(); } catch { /* already dead */ }
      this.sseReq = null;
    }
    if (!this.sseArming.shouldConnect({ desktop: this.sseDesktop(), paired: !!this.host.getPairing() })) return;
    if (this.sseReconnectTimer !== null) return;
    this.sseFailures += 1;
    // 5s doubling to 60s (reset whenever a frame arrives); the 429 brake
    // extends it so a rate-limit storm pauses SSE with everything else.
    // Each reconnect is ONE request against the per-IP budget — a worst-case
    // flap costs 12/min at the floor, ~1/min at the cap.
    const brakeMs = Math.max(0, this.backoffUntil - Date.now());
    const delay = Math.max(sseBackoffMs(this.sseFailures), brakeMs);
    this.sseReconnectTimer = window.setTimeout(() => {
      this.sseReconnectTimer = null;
      this.connectSse();
    }, delay);
  }

  private connectSse(): void {
    const pairing = this.host.getPairing();
    if (!pairing) { this.sseArming.noteUnpaired(); return; }
    if (!this.sseDesktop() || this.sseReq) return;
    // NODE HTTP(S), DELIBERATELY — the one transport here that can stream:
    // Obsidian's requestUrl buffers whole responses, so it cannot carry SSE
    // (the same limitation that made the mobile shells grow native
    // readers), and plain fetch in the renderer enforces CORS, which would
    // make the stream work or not depending on the server's allowedOrigins
    // happening to include Obsidian's app:// origin. Node's http(s) module
    // has neither problem — and its availability (window.require, Electron
    // renderer only) is itself a structural desktop gate: mobile cannot
    // take this path even if the platform probe were somehow wrong.
    const nodeRequire = (window as unknown as { require?: (m: string) => unknown }).require;
    if (typeof nodeRequire !== 'function') return;
    let url: URL;
    try {
      url = new URL(`${pairing.vaultUrl.replace(/\/+$/, '')}/events?accountId=${encodeURIComponent(pairing.accountId)}`);
    } catch {
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mod: any;
    try {
      mod = nodeRequire(url.protocol === 'http:' ? 'http' : 'https');
    } catch {
      return;
    }
    let buffer = '';
    const req = mod.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${pairing.deviceToken}`, Accept: 'text/event-stream' },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }, (res: any) => {
      if (res.statusCode === 401 || res.statusCode === 403) {
        // REFUTATION: the credential is dead — stop outright, no backoff
        // retries against it. The 30s drain tick keeps running exactly as
        // in the polling era, and the first drain that SUCCEEDS re-proves
        // the credential and re-arms the stream. Total cost of a dead
        // credential: one failed drain per tick — polling's own benign
        // failure mode, preserved.
        console.info(`dayGLANCE bridge: live sync refused (${res.statusCode}) — paused until a sync succeeds.`);
        this.sseArming.noteAuthFailure();
        this.stopSse();
        return;
      }
      if (res.statusCode !== 200) {
        console.info(`dayGLANCE bridge: live sync connect failed (${res.statusCode}) — will retry.`);
        this.failSse();
        return;
      }
      this.armSseReadTimeout();
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        // Any received frame — heartbeat comment included — proves the
        // stream is alive: reset the failure count and the read timeout.
        this.sseFailures = 0;
        this.armSseReadTimeout();
        buffer = drainSseBuffer(buffer + chunk, (evt) => {
          // A pairing that vanished mid-connection (the data.json incident)
          // tears the stream down at the first event that would use it.
          if (!this.host.getPairing()) {
            this.sseArming.noteUnpaired();
            this.stopSse();
            return;
          }
          this.sseGate.handleEvent(evt as { seq?: number });
        });
      });
      res.on('end', () => this.failSse());
      res.on('error', () => this.failSse());
    });
    req.on('error', () => this.failSse());
    req.end();
    this.sseReq = req;
  }

  private async subkeyFor(pairing: BridgePairing): Promise<CryptoKey> {
    if (!this.subkey || this.subkeyGeneration !== pairing.generation) {
      this.subkey = await importBridgeSubkey(pairing.subkeyB64);
      this.subkeyGeneration = pairing.generation;
    }
    return this.subkey;
  }

  /** Pull and apply pending intents. Safe to call on any cadence. */
  async drain(): Promise<void> {
    if (this.disposed) return; // unload latch
    const pairing = this.host.getPairing();
    if (!pairing) {
      // REFUTATION: no pairing (unpaired, or the data.json incident) — the
      // stream must not outlive its credentials. Idempotent when no stream.
      this.sseArming.noteUnpaired();
      this.stopSse();
      return;
    }
    if (this.draining || this.rateLimited()) return;
    this.draining = true;
    try {
      const client = this.client(pairing);
      const subkey = await this.subkeyFor(pairing);
      if (this.metaAssertedGeneration !== pairing.generation) {
        await publishPairingMeta(pairing);
        this.metaAssertedGeneration = pairing.generation;
      }
      // CONFIG RECOVERY BY DIRECT READ (2026-08-31 config-null incident):
      // paging can never re-list a config row whose seq sits below the
      // cursor, so a plugin that lost its config (a pre-persistence install
      // upgrading, a data.json that never carried it) would wait forever for
      // a republish. One single-row GET per pairing generation while config
      // is null closes that unconditionally — after this, "config unknown"
      // can only mean a genuinely fresh pairing whose first drain (cursor 0)
      // is about to list the row anyway.
      if (this.config === null && this.configFetchedGeneration !== pairing.generation) {
        this.configFetchedGeneration = pairing.generation;
        try {
          const row = await client.getRow(BRIDGE_VAULT_APP, BRIDGE_CONFIG_META_ID, pairing.accountId) as
            { envelope?: string; deleted?: boolean } | null;
          if (row?.envelope && !row.deleted) {
            const cfg = await openBridgeEnvelope(subkey, row.envelope) as (BridgeConfigRow & { kind?: string }) | null;
            if (cfg?.kind === 'config') await this.adoptConfig(cfg);
          }
        } catch (e) {
          this.configFetchedGeneration = null; // retry on the next drain
          const status = (e as { status?: number } | null)?.status;
          if (status === 429 || status === 401 || status === 403) throw e; // brake / refutation, classified below
          console.error('dayGLANCE bridge: config fetch failed', e);
        }
      }
      const state = this.host.getBridgeState();
      const applied = new Set(state.appliedIds);
      if (this.memHwmGeneration !== pairing.generation) {
        this.memHwm = 0;
        this.memHwmGeneration = pairing.generation;
      }
      let since = Math.max(state.hwm, this.memHwm);
      // The hwm actually in data.json — advanced only when we persist, so
      // the gap-bound below measures real replay-on-reload exposure.
      let persistedHwm = state.hwm;
      let appliedDirty = false;
      // Lowest seq of an intent row this drain saw but did not consume
      // (deferred on a dirty buffer, or apply failed). The drain cursor is
      // clamped below it so the row stays listable — the retry mechanism.
      let retryFloor = Infinity;
      let hasMore = true;
      while (hasMore && !this.disposed) {
        const page = await client.list(BRIDGE_VAULT_APP, { accountId: pairing.accountId, since });
        hasMore = !!page.hasMore;
        const rows = (page.rows ?? []) as Array<{ entityId?: string; envelope?: string; seq?: number; deleted?: boolean }>;
        if (rows.length === 0) break;
        let batchMax = since;
        for (const row of rows) {
          const seq = Number(row.seq) || 0;
          if (seq > batchMax) batchMax = seq;
          if (row.deleted) {
            // TOMBSTONE — cursor movement only, NEVER a deleteRow. The server
            // re-tombstones on every delete: soft-deleting an already-deleted
            // row still assigns a FRESH seq and emits an SSE nudge, so
            // deleting a tombstone resurrects it above our own cursor. The
            // pre-fix drain did exactly that for every applied-intent
            // tombstone (the applied-ids branch below fired on them), which
            // built a silent perpetual loop: N tombstones re-deleted every
            // 30s drain, each bump nudging every SSE client and burning the
            // shared per-IP budget — the 2026-08-30 storm (~900 foreign seq
            // events on an idle account), invisible in this console because
            // the deletes were fire-and-forget. Skipping tombstones lets the
            // cursor advance past the whole backlog once, after which they
            // never re-seq and never return.
            //
            // PHASE 7 LEANS ON THIS RULE: the SSE loop-safety argument —
            // "a nudged drain's idle path performs no writes, so no cycle
            // can sustain itself" — is only true BECAUSE tombstones are
            // cursor-movement-only here. If this rule ever changes, that
            // argument changes with it (see bridgeSse.js).
            continue;
          }
          const entityId = String(row.entityId ?? '');
          if (!entityId.startsWith(BRIDGE_INTENT_PREFIX)) {
            // meta rows and our own observations also live here; refresh the
            // config cache opportunistically, skip everything else.
            if (entityId === BRIDGE_CONFIG_META_ID && row.envelope) {
              const cfg = await openBridgeEnvelope(subkey, row.envelope) as (BridgeConfigRow & { kind?: string }) | null;
              if (cfg?.kind === 'config') await this.adoptConfig(cfg);
            }
            continue;
          }
          const intentId = entityId.slice(BRIDGE_INTENT_PREFIX.length);
          if (applied.has(intentId)) {
            this.deleteIntentRow(client, entityId, pairing.accountId);
            continue;
          }
          const intent = row.envelope ? await openBridgeEnvelope(subkey, row.envelope) : null;
          if (intent === null) {
            // Sealed under a rotated-away generation (or tampered): can never
            // be applied by anyone — treat as consumed.
            applied.add(intentId);
            appliedDirty = true;
            this.deleteIntentRow(client, entityId, pairing.accountId);
            continue;
          }
          try {
            const outcome = await this.applyOne(intent as Record<string, unknown>);
            if (outcome === 'deferred') {
              // Dirty editor buffer — nothing was written. Hold the drain
              // cursor below this row (see retryFloor) so the next drain
              // re-lists and retries it.
              retryFloor = Math.min(retryFloor, seq);
              continue;
            }
            applied.add(intentId);
            appliedDirty = true;
            if (outcome === 'applied') {
              this.deleteIntentRow(client, entityId, pairing.accountId);
            }
          } catch (e) {
            // A vault-write failure leaves the row AND the id unapplied — and
            // the cursor floor below makes the retry REAL: before it, the
            // cursor advanced past the failed row and stranded it until a
            // plugin reload re-listed from the persisted hwm.
            retryFloor = Math.min(retryFloor, seq);
            console.error('dayGLANCE bridge: intent apply failed', e);
          }
        }
        since = batchMax;
        // THE CURSOR FLOOR: `since` keeps advancing so pagination works, but
        // neither the in-memory nor the persisted cursor may pass an intent
        // row that is still unconsumed (deferred on a dirty buffer, or
        // failed) — the row's seq is fixed at write time, so a cursor past
        // it makes it invisible to every future list. Rows between the floor
        // and batchMax get re-listed next drain; re-seeing them is free
        // (applied-set hits and tombstone skips are cursor-movement-only).
        const cursor = Math.min(since, retryFloor - 1);
        this.memHwm = Math.max(this.memHwm, cursor);
        // PERSIST ON INTENT ACTIVITY ONLY. The old rule — persist per
        // row-bearing page — meant every config row and every observation
        // (including this plugin's own, listed right back on the next
        // drain) rewrote data.json, i.e. one vault write per ~30s cadence
        // that Obsidian Sync then fought ("Download cancelled because file
        // was changed locally"). Now:
        //  • applied-set changes persist immediately, same crash window as
        //    before — an applied intent is never re-applied after a crash
        //    (and replay would be idempotent anyway);
        //  • cursor movement over NON-intent rows lives in memHwm only; a
        //    plugin reload re-lists that backlog once and re-skips it —
        //    cheap reads, no writes — bounded by the gap persist below so
        //    the replay can't grow unboundedly on an intent-quiet stream.
        if (!this.disposed && (appliedDirty || cursor - persistedHwm > HWM_PERSIST_GAP)) {
          const ids = [...applied];
          await this.host.saveBridgeState({
            appliedIds: ids.slice(Math.max(0, ids.length - APPLIED_IDS_CAP)),
            hwm: Math.max(persistedHwm, cursor),
            // Carry the config forward — this save REPLACES the state object,
            // and dropping the field here would undo the persistence that
            // closes the 2026-08-31 config-null hole.
            config: this.config,
          });
          persistedHwm = Math.max(persistedHwm, cursor);
          appliedDirty = false;
        }
      }
      this.noteSuccess();
      // PROOF: a successful authenticated drain is what arms (or re-arms)
      // live sync — the other half of the armed-by-proof invariant. The 30s
      // tick runs drains regardless, so proof arrives within one tick of
      // credentials working.
      this.sseArming.noteDrainSuccess();
      this.maybeStartSse();
    } catch (e) {
      if (isRateLimitError(e)) this.noteRateLimit();
      else {
        const status = (e as { status?: number } | null)?.status;
        if (status === 401 || status === 403) {
          // REFUTATION from the drain side: same rule as an SSE 401 — stop
          // the stream, no reconnects until a drain succeeds again.
          this.sseArming.noteAuthFailure();
          this.stopSse();
        }
        console.error('dayGLANCE bridge: drain failed', e);
      }
    } finally {
      this.draining = false;
      if (this.pendingRedrain && !this.disposed) {
        // A nudge landed mid-drain; without this it would be silently
        // dropped and the burst's tail would wait for the 30s timer. The
        // callback re-checks disposed — the timer itself is unregistered.
        this.pendingRedrain = false;
        window.setTimeout(() => { if (!this.disposed) void this.drain(); }, 250);
      }
    }
  }

  /** Apply one decrypted intent.
   *  'applied'     → consumed; the drain deletes the row.
   *  'unsupported' → unknown type; marked applied locally, row left for
   *                  newer builds (see the PR discussion).
   *  'deferred'    → the target note has a DIRTY editor buffer; nothing was
   *                  written, nothing was consumed — the drain leaves the
   *                  row AND holds its cursor below it, so the next drain
   *                  retries (application is idempotent).
   *
   *  THE WRITE RULE (2026-08-31, second incident): never write a note whose
   *  editor buffer differs from disk. This is the SAME rule the stamper in
   *  emitObservation enforces, extended to intent applies after the SSE-speed
   *  war: at Phase-7 speed an intent lands ~1s after the dayGLANCE action
   *  that emitted it, which is exactly when the user's Obsidian buffer is
   *  most likely mid-edit — the raw adapter.write here was the "modified
   *  externally... merging changes automatically" source, and the merges
   *  drove ^dg- tokens into the middle of titles. The dirty CHECK is shared
   *  with the stamper (markdownViews + buffer-vs-disk); the WRITE path
   *  cannot share the stamper's planner-and-transaction shape, because
   *  applyBridgeIntent produces an arbitrary whole-text rewrite, not a plan
   *  of positional insertions — there is no plan to feed a transaction. So:
   *  dirty defers; open-clean and closed both write through Vault.process,
   *  re-deriving against the file's CURRENT content inside the atomic
   *  callback (a clean buffer means Obsidian's reload of the open note
   *  destroys nothing — there are no unsaved keystrokes to lose). */
  private async applyOne(intent: Record<string, unknown>): Promise<'applied' | 'unsupported' | 'deferred'> {
    const adapter = this.host.app.vault.adapter;
    let path: string;
    if (intent.type === 'wiki_note_write') {
      // Wikilink resolution is the applier's job (the one intent type
      // without an emitter-resolved path): an existing note anywhere in
      // the vault wins; otherwise create under newNotesFolder.
      const noteName = String(intent.noteName ?? '');
      const existing = this.host.app.metadataCache.getFirstLinkpathDest(noteName, '');
      if (existing) {
        path = existing.path;
      } else if (noteName.includes('/')) {
        path = `${noteName}.md`;
      } else {
        const folder = String(intent.newNotesFolder ?? '');
        path = folder ? `${folder}/${noteName}.md` : `${noteName}.md`;
      }
    } else {
      path = String(intent.path ?? '');
    }
    if (!path) return 'applied';
    path = normalizePath(path);

    const exists = await adapter.exists(path);
    const current = exists ? await adapter.read(path) : null;
    const result = applyBridgeIntent(current, intent);
    if ('unsupported' in result) {
      if (!this.warnedUnsupported) {
        this.warnedUnsupported = true;
        console.warn(`dayGLANCE bridge: skipping intent type "${String(intent.type)}" this plugin build does not know`);
      }
      return 'unsupported';
    }
    if ('error' in result) {
      // The refusal (e.g. unportable creation) IS the outcome — the emitting
      // side surfaced the same refusal to the user.
      return 'applied';
    }
    if (result.changed && result.text !== null) {
      const file = this.host.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        if (current !== null && this.markdownViews(path).some((v) => v.getViewData() !== current)) {
          // DIRTY: unsaved keystrokes exist. Writing now would make Obsidian
          // auto-merge our rewrite into the live buffer — the war's
          // corruption vector. Defer; the buffer goes clean ~2s after the
          // user pauses, and the next drain applies.
          return 'deferred';
        }
        // Open-clean or closed: Vault.process re-derives against the file's
        // CURRENT content, atomic against a save landing between our read
        // above and this write. If the content moved and the intent no
        // longer changes anything, the callback returns data unchanged.
        await this.host.app.vault.process(file, (data) => {
          const r = applyBridgeIntent(data, intent);
          if ('unsupported' in r || 'error' in r) return data;
          return r.changed && r.text !== null ? r.text : data;
        });
      } else {
        // No TFile — a brand-new note (or a rename race). No buffer can
        // exist for a path the vault doesn't know; the raw write is safe.
        await this.ensureParentDirs(path);
        await adapter.write(path, result.text);
      }
    }
    return 'applied';
  }

  /** Every markdown view whose buffer shows `path` (active or background —
   *  the buffer is what matters, not focus). Shared by the stamper's write
   *  rule (emitObservation) and the intent applier (applyOne). */
  private markdownViews(path: string): MarkdownView[] {
    return this.host.app.workspace.getLeavesOfType('markdown')
      .map((leaf) => leaf.view)
      .filter((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === path);
  }

  private async ensureParentDirs(path: string): Promise<void> {
    const adapter = this.host.app.vault.adapter;
    const segments = path.split('/').slice(0, -1);
    let dir = '';
    for (const segment of segments) {
      dir = dir ? `${dir}/${segment}` : segment;
      if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
    }
  }

  // ── Outbound observations ─────────────────────────────────────────────────

  /** True when a path is in the observation scope. */
  private inScope(path: string, content: string | null): boolean {
    if (!path.endsWith('.md') || path.startsWith('.')) return false;
    if (this.isDailyNote(path)) return true;
    return content !== null && (content.includes('^dg-') || /#obsidian\b/i.test(content));
  }

  private isDailyNote(path: string): boolean {
    const cfg = this.config;
    if (!cfg) return /^\d{4}-\d{2}-\d{2}\.md$/.test(path.split('/').pop() ?? '');
    return this.dailyNoteDate(path) !== null;
  }

  /** The note's own YYYY-MM-DD when `path` is a configured daily note, else
   *  null. Null without a config row — normalize-then-observe (below) needs
   *  the date AND the config gate, so pre-config paths never stamp. */
  private dailyNoteDate(path: string): string | null {
    const cfg = this.config;
    if (!cfg) return null;
    const prefix = cfg.dailyNotesPath ? `${cfg.dailyNotesPath.replace(/\/+$/, '')}/` : '';
    if (prefix ? !path.startsWith(prefix) : path.includes('/')) return null;
    const name = path.slice(prefix.length);
    if (!cfg.dailyNotePattern || cfg.dailyNotePattern === 'yyyy-MM-dd') {
      return /^\d{4}-\d{2}-\d{2}\.md$/.test(name) ? name.slice(0, -3) : null;
    }
    try {
      return parseDateFromFilename(name, buildDateParser(cfg.dailyNotePattern));
    } catch {
      return null;
    }
  }

  /** The ONE way an observation timer is armed (audit fix C2): every
   *  debounce, hold, retry, and re-arm goes through here, so the disposed
   *  latch covers them all and shutdown() can cancel them all. Coalesces
   *  per path (a newer arm replaces the pending one), like the inline
   *  sites it replaced. */
  private armObserve(path: string, deleted: boolean, delayMs: number): void {
    if (this.disposed) return;
    const prior = this.observeTimers.get(path);
    if (prior !== undefined) window.clearTimeout(prior);
    this.observeTimers.set(path, window.setTimeout(() => {
      this.observeTimers.delete(path);
      void this.emitObservation(path, deleted);
    }, delayMs));
  }

  /** Debounced per path; call from vault modify/create events. */
  scheduleObservation(file: TFile): void {
    if (this.disposed || !this.host.getPairing()) return;
    this.armObserve(file.path, false, OBSERVE_DEBOUNCE_MS);
  }

  /** Immediate; call from vault delete/rename events (old path). */
  reportDeleted(path: string): void {
    if (this.disposed || !this.host.getPairing()) return;
    void this.emitObservation(path, true);
  }

  private async emitObservation(path: string, deleted: boolean): Promise<void> {
    if (this.disposed) return; // unload latch — a stale timer firing is a no-op
    try {
      const pairing = this.host.getPairing();
      if (!pairing) return;
      if (this.rateLimited()) {
        // Don't drop the report — this could be the note's LAST edit, and a
        // dropped observation only re-reports on the next touch. Re-arm for
        // just after the brake lifts (per-path, so re-edits coalesce).
        this.armObserve(path, deleted, Math.max(1000, this.backoffUntil - Date.now() + 1000));
        return;
      }
      const adapter = this.host.app.vault.adapter;
      let content: string | null = null;
      let mtime: number | null = null;
      if (!deleted) {
        if (!(await adapter.exists(path))) return;
        content = await adapter.read(path);
        try { mtime = (await adapter.stat(path))?.mtime ?? null; } catch { /* stat optional */ }
      }
      if (deleted ? !this.isDailyNote(path) : !this.inScope(path, content)) return;

      // ── FAIL CLOSED WHILE CONFIG IS UNKNOWN (2026-08-31 incident) ───────
      // With config null, the normalize block below cannot run — so reporting
      // a daily note here would ship UNSTAMPED, possibly mid-typing, state at
      // autosave cadence: the exact fragment factory. The old shape did that
      // silently (config-null skipped stamping AND the deferral coupling but
      // not the report itself — fail-closed writes had become fail-open
      // reporting). Now ruling 7's invariant is UNCONDITIONAL: a daily-note
      // report waits for the config row instead of running without the
      // stamper. Self-resolving and short: config is persisted across
      // reloads, recovered by a single-row GET, and republished per dayGLANCE
      // session — the only real no-config state left is a fresh pairing's
      // first ~30s. Deletion reports hold too: while config is unknown the
      // daily-note classifier runs on its fallback regex, and feeding the
      // note-scoped deletion inference from a guessed classification isn't
      // worth the asymmetry.
      if (this.config === null && this.isDailyNote(path)) {
        if (!this.warnedConfigHold) {
          this.warnedConfigHold = true;
          console.warn('dayGLANCE bridge: no config row known yet — daily-note reporting held (fail closed) until it arrives.');
        }
        this.armObserve(path, deleted, CONFIG_HOLD_RETRY_MS);
        return;
      }

      // ── NORMALIZE-THEN-OBSERVE (§3.10 ruling 7) ─────────────────────────
      // Stamp untagged task lines BEFORE reporting a daily note, so no
      // observation dayGLANCE receives contains an untagged task line —
      // "visible in dayGLANCE" then structurally implies "already stamped",
      // with no timing involved. Stamping is NOT interpreting (§3.6 stays
      // intact): this writes a fact — a derived, unanimous block id — and
      // then reports state; it never classifies an edit as a rename or a
      // delete, which is what §3.6 was drawn to prevent. The token is
      // deriveBlockId(note date, rawTitle) via the shared package's
      // parse-parity stamper, so this mint and dayGLANCE's stamp-on-sight
      // backstop always agree (unanimity — the policy lives in ONE place,
      // only the trigger exists in two).
      //
      // GATE: bridgeConfigAllowsStamping — config.blockIdWrites must be
      // EXACTLY true. No config row yet, or a row from an older dayGLANCE,
      // means no stamping — fail closed (the shared, pinned decision; see
      // BridgeConfigRow). Deleted observations and non-daily notes never
      // stamp.
      //
      // THE WRITE RULE (corrected after the 2026-08-31 truncation incident;
      // the spec's ruling-7 record carries the full correction): **never
      // write a note whose editor buffer differs from disk; write
      // open-clean notes through the EDITOR; write closed notes through
      // Vault.process.**
      //
      // What the first shape got wrong, kept here because it teaches: it
      // deferred while the note was the ACTIVE editor file, capped at ~10s,
      // then stamped anyway via Vault.process — reasoning that firing ≥2s
      // after the last save meant the buffer was "normally clean". But
      // Obsidian DEFERS saves during sustained typing, so "2s since the
      // last save" is satisfied precisely when the buffer is maximally
      // dirty — the timing heuristic was ANTI-correlated with the condition
      // it approximated. Past the cap, process() atomically stamped the
      // last SAVED state (it cannot see the buffer), Obsidian reloaded the
      // open note from disk, and the user's unsaved keystrokes were
      // destroyed — mid-word, token appended after the truncation. The
      // focus proxy also had a blind spot the real rule closes: a dirty
      // note in a BACKGROUND pane was never protected at all.
      //
      // The real rule needs no cap, because DIRTY is detectable directly:
      // MarkdownView.getViewData() is the live buffer (unsaved keystrokes
      // included), so buffer !== disk IS the condition. Deferral is bounded
      // by human behavior, not a counter — Obsidian saves ~2s after typing
      // pauses, the buffer goes clean, and the next debounce stamps.
      // Starving on a never-pausing typist is recoverable (the dayGLANCE
      // stamp-on-sight backstop still exists); destroyed keystrokes are
      // not. The stamp and the observation still defer TOGETHER — unstamped
      // state is never reported (ruling 7's invariant, unchanged).
      if (!deleted && content !== null && bridgeConfigAllowsStamping(this.config)) {
        const noteDate = this.dailyNoteDate(path);
        if (noteDate && stampUntaggedTaskLines(content, noteDate).changed) {
          const rearm = () => this.armObserve(path, false, OBSERVE_DEBOUNCE_MS);
          // Every markdown view showing this path — the shared helper the
          // intent applier's write rule uses too.
          const views = this.markdownViews(path);
          if (views.some((v) => v.getViewData() !== content)) {
            // DIRTY: unsaved changes exist. Defer stamp AND observation,
            // uncapped — re-armed by the same debounce; clears within ~2s
            // of the user pausing, when Obsidian's own save lands.
            rearm();
            return;
          }
          // POSTURE SPLIT (§3.10 seventh lesson): a FOCUSED editor on this
          // note means this device holds the live composition surface — the
          // cursor gate plus the dirty check above are strictly better
          // evidence than any stability window, and that already-ruled path
          // is untouched, so the authoring device stamps seconds after the
          // cursor leaves the line, exactly as before. WITHOUT focus this
          // device is in the RECEIVING posture (the note is closed, or open
          // in a background pane while changes arrive — typically via
          // Obsidian Sync from the device actually being typed at), and the
          // local rules can't see the thing that matters: the cursor gate is
          // local by construction — this device cannot see the cursor on the
          // authoring device, and Sync ships mid-composition snapshots at
          // seconds cadence (the "13: ^dg-q6wlym0v" incident: three
          // keystrokes shipped, stamped remotely, merged back into the
          // author's dirty buffer mid-line). So the receiving posture stamps
          // only SETTLED lines — see settleStampPlan in the shared package
          // for the full rule (byte-identical re-observation ≥ the settle
          // floor, both halves load-bearing) and its starvation shapes.
          const focused = views.some((v) => v.editor.hasFocus());
          if (views.length > 0 && focused) {
            // AUTHORING, OPEN AND CLEAN: write through the editor, not the
            // vault — an editor transaction COMPOSES with concurrent typing
            // instead of racing it, which eliminates the check-then-write
            // window (a keystroke landing between the dirty check above and
            // this write merges as an ordinary concurrent edit; nothing is
            // clobbered by construction). The plan is computed against the
            // LIVE buffer read in the same tick it is applied.
            const editorView = views[0];
            const buffer = editorView.getViewData();
            const plan = planStampInsertions(buffer, noteDate);
            // THE CURSOR GATE (premature identity assignment — the
            // 2026-08-31 "W ^dg-...atch tennis" line; rationale pinned on
            // partitionStampPlan in the shared package): never stamp a line
            // that currently holds a LIVE cursor. A clean buffer certifies
            // a typing pause, not a finished line — the token would land at
            // the cursor and resumed typing would continue after it,
            // splitting the word around our stamp. "Live" means a cursor
            // that can actually receive keystrokes: an editor with FOCUS.
            // Parked cursors in background tabs are deliberately excluded —
            // they never move on their own, so honoring them would defer
            // the line's stamp AND the note's whole observation (ruling 7
            // couples them) indefinitely for the commonest entry pattern
            // (type a line, switch away, cursor left resting at its end):
            // exactly the starvation this gate's design was chosen to avoid.
            // (The switch-away pattern now lands in the receiving posture
            // below, where the settle rule covers it with real evidence.)
            const heldLines = new Set<number>();
            for (const v of views) {
              if (!v.editor.hasFocus()) continue;
              for (const sel of v.editor.listSelections()) {
                const lo = Math.min(sel.anchor.line, sel.head.line);
                const hi = Math.max(sel.anchor.line, sel.head.line);
                for (let l = lo; l <= hi; l++) heldLines.add(l);
              }
            }
            const { apply } = partitionStampPlan(plan, heldLines);
            if (apply.length > 0) {
              editorView.editor.transaction({
                changes: apply.map((p) => ({
                  from: { line: p.line, ch: p.fromCh },
                  to: { line: p.line, ch: p.toCh },
                  text: p.insert,
                })),
              });
            }
            // Observe the STAMPED state on the next pass (Obsidian saves
            // the buffer on its own debounce; the explicit re-arm is the
            // belt to that suspender). A cursor-deferred line re-enters
            // here each pass and stamps on the first one after the cursor
            // moves off it; until then the observation defers with it.
            rearm();
            return;
          }
          if (views.length > 0) {
            // RECEIVING, OPEN-UNFOCUSED AND CLEAN: settle rule, applied via
            // the same editor-transaction path (composes with a late
            // keystroke instead of racing it).
            const editorView = views[0];
            const buffer = editorView.getViewData();
            const plan = planStampInsertions(buffer, noteDate);
            const settled = settleStampPlan(plan, buffer.split('\n'), this.stampSettle.get(path), Date.now());
            if (settled.nextState.size > 0) this.stampSettle.set(path, settled.nextState);
            else this.stampSettle.delete(path);
            if (settled.apply.length > 0) {
              editorView.editor.transaction({
                changes: settled.apply.map((p) => ({
                  from: { line: p.line, ch: p.fromCh },
                  to: { line: p.line, ch: p.toCh },
                  text: p.insert,
                })),
              });
            }
            // Deferred (unsettled) lines re-enter on the re-armed debounce
            // until they settle; the observation defers with them (ruling 7).
            rearm();
            return;
          }
          const file = this.host.app.vault.getAbstractFileByPath(normalizePath(path));
          if (file instanceof TFile) {
            // RECEIVING, CLOSED: no buffer exists to clobber — Vault.process
            // is safe and atomic here. The settle DECISION is made on the
            // content read above; inside process() the plan is re-derived
            // against the file's CURRENT bytes and filtered to the settled
            // lines by their exact content, so a write landing between our
            // read and this one simply un-settles the moved lines for this
            // pass (they re-enter on the re-arm).
            const plan = planStampInsertions(content, noteDate);
            const contentLines = content.split('\n');
            const settled = settleStampPlan(plan, contentLines, this.stampSettle.get(path), Date.now());
            if (settled.nextState.size > 0) this.stampSettle.set(path, settled.nextState);
            else this.stampSettle.delete(path);
            if (settled.apply.length > 0) {
              const settledKeys = new Set(settled.apply.map((p) => contentLines[p.line]));
              await this.host.app.vault.process(file, (data) => {
                const lines = data.split('\n');
                for (const p of planStampInsertions(data, noteDate)) {
                  if (!settledKeys.has(lines[p.line])) continue;
                  lines[p.line] = lines[p.line].slice(0, p.fromCh) + p.insert;
                }
                return lines.join('\n');
              });
            }
            // Observe the STAMPED state: re-arm the same per-path debounce
            // (the write's own modify event coalesces into it) and emit on
            // a later pass, once nothing in the plan is left unsettled.
            rearm();
            return;
          }
          // File lookup failed (rename/delete race) — fall through and
          // report the state we read; the dayGLANCE backstop covers it.
        }
      }

      const subkey = await this.subkeyFor(pairing);
      const payload = {
        v: 1, kind: 'observation', path,
        content, deleted: deleted || undefined,
        mtime, observedAt: new Date().toISOString(),
      };
      const ack = await this.client(pairing).batch(BRIDGE_VAULT_APP, {
        accountId: pairing.accountId,
        rows: [{
          entityId: await observationEntityId(path),
          envelope: await sealBridgeEnvelope(subkey, payload),
          createdAt: Date.now(),
        }],
      });
      // Own-ack capture (Phase 7): the server nudges every SSE client with
      // this write's resulting seq, us included — record it so our own
      // observation's echo never wakes an idle drain.
      const ackSeq = Number((ack as { maxSeq?: unknown } | null)?.maxSeq);
      if (Number.isFinite(ackSeq)) this.sseGate.recordOwnSeq(ackSeq);
      this.noteSuccess();
      this.observeRetryAttempts.delete(path);
    } catch (e) {
      if (isRateLimitError(e)) {
        // Arm the brake and requeue this path for after it lifts.
        this.noteRateLimit();
        void this.emitObservation(path, deleted);
      } else {
        // EVERY failure retries — not just 429 (the fourth swallowed-failure
        // lesson of this project, live instance: a one-shot 502 from the
        // reverse proxy dropped a stamped-line observation, and the app only
        // learned about the stamp when the note happened to be edited again,
        // ~50s later). The drain's failures all self-heal by cadence with
        // the cursor unmoved; this was the one path where a non-429 error
        // meant SILENT LOSS until the next edit. Now: exponential per-path
        // backoff (5s doubling to 5min, uncapped attempts — each retry
        // re-reads the file, so a long-failing path still reports CURRENT
        // state when the server recovers), riding the same per-path timer
        // as the debounce so a real edit in the meantime coalesces with the
        // retry instead of racing it.
        const attempt = (this.observeRetryAttempts.get(path) ?? 0) + 1;
        this.observeRetryAttempts.set(path, attempt);
        const delayMs = Math.min(5_000 * 2 ** (attempt - 1), 5 * 60_000);
        console.error(`dayGLANCE bridge: observation failed (${path}) — retry ${attempt} in ~${Math.round(delayMs / 1000)}s`, e);
        this.armObserve(path, deleted, delayMs);
      }
    }
  }
}
