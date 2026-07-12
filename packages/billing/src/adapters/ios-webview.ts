// iOS adapter: RevenueCat SDK (StoreKit 2 backend) behind a synchronous
// WKURLSchemeHandler bridge. Bridge calls return RevenueCat's CACHED customer
// info so the JS thread never blocks; the native layer refreshes in the
// background and self-heals entitlement transfers (syncPurchases) on its own.
// Purchase/restore outcomes arrive via the shared window event global.

import type { ApplyCallbacks, BillingAdapter } from './types.js';
import type { BillingEvent, Prices, ProductIds, StatusReading, TrialInfo } from '../types.js';

/**
 * The subset of the native bridge (`window.<AppName>Native`) used for billing.
 * All string returns are JSON.
 */
export interface IOSBillingBridge {
  /** `{"active":bool,"productId":string|null}` from RevenueCat's cache. */
  getSubscriptionStatus(): string;
  /** `{"yearly":string|null,"lifetime":string|null,"yearlyTrialDays":number|null}` */
  getProductPrices(): string;
  /** `{"<yearlyProductId>":bool}` */
  getTrialEligibility(): string;
  purchase?(productId: string): void;
  restorePurchases?(): void;
}

export interface IOSWebViewAdapterOptions {
  bridge: IOSBillingBridge;
  products: ProductIds;
  eventGlobal?: string;
  timings?: {
    /** Mount: RevenueCat caches status; re-read after this delay so it has
     * had time to refresh from its background network call. */
    mountRereadMs?: number;
    refreshSettleMs?: number;
  };
}

type EventWindow = Record<string, unknown>;

export function createIOSWebViewAdapter(opts: IOSWebViewAdapterOptions): BillingAdapter {
  const { bridge, products } = opts;
  const eventGlobal = opts.eventGlobal ?? '__billingEvent';
  const mountRereadMs = opts.timings?.mountRereadMs ?? 3000;
  const refreshSettleMs = opts.timings?.refreshSettleMs ?? 2000;

  const readCachedStatus = (): StatusReading => {
    try {
      return JSON.parse(bridge.getSubscriptionStatus());
    } catch {
      return { active: false, productId: null };
    }
  };

  const readPrices = (): Prices => {
    try {
      const p = JSON.parse(bridge.getProductPrices());
      return { yearly: p.yearly || null, lifetime: p.lifetime || null };
    } catch {
      return { yearly: null, lifetime: null };
    }
  };

  const readTrial = (): TrialInfo => {
    let eligible = true;
    try {
      const data = JSON.parse(bridge.getTrialEligibility());
      // Only treat as ineligible when the bridge explicitly returns false.
      eligible = data?.[products.yearly] !== false;
    } catch {
      eligible = true;
    }
    let days: number | null = null;
    try {
      const p = JSON.parse(bridge.getProductPrices());
      days = typeof p.yearlyTrialDays === 'number' && p.yearlyTrialDays > 0
        ? p.yearlyTrialDays
        : null;
    } catch {
      days = null;
    }
    return { eligible, days };
  };

  return {
    platform: 'ios',
    cachedReads: true,

    readCachedStatus,
    checkStatus: () => Promise.resolve(readCachedStatus()),
    readPrices,
    readTrial,

    onMount(apply: ApplyCallbacks): void {
      // RevenueCat caches status; re-read after a short delay so it has had
      // time to refresh from its background network call.
      setTimeout(() => {
        apply.applyStatus(readCachedStatus());
        apply.setPrices(readPrices());
        apply.setTrial(readTrial());
      }, mountRereadMs);
    },

    refresh(apply: ApplyCallbacks): void {
      setTimeout(() => {
        apply.applyStatus(readCachedStatus());
        apply.setPrices(readPrices());
      }, refreshSettleMs);
    },

    purchase(productId: string): void {
      bridge.purchase?.(productId);
    },

    restore(): void {
      // Result fires via the event global: 'restore_complete_active' or
      // 'restore_complete', both as status 'cancelled'.
      bridge.restorePurchases?.();
    },

    bindEvents(apply: ApplyCallbacks): () => void {
      const w = globalThis as EventWindow;
      w[eventGlobal] = (ev: BillingEvent | string) => apply.emitBillingEvent(ev);
      return () => { delete w[eventGlobal]; };
    },
  };
}
