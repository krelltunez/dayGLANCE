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

import { App, TFile, normalizePath, requestUrl } from 'obsidian';
import {
  applyBridgeIntent,
  openBridgeEnvelope,
  sealBridgeEnvelope,
  encodePlainBridgeRow,
  observationEntityId,
  importBridgeSubkey,
  buildDateParser,
  parseDateFromFilename,
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
}

const APPLIED_IDS_CAP = 1000;
const OBSERVE_DEBOUNCE_MS = 2000;
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
  private subkey: CryptoKey | null = null;
  private subkeyGeneration: string | null = null;
  private draining = false;
  private config: BridgeConfigRow | null = null;
  private observeTimers = new Map<string, number>();
  private warnedUnsupported = false;
  // Once per plugin load (per generation), the drain re-asserts the
  // meta:pairing row. Normally a no-op overwrite; it is also the self-heal
  // for a row an older build wrote in the pre-base64 wire format (stored
  // as garbage) — without it, dayGLANCE devices could never discover the
  // pairing until the user re-paired.
  private metaAssertedGeneration: string | null = null;
  private backoffMs = 0;
  private backoffUntil = 0;

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
  }

  private client(pairing: BridgePairing): VaultClient {
    return createVaultClient({
      vaultUrl: pairing.vaultUrl, vaultToken: pairing.deviceToken, fetchImpl: obsidianFetch,
    });
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
    const pairing = this.host.getPairing();
    if (!pairing || this.draining || this.rateLimited()) return;
    this.draining = true;
    try {
      const client = this.client(pairing);
      const subkey = await this.subkeyFor(pairing);
      if (this.metaAssertedGeneration !== pairing.generation) {
        await publishPairingMeta(pairing);
        this.metaAssertedGeneration = pairing.generation;
      }
      const state = this.host.getBridgeState();
      const applied = new Set(state.appliedIds);
      let since = state.hwm;
      let hasMore = true;
      while (hasMore) {
        const page = await client.list(BRIDGE_VAULT_APP, { accountId: pairing.accountId, since });
        hasMore = !!page.hasMore;
        const rows = (page.rows ?? []) as Array<{ entityId?: string; envelope?: string; seq?: number }>;
        if (rows.length === 0) break;
        let batchMax = since;
        for (const row of rows) {
          const seq = Number(row.seq) || 0;
          if (seq > batchMax) batchMax = seq;
          const entityId = String(row.entityId ?? '');
          if (!entityId.startsWith(BRIDGE_INTENT_PREFIX)) {
            // meta rows and our own observations also live here; refresh the
            // config cache opportunistically, skip everything else.
            if (entityId === BRIDGE_CONFIG_META_ID && row.envelope) {
              const cfg = await openBridgeEnvelope(subkey, row.envelope) as (BridgeConfigRow & { kind?: string }) | null;
              if (cfg?.kind === 'config') this.config = cfg;
            }
            continue;
          }
          const intentId = entityId.slice(BRIDGE_INTENT_PREFIX.length);
          if (applied.has(intentId)) {
            void client.deleteRow(BRIDGE_VAULT_APP, entityId, pairing.accountId).catch(() => {});
            continue;
          }
          const intent = row.envelope ? await openBridgeEnvelope(subkey, row.envelope) : null;
          if (intent === null) {
            // Sealed under a rotated-away generation (or tampered): can never
            // be applied by anyone — treat as consumed.
            applied.add(intentId);
            void client.deleteRow(BRIDGE_VAULT_APP, entityId, pairing.accountId).catch(() => {});
            continue;
          }
          try {
            const consumed = await this.applyOne(intent as Record<string, unknown>);
            applied.add(intentId);
            if (consumed) {
              void client.deleteRow(BRIDGE_VAULT_APP, entityId, pairing.accountId).catch(() => {});
            }
          } catch (e) {
            // A vault-write failure leaves the row AND the id unapplied — the
            // next drain retries it (application is idempotent).
            console.error('dayGLANCE bridge: intent apply failed', e);
          }
        }
        since = batchMax;
        // Persist per applied batch — the crash window replays, never skips.
        const ids = [...applied];
        await this.host.saveBridgeState({
          appliedIds: ids.slice(Math.max(0, ids.length - APPLIED_IDS_CAP)),
          hwm: since,
        });
      }
      this.noteSuccess();
    } catch (e) {
      if (isRateLimitError(e)) this.noteRateLimit();
      else console.error('dayGLANCE bridge: drain failed', e);
    } finally {
      this.draining = false;
    }
  }

  /** Apply one decrypted intent. Returns false only for unsupported types
   *  (the row is left in place for newer builds; see the PR discussion). */
  private async applyOne(intent: Record<string, unknown>): Promise<boolean> {
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
    if (!path) return true;
    path = normalizePath(path);

    const exists = await adapter.exists(path);
    const current = exists ? await adapter.read(path) : null;
    const result = applyBridgeIntent(current, intent);
    if ('unsupported' in result) {
      if (!this.warnedUnsupported) {
        this.warnedUnsupported = true;
        console.warn(`dayGLANCE bridge: skipping intent type "${String(intent.type)}" this plugin build does not know`);
      }
      return false;
    }
    if ('error' in result) {
      // The refusal (e.g. unportable creation) IS the outcome — the emitting
      // side surfaced the same refusal to the user.
      return true;
    }
    if (result.changed && result.text !== null) {
      await this.ensureParentDirs(path);
      await adapter.write(path, result.text);
    }
    return true;
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
    const prefix = cfg.dailyNotesPath ? `${cfg.dailyNotesPath.replace(/\/+$/, '')}/` : '';
    if (prefix ? !path.startsWith(prefix) : path.includes('/')) return false;
    const name = path.slice(prefix.length);
    if (!cfg.dailyNotePattern || cfg.dailyNotePattern === 'yyyy-MM-dd') {
      return /^\d{4}-\d{2}-\d{2}\.md$/.test(name);
    }
    try {
      return parseDateFromFilename(name, buildDateParser(cfg.dailyNotePattern)) !== null;
    } catch {
      return false;
    }
  }

  /** Debounced per path; call from vault modify/create events. */
  scheduleObservation(file: TFile): void {
    if (!this.host.getPairing()) return;
    const path = file.path;
    const prior = this.observeTimers.get(path);
    if (prior !== undefined) window.clearTimeout(prior);
    this.observeTimers.set(path, window.setTimeout(() => {
      this.observeTimers.delete(path);
      void this.emitObservation(path, false);
    }, OBSERVE_DEBOUNCE_MS));
  }

  /** Immediate; call from vault delete/rename events (old path). */
  reportDeleted(path: string): void {
    if (!this.host.getPairing()) return;
    void this.emitObservation(path, true);
  }

  private async emitObservation(path: string, deleted: boolean): Promise<void> {
    try {
      const pairing = this.host.getPairing();
      if (!pairing) return;
      if (this.rateLimited()) {
        // Don't drop the report — this could be the note's LAST edit, and a
        // dropped observation only re-reports on the next touch. Re-arm for
        // just after the brake lifts (per-path, so re-edits coalesce).
        const prior = this.observeTimers.get(path);
        if (prior !== undefined) window.clearTimeout(prior);
        this.observeTimers.set(path, window.setTimeout(() => {
          this.observeTimers.delete(path);
          void this.emitObservation(path, deleted);
        }, Math.max(1000, this.backoffUntil - Date.now() + 1000)));
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
      const subkey = await this.subkeyFor(pairing);
      const payload = {
        v: 1, kind: 'observation', path,
        content, deleted: deleted || undefined,
        mtime, observedAt: new Date().toISOString(),
      };
      await this.client(pairing).batch(BRIDGE_VAULT_APP, {
        accountId: pairing.accountId,
        rows: [{
          entityId: await observationEntityId(path),
          envelope: await sealBridgeEnvelope(subkey, payload),
          createdAt: Date.now(),
        }],
      });
      this.noteSuccess();
    } catch (e) {
      if (isRateLimitError(e)) {
        // Arm the brake and requeue this path for after it lifts.
        this.noteRateLimit();
        void this.emitObservation(path, deleted);
      } else {
        // Observations are best-effort; the next edit re-reports the file.
        console.error('dayGLANCE bridge: observation failed', e);
      }
    }
  }
}
