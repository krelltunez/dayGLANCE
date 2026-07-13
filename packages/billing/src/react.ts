import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { BillingEngine, type EngineConfig, type EngineSnapshot } from './engine.js';
import { billingErrorMessage } from './errors.js';
import type { BillingEvent, EntitlementSource, Prices } from './types.js';

export interface UseBillingResult {
  /** Entitlement only. For UI gating prefer `isUnlocked`. */
  isPro: boolean;
  /** True when this install is subject to the paywall at all. */
  gated: boolean;
  /** Ungated, entitled, or reviewer-unlocked. */
  isUnlocked: boolean;
  /** Why the install is (or isn't) unlocked — for settings surfaces. */
  entitlementSource: EntitlementSource;
  productId: string | null;
  prices: Prices;
  trialEligible: boolean;
  /** Store-reported trial length in days; null = unknown → show generic copy. */
  trialDays: number | null;
  isLoading: boolean;
  billingEvent: BillingEvent | null;
  isReviewerUnlocked: boolean;
  canConsumeTestPurchase: boolean;
  subscribe: (productId: string) => void;
  restore: () => void;
  refresh: () => void;
  consumeTestPurchase: () => void;
  clearBillingEvent: () => void;
  setReviewerUnlocked: (input: string) => Promise<boolean>;
  billingErrorMessage: (code: number) => string;
}

/**
 * React binding for the billing engine.
 *
 * `createConfig` runs once per mounted component; the engine instance is
 * stable for the component's lifetime (StrictMode-safe: start/stop are
 * idempotent and re-entrant). Platform detection and adapter construction
 * belong in the app, module-level, so the same adapter feeds every mount.
 */
export function useBilling(createConfig: () => EngineConfig): UseBillingResult {
  const engineRef = useRef<BillingEngine | null>(null);
  if (engineRef.current === null) {
    engineRef.current = new BillingEngine(createConfig());
  }
  const engine = engineRef.current;

  const snapshot: EngineSnapshot = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getSnapshot,
  );

  useEffect(() => {
    engine.start();
    return () => engine.stop();
  }, [engine]);

  const actions = useMemo(() => ({
    subscribe: (productId: string) => engine.purchase(productId),
    restore: () => engine.restore(),
    refresh: () => engine.refresh(),
    consumeTestPurchase: () => engine.consumeTestPurchase(),
    clearBillingEvent: () => engine.clearBillingEvent(),
    setReviewerUnlocked: (input: string) => engine.setReviewerUnlocked(input),
  }), [engine]);

  return {
    isPro: snapshot.isPro,
    gated: snapshot.gated,
    isUnlocked: snapshot.isUnlocked,
    entitlementSource: snapshot.entitlementSource,
    productId: snapshot.productId,
    prices: snapshot.prices,
    trialEligible: snapshot.trial.eligible,
    trialDays: snapshot.trial.days,
    isLoading: snapshot.isLoading,
    billingEvent: snapshot.billingEvent,
    isReviewerUnlocked: snapshot.reviewerUnlocked,
    canConsumeTestPurchase: snapshot.canConsumeTestPurchase,
    ...actions,
    billingErrorMessage,
  };
}
