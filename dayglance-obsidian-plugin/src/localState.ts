// DEVICE-LOCAL PLUGIN STATE (the HWM_PERSIST_GAP investigation's answer,
// 2026-09-05; buildout spec §3.2's data.json churn, by its real address).
//
// data.json is ONE fleet-shared file by the per-vault pairing ruling: Obsidian
// settings sync ships it to every copy of the vault. The bridge cursor, the
// applied-intent set, the adopted scope, the linked-note map and the device
// id are per-COPY volatile state, and every copy saved its own into that
// shared file — Obsidian Sync then held several versions differing only in
// bookkeeping ("Download cancelled because file was changed locally"), and
// a settings flip on one desktop could lose to a concurrent cursor save from
// another copy's plugin, because the whole object is rewritten each time.
// The persist-on-intent-only rule cut the frequency; it did not change the
// shape.
//
// Obsidian offers vault-scoped, device-local storage (App.loadLocalStorage /
// saveLocalStorage, 1.8.7+). The volatile state lives there now. data.json
// keeps what is legitimately shared: the pairing (must reach every copy),
// the settings, and the config-row cache. Effects: data.json changes only on
// pairing, settings and config events; each vault copy gets an honest cursor
// and applied set (a copy starting fresh re-lists only unconsumed rows —
// applied intents are deleted from the stream — and re-applies nothing that
// was applied elsewhere on ITS files); the device id becomes truly per copy,
// which is what the heartbeat's wire key always meant.
//
// Migration: the first load on a build with this module seeds the local
// store from the data.json bridge fields and STOPS writing them; a copy on
// an older build keeps writing them back until it upgrades (Obsidian Sync
// ships main.js with the settings, so the fleet upgrades together), and a
// newer build strips them again on load — rollout-window churn only.
//
// Fallback: on an Obsidian without the API the store reports unavailable and
// main.ts keeps the data.json shape exactly as before.

import type { App } from 'obsidian';
import type { BridgeState, BridgeConfigRow } from './bridge';

export const LOCAL_STATE_KEY = 'dayglance-bridge-state';

/** The per-copy state: everything in BridgeState except the shared config cache, plus the device id. */
export type LocalBridgeState = Omit<BridgeState, 'config'>;

export interface LocalBridgeData {
  deviceId?: string;
  bridge?: LocalBridgeState;
}

export interface LocalStateStore {
  available: boolean;
  load(): LocalBridgeData | null;
  save(data: LocalBridgeData | null): void;
}

type LocalStorageApp = { loadLocalStorage?: (key: string) => unknown; saveLocalStorage?: (key: string, data: unknown | null) => void };

/** The vault-scoped device-local store, or an unavailable stub on an old Obsidian. */
export function localStateStoreFor(app: App): LocalStateStore {
  const a = app as unknown as LocalStorageApp;
  const available = typeof a.loadLocalStorage === 'function' && typeof a.saveLocalStorage === 'function';
  return {
    available,
    load: () => {
      if (!available) return null;
      try {
        const raw = a.loadLocalStorage!(LOCAL_STATE_KEY);
        return raw && typeof raw === 'object' ? (raw as LocalBridgeData) : null;
      } catch {
        return null;
      }
    },
    save: (data) => {
      if (!available) return;
      try { a.saveLocalStorage!(LOCAL_STATE_KEY, data); } catch (e) { console.error('dayGLANCE bridge: local state save failed', e); }
    },
  };
}

/** Split a transport-facing BridgeState into its per-copy half and the shared config cache. */
export function splitBridgeState(state: BridgeState): { local: LocalBridgeState; config: BridgeConfigRow | null | undefined } {
  const { config, ...local } = state;
  return { local, config };
}

/** Rejoin the two halves for the transport. */
export function joinBridgeState(local: LocalBridgeState | undefined, config: BridgeConfigRow | null | undefined): BridgeState {
  return { appliedIds: [], hwm: 0, ...(local ?? {}), ...(config !== undefined ? { config } : {}) };
}

/** The data.json fields this module migrates away from (plus the config cache it migrates INTO). */
export interface SharedBridgeFields {
  deviceId?: string;
  bridge?: BridgeState;
  bridgeConfig?: BridgeConfigRow | null;
}

/**
 * One-time migration, pure: seed the local store from data.json's bridge
 * fields when the store is empty, lift the config cache into its own shared
 * field, and strip the per-copy fields from the shared object. Returns the
 * next local data, the (mutated) shared data, and whether data.json changed.
 */
export function migrateToLocalState<T extends SharedBridgeFields>(data: T, local: LocalBridgeData | null): { local: LocalBridgeData; data: T; dataChanged: boolean } {
  let dataChanged = false;
  let next: LocalBridgeData = local ? { ...local } : {};
  if (data.bridge) {
    const { local: perCopy, config } = splitBridgeState(data.bridge);
    if (!local) next = { ...next, bridge: perCopy };
    if (config !== undefined && data.bridgeConfig === undefined) { data.bridgeConfig = config; dataChanged = true; }
    delete data.bridge;
    dataChanged = true;
  }
  if (data.deviceId) {
    if (!next.deviceId) next.deviceId = data.deviceId;
    delete data.deviceId;
    dataChanged = true;
  }
  return { local: next, data, dataChanged };
}
