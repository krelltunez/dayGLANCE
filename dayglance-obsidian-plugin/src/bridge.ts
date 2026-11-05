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

import { App, MarkdownView, Platform, TFile, getAllTags, normalizePath, requestUrl } from 'obsidian';
import {
  applyBridgeIntent,
  openBridgeEnvelope,
  readBridgeEnvelopeGeneration,
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
  splitNoteLines,
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
  BRIDGE_APPLIER_META_ID,
  bridgeCopyStatusId,
  decodePlainBridgeRow,
  noteKeyForPath,
  noteInScope,
  normalizeScope,
  scopeIsActive,
  completedSinceFor,
  PROJECT_NOTE_ID_KEY,
  linkObservationEntityId,
  normalizeProjectNoteSettings,
  projectNotePath,
  uniqueNotePath,
  noteNameFromTitle,
  templateNeedsUser,
  renderNoteTemplateSubset,
  withCreationFrontmatter,
  defaultProjectNote,
  defaultGoalNote,
  type VaultScope,
  type ProjectNoteSettings,
} from '@glance-apps/obsidian-format';
import { createVaultClient, type VaultClient } from '@glance-apps/sync/src/vaultClient.js';
import type { BridgePairing } from './pairing';
import { asText } from './text';

// The slice of Node's http(s) module the live-sync stream uses. Typed here
// rather than imported: the module is loaded with window.require on the
// desktop only (see connectSse), never bundled.
interface SseResponse {
  statusCode?: number;
  setEncoding(encoding: string): void;
  on(event: 'data', listener: (chunk: string) => void): void;
  on(event: 'end' | 'error', listener: () => void): void;
}
interface SseRequest {
  on(event: 'error' | 'close', listener: () => void): void;
  end(): void;
  destroy(): void;
}
interface NodeHttpModule {
  request(url: URL, options: { method: string; headers: Record<string, string> }, onResponse: (res: SseResponse) => void): SseRequest;
}

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
  // Vault task scope (companion §6): the non-daily notes this vault copy has
  // already reported since they entered scope. Adoption re-reports only what
  // is not here, so a plugin reload does not re-emit every note in scope.
  adoptedScope?: string[];
  // Project and goal notes (companion §4.3, ruling A): the notes this vault
  // copy has reported as carrying a `dayglance-id` key, path → id. The
  // reconciliation walk compares the vault against this map and reports
  // only the differences, so a reload re-emits nothing.
  linkedNotes?: Record<string, string>;
  // Observations armed but not yet reported (audit fix M4): a plugin reload
  // (an update, a mobile webview kill) used to drop the debounced report of
  // the last edit, leaving the note stale in dayGLANCE until its next touch —
  // and the heartbeat resumed fast enough that direct-mode fallback never
  // covered it. Re-armed on construction; cleared when the report lands or
  // is legitimately dropped.
  pendingObservations?: string[];
  // Intent ids this build could not apply ('unsupported'): marked applied so
  // they are never retried here, but their ROWS are left for a newer build
  // (the leave-for-newer-builds policy). The applied-set fast path used to
  // delete them when a retryFloor clamp re-listed them (audit low).
  unsupportedIds?: string[];
}

// Every persisted BridgeState field lives device-locally (main.ts,
// localState.ts) except `config`, which main.ts keeps in the shared
// data.json — the transport sees one object either way.

const APPLIED_IDS_CAP = 1000;

// ONE APPLIER PER VAULT (2026-09-13 incident; buildout spec 2.8). The
// applied-intent set is per copy (localState.ts) and the design relied on
// the first applier deleting the row before a second copy listed it. That
// holds when copies drain minutes apart; at stream speed two desktops listed
// the same four rows within a second and each applied them to its own copy
// of the note, and Obsidian Sync's merge of the two edited copies duplicated
// lines, moved lines and mangled one. So intents now have ONE applier: a
// plaintext lease row (meta:applier) names the copy that applies; every
// other copy leaves intent rows listable (the cursor floor) and receives the
// result through Sync. The lease is claimed when absent or expired, renewed
// by its holder while Obsidian runs, and lapses by expiry when the holder
// quits or crashes (no release on unload: a plugin reload or update is an
// unload too, and the same copy resumes its lease on return instead of
// re-claiming and settling). A fresh claim is acted on only after a settle: two copies that
// claim within the same second both write, the later write wins the row,
// and both read the winner back before either applies. The server has no
// compare-and-set, so this is convergence, not mutual exclusion; the
// settle covers the write-to-visibility gap of the second claim.
// Five minutes, renewed at half: two lease writes per idle five minutes
// from the holder (own-ack suppressed; a renewal wakes nothing that writes),
// and a quit or crash hands over within five minutes plus a tick.
const APPLIER_LEASE_MS = 300_000;
const APPLIER_RENEW_AFTER_MS = 150_000;
const APPLIER_CLAIM_SETTLE_MS = 2_000;
interface ApplierLease { deviceId: string; claimedAt: number; until: number }
// THE PAIRING SPLIT (2026-09-29, the field incident). A re-pair on one
// desktop rotated the bridge key; two other copies kept the old data.json
// in memory for two days (the plugin read its pairing only at load, and
// Obsidian Sync had delivered the new file underneath them), so every intent
// the fleet sealed under the new key was unreadable to them. The drain's
// rule for an unreadable row was "sealed under a rotated-away generation,
// consume and delete" — and whichever stale copy held the applier lease
// deleted two days of writes, silently: task placements, retitles, note
// writes and completions, with no console line and a green status panel.
// Three rules replace that:
//   1. NEVER DELETE WHAT THIS COPY CANNOT READ. An unreadable intent is held
//      below the cursor floor like a deferred one, counted, and said once;
//      it applies when a copy holding its pairing drains. Only a row that
//      has stayed unreadable for UNREADABLE_INTENT_TTL_MS is dropped, with a
//      console line, so a truly revoked pairing's rows do not pin the cursor
//      forever.
//   2. A COPY THAT IS BEHIND STANDS DOWN. Before asserting its own
//      meta:pairing row, a copy reads the vault's; a different generation
//      paired later than its own means this copy is stale: it never claims
//      the applier lease, applies nothing, reports nothing (its reports
//      would be sealed under a key dayGLANCE no longer derives), says so
//      once, and carries the verdict in its heartbeat so dayGLANCE can say
//      "re-pair this copy" instead of "active". The old unconditional
//      re-assert would have overwritten the vault's row with the stale
//      generation and pulled every dayGLANCE device back onto the dead key.
//   3. THE ENVELOPE NAMES ITS GENERATION (format package): an unreadable row
//      can be told from a corrupt one, and the held count names the pairing
//      it needs.
// main.ts adds the fourth: the pairing is reloaded when Obsidian Sync
// changes data.json (onExternalSettingsChange), so a re-pair reaches every
// running copy without a restart.
const UNREADABLE_INTENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export interface StalePairing { generation: string; pairedAt: string | null }
// The COPY STATUS row (the fleet-wide half): what this copy tells every
// dayGLANCE device about itself. Renewed hourly so readers can age out a
// copy that is gone; rewritten at once when its content changes.
const COPY_STATUS_RENEW_MS = 60 * 60 * 1000;
// Intent types that rewrite one note's text and can share a single write
// (coalesced per note per drain: a burst of four is one edit and one
// editor reload, the other half of the incident's fix).
const COALESCED_INTENT_TYPES = new Set(['task_state', 'task_retitle', 'task_append', 'task_remove', 'completion_log_append', 'daily_note_write', 'project_note_description']);
type ApplyOutcome = 'applied' | 'unsupported' | 'deferred' | 'failed';
interface PendingIntent { intent: Record<string, unknown>; intentId: string; entityId: string; seq: number }
// The full link rescan (every markdown file's frontmatter, from the
// metadata cache) runs at most this often; per-file events cover the rest.
const LINK_RESCAN_MS = 5 * 60_000;
// (The stamp-deferral CAP that used to live here is deliberately GONE — it
// authorized a vault write into a note with a dirty editor buffer, which is
// how the 2026-08-31 truncation destroyed typed text. Deferral is now
// condition-based — buffer differs from disk — and uncapped; see the write
// rule in emitObservation.)
// Bound on the in-memory-only cursor advance (persist-on-intent-only rule in
// drain): once the unpersisted gap exceeds this many seq, the cursor is
// persisted anyway, capping how many non-intent rows a plugin reload can
// re-list. This is a REPLAY BOUND, nothing more: 500 server rows is a page
// or two of cheap reads, and tripping it early is the benign direction.
// (2026-09-05 investigation: it was suspected as the data.json churn and
// was not — the churn's real address was the fleet-shared file itself,
// closed by device-local state, localState.ts. The old comment sized this
// as "a normal editing day", which the account-global seq rate makes
// meaningless; it never was a time proxy.)
const HWM_PERSIST_GAP = 500;
// Adoption throttle (companion §6.2 item 5): notes newly in scope are
// reported this many per 30s tick, so bringing a large folder into scope
// spreads its stamping over minutes instead of one Obsidian Sync burst.
const ADOPT_PER_TICK = 3;
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
// A live-sync connect with no response inside this window is a hung connect
// (audit low): it used to occupy `sseReq` forever — no reconnect, no
// failure path, live sync silently dead until reload.
const SSE_CONNECT_TIMEOUT_MS = 20_000;

const isRateLimitError = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && (e as { status?: number }).status === 429;

export interface BridgeConfigRow {
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
  /**
   * Fired after every successful authenticated drain — the same proof that
   * arms SSE. The agenda store (agenda.ts) refreshes its mirror on it, so a
   * nudge-driven drain also makes the sidebar live without the store holding
   * a second stream of its own.
   */
  onSynced?(): void;
  /**
   * The vault task scope (companion §6, rulings D and E): the folders and
   * tags whose notes are task sources, and the completion window. Null or
   * inactive means daily notes only.
   */
  getScope?(): VaultScope | null;
  /** Project and goal note workspaces (companion §4.3, rulings D and E). */
  getProjectNotes?(): ProjectNoteSettings;
  /** The vault's viewer override (companion 4.2, decision 9); undefined = the pairing's default. */
  getViewer?(): string | null;
  /** The linked-notes map changed (a link made, moved or broken). Display-only consumers. */
  onLinkedNotesChanged?(): void;
  /** This vault copy's device id (the heartbeat's wire key). Names the applier lease. */
  getDeviceId?(): string;
  /** How the copy status row names this copy to the fleet (a hostname on desktop, the platform elsewhere). */
  getCopyName?(): string | null;
  /** 'mac' | 'windows' | 'linux' | 'ios' | 'android' | 'unknown', for the copy status row. */
  getPlatform?(): string | null;
  /** The plugin build this copy runs, for the copy status row. */
  getPluginVersion?(): string | null;
}

/** The intents that CREATE a daily note when it is missing (the template ladder's daily creation point). */
function isDailyNoteCreation(intent: Record<string, unknown>): boolean {
  if (intent.type === 'completion_log_append') return true;
  return intent.type === 'task_append' && intent.noteTask !== true;
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
    json: async (): Promise<unknown> => resp.json as unknown,
  };
};

/**
 * Publish (or clear) the plaintext meta:pairing row. PLAINTEXT is the
 * point: it carries the pairing salt that other dayGLANCE devices need
 * BEFORE they can derive the subkey — an HKDF salt is not a secret.
 */
export async function publishPairingMeta(
  pairing: BridgePairing | null, previous?: BridgePairing,
  // The vault's viewer (companion 4.2 decision 9): dayGLANCE devices read
  // it to scope what they write into this vault and whom a first-imported
  // line is assigned to. Defaults to the pairing's own user; main.ts passes
  // the settings override when one is set.
  viewer: string | null | undefined = pairing?.userSyncId ?? null,
  // The vault task scope (ruling D): dayGLANCE reads the completion window
  // from here so both sides drop the same old completed lines.
  scope: VaultScope | null = null,
): Promise<number | null> {
  const creds = pairing ?? previous;
  if (!creds) return null;
  const client = createVaultClient({
    vaultUrl: creds.vaultUrl, vaultToken: creds.deviceToken, fetchImpl: obsidianFetch,
  });
  // Returns the write's seq so the caller can record it as its own (the
  // server nudges every SSE client with it, this plugin included).
  if (pairing) {
    const ack = await client.batch(BRIDGE_VAULT_APP, {
      accountId: pairing.accountId,
      rows: [{
        entityId: BRIDGE_PAIRING_META_ID,
        // Wire-encoded (base64), NOT encrypted — the server stores envelope
        // bytes; see the format package's wire note.
        envelope: encodePlainBridgeRow({
          v: 1, kind: 'pairing-meta',
          generation: pairing.generation, pairingSalt: pairing.pairingSalt, pairedAt: pairing.pairedAt,
          ...(viewer ? { userSyncId: viewer } : {}),
          ...(scope ? { scope } : {}),
        }),
        createdAt: Date.now(),
      }],
    }) as { maxSeq?: unknown } | null;
    const seq = Number(ack?.maxSeq);
    return Number.isFinite(seq) ? seq : null;
  }
  const res = await client.deleteRow(BRIDGE_VAULT_APP, BRIDGE_PAIRING_META_ID, creds.accountId) as { seq?: unknown } | null;
  const seq = Number(res?.seq);
  return Number.isFinite(seq) ? seq : null;
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
  // Vault task scope: paths reported as scoped (deletions of these report),
  // the persisted adopted set, and the throttled adoption queue.
  private scopedPaths = new Set<string>();
  // Project and goal notes (companion §4.3): path → dayGLANCE id, as last
  // reported. Persisted (BridgeState.linkedNotes); see LINK_RESCAN_MS.
  private linked = new Map<string, string>();
  // Unsupported intent ids (see BridgeState.unsupportedIds).
  private unsupported = new Set<string>();
  // Paths with an observation armed or in flight (see BridgeState.pendingObservations).
  private pendingObs = new Set<string>();
  // The applier lease as last read or written (ONE APPLIER PER VAULT).
  private applier: ApplierLease | null = null;
  private applierKnownGeneration: string | null = null;
  private applierFollowerLogged = false;
  // THE PAIRING SPLIT (see the header note by UNREADABLE_INTENT_TTL_MS):
  // the vault's pairing this copy is behind, or null; the generation that
  // verdict was last said for; when each unreadable intent was first seen
  // (its row's createdAt when the server reports one) and the held count
  // last said, so the console line repeats only when the count changes.
  private stalePairing: StalePairing | null = null;
  private stalePairingSaidFor: string | null = null;
  private unreadableFirstSeen = new Map<string, number>();
  private unreadableSaidCount = 0;
  // The last drain's held count (the copy status row carries it).
  private unreadableCount = 0;
  // The copy status row as last written: its content key and the time, so a
  // drain rewrites it only on change or for the hourly renewal.
  private copyStatusWritten: { key: string; at: number } | null = null;
  private linkScanAt = 0;
  private adopted = new Set<string>();
  private adoptQueue: string[] = [];
  private adoptScanned = false;
  // When a note ARRIVED at a path (create or rename), epoch ms. A move does
  // not touch a file's mtime, so a note moved back into the scope would
  // report content older than the tombstones its leaving produced and never
  // revive (field test, 2026-09-04). Its presence at this path is evidence as
  // of its arrival: scoped observations report max(mtime, arrival). Memory
  // only; after a reload the plain mtime is reported again, which is right
  // for a note that has simply been sitting there.
  private arrivedAt = new Map<string, number>();
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
  private sseGate = createSseNudgeGate({ app: BRIDGE_VAULT_APP, onDrain: () => this.drainFromNudge() });
  private sseReq: SseRequest | null = null; // in-flight Node http(s) request, when connected/connecting
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
    console.debug(`dayGLANCE bridge: rate-limited (429) — pausing bridge requests for ~${Math.round(this.backoffMs / 1000)}s.`);
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
      console.debug('dayGLANCE bridge: request succeeded — brake released.');
    } else {
      console.debug(`dayGLANCE bridge: request succeeded — brake decaying (a new 429 would pause ~${Math.round(Math.min(this.backoffMs * 2, BACKOFF_MAX_MS) / 1000)}s).`);
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
      console.debug(`dayGLANCE bridge: config restored from settings — stamping ${this.stampingState()}.`);
    }
    for (const p of host.getBridgeState().adoptedScope ?? []) {
      if (typeof p === 'string') { this.adopted.add(p); this.scopedPaths.add(p); }
    }
    for (const [path, id] of Object.entries(host.getBridgeState().linkedNotes ?? {})) {
      if (typeof path === 'string' && typeof id === 'string' && id) this.linked.set(path, id);
    }
    for (const id of host.getBridgeState().unsupportedIds ?? []) {
      if (typeof id === 'string') this.unsupported.add(id);
    }
    for (const p of host.getBridgeState().pendingObservations ?? []) {
      if (typeof p === 'string') this.pendingObs.add(p);
    }
    // Reports that a reload cut off (audit fix M4) are re-armed at the normal
    // debounce; a path that vanished meanwhile reports the deletion instead.
    void this.resumePendingObservations();
  }

  /** The full state to persist: memory is the source of truth for every
   *  field the transport owns, so no persist site can drop another's field
   *  (the drain's save used to replace the object without linkedNotes). */
  private stateSnapshot(overrides: Partial<BridgeState> = {}): BridgeState {
    return {
      ...this.host.getBridgeState(),
      config: this.config,
      adoptedScope: [...this.adopted],
      linkedNotes: Object.fromEntries([...this.linked].sort(([a], [b]) => a.localeCompare(b))),
      unsupportedIds: [...this.unsupported].slice(-APPLIED_IDS_CAP),
      pendingObservations: [...this.pendingObs],
      ...overrides,
    };
  }

  /** Record the seq of a bridge write made outside the transport (the
   *  pairing-meta publish in main.ts) as our own, so its SSE echo never
   *  wakes an idle drain (audit low: that ack was never recorded). */
  recordOwnSeq(seq: number | null | undefined): void {
    if (typeof seq === 'number' && Number.isFinite(seq)) this.sseGate.recordOwnSeq(seq);
  }

  /** True while this copy's pairing is older than the vault's: it applies and reports nothing (the heartbeat's `pairingStale`). */
  pairingStale(): boolean { return this.stalePairing !== null; }
  /** The intents this copy held unreadable on its last drain. */
  heldIntents(): number { return this.unreadableCount; }

  /** The copy status row's content (the fleet-wide half, see bridgeStream.js). */
  private copyStatusPayload(pairing: BridgePairing): Record<string, unknown> {
    return {
      v: 1, kind: 'copy',
      deviceId: this.host.getDeviceId?.() ?? '',
      name: this.host.getCopyName?.() ?? null,
      platform: this.host.getPlatform?.() ?? null,
      pluginVersion: this.host.getPluginVersion?.() ?? null,
      generation: pairing.generation, pairedAt: pairing.pairedAt,
      stale: this.stalePairing !== null,
      ...(this.stalePairing ? { staleAgainst: this.stalePairing } : {}),
      held: this.unreadableCount,
    };
  }

  /** Write the copy status row when its content changed or the renewal is due. Never throws. */
  private async publishCopyStatus(client: VaultClient, pairing: BridgePairing): Promise<void> {
    const deviceId = this.host.getDeviceId?.() ?? '';
    if (!deviceId || this.disposed) return;
    const payload = this.copyStatusPayload(pairing);
    const key = JSON.stringify(payload);
    const now = Date.now();
    if (this.copyStatusWritten && this.copyStatusWritten.key === key && now - this.copyStatusWritten.at < COPY_STATUS_RENEW_MS) return;
    try {
      const ack = await client.batch(BRIDGE_VAULT_APP, {
        accountId: pairing.accountId,
        rows: [{ entityId: bridgeCopyStatusId(deviceId), envelope: encodePlainBridgeRow({ ...payload, ts: new Date(now).toISOString() }), createdAt: now }],
      }) as { maxSeq?: unknown } | null;
      this.recordOwnSeq(Number(ack?.maxSeq));
      this.copyStatusWritten = { key, at: now };
    } catch (e) {
      if (isRateLimitError(e)) this.noteRateLimit();
      else console.error('dayGLANCE bridge: copy status write failed', e);
    }
  }

  /** Unpairing: this copy's status row goes with its credentials. Never throws. */
  async retireCopyStatus(pairing: BridgePairing): Promise<void> {
    const deviceId = this.host.getDeviceId?.() ?? '';
    if (!deviceId) return;
    try {
      const res = await this.client(pairing).deleteRow(BRIDGE_VAULT_APP, bridgeCopyStatusId(deviceId), pairing.accountId) as { seq?: unknown } | null;
      this.recordOwnSeq(Number(res?.seq));
    } catch (e) {
      if (isRateLimitError(e)) this.noteRateLimit();
      else console.error('dayGLANCE bridge: copy status cleanup failed', e);
    }
    this.copyStatusWritten = null;
  }
  /** The vault's pairing this copy is behind, or null. */
  stalePairingInfo(): StalePairing | null { return this.stalePairing; }

  /**
   * The vault's meta:pairing row against this copy's pairing (rule 2 of the
   * pairing split). A different generation paired LATER than ours makes this
   * copy stale; the same generation, an older one, a missing or deleted row
   * (unpaired, or a garbage row from a pre-base64 build) does not. Called
   * with the row read at the first drain of a generation and with every
   * meta:pairing row the listing passes, so a re-pair elsewhere is noticed
   * within a drain. Returns the verdict; says a new one once.
   */
  private adoptVaultPairingMeta(row: { envelope?: string | null; deleted?: boolean } | null | undefined, pairing: BridgePairing): boolean {
    const p = row && !row.deleted && row.envelope
      ? decodePlainBridgeRow(row.envelope) as { kind?: string; generation?: unknown; pairedAt?: unknown } | null
      : null;
    const generation = p?.kind === 'pairing-meta' && typeof p.generation === 'string' && p.generation ? p.generation : null;
    const theirs = typeof p?.pairedAt === 'string' ? Date.parse(p.pairedAt) : NaN;
    const mine = Date.parse(pairing.pairedAt);
    // A different generation with no usable dates on either side is treated
    // as newer: the vault's row is what dayGLANCE devices seal under, so a
    // key that does not match it cannot read their writes whichever is
    // older, and standing down loses nothing that asserting would gain.
    const stale = generation !== null && generation !== pairing.generation
      && (!Number.isFinite(theirs) || !Number.isFinite(mine) || theirs > mine);
    const was = this.stalePairing;
    this.stalePairing = stale ? { generation, pairedAt: typeof p?.pairedAt === 'string' ? p.pairedAt : null } : null;
    if (stale && this.stalePairingSaidFor !== generation) {
      this.stalePairingSaidFor = generation;
      console.warn(
        `dayGLANCE bridge: this copy holds an older pairing (${pairing.pairedAt}) than the vault (${this.stalePairing?.pairedAt ?? 'unknown date'}): ` +
        'it will not apply or report until it is re-paired. Restart Obsidian here once the synced plugin settings arrive, ' +
        'or start pairing again in dayGLANCE and enter the code in Settings → dayGLANCE Bridge.',
      );
    }
    if (was && !stale) {
      this.stalePairingSaidFor = null;
      console.debug('dayGLANCE bridge: this copy holds the vault\'s current pairing again; applying and reporting resume.');
      void this.resumePendingObservations();
    }
    return stale;
  }

  /**
   * First drain of a pairing generation: read the vault's meta:pairing row
   * and either stand down (stale) or assert ours over it, as before. The
   * assert is also the self-heal for a row an older build wrote in the
   * pre-base64 wire format. 'unknown' (the read failed) retries next drain
   * and asserts nothing: an unconditional assert is exactly what let a stale
   * copy overwrite a newer pairing.
   */
  private async reconcilePairingMeta(client: VaultClient, pairing: BridgePairing): Promise<'asserted' | 'stale' | 'unknown'> {
    let row: { envelope?: string | null; deleted?: boolean } | null;
    try {
      row = await client.getRow(BRIDGE_VAULT_APP, BRIDGE_PAIRING_META_ID, pairing.accountId) as { envelope?: string | null; deleted?: boolean } | null;
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      if (status === 429 || status === 401 || status === 403) throw e; // brake / refutation, classified by the drain
      console.error('dayGLANCE bridge: pairing meta read failed', e);
      return 'unknown';
    }
    if (this.adoptVaultPairingMeta(row, pairing)) return 'stale';
    this.recordOwnSeq(await publishPairingMeta(pairing, undefined, this.host.getViewer?.() ?? pairing.userSyncId ?? null, this.host.getScope?.() ?? null));
    return 'asserted';
  }

  private async resumePendingObservations(): Promise<void> {
    if (this.disposed || this.pendingObs.size === 0) return;
    const adapter = this.host.app.vault.adapter;
    for (const path of [...this.pendingObs]) {
      if (this.disposed) return;
      let exists = false;
      try { exists = await adapter.exists(path); } catch { exists = false; }
      this.armObserve(path, !exists, OBSERVE_DEBOUNCE_MS);
    }
  }

  private markPending(path: string): void {
    if (this.pendingObs.has(path)) return;
    this.pendingObs.add(path);
    void this.persistPending();
  }

  private clearPending(path: string): void {
    if (!this.pendingObs.delete(path)) return;
    void this.persistPending();
  }

  private async persistPending(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.host.saveBridgeState(this.stateSnapshot());
    } catch (e) {
      console.error('dayGLANCE bridge: could not persist the pending observations', e);
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
    console.debug(`dayGLANCE bridge: config ${before === 'no-config' ? 'received' : 'updated'} — stamping ${after}.`);
    try {
      await this.host.saveBridgeState(this.stateSnapshot({ config: cfg }));
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

  // ── ONE APPLIER PER VAULT (see the constants above) ─────────────────────

  private parseApplierRow(row: { envelope?: string | null; deleted?: boolean } | null | undefined): ApplierLease | null {
    if (!row || row.deleted || !row.envelope) return null;
    const p = decodePlainBridgeRow(row.envelope) as { kind?: string; deviceId?: string; claimedAt?: string; until?: string } | null;
    if (!p || p.kind !== 'applier' || typeof p.deviceId !== 'string' || !p.deviceId) return null;
    const claimedAt = Date.parse(String(p.claimedAt ?? ''));
    const until = Date.parse(String(p.until ?? ''));
    if (!Number.isFinite(claimedAt) || !Number.isFinite(until)) return null;
    return { deviceId: p.deviceId, claimedAt, until };
  }

  private async writeApplierLease(client: VaultClient, pairing: BridgePairing, deviceId: string, claimedAt: number, now: number): Promise<void> {
    const until = now + APPLIER_LEASE_MS;
    const res = await client.batch(BRIDGE_VAULT_APP, {
      accountId: pairing.accountId,
      rows: [{
        entityId: BRIDGE_APPLIER_META_ID,
        envelope: encodePlainBridgeRow({
          v: 1, kind: 'applier', deviceId,
          claimedAt: new Date(claimedAt).toISOString(), until: new Date(until).toISOString(),
        }),
        createdAt: now,
      }],
    });
    const seq = Number((res as { maxSeq?: unknown } | null)?.maxSeq);
    if (Number.isFinite(seq)) this.sseGate.recordOwnSeq(seq);
    this.applier = { deviceId, claimedAt, until };
  }

  /** Whether this drain applies intents. Runs every drain so the holder
   *  renews while Obsidian runs and a claim settles before intents arrive. */
  private async applierRole(client: VaultClient, pairing: BridgePairing, now: number): Promise<'leader' | 'follower' | 'settling'> {
    const me = this.host.getDeviceId?.() ?? '';
    if (!me) return 'leader'; // a host without a device id: the pre-lease behaviour
    if (this.applierKnownGeneration !== pairing.generation) {
      // First drain of this pairing (or a reload): the row's seq may sit
      // below the cursor, so read it directly once.
      const row = await client.getRow(BRIDGE_VAULT_APP, BRIDGE_APPLIER_META_ID, pairing.accountId) as
        { envelope?: string | null; deleted?: boolean } | null;
      this.applier = this.parseApplierRow(row);
      this.applierKnownGeneration = pairing.generation;
    }
    const a = this.applier;
    if (a && a.until > now && a.deviceId !== me) {
      if (!this.applierFollowerLogged) {
        this.applierFollowerLogged = true;
        console.debug(`dayGLANCE bridge: another copy of this vault (${a.deviceId}) applies intents; this copy receives them through sync.`);
      }
      return 'follower';
    }
    this.applierFollowerLogged = false;
    if (a && a.until > now && a.deviceId === me) {
      if (APPLIER_LEASE_MS - (a.until - now) >= APPLIER_RENEW_AFTER_MS) await this.writeApplierLease(client, pairing, me, a.claimedAt, now);
      return now - a.claimedAt < APPLIER_CLAIM_SETTLE_MS ? 'settling' : 'leader';
    }
    await this.writeApplierLease(client, pairing, me, now, now);
    return 'settling';
  }

  /** Apply this drain's intents as the lease holder: one write per note for
   *  the coalescable kinds, the single path for everything else. */
  private async applyPending(items: PendingIntent[]): Promise<Map<string, ApplyOutcome>> {
    const out = new Map<string, ApplyOutcome>();
    const groups = new Map<string, PendingIntent[]>();
    const singles: PendingIntent[] = [];
    for (const it of items) {
      const type = asText(it.intent.type);
      const path = typeof it.intent.path === 'string' && it.intent.path ? normalizePath(it.intent.path) : '';
      if (COALESCED_INTENT_TYPES.has(type) && path) {
        const g = groups.get(path) ?? [];
        g.push(it);
        groups.set(path, g);
      } else {
        singles.push(it);
      }
    }
    for (const it of singles) out.set(it.intentId, await this.safeApplyOne(it.intent));
    for (const [path, group] of groups) {
      if (group.length === 1) { out.set(group[0].intentId, await this.safeApplyOne(group[0].intent)); continue; }
      for (const [id, o] of await this.applyGroup(path, group)) out.set(id, o);
    }
    return out;
  }

  private async safeApplyOne(intent: Record<string, unknown>): Promise<ApplyOutcome> {
    try {
      return await this.applyOne(intent);
    } catch (e) {
      // A vault-write failure leaves the row AND the id unapplied; the
      // cursor floor makes the retry real.
      console.error('dayGLANCE bridge: intent apply failed', e);
      return 'failed';
    }
  }

  /** Several intents against one existing note, applied in seq order inside
   *  ONE Vault.process callback: one write, one editor reload. The write
   *  rule is the single path's (dirty defers the whole group); a missing
   *  note falls back to the single path so the creation ladder runs. */
  private async applyGroup(path: string, group: PendingIntent[]): Promise<Map<string, ApplyOutcome>> {
    const out = new Map<string, ApplyOutcome>();
    const adapter = this.host.app.vault.adapter;
    const file = this.host.app.vault.getAbstractFileByPath(path);
    if (!(await adapter.exists(path)) || !(file instanceof TFile)) {
      for (const it of group) out.set(it.intentId, await this.safeApplyOne(it.intent));
      return out;
    }
    const current = await adapter.read(path);
    if (this.markdownViews(path).some((v) => v.getViewData() !== current)) {
      for (const it of group) out.set(it.intentId, 'deferred');
      return out;
    }
    try {
      await this.host.app.vault.process(file, (data) => {
        let text = data;
        for (const it of group) {
          const r = applyBridgeIntent(text, it.intent);
          if ('unsupported' in r) {
            out.set(it.intentId, 'unsupported');
            if (!this.warnedUnsupported) {
              this.warnedUnsupported = true;
              console.warn(`dayGLANCE bridge: skipping intent type "${String(it.intent.type)}" this plugin build does not know`);
            }
            continue;
          }
          out.set(it.intentId, 'applied'); // a refusal is an outcome too (the single path's rule)
          if (!('error' in r) && r.changed && r.text !== null) text = r.text;
        }
        return text;
      });
    } catch (e) {
      console.error('dayGLANCE bridge: intent apply failed', e);
      for (const it of group) out.set(it.intentId, 'failed');
    }
    return out;
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
      console.debug('dayGLANCE bridge: live sync went quiet (3 missed heartbeats) — reconnecting.');
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
    // http and https share the request signature used here.
    let mod: NodeHttpModule;
    try {
      mod = nodeRequire(url.protocol === 'http:' ? 'http' : 'https') as NodeHttpModule;
    } catch {
      return;
    }
    let buffer = '';
    // Connect timeout (audit low): no response headers inside the window →
    // the same failure path a refused connect takes (reconnect with backoff).
    let connectTimer: number | null = null;
    const clearConnectTimer = () => { if (connectTimer !== null) { window.clearTimeout(connectTimer); connectTimer = null; } };
    const req = mod.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${pairing.deviceToken}`, Accept: 'text/event-stream' },
    }, (res: SseResponse) => {
      clearConnectTimer();
      if (res.statusCode === 401 || res.statusCode === 403) {
        // REFUTATION: the credential is dead — stop outright, no backoff
        // retries against it. The 30s drain tick keeps running exactly as
        // in the polling era, and the first drain that SUCCEEDS re-proves
        // the credential and re-arms the stream. Total cost of a dead
        // credential: one failed drain per tick — polling's own benign
        // failure mode, preserved.
        console.debug(`dayGLANCE bridge: live sync refused (${res.statusCode}) — paused until a sync succeeds.`);
        this.sseArming.noteAuthFailure();
        this.stopSse();
        return;
      }
      if (res.statusCode !== 200) {
        console.debug(`dayGLANCE bridge: live sync connect failed (${res.statusCode}) — will retry.`);
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
          this.sseGate.handleEvent(evt);
        });
      });
      res.on('end', () => this.failSse());
      res.on('error', () => this.failSse());
    });
    req.on('error', () => { clearConnectTimer(); this.failSse(); });
    req.on('close', clearConnectTimer);
    req.end();
    this.sseReq = req;
    connectTimer = window.setTimeout(() => {
      connectTimer = null;
      if (this.sseReq !== req) return; // already torn down or replaced
      console.debug(`dayGLANCE bridge: live sync connect timed out after ${Math.round(SSE_CONNECT_TIMEOUT_MS / 1000)}s — will retry.`);
      this.failSse();
    }, SSE_CONNECT_TIMEOUT_MS);
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
        // The row carries the viewer override and the task scope too
        // (harness finding, 2026-09-04): republishing it bare after every
        // reload silently dropped both until the settings were touched.
        // Read before asserting (the pairing split, rule 2): a copy that is
        // behind the vault stands down instead of overwriting the row.
        const verdict = await this.reconcilePairingMeta(client, pairing);
        if (verdict !== 'unknown') this.metaAssertedGeneration = pairing.generation;
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
      // This drain's intent rows, applied after the listing by the lease
      // holder only (ONE APPLIER PER VAULT); every other copy keeps them
      // listable through the cursor floor.
      const pendingIntents: PendingIntent[] = [];
      // The generations of the intent rows this drain could not open (rule 1).
      const unreadable: string[] = [];
      let hasMore = true;
      while (hasMore && !this.disposed) {
        const page = await client.list(BRIDGE_VAULT_APP, { accountId: pairing.accountId, since });
        hasMore = !!page.hasMore;
        const rows = (page.rows ?? []) as Array<{ entityId?: string; envelope?: string; seq?: number; deleted?: boolean; createdAt?: number }>;
        if (rows.length === 0) break;
        let batchMax = since;
        for (const row of rows) {
          const seq = Number(row.seq) || 0;
          if (seq > batchMax) batchMax = seq;
          if (String(row.entityId ?? '') === BRIDGE_APPLIER_META_ID) {
            // The lease, live or released (a tombstone means no holder).
            this.applier = this.parseApplierRow(row);
            continue;
          }
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
            // A re-listed meta:pairing row is a re-pair somewhere (or this
            // copy's own assert echoing back): the verdict follows it.
            if (entityId === BRIDGE_PAIRING_META_ID) { this.adoptVaultPairingMeta(row, pairing); continue; }
            if (entityId === BRIDGE_CONFIG_META_ID && row.envelope) {
              const cfg = await openBridgeEnvelope(subkey, row.envelope) as (BridgeConfigRow & { kind?: string }) | null;
              if (cfg?.kind === 'config') await this.adoptConfig(cfg);
            }
            continue;
          }
          const intentId = entityId.slice(BRIDGE_INTENT_PREFIX.length);
          if (applied.has(intentId)) {
            // A re-listed row we already consumed (a retryFloor clamp re-lists
            // everything above the floor): clean it up — unless it is an
            // UNSUPPORTED intent, whose row is deliberately left for a newer
            // build (audit low: this branch used to delete those too).
            if (!this.unsupported.has(intentId)) this.deleteIntentRow(client, entityId, pairing.accountId);
            continue;
          }
          const intent = row.envelope ? await openBridgeEnvelope(subkey, row.envelope) : null;
          if (intent === null) {
            // NEVER DELETE WHAT THIS COPY CANNOT READ (the pairing split,
            // rule 1). Sealed under a pairing this copy does not hold, or
            // under the same one with a key that does not match (a root key
            // that differs between devices), or corrupt: this copy cannot
            // tell which, and a copy that can read it may drain next. Hold
            // it below the cursor floor like a deferred apply. The one exit
            // is age: a row unreadable for a week is dropped, said aloud.
            const firstSeen = this.unreadableFirstSeen.get(intentId)
              ?? (Number.isFinite(Number(row.createdAt)) && Number(row.createdAt) > 0 ? Number(row.createdAt) : Date.now());
            const gen = row.envelope ? readBridgeEnvelopeGeneration(row.envelope) : null;
            if (Date.now() - firstSeen > UNREADABLE_INTENT_TTL_MS) {
              console.warn(
                `dayGLANCE bridge: dropping intent ${intentId}: unreadable by this copy for more than ${Math.round(UNREADABLE_INTENT_TTL_MS / 86_400_000)} days ` +
                `(sealed under pairing ${gen ?? 'unknown'}; this copy holds ${pairing.generation}).`,
              );
              this.unreadableFirstSeen.delete(intentId);
              applied.add(intentId);
              appliedDirty = true;
              this.deleteIntentRow(client, entityId, pairing.accountId);
              continue;
            }
            this.unreadableFirstSeen.set(intentId, firstSeen);
            unreadable.push(gen ?? 'unknown');
            retryFloor = Math.min(retryFloor, seq);
            continue;
          }
          this.unreadableFirstSeen.delete(intentId);
          pendingIntents.push({ intent: intent as Record<string, unknown>, intentId, entityId, seq });
        }
        since = batchMax;
      }
      this.unreadableCount = unreadable.length;
      if (unreadable.length !== this.unreadableSaidCount) {
        // Said when the count changes, not every 30 seconds: the held rows
        // re-list on every drain by design (the cursor floor).
        this.unreadableSaidCount = unreadable.length;
        if (unreadable.length > 0) {
          const gens = [...new Set(unreadable)].join(', ');
          console.warn(
            `dayGLANCE bridge: ${unreadable.length} dayGLANCE change(s) cannot be read by this copy and are held, not deleted ` +
            `(sealed under pairing ${gens}; this copy holds ${pairing.generation}). They apply when a copy holding that pairing syncs, ` +
            'or once this copy is re-paired or restarted after the synced plugin settings arrive.',
          );
        } else {
          console.debug('dayGLANCE bridge: no held dayGLANCE changes remain.');
        }
      }
      // ONE APPLIER PER VAULT: the role is decided every drain (the holder
      // renews, a claim settles), the intents applied only by the holder.
      // A stale copy (rule 2) never claims: it is a follower whatever the
      // lease says, and a lease it already held lapses by expiry.
      const role = this.disposed || this.stalePairing ? 'follower' : await this.applierRole(client, pairing, Date.now());
      if (pendingIntents.length > 0 && role !== 'leader') {
        for (const p of pendingIntents) retryFloor = Math.min(retryFloor, p.seq);
      } else if (pendingIntents.length > 0) {
        const outcomes = await this.applyPending(pendingIntents);
        for (const p of pendingIntents) {
          const outcome = outcomes.get(p.intentId) ?? 'failed';
          if (outcome === 'deferred' || outcome === 'failed') {
            // Dirty editor buffer (nothing written) or a failed write: hold
            // the drain cursor below this row (see retryFloor) so the next
            // drain re-lists and retries it.
            retryFloor = Math.min(retryFloor, p.seq);
            continue;
          }
          applied.add(p.intentId);
          appliedDirty = true;
          if (outcome === 'applied') {
            this.deleteIntentRow(client, p.entityId, pairing.accountId);
          } else {
            this.unsupported.add(p.intentId); // persisted with the applied set below
          }
        }
      }
      // The fleet-wide half: tell every dayGLANCE device what this copy
      // holds and what it is holding back (on change, else hourly).
      await this.publishCopyStatus(client, pairing);
      // THE CURSOR FLOOR: `since` keeps advancing so pagination works, but
      // neither the in-memory nor the persisted cursor may pass an intent
      // row that is still unconsumed (deferred on a dirty buffer, failed, or
      // left for the lease holder) — the row's seq is fixed at write time,
      // so a cursor past it makes it invisible to every future list. Rows
      // between the floor and the last page get re-listed next drain;
      // re-seeing them is free (applied-set hits and tombstone skips are
      // cursor-movement-only).
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
        // stateSnapshot carries every other field (config, adopted scope,
        // linked notes, pending observations, unsupported ids) forward —
        // this save REPLACES the state object, and a bare object here
        // once dropped the linked-note map on every intent persist.
        await this.host.saveBridgeState(this.stateSnapshot({
          appliedIds: ids.slice(Math.max(0, ids.length - APPLIED_IDS_CAP)),
          hwm: Math.max(persistedHwm, cursor),
        }));
        persistedHwm = Math.max(persistedHwm, cursor);
        appliedDirty = false;
      }
      this.noteSuccess();
      // PROOF: a successful authenticated drain is what arms (or re-arms)
      // live sync — the other half of the armed-by-proof invariant. The 30s
      // tick runs drains regardless, so proof arrives within one tick of
      // credentials working.
      this.sseArming.noteDrainSuccess();
      this.maybeStartSse();
      if (!this.disposed) this.host.onSynced?.();
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
    if (intent.type === 'project_note_link' || intent.type === 'project_note_unlink') {
      return this.applyLinkIntent(intent);
    }
    if (intent.type === 'project_note_create') {
      return this.applyCreateIntent(intent);
    }
    if (intent.type === 'wiki_note_write') {
      // Wikilink resolution is the applier's job (the one intent type
      // without an emitter-resolved path): an existing note anywhere in
      // the vault wins; otherwise create under newNotesFolder.
      const noteName = asText(intent.noteName);
      const existing = this.host.app.metadataCache.getFirstLinkpathDest(noteName, '');
      if (existing) {
        path = existing.path;
      } else if (noteName.includes('/')) {
        path = `${noteName}.md`;
      } else {
        const folder = asText(intent.newNotesFolder);
        path = folder ? `${folder}/${noteName}.md` : `${noteName}.md`;
      }
    } else {
      path = asText(intent.path);
    }
    if (!path) return 'applied';
    path = normalizePath(path);

    const exists = await adapter.exists(path);
    const current = exists ? await adapter.read(path) : null;
    // DAILY-NOTE CREATION THROUGH THE TEMPLATE LADDER (companion §4.4 build
    // record, 2026-09-06). A daily note is created because dayGLANCE needed
    // somewhere to write — a task append or a completion-log entry — and
    // since the posture ruling that creation ALWAYS happens here, in a
    // running Obsidian, at apply time: a paired device with Obsidian closed
    // queues the intent rather than creating anything. So this is the one
    // creation point a template note can be rendered at, through the same
    // ladder project and goal notes use. Without a template note the
    // intent's own text template stands (dailyNoteCreationBody, below).
    if (current === null && isDailyNoteCreation(intent)) {
      const dailyTemplate = normalizeProjectNoteSettings(this.host.getProjectNotes?.() ?? null).dailyTemplate;
      if (dailyTemplate) return this.applyDailyNoteCreation(path, intent, dailyTemplate);
    }
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

  // ── Project and goal notes (companion §4.3) ─────────────────────────────
  //
  // Ruling A: the durable identity of a link is the `dayglance-id` key in the
  // note's frontmatter; the path on the dayGLANCE record is a cached locator.
  // The plugin is the only writer of the key and the only observer of
  // renames and deletes, so it reports LINK observations — one row per
  // target id (linkObservationEntityId), upserted: the row is the latest
  // state — and reconciles the vault against `linked` (what it last
  // reported) on every relevant event plus a periodic full walk, which is
  // how a rename that happened while the plugin was off is re-found by key.

  /** The dayGLANCE id a note's frontmatter carries, or null. */
  private noteLinkId(path: string): string | null | undefined {
    const file = this.host.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) return undefined; // no such note
    if (file.extension !== 'md') return null;
    const raw: unknown = this.host.app.metadataCache.getFileCache(file)?.frontmatter?.[PROJECT_NOTE_ID_KEY];
    const id = typeof raw === 'string' ? raw.trim() : (typeof raw === 'number' ? String(raw) : '');
    return id && id.length <= 64 ? id : null;
  }

  /** Reconcile one path against what was last reported; emit on change. A
   *  failed emission rolls the map back so the next pass re-derives it. */
  private async syncLink(path: string, deleted: boolean): Promise<void> {
    if (this.disposed) return;
    const prev = this.linked.get(path);
    const id = deleted ? undefined : this.noteLinkId(path);
    if (id === undefined) {
      // The note is gone (event, or a walk that no longer finds it).
      if (prev === undefined) return;
      this.linked.delete(path);
      if (!(await this.emitLink({ targetId: prev, path, deleted: true }))) this.linked.set(path, prev);
      void this.persistLinked();
      return;
    }
    if (id === prev || (id === null && prev === undefined)) return;
    if (id) {
      this.linked.set(path, id);
      if (prev && prev !== id) void this.emitLink({ targetId: prev, path, unlinked: true });
      if (!(await this.emitLink({ targetId: id, path }))) { if (prev) this.linked.set(path, prev); else this.linked.delete(path); }
    } else if (prev !== undefined) {
      this.linked.delete(path);
      if (!(await this.emitLink({ targetId: prev, path, unlinked: true }))) this.linked.set(path, prev);
    }
    void this.persistLinked();
    this.linkScopeChanged(path);
  }

  /**
   * The link is the scope (companion §4.3, project routing): a note that
   * became linked is adopted on the spot; one that stopped being linked is
   * withdrawn (ruling C) unless the folder/tag scope still holds it.
   */
  private linkScopeChanged(path: string): void {
    if (this.isDailyNote(path)) return;
    const scoped = this.scopedNote(path);
    if (scoped && !this.adopted.has(path)) {
      this.adopted.add(path);
      this.armObserve(path, false, 0);
      void this.persistAdopted();
    } else if (!scoped && this.adopted.has(path)) {
      this.adopted.delete(path);
      this.scopedPaths.delete(path);
      void this.emitWithdrawal(path);
      void this.persistAdopted();
    }
  }

  /** A note's metadata changed (frontmatter edits arrive here, not on modify). */
  noteMetaChanged(path: string): void {
    if (this.disposed || !this.host.getPairing()) return;
    void this.syncLink(path, false);
  }

  /** A rename keeps the link: the row for the id simply moves to the new path. */
  /** A note appeared at a path (vault create event): remember the arrival, then observe. */
  noteCreated(file: TFile): void {
    if (this.disposed) return;
    this.arrivedAt.set(file.path, Date.now());
    this.scheduleObservation(file);
  }

  /**
   * A rename or move (vault rename event). Three things ride it:
   *   • a linked project note keeps its link (companion §4.3, ruling A);
   *   • the TASK SCOPE is re-classified (companion §6, ruling C): a scoped
   *     note leaving the scope is WITHDRAWN, never reported deleted — the
   *     note still exists, and the withdrawal path is the one that remembers
   *     it for re-entry; a note entering the scope is adopted on the spot;
   *     a move within the scope carries its adoption to the new path;
   *   • the new path records an arrival time (see arrivedAt).
   * Then the old path reports (a deletion, if it was daily or still counts
   * as scoped) and the new path is observed.
   */
  noteRenamed(oldPath: string, file: TFile): void {
    if (this.disposed) return;
    const newPath = file.path;
    this.arrivedAt.set(newPath, Date.now());
    this.moveLink(oldPath, newPath);
    const wasScoped = this.scopedPaths.has(oldPath) || this.adopted.has(oldPath);
    const nowScoped = this.scopedNote(newPath);
    if (wasScoped) {
      this.adopted.delete(oldPath);
      this.scopedPaths.delete(oldPath);
      if (nowScoped) {
        this.adopted.add(newPath);
        // Moved within the scope: the old path's row would otherwise keep
        // reporting the note there forever (#2291 follow-up: task notes).
        void this.emitMovedAway(oldPath);
      } else {
        // Left the scope by moving out: withdrawn (ruling C), not deleted.
        void this.emitWithdrawal(oldPath);
      }
      void this.persistAdopted();
    } else if (nowScoped) {
      this.adopted.add(newPath);
      void this.persistAdopted();
    }
    this.reportDeleted(oldPath);
    this.scheduleObservation(file);
  }

  private moveLink(oldPath: string, newPath: string): void {
    const id = this.linked.get(oldPath);
    if (id === undefined) return;
    this.linked.delete(oldPath);
    this.linked.set(newPath, id);
    void this.persistLinked();
    void this.emitLink({ targetId: id, path: newPath, previousPath: oldPath }).then((ok) => {
      if (ok) return;
      // Roll back to the old path: the next walk reports the delete and the
      // new note's key as two ordinary observations.
      this.linked.delete(newPath);
      this.linked.set(oldPath, id);
      void this.persistLinked();
    });
  }

  /** The periodic full walk (layout ready, then every LINK_RESCAN_MS): every
   *  markdown file's key against the map, and every mapped path's existence. */
  linkTick(): void {
    if (this.disposed || !this.host.getPairing()) return;
    const now = Date.now();
    if (now - this.linkScanAt < LINK_RESCAN_MS) return;
    this.linkScanAt = now;
    const seen = new Set<string>();
    for (const f of this.host.app.vault.getMarkdownFiles()) {
      seen.add(f.path);
      void this.syncLink(f.path, false);
    }
    for (const path of [...this.linked.keys()]) if (!seen.has(path)) void this.syncLink(path, true);
  }

  private async persistLinked(): Promise<void> {
    if (this.disposed) return;
    try {
      const state = this.host.getBridgeState();
      const next = Object.fromEntries([...this.linked].sort(([a], [b]) => a.localeCompare(b)));
      if (JSON.stringify(state.linkedNotes ?? {}) === JSON.stringify(next)) return;
      await this.host.saveBridgeState(this.stateSnapshot({ linkedNotes: next }));
      this.host.onLinkedNotesChanged?.();
    } catch (e) {
      console.error('dayGLANCE bridge: could not persist the linked notes', e);
    }
  }

  private async emitLink(fields: { targetId: string; path: string; deleted?: boolean; unlinked?: boolean; previousPath?: string }): Promise<boolean> {
    try {
      const pairing = this.host.getPairing();
      if (!pairing || this.rateLimited() || this.stalePairing) return false; // stale: the caller re-derives later
      const subkey = await this.subkeyFor(pairing);
      const payload: Record<string, unknown> = { v: 1, kind: 'observation', link: true, ...fields, observedAt: new Date().toISOString() };
      const ack = await this.client(pairing).batch(BRIDGE_VAULT_APP, {
        accountId: pairing.accountId,
        rows: [{ entityId: linkObservationEntityId(fields.targetId), envelope: await sealBridgeEnvelope(subkey, payload, pairing.generation), createdAt: Date.now() }],
      });
      const ackSeq = Number((ack as { maxSeq?: unknown } | null)?.maxSeq);
      if (Number.isFinite(ackSeq)) this.sseGate.recordOwnSeq(ackSeq);
      return true;
    } catch (e) {
      if (isRateLimitError(e)) this.noteRateLimit();
      console.warn('dayGLANCE bridge: link report failed (re-derived on the next pass)', e);
      return false;
    }
  }

  /** Write (or remove) the id key through Obsidian's frontmatter API. The
   *  same dirty-buffer rule as every other write: unsaved keystrokes defer. */
  private async setNoteLink(file: TFile, targetId: string | null): Promise<'applied' | 'deferred'> {
    const path = file.path;
    const current = await this.host.app.vault.adapter.read(path);
    if (this.markdownViews(path).some((v) => v.getViewData() !== current)) return 'deferred';
    const prev = this.linked.get(path);
    await this.host.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      if (targetId) fm[PROJECT_NOTE_ID_KEY] = targetId;
      else delete fm[PROJECT_NOTE_ID_KEY];
    });
    if (targetId) {
      this.linked.set(path, targetId);
      if (prev && prev !== targetId) void this.emitLink({ targetId: prev, path, unlinked: true });
      if (prev !== targetId && !(await this.emitLink({ targetId, path }))) { if (prev) this.linked.set(path, prev); else this.linked.delete(path); }
    } else if (prev !== undefined) {
      this.linked.delete(path);
      if (!(await this.emitLink({ targetId: prev, path, unlinked: true }))) this.linked.set(path, prev);
    }
    void this.persistLinked();
    return 'applied';
  }

  private async applyLinkIntent(intent: Record<string, unknown>): Promise<'applied' | 'deferred'> {
    const path = normalizePath(asText(intent.path));
    const targetId = asText(intent.targetId).trim();
    if (!path || !targetId) return 'applied';
    let file = this.host.app.vault.getAbstractFileByPath(path);
    const link = intent.type === 'project_note_link';
    if (!(file instanceof TFile) && !path.includes('/')) {
      // A folder-less path: a bare [[Name]] typed into a project's title on
      // a device without the plugin, or into the note row. dayGLANCE's own
      // reader finds such a note anywhere in the vault, so the plugin
      // resolves it the same way, as Obsidian resolves a link. The link
      // report carries the note's real path and the record's locator
      // follows it (the rename path). A path WITH a folder is explicit and
      // stays missing when nothing is there.
      const resolved = this.host.app.metadataCache.getFirstLinkpathDest(path.replace(/\.md$/i, ''), '');
      if (resolved instanceof TFile) file = resolved;
    }
    if (!(file instanceof TFile) || file.extension !== 'md') {
      // The note dayGLANCE named does not exist here: ruling F, the record
      // learns its note is missing (a relink or an unlink resolves it).
      if (link) await this.emitLink({ targetId, path, deleted: true });
      return 'applied';
    }
    if (!link && this.noteLinkId(file.path) !== targetId) return 'applied'; // not ours to remove
    return this.setNoteLink(file, link ? targetId : null);
  }

  /** Every linked note, path → dayGLANCE id (for the block writer). */
  linkedNotes(): ReadonlyMap<string, string> { return this.linked; }

  /** The shared write rule, for writers outside this class: unsaved keystrokes exist for `path`. */
  async bufferDirty(path: string): Promise<boolean> {
    const views = this.markdownViews(path);
    if (!views.length) return false;
    const current = await this.host.app.vault.adapter.read(path);
    return views.some((v) => v.getViewData() !== current);
  }

  // ── Workspace creation (companion §4.3, rulings D and E) ─────────────────

  /** The linked note's path for a dayGLANCE id, or null. */
  private linkedPathOf(targetId: string): string | null {
    for (const [path, id] of this.linked) if (id === targetId) return path;
    return null;
  }

  /**
   * Create a daily note from the configured template note, then apply the
   * intent to it. Two steps on purpose: the note is created first with the
   * intent's own fallback body (a NON-EMPTY file, so a Templater folder
   * template never races the write, and so the note already stands
   * correct if the render fails), then rendered against that TFile —
   * Templater's running config wants the real target — and rewritten with
   * the intent applied to the rendered body.
   */
  private async applyDailyNoteCreation(path: string, intent: Record<string, unknown>, templatePath: string): Promise<'applied' | 'deferred'> {
    const date = asText(intent.date);
    // Under Templater's on-create trigger the fallback text is rendered by
    // Templater too, so it gets the same pre-scan as a template note.
    const safeIntent = { ...intent, template: this.safeFallbackTemplate(asText(intent.template)) };
    const first = applyBridgeIntent(null, safeIntent);
    if ('unsupported' in first || 'error' in first || !first.changed || first.text === null) return 'applied';
    await this.ensureParentDirs(path);
    let created: TFile;
    try {
      created = await this.host.app.vault.create(path, first.text);
    } catch (e) {
      // The path appeared between the existence check and the create (a
      // race with Obsidian or a sync): the ordinary apply path handles an
      // existing note on the next drain.
      console.warn(`dayGLANCE bridge: could not create ${path}; retrying on the next drain`, e);
      return 'deferred';
    }
    const body = await this.renderTemplate(templatePath, created, { title: created.basename, date, goal: '' });
    if (body === null) return 'applied'; // template missing or refused: the fallback note stands
    const second = applyBridgeIntent(withCreationFrontmatter(body, date), safeIntent);
    if ('unsupported' in second || 'error' in second || second.text === null) return 'applied';
    await this.host.app.vault.modify(created, second.text);
    return 'applied';
  }

  /**
   * Is Templater's "trigger on new file creation" on? THE SECOND DOOR
   * (companion §4.4, build caution): our pre-scan guards the render WE
   * perform, but with this trigger on Templater renders every new file
   * itself, whether we delegated or not — and an interactive call in it
   * hangs invisibly outside our guard. As of Templater 2.21 the setting is
   * device-local (`templater-local-settings` in Obsidian's local storage);
   * older builds kept it in the synced plugin settings. Both are read.
   */
  private templaterOnCreateTrigger(): boolean {
    try {
      const app = this.host.app as unknown as { loadLocalStorage?: (k: string) => unknown; plugins?: { plugins?: Record<string, unknown> } };
      const raw = typeof app.loadLocalStorage === 'function' ? app.loadLocalStorage('templater-local-settings') : null;
      const local = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw;
      if (local && typeof local === 'object' && (local as Record<string, unknown>).trigger_on_file_creation === true) return true;
      const tp = app.plugins?.plugins?.['templater-obsidian'] as { settings?: Record<string, unknown> } | undefined;
      return tp?.settings?.trigger_on_file_creation === true;
    } catch {
      return false;
    }
  }

  /**
   * The app's text template as a fallback BODY: under the on-create
   * trigger Templater will render whatever we write, so an interactive
   * call in it is the same hang; strip to the bare note and say so.
   */
  private safeFallbackTemplate(text: string): string {
    if (!text || !templateNeedsUser(text) || !this.templaterOnCreateTrigger()) return text;
    this.noteTemplateIssue('The daily-note text template from dayGLANCE was not applied: it contains a tp.system.* call and Templater\'s "trigger on new file creation" is on, which would run that prompt unattended. Turn the trigger off, or take the prompt out of the template.');
    return '';
  }

  private templateIssue: string | null = null;
  /** The last template problem worth a settings-tab line (null: none since the plugin loaded). */
  templateStatus(): string | null { return this.templateIssue; }
  private noteTemplateIssue(message: string): void {
    if (this.templateIssue !== message) console.warn(`dayGLANCE bridge: ${message}`);
    this.templateIssue = message;
  }

  /**
   * Render a template note for a new project, goal or daily note through
   * the §4.4 ladder: Templater when it is installed, its render methods
   * feature-detect, and the template asks nothing interactively
   * (`tp.system.` would open a modal nobody is looking at and never settle);
   * otherwise the subset renderer, leaving unsupported variables visible.
   * Null when the template note does not exist — or when it is interactive
   * AND Templater's on-create trigger is on: the subset would leave the
   * interactive call visible, and the trigger would then run it on the new
   * file outside our guard. Delegating a non-interactive template under the
   * trigger is safe: Templater's second pass finds nothing left to render.
   */
  private async renderTemplate(templatePath: string, target: TFile, vars: { title: string; date: string; goal: string }): Promise<string | null> {
    const tfile = this.host.app.vault.getAbstractFileByPath(normalizePath(templatePath));
    if (!(tfile instanceof TFile)) {
      this.noteTemplateIssue(`Template note "${templatePath}" was not found; the default body was used.`);
      return null;
    }
    const text = await this.host.app.vault.read(tfile);
    const subset = renderNoteTemplateSubset(text, vars);
    if (templateNeedsUser(text)) {
      if (this.templaterOnCreateTrigger()) {
        this.noteTemplateIssue(`Template "${templatePath}" was not applied: it asks for input (tp.system.*) and Templater's "trigger on new file creation" is on, which would run that prompt unattended. Turn the trigger off, or take the prompt out of the template.`);
        return null;
      }
      return subset;
    }
    type Fn = (...args: unknown[]) => unknown;
    const plugins = (this.host.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
    const templater = (plugins?.['templater-obsidian'] as { templater?: Record<string, unknown> } | undefined)?.templater;
    const create = templater?.create_running_config;
    const parse = templater?.read_and_parse_template;
    if (typeof create !== 'function' || typeof parse !== 'function') return subset;
    try {
      // RunMode.CreateNewFromTemplate is 0 in every Templater release since 1.12.
      const config = (create as Fn).call(templater, tfile, target, 0);
      const out = await (parse as Fn).call(templater, config);
      if (typeof out !== 'string') {
        this.noteTemplateIssue(`Templater returned nothing for "${templatePath}"; the subset renderer was used.`);
        return subset;
      }
      return renderNoteTemplateSubset(out, vars);
    } catch (e) {
      console.warn('dayGLANCE bridge: Templater render failed; using the subset renderer', e);
      this.noteTemplateIssue(`Templater failed to render "${templatePath}"; the subset renderer was used.`);
      return subset;
    }
  }

  private async applyCreateIntent(intent: Record<string, unknown>): Promise<'applied'> {
    const targetId = asText(intent.targetId).trim();
    const kind = intent.kind === 'goal' ? 'goal' : 'project';
    const title = asText(intent.title).trim();
    if (!targetId || !title) return 'applied';
    if (this.linkedPathOf(targetId)) return 'applied'; // idempotent replay, or linked meanwhile
    const settings = normalizeProjectNoteSettings(this.host.getProjectNotes?.() ?? null);
    const goalId = typeof intent.goalId === 'string' ? intent.goalId : '';
    const goalTitle = typeof intent.goalTitle === 'string' ? intent.goalTitle : '';
    // Nested layout: a project with a goal goes inside the goal's folder —
    // wherever the goal's note actually lives when it is linked, else the
    // folder the goal would get.
    let goalFolder: string | null = null;
    if (kind === 'project' && settings.layout === 'nested' && goalId) {
      const goalPath = this.linkedPathOf(goalId);
      if (goalPath) goalFolder = goalPath.includes('/') ? goalPath.slice(0, goalPath.lastIndexOf('/')) : '';
      else if (goalTitle) goalFolder = `${settings.goalsFolder}/${noteNameFromTitle(goalTitle)}`;
      if (goalFolder === '') goalFolder = null; // a goal note at the vault root nests nothing
    }
    let path = normalizePath(projectNotePath({ kind, title, ...settings, goalFolder }));
    const existing = this.host.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      // A note already named for it: adopt when it belongs to nobody, step
      // aside when it is another entity's.
      const owner = this.noteLinkId(path);
      if (!owner) { await this.setNoteLink(existing, targetId); return 'applied'; }
      if (owner === targetId) return 'applied';
      path = uniqueNotePath(path, (p) => this.host.app.vault.getAbstractFileByPath(p) !== null);
    }
    await this.ensureParentDirs(path);
    const today = new Date().toISOString().slice(0, 10);
    // The notes box at creation (owner ruling 2026-10-03): the description
    // slot of the default notes, and {{description}} in a template.
    const description = typeof intent.description === 'string' ? intent.description : '';
    const vars = { title, date: today, goal: goalTitle, description };
    // The default body (companion §4.3, templates ruling): chosen ONCE, at
    // creation, by whether Dataview is installed; never maintained after.
    const plugins = (this.host.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins ?? {};
    const hasDataview = !!plugins['dataview'];
    const dailyFolder = this.config?.dailyNotesPath ?? '';
    const defaultBody = kind === 'goal'
      ? defaultGoalNote({ title, date: today, hasDataview, dailyFolder, description })
      : defaultProjectNote({ title, date: today, hasDataview, dailyFolder, description });
    let created: TFile;
    try {
      created = await this.host.app.vault.create(path, withCreationFrontmatter(defaultBody, today));
    } catch (e) {
      console.error(`dayGLANCE bridge: could not create ${path}`, e);
      return 'applied';
    }
    const templatePath = kind === 'goal' ? settings.goalTemplate : settings.projectTemplate;
    if (templatePath) {
      const body = await this.renderTemplate(templatePath, created, vars);
      if (body !== null) await this.host.app.vault.modify(created, withCreationFrontmatter(body, today));
    }
    await this.setNoteLink(created, targetId);
    return 'applied';
  }

  /** The palette command: link the given note to a project or goal. */
  async linkNote(file: TFile, targetId: string): Promise<{ ok: boolean; message: string }> {
    if (!this.host.getPairing()) return { ok: false, message: 'not paired.' };
    const r = await this.setNoteLink(file, targetId);
    return r === 'deferred'
      ? { ok: false, message: 'the note has unsaved changes; save it and retry.' }
      : { ok: true, message: `linked "${file.basename}".` };
  }

  /** The palette command: remove the note's link, whatever it names. */
  async unlinkNote(file: TFile): Promise<{ ok: boolean; message: string }> {
    if (!this.host.getPairing()) return { ok: false, message: 'not paired.' };
    if (!this.noteLinkId(file.path)) return { ok: true, message: `"${file.basename}" is not linked.` };
    const r = await this.setNoteLink(file, null);
    return r === 'deferred'
      ? { ok: false, message: 'the note has unsaved changes; save it and retry.' }
      : { ok: true, message: `unlinked "${file.basename}".` };
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
    if (this.scopedNote(path)) return true;
    return content !== null && (content.includes('^dg-') || /#obsidian\b/i.test(content));
  }

  // ── Vault task scope (companion §6) ──────────────────────────────────────

  /**
   * A non-daily note in the user's scope (folders and/or tags, ruling D) —
   * or a note LINKED to a dayGLANCE project or goal (companion §4.3, project
   * routing): the link is the scope. A project's task list lives in its
   * note, so the note is observed whether or not its folder is scoped.
   */
  private scopedNote(path: string): boolean {
    if (this.linked.has(path)) return !this.isDailyNote(path);
    const scope = this.host.getScope?.() ?? null;
    if (!scope || !scopeIsActive(scope)) return false;
    if (!path.endsWith('.md') || path.startsWith('.') || this.isDailyNote(path)) return false;
    const file = this.host.app.vault.getAbstractFileByPath(normalizePath(path));
    const cache = file instanceof TFile ? this.host.app.metadataCache.getFileCache(file) : null;
    const tags = cache ? (getAllTags(cache) ?? []) : [];
    return noteInScope(path, tags, scope);
  }

  /** The minting key for stamping (ruling A): the note date, or the path for a scoped note; null = never stamp. */
  private stampKey(path: string): string | null {
    const date = this.dailyNoteDate(path);
    if (date) return date;
    return this.scopedNote(path) ? noteKeyForPath(path) : null;
  }

  /** Stamp options: the completion window applies to scoped notes only (ruling E). */
  private stampOptions(path: string): { completedSince: string | null } {
    if (this.dailyNoteDate(path)) return { completedSince: null };
    // A linked note with no scope setting takes the default window: the
    // window governs adoption of untracked completed lines only.
    const scope = this.host.getScope?.() ?? (this.linked.has(path) ? normalizeScope(null) : null);
    if (!scope) return { completedSince: null };
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return { completedSince: completedSinceFor(scope, today) };
  }

  /**
   * ADOPTION, throttled: report notes that entered scope and have not been
   * reported since, ADOPT_PER_TICK per call (main.ts calls this on the 30s
   * tick). The candidate walk runs once per scope change, over Obsidian's
   * already-parsed metadata cache — no file reads until a note is reported.
   */
  adoptTick(): void {
    if (this.disposed || !this.host.getPairing()) return;
    const scope = this.host.getScope?.() ?? null;
    if (!(scope && scopeIsActive(scope)) && this.linked.size === 0) return;
    if (!this.adoptScanned) {
      this.adoptScanned = true;
      this.adoptQueue = this.host.app.vault.getMarkdownFiles()
        .map((f) => f.path)
        .filter((path) => !this.adopted.has(path) && this.scopedNote(path))
        .sort();
      if (this.adoptQueue.length) console.debug(`dayGLANCE bridge: ${this.adoptQueue.length} note(s) entering the task scope; reporting ${ADOPT_PER_TICK} per tick.`);
    }
    const batch = this.adoptQueue.splice(0, ADOPT_PER_TICK);
    if (!batch.length) return;
    for (const path of batch) {
      this.adopted.add(path);
      this.armObserve(path, false, 0);
    }
    void this.persistAdopted();
  }

  /**
   * The scope setting changed: notes that left it are WITHDRAWN (ruling C —
   * dayGLANCE drops their tasks; stamps stay in the file), and the adoption
   * walk re-runs so notes that entered it are reported.
   */
  scopeChanged(): void {
    if (this.disposed) return;
    for (const path of [...this.adopted]) {
      if (this.scopedNote(path)) continue;
      this.adopted.delete(path);
      this.scopedPaths.delete(path);
      void this.emitWithdrawal(path);
    }
    this.adoptScanned = false;
    this.adoptQueue = [];
    void this.persistAdopted();
  }

  private async persistAdopted(): Promise<void> {
    if (this.disposed) return;
    try {
      const state = this.host.getBridgeState();
      const next = [...this.adopted];
      const prev = state.adoptedScope ?? [];
      if (prev.length === next.length && prev.every((p, i) => p === next[i])) return;
      await this.host.saveBridgeState(this.stateSnapshot({ adoptedScope: next }));
    } catch (e) {
      console.error('dayGLANCE bridge: could not persist the adopted scope', e);
    }
  }

  /** A note left the scope: tell dayGLANCE to withdraw its tasks (no deletion anywhere). */
  private async emitWithdrawal(path: string): Promise<void> {
    try {
      const pairing = this.host.getPairing();
      if (!pairing || this.rateLimited() || this.stalePairing) return;
      const subkey = await this.subkeyFor(pairing);
      const payload = { v: 1, kind: 'observation', path, withdrawn: true, observedAt: new Date().toISOString() };
      const ack = await this.client(pairing).batch(BRIDGE_VAULT_APP, {
        accountId: pairing.accountId,
        rows: [{ entityId: await observationEntityId(path), envelope: await sealBridgeEnvelope(subkey, payload, pairing.generation), createdAt: Date.now() }],
      });
      const ackSeq = Number((ack as { maxSeq?: unknown } | null)?.maxSeq);
      if (Number.isFinite(ackSeq)) this.sseGate.recordOwnSeq(ackSeq);
    } catch (e) {
      console.warn('dayGLANCE bridge: withdrawal report failed (the note is simply no longer reported)', e);
    }
  }

  /**
   * A scoped note moved to another path IN the scope: its old path's row is
   * replaced with a gone report, so nothing reads the note there any more
   * (a task panel resolving a name through dayGLANCE's index of reported
   * paths would otherwise see the note twice, the old copy stale; #2291
   * follow-up). NOT flagged scoped, on purpose: a scoped deletion feeds the
   * app's note-scoped deletion inference, which would tombstone the moved
   * tasks before the new path is observed (the 2026-09-04 field record).
   * Unflagged and not a daily note, the app's merge leaves it unapplied;
   * the tasks follow the new path by id. Best effort, like a withdrawal.
   */
  private async emitMovedAway(path: string): Promise<void> {
    try {
      const pairing = this.host.getPairing();
      if (!pairing || this.rateLimited() || this.stalePairing) return;
      const subkey = await this.subkeyFor(pairing);
      const payload = { v: 1, kind: 'observation', path, content: null, deleted: true, moved: true, observedAt: new Date().toISOString() };
      const ack = await this.client(pairing).batch(BRIDGE_VAULT_APP, {
        accountId: pairing.accountId,
        rows: [{ entityId: await observationEntityId(path), envelope: await sealBridgeEnvelope(subkey, payload, pairing.generation), createdAt: Date.now() }],
      });
      const ackSeq = Number((ack as { maxSeq?: unknown } | null)?.maxSeq);
      if (Number.isFinite(ackSeq)) this.sseGate.recordOwnSeq(ackSeq);
    } catch (e) {
      console.warn('dayGLANCE bridge: moved-note report failed (the old path keeps its last report)', e);
    }
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
    this.markPending(path);
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
    this.markPending(path);
    try {
      const pairing = this.host.getPairing();
      if (!pairing) return;
      // A stale copy reports nothing (the pairing split, rule 2): its
      // report would be sealed under a key dayGLANCE no longer derives, and
      // it would stamp lines it then could not report. The path stays
      // pending and is resumed when the current pairing arrives.
      if (this.stalePairing) return;
      // A DELETED report re-checks existence at emit time (audit fix M12):
      // a deleted report's retry (armed on a failure) coalesces per path with
      // a recreated file's pending live observation, so the stale retry used
      // to cancel that observation and report the note gone while it stood.
      // The live path had this check; the deleted path skipped it. Now a
      // path that exists is reported as it is, whatever the event said.
      if (deleted) {
        try { if (await this.host.app.vault.adapter.exists(path)) deleted = false; } catch { /* keep the report */ }
      }
      if (this.rateLimited()) {
        // Don't drop the report — this could be the note's LAST edit, and a
        // dropped observation only re-reports on the next touch. Re-arm for
        // just after the brake lifts (per-path, so re-edits coalesce).
        this.armObserve(path, deleted, Math.max(1000, this.backoffUntil - Date.now() + 1000));
        return;
      }
      // Project and goal notes (companion §4.3): reconcile this note's link
      // before any scope gate — a linked note need not be a task source.
      await this.syncLink(path, deleted);
      const adapter = this.host.app.vault.adapter;
      let content: string | null = null;
      let mtime: number | null = null;
      if (!deleted) {
        if (!(await adapter.exists(path))) { this.clearPending(path); return; }
        content = await adapter.read(path);
        try { mtime = (await adapter.stat(path))?.mtime ?? null; } catch { /* stat optional */ }
      }
      if (deleted ? !(this.isDailyNote(path) || this.scopedPaths.has(path)) : !this.inScope(path, content)) { this.clearPending(path); return; }

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
      // A SCOPED note holds too (harness finding, 2026-09-04): its lines
      // are stamped by the same block, so reporting it config-null would
      // ship untagged lines and mint provisional ids in dayGLANCE — the
      // fragment factory, one scope over.
      if (this.config === null && !deleted && (this.isDailyNote(path) || this.scopedNote(path))) {
        if (!this.warnedConfigHold) {
          this.warnedConfigHold = true;
          console.warn('dayGLANCE bridge: no config row known yet — note reporting held (fail closed) until it arrives.');
        }
        this.armObserve(path, deleted, CONFIG_HOLD_RETRY_MS);
        return;
      }
      if (this.config === null && deleted && this.isDailyNote(path)) {
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
        // The stamp key is the note date, or the path for a scoped note
        // (ruling A); scoped notes stamp only lines inside the completion
        // window (ruling E). Wiki notes carrying ^dg- text have no key.
        const noteDate = this.stampKey(path);
        const stampOpts = this.stampOptions(path);
        if (noteDate && stampUntaggedTaskLines(content, noteDate, stampOpts).changed) {
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
            const plan = planStampInsertions(buffer, noteDate, stampOpts);
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
            const plan = planStampInsertions(buffer, noteDate, stampOpts);
            const settled = settleStampPlan(plan, splitNoteLines(buffer).lines, this.stampSettle.get(path), Date.now());
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
            const plan = planStampInsertions(content, noteDate, stampOpts);
            // Lines are compared and edited '\r'-free and re-joined with the
            // note's own ending (splitNoteLines): a CRLF note used to get the
            // one stamped line rewritten LF (audit low, 2026-09-06).
            const contentLines = splitNoteLines(content).lines;
            const settled = settleStampPlan(plan, contentLines, this.stampSettle.get(path), Date.now());
            if (settled.nextState.size > 0) this.stampSettle.set(path, settled.nextState);
            else this.stampSettle.delete(path);
            if (settled.apply.length > 0) {
              const settledKeys = new Set(settled.apply.map((p) => contentLines[p.line]));
              await this.host.app.vault.process(file, (data) => {
                const { lines, eol } = splitNoteLines(data);
                for (const p of planStampInsertions(data, noteDate, stampOpts)) {
                  if (!settledKeys.has(lines[p.line])) continue;
                  lines[p.line] = lines[p.line].slice(0, p.fromCh) + p.insert;
                }
                return lines.join(eol);
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

      // A scoped (non-daily) note is flagged so dayGLANCE parses it under
      // the path key and never as a daily note; remembered so its deletion
      // reports too.
      const scoped = !this.isDailyNote(path) && (deleted ? this.scopedPaths.has(path) : this.scopedNote(path));
      if (scoped && !deleted) this.scopedPaths.add(path);
      if (deleted) { this.scopedPaths.delete(path); this.arrivedAt.delete(path); }
      // A scoped note that arrived here by create or move is evidence as of
      // its arrival (see arrivedAt): revival after a withdrawal or a
      // deletion needs the note to be NEWER than the tombstone, and a move
      // leaves the file's own mtime untouched.
      const arrival = this.arrivedAt.get(path);
      if (scoped && !deleted && arrival !== undefined && (mtime === null || arrival > mtime)) mtime = arrival;
      const subkey = await this.subkeyFor(pairing);
      const payload = {
        v: 1, kind: 'observation', path,
        content, deleted: deleted || undefined,
        scoped: scoped || undefined,
        mtime, observedAt: new Date().toISOString(),
      };
      const ack = await this.client(pairing).batch(BRIDGE_VAULT_APP, {
        accountId: pairing.accountId,
        rows: [{
          entityId: await observationEntityId(path),
          envelope: await sealBridgeEnvelope(subkey, payload, pairing.generation),
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
      // Reported: the pending mark is released only if no NEWER arm for the
      // path replaced this one while it was in flight (that arm re-marks).
      if (!this.observeTimers.has(path)) this.clearPending(path);
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
