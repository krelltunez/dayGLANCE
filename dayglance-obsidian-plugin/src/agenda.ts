// The agenda store — the plugin as a GLANCEvault READER (companion spec 4.2,
// the sidebar view).
//
// THE READ HALF. The plugin holds an account credential (the pairing's
// device token) and, once the user enters the sync passphrase here, derives
// the account root key exactly like any dayGLANCE client: PBKDF2 over the
// passphrase and the account salt, verified by decrypting the engine's
// keycheck row. With the root key it lists the `dayglance` data plane and
// decrypts the task rows into an in-memory mirror. The key lives in
// IndexedDB under the plugin's OWN database name (device-local, like every
// dayGLANCE device stores it) and NEVER in data.json: data.json rides
// Obsidian Sync to every copy of this vault, and a passphrase-equivalent
// must not travel with it. Neither the passphrase nor the root bytes touch
// the plugin's settings file.
//
// THE WRITE HALF IS NOT HERE. The plugin never writes a data-plane row —
// dayGLANCE's sync engine is the single writer of the account's state, with
// own-ack and sequence obligations the plugin does not take on. Completing
// a task from the sidebar emits an ACTION row on the bridge stream (an
// `act:` row sealed under the pairing subkey, spec §3.6 family), which a
// running dayGLANCE consumes exactly like an observation and applies through
// its own state — so the completion log, the vault writeback, and DB sync
// all see a completion made in dayGLANCE, because it was.
//
// The mirror is memory-only and cursor-driven: a plugin reload re-lists the
// account from seq 0 (cheap reads, no writes), then follows the cursor.
// Refreshes ride the transport's cadence (the 30s tick, plus the drain's
// success tail when SSE nudges it) so the view is live to within one tick
// of dayGLANCE's own push.

import type { App } from 'obsidian';
import { requestUrl } from 'obsidian';
import {
  sealBridgeEnvelope,
  openBridgeEnvelope,
  importBridgeSubkey,
  mintIntentId,
  BRIDGE_VAULT_APP,
  BRIDGE_ACTION_PREFIX,
  BRIDGE_PROJECTION_PREFIX,
} from '@glance-apps/obsidian-format';
import {
  buildAgenda, routinesForDate, mergeCalendarProjections,
  type AgendaItem, type RoutineItem, type CalendarProjection,
} from '@glance-apps/agenda-core';
import { createVaultClient, type VaultClient } from '@glance-apps/sync/src/vaultClient.js';
import {
  setupDbRootKey,
  initDbRootKey,
  clearDbRootKey,
  hasDbRootKey,
  decryptEntity,
  isReservedEntityId,
  KEYCHECK_ENTITY_ID,
} from '@glance-apps/sync/src/dbCrypto.js';
import type { BridgePairing } from './pairing';

// The dayGLANCE sync engine's app id on the vault (its data plane).
const DAYGLANCE_APP = 'dayglance';
// The plugin's own root-key database: `${name}-db` in IndexedDB. Distinct
// from dayGLANCE's so a desktop that runs both keeps two independent copies.
const CRYPTO_DB_NAME = 'dayglance-bridge';
// Row kinds the agenda reads. The inbox (unscheduledTasks) is deliberately
// absent — the v1 scope ruling. entityIds are `${kind}:${id}` (dbAdapter's
// scheme), so the kind is readable before decryption. Routines are the
// day's placed chips (todayRoutines) plus two singletons: the day they were
// placed for and the day's completions.
const AGENDA_KINDS = new Set(['tasks', 'recurringTasks', 'todayRoutines']);
const SINGLETON_KIND = 'singleton';
const AGENDA_SINGLETONS = new Set(['routinesDate', 'routineCompletions']);
// Optimistic completion marks time out: dayGLANCE applies an action within
// one poll (5 min) once it runs, and a mark older than this with no mirror
// change behind it means nothing is consuming — show the box unchecked
// again rather than lie indefinitely.
const PENDING_TTL_MS = 15 * 60_000;

export type AgendaKeyState = 'unpaired' | 'no-key' | 'ready';

export interface AgendaHost {
  app: App;
  getPairing(): BridgePairing | undefined;
}

export interface AgendaStatus {
  key: AgendaKeyState;
  refreshing: boolean;
  lastRefreshedAt: number | null;
  /** Human-readable reason the last refresh or action failed, or null. */
  lastError: string | null;
  /** Rows the account key could not decrypt on the last full pass (a passphrase mismatch symptom). */
  undecryptable: number;
  /** Publish stamp (epoch ms) of the freshest calendar projection in use, or null when none. */
  calendarAsOf: number | null;
}

interface TaskRow { id: string; [k: string]: unknown }

const obsidianFetch = async (
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
) => {
  const resp = await requestUrl({
    url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body, throw: false,
  });
  return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, json: async () => resp.json };
};

const statusOf = (e: unknown): number | undefined =>
  typeof e === 'object' && e !== null ? (e as { status?: number }).status : undefined;

const describeError = (e: unknown): string => {
  const status = statusOf(e);
  if (status === 429) return 'GLANCEvault is rate-limiting; retrying later.';
  if (status === 401 || status === 403) return 'GLANCEvault rejected the pairing credential.';
  const code = typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
  if (code === 'PASSPHRASE_REQUIRED') return 'Sync passphrase not set on this device.';
  return 'GLANCEvault unreachable.';
};

/** Local-offset ISO with seconds — the app's own completionTimestamp() shape. */
export function localOffsetIso(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export class AgendaStore {
  private host: AgendaHost;
  private tasks = new Map<string, TaskRow>();
  private recurring = new Map<string, TaskRow>();
  private routines = new Map<string, TaskRow>();
  private singletons = new Map<string, unknown>();
  // Calendar projections (companion 4.2): read-only calendar events never
  // sync, so each dayGLANCE device publishes its view as a bridge-stream row
  // (`proj:calendar:<deviceId>`, sealed under the pairing subkey). Keyed by
  // row id; merged freshest-wins per event at read time. Own cursor over the
  // bridge namespace (the data-plane cursor above is a different app).
  private projections = new Map<string, CalendarProjection>();
  private bridgeCursor = 0;
  private cursor = 0;
  private cursorAccount: string | null = null;
  private status: AgendaStatus = { key: 'unpaired', refreshing: false, lastRefreshedAt: null, lastError: null, undecryptable: 0, calendarAsOf: null };
  private pending = new Map<string, number>(); // item id → marked-at ms
  private listeners = new Set<() => void>();
  private refreshChain: Promise<void> = Promise.resolve();
  private subkey: CryptoKey | null = null;
  private subkeyFor: string | null = null;
  private disposed = false;

  constructor(host: AgendaHost) {
    this.host = host;
  }

  /** Restore a device-local root key (no passphrase needed once set up). */
  async init(): Promise<void> {
    if (!hasDbRootKey()) {
      try { await initDbRootKey({ cryptoDBName: CRYPTO_DB_NAME }); }
      catch { /* storage unavailable — stays no-key */ }
    }
    this.recomputeKeyState();
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  getStatus(): AgendaStatus {
    this.recomputeKeyState();
    return { ...this.status };
  }

  /** True when this item has an emitted, not-yet-mirrored completion. */
  isPending(id: string): boolean {
    const at = this.pending.get(id);
    if (at === undefined) return false;
    if (Date.now() - at > PENDING_TTL_MS) { this.pending.delete(id); return false; }
    return true;
  }

  /** The routines placed for a day (only the day dayGLANCE stamped; see agenda-core). */
  routinesFor(dateStr: string): RoutineItem[] {
    return routinesForDate({
      todayRoutines: [...this.routines.values()],
      routinesDate: this.singletons.get('routinesDate') as string | null | undefined,
      routineCompletions: this.singletons.get('routineCompletions') as Record<string, string> | undefined,
    }, dateStr);
  }

  /** The agenda for an inclusive YYYY-MM-DD window, from the mirror plus the calendar projections. */
  agenda(from: string, to: string): Record<string, AgendaItem[]> {
    const calendar = mergeCalendarProjections([...this.projections.values()], { from, to });
    this.status.calendarAsOf = calendar.freshestAt;
    return buildAgenda(
      { tasks: [...this.tasks.values()], recurringTasks: [...this.recurring.values()], calendarEvents: calendar.events },
      { from, to },
    );
  }

  // ── account key ───────────────────────────────────────────────────────────

  /**
   * Derive the root key from the passphrase and prove it against the
   * account's keycheck row. On any failure the key is cleared again, so a
   * wrong passphrase never lingers as a "ready" state that decrypts nothing.
   */
  async verifyPassphrase(passphrase: string): Promise<{ ok: boolean; message: string }> {
    const pairing = this.host.getPairing();
    if (!pairing) return { ok: false, message: 'Pair with GLANCEvault first.' };
    if (!passphrase) return { ok: false, message: 'Enter your dayGLANCE sync passphrase.' };
    const client = this.client(pairing);
    try {
      const salt = await client.getSalt(pairing.accountId);
      if (!salt) return { ok: false, message: 'This account has no sync salt yet. Set up database sync in dayGLANCE first.' };
      await setupDbRootKey(passphrase, salt, { cryptoDBName: CRYPTO_DB_NAME });
      const row = (await client.getRow(DAYGLANCE_APP, KEYCHECK_ENTITY_ID, pairing.accountId)) as
        { envelope?: string; deleted?: boolean } | null;
      if (!row || row.deleted || !row.envelope) {
        await this.forgetKey();
        return { ok: false, message: 'No key-check row on the account yet. Sync from dayGLANCE once, then try again.' };
      }
      try {
        await decryptEntity(row.envelope, KEYCHECK_ENTITY_ID);
      } catch {
        await this.forgetKey();
        return { ok: false, message: 'That passphrase does not match this account.' };
      }
      this.resetMirror();
      this.recomputeKeyState();
      this.emit();
      void this.refresh();
      return { ok: true, message: 'Passphrase verified. The agenda will fill in shortly.' };
    } catch (e) {
      await this.forgetKey().catch(() => {});
      return { ok: false, message: describeError(e) };
    }
  }

  /** Drop the device-local root key and the mirror built from it. */
  async forgetKey(): Promise<void> {
    try { await clearDbRootKey({ cryptoDBName: CRYPTO_DB_NAME }); }
    catch { /* best-effort */ }
    this.resetMirror();
    this.recomputeKeyState();
    this.emit();
  }

  // ── mirror ────────────────────────────────────────────────────────────────

  /** Pull rows above the cursor into the mirror. Serialised; safe to call from any tick. */
  refresh(): Promise<void> {
    this.refreshChain = this.refreshChain.then(() => this.refreshOnce()).catch(() => {});
    return this.refreshChain;
  }

  private async refreshOnce(): Promise<void> {
    if (this.disposed) return;
    const pairing = this.host.getPairing();
    this.recomputeKeyState();
    if (!pairing || this.status.key !== 'ready') return;
    if (this.cursorAccount !== pairing.accountId) this.resetMirror(pairing.accountId);
    this.status.refreshing = true;
    this.emit();
    let undecryptable = 0;
    try {
      const client = this.client(pairing);
      let since = this.cursor;
      let hasMore = true;
      let changed = false;
      while (hasMore && !this.disposed) {
        const page = await client.list(DAYGLANCE_APP, { accountId: pairing.accountId, since });
        hasMore = !!page.hasMore;
        const rows = (page.rows ?? []) as Array<{ entityId?: string; seq?: number; deleted?: boolean; envelope?: string }>;
        if (!rows.length) break;
        for (const row of rows) {
          const seq = Number(row.seq) || 0;
          if (seq > since) since = seq;
          const entityId = String(row.entityId ?? '');
          if (!entityId || isReservedEntityId(entityId)) continue;
          const colon = entityId.indexOf(':');
          const kind = colon < 0 ? '' : entityId.slice(0, colon);
          const key = entityId.slice(colon + 1);
          const map = kind === SINGLETON_KIND
            ? (AGENDA_SINGLETONS.has(key) ? this.singletons : null)
            : (AGENDA_KINDS.has(kind) ? this.mapFor(kind) : null);
          if (!map) continue;
          const mapKey = kind === SINGLETON_KIND ? key : entityId;
          if (row.deleted || !row.envelope) {
            if (map.delete(mapKey)) changed = true;
            continue;
          }
          const value = await this.decryptRow(row.envelope, entityId, kind);
          if (value === undefined) { undecryptable += 1; continue; }
          if (value === null) continue;
          map.set(mapKey, value as TaskRow);
          changed = true;
        }
      }
      this.cursor = since;
      if (await this.refreshProjections(client, pairing)) changed = true;
      this.status.lastRefreshedAt = Date.now();
      this.status.lastError = null;
      this.status.undecryptable = undecryptable;
      if (changed) this.settlePending();
    } catch (e) {
      this.status.lastError = describeError(e);
    } finally {
      this.status.refreshing = false;
      this.emit();
    }
  }

  private mapFor(kind: string): Map<string, TaskRow> {
    return kind === 'tasks' ? this.tasks : kind === 'recurringTasks' ? this.recurring : this.routines;
  }

  // undefined = undecryptable under this key; null = decryptable but not a
  // row of the expected kind (never routed); otherwise the entity's value
  // (a task/chip object for collections, the bare value for singletons).
  private async decryptRow(envelope: string, entityId: string, kind: string): Promise<unknown | null | undefined> {
    let entity: unknown;
    try { entity = await decryptEntity(envelope, entityId); }
    catch { return undefined; }
    if (!entity || typeof entity !== 'object') return null;
    const wrapped = entity as { _kind?: unknown; value?: unknown };
    if (wrapped._kind !== kind) return null;
    if (kind === SINGLETON_KIND) return wrapped.value ?? null;
    if (!wrapped.value || typeof wrapped.value !== 'object') return null;
    return wrapped.value;
  }

  // Pull projection rows above the bridge cursor. Everything else in the
  // namespace (intents, observations, meta, actions) is skipped by prefix
  // without decryption. Returns whether a projection changed.
  private async refreshProjections(client: VaultClient, pairing: BridgePairing): Promise<boolean> {
    let since = this.bridgeCursor;
    let hasMore = true;
    let changed = false;
    const subkey = await this.subkeyOf(pairing);
    while (hasMore && !this.disposed) {
      const page = await client.list(BRIDGE_VAULT_APP, { accountId: pairing.accountId, since });
      hasMore = !!page.hasMore;
      const rows = (page.rows ?? []) as Array<{ entityId?: string; seq?: number; deleted?: boolean; envelope?: string }>;
      if (!rows.length) break;
      for (const row of rows) {
        const seq = Number(row.seq) || 0;
        if (seq > since) since = seq;
        const entityId = String(row.entityId ?? '');
        if (!entityId.startsWith(BRIDGE_PROJECTION_PREFIX)) continue;
        if (row.deleted || !row.envelope) {
          if (this.projections.delete(entityId)) changed = true;
          continue;
        }
        const payload = await openBridgeEnvelope(subkey, row.envelope) as Partial<CalendarProjection> | null;
        if (payload?.kind !== 'projection' || payload.type !== 'calendar' || !Array.isArray(payload.events)) continue;
        this.projections.set(entityId, payload as CalendarProjection);
        changed = true;
      }
    }
    this.bridgeCursor = since;
    return changed;
  }

  // Drop optimistic marks the mirror has caught up with, and expired ones.
  private settlePending(): void {
    if (!this.pending.size) return;
    const now = Date.now();
    for (const [id, at] of [...this.pending]) {
      if (now - at > PENDING_TTL_MS) { this.pending.delete(id); continue; }
      if (id.startsWith('recurring-')) {
        const m = /^recurring-(.+)-(\d{4}-\d{2}-\d{2})$/.exec(id);
        const tpl = m ? this.recurring.get(`recurringTasks:${m[1]}`) : undefined;
        const dates = (tpl?.completedDates as string[] | undefined) ?? [];
        if (m && dates.includes(m[2])) this.pending.delete(id);
      } else {
        const t = this.tasks.get(`tasks:${id}`);
        if (t?.completed) this.pending.delete(id);
      }
    }
  }

  // ── actions ───────────────────────────────────────────────────────────────

  /**
   * Emit a task_complete action row for dayGLANCE to apply. Optimistic: the
   * item shows as pending until the mirror reflects the completion.
   */
  async complete(item: AgendaItem): Promise<{ ok: boolean; message: string }> {
    const pairing = this.host.getPairing();
    if (!pairing) return { ok: false, message: 'Not paired with GLANCEvault.' };
    if (item.completed || this.isPending(item.id)) return { ok: true, message: 'Already completed.' };
    if (item.imported) return { ok: false, message: 'Imported calendar events are completed in dayGLANCE.' };
    const actionId = mintIntentId();
    const payload: Record<string, unknown> = {
      v: 1, kind: 'action', type: 'task_complete', actionId,
      completedAt: localOffsetIso(),
      createdAt: new Date().toISOString(),
    };
    if (item.recurring && item.templateId && item.instanceDate) {
      payload.templateId = item.templateId;
      payload.instanceDate = item.instanceDate;
    } else {
      payload.taskId = item.id;
    }
    try {
      const subkey = await this.subkeyOf(pairing);
      await this.client(pairing).batch(BRIDGE_VAULT_APP, {
        accountId: pairing.accountId,
        rows: [{
          entityId: `${BRIDGE_ACTION_PREFIX}${actionId}`,
          envelope: await sealBridgeEnvelope(subkey, payload),
          createdAt: Date.now(),
        }],
      });
      this.pending.set(item.id, Date.now());
      this.status.lastError = null;
      this.emit();
      return { ok: true, message: 'Completion sent to dayGLANCE.' };
    } catch (e) {
      this.status.lastError = describeError(e);
      this.emit();
      return { ok: false, message: this.status.lastError };
    }
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private client(pairing: BridgePairing): VaultClient {
    return createVaultClient({ vaultUrl: pairing.vaultUrl, vaultToken: pairing.deviceToken, fetchImpl: obsidianFetch });
  }

  private async subkeyOf(pairing: BridgePairing): Promise<CryptoKey> {
    if (!this.subkey || this.subkeyFor !== pairing.subkeyB64) {
      this.subkey = await importBridgeSubkey(pairing.subkeyB64);
      this.subkeyFor = pairing.subkeyB64;
    }
    return this.subkey;
  }

  private resetMirror(accountId: string | null = null): void {
    this.tasks.clear();
    this.recurring.clear();
    this.routines.clear();
    this.singletons.clear();
    this.projections.clear();
    this.pending.clear();
    this.cursor = 0;
    this.bridgeCursor = 0;
    this.cursorAccount = accountId;
    this.status.lastRefreshedAt = null;
    this.status.lastError = null;
    this.status.undecryptable = 0;
    this.status.calendarAsOf = null;
  }

  private recomputeKeyState(): void {
    const pairing = this.host.getPairing();
    this.status.key = !pairing ? 'unpaired' : hasDbRootKey() ? 'ready' : 'no-key';
  }

  private emit(): void {
    if (this.disposed) return;
    for (const cb of [...this.listeners]) {
      try { cb(); } catch (e) { console.error('dayGLANCE bridge: agenda listener failed', e); }
    }
  }
}
