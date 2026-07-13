import {
  createAndroidWebViewAdapter,
  createIOSWebViewAdapter,
  createElectronRendererAdapter,
} from '@glance-apps/billing';
import { useBilling } from '@glance-apps/billing/react';
import { isNativeIOS } from '../native.js';
import { REVIEWER_SECRET } from '../config/reviewerAccess.js';

// ── Platform detection (module-level, once) ──────────────────────────────────
// The entitlement machinery itself — the asymmetric downgrade grace, the
// provisional cold-launch unlock, optimistic unlock on validated events, the
// active-only reconcile, the reviewer bypass — lives in @glance-apps/billing.
// This hook only detects the platform, builds the matching adapter with
// dayGLANCE's product IDs, and preserves dayGLANCE's legacy storage keys so
// installed users keep their cached entitlement across the update.

// Android: synchronous Google Play Billing bridge (no RevenueCat on Android)
const BILLING = typeof window !== 'undefined' ? window.DayGlanceBilling : null;

// iOS: RevenueCat via WKURLSchemeHandler synchronous bridge
const IOS = typeof window !== 'undefined' && isNativeIOS();

// Electron (macOS): StoreKit via inAppPurchase + RevenueCat REST API over IPC
const ELECTRON = typeof window !== 'undefined' &&
  !!(window.electronAPI?.subscriptionStatus);

const ANDROID_PRODUCTS = { yearly: 'dayglance_pro_annual', lifetime: 'dayglance_pro_lifetime' };
const APPLE_PRODUCTS   = { yearly: 'com.dayglance.pro.yearly', lifetime: 'com.dayglance.pro.lifetime' };

const adapter =
  BILLING  ? createAndroidWebViewAdapter({ bridge: BILLING, products: ANDROID_PRODUCTS })
  : IOS      ? createIOSWebViewAdapter({ bridge: window.DayGlanceNative, products: APPLE_PRODUCTS })
  : ELECTRON ? createElectronRendererAdapter({
      api: window.electronAPI,
      // Legacy key — the pre-extraction integration persisted the Electron
      // status mirror here. Existing entitled installs must keep it.
      statusCacheKey: 'rc_electron_status',
    })
  : null; // Web/PWA — no adapter, not gated, no wall shown.

/**
 * Exposes subscription state to the React app.
 *
 * Android  — Google Play Billing (window.DayGlanceBilling). Synchronous reads.
 * iOS      — RevenueCat/StoreKit 2 (WKURLSchemeHandler bridge). Synchronous reads.
 * macOS    — StoreKit inAppPurchase + RevenueCat REST (Electron IPC). Async reads
 *            with a localStorage mirror for the initial synchronous render.
 * Web/PWA  — not gated; isAndroidApp, isIOSApp, isElectronApp all false.
 *
 * All three native platforms deliver purchase outcomes through the shared
 * billing-event channel. `prices` is the unified { yearly, lifetime } shape;
 * `trialDays` is the store-reported trial length (null = unknown → the wall
 * shows generic trial copy, never a hardcoded number).
 */
export function useSubscription() {
  const billing = useBilling(() => ({
    adapter,
    reviewerSecret: REVIEWER_SECRET,
    // Product-id hints for entitlementSource classification only.
    products: BILLING ? ANDROID_PRODUCTS : APPLE_PRODUCTS,
    // Legacy keys from the pre-extraction integration — MUST stay so existing
    // installs keep their last-active hint and reviewer unlock.
    storageKeys: {
      lastActive: 'day-planner-entitlement-last-active',
      reviewerUnlock: 'day-planner-reviewer-unlock',
    },
  }));

  return {
    isPro: billing.isPro,
    productId: billing.productId,
    prices: billing.prices,
    trialEligible: billing.trialEligible,
    trialDays: billing.trialDays,
    isAndroidApp:  !!BILLING,
    isIOSApp:      IOS,
    isElectronApp: ELECTRON,
    canConsumeTestPurchase: billing.canConsumeTestPurchase,
    isLoading: billing.isLoading,
    subscribe: billing.subscribe,
    restore: billing.restore,
    refresh: billing.refresh,
    consumeTestPurchase: billing.consumeTestPurchase,
    billingEvent: billing.billingEvent,
    clearBillingEvent: billing.clearBillingEvent,
    billingErrorMessage: billing.billingErrorMessage,
    isReviewerUnlocked: billing.isReviewerUnlocked,
    setReviewerUnlocked: billing.setReviewerUnlocked,
  };
}
