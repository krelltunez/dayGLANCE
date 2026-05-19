import { useState, useEffect, useCallback, useRef } from 'react';
import { isNativeIOS } from '../native.js';

// Android: synchronous Google Play Billing bridge
const BILLING = typeof window !== 'undefined' ? window.DayGlanceBilling : null;

// iOS: RevenueCat via WKURLSchemeHandler bridge
// window.DayGlanceNative is always defined on iOS (Proxy), so we gate on the flag.
const IOS = typeof window !== 'undefined' && isNativeIOS();

// ── Platform-agnostic status readers ──────────────────────────────────────────

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

function readStatus() {
  if (BILLING) return readStatusAndroid();
  if (IOS)     return readStatusIOS();
  return { active: false, productId: null };
}

function readPricesAndroid() {
  if (!BILLING) return { annual: null, lifetime: null };
  try {
    const p = JSON.parse(BILLING.getProductPrices());
    return { annual: p.annual || null, lifetime: p.lifetime || null };
  } catch { return { annual: null, lifetime: null }; }
}

function readPricesIOS() {
  if (!IOS) return { monthly: null, yearly: null };
  try {
    const p = JSON.parse(window.DayGlanceNative.getProductPrices());
    return { monthly: p.monthly || null, yearly: p.yearly || null };
  } catch { return { monthly: null, yearly: null }; }
}

function readPrices() {
  if (BILLING) return readPricesAndroid();
  if (IOS)     return readPricesIOS();
  return {};
}

/**
 * Maps a BillingResponseCode integer to a user-facing message.
 * Returns null for codes that should be handled silently (cancel).
 */
function billingErrorMessage(code) {
  switch (code) {
    case 4:  return "This subscription isn't available right now. Please try again later.";
    case 7:  return "You already own this item.";
    case 3:  return "Billing is not available on this device.";
    case 6:  return "Network error. Please check your connection and try again.";
    case 1:  return "Product not found. Please try again later.";
    default: return "Something went wrong with the purchase. Please try again.";
  }
}

/**
 * Exposes subscription state to the React app.
 *
 * Android: backed by Google Play Billing (window.DayGlanceBilling).
 * iOS:     backed by RevenueCat / StoreKit 2 (window.DayGlanceNative bridge).
 * Web/Electron: isPro is always true (no wall shown).
 *
 * Both platforms deliver purchase outcomes via window.__billingEvent callbacks.
 * `prices` shape differs per platform:
 *   Android → { annual, lifetime }
 *   iOS     → { monthly, yearly }
 */
export function useSubscription() {
  const cached = readStatus();
  const [status, setStatus]       = useState(cached);
  const [prices, setPrices]       = useState(readPrices);
  const [isLoading, setIsLoading] = useState(false);
  const [billingEvent, setBillingEvent] = useState(null);
  const timeoutRef = useRef(null);

  const isOnNativePlatform = !!(BILLING || IOS);

  // Register window.__billingEvent — both Android and iOS fire this callback
  // for every terminal purchase/restore outcome.
  useEffect(() => {
    if (!isOnNativePlatform) return;
    window.__billingEvent = (ev) => {
      try {
        const parsed = typeof ev === 'string' ? JSON.parse(ev) : ev;
        if (parsed.status === 'success' || parsed.status === 'consumed') {
          setStatus(readStatus());
          setPrices(readPrices());
        }
        setBillingEvent({ ...parsed, ts: Date.now() });
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      } catch {}
    };
    return () => { delete window.__billingEvent; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount: trigger a background refresh to catch changes since last open.
  useEffect(() => {
    if (BILLING) BILLING.refresh?.();
    // iOS: RevenueCat refreshes automatically; getSubscriptionStatus() returns cached value
    if (IOS) {
      setTimeout(() => {
        setStatus(readStatusIOS());
        setPrices(readPricesIOS());
      }, 3000);
    }
  }, []);

  const refresh = useCallback(() => {
    if (BILLING) {
      BILLING.refresh?.();
      setTimeout(() => {
        setStatus(readStatus());
        setPrices(readPrices());
      }, 2000);
    }
    if (IOS) {
      setTimeout(() => {
        setStatus(readStatusIOS());
        setPrices(readPricesIOS());
      }, 2000);
    }
  }, []);

  // Re-read when the user returns from the purchase sheet.
  useEffect(() => {
    if (!isOnNativePlatform) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Opens the purchase sheet.
   *   Android: productId is 'dayglance_pro_annual' | 'dayglance_pro_lifetime'
   *   iOS:     productId is 'com.dayglance.app.pro.monthly' | 'com.dayglance.app.pro.yearly'
   */
  const subscribe = useCallback((productId) => {
    if (!isOnNativePlatform) return;
    setBillingEvent(null);

    if (BILLING) BILLING.purchase?.(productId);
    if (IOS)     window.DayGlanceNative.purchase?.(productId);

    // Safety timeout — clears the spinner if the bridge never fires.
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      setBillingEvent(prev => prev ?? { status: 'cancelled', code: -1, message: 'timeout', productId, ts: Date.now() });
    }, 60_000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const restore = useCallback(() => {
    if (!isOnNativePlatform) return;
    setBillingEvent(null);

    if (BILLING) {
      BILLING.refresh?.();
      setIsLoading(true);
      setTimeout(() => {
        setStatus(readStatus());
        setPrices(readPrices());
        setIsLoading(false);
        setBillingEvent({ status: 'cancelled', code: 0, message: 'restore_complete', productId: '', ts: Date.now() });
      }, 4000);
    }

    if (IOS) {
      // Result fires via window.__billingEvent when RevenueCat finishes.
      window.DayGlanceNative.restorePurchases?.();
    }
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
    isAndroidApp: !!BILLING,
    isIOSApp: IOS,
    canConsumeTestPurchase: typeof BILLING?.consumeTestPurchase === 'function',
    isLoading,
    subscribe,
    restore,
    refresh,
    consumeTestPurchase,
    billingEvent,
    clearBillingEvent,
    billingErrorMessage,
  };
}
