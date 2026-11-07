// WHAT dayGLANCE CAN RECEIVE (companion spec 4.2.2): the plugin's reader of
// the app's capability rows.
//
// The plugin and the app update in any order, and the plugin often updates
// first: a row type a current plugin writes may have no app able to read it
// for days. Every current app announces each kind of row it consumes as one
// sealed `meta:cap:<name>` row (written once per app session per pairing
// generation; nothing old ever erases it). A feature that needs a current
// app asks `appSupports(name)` before it sends anything, so a vault whose
// apps are all older says "update dayGLANCE" instead of "sent" into a
// stream nothing reads.
//
// THE ANSWERS.
//  • yes: the row opens under this copy's pairing and names the capability.
//    Cached in memory and in this copy's device-local store (never
//    data.json), keyed by account and pairing generation, so a reload does
//    not ask again and a re-pair does. A positive answer is never re-checked:
//    the row is never withdrawn (see the format package).
//  • no: no row, a deleted one, or one that does not open. A row sealed
//    under ANOTHER pairing generation (the clear `gen` tag) says the app has
//    not yet seen this pairing: reason 'pairing', which the form words
//    differently from 'absent'. Never cached: the form asks again each time
//    it opens.
//  • unknown: the row could not be read (the brake is on, a 429, offline, a
//    rejected credential). The caller sends nothing either way, since the
//    send would meet the same wall.

import {
  bridgeCapabilityId,
  isBridgeCapability,
  openBridgeEnvelope,
  readBridgeEnvelopeGeneration,
} from '@glance-apps/obsidian-format';
import type { BridgePairing } from './pairing';
import type { DeviceLocalStore } from './localState';

export type AppSupport =
  | { state: 'yes' }
  | { state: 'no'; reason: 'absent' | 'pairing' }
  | { state: 'unknown'; reason: 'rate-limited' | 'unreachable' | 'rejected' };

/** The device-local cache: the capabilities confirmed under one pairing. */
export interface CapabilityCache {
  /** `${accountId}|${generation}`: a re-pair or another account starts empty. */
  pairingKey: string;
  /** Capability name → when it was confirmed (ISO). */
  names: Record<string, string>;
}

export const APP_CAPABILITIES_KEY = 'dayglance-bridge-app-capabilities';

export interface CapabilityReaderHost {
  getPairing(): BridgePairing | undefined;
  /** One bridge row by id (null when absent); throws what the vault client throws. */
  getRow(pairing: BridgePairing, entityId: string): Promise<unknown>;
  subkeyOf(pairing: BridgePairing): Promise<CryptoKey>;
  /** The transport's 429 brake. */
  isRateLimited(): boolean;
  reportRateLimit(): void;
  reportRequestSuccess(): void;
  store: DeviceLocalStore<CapabilityCache>;
}

export const pairingKeyOf = (p: BridgePairing): string => `${p.accountId}|${p.generation ?? ''}`;

const statusOf = (e: unknown): number | undefined =>
  typeof e === 'object' && e !== null ? (e as { status?: number }).status : undefined;

export class AppCapabilities {
  private cache: CapabilityCache | null = null;
  private loaded = false;
  private inFlight = new Map<string, Promise<AppSupport>>();

  constructor(private readonly host: CapabilityReaderHost) {}

  private current(pairing: BridgePairing): CapabilityCache {
    if (!this.loaded) {
      this.loaded = true;
      const stored = this.host.store.load();
      if (stored && typeof stored.pairingKey === 'string' && stored.names && typeof stored.names === 'object') this.cache = stored;
    }
    const key = pairingKeyOf(pairing);
    if (!this.cache || this.cache.pairingKey !== key) this.cache = { pairingKey: key, names: {} };
    return this.cache;
  }

  /** A positive answer already known for the current pairing (no network). */
  known(name: string): boolean {
    const pairing = this.host.getPairing();
    return !!pairing && !!this.current(pairing).names[name];
  }

  /** Ask the stream (or the cache) whether some current app can receive `name`. */
  check(name: string): Promise<AppSupport> {
    const pairing = this.host.getPairing();
    if (!pairing) return Promise.resolve({ state: 'no', reason: 'absent' });
    if (this.current(pairing).names[name]) return Promise.resolve({ state: 'yes' });
    const key = `${pairingKeyOf(pairing)}|${name}`;
    const running = this.inFlight.get(key);
    if (running) return running;
    // Never rejects: anything unexpected (a subkey that will not import) is
    // an answer the caller refuses on, like an unreachable vault.
    const p = this.read(pairing, name)
      .catch((): AppSupport => ({ state: 'unknown', reason: 'unreachable' }))
      .finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, p);
    return p;
  }

  private async read(pairing: BridgePairing, name: string): Promise<AppSupport> {
    if (this.host.isRateLimited()) return { state: 'unknown', reason: 'rate-limited' };
    let row: { envelope?: unknown; deleted?: unknown } | null;
    try {
      row = (await this.host.getRow(pairing, bridgeCapabilityId(name))) as typeof row;
      this.host.reportRequestSuccess();
    } catch (e) {
      const status = statusOf(e);
      if (status === 429) { this.host.reportRateLimit(); return { state: 'unknown', reason: 'rate-limited' }; }
      if (status === 401 || status === 403) return { state: 'unknown', reason: 'rejected' };
      return { state: 'unknown', reason: 'unreachable' };
    }
    if (!row || row.deleted || typeof row.envelope !== 'string' || !row.envelope) return { state: 'no', reason: 'absent' };
    const payload = await openBridgeEnvelope(await this.host.subkeyOf(pairing), row.envelope);
    if (isBridgeCapability(payload, name)) {
      // The pairing may have changed while the read was out: cache only
      // under the one it was read with.
      if (this.host.getPairing() && pairingKeyOf(this.host.getPairing()!) === pairingKeyOf(pairing)) {
        const cache = this.current(pairing);
        cache.names = { ...cache.names, [name]: new Date().toISOString() };
        this.host.store.save(cache);
      }
      return { state: 'yes' };
    }
    const gen = readBridgeEnvelopeGeneration(row.envelope);
    return { state: 'no', reason: payload === null && gen !== null && gen !== pairing.generation ? 'pairing' : 'absent' };
  }
}
