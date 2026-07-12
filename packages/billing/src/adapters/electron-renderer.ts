// Electron renderer adapter: StoreKit purchases + RevenueCat REST entitlement
// checks live in the MAIN process (see ../electron-main); the renderer talks
// to them over IPC. Status is therefore ASYNC — this adapter keeps a
// localStorage mirror of the last applied reading so the engine has a
// synchronous last-known-good state at cold launch, before the first IPC
// answer arrives.
//
// The main-process check can legitimately return `indeterminate: true` (no
// App Store receipt materialized yet — very common on a cold launch — or a
// network/RevenueCat failure). The engine ignores those, which is exactly why
// this path never flashes the wall on an entitled install.

import type { ApplyCallbacks, BillingAdapter } from './types.js';
import type { BillingEvent, Prices, StatusReading, StorageLike, TrialInfo } from '../types.js';
import { SafeStorage } from '../storage.js';

/** Prices payload pushed/pulled over IPC. */
export interface ElectronPricesPayload {
  yearly: string | null;
  lifetime: string | null;
  yearlyTrialDays?: number | null;
}

/** The preload-exposed IPC surface this adapter drives. */
export interface ElectronBillingApi {
  subscriptionStatus(): Promise<StatusReading>;
  subscriptionPurchase(productId: string): Promise<void>;
  subscriptionRestore(): Promise<void>;
  subscriptionPrices?(): Promise<ElectronPricesPayload | null>;
  onSubscriptionEvent(cb: (event: BillingEvent | string) => void): () => void;
  onSubscriptionPricesReady(cb: (prices: ElectronPricesPayload) => void): () => void;
}

export interface ElectronRendererAdapterOptions {
  api: ElectronBillingApi;
  /**
   * localStorage key for the status mirror. Apps migrating an existing
   * integration MUST pass their legacy key so installed users keep their
   * cached last-known-good entitlement across the update.
   */
  statusCacheKey?: string;
  storage?: StorageLike | null;
}

export function createElectronRendererAdapter(opts: ElectronRendererAdapterOptions): BillingAdapter {
  const { api } = opts;
  const storage = new SafeStorage(opts.storage ?? undefined);
  const statusCacheKey = opts.statusCacheKey ?? 'glance-billing.electron-status';

  const readCachedStatus = (): StatusReading => {
    try {
      const raw = storage.getItem(statusCacheKey);
      if (raw) return JSON.parse(raw);
    } catch {
      /* fall through */
    }
    return { active: false, productId: null };
  };

  const applyPricesPayload = (apply: ApplyCallbacks, p: ElectronPricesPayload): void => {
    apply.setPrices({ yearly: p.yearly ?? null, lifetime: p.lifetime ?? null });
    if (typeof p.yearlyTrialDays === 'number' && p.yearlyTrialDays > 0) {
      apply.setTrial({ days: p.yearlyTrialDays });
    }
  };

  return {
    platform: 'electron',
    cachedReads: false,

    readCachedStatus,
    checkStatus: () => api.subscriptionStatus(),

    // Prices arrive async (push at startup + pull on mount) — the sync read
    // must return nulls, never clobber already-delivered prices.
    readPrices: (): Prices => ({ yearly: null, lifetime: null }),
    readTrial: (): TrialInfo => ({ eligible: true, days: null }),

    onMount(apply: ApplyCallbacks): void {
      // The engine's gate ignores indeterminate results (main process couldn't
      // verify), applies active instantly, and holds a determinate inactive
      // for the grace window before locking — so an entitled install never
      // flashes the wall.
      api.subscriptionStatus().then(apply.applyStatus).catch(() => {});

      // PULL cached prices in addition to listening for the startup push. The
      // push can fire before the renderer registers its listener (Electron
      // drops renderer-directed messages sent before a listener exists), which
      // historically left the price stuck on "Loading…". The pull recovers
      // prices already fetched; if the fetch hasn't finished yet, the push
      // still delivers them.
      api.subscriptionPrices?.().then((p) => {
        if (p && (p.yearly || p.lifetime)) applyPricesPayload(apply, p);
      }).catch(() => {});
    },

    refresh(apply: ApplyCallbacks): void {
      api.subscriptionStatus().then(apply.applyStatus).catch(() => {});
    },

    purchase(productId: string): void {
      api.subscriptionPurchase(productId).catch(() => {});
    },

    restore(): void {
      // Settlement arrives via the event push: 'restore_complete_active' or
      // 'restore_complete' (dual-path settled in the main process).
      api.subscriptionRestore().catch(() => {});
    },

    bindEvents(apply: ApplyCallbacks): () => void {
      const unsubEvents = api.onSubscriptionEvent((ev) => apply.emitBillingEvent(ev));
      const unsubPrices = api.onSubscriptionPricesReady((p) => applyPricesPayload(apply, p));
      return () => { unsubEvents(); unsubPrices(); };
    },

    persistStatusCache(reading: StatusReading): void {
      try {
        storage.setItem(statusCacheKey, JSON.stringify(reading));
      } catch {
        /* best-effort mirror */
      }
    },
  };
}
