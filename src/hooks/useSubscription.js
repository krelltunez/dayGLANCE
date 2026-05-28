import { useState, useEffect, useCallback, useRef } from 'react';
import { isNativeIOS } from '../native.js';

// ── Platform detection ────────────────────────────────────────────────────────

// Android: synchronous Google Play Billing bridge
const BILLING = typeof window !== 'undefined' ? window.DayGlanceBilling : null;

// iOS: RevenueCat via WKURLSchemeHandler synchronous bridge
const IOS = typeof window !== 'undefined' && isNativeIOS();

// Electron (macOS): StoreKit via inAppPurchase + RevenueCat REST API over IPC
const ELECTRON = typeof window !== 'undefined' &&
  !!(window.electronAPI?.subscriptionStatus);

// ── Status / price readers ────────────────────────────────────────────────────

function readStatusAndroid() {
  if (!BILLING) return { active: false, productId: null };
  try { return JSON.parse(BILLING.getStatus()); }
  catch { return { active: false, productId: null }; }
}

function readStatusIOS() {
  if (!IOS) return { active: false, productId: null };
  try { return JSON.parse(window.DayGlanceNative.getSubscriptionStatus()); }
  catch { return { active: false, productId: null }; }
}

// Electron status is async — this reads the localStorage cache for the initial
// synchronous render; IPC refreshes it on mount.
function readStatusElectronCached() {
  try {
    const raw = localStorage.getItem('rc_electron_status');
    if (raw) return JSON.parse(raw);
  } catch {}
  return { active: false, productId: null };
}

function readStatus() {
  if (BILLING) return readStatusAndroid();
  if (IOS)     return readStatusIOS();
  if (ELECTRON) return readStatusElectronCached();
  return { active: false, productId: null };
}

function readPricesAndroid() {
  if (!BILLING) return { yearly: null, lifetime: null };
  try {
    const p = JSON.parse(BILLING.getProductPrices());
    // Android bridge returns { annual, lifetime } — remap annual→yearly for a unified shape.
    return { yearly: p.annual || null, lifetime: p.lifetime || null };
  } catch { return { yearly: null, lifetime: null }; }
}

function readPricesIOS() {
  if (!IOS) return { yearly: null, lifetime: null };
  try {
    const p = JSON.parse(window.DayGlanceNative.getProductPrices());
    return { yearly: p.yearly || null, lifetime: p.lifetime || null };
  } catch { return { yearly: null, lifetime: null }; }
}

function readPrices() {
  if (BILLING)  return readPricesAndroid();
  if (IOS)      return readPricesIOS();
  if (ELECTRON) return { yearly: null, lifetime: null }; // pushed async via subscription:prices-ready
  return {};
}

function readTrialEligibility() {
  if (BILLING) {
    try {
      const data = JSON.parse(BILLING.getTrialEligibility());
      return data?.['dayglance_pro_annual'] !== false;
    } catch { return true; }
  }
  if (!IOS) return true;
  try {
    const data = JSON.parse(window.DayGlanceNative.getTrialEligibility());
    // Only treat as ineligible when the bridge explicitly returns false.
    return data?.['com.dayglance.app.pro.yearly'] !== false;
  } catch { return true; }
}

// ── Error code → user message ─────────────────────────────────────────────────

/**
 * Maps a billing error code to a user-facing string.
 * Returns a generic message for unknown codes.
 * Code 2 = SKErrorPaymentCancelled (macOS) / user cancelled — should not
 * surface as an error message (handled as 'cancelled' status upstream).
 */
function billingErrorMessage(code) {
  switch (code) {
    case 1:  return 'Product not found. Please try again later.';
    case 3:  return 'Billing is not available on this device.';
    case 4:  return "This subscription isn't available right now. Please try again later.";
    case 6:  return 'Network error. Please check your connection and try again.';
    case 7:  return 'You already own this item.';
    default: return 'Something went wrong with the purchase. Please try again.';
  }
}

// ── Reviewer unlock ───────────────────────────────────────────────────────────

const REVIEWER_UNLOCK_KEY = 'day-planner-reviewer-unlock';

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Exposes subscription state to the React app.
 *
 * Android  — Google Play Billing (window.DayGlanceBilling). Synchronous reads.
 * iOS      — RevenueCat/StoreKit 2 (WKURLSchemeHandler bridge). Synchronous reads.
 * macOS    — StoreKit inAppPurchase + RevenueCat REST (Electron IPC). Async reads
 *            with localStorage cache for the initial synchronous render.
 * Web/PWA  — isPro always true; isAndroidApp, isIOSApp, isElectronApp all false;
 *            no wall shown.
 *
 * All three native platforms deliver purchase outcomes via window.__billingEvent.
 * `prices` shape: Android → { annual, lifetime } | iOS/macOS → { monthly, yearly }
 */
export function useSubscription() {
  const [status, setStatus]               = useState(() => readStatus());
  const [prices, setPrices]               = useState(() => readPrices());
  const [trialEligible, setTrialEligible] = useState(() => readTrialEligibility());
  const [isLoading, setIsLoading]         = useState(false);
  const [billingEvent, setBillingEvent]   = useState(null);
  const [isReviewerUnlocked, setIsReviewerUnlockedState] = useState(
    () => localStorage.getItem(REVIEWER_UNLOCK_KEY) === 'true'
  );
  const timeoutRef = useRef(null);

  const setReviewerUnlocked = useCallback(() => {
    try { localStorage.setItem(REVIEWER_UNLOCK_KEY, 'true'); } catch {}
    setIsReviewerUnlockedState(true);
  }, []);

  const isOnNativePlatform = !!(BILLING || IOS || ELECTRON);

  // ── Billing event handler (shared by all platforms) ──────────────────────
  const handleBillingEvent = useCallback((ev) => {
    try {
      const parsed = typeof ev === 'string' ? JSON.parse(ev) : ev;
      if (parsed.status === 'success') {
        // Re-read entitlement after a confirmed purchase.
        if (BILLING) { setStatus(readStatusAndroid()); setPrices(readPricesAndroid()); }
        if (IOS)     { setStatus(readStatusIOS());     setPrices(readPricesIOS()); }
        if (ELECTRON) {
          window.electronAPI.subscriptionStatus().then(s => {
            setStatus(s);
            try { localStorage.setItem('rc_electron_status', JSON.stringify(s)); } catch {}
          }).catch(() => {});
        }
      }
      setBillingEvent({ ...parsed, ts: Date.now() });
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    } catch {}
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Register window.__billingEvent — fired by Android and iOS bridges.
  useEffect(() => {
    if (!isOnNativePlatform) return;
    window.__billingEvent = handleBillingEvent;
    return () => { delete window.__billingEvent; };
  }, [handleBillingEvent]);

  // Electron: subscribe to subscription:event IPC push.
  useEffect(() => {
    if (!ELECTRON) return;
    const unsub = window.electronAPI.onSubscriptionEvent(handleBillingEvent);
    return unsub;
  }, [handleBillingEvent]);

  // Electron: listen for prices pushed from the main process at startup.
  useEffect(() => {
    if (!ELECTRON) return;
    const unsub = window.electronAPI.onSubscriptionPricesReady((p) => {
      setPrices({ yearly: p.yearly ?? null, lifetime: p.lifetime ?? null });
    });
    return unsub;
  }, []);

  // On mount: background refresh for each platform.
  useEffect(() => {
    if (BILLING) BILLING.refresh?.();

    if (IOS) {
      // RevenueCat caches status; re-read after a short delay so it has
      // had time to refresh from its background network call.
      setTimeout(() => {
        setStatus(readStatusIOS());
        setPrices(readPricesIOS());
        setTrialEligible(readTrialEligibility());
      }, 3000);
    }

    if (ELECTRON) {
      window.electronAPI.subscriptionStatus().then(s => {
        setStatus(s);
        try { localStorage.setItem('rc_electron_status', JSON.stringify(s)); } catch {}
      }).catch(() => {});
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-read when the user returns from a purchase sheet (all platforms).
  const refresh = useCallback(() => {
    if (BILLING) {
      BILLING.refresh?.();
      setTimeout(() => { setStatus(readStatusAndroid()); setPrices(readPricesAndroid()); }, 2000);
    }
    if (IOS) {
      setTimeout(() => { setStatus(readStatusIOS()); setPrices(readPricesIOS()); }, 2000);
    }
    if (ELECTRON) {
      window.electronAPI.subscriptionStatus().then(s => {
        setStatus(s);
        try { localStorage.setItem('rc_electron_status', JSON.stringify(s)); } catch {}
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (!isOnNativePlatform) return;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  // ── subscribe ──────────────────────────────────────────────────────────────
  /**
   * Opens the platform purchase sheet.
   *   Android productId: 'dayglance_pro_annual' | 'dayglance_pro_lifetime'
   *   iOS/macOS productId: 'com.dayglance.app.pro.monthly' | 'com.dayglance.app.pro.yearly'
   */
  const subscribe = useCallback((productId) => {
    if (!isOnNativePlatform) return;
    setBillingEvent(null);

    if (BILLING) BILLING.purchase?.(productId);
    if (IOS)     window.DayGlanceNative.purchase?.(productId);
    if (ELECTRON) window.electronAPI.subscriptionPurchase(productId).catch(() => {});

    // Safety timeout — clears the spinner if the bridge never fires (60s).
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setBillingEvent(prev => prev ?? {
        status: 'cancelled', code: -1, message: 'timeout', productId, ts: Date.now(),
      });
    }, 60_000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── restore ────────────────────────────────────────────────────────────────
  const restore = useCallback(() => {
    if (!isOnNativePlatform) return;
    setBillingEvent(null);

    if (BILLING) {
      BILLING.refresh?.();
      setIsLoading(true);
      setTimeout(() => {
        setStatus(readStatusAndroid());
        setPrices(readPricesAndroid());
        setIsLoading(false);
        setBillingEvent({ status: 'cancelled', code: 0, message: 'restore_complete', productId: '', ts: Date.now() });
      }, 4000);
    }

    // iOS and Electron: result fires via __billingEvent / subscription:event.
    if (IOS)     window.DayGlanceNative.restorePurchases?.();
    if (ELECTRON) window.electronAPI.subscriptionRestore().catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const clearBillingEvent = useCallback(() => setBillingEvent(null), []);

  const consumeTestPurchase = useCallback(() => {
    if (!BILLING?.consumeTestPurchase) return;
    setBillingEvent(null);
    BILLING.consumeTestPurchase();
  }, []);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  return {
    isPro: status.active,
    productId: status.productId,
    prices,
    trialEligible,
    isAndroidApp:  !!BILLING,
    isIOSApp:      IOS,
    isElectronApp: ELECTRON,
    canConsumeTestPurchase: typeof BILLING?.consumeTestPurchase === 'function',
    isLoading,
    subscribe,
    restore,
    refresh,
    consumeTestPurchase,
    billingEvent,
    clearBillingEvent,
    billingErrorMessage,
    isReviewerUnlocked,
    setReviewerUnlocked,
  };
}
