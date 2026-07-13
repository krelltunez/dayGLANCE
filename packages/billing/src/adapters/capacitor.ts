// Capacitor adapter: drives the BillingBridge Capacitor plugin shipped in this
// package's android/ directory (Play Billing direct — no RevenueCat, same as
// the Android WebView integration it was ported from).
//
// Capacitor plugin calls are Promise-based, so — like Electron — this adapter
// has no synchronous native read. It keeps a localStorage mirror of the last
// applied reading for cold-launch state, and the engine's last-active hint +
// provisional unlock cover the first paint. `cachedReads` is therefore false.
//
// This adapter is written against the plugin contract in android/ and the
// integration guide in README.md. It has not yet shipped in a production app;
// the WebView adapters have.

import type { ApplyCallbacks, BillingAdapter } from './types.js';
import type { BillingEvent, Prices, ProductIds, StatusReading, StorageLike, TrialInfo } from '../types.js';
import { SafeStorage } from '../storage.js';

/** The Capacitor plugin surface (registerPlugin<CapacitorBillingPlugin>('BillingBridge')). */
export interface CapacitorBillingPlugin {
  initialize(options: { yearlyProductId: string; lifetimeProductId: string }): Promise<void>;
  getStatus(): Promise<{ active: boolean; productId: string | null }>;
  refresh(): Promise<void>;
  purchase(options: { productId: string }): Promise<void>;
  getProductPrices(): Promise<{ yearly: string | null; lifetime: string | null; yearlyTrialDays?: number | null }>;
  getTrialEligibility(): Promise<Record<string, boolean>>;
  consumeTestPurchase?(): Promise<void>;
  addListener(
    eventName: 'billingEvent',
    listener: (event: BillingEvent) => void,
  ): Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
}

export interface CapacitorAdapterOptions {
  plugin: CapacitorBillingPlugin;
  products: ProductIds;
  statusCacheKey?: string;
  storage?: StorageLike | null;
  timings?: {
    /** Restore: how long to give the native re-query before settling. */
    restoreSettleMs?: number;
    /** Refresh: how long to give the native re-query before re-reading. */
    refreshSettleMs?: number;
    /** Mount: trial/prices re-read delay after the refresh kick. */
    mountRereadMs?: number;
  };
}

export function createCapacitorAdapter(opts: CapacitorAdapterOptions): BillingAdapter {
  const { plugin, products } = opts;
  const storage = new SafeStorage(opts.storage ?? undefined);
  const statusCacheKey = opts.statusCacheKey ?? 'glance-billing.capacitor-status';
  const restoreSettleMs = opts.timings?.restoreSettleMs ?? 4000;
  const refreshSettleMs = opts.timings?.refreshSettleMs ?? 2000;
  const mountRereadMs = opts.timings?.mountRereadMs ?? 3000;

  void plugin.initialize({
    yearlyProductId: products.yearly,
    lifetimeProductId: products.lifetime,
  });

  const readCachedStatus = (): StatusReading => {
    try {
      const raw = storage.getItem(statusCacheKey);
      if (raw) return JSON.parse(raw);
    } catch {
      /* fall through */
    }
    return { active: false, productId: null };
  };

  const checkStatus = async (): Promise<StatusReading> => {
    const s = await plugin.getStatus();
    return { active: !!s.active, productId: s.productId ?? null };
  };

  const fetchTrial = async (): Promise<TrialInfo> => {
    let eligible = true;
    try {
      const data = await plugin.getTrialEligibility();
      eligible = data?.[products.yearly] !== false;
    } catch {
      eligible = true;
    }
    let days: number | null = null;
    try {
      const p = await plugin.getProductPrices();
      days = typeof p.yearlyTrialDays === 'number' && p.yearlyTrialDays > 0
        ? p.yearlyTrialDays
        : null;
    } catch {
      days = null;
    }
    return { eligible, days };
  };

  const pushPricesAndTrial = (apply: ApplyCallbacks): void => {
    plugin.getProductPrices().then((p) => {
      apply.setPrices({ yearly: p.yearly ?? null, lifetime: p.lifetime ?? null });
    }).catch(() => {});
    fetchTrial().then((t) => apply.setTrial(t)).catch(() => {});
  };

  return {
    platform: 'capacitor',
    cachedReads: false,

    readCachedStatus,
    checkStatus,
    readPrices: (): Prices => ({ yearly: null, lifetime: null }),
    readTrial: (): TrialInfo => ({ eligible: true, days: null }),

    onMount(apply: ApplyCallbacks): void {
      plugin.refresh().catch(() => {});
      checkStatus().then(apply.applyStatus).catch(() => {});
      setTimeout(() => {
        checkStatus().then(apply.applyStatus).catch(() => {});
        pushPricesAndTrial(apply);
      }, mountRereadMs);
    },

    refresh(apply: ApplyCallbacks): void {
      plugin.refresh().catch(() => {});
      setTimeout(() => {
        checkStatus().then(apply.applyStatus).catch(() => {});
        plugin.getProductPrices().then((p) => {
          apply.setPrices({ yearly: p.yearly ?? null, lifetime: p.lifetime ?? null });
        }).catch(() => {});
      }, refreshSettleMs);
    },

    purchase(productId: string): void {
      plugin.purchase({ productId }).catch(() => {});
    },

    restore(apply: ApplyCallbacks): void {
      // Play Billing has no restore API — a re-query IS the restore. Same
      // settle pattern as the WebView Android adapter, including the
      // 'restore_complete_active' contract.
      plugin.refresh().catch(() => {});
      apply.setLoading(true);
      setTimeout(() => {
        checkStatus()
          .then((s) => {
            apply.applyStatus(s);
            apply.setLoading(false);
            apply.emitBillingEvent({
              status: 'cancelled',
              code: 0,
              message: s.active ? 'restore_complete_active' : 'restore_complete',
              productId: s.active ? (s.productId ?? '') : '',
            });
          })
          .catch(() => {
            apply.setLoading(false);
            apply.emitBillingEvent({
              status: 'cancelled', code: 0, message: 'restore_complete', productId: '',
            });
          });
      }, restoreSettleMs);
    },

    bindEvents(apply: ApplyCallbacks): () => void {
      let removed = false;
      let removeFn: (() => Promise<void>) | null = null;
      Promise.resolve(plugin.addListener('billingEvent', (ev) => apply.emitBillingEvent(ev)))
        .then((handle) => {
          removeFn = handle.remove;
          if (removed) void handle.remove();
        })
        .catch(() => {});
      return () => {
        removed = true;
        if (removeFn) void removeFn();
      };
    },

    persistStatusCache(reading: StatusReading): void {
      try {
        storage.setItem(statusCacheKey, JSON.stringify(reading));
      } catch {
        /* best-effort mirror */
      }
    },

    consumeTestPurchase: typeof plugin.consumeTestPurchase === 'function'
      ? () => { void plugin.consumeTestPurchase?.(); }
      : undefined,
  };
}
